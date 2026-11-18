// The same absent-until-written fields reached through untyped values and dynamic keys: Object.keys, Object.entries, for-in, hasOwn, the prototype fallback and the
// order of creation, for instances in every state.
class Rec {
  constructor(a, b, c, d) {
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
  }
  sum() { return this.a + this.b + this.c + this.d; }
  setM(v) { this.m = v; }
  setN(v) { this.n = v; }
}
Rec.prototype.m = "pm";
Rec.prototype.n = undefined;
function inspectAny(o) {
  const out = [];
  for (const k of Object.keys(o)) out.push(k + "=" + String(o[k]));
  const fi = [];
  for (const k in o) fi.push(k);
  const es = [];
  for (const e of Object.entries(o)) es.push(e[0] + ":" + String(e[1]));
  console.log(out.join("|"), "/", fi.join(","), "/", es.join(","), "/", Object.hasOwn(o, "m"), Object.hasOwn(o, "n"), o.m, o.n, o["m"], o["n"]);
}
const r1 = new Rec(1, 2, 3, 4);
inspectAny(r1);
r1.setN(7);
inspectAny(r1);
r1.setM("own-m");
inspectAny(r1);
const r2 = new Rec(5, 6, 7, 8);
r2.setM(undefined);
inspectAny(r2);
inspectAny(new Rec(0, 0, 0, 0));
inspectAny({ a: 1, m: "plain" });
