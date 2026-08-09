import { randomUUID } from "node:crypto";
import { readWorkflow, start } from "@latch/engine";
import Fastify, { type FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";

const startBody = z.object({
  tenantId: z.string().min(1),
  defName: z.string().min(1),
  defVersion: z.number().int().nonnegative().default(0),
  input: z.record(z.string(), z.unknown()),
});

const idParam = z.object({ id: z.uuid() });

/**
 * Builds the HTTP surface over a pool. Kept separate from starting a listener so
 * tests can drive real requests through it without binding a port.
 */
export function buildServer(pool: Pool): FastifyInstance {
  const app = Fastify({ logger: true });

  app.post("/workflows", async (request, reply) => {
    const body = startBody.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "invalid_body", issues: body.error.issues });
    }

    const id = randomUUID();
    await start(pool, { id, ...body.data });

    return reply.code(201).send({ id });
  });

  app.get("/workflows/:id", async (request, reply) => {
    const params = idParam.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: "invalid_id" });
    }

    const workflow = await readWorkflow(pool, params.data.id);
    if (!workflow) {
      return reply.code(404).send({ error: "not_found" });
    }

    return reply.send(workflow);
  });

  return app;
}
