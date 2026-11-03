// A direct call of the declared generic `execute` whose declared Promise payload holds record
// arms and is READ: the checked cast takes the twin's answer (a result-set header instance).
import { createPool } from "twinrec/promise";
import type { Pool } from "twinrec/promise";
async function main(): Promise<void> {
  const pool: Pool = createPool("a");
  const [hdr, f] = await pool.execute("INSERT INTO t", []);
  console.log(typeof hdr, f.length);
}
void main();
