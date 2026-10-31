import * as fs from "node:fs";
fs.stat("./statenoent-missing-19105", (err, s) => {
  if (err) {
    console.log("code", err.code, "syscall", err.syscall, "errno", err.errno);
    console.log("path", err.path);
  }
  console.log("stats", typeof s, s === undefined ? "absent" : "present");
});
