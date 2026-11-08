// mkdir (plain and recursive), mkdtemp with a non-ASCII prefix, rename, unlink, rmdir, rm -r, process.chdir/process.cwd and path.resolve over non-ASCII
// names (accents, CJK, an astral emoji): Node converts each UTF-8 path to UTF-16 for the wide Windows calls, whatever the ANSI code page is.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const base = fs.mkdtempSync(path.join(os.tmpdir(), "fsw-"));
const tmpd = fs.mkdtempSync(path.join(base, "tmp-日本-"));
console.log(path.basename(tmpd).startsWith("tmp-日本-"), path.basename(tmpd).length, fs.statSync(tmpd).isDirectory());
const deep = path.join(base, "ünï", "日本", "😀");
fs.mkdirSync(deep, { recursive: true });
console.log(fs.existsSync(deep), fs.readdirSync(path.join(base, "ünï")).join(","));
fs.mkdirSync(path.join(base, "café"));
fs.writeFileSync(path.join(base, "café", "a.txt"), "a");
fs.renameSync(path.join(base, "café", "a.txt"), path.join(base, "café", "日本語.txt"));
console.log(fs.readdirSync(path.join(base, "café")).join(","), fs.readFileSync(path.join(base, "café", "日本語.txt"), "utf8"));
fs.renameSync(path.join(base, "café"), path.join(base, "naïve"));
console.log(fs.existsSync(path.join(base, "café")), fs.existsSync(path.join(base, "naïve", "日本語.txt")));
fs.unlinkSync(path.join(base, "naïve", "日本語.txt"));
fs.rmdirSync(path.join(base, "naïve"));
console.log(fs.existsSync(path.join(base, "naïve")));
const cwd0 = process.cwd();
process.chdir(deep);
console.log(path.basename(process.cwd()), path.basename(path.resolve(".")), path.basename(path.resolve("..")));
process.chdir(cwd0);
for (const bad of ["absent-é", "日本-absent/x"]) {
  try {
    fs.mkdirSync(path.join(base, bad, "y"));
  } catch (e) {
    console.log(e.code, e.syscall, e.message.replace(base, "<base>").replace(/\\/g, "/"));
  }
  try {
    fs.unlinkSync(path.join(base, bad));
  } catch (e) {
    console.log(e.code, e.syscall, e.message.replace(base, "<base>").replace(/\\/g, "/"));
  }
}
fs.rmSync(base, { recursive: true });
console.log(fs.existsSync(base));
