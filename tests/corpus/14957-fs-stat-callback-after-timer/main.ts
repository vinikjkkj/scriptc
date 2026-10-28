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

// The timer is armed inside the stat callback, so the two never race.
const t = "tmp-14957-" + tail(process.argv[1]) + ".txt";
if (existsSync(t)) unlinkSync(t);
writeFileSync(t, "z");
fs.stat(t, function (err, st) {
  console.log("stat fired", err === null, st.isFile());
  unlinkSync(t);
  setTimeout(() => console.log("timer fired"), 0);
});
console.log("sync tail");
