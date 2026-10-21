const fs = require("fs");
const { Readable } = require("stream");
const tmp = require("os").tmpdir() + "/scr8333-" + process.pid;
fs.writeFileSync(tmp, "hello");
fs.readFile(tmp, (err, data) => {
  console.log(err, Buffer.isBuffer(data), data.toString(), data.toString("hex"), data.length);
  fs.unlinkSync(tmp);
});
const r = Readable.from([Buffer.from("ab"), Buffer.from("cd")]);
const got = [];
r.on("data", (c) => got.push(c));
r.on("end", () => console.log("end", Buffer.isBuffer(got[0]), Buffer.concat(got).toString(), Buffer.concat(got, 3).toString(), Buffer.concat(got, 6).length));
const chunks = [];
function collect(c) { chunks.push(c); return chunks.length; }
console.log(collect(Buffer.from("x")), collect(Buffer.from("yz")), Buffer.concat(chunks).toString(), Buffer.concat(chunks, 2).toString("hex"));
function kind(x) { return Buffer.isBuffer(x) ? "buffer" : typeof x; }
console.log(kind(Buffer.from("a")), kind(new Uint8Array(1)), kind("s"), kind(5), kind(null), kind(undefined), kind({}), kind([1]), kind(new DataView(new ArrayBuffer(1))));
function cc(l, n) { try { return Buffer.concat(l, n).length; } catch (e) { return e.code + ": " + e.message; } }
console.log(cc([]), cc([Buffer.alloc(2)], 5), cc("x"), cc([Buffer.alloc(1), "s"]), cc([Buffer.alloc(1), 7]), cc([Buffer.alloc(1)], -1), cc(null));
