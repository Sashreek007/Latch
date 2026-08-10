import { z } from "zod";

const workflowStatus = z.enum([
  "ready",
  "running",
  "suspended",
  "completed",
  "dead_lettered",
  "cancelled",
]);

const workflow = z.object({
  id: z.uuid(),
  tenantId: z.string(),
  defName: z.string(),
  defVersion: z.number().int(),
  status: workflowStatus,
  phaseIdx: z.number().int(),
  stepSeq: z.number().int(),
  state: z.object({
    input: z.unknown(),
    outputs: z.record(z.string(), z.unknown()),
  }),
});

const started = z.object({ id: z.uuid() });

export type Workflow = z.infer<typeof workflow>;
export type WorkflowStatus = z.infer<typeof workflowStatus>;

/** The three states a workflow never leaves. `suspended` is not one of them. */
const TERMINAL: readonly WorkflowStatus[] = ["completed", "dead_lettered", "cancelled"];

/** A request that reached Latch and came back with a non-2xx status. */
export class LatchError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "LatchError";
  }
}

export type ClientOptions = {
  baseUrl: string;
  /** Injectable so tests can drive the API in-process, with no port bound. */
  fetch?: typeof globalThis.fetch;
};

export type StartOptions = {
  tenantId: string;
  defName: string;
  defVersion?: number;
  input: Record<string, unknown>;
};

export type WaitOptions = {
  timeoutMs?: number;
  intervalMs?: number;
};

export function createClient(options: ClientOptions) {
  const doFetch = options.fetch ?? globalThis.fetch;
  const base = options.baseUrl.replace(/\/+$/, "");

  async function request(path: string, init?: RequestInit): Promise<unknown> {
    const response = await doFetch(`${base}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...init?.headers },
    });

    const body = await response.json().catch(() => null);

    if (!response.ok) {
      throw new LatchError(
        `${init?.method ?? "GET"} ${path} failed with ${response.status}`,
        response.status,
        body,
      );
    }

    return body;
  }

  async function start(args: StartOptions): Promise<string> {
    const body = await request("/workflows", { method: "POST", body: JSON.stringify(args) });
    return started.parse(body).id;
  }

  async function get(id: string): Promise<Workflow> {
    return workflow.parse(await request(`/workflows/${encodeURIComponent(id)}`));
  }

  /** Polls until the workflow reaches a terminal status, or the timeout elapses. */
  async function waitFor(id: string, opts: WaitOptions = {}): Promise<Workflow> {
    const timeoutMs = opts.timeoutMs ?? 10_000;
    const intervalMs = opts.intervalMs ?? 100;
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      const current = await get(id);
      if (TERMINAL.includes(current.status)) {
        return current;
      }
      if (Date.now() >= deadline) {
        throw new LatchError(
          `workflow ${id} was still ${current.status} after ${timeoutMs}ms`,
          408,
          current,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  return { start, get, waitFor };
}
