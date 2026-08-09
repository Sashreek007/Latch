import type { Pool, PoolClient } from "pg";
import pg from "pg";

export function createPool(connectionString: string): Pool {
  return new pg.Pool({ connectionString });
}

/**
 * Runs `fn` inside a single database transaction. Everything `fn` writes
 * commits together, or none of it does.
 */
export async function withTransaction<T>(
  pool: Pool,
  fn: (tx: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // The connection is already broken or the transaction already aborted.
      // Either way the caller's error is the one worth seeing.
    }
    throw error;
  } finally {
    client.release();
  }
}
