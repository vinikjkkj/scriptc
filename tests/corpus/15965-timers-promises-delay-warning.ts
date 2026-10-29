// node:timers/promises setTimeout with a delay outside [1, 2^31-1]: Node
// emits a TimeoutNaNWarning for NaN and a TimeoutNegativeWarning for a
// negative delay, then coerces the delay to 1ms. 0 and fractions below 1 are
// silent. The warning listener prints name and message.
import { setTimeout as sleep } from "node:timers/promises";

process.on("warning", (w: Error) => {
  console.log("warning", w.name, JSON.stringify(w.message));
});

async function main(): Promise<void> {
  console.log("before");
  const a = await sleep(NaN, "nan");
  console.log("a", a);
  const b = await sleep(-5, "neg");
  console.log("b", b);
  const c = await sleep(0, "zero");
  console.log("c", c);
  console.log("done");
}

main();
