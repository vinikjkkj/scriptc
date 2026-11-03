// Direct calls of a declared GENERIC, OVERLOADED method (mysql2's execute/query from a mixin) on a
// declaration type whose twin class has untyped methods: the call dispatches to the twin's
// implementation, and its checked-dynamic answer is the declared Promise by Node's resolution rule.
import { createPool } from "twinrec/promise";
import type { Pool, PoolConnection } from "twinrec/promise";

async function main(): Promise<void> {
  const pool: Pool = createPool("a");
  const [text, labels] = await pool.query<string>("Q1", [1, 2]);
  console.log("query", text, labels.length);
  const [again] = await pool.query<string>({ sql: "Q2" });
  console.log("options", again);
  // The store's shape: the awaited result of `execute` is never read, so no payload is extracted
  // (the twin answers a ResultSetHeader instance for a write, which Node hands over untouched).
  await pool.execute("INSERT INTO t", [1]);
  console.log("inserted");
  const conn: PoolConnection = await pool.getConnection();
  await conn.execute("INSERT INTO u");
  console.log("inserted conn");
  const [fromConn] = await conn.query<string>("Q3", []);
  console.log("conn", fromConn);
  try {
    await pool.query<string>("boom");
  } catch (e) {
    console.log("caught", (e as Error).message);
  }
  conn.release();
  console.log("count", pool.count());
  await pool.end();
  console.log("ended");
}
void main();
