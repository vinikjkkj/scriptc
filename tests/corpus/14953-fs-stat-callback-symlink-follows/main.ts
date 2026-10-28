// fs.stat on a directory path spelled through "." and a trailing separator:
// the callback reports the directory's own type and a zero-size-or-more size.
import * as fs from "node:fs";

fs.stat(".", function (err, st) {
  console.log("dot err:", err === null);
  console.log("dot dir:", st.isDirectory(), "file:", st.isFile());
});
fs.stat("./", function (err, st) {
  console.log("slash err:", err === null);
  console.log("slash dir:", st.isDirectory());
});
console.log("queued");
