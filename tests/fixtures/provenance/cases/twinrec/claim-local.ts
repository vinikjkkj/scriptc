// The claimed promise is held in a local before it is returned: the local's initializer is a checked-dynamic call result.
import { quitLike } from "twinrec/claim";
async function main(): Promise<void> {
  const seen: string[] = [];
  const a = await quitLike(true, (e, v) => seen.push("cb " + e + " " + v));
  const b = await quitLike(false, undefined);
  // The dependency arms a setImmediate and the second call a 1 ms timer: on a loaded host Node itself reaches the timer first, so wait one check
  // phase (the immediate was queued earlier and runs first) before reading what the callbacks saw.
  await new Promise<void>((r) => setImmediate(r));
  console.log(a, b, seen.join());
}
void main();
