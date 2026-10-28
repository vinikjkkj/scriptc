// fs.stat(path, cb) on a regular file: the callback's Stats answers
// isFile/isDirectory/size and the permission bits read off `mode`.
// Node's callback order: the sync code after the call runs first.
import { chmodSync, existsSync, unlinkSync, writeFileSync } from "node:fs";
import * as fs from "node:fs";

function tail(path: string): string {
  let i = path.length - 1;
  while (i >= 0 && path.charAt(i) !== "/" && path.charAt(i) !== "\\") {
    i = i - 1;
  }
  return path.slice(i + 1);
}

const name = "tmp-14950-" + tail(process.argv[1]) + ".txt";
if (existsSync(name)) unlinkSync(name);
writeFileSync(name, "hello stat\n");
chmodSync(name, 0o640);
fs.stat(name, function (err, st) {
  console.log("cb err null:", err === null);
  console.log("isFile:", st.isFile(), "isDirectory:", st.isDirectory());
  console.log("size:", st.size);
  console.log("perm:", (st.mode & 0o777).toString(8));
  console.log("regular:", (st.mode & 0o170000) === 0o100000);
  // The creation time is not after the last write (Windows reads it from the
  // file handle; a host with no creation time reports 0). Relations only.
  console.log("birth<=mtime:", st.birthtimeMs <= st.mtimeMs, st.birthtime.getTime() <= st.mtime.getTime());
  unlinkSync(name);
});
console.log("sync after call");
