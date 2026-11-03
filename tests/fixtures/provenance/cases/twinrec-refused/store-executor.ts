// mysql2's store shape: an executor record typed `{ execute: PoolConnection['execute'] }`. The
// declared result of `execute` holds record arms (a result-set header class in the twin), which a
// checked extraction from the twin's checked-dynamic answer cannot produce for a class instance
// exactly, so the pair stays a COMPILE-TIME refusal.
import { createPool } from "twinrec/promise";
import type { Pool, PoolConnection } from "twinrec/promise";
type Executor = { execute: PoolConnection["execute"] };
async function write(e: Executor, sql: string): Promise<void> {
  await e.execute(sql, [1, 2]);
  console.log("wrote", sql);
}
async function main(): Promise<void> {
  const pool: Pool = createPool("a");
  await write(pool, "INSERT INTO t");
}
void main();
