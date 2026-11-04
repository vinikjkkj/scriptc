// mysql2's store shape: an executor record typed `{ execute: PoolConnection['execute'] }`. The
// declared result of `execute` holds record arms (a result-set header class in the twin), read off the
// instance as views, and its first parameter (a record | string union) crosses into the untyped method as
// the caller's own object.
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
