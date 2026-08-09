import { randomUUID } from "node:crypto";
import { createPool, readEvents } from "@latch/engine";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.ts";

let pool: Pool;
let app: FastifyInstance;

beforeAll(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is unset — is the Compose stack up?");
  }
  pool = createPool(url);
  app = buildServer(pool);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

const validBody = {
  tenantId: "acme",
  defName: "ticket",
  defVersion: 0,
  input: { subject: "refund please", customerEmail: "dana@acme.com" },
};

async function startWorkflow(): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/workflows", payload: validBody });
  expect(response.statusCode).toBe(201);
  return response.json().id as string;
}

describe("POST /workflows", () => {
  it("creates a workflow and returns its id", async () => {
    const id = await startWorkflow();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    const events = await readEvents(pool, id);
    expect(events.map((e) => e.type)).toEqual(["workflow_started"]);
  });

  it("rejects a body that is missing required fields", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/workflows",
      payload: { defName: "ticket" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("invalid_body");
  });

  it("rejects a body whose input is not an object", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/workflows",
      payload: { ...validBody, input: "refund please" },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe("GET /workflows/:id", () => {
  it("returns the workflow a start request created", async () => {
    const id = await startWorkflow();

    const response = await app.inject({ method: "GET", url: `/workflows/${id}` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      id,
      tenantId: "acme",
      defName: "ticket",
      defVersion: 0,
      status: "ready",
      phaseIdx: 0,
      stepSeq: 2,
      state: { input: validBody.input, outputs: {} },
    });
  });

  it("returns 404 for a workflow that does not exist", async () => {
    const response = await app.inject({ method: "GET", url: `/workflows/${randomUUID()}` });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe("not_found");
  });

  it("returns 400 for an id that is not a uuid", async () => {
    const response = await app.inject({ method: "GET", url: "/workflows/hello" });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("invalid_id");
  });
});
