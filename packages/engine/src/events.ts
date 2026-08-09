import { z } from "zod";

export const WORKFLOW_STATUSES = [
  "ready",
  "running",
  "suspended",
  "completed",
  "dead_lettered",
  "cancelled",
] as const;

export const workflowStatus = z.enum(WORKFLOW_STATUSES);
export type WorkflowStatus = z.infer<typeof workflowStatus>;

const workflowStarted = z.object({
  type: z.literal("workflow_started"),
  payload: z.object({
    defName: z.string(),
    defVersion: z.number().int(),
    input: z.record(z.string(), z.unknown()),
  }),
});

const phaseEntered = z.object({
  type: z.literal("phase_entered"),
  payload: z.object({
    phaseIdx: z.number().int(),
    name: z.string(),
    kind: z.enum(["code", "agent"]),
  }),
});

const phaseCompleted = z.object({
  type: z.literal("phase_completed"),
  payload: z.object({
    phaseIdx: z.number().int(),
    name: z.string(),
    output: z.unknown(),
  }),
});

const completed = z.object({
  type: z.literal("completed"),
  payload: z.object({}),
});

/**
 * Every entry the log is allowed to contain. Payloads are stored as JSONB, so
 * the database will hand back whatever was written — including rows written by
 * a version of the code that no longer exists. This schema is where that data
 * is checked on the way in, rather than trusted and dereferenced later.
 */
export const workflowEvent = z.discriminatedUnion("type", [
  workflowStarted,
  phaseEntered,
  phaseCompleted,
  completed,
]);

export type WorkflowEvent = z.infer<typeof workflowEvent>;
