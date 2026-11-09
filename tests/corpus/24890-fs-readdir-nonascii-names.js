// A directory holding non-ASCII names (accents, CJK, an astral emoji, a lone surrogate-free mix) lists back byte-exact through every readdir form: Node
// enumerates with the wide Windows APIs and hands UTF-8 to the program, so the names must survive the round trip whatever the ANSI code page is.
// The order printed is the OS order (sorted on POSIX, the filesystem's own on Windows); both sides of the comparison read the same directory.
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fsw-"));
const files = ["café.txt", "naïve.txt", "日本語.txt", "😀.txt", "Ünïcödé.log", "a b.txt", "ñandú"];
for (const name of files) fs.writeFileSync(path.join(dir, name), name);
fs.mkdirSync(path.join(dir, "日本"));
fs.writeFileSync(path.join(dir, "日本", "子.txt"), "x");
const show = (names) => [...names].sort().map((n) => `${n}:${[...n].length}`).join(" ");
console.log(show(fs.readdirSync(dir)));
console.log(fs.readdirSync(dir).length, fs.readdirSync(dir).includes("😀.txt"), fs.readdirSync(dir).includes("日本語.txt"));
const rows = fs.readdirSync(dir, { withFileTypes: true });
console.log(show(rows.map((e) => e.name + (e.isDirectory() ? "/" : ""))));
console.log(show(fs.readdirSync(dir, { recursive: true })));
// a recursive Dirent row names its parent with the platform separator (path.join: a backslash on Windows), the base spelled as given
console.log(fs.readdirSync(dir, { recursive: true, withFileTypes: true }).map((e) => e.parentPath.split(dir).join("<dir>") + "|" + e.name).sort().join(" "));
fs.readdir(dir, (err, names) => {
  console.log(err, show(names));
  fs.readdir(dir, { withFileTypes: true }, (err2, drows) => {
    console.log(err2, show(drows.map((e) => e.name + (e.isFile() ? "" : "/"))));
    fsp.readdir(dir).then((pnames) => {
      console.log(show(pnames));
      fs.rmSync(dir, { recursive: true });
    });
  });
});
