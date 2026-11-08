// Node lists a directory SORTED (libuv's scandir sorts by byte order): readdirSync, readdirSync withFileTypes and fs.promises.readdir all answer
// the same order whatever order the files were created in or the filesystem hands them back (case, digits, dots, multi-byte names).
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fsrd-"));
for (const name of ["zeta.txt", "alpha.txt", "Beta.txt", "10.txt", "9.txt", ".hidden", "mid.log", "é.txt", "a b.txt", "_under", "~tilde"]) {
  fs.writeFileSync(path.join(dir, name), name);
}
fs.mkdirSync(path.join(dir, "sub"));
console.log(fs.readdirSync(dir));
const rows = fs.readdirSync(dir, { withFileTypes: true });
console.log(rows.map((e) => e.name + (e.isDirectory() ? "/" : "")).join(" "));
fsp.readdir(dir).then((names) => {
  console.log(names.join(" "));
  fs.rmSync(dir, { recursive: true });
});
