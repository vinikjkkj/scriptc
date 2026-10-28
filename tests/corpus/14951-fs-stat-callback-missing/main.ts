// fs.stat callback on a missing path: err is Node's ENOENT Error with
// code, errno (negative), syscall, path and message, and stats is absent.
import { chmodSync, existsSync, mkdirSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import * as fs from "node:fs";

function tail(path: string): string {
  let i = path.length - 1;
  while (i >= 0 && path.charAt(i) !== "/" && path.charAt(i) !== "\\") {
    i = i - 1;
  }
  return path.slice(i + 1);
}

const missing = "tmp-14951-" + tail(process.argv[1]) + "-nope.txt";
fs.stat(missing, function (err) {
  if (err === null) {
    console.log("unexpected success");
    return;
  }
  console.log("instanceof Error:", err instanceof Error);
  console.log("code:", err.code);
  console.log("errno:", err.errno);
  console.log("syscall:", err.syscall);
  console.log("path matches:", err.path === missing);
  console.log("message:", err.message === "ENOENT: no such file or directory, stat '" + missing + "'");
});
console.log("queued");
