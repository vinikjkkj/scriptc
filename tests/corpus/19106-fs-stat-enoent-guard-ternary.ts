import * as fs from "node:fs";
fs.stat("./statenoent-missing-19106", (err, s) => {
  const size = s === undefined ? "none" : String(s.size);
  console.log("guard", size, err ? err.code : "-");
});
