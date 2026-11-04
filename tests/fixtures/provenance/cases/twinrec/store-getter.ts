// A data member the twin serves through a getter that counts its calls. The record projection must read it once per
// program read (Node's count), never once more at projection: the type is checked lazily on each read.
import { createPool } from "twinrec/promise";
import type { Pool } from "twinrec/promise";
interface TxConn {
  readonly probes: number;
  calls: number;
  execute(sql: string, values?: unknown): Promise<[unknown, unknown]>;
  enablePing(): void;
  ping?(): Promise<void>;
}
interface PoolRec {
  getConnection(): Promise<TxConn>;
}
async function main(): Promise<void> {
  const pool: Pool = createPool("g");
  const rec: PoolRec = pool;
  const conn = await rec.getConnection();
  console.log("first", conn.probes);
  console.log("second", conn.probes);
  await conn.execute("SELECT 1");
  const a = conn.probes;
  const b = conn.probes;
  console.log("after", a, b, conn.calls);
  conn.enablePing();
  console.log("third", conn.probes, conn.ping !== undefined);
}
void main();
