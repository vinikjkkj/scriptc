// node:timers/promises setTimeout with a signal aborted DURING the wait: the
// timer is cleared (the 500ms sleep never resolves) and the promise rejects
// with an AbortError. The abort is issued after an explicit await, so the
// order is fixed.
import { setTimeout as sleep } from "node:timers/promises";

async function main(): Promise<void> {
  const ac = new AbortController();
  const waiting = sleep(500, "late", { signal: ac.signal }).then(
    (v) => `resolved ${v}`,
    (err) => `rejected ${(err as Error).name} ${(err as Error).message}`,
  );
  await sleep(5);
  ac.abort("stop now");
  console.log(await waiting);
  console.log("done");
}

main();
