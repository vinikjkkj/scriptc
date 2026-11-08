// Reads of a plain local that only look at it (truthiness, typeof, instanceof, ===, a key read, a method call, a field read of
// `this`) borrow the binding instead of retaining a copy. Every shape below must still answer exactly as Node does, including the
// ones where the borrow must be REFUSED: an operand evaluated afterwards reassigns the same local, or a callee reassigns a CAPTURED
// local (a boxed binding) in the middle of the read.
class Pk {
  constructor() {
    this.buf = JSON.parse('{"n":1,"s":"x","z":0,"nul":null,"list":[4,5,6]}');
    this.off = 0;
    this.label = "pk";
  }
  bump() {
    this.off = this.off + 1;
    return this.off;
  }
  peek(k) {
    return this.buf[k];
  }
  tag() {
    const me = this;
    return me.label + me.off + (me.buf.n === 1 ? "!" : "?");
  }
}
const p = new Pk();
p.bump(); p.bump();
console.log(p.off, p.peek("s"), p.peek("list"), p.tag());

let o = JSON.parse('{"a":1,"b":"two","c":null,"d":[1,2,3],"e":0,"f":"","g":false}');
const show = (x) => (x ? "T" : "F") + typeof x + (x === null) + (x === undefined) + (x === 1) + (x === "two");
console.log(["a", "b", "c", "d", "e", "f", "g", "nope"].map((k) => show(o[k])).join(" "));

// instanceof over an untyped local
const mkAny = (n) => (n % 2 === 0 ? new Pk() : JSON.parse('{"q":1}'));
let u0 = mkAny(0), u1 = mkAny(1);
console.log(u0 instanceof Pk, u1 instanceof Pk, typeof u0, typeof u1, !!u0, !!u1);

// method calls on a local receiver with simple arguments
let arr = JSON.parse("[3,1,2]");
console.log(arr.slice(1).join("-"), arr.indexOf(2), arr.concat([7]).length, arr.join("+"));
let str = JSON.parse('"hello world"');
console.log(str.toUpperCase(), str.indexOf("o"), str.slice(0, 5), str.split(" ").length);

// THE REFUSED SHAPES. The receiver local is reassigned by an operand evaluated after it: JS has already read the OLD value.
let r1 = JSON.parse('{"k":"old"}');
const got1 = r1[(r1 = JSON.parse('{"k":"new"}'), "k")];
console.log(got1, r1.k);
let r2 = JSON.parse("[1,2]");
const pushed = r2.push((r2 = JSON.parse("[9]"), 4));
console.log(pushed, r2.length, r2[0]);
let r3 = JSON.parse('{"v":5}');
const eq = r3.v === (r3 = JSON.parse('{"v":6}'), 5);
console.log(eq, r3.v);
let r4 = JSON.parse('{"t":1}');
const tt = (r4 ? "yes" : "no") + (r4 = JSON.parse("null"), r4 ? "yes" : "no");
console.log(tt);

// A CAPTURED local (boxed): a getter run in the middle of the read replaces the variable, and the read already in flight must keep
// its value alive.
let cap = JSON.parse('{"hit":"first"}');
const holder = {};
Object.defineProperty(holder, "k", { get() { cap = JSON.parse('{"hit":"second"}'); return "hit"; } });
const viaGetter = cap[holder.k];
console.log(viaGetter, cap.hit);
let cap2 = JSON.parse('{"x":[1,2,3]}');
const replacer = () => { cap2 = JSON.parse('{"x":[]}'); return "x"; };
console.log(cap2[replacer()].length, cap2.x.length);

// A loop that reads, then reassigns, the same local each turn.
let cur = JSON.parse('{"n":0,"next":{"n":1,"next":{"n":2,"next":null}}}');
let sum = 0;
while (cur) { sum += cur.n; cur = cur.next; }
console.log(sum, cur);
let acc = JSON.parse('{"i":0}');
for (let i = 0; i < 5; i++) acc = JSON.parse('{"i":' + (acc.i + i) + "}");
console.log(acc.i);

// The same refused shapes over FUNCTION locals (above, the variables are module globals, which are never borrowed): here the borrow
// would be sound for the plain forms and must be refused exactly when a later operand overwrites the binding.
function locals(mode) {
  let a = JSON.parse('{"k":"old","v":5}');
  const k1 = a[(a = JSON.parse('{"k":"new","v":6}'), "k")];
  let b = JSON.parse("[1,2]");
  const n1 = b.push((b = JSON.parse("[9]"), 4));
  let c = JSON.parse('{"v":5}');
  const e1 = c.v === (c = JSON.parse('{"v":6}'), 5);
  let d = JSON.parse('{"t":1}');
  const t1 = (d ? "yes" : "no") + (d = JSON.parse("null"), d ? "yes" : "no");
  let s = JSON.parse('"str"');
  const m1 = s.indexOf((s = JSON.parse('"zzz"'), "t"));
  let plain = JSON.parse('{"k":"kept"}');
  const p1 = plain.k + plain["k"] + (plain ? 1 : 0) + (plain.k === "kept" ? 1 : 0);
  return [k1, a.k, n1, b.length, e1, c.v, t1, m1, s, p1, mode].join("|");
}
console.log(locals("x"));

// A dyn FIELD read by a PURE test (truthiness, kind, ===) is borrowed straight out of the object. A field read by anything that can
// run user code is NOT: the getter below replaces the very field the keyed read started from, in the middle of the read.
class Hold {
  constructor() {
    this.d = JSON.parse('{"x":1,"z":0}');
    this.n = JSON.parse("null");
    this.s = JSON.parse('"txt"');
    this.k = JSON.parse("0");
  }
  tests() {
    return [this.d ? 1 : 0, this.n ? 1 : 0, this.s ? 1 : 0, this.k ? 1 : 0, typeof this.d, typeof this.n, this.n === null, this.s === "txt", this.k === 0, this.d === this.d, this.d instanceof Hold].join(",");
  }
  read() {
    return this.d["acc"];
  }
}
const hold = new Hold();
console.log(hold.tests());
Object.defineProperty(hold.d, "acc", { get() { hold.d = JSON.parse('{"x":2}'); return "got"; } });
console.log(hold.read(), hold.d.x);
