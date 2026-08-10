import { randomUUID } from "node:crypto";
import { buildServer } from "@latch/api";
import { ticketV0 } from "@latch/demos";
import { createPool } from "@latch/engine";
import { createWorker } from "@latch/worker";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, LatchError } from "../src/client.ts";

let pool: Pool;
let app: FastifyInstance;
let worker: ReturnType<typeof createWorker>;
let client: ReturnType<typeof createClient>;

/** Unique to this run, so the worker only picks up workflows this file started. */
const DEF_NAME = `ticket-${randomUUID().slice(0, 8)}`;

beforeAll(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is unset — is the Compose stack up?");
  }

  pool = createPool(url);
  app = buildServer(pool);
  await app.ready();
  worker = createWorker(pool, [{ ...ticketV0, name: DEF_NAME }]);

  // Routes the client's HTTP calls straight into the running app. Real client
  // code, real routing, real database — and no port bound.
  client = createClient({
    baseUrl: "http://latch.test",
    fetch: async (input, init) => {
      // Properties are spread in only when present: `exactOptionalPropertyTypes`
      // treats an explicit `undefined` as a value, and Fastify's options accept
      // the key being absent but not its value being undefined.
      const response = await app.inject({
        method: (init?.method ?? "GET") as "GET" | "POST",
        url: new URL(String(input)).pathname,
        ...(init?.body ? { payload: String(init.body) } : {}),
        ...(init?.headers ? { headers: init.headers as Record<string, string> } : {}),
      });

      return new Response(response.body, {
        status: response.statusCode,
        headers: { "content-type": "application/json" },
      });
    },
  });
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

const input = { subject: "refund please", customerEmail: "dana@acme.com" };

describe("client", () => {
  it("starts a workflow and reads it back", async () => {
    const id = await client.start({ tenantId: "acme", defName: DEF_NAME, input });

    const workflow = await client.get(id);
    expect(workflow.id).toBe(id);
    expect(workflow.status).toBe("ready");
    expect(workflow.state.input).toEqual(input);
  });

  it("carries a workflow from start to completion", async () => {
    const id = await client.start({ tenantId: "acme", defName: DEF_NAME, input });
    await worker.tick(500);

    const workflow = await client.waitFor(id, { timeoutMs: 2000, intervalMs: 10 });

    expect(workflow.status).toBe("completed");
    expect(workflow.state.outputs.reply).toEqual({
      sent: true,
      to: "cus_dana",
      body: 'Thanks for writing about "refund please". As a pro customer, we will respond shortly.',
    });
  });

  it("gives up on a workflow nothing is running", async () => {
    // No worker knows this definition, so it stays `ready` forever.
    const id = await client.start({ tenantId: "acme", defName: "nobody-runs-this", input });

    await expect(client.waitFor(id, { timeoutMs: 60, intervalMs: 10 })).rejects.toThrow(
      /still ready after 60ms/,
    );
  });

  it("reports a rejected request with its status and body", async () => {
    const failure = client.start({
      tenantId: "",
      defName: DEF_NAME,
      input,
    });

    await expect(failure).rejects.toBeInstanceOf(LatchError);
    await expect(failure).rejects.toMatchObject({ status: 400 });
  });

  it("reports a missing workflow as a 404 rather than a parse failure", async () => {
    await expect(client.get(randomUUID())).rejects.toMatchObject({ status: 404 });
  });
});
