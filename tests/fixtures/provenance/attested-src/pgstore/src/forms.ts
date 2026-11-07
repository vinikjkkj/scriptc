// The call spellings of a package-class method taken through a record view: overloaded text/values, the callback form,
// the element spelling, and a pool member written after the record was handed over.
import type { Pool, PoolClient } from "pgbind";
type Executor = { query: PoolClient["query"] };
async function text(e: Executor): Promise<void> {
  const r = await e.query("select $1", [7]);
  console.log("text", r.rows[0]);
}
function callback(e: Executor): void {
  e.query("select cb", [1, 2], (err: Error | null, r: { rows: unknown[] }) => console.log("cb", err, r.rows[0]));
}
async function element(e: Executor): Promise<void> {
  const r = await e["query"]({ text: "element" });
  console.log("element", r.rows[0]);
}
export class Forms {
  private readonly pool: Pool;
  constructor(pool: Pool) {
    this.pool = pool;
  }
  async go(): Promise<void> {
    await text(this.pool);
    callback(this.pool);
    await element(this.pool);
    const e: Executor = this.pool;
    (this.pool as unknown as { tag: string }).tag = "renamed";
    const r = await e.query({ text: "after write" });
    console.log("live", r.rows[0]);
  }
}
