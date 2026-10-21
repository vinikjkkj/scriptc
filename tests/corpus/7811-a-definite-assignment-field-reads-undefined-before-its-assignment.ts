// `x!: T` class fields assigned past the constructor: a read before the
// assignment is Node's undefined. Printing, templates, typeof, comparisons,
// ??, ?. and conditions see it; a member use throws Node's exact TypeError.
class A { n!: number; s!: string; o!: {id:number}; arr!: number[]; b!: boolean;
  init() { this.s = "q"; this.o = {id: 3}; this.arr = [1,2]; this.n = 9; this.b = true; } }
function t(name: string, f: () => unknown) {
  try { console.log(name, f()); } catch (e) { console.log(name, "threw", (e instanceof TypeError ? "TypeError" : "other"), (e as Error).message); }
}
const a = new A();
t("len", () => a.s.length);
t("up", () => a.s.toUpperCase());
t("id", () => a.o.id);
t("alen", () => a.arr.length);
t("a0", () => a.arr[0]);
t("setid", () => { a.o.id = 4; });
t("fix", () => a.n.toFixed(2));
t("cond", () => (a.s ? "yes" : "no"));
t("not", () => !a.b);
t("if", () => { if (a.n) return "t"; return "f"; });
t("arith", () => a.n + 1);
t("cmp", () => a.n > 1);
t("eqnull", () => [a.s == null, a.o === undefined, a.arr !== undefined]);
t("tmpl", () => `${a.s}-${a.n}-${a.b}-${a.o}`);
t("cat", () => "x" + a.s + a.n);
t("opt", () => console.log(a.s?.length));
t("nn", () => a.s!.length);
a.init();
t("len2", () => a.s.length);
t("id2", () => a.o.id);
t("arith2", () => a.n + 1);
function loc() {
  let s!: string; let o!: {id: number}; let n!: number;
  const show = () => { console.log(s, o, n); };
  t("lenL", () => s.length);
  t("idL", () => o.id);
  show();
  s = "w"; o = {id: 2}; n = 1;
  show(); t("lenL2", () => s.length);
}
loc();

class B { n!: number; s!: string; o!: {id:number}; b!: boolean; arr!: number[];
  show() { console.log(this.n); console.log(this.s); console.log(this.o, this.b, this.arr); } }
const bb = new B(); bb.show();
console.log(bb.n, bb.s, bb.o, bb.b, bb.arr);
console.log(typeof bb.n, typeof bb.s, bb.s === undefined, `${bb.s}|${bb.n}`, bb.s ?? "dflt");
if (!bb.s) console.log("falsy");
