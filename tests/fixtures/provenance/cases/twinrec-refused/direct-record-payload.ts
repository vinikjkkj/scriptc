// A direct call of the declared generic `execute` whose declared Promise payload holds record
// arms: the compile-time refusal replaces the internal compiler error this shape produced.
import { createPool } from "twinrec/promise";
import type { Pool } from "twinrec/promise";
async function main(): Promise<void> {
  const pool: Pool = createPool("a");
  const [hdr, f] = await pool.execute("INSERT INTO t", []);
  console.log(typeof hdr, f.length);
}
void main();
