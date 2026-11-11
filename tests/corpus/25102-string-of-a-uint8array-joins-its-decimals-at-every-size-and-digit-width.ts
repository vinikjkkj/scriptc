// String(u8) is Array.prototype.join(","): one to three digits per element and a comma between. Every length class (0, 1, 2, a few, a few
// thousand) and every digit-width edge (0, 9, 10, 99, 100, 255) is checked through a typed value, through `any`, through a template and
// a concatenation, on a view over a larger buffer, and a Buffer (which is NOT joined: it decodes as utf8).
function edge(label: string, v: Uint8Array): void {
  const s = String(v);
  console.log(label, v.length, s.length, JSON.stringify(s.length <= 60 ? s : s.slice(0, 30) + "..." + s.slice(-30)));
}
edge("empty", new Uint8Array(0));
edge("one0", new Uint8Array([0]));
edge("one9", new Uint8Array([9]));
edge("one10", new Uint8Array([10]));
edge("one99", new Uint8Array([99]));
edge("one100", new Uint8Array([100]));
edge("one255", new Uint8Array([255]));
edge("pair", new Uint8Array([0, 255]));
edge("widths", new Uint8Array([0, 9, 10, 99, 100, 255, 1, 8, 11, 98, 101, 254]));
const ramp = new Uint8Array(1000);
for (let i = 0; i < ramp.length; i++) ramp[i] = (i * 37 + 11) & 255;
edge("ramp", ramp);
const big = new Uint8Array(70000);
for (let i = 0; i < big.length; i++) big[i] = (i * 131 + (i >> 8)) & 255;
edge("big", big);
let h = 0;
for (const t of String(big).split(",")) h = (h * 31 + Number(t)) >>> 0;
console.log("bighash", h);
const bigAny: any = big;
const bs: string = String(bigAny);
console.log("bigany", bs.length, bs === String(big), bs.slice(0, 20));
const backing = new Uint8Array([200, 1, 2, 3, 250, 99]);
edge("view", backing.subarray(1, 5));
const anyv: any = new Uint8Array([7, 70, 170]);
console.log(String(anyv), `${anyv}`, "[" + anyv + "]", anyv.toString(), anyv + ";" + anyv);
const buf = Buffer.from("hi,there");
console.log(String(buf), `${buf}`, buf.toString());
const parts: string[] = [];
for (let n = 0; n < 40; n++) {
  const u = new Uint8Array(n);
  for (let i = 0; i < n; i++) u[i] = (i * 29 + n) & 255;
  parts.push(String(u));
}
console.log(parts.join("|").length, parts[39]);
