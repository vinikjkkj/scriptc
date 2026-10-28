// The pgpass check shape end to end: stat the file, warn on stderr when
// it is group- or world-accessible, and answer from the callback.
import { chmodSync, existsSync, mkdirSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import * as fs from "node:fs";

function tail(path: string): string {
  let i = path.length - 1;
  while (i >= 0 && path.charAt(i) !== "/" && path.charAt(i) !== "\\") {
    i = i - 1;
  }
  return path.slice(i + 1);
}

const p = "tmp-14966-" + tail(process.argv[1]) + ".txt";
if (existsSync(p)) unlinkSync(p);
writeFileSync(p, "secret");
chmodSync(p, 0o644);
const warnStream = process.stderr;
fs.stat(p, function (err, st) {
  if (err) {
    console.log("missing");
    return;
  }
  if (st.mode & 0o077) {
    warnStream.write("WARNING: password file has group or world access\n");
    console.log("ignored");
  } else {
    console.log("used");
  }
  unlinkSync(p);
});
