// A declaration-file class (mysql2's Pool) whose twin is a class in ANOTHER file
// (lib/promise/pool.js, reached by require) with UNTYPED methods. Values of the
// declared types flow where an application's own record asks for `execute` and
// `end` (the program writes the interface; the instance is the twin's class).
import { createPool } from "twinrec/promise";
import type { Pool, PoolConnection } from "twinrec/promise";

interface AppExec {
  execute(sql: string, values?: readonly unknown[]): Promise<[unknown, unknown]>;
}
interface AppEnd extends AppExec {
  end(): Promise<void>;
}

async function sqlRun(c: AppExec, sql: string): Promise<void> {
  const out = await c.execute(sql, []);
  console.log("sqlRun", String((out[0] as string).length));
}

async function shut(c: AppEnd): Promise<void> {
  await c.end();
  console.log("shut");
}

async function main(): Promise<void> {
  const pool: Pool = createPool("a");
  await sqlRun(pool, "SELECT 1");
  const [text, labels] = await pool.query<string>("Q1", [1, 2]);
  console.log("query", text, labels.length);
  const conn: PoolConnection = await pool.getConnection();
  await sqlRun(conn, "SELECT 2");
  try {
    await sqlRun(pool, "boom");
  } catch (e) {
    console.log("caught", (e as Error).message);
  }
  console.log("count", pool.count());
  conn.release();
  const app = pool as unknown as AppEnd;
  await sqlRun(app, "SELECT 3");
  await shut(app);
  await shut(pool);
  console.log("ended");
}
void main();
