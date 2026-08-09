import type { WorkflowDefinition } from "@latch/engine";
import { z } from "zod";

const ticketInput = z.object({
  subject: z.string(),
  customerEmail: z.string(),
});

const lookupOutput = z.object({
  customerId: z.string(),
  plan: z.enum(["free", "pro"]),
});

/**
 * A support ticket, handled in two phases. Both are deterministic stubs — this
 * definition exists so the engine has real work to carry, and it thickens as the
 * engine gains the ability to do more.
 */
export const ticketV0: WorkflowDefinition = {
  name: "ticket",
  version: 0,
  phases: [
    {
      name: "lookup",
      kind: "code",
      async run({ input }) {
        const { customerEmail } = ticketInput.parse(input);
        const handle = customerEmail.split("@")[0] ?? "unknown";

        // Stands in for a CRM lookup until there is a tool port to call one.
        return {
          customerId: `cus_${handle}`,
          plan: customerEmail.endsWith("@acme.com") ? "pro" : "free",
        };
      },
    },
    {
      name: "reply",
      kind: "code",
      async run({ input, outputs }) {
        const { subject } = ticketInput.parse(input);
        // Written by an earlier phase into the projection, so it comes back out
        // of a JSONB column and is checked rather than trusted.
        const { customerId, plan } = lookupOutput.parse(outputs.lookup);

        return {
          sent: true,
          to: customerId,
          body: `Thanks for writing about "${subject}". As a ${plan} customer, we will respond shortly.`,
        };
      },
    },
  ],
};
