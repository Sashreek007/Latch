import {
  append,
  type StoredWorkflow,
  type WorkflowDefinition,
  withTransaction,
} from "@latch/engine";
import type { Pool } from "pg";

/**
 * Runs every phase of a definition, recording an event before and after each
 * one, and a terminal event at the end.
 */
export async function runWorkflow(
  pool: Pool,
  definition: WorkflowDefinition,
  workflow: StoredWorkflow,
): Promise<void> {
  let outputs: Record<string, unknown> = { ...workflow.state.outputs };

  for (const [phaseIdx, phase] of definition.phases.entries()) {
    await withTransaction(pool, (tx) =>
      append(tx, workflow.id, {
        type: "phase_entered",
        payload: { phaseIdx, name: phase.name, kind: phase.kind },
      }),
    );

    // Deliberately outside the transaction. A phase is arbitrary work — once one
    // of these calls a model it takes seconds, and holding a row lock across it
    // would block every other writer for the duration.
    const output = await phase.run({ input: workflow.state.input, outputs });

    await withTransaction(pool, (tx) =>
      append(tx, workflow.id, {
        type: "phase_completed",
        payload: { phaseIdx, name: phase.name, output },
      }),
    );

    outputs = { ...outputs, [phase.name]: output };
  }

  await withTransaction(pool, (tx) => append(tx, workflow.id, { type: "completed", payload: {} }));
}
