// fs.readFile with an unannotated (contextually typed) callback: `data` is a checked-dynamic value, and a Buffer-typed call off it
// (subarray, slice) used to crash the compiler (bytesIntrinsic on a dyn receiver) when a member, an element or a length was read from the
// result. Success and failure paths, string data, and a member use on the undefined data of a failure.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fsice-"));
const present = path.join(dir, "present.txt");
const missing = path.join(dir, "missing.txt");
fs.writeFileSync(present, "hello world");
fs.readFile(present, (err, data) => {
  if (err) throw err;
  console.log(data.length, data.toString(), data.toString("utf8"), data[0]);
  console.log(data.subarray(1, 3).toString(), data.subarray(0, 2).length, data.subarray(1)[0], data.slice(1).toString());
  console.log(data.subarray(2).readUInt8(0), data.subarray(1, 4).toString("hex"), Buffer.concat([data, data]).length);
  console.log(data, data.subarray(0, 3));
  fs.readFile(present, "utf8", (err2, text) => {
    console.log(err2, typeof text, text.length, text.toUpperCase());
    fs.readFile(missing, (err3, data3) => {
      console.log(err3 ? err3.code : "ok", data3, typeof data3);
      try {
        console.log(data3.subarray(1, 3).toString());
      } catch (e) {
        console.log((e as Error).constructor.name, (e as Error).message);
      }
      fs.readFile(missing, "utf8", (err4, text4) => {
        console.log(err4 ? err4.code : "ok", text4);
        fs.unlinkSync(present);
        fs.rmdirSync(dir);
      });
    });
  });
});
