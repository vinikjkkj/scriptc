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

// Chained: the second stat starts after the first callback, so the order is fixed.
const a = "tmp-14954-" + tail(process.argv[1]) + "-a.txt";
const b = "tmp-14954-" + tail(process.argv[1]) + "-b-missing.txt";
if (existsSync(a)) unlinkSync(a);
writeFileSync(a, "x");
function report(label: string, path: string, next: () => void): void {
  fs.stat(path, function (err, st) {
    if (err) {
      console.log(label, "failed:", err.code);
    } else {
      console.log(label, "ok:", st.size);
      unlinkSync(path);
    }
    next();
  });
}
report("first", a, () => {
  report("second", b, () => {
    console.log("both done");
  });
});
