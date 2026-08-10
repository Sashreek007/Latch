import { readReady, type WorkflowDefinition } from "@latch/engine";
import type { Pool } from "pg";
import { runWorkflow } from "./runner.ts";

const key = (name: string, version: number) => `${name}@${version}`;

/**
 * Polls for workflows waiting to run and drives each one to completion.
 *
 * `tick` is exposed rather than an internal timer so tests can run exactly one
 * batch and assert on the result. The loop that calls it repeatedly lives in the
 * entrypoint, where there is nothing to test.
 */
export type WorkerOptions = {
  /** Called when a workflow fails. Defaults to writing the failure to stderr. */
  onError?: (workflowId: string, error: unknown) => void;
};

export function createWorker(
  pool: Pool,
  definitions: WorkflowDefinition[],
  options: WorkerOptions = {},
) {
  const registry = new Map(definitions.map((d) => [key(d.name, d.version), d]));
  const names = [...new Set(definitions.map((d) => d.name))];
  const onError = options.onError ?? ((id, error) => console.error(`workflow ${id} failed`, error));

  async function tick(limit = 10): Promise<number> {
    const ready = await readReady(pool, limit, names);
    let ran = 0;

    for (const workflow of ready) {
      // The poll already filtered by name; a miss here means a version of a
      // known definition that this worker does not carry. Leaving it `ready`
      // lets a worker that does carry it pick it up.
      const definition = registry.get(key(workflow.defName, workflow.defVersion));
      if (!definition) {
        continue;
      }

      try {
        await runWorkflow(pool, definition, workflow);
        ran += 1;
      } catch (error) {
        // One workflow failing must not stop the others. The failure is left in
        // `running`, so nothing picks it up again and no work is silently lost —
        // recovering it needs a lease and a retry policy, which do not exist yet.
        onError(workflow.id, error);
      }
    }

    return ran;
  }

  return { tick };
}
