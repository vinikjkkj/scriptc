// Many expandos on one instance: every key lands in JS's own-key order, the
// listings and JSON agree on the count, and a late overwrite keeps its slot.
class Config {
  host: string;
  constructor(o: { host: string }) { this.host = o.host; }
}
function keysOf(o: unknown): string[] { return Object.keys(o as object); }
const cfg = new Config({ host: "m" });
const a: any = cfg;
for (let i = 0; i < 40; i++) a["k" + i] = i * 2;
const ks = keysOf(a);
console.log("count", ks.length, ks[0], ks[1], ks[40]);
console.log("last", a.k39, a.k0);
a.k3 = "over";
const ks2 = keysOf(a);
console.log("slot", ks2[4], ks2[3], ks2.length);
console.log("json-len", JSON.stringify(a).length);
