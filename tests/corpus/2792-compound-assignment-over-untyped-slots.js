// `x++`, `x--` and `x op= e` where the SLOT is untyped.
//
// The companion to 2761: the binary operators over untyped operands learned
// to run their own specified conversions instead of a checked cast to
// number, and the read-modify-write forms over an untyped SLOT did not all
// follow. `t = t + 1` converted; `t++` refused. `pos += 4` over an untyped
// local converted; `this.pos += 4` over an untyped FIELD threw. Those are
// the same operator reached by two spellings, and a minified JavaScript
// bundle uses whichever is shorter.
//
// The conversions each of these runs, from the spec:
//   `++` / `--`   ToNumeric on the READ, then ±1. There is no string arm at
//                 all — `x = '3'; x++` leaves 4, never '31' — and what the
//                 expression YIELDS is the converted old value (a Number),
//                 not the cell that was there.
//   `+=`          ToPrimitive, and then concatenation as soon as EITHER
//                 side is a string. Not a number context.
//   everything else  ToNumber (the bitwise six through ToInt32/ToUint32).
//
// Every slot below is untyped because it is written from `pick`, an
// untyped helper that returns one of its own parameters — the plainest
// shape that gets the checker to say `any`.

function pick(tag, v) {
  return v;
}

function show(label, value) {
  console.log(label + " -> " + typeof value + " " + String(value));
}

// ── postfix `++` yields the CONVERTED old value ─────────────────────────
// Not the old cell: `'5'` in, the Number 5 out, and 6 left behind.
var v;
v = pick("a", 5); show("5 v++", v++); show("  slot", v);
v = pick("a", "5"); show("'5' v++", v++); show("  slot", v);
v = pick("a", "0x10"); show("'0x10' v++", v++); show("  slot", v);
v = pick("a", "  7  "); show("'  7  ' v++", v++); show("  slot", v);
v = pick("a", ""); show("'' v++", v++); show("  slot", v);
v = pick("a", "abc"); show("'abc' v++", v++); show("  slot", v);
v = pick("a", true); show("true v++", v++); show("  slot", v);
v = pick("a", false); show("false v++", v++); show("  slot", v);
v = pick("a", null); show("null v++", v++); show("  slot", v);
v = pick("a", undefined); show("undefined v++", v++); show("  slot", v);

// ── prefix `++`/`--` yield the NEW value ────────────────────────────────
v = pick("a", "5"); show("'5' ++v", ++v); show("  slot", v);
v = pick("a", "5"); show("'5' v--", v--); show("  slot", v);
v = pick("a", "5"); show("'5' --v", --v); show("  slot", v);
v = pick("a", null); show("null --v", --v); show("  slot", v);

// ── `++` in statement position agrees with `++` in value position ───────
// The same slot, the same conversion; only the yield differs.
var stmt = pick("a", "41");
stmt++;
show("statement ++", stmt);

// ── `+=` is not a number context ────────────────────────────────────────
// An untyped accumulator plus a string is concatenation — the decoder's
// spelling — and the expression answers the string.
var o;
o = pick("a", ""); show("'' += 'ab'", (o += "ab")); show("  slot", o);
o = pick("a", 12); show("12 += 'ab'", (o += "ab")); show("  slot", o);
o = pick("a", "n="); show("'n=' += 7", (o += 7)); show("  slot", o);
o = pick("a", "f="); show("'f=' += true", (o += true)); show("  slot", o);
o = pick("a", "u="); show("'u=' += undefined", (o += undefined)); show("  slot", o);
o = pick("a", 2); show("2 += 3", (o += 3)); show("  slot", o);
o = pick("a", "2"); show("'2' += 3", (o += 3)); show("  slot", o);
o = pick("a", null); show("null += 1", (o += 1)); show("  slot", o);

// ── every other operator IS a number context ────────────────────────────
var u;
u = pick("a", "10"); show("'10' -= 4", (u -= 4)); show("  slot", u);
u = pick("a", "10"); show("'10' *= '4'", (u *= pick("b", "4")));
u = pick("a", "x"); show("'x' /= 2", (u /= 2));
u = pick("a", true); show("true %= 2", (u %= 2));
u = pick("a", "4"); show("'4' **= 2", (u **= 2));
u = pick("a", undefined); show("undefined |= 0", (u |= 0)); show("  slot", u);
u = pick("a", "-8"); show("'-8' >>= 1", (u >>= 1));
u = pick("a", "-8"); show("'-8' >>>= 1", (u >>>= 1));
u = pick("a", "3"); show("'3' &= 6", (u &= 6));
u = pick("a", "3"); show("'3' ^= 6", (u ^= 6));
u = pick("a", "1"); show("'1' <<= '10'", (u <<= pick("b", "10")));
u = pick("a", 4294967296); show("2^32 >>>= 0", (u >>>= 0));

// ── the protobuf writer's shape: an untyped cursor in a switch ──────────
function fieldOf(t) {
  var tag = pick("t", t);
  var wire = 7 & tag;
  switch ((tag >>>= 3)) {
    case 1:
      return "one/" + wire;
    case 2:
      return "two/" + wire;
    default:
      return "other/" + wire + "/" + tag;
  }
}
console.log(fieldOf(8 | 2) + " " + fieldOf(16 | 0) + " " + fieldOf(400 | 5));

// ── untyped FIELDS: the same conversions, the same yields ───────────────
// `this.pos` and `this.len` are untyped because the constructor assigns
// untyped parameters — the ordinary JavaScript constructor, and the exact
// shape of a generated codec's reader.
function Cursor(buf, len) {
  this.buf = pick("b", buf);
  this.pos = pick("p", 0);
  this.len = pick("l", len);
}
Cursor.prototype.step = function (k) {
  return (this.pos += k);
};
Cursor.prototype.grow = function (k) {
  this.len += k;
  return this.len;
};
Cursor.prototype.label = function (s) {
  return (this.tag = s), (this.tag += "!"), this.tag;
};
var cur = new Cursor([1, 2, 3, 4], 4);
show("field step (value)", cur.step(3));
show("field step (slot)", cur.pos);
show("field grow (statement)", cur.grow(2));
show("field string +=", cur.label("t"));

// A field holding a numeric STRING: the compound converts it, exactly as
// the same operator over a binding does.
function Box(v) {
  this.n = pick("v", v);
}
var b1 = new Box("5");
b1.n -= 1;
show("'5' field -= 1", b1.n);
var b2 = new Box("5");
show("'5' field *= 2 (value)", (b2.n *= 2));
var b3 = new Box("6");
show("'6' field >>= 1 (value)", (b3.n >>= 1));
var b4 = new Box(2);
show("field += string", (b4.n += "x"));

// ── the ORDER rule holds over untyped slots too ─────────────────────────
var ord = pick("a", "1");
function bump() {
  ord = 100;
  return 5;
}
show("untyped read-before-rhs", (ord += bump()));
show("  slot", ord);
