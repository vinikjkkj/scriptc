import * as fs from "node:fs";
fs.stat("./statenoent-missing-19111", (err, s) => {
  console.log("err", err !== null);
  try {
    console.log("dir", s.isDirectory());
  } catch (e) {
    console.log("caught", (e as Error).message);
  }
});
