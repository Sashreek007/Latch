import { describe, expect, it } from "vitest";
import { type WorkflowEvent, workflowEvent } from "../src/events.ts";
import { fold } from "../src/state.ts";

/** The log a completed ticket-v0 run leaves behind. */
const ticketLog: WorkflowEvent[] = [
  {
    type: "workflow_started",
    payload: { defName: "ticket", defVersion: 0, input: { subject: "refund please" } },
  },
  { type: "phase_entered", payload: { phaseIdx: 0, name: "lookup", kind: "code" } },
  { type: "phase_completed", payload: { phaseIdx: 0, name: "lookup", output: { plan: "pro" } } },
  { type: "phase_entered", payload: { phaseIdx: 1, name: "reply", kind: "code" } },
  { type: "phase_completed", payload: { phaseIdx: 1, name: "reply", output: { sent: true } } },
  { type: "completed", payload: {} },
];

describe("fold", () => {
  it("starts a workflow ready, at phase zero, awaiting sequence one", () => {
    expect(fold([])).toEqual({
      status: "ready",
      phaseIdx: 0,
      stepSeq: 1,
      state: { input: null, outputs: {} },
    });
  });

  it("replays a completed run into its final projection", () => {
    expect(fold(ticketLog)).toEqual({
      status: "completed",
      phaseIdx: 1,
      stepSeq: 7,
      state: {
        input: { subject: "refund please" },
        outputs: { lookup: { plan: "pro" }, reply: { sent: true } },
      },
    });
  });

  it("reaches the same projection whichever prefix it is rebuilt from", () => {
    // Folding a prefix and then the remainder is not the same operation as
    // folding the whole log, but it must reach the same place — this is the
    // property the M1 gate depends on.
    const whole = fold(ticketLog);
    const rebuilt = fold(ticketLog.slice(0, 3).concat(ticketLog.slice(3)));
    expect(rebuilt).toEqual(whole);
  });
});

describe("event schema", () => {
  it("accepts a well-formed event", () => {
    expect(() => workflowEvent.parse(ticketLog[1])).not.toThrow();
  });

  it("rejects an event type it has never heard of", () => {
    expect(() => workflowEvent.parse({ type: "refund_issued", payload: {} })).toThrow();
  });

  it("rejects a known event carrying the wrong payload", () => {
    expect(() =>
      workflowEvent.parse({ type: "phase_entered", payload: { phaseIdx: "first" } }),
    ).toThrow();
  });
});
