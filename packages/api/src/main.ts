import { createPool } from "@latch/engine";
import { buildServer } from "./server.ts";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is unset");
}

const app = buildServer(createPool(url));

// 0.0.0.0 rather than localhost: inside a container, binding to the loopback
// interface makes the process unreachable from outside it.
await app.listen({ port: Number(process.env.PORT ?? 3000), host: "0.0.0.0" });
