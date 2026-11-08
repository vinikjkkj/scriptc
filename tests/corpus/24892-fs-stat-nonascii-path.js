// stat, lstat, existsSync, accessSync and chmodSync on a non-ASCII path (accents, CJK, an astral emoji): Node converts the UTF-8 path to UTF-16 for the
// wide Windows calls, so the file is found and a failure names the path as the program spelled it, whatever the ANSI code page is.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fsw-"));
const file = path.join(dir, "café-日本語-😀.txt");
const sub = path.join(dir, "ünï-dir");
fs.writeFileSync(file, "hello");
fs.mkdirSync(sub);
console.log(fs.existsSync(file), fs.existsSync(sub), fs.existsSync(path.join(dir, "absent-é")));
const st = fs.statSync(file);
console.log(st.isFile(), st.isDirectory(), st.size);
console.log(fs.statSync(sub).isDirectory(), fs.lstatSync(file).isFile(), fs.lstatSync(sub).isDirectory());
fs.accessSync(file);
fs.chmodSync(file, 0o644);
for (const bad of ["absent-é", "日本-absent/x"]) {
  try {
    fs.statSync(path.join(dir, bad));
  } catch (e) {
    console.log(e.code, e.syscall, e.message.replace(dir, "<dir>"));
  }
  try {
    fs.accessSync(path.join(dir, bad));
  } catch (e) {
    console.log(e.code, e.syscall, e.message.replace(dir, "<dir>"));
  }
}
fs.rmSync(dir, { recursive: true });
