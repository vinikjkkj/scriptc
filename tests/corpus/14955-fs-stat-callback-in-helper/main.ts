// The Stats object crosses a helper function: a typed parameter receives
// the callback's stats and reads the file type from it.
import { chmodSync, existsSync, mkdirSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import * as fs from "node:fs";

function tail(path: string): string {
  let i = path.length - 1;
  while (i >= 0 && path.charAt(i) !== "/" && path.charAt(i) !== "\\") {
    i = i - 1;
  }
  return path.slice(i + 1);
}

function kind(st: fs.Stats): string {
  if (st.isFile()) return "file";
  if (st.isDirectory()) return "dir";
  return "other";
}
// Each call starts after the previous callback, so the order is the program's:
// Node's stat calls run on a thread pool and would otherwise finish in any order.
function describe(label: string, path: string, next: () => void): void {
  fs.stat(path, function (err, st) {
    if (err) {
      console.log(label, "error", err.code);
    } else {
      console.log(label, kind(st));
    }
    next();
  });
}
const f = "tmp-14955-" + tail(process.argv[1]) + ".txt";
if (existsSync(f)) unlinkSync(f);
writeFileSync(f, "data");
describe("file", f, () => {
  describe("cwd", ".", () => {
    describe("ghost", "tmp-14955-does-not-exist", () => {
      unlinkSync(f);
    });
  });
});
