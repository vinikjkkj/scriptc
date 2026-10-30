// fs.stat on a directory path spelled through "." and a trailing separator:
// the callback reports the directory's own type and a zero-size-or-more size.
// The "./" stat is issued from inside the "." callback so the two results
// print in a fixed order; concurrent fs.stat completions are not ordered.
import * as fs from "node:fs";

fs.stat(".", function (err, st) {
  console.log("dot err:", err === null);
  console.log("dot dir:", st.isDirectory(), "file:", st.isFile());
  fs.stat("./", function (err2, st2) {
    console.log("slash err:", err2 === null);
    console.log("slash dir:", st2.isDirectory());
  });
});
console.log("queued");
