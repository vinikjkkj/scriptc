// Opening a file by a non-ASCII path (accents, CJK, an astral emoji): writeFileSync, appendFileSync, readFileSync (string and Buffer), copyFileSync,
// createReadStream/createWriteStream and the promise forms all go through the wide Windows open calls in Node, whatever the ANSI code page is.
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fsw-"));
const names = ["café.txt", "日本語.txt", "😀 emoji.txt", "Ünïcödé"];
for (const n of names) {
  const p = path.join(dir, n);
  fs.writeFileSync(p, "one:" + n);
  fs.appendFileSync(p, "|two");
  console.log(n, fs.readFileSync(p, "utf8"), fs.readFileSync(p).length, fs.existsSync(p));
}
const p0 = path.join(dir, "café.txt");
fs.copyFileSync(p0, path.join(dir, "copie 日本.txt"));
console.log(fs.readFileSync(path.join(dir, "copie 日本.txt"), "utf8"));
fs.writeFileSync(path.join(dir, "bytes-日本.bin"), Buffer.from([1, 2, 3, 250]));
console.log(fs.readFileSync(path.join(dir, "bytes-日本.bin")).toString("hex"));
const ws = fs.createWriteStream(path.join(dir, "stream-😀.txt"));
ws.end("streamed", () => {
  const rs = fs.createReadStream(path.join(dir, "stream-😀.txt"), { encoding: "utf8" });
  let got = "";
  rs.on("data", (c) => { got += c; });
  rs.on("end", () => {
    console.log(got);
    fsp.writeFile(path.join(dir, "promise-日本.txt"), "p").then(() => fsp.readFile(path.join(dir, "promise-日本.txt"), "utf8")).then((t) => {
      console.log(t);
      fs.rmSync(dir, { recursive: true });
    });
  });
});
