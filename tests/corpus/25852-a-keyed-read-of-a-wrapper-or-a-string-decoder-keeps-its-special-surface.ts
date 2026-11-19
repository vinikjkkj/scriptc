// A keyed [[Get]] over a dyn object takes a fast path when the object has no wrapper slot and no decoder name; wrappers, decoders, large
// tables carrying a slot, and plain objects must all still answer like Node.
import { StringDecoder } from "node:string_decoder";
let bad = 0;
let checks = 0;
function ck(ok: boolean, what: string): void {
  checks++;
  if (!ok) {
    bad++;
    console.log("BAD " + what);
  }
}
const pick = (i: number): any => (i % 3 === 0 ? Object("héllo wörld") : i % 3 === 1 ? { length: 99, 0: "z" } : Object("abc"));
for (let i = 0; i < 6; i++) {
  const o: any = pick(i);
  const kind = i % 3;
  ck(kind === 1 ? o.length === 99 : o.length === (kind === 0 ? 11 : 3), "length " + i);
  ck(kind === 1 ? o[0] === "z" : o[0] === (kind === 0 ? "h" : "a"), "index " + i);
  ck(kind === 1 ? o[2] === undefined : o[2] === (kind === 0 ? "l" : "c"), "index2 " + i);
  console.log(i, o.length, o[0], String(o.length));
}
const dec: any = new StringDecoder("utf8");
const parts: string[] = [];
parts.push(String(dec.lastNeed));
dec.write(Buffer.from([0xe2, 0x82]));
parts.push(String(dec.lastNeed), String(dec.lastTotal), String(dec.lastChar.length));
parts.push(dec.end(Buffer.from([0xac])));
console.log(parts.join("|"));
const big: any = {};
for (let i = 0; i < 40; i++) big["k" + i] = i;
const w: any = Object("xy");
w.extra = 1;
for (let i = 0; i < 40; i++) w["p" + i] = i;
ck(w.length === 2 && w[1] === "y" && w.extra === 1 && w.p39 === 39 && big.k39 === 39 && big.length === undefined, "wrapper with many own members");
console.log("checks", checks, "bad", bad);
