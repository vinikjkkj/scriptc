import * as fs from "node:fs";
fs.stat("./statenoent-missing-19118", (err, s) => {
  console.log(typeof s, s === undefined ? "undef" : "value", err ? "err" : "ok");
});
