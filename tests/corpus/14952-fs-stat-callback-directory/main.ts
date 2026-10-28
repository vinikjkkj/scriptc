// fs.stat callback on a directory: isDirectory answers true, isFile false,
// and the directory bit of `mode` is set.
import { chmodSync, existsSync, mkdirSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import * as fs from "node:fs";

function tail(path: string): string {
  let i = path.length - 1;
  while (i >= 0 && path.charAt(i) !== "/" && path.charAt(i) !== "\\") {
    i = i - 1;
  }
  return path.slice(i + 1);
}

const dir = "tmp-14952-" + tail(process.argv[1]) + "-d";
if (existsSync(dir)) rmdirSync(dir);
mkdirSync(dir);
fs.stat(dir, function (err, st) {
  console.log("err:", err);
  console.log("dir:", st.isDirectory(), "file:", st.isFile());
  console.log("dir bit:", (st.mode & 0o170000) === 0o040000);
  rmdirSync(dir);
  console.log("removed:", !existsSync(dir));
});
