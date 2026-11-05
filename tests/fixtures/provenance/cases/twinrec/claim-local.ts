// The claimed promise is held in a local before it is returned: the local's initializer is a checked-dynamic call result.
import { quitLike } from "twinrec/claim";
async function main(): Promise<void> {
  const seen: string[] = [];
  const a = await quitLike(true, (e, v) => seen.push("cb " + e + " " + v));
  const b = await quitLike(false, undefined);
  console.log(a, b, seen.join());
}
void main();
