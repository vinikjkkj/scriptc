// node:timers/promises setTimeout(delay, value) in a loop with reference
// payloads of several shapes (string, record, array, a JSON-parsed unknown).
// Each awaited value is read back, so a payload lost or double-freed in the
// promise machinery shows up as wrong output or a crash under the sanitizer.
import { setTimeout as sleep } from "node:timers/promises";

async function main(): Promise<void> {
  let total = 0;
  for (let i = 0; i < 40; i++) {
    const s = await sleep(0, `item-${i}`);
    const r = await sleep(0, { i, label: s });
    const a = await sleep(0, [i, i * 2]);
    total += r.i + a[1] + s.length;
  }
  console.log("total", total);
  const parsed: unknown = await sleep(1, JSON.parse('{"k":[1,"two"]}'));
  console.log("parsed", JSON.stringify(parsed));
  console.log("done");
}

main();
