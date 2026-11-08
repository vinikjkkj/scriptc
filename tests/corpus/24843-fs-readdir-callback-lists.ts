// fs.readdir with a callback lists like Node: names sorted by byte order, Dirent rows, a failure calls back with the error alone (listing slot undefined).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fsrd-"));
for (const name of ["zeta.txt", "alpha.txt", "Beta.txt", "10.txt"]) fs.writeFileSync(path.join(dir, name), name);
fs.mkdirSync(path.join(dir, "sub"));
fs.readdir(dir, (err, names) => {
  console.log(err, names);
  fs.readdir(dir, { withFileTypes: true }, (err2, rows) => {
    console.log(err2, rows.map((e) => e.name + (e.isDirectory() ? "/" : "")).join(" "));
    fs.readdir(path.join(dir, "missing"), (err3, none) => {
      console.log(err3 !== null, (err3 as NodeJS.ErrnoException).code, none === undefined);
      if (none) console.log("unreachable", none.length);
      try {
        console.log(none!.length);
      } catch (e) {
        console.log((e as Error).constructor.name);
      }
      fs.rmSync(dir, { recursive: true });
    });
  });
});
