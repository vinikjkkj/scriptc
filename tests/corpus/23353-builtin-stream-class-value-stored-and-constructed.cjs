const { Readable } = require("stream");
class Scan extends Readable {
  constructor(opt) { super(opt); this.n = 0; this.opt = opt; }
  _read() { if (this.n < 3) this.push("x" + this.n++); else this.push(null); }
}
const K = Scan;
const Holder = function () { this.ScanStream = K; };
const h = new Holder();
console.log(K.name, h.ScanStream === Scan, typeof h.ScanStream, h.ScanStream.name);
const t = new h.ScanStream({ encoding: "utf8" });
console.log(typeof t);
const u = new K({ encoding: "utf8" });
console.log(u instanceof K, u instanceof Readable, K.name);
u.on("data", (d) => console.log("data", d));
u.on("end", () => console.log("end"));
