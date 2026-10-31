// A present path: the error is null and the stats answer every member.
import * as fs from "node:fs";
fs.stat("/", (err, s) => {
  console.log("err", err === null, s === undefined);
  console.log("dir", s.isDirectory(), s.isFile(), s.size >= 0, typeof s.mtimeMs);
});
