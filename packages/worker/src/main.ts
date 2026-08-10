import { ticketV0 } from "@latch/demos";
import { createPool } from "@latch/engine";
import { createWorker } from "./poller.ts";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is unset");
}

const worker = createWorker(createPool(url), [ticketV0]);
const intervalMs = Number(process.env.POLL_INTERVAL_MS ?? 500);

for (;;) {
  const ran = await worker.tick();
  if (ran === 0) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
