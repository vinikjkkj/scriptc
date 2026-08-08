// `o.f++` / `--o.f` used for their VALUE, not as a statement.
//
// A statement `obj.f++` never had to say what the expression answered, so
// the compiler desugared it to `obj.f += 1`, wrote the slot, and refused
// every position that read the result. `buf[this.pos++]` is that position,
// and it is the byte reader every generated protobuf decoder is built
// from — pbjs emits `this.buf[this.pos++]` for `readByte`, for the varint
// loop, and for every length prefix, so the refusal sits on the first
// instruction of every decode.
//
// What a POSTFIX `++` yields is not the new value and not the old cell: it
// is the ToNumeric conversion of the old value. Over a number field the
// distinction is invisible; over an untyped one it is the whole answer
// (`o.f = '5'; o.f++` answers 5 and leaves 6), and it cannot be recovered
// by subtracting one afterwards, because `(x + 1) - 1` is not `x` in
// doubles. Every section below prints the yielded value AND the slot.
//
// A JavaScript entry: the untyped half of this family only exists in JS.

function show(label, value) {
  console.log(label + " -> " + typeof value + " " + String(value));
}

// ── a number-typed record field, all four spellings ─────────────────────
var o = { n: 5 };
show("o.n++", o.n++); show("  slot", o.n);
show("++o.n", ++o.n); show("  slot", o.n);
show("o.n--", o.n--); show("  slot", o.n);
show("--o.n", --o.n); show("  slot", o.n);

// The value is the OPERATION's, so it drives the positions that have no
// conversion of their own: an index, a switch discriminant, a relational
// operand, a call argument.
var arr = [10, 20, 30, 40];
var cur = { i: 0 };
console.log(arr[cur.i++], arr[cur.i++], cur.i);
var sw = { k: 1 };
switch (sw.k++) {
  case 1: console.log("switched on the OLD value, slot now " + sw.k); break;
  default: console.log("wrong");
}
var rel = { m: 3 };
console.log(rel.m++ < 4, rel.m, ++rel.m > 4, rel.m);

// Float precision: the old value is HELD, never recomputed. 0.1 + 1 - 1 is
// 0.10000000000000009, so a compiler that recovered the old value by
// subtracting would print that instead of 0.1.
var f = { v: 0.1 };
show("f.v++", f.v++); show("  slot", f.v);

// -0, Infinity and NaN through the field slot.
var edge = { z: 0 };
show("(0).z--", edge.z--); show("  slot is -0", Object.is(edge.z, -0));
edge.z = Infinity; show("inf++", edge.z++); show("  slot", edge.z);
edge.z = NaN; show("nan++", edge.z++); show("  slot", edge.z);
// 2^53 is where ++ stops moving the double.
edge.z = 9007199254740992; show("2^53++", edge.z++); show("  slot", edge.z);

// ── an UNTYPED (implicit-any) field: `++` is ToNumeric, never `+` ───────
// A JS constructor's `this.x = v` gives the field no static type, which is
// exactly the shape a minified codec's cursor has. `++` has no string arm
// at all — unlike `+= 1`, which would concatenate.
function Cell(v) { this.p = v; }

function bump(v, label) {
  var c = new Cell(v);
  var yielded = c.p++;
  console.log(
    label + ": yielded " + typeof yielded + " " + String(yielded) +
    " | slot " + typeof c.p + " " + String(c.p),
  );
}
bump(5, "number");
bump("5", "string '5'");
bump("0x10", "hex string");
bump("  7  ", "padded string");
bump("", "empty string");
bump("abc", "non-numeric string");
bump(true, "true");
bump(false, "false");
bump(null, "null");
bump(undefined, "undefined");

// Prefix over the same slots yields the NEW value.
function pre(v, label) {
  var c = new Cell(v);
  var yielded = --c.p;
  console.log(label + ": prefix yielded " + String(yielded) + " | slot " + String(c.p));
}
pre("5", "string '5'");
pre(true, "true");
pre(null, "null");

// The statement form must agree with the value form on the SLOT.
var stmtCell = new Cell("5");
stmtCell.p++;
console.log("statement form leaves " + typeof stmtCell.p + " " + String(stmtCell.p));

// ── the protobuf byte reader ────────────────────────────────────────────
function Reader(buf) { this.buf = buf; this.pos = 0; this.len = buf.length; }
Reader.prototype.byte = function () { return this.buf[this.pos++]; };
Reader.prototype.varint = function () {
  var value = 0, shift = 0, b = 0;
  do { b = this.buf[this.pos++]; value += (b & 127) * Math.pow(2, shift); shift += 7; } while (b >= 128);
  return value;
};
var r = new Reader([1, 2, 3, 172, 2, 255, 255, 3]);
console.log(r.byte(), r.byte(), r.byte(), r.pos);
console.log(r.varint(), r.pos);
console.log(r.varint(), r.pos, r.pos === r.len);

// ── ORDER: the receiver is evaluated for the read and the value is stored
// before anything downstream can see the slot. ──────────────────────────
// A `this`-receiver method sees the same order as the identifier form.
function Order() { this.n = 0; }
Order.prototype.step = function () { return [this.n++, this.n]; };
var ord = new Order();
console.log(ord.step().join(","), ord.step().join(","));

// ── an ACCESSOR-backed property: get, ±1, set — once each, in order ─────
// A computed RECEIVER (`f().c++`) keeps its fence in both positions, so
// the accessor rides an identifier, which is the shape the compound path
// already claims.
var log = [];
class Acc {
  constructor() { this._v = 10; }
  get v() { log.push("get"); return this._v; }
  set v(x) { log.push("set:" + x); this._v = x; }
}
var acc = new Acc();
show("acc.v++", acc.v++);
console.log(log.join(" ") + " | _v " + acc._v);
show("++acc.v", ++acc.v);
console.log(log.join(" ") + " | _v " + acc._v);
