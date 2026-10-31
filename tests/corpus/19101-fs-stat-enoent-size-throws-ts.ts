// A member read on the undefined stats throws Node's TypeError, catchable.
import * as fs from "node:fs";
fs.stat("./statenoent-missing-19101", (err, s) => {
  console.log("code", err ? err.code : "none");
  try {
    console.log("size", s.size);
  } catch (e) {
    console.log("caught", (e as Error).constructor.name, (e as Error).message);
  }
});
console.log("sync end");
