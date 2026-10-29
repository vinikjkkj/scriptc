// node:timers/promises setTimeout(delay, value): the promise resolves with the
// value after the delay. Scalar values (number, boolean, string, undefined)
// keep their own type through the await.
import { setTimeout as sleep } from "node:timers/promises";

async function main(): Promise<void> {
  const n = await sleep(3, 42);
  console.log("number", n, typeof n);
  const b = await sleep(2, false);
  console.log("bool", b, typeof b);
  const s = await sleep(2, "text");
  console.log("string", s, s.length);
  const u = await sleep(1, undefined);
  console.log("undefined", u === undefined);
  const omitted = await sleep(1);
  console.log("omitted", omitted === undefined);
  const zero = await sleep(0, 7);
  console.log("zero delay", zero);
  console.log("done");
}

main();
