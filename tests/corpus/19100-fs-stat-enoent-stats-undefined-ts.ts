// fs.stat on a missing path: the error is set and the stats argument is undefined.
import * as fs from "node:fs";
fs.stat("./statenoent-missing-19100", (err, s) => {
  console.log("code", err ? err.code : "none");
  console.log("undef", s === undefined, s == null, typeof s);
});
