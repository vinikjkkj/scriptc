// node:timers/promises setTimeout with { ref: false } is not a reason to keep
// the process alive: the unref'd long sleep never resolves and the program
// exits once the referenced work is done. The referenced 2ms sleep finishes
// first, so the output is the same whether or not the unref'd timer fires.
import { setTimeout as sleep } from "node:timers/promises";

async function main(): Promise<void> {
  const p = sleep(60000, "far", { ref: false });
  void p;
  const near = await sleep(2, "near");
  console.log("near", near);
  console.log("exiting");
}

main();
