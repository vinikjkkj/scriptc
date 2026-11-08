// fs.read on a descriptor that is not open: Node's wrapper still calls back (err, 0, buffer), so the zero and the buffer are there on a failure;
// a successful read hands the same buffer back, read through a Buffer-typed chain off the (checked-dynamic) callback parameter.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fsice-"));
const present = path.join(dir, "present.txt");
fs.writeFileSync(present, "hello world");
const bad = Buffer.alloc(5);
fs.read(9999, bad, 0, 5, 0, (err, bytesRead, buffer) => {
  console.log(err ? err.code : "ok", bytesRead, buffer, buffer.length);
  const fd = fs.openSync(present, "r");
  const good = Buffer.alloc(5);
  fs.read(fd, good, 0, 5, 0, (err2, n, buf2) => {
    console.log(err2, n, buf2.toString(), buf2.subarray(1, 3).toString(), buf2.subarray(0, 2).length, buf2.subarray(1)[0]);
    fs.closeSync(fd);
    fs.unlinkSync(present);
    fs.rmdirSync(dir);
  });
});
