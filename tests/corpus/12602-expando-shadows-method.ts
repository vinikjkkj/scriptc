// An expando named like a prototype method shadows it: the read, `in`,
// hasOwnProperty and every listing answer the expando, not the method.
class Config {
  host: string;
  constructor(o: { host: string }) { this.host = o.host; }
  who(): string { return "method"; }
}
function keysOf(o: unknown): string { return Object.keys(o as object).join(","); }
function forInOf(o: unknown): string { let s = ""; for (const k in o as object) s += k + ";"; return s; }
const cfg = new Config({ host: "h" });
const a: any = cfg;
console.log("before", a.who(), "who" in a, a.hasOwnProperty("who"));
a.who = "shadow";
console.log("read", a.who, "who" in a, a.hasOwnProperty("who"));
console.log("keys", keysOf(a));
console.log("forin", forInOf(a));
console.log("json", JSON.stringify(a));
