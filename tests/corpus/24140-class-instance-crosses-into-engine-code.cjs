"use strict";
// A class instance handed to code the compiler could not fold (new Function over built text) runs on the
// embedded engine: its members read, write and call on the instance itself, and it comes back as itself.

class Cfg {
  constructor() { this.tz = "UTC"; this.n = 3; this.tags = ["a", "b"]; }
  hello(x) { return "hi " + x + this.tz; }
  bump() { this.n++; return this.n; }
}
function build(extra) {
  return new Function("c", "k", "c.n = c.n + " + extra + "; return [k, c.tz, c.n, c.hello('a'), c.bump(), 'tz' in c, Object.keys(c).join(','), c.tags.length, c.missing, c].map(String).join('|')");
}
const cfg = new Cfg();
const f = build(String(process.argv.length));
const out = f(cfg, "k");
console.log(out.split("|").slice(0, 9).join("|"));
console.log(cfg.n);
const g = new Function("c", "return c");
console.log(g(cfg) === cfg);
const t = (code) => { try { console.log(new Function("c", "k", code + String(process.argv.length - 99))(cfg, "k")); } catch (e) { console.log("ERR", e.message); } };
t("return typeof c.toString + ");
t("return c.toString() + ");
t("return (c.valueOf() === c) + ");
t("return typeof c.hasOwnProperty + ");
