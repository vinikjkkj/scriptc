import * as fs from "node:fs";
fs.stat("./statenoent-missing-19114", (err, s) => {
  console.log(err ? err.message.split(",")[0] : "none", s === undefined);
});
