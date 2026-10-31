import * as fs from "node:fs";
fs.stat("./statenoent-missing-19110", (err, s) => {
  try {
    console.log("mtime", s.mtimeMs);
  } catch (e) {
    console.log("caught", (e as Error).message);
  }
  try {
    console.log("isFile", s.isFile());
  } catch (e) {
    console.log("caught", (e as Error).message);
  }
});
