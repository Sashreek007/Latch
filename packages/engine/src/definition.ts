/** What a phase can see: the workflow's input, and every earlier phase's output. */
export type PhaseContext = {
  input: unknown;
  outputs: Record<string, unknown>;
};

export type Phase = {
  name: string;
  /** `code` runs deterministically here; `agent` will call a model. */
  kind: "code" | "agent";
  run(ctx: PhaseContext): Promise<unknown>;
};

export type WorkflowDefinition = {
  name: string;
  version: number;
  phases: Phase[];
};
