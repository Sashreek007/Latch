import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, withTransaction } from "../src/db.ts";
import type { WorkflowEvent } from "../src/events.ts";
import { append, readEvents, start } from "../src/log.ts";
import { fold } from "../src/state.ts";

let pool: Pool;

beforeAll(() => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is unset — is the Compose stack up?");
  }
  pool = createPool(url);
});

afterAll(async () => {
  await pool.end();
});

/** Starts a fresh workflow and returns its id. Every test gets its own. */
async function startTicket(): Promise<string> {
  const id = randomUUID();
  await start(pool, {
    id,
    tenantId: "acme",
    defName: "ticket",
    defVersion: 0,
    input: { subject: "refund please" },
  });
  return id;
}

/** The projected row, renamed into the shape `fold` returns. */
async function readProjection(id: string) {
  const { rows } = await pool.query<{
    status: string;
    phase_idx: number;
    step_seq: number;
    state: { input: unknown; outputs: Record<string, unknown> };
  }>(`SELECT status, phase_idx, step_seq, state FROM workflows WHERE id = $1`, [id]);

  const row = rows[0];
  if (!row) throw new Error(`no workflow ${id}`);

  return { status: row.status, phaseIdx: row.phase_idx, stepSeq: row.step_seq, state: row.state };
}

const REST_OF_RUN: WorkflowEvent[] = [
  { type: "phase_entered", payload: { phaseIdx: 0, name: "lookup", kind: "code" } },
  { type: "phase_completed", payload: { phaseIdx: 0, name: "lookup", output: { plan: "pro" } } },
  { type: "phase_entered", payload: { phaseIdx: 1, name: "reply", kind: "code" } },
  { type: "phase_completed", payload: { phaseIdx: 1, name: "reply", output: { sent: true } } },
  { type: "completed", payload: {} },
];

describe("start", () => {
  it("writes the workflow and its opening event together", async () => {
    const id = await startTicket();

    const events = await readEvents(pool, id);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("workflow_started");

    expect(await readProjection(id)).toEqual({
      status: "ready",
      phaseIdx: 0,
      stepSeq: 2,
      state: { input: { subject: "refund please" }, outputs: {} },
    });
  });
});

describe("append", () => {
  it("keeps the projected row equal to a fresh fold of the log", async () => {
    const id = await startTicket();

    for (const event of REST_OF_RUN) {
      await withTransaction(pool, (tx) => append(tx, id, event));
    }

    const replayed = fold(await readEvents(pool, id));
    expect(await readProjection(id)).toEqual(replayed);
  });

  it("refuses a sequence number that has already been written", async () => {
    const id = await startTicket();

    // What a worker running on a stale `step_seq` would attempt.
    await expect(
      pool.query(
        `INSERT INTO workflow_events (workflow_id, seq, type, payload)
         VALUES ($1, 1, 'completed', '{}'::jsonb)`,
        [id],
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });
});

describe("readEvents", () => {
  it("refuses a log with a hole in it", async () => {
    const id = await startTicket();
    await withTransaction(pool, (tx) => append(tx, id, REST_OF_RUN[0] as WorkflowEvent));
    await withTransaction(pool, (tx) => append(tx, id, REST_OF_RUN[1] as WorkflowEvent));

    await pool.query(`DELETE FROM workflow_events WHERE workflow_id = $1 AND seq = 2`, [id]);

    await expect(readEvents(pool, id)).rejects.toThrow(/expected seq 2, found 3/);
  });
});

describe("withTransaction", () => {
  it("leaves nothing behind when the body throws", async () => {
    const id = randomUUID();

    await expect(
      withTransaction(pool, async (tx) => {
        await tx.query(
          `INSERT INTO workflows
             (id, tenant_id, def_name, def_version, status, phase_idx, step_seq, state)
           VALUES ($1, 'acme', 'ticket', 0, 'ready', 0, 1, '{}'::jsonb)`,
          [id],
        );
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const { rowCount } = await pool.query(`SELECT 1 FROM workflows WHERE id = $1`, [id]);
    expect(rowCount).toBe(0);
  });
});
