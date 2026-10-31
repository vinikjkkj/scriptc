import * as fs from "node:fs";
fs.stat("/", (err, s) => {
  console.log("err", err === null, typeof s.size);
  console.log("isSymlink", s.isSymbolicLink(), s.isDirectory());
});
