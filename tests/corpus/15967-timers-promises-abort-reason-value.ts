// node:timers/promises setTimeout with a signal aborted with an Error reason
// and a sibling wait that was NOT aborted still resolves with its value.
import { setTimeout as sleep } from "node:timers/promises";

async function main(): Promise<void> {
  const ac = new AbortController();
  const other = new AbortController();
  const doomed = sleep(300, "doomed", { signal: ac.signal }).then(
    (v) => `resolved ${v}`,
    (err) => `caught ${(err as Error).name}`,
  );
  const alive = sleep(2, "alive", { signal: other.signal });
  await sleep(3);
  ac.abort(new Error("boom"));
  console.log(await doomed);
  console.log("alive", await alive);
  console.log("done");
}

main();
