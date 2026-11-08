// renameSync, fs.rename and fs.promises.rename: onto an absent destination, onto an existing FILE (replaced, as libuv's MoveFileExW with
// MOVEFILE_REPLACE_EXISTING does on Windows and rename(2) does elsewhere), a non-ASCII name (accents, CJK, an astral emoji), and the errors
// (ENOENT for a missing source or destination directory, the code and message shape Node prints with both paths).
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fsw-"));
const p = (n) => path.join(dir, n);
const clean = (m) => m.split(dir).join("<dir>").replace(/\\/g, "/");
fs.writeFileSync(p("a.txt"), "A");
fs.renameSync(p("a.txt"), p("b.txt"));
console.log(fs.existsSync(p("a.txt")), fs.readFileSync(p("b.txt"), "utf8"));
fs.writeFileSync(p("c.txt"), "C");
fs.renameSync(p("c.txt"), p("b.txt"));
console.log(fs.existsSync(p("c.txt")), fs.readFileSync(p("b.txt"), "utf8"));
fs.writeFileSync(p("café.txt"), "é");
fs.renameSync(p("café.txt"), p("日本語-😀.txt"));
console.log(fs.existsSync(p("café.txt")), fs.readFileSync(p("日本語-😀.txt"), "utf8"));
fs.mkdirSync(p("ünï"));
fs.renameSync(p("ünï"), p("naïve-日本"));
console.log(fs.existsSync(p("ünï")), fs.statSync(p("naïve-日本")).isDirectory());
fs.mkdirSync(p("dir-é"));
fs.writeFileSync(p("file-日本.txt"), "F");
fs.writeFileSync(p("file2.txt"), "F2");
fs.mkdirSync(p("full-dir"));
fs.writeFileSync(path.join(p("full-dir"), "x"), "x");
fs.mkdirSync(p("empty-dir"));
// the code differs by platform on purpose (Linux ENOTDIR/EISDIR/ENOTEMPTY, Windows EPERM/EPERM/EPERM or ENOTEMPTY): the oracle is Node on the same OS
for (const [from, to] of [["dir-é", "file-日本.txt"], ["file2.txt", "empty-dir"], ["empty-dir", "full-dir"], ["absent-é", "x"], ["b.txt", "no-dir/日本/x"]]) {
  try {
    fs.renameSync(p(from), p(to));
  } catch (e) {
    console.log(e.code, e.syscall, clean(e.message));
  }
}
fs.rename(p("b.txt"), p("d.txt"), (err) => {
  console.log(err, fs.existsSync(p("b.txt")), fs.readFileSync(p("d.txt"), "utf8"));
  fs.rename(p("absent-ü"), p("y"), (err2) => {
    console.log(err2.code, err2.syscall, clean(err2.message));
    after();
  });
});
async function after() {
  await fsp.rename(p("d.txt"), p("e-😀.txt"));
  console.log(fs.existsSync(p("d.txt")), fs.readFileSync(p("e-😀.txt"), "utf8"));
  try {
    await fsp.rename(p("absent-ö"), p("z"));
  } catch (e) {
    console.log(e.code, e.syscall, clean(e.message));
  }
  fs.rmSync(dir, { recursive: true });
}
