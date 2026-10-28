// Two stat callbacks queued in order fire in the order they were issued.
import { chmodSync, existsSync, mkdirSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import * as fs from "node:fs";

function tail(path: string): string {
  let i = path.length - 1;
  while (i >= 0 && path.charAt(i) !== "/" && path.charAt(i) !== "\\") {
    i = i - 1;
  }
  return path.slice(i + 1);
}

// Chained: the second callback fires after the first, in issue order.
const x = "tmp-14956-" + tail(process.argv[1]) + "-x.txt";
if (existsSync(x)) unlinkSync(x);
writeFileSync(x, "1234");
let seen = 0;
fs.stat(x, function (err, st) {
  seen = seen + 1;
  console.log("first", seen, err === null, st.size);
  fs.stat("tmp-14956-absent", function (err2) {
    seen = seen + 1;
    console.log("second", seen, err2 === null);
    unlinkSync(x);
  });
});
console.log("queued two");
