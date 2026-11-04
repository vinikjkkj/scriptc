// mysql2's pool shape the REST app declares: a record with `getConnection(): Promise<TxConn>` where TxConn is the
// app's own record of methods. The twin's untyped getConnection resolves a class instance; the declared payload is
// served by a record that VIEWS that instance: its methods call the instance by name (so it stays `this`), its data
// members are the instance's own (a write by the twin is seen at the next read, and a write through the record
// lands on the instance), and an optional method is the closure when the instance has it and undefined when not.
import { createPool } from "twinrec/promise";
import type { Pool } from "twinrec/promise";
interface TxConn {
  calls: number;
  execute(sql: string, values?: unknown): Promise<[unknown, unknown]>;
  query(sql: string, values?: unknown): Promise<[string, string[]]>;
  release?(): void;
  ping?(): Promise<void>;
  enablePing(): void;
  disablePing(): void;
}
interface PoolRec {
  getConnection(): Promise<TxConn>;
  end(): Promise<void>;
}
interface PoolInline {
  getConnection(): Promise<{ calls: number; execute(sql: string): Promise<[unknown, unknown]> }>;
}
async function main(): Promise<void> {
  const pool: Pool = createPool("a");
  const rec: PoolRec = pool;
  const conn = await rec.getConnection();
  console.log("calls", conn.calls);
  const r = await conn.execute("SELECT 1", [1]);
  console.log("exec", Array.isArray(r), r[0], conn.calls);
  const q = await conn.query("SELECT 2", [1, 2]);
  console.log("query", q[0], q[1].length);
  conn.calls = 10;
  await conn.execute("SELECT 3");
  console.log("calls after write+exec", conn.calls);
  console.log("ping", conn.ping === undefined, typeof conn.release);
  conn.enablePing();
  console.log("ping now", conn.ping === undefined, conn.ping !== undefined ? await conn.ping() : "none");
  conn.disablePing();
  console.log("ping gone", conn.ping === undefined);
  if (conn.release !== undefined) conn.release();
  const inline: PoolInline = pool;
  const c2 = await inline.getConnection();
  const r2 = await c2.execute("INSERT x");
  console.log("inline", c2.calls, Array.isArray(r2));
  await rec.end();
}
void main();
