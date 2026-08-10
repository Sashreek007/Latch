export { createPool, withTransaction } from "./db.ts";
export type { Phase, PhaseContext, WorkflowDefinition } from "./definition.ts";
export { type WorkflowEvent, type WorkflowStatus, workflowEvent } from "./events.ts";
export {
  append,
  readEvents,
  readReady,
  readWorkflow,
  type StartInput,
  type StoredWorkflow,
  start,
} from "./log.ts";
export { fold, type Projection } from "./state.ts";

/**
 * Version of the engine's on-disk record formats — the event envelope and the
 * checkpoint payload. Bumped only when a record written by an older worker
 * would be misread by a newer one.
 */
export const ENGINE_FORMAT_VERSION = 1;
