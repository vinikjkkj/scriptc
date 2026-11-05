// A package compiled by tsc that ships declarations: its default import goes through __importDefault, and the call result
// reaches a typed Promise slot (refused as an 'unknown' value without the import-default pin).
import { run } from "twinrec/impuser";
async function main(): Promise<void> {
  const seen: string[] = [];
  const a = await run(5, (e, v) => seen.push("cb " + e + " " + v));
  const b = await run(7, undefined);
  console.log(a, b, seen.join());
}
void main();
