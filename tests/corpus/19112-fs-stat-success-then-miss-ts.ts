// Sequential callbacks: the second stat starts only after the first answers.
import * as fs from "node:fs";
fs.stat("/", (err1, s1) => {
  console.log("first", err1 === null, s1.isDirectory());
  fs.stat("./statenoent-missing-19112", (err2, s2) => {
    console.log("second", err2 ? err2.code : "none", s2 === undefined);
    try {
      console.log("size", s2.size);
    } catch (e) {
      console.log("caught", (e as Error).message);
    }
  });
});
