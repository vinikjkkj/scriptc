const fs = require("fs");
const row = (label, e) => console.log(label, e.message, "|", e.code, e.errno, e.syscall, e.path, e.dest, JSON.stringify(e), Object.keys(e).join(","));
const nope = "/nonexistent-scr8343/x";
const tries = [
  { name: "readFileSync", fn: () => fs.readFileSync(nope) },
  { name: "openSync", fn: () => fs.openSync(nope, "r") },
  { name: "readdirSync", fn: () => fs.readdirSync(nope) },
  { name: "unlinkSync", fn: () => fs.unlinkSync(nope) },
  { name: "statSync", fn: () => fs.statSync(nope) },
  { name: "mkdirSync", fn: () => fs.mkdirSync(nope + "/a/b") },
  { name: "copyFileSync", fn: () => fs.copyFileSync(nope, nope + "2") },
  { name: "writeFileSync", fn: () => fs.writeFileSync(nope, "x") },
  { name: "readSyncBadFd", fn: () => fs.readSync(9999, Buffer.alloc(1), 0, 1) },
  { name: "closeSyncBadFd", fn: () => fs.closeSync(9999) },
];
for (const t of tries) {
  try { t.fn(); console.log(t.name, "no throw"); } catch (e) { row(t.name, e); }
}
fs.readFile(nope, (e) => { row("readFile cb", e); });
