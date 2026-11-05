// A declaration-claimed promise of an array of [error, result] tuples, with and without an Error element.
import { execLike } from "twinrec/claim";
async function main(): Promise<void> {
  const ok = await execLike(false);
  console.log(ok?.length, ok?.[0]?.[0], ok?.[0]?.[1], ok?.[1]?.[1]);
  const bad = await execLike(true);
  const e = bad?.[0]?.[0];
  console.log(bad?.length, e === null, e?.message, bad?.[1]?.[1]);
}
void main();
