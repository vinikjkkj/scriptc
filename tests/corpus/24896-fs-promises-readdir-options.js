// fs.promises.readdir(path, options): withFileTypes (Dirent rows), recursive, encoding (utf8 names, buffer names), an option value Node refuses, and a
// missing directory rejecting with ENOENT/scandir; the listing is the same one readdirSync and the callback form give for each option shape.
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fsw-"));
for (const n of ["b.txt", "A.txt", "café.txt", "日本語.txt"]) fs.writeFileSync(path.join(dir, n), n);
fs.mkdirSync(path.join(dir, "sub"));
fs.writeFileSync(path.join(dir, "sub", "deep-😀.txt"), "x");
const show = (names) => [...names].map((n) => (typeof n === "string" ? n : n.toString("utf8"))).sort().join(" ");
async function main() {
  const rows = await fsp.readdir(dir, { withFileTypes: true });
  console.log(show(rows.map((e) => e.name + (e.isDirectory() ? "/" : ""))), rows.length);
  console.log(show(await fsp.readdir(dir, { recursive: true })));
  console.log(show(await fsp.readdir(dir, { encoding: "utf8" })));
  const bufs = await fsp.readdir(dir, { encoding: "buffer" });
  console.log(Buffer.isBuffer(bufs[0]), show(bufs));
  const deep = await fsp.readdir(dir, { recursive: true, withFileTypes: true });
  console.log(show(deep.map((e) => e.name)));
  try {
    await fsp.readdir(path.join(dir, "missing-é"), { withFileTypes: true });
  } catch (e) {
    console.log(e.code, e.syscall, e.message.split(dir).join("<dir>").replace(/\\/g, "/"));
  }
  fs.rmSync(dir, { recursive: true });
}
main();
