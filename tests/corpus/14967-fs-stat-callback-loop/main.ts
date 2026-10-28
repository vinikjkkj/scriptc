// Two stat callbacks queued in order fire in the order they were issued.
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import * as fs from "node:fs";

function tail(path: string): string {
  let i = path.length - 1;
  while (i >= 0 && path.charAt(i) !== "/" && path.charAt(i) !== "\\") {
    i = i - 1;
  }
  return path.slice(i + 1);
}

// Each name's stat starts after the previous callback, so the entries print in order.
const names = ["tmp-14967-" + tail(process.argv[1]) + "-0.txt", "tmp-14967-" + tail(process.argv[1]) + "-1.txt"];
for (const n of names) {
  if (existsSync(n)) unlinkSync(n);
  writeFileSync(n, n);
}
function entry(i: number): void {
  if (i >= names.length) return;
  fs.stat(names[i]!, function (err, st) {
    console.log("entry", i, err === null, st.size === names[i]!.length);
    unlinkSync(names[i]!);
    entry(i + 1);
  });
}
entry(0);
console.log("queued", names.length);
