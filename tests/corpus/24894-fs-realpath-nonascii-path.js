// realpathSync over a non-ASCII path (accents, CJK, an astral emoji): the existence check Node makes goes through the wide Windows calls, so an existing
// path resolves and a missing one names the path as the program spelled it, whatever the ANSI code page is.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fsw-"));
const file = path.join(dir, "café-日本語-😀.txt");
fs.writeFileSync(file, "x");
console.log(path.basename(fs.realpathSync(file)), path.basename(fs.realpathSync(path.join(dir, "..", path.basename(dir), "café-日本語-😀.txt"))));
try {
  fs.realpathSync(path.join(dir, "absent-é"));
} catch (e) {
  console.log(e.code, e.syscall, e.message.replace(dir, "<dir>").replace(/\\/g, "/"));
}
fs.rmSync(dir, { recursive: true });
