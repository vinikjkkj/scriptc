// The listing surfaces over an instance that carries expandos: Object.keys,
// for-in, Object.values, JSON.stringify, in declaration order and then the
// expandos in JS's own-key order. The receiver is typed unknown so the listing
// lowers over the checked-dynamic tree.
class Config {
  host: string;
  port: number;
  constructor(o: { host: string }) { this.host = o.host; this.port = 3306; }
  url(): string { return this.host + ":" + this.port; }
}
function keysOf(o: unknown): string { return Object.keys(o as object).join(","); }
function forInOf(o: unknown): string { let s = ""; for (const k in o as object) s += k + ";"; return s; }
function valuesOf(o: unknown): string { return JSON.stringify(Object.values(o as object)); }
const cfg = new Config({ host: "h" });
const a: any = cfg;
a.pool = "P";
a.extra = 7;
a.flag = true;
console.log("keys", keysOf(a));
console.log("forin", forInOf(a));
console.log("values", valuesOf(a));
console.log("json", JSON.stringify(a));
delete a.extra;
console.log("after delete", keysOf(a), JSON.stringify(a));
a.extra = "back";
console.log("re-added", keysOf(a), JSON.stringify(a));
