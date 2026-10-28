// fs.stat on a character device: the callback's Stats answers the type bits
// (isCharacterDevice), and the same probe on a missing path answers ENOENT on
// platforms without the device. Both sides of the differential see the same host.
import * as fs from "node:fs";

fs.stat("/dev/null", function (err, st) {
  if (err) {
    console.log("no device:", err.code);
    return;
  }
  console.log("char:", st.isCharacterDevice(), "file:", st.isFile(), "dir:", st.isDirectory());
  console.log("type bits:", (st.mode & 0o170000).toString(8));
});
