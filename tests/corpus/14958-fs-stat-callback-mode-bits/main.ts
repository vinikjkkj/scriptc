// The fs.Stats surface, statically and through an `unknown` box: every numeric
// field, the time members as Dates, the is* predicates (also as method values
// through the box), a field write, and an expando on the box. The file is
// written and chmod'ed by the program, so the values are its own.
import { chmodSync, existsSync, unlinkSync, writeFileSync } from "node:fs";
import * as fs from "node:fs";

function tail(path: string): string {
  let i = path.length - 1;
  while (i >= 0 && path.charAt(i) !== "/" && path.charAt(i) !== "\\") {
    i = i - 1;
  }
  return path.slice(i + 1);
}

const m = "tmp-14958-" + tail(process.argv[1]) + ".txt";
if (existsSync(m)) unlinkSync(m);
writeFileSync(m, "mode");
chmodSync(m, 0o640);
fs.stat(m, (err, st) => {
  if (err) {
    console.log("err", err.code);
    return;
  }
  console.log("mode", (st.mode & 0o777).toString(8), "nlink", st.nlink, "size", st.size);
  console.log("ids", st.uid, st.gid, st.rdev);
  console.log("blocks", st.blocks >= 0, typeof st.atimeMs, typeof st.ctimeMs, typeof st.birthtimeMs);
  console.log("dates", typeof st.atime.getTime(), typeof st.mtime.getTime(), typeof st.birthtime.getTime());
  console.log("types", st.isFile(), st.isDirectory(), st.isBlockDevice(), st.isCharacterDevice(), st.isSymbolicLink(), st.isFIFO(), st.isSocket());
  const u: unknown = st;
  const d: any = u;
  console.log("box types", d.isFile(), d.isDirectory(), d.isBlockDevice(), d.isSocket());
  const f = d.isFile;
  console.log("value call", f.call(d), typeof f);
  console.log("check", d._checkModeProperty(0o100000), d._checkModeProperty(0o40000));
  d.size = 77;
  console.log("after write", d.size, d.nope === undefined);
  d.extra = "x";
  console.log("expando", d.extra);
  unlinkSync(m);
});
