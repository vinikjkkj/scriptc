// node:timers/promises setTimeout(delay, value) with an object literal as the
// value (the second positional argument, NOT options: Node resolves with the
// object and ignores its signal). The awaited result is read back, and the
// signal inside the value is still usable after an abort.
import { setTimeout as sleep } from "node:timers/promises";

async function main(): Promise<void> {
  const ac = new AbortController();
  const r = await sleep(2, { signal: ac.signal, tag: "rec" });
  console.log("tag", r.tag, r.signal.aborted);
  ac.abort();
  const r2 = await sleep(2, { signal: ac.signal, tag: "after" });
  console.log("after abort", r2.tag, r2.signal.aborted);
  const arr = await sleep(1, [1, 2, 3]);
  console.log("array", arr.length, arr[2]);
  console.log("done");
}

main();
