import type { Pool, PoolClient } from "pg";
import { withTransaction } from "./db.ts";
import { type WorkflowEvent, type WorkflowStatus, workflowEvent } from "./events.ts";

/** Anything that can run a query — a pool, or a client inside a transaction. */
type Queryable = Pick<Pool, "query">;

/** The projected columns of `workflows`, in the shape Postgres returns them. */
type ProjectionRow = {
  status: WorkflowStatus;
  phase_idx: number;
  step_seq: number;
  state: { input: unknown; outputs: Record<string, unknown> };
};

type EventRow = { seq: number; type: string; payload: unknown };

export type StartInput = {
  id: string;
  tenantId: string;
  defName: string;
  defVersion: number;
  input: Record<string, unknown>;
};

/** A workflow as callers see it — column names translated to camelCase here, once. */
export type StoredWorkflow = {
  id: string;
  tenantId: string;
  defName: string;
  defVersion: number;
  status: WorkflowStatus;
  phaseIdx: number;
  stepSeq: number;
  state: { input: unknown; outputs: Record<string, unknown> };
};

type WorkflowRow = ProjectionRow & {
  id: string;
  tenant_id: string;
  def_name: string;
  def_version: number;
};

const WORKFLOW_COLUMNS = "id, tenant_id, def_name, def_version, status, phase_idx, step_seq, state";

function toStoredWorkflow(row: WorkflowRow): StoredWorkflow {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    defName: row.def_name,
    defVersion: row.def_version,
    status: row.status,
    phaseIdx: row.phase_idx,
    stepSeq: row.step_seq,
    state: row.state,
  };
}

export async function readWorkflow(db: Queryable, id: string): Promise<StoredWorkflow | null> {
  const { rows } = await db.query<WorkflowRow>(
    `SELECT ${WORKFLOW_COLUMNS} FROM workflows WHERE id = $1`,
    [id],
  );

  const row = rows[0];
  return row ? toStoredWorkflow(row) : null;
}

/**
 * Workflows waiting to be run, oldest due first, restricted to the definitions
 * the caller can actually execute.
 *
 * That restriction is not an optimisation. Without it the batch fills with rows
 * this worker must skip, they are the oldest so they are always chosen first,
 * and runnable work behind them is never reached — the queue looks healthy while
 * nothing progresses.
 *
 * Two workers running this would both claim the same rows: there is no lease
 * here yet, so exactly one process may poll.
 */
export async function readReady(
  db: Queryable,
  limit: number,
  defNames: readonly string[],
): Promise<StoredWorkflow[]> {
  if (defNames.length === 0) return [];

  const { rows } = await db.query<WorkflowRow>(
    `SELECT ${WORKFLOW_COLUMNS}
       FROM workflows
      WHERE status = 'ready' AND run_after <= now() AND def_name = ANY($2)
      ORDER BY run_after
      LIMIT $1`,
    [limit, defNames],
  );

  return rows.map(toStoredWorkflow);
}

/**
 * Creates a workflow and records its opening event in one transaction. A row
 * without its first event would be a workflow whose history begins after it
 * started, which nothing downstream could explain.
 */
export async function start(pool: Pool, args: StartInput): Promise<void> {
  await withTransaction(pool, async (tx) => {
    // `step_seq` is the sequence number the next event will claim, and event 1
    // is written just below.
    await tx.query(
      `INSERT INTO workflows
         (id, tenant_id, def_name, def_version, status, phase_idx, step_seq, state)
       VALUES ($1, $2, $3, $4, 'ready', 0, 2, $5)`,
      [args.id, args.tenantId, args.defName, args.defVersion, { input: args.input, outputs: {} }],
    );

    await tx.query(
      `INSERT INTO workflow_events (workflow_id, seq, type, payload)
       VALUES ($1, 1, 'workflow_started', $2)`,
      [args.id, { defName: args.defName, defVersion: args.defVersion, input: args.input }],
    );
  });
}

/**
 * Applies exactly one event to a projection.
 *
 * This deliberately restates the rules that `fold` implements over a whole log,
 * rather than sharing code with it. The two are compared against each other in
 * the tests, and that comparison can only fail if they are genuinely separate
 * implementations.
 */
function applyEvent(current: ProjectionRow, event: WorkflowEvent): Omit<ProjectionRow, "step_seq"> {
  switch (event.type) {
    case "workflow_started":
      return { status: "ready", phase_idx: 0, state: { input: event.payload.input, outputs: {} } };

    case "phase_entered":
      return { status: "running", phase_idx: event.payload.phaseIdx, state: current.state };

    case "phase_completed":
      return {
        status: current.status,
        phase_idx: current.phase_idx,
        state: {
          ...current.state,
          outputs: { ...current.state.outputs, [event.payload.name]: event.payload.output },
        },
      };

    case "completed":
      return { status: "completed", phase_idx: current.phase_idx, state: current.state };
  }
}

/**
 * Appends one event and moves the projected row to match, inside the caller's
 * transaction. Takes a client rather than a pool so it cannot be called outside
 * one — the append and the projection update must commit together, or the row
 * would be able to disagree with the log.
 */
export async function append(
  tx: PoolClient,
  workflowId: string,
  event: WorkflowEvent,
): Promise<void> {
  // FOR UPDATE holds the row until this transaction commits. The primary key on
  // (workflow_id, seq) already stops two writers claiming the same sequence, but
  // nothing would stop the loser overwriting the projection from stale values.
  const { rows } = await tx.query<ProjectionRow>(
    `SELECT status, phase_idx, step_seq, state
       FROM workflows
      WHERE id = $1
      FOR UPDATE`,
    [workflowId],
  );

  const current = rows[0];
  if (!current) {
    throw new Error(`append: no workflow ${workflowId}`);
  }

  await tx.query(
    `INSERT INTO workflow_events (workflow_id, seq, type, payload)
     VALUES ($1, $2, $3, $4)`,
    [workflowId, current.step_seq, event.type, event.payload],
  );

  const next = applyEvent(current, event);

  await tx.query(
    `UPDATE workflows
        SET status = $2, phase_idx = $3, step_seq = $4, state = $5
      WHERE id = $1`,
    [workflowId, next.status, next.phase_idx, current.step_seq + 1, next.state],
  );
}

/** Reads a workflow's log in order, validating every row on the way out. */
export async function readEvents(db: Queryable, workflowId: string): Promise<WorkflowEvent[]> {
  const { rows } = await db.query<EventRow>(
    `SELECT seq, type, payload
       FROM workflow_events
      WHERE workflow_id = $1
      ORDER BY seq`,
    [workflowId],
  );

  return rows.map((row, i) => {
    // Sequences are dense and start at 1. A gap means an event was lost, and
    // every projection derived from this log would be quietly wrong.
    if (row.seq !== i + 1) {
      throw new Error(`workflow ${workflowId}: expected seq ${i + 1}, found ${row.seq}`);
    }
    return workflowEvent.parse({ type: row.type, payload: row.payload });
  });
}
