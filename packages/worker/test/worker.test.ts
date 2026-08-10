import { randomUUID } from "node:crypto";
import { ticketV0 } from "@latch/demos";
import { createPool, fold, readEvents, readWorkflow, start } from "@latch/engine";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWorker } from "../src/poller.ts";

let pool: Pool;
let worker: ReturnType<typeof createWorker>;

/**
 * The queue is global: `readReady` polls every waiting workflow, so unique ids
 * do not isolate these tests the way they isolate a lookup. Registering the
 * definition under a name unique to this run means the worker recognizes only
 * the workflows this file started, and skips everyone else's.
 */
const DEF_NAME = `ticket-${randomUUID().slice(0, 8)}`;

/** Large enough that unrelated waiting workflows cannot crowd ours out of the batch. */
const LIMIT = 500;

beforeAll(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is unset — is the Compose stack up?");
  }
  pool = createPool(url);
  worker = createWorker(pool, [{ ...ticketV0, name: DEF_NAME }]);

  // Ready workflows left behind by previous runs accumulate forever and would
  // eventually fill the poll's batch. Ten minutes is well clear of anything a
  // concurrently running test file could have created.
  await pool.query(
    `DELETE FROM workflow_events
      WHERE workflow_id IN (
        SELECT id FROM workflows
         WHERE status = 'ready' AND run_after < now() - interval '10 minutes')`,
  );
  await pool.query(
    `DELETE FROM workflows WHERE status = 'ready' AND run_after < now() - interval '10 minutes'`,
  );
});

afterAll(async () => {
  await pool.end();
});

const input = { subject: "refund please", customerEmail: "dana@acme.com" };

async function startTicket(defName = DEF_NAME, defVersion = 0): Promise<string> {
  const id = randomUUID();
  await start(pool, { id, tenantId: "acme", defName, defVersion, input });
  return id;
}

describe("worker", () => {
  it("runs a ready workflow to completion", async () => {
    const id = await startTicket();
    await worker.tick(LIMIT);

    const workflow = await readWorkflow(pool, id);
    expect(workflow?.status).toBe("completed");
    expect(workflow?.state.outputs).toEqual({
      lookup: { customerId: "cus_dana", plan: "pro" },
      reply: {
        sent: true,
        to: "cus_dana",
        body: 'Thanks for writing about "refund please". As a pro customer, we will respond shortly.',
      },
    });
  });

  it("records the run as a log of six events in order", async () => {
    const id = await startTicket();
    await worker.tick(LIMIT);

    expect((await readEvents(pool, id)).map((e) => e.type)).toEqual([
      "workflow_started",
      "phase_entered",
      "phase_completed",
      "phase_entered",
      "phase_completed",
      "completed",
    ]);
  });

  it("leaves the projected row equal to a fresh fold of the log", async () => {
    const id = await startTicket();
    await worker.tick(LIMIT);

    const workflow = await readWorkflow(pool, id);
    const replayed = fold(await readEvents(pool, id));

    expect({
      status: workflow?.status,
      phaseIdx: workflow?.phaseIdx,
      stepSeq: workflow?.stepSeq,
      state: workflow?.state,
    }).toEqual(replayed);
  });

  it("does not pick a workflow up twice", async () => {
    const id = await startTicket();
    await worker.tick(LIMIT);
    await worker.tick(LIMIT);

    expect(await readEvents(pool, id)).toHaveLength(6);
  });

  it("survives a phase that throws, and keeps running the others", async () => {
    const failures: string[] = [];
    const brittle = {
      ...ticketV0,
      name: `${DEF_NAME}-brittle`,
      phases: [
        {
          name: "explode",
          kind: "code" as const,
          run: async () => {
            throw new Error("phase blew up");
          },
        },
      ],
    };

    const isolated = createWorker(pool, [{ ...ticketV0, name: DEF_NAME }, brittle], {
      onError: (id) => failures.push(id),
    });

    const doomed = await startTicket(brittle.name);
    const healthy = await startTicket();

    await isolated.tick(LIMIT);

    expect(failures).toEqual([doomed]);
    expect((await readWorkflow(pool, healthy))?.status).toBe("completed");
    // Left mid-run rather than back in the queue: nothing reclaims it yet.
    expect((await readWorkflow(pool, doomed))?.status).toBe("running");
  });

  it("leaves a version of a known definition it does not carry untouched", async () => {
    const id = await startTicket(DEF_NAME, 99);
    await worker.tick(LIMIT);

    const workflow = await readWorkflow(pool, id);
    expect(workflow?.status).toBe("ready");
    expect(await readEvents(pool, id)).toHaveLength(1);
  });
});
