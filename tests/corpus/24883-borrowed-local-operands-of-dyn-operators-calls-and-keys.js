// A plain local that only a dyn operator conversion (+, <, >, <=, >=, ==, Number(), Object.keys), a dyn call argument, a dyn method
// argument or a key operand reads is borrowed from its binding, with no retain and no release. Every value kind and every refused
// shape must still answer as Node does: ToPrimitive runs user code (valueOf, toString) in the middle of the operator, an operand
// evaluated later reassigns the same local, or a CAPTURED local (boxed) is replaced from inside valueOf.
function ops(a, b, c) {
  const out = [];
  out.push(a + b, a < b, a > b, a <= b, a >= b, a == b, a == 1, Number(a), Object.keys(c).join());
  out.push(a + 1, 2 + a, "s" + a, a + "t");
  return out.join("|");
}
console.log(ops(JSON.parse("3"), JSON.parse("4"), JSON.parse('{"x":1,"y":2}')));
console.log(ops(JSON.parse('"3"'), JSON.parse("4"), JSON.parse("[7,8]")));
console.log(ops(JSON.parse("null"), JSON.parse("true"), JSON.parse('{"k":null}')));
console.log(ops(JSON.parse("[1]"), JSON.parse("[2]"), JSON.parse('{"0":1}')));

// ToPrimitive running user code over a borrowed local: valueOf mutates the object it is called on, and calls back into helpers
const mkObj = () => { const o = JSON.parse('{"n":10}'); Object.defineProperty(o, "valueOf", { value() { this.n = this.n + 1; return this.n; }, enumerable: false }); return o; };
function viaValueOf() {
  const v = mkObj();
  const w = mkObj();
  return [v + 1, v < w, v > w, Number(v), v + w, v.n, w.n].join(",");
}
console.log(viaValueOf());

// dyn method and call arguments that are plain locals
function args(arr, x, y) {
  arr.push(x);
  arr.push(y);
  const f = (p, q) => p + q;
  const g = JSON.parse("[]");
  g.push(arr.indexOf(x), arr.indexOf(y), arr.includes(x));
  return arr.join("-") + "/" + f(x, y) + "/" + g.join(",");
}
console.log(args(JSON.parse("[0]"), JSON.parse("5"), JSON.parse('"six"')));

// key operands that are plain locals, including a key local reassigned by a later operand
function keys(o, k) {
  const r1 = o[k];
  let kk = k;
  const r2 = o[kk];
  const r3 = o[(kk = "b", kk)];
  return [r1, r2, r3, kk].join(",");
}
console.log(keys(JSON.parse('{"a":1,"b":2}'), "a"));

// THE REFUSED SHAPES over function locals: a later operand overwrites the very local the first operand borrowed
function refused() {
  let a = JSON.parse("3");
  const s1 = a + (a = JSON.parse("10"), 1);
  let b = JSON.parse("4");
  const s2 = b < (b = JSON.parse("1"), 9);
  let c = JSON.parse("[1,2]");
  const s3 = Number(c) + (c = JSON.parse("5"), 0);
  let d = JSON.parse("[3]");
  const f = (p, q) => String(p) + "/" + String(q);
  const s4 = f(d, (d = JSON.parse("[9]"), 2));
  let e = JSON.parse("[5]");
  const hold = JSON.parse("[]");
  hold.push(e, (e = JSON.parse("[6]"), 7));
  return [s1, a, s2, b, s3, c, s4, d, hold.join(";"), e].join("|");
}
console.log(refused());

// A CAPTURED local (boxed): valueOf replaces the variable in the middle of the operator
let cap = JSON.parse('{"n":1}');
Object.defineProperty(cap, "valueOf", { value() { cap = JSON.parse("100"); return 5; }, enumerable: false });
const capped = cap + 1;
console.log(capped, cap);
let cap2 = JSON.parse('{"n":1}');
Object.defineProperty(cap2, "valueOf", { value() { cap2 = JSON.parse("100"); return 5; }, enumerable: false });
console.log(cap2 < 6, cap2, Number(cap2));
