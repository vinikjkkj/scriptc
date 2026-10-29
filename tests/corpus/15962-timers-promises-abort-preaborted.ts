// node:timers/promises setTimeout(delay, value, { signal }) with a signal that
// is already aborted: the promise rejects at once with an AbortError (name,
// code ABORT_ERR, Node's message) whose cause is the signal's reason.
import { setTimeout as sleep } from "node:timers/promises";

async function main(): Promise<void> {
  const ac = new AbortController();
  ac.abort();
  try {
    await sleep(50, "never", { signal: ac.signal });
    console.log("resolved");
  } catch (err) {
    const e = err as Error;
    console.log("name", e.name);
    console.log("message", e.message);
    console.log("instanceof Error", e instanceof Error);
  }
  console.log("done");
}

main();
