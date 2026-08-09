import { describe, expect, it } from "vitest";
import { ticketV0 } from "../src/ticket.ts";

const input = { subject: "refund please", customerEmail: "dana@acme.com" };

const [lookup, reply] = ticketV0.phases;

describe("ticket-v0", () => {
  it("declares two code phases in order", () => {
    expect(ticketV0.phases.map((p) => p.name)).toEqual(["lookup", "reply"]);
    expect(ticketV0.phases.every((p) => p.kind === "code")).toBe(true);
  });

  it("looks the customer up from the ticket input", async () => {
    expect(await lookup?.run({ input, outputs: {} })).toEqual({
      customerId: "cus_dana",
      plan: "pro",
    });
  });

  it("treats an address outside the company as a free-plan customer", async () => {
    const outside = { ...input, customerEmail: "sam@example.org" };
    expect(await lookup?.run({ input: outside, outputs: {} })).toEqual({
      customerId: "cus_sam",
      plan: "free",
    });
  });

  it("writes a reply that uses the earlier phase's output", async () => {
    const outputs = { lookup: await lookup?.run({ input, outputs: {} }) };

    expect(await reply?.run({ input, outputs })).toEqual({
      sent: true,
      to: "cus_dana",
      body: 'Thanks for writing about "refund please". As a pro customer, we will respond shortly.',
    });
  });

  it("refuses to reply when the lookup output is missing or malformed", async () => {
    await expect(reply?.run({ input, outputs: {} })).rejects.toThrow();
    await expect(
      reply?.run({ input, outputs: { lookup: { plan: "enterprise" } } }),
    ).rejects.toThrow();
  });

  it("is deterministic — the same ticket produces the same reply", async () => {
    const once = await lookup?.run({ input, outputs: {} });
    const twice = await lookup?.run({ input, outputs: {} });
    expect(once).toEqual(twice);
  });
});
