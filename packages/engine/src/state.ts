import type { WorkflowEvent, WorkflowStatus } from "./events.ts";

/** The columns of `workflows` that are derived from the event log. */
export type Projection = {
  status: WorkflowStatus;
  phaseIdx: number;
  stepSeq: number;
  state: { input: unknown; outputs: Record<string, unknown> };
};

/**
 * Replays an entire event log into the state it describes.
 *
 * Pure and total: same events in, same projection out, with no clock, no
 * database and no randomness. That is what makes the stored projection
 * checkable — re-run this over the log and the answer must equal the row, so
 * any difference is a real bug rather than a timing artifact.
 */
export function fold(events: readonly WorkflowEvent[]): Projection {
  let status: WorkflowStatus = "ready";
  let phaseIdx = 0;
  let input: unknown = null;
  const outputs: Record<string, unknown> = {};

  for (const event of events) {
    switch (event.type) {
      case "workflow_started":
        input = event.payload.input;
        status = "ready";
        break;

      case "phase_entered":
        status = "running";
        phaseIdx = event.payload.phaseIdx;
        break;

      case "phase_completed":
        outputs[event.payload.name] = event.payload.output;
        break;

      case "completed":
        status = "completed";
        break;
    }
  }

  // `step_seq` holds the sequence number the next event will claim, and
  // sequences start at 1.
  return { status, phaseIdx, stepSeq: events.length + 1, state: { input, outputs } };
}
