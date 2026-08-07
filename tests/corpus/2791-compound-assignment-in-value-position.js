// `x op= e` used for its VALUE, not as a statement.
//
// A compound assignment IS an expression in JavaScript: it stores, and it
// yields what it stored. Statement position never had to answer the second
// half, so the compiler combined and wrote in one node and refused every
// position that read the result. That refusal is what a generated protobuf
// codec runs into on its first line of dispatch — `switch (tag >>>= 3)` is
// the tag/wire-type split every pbjs decoder is built from, and
// `readU32(this.buf, this.pos += 4)` is how its fixed-width reader steps —
// and it is what a minifier produces from perfectly ordinary code, because
// terser rewrites statement sequences into comma expressions.
//
// What JS yields is the value of the OPERATION, not a read-back of the
// slot: the two differ the moment the slot has to convert, so the number
// is what a switch switches on even when the binding it came from is
// untyped. That distinction is the whole point of the sections below.
//
// A JavaScript entry: the untyped-slot half of this family only exists in
// JS, and keeping both halves in one file keeps the ordering rules
// side by side.

function show(label, value) {
  console.log(label + " -> " + typeof value + " " + String(value));
}

// ── every operator, for its value, over a number binding ────────────────
// Printed twice each: the value the expression answered, and the value the
// binding holds afterwards. For a number slot these agree; the sections
// after this one are the ones where they do not.
var n;
n = 10; show("+=", n += 4); show("  slot", n);
n = 10; show("-=", n -= 4); show("  slot", n);
n = 10; show("*=", n *= 4); show("  slot", n);
n = 10; show("/=", n /= 4); show("  slot", n);
n = 10; show("%=", n %= 4); show("  slot", n);
n = 10; show("**=", n **= 4); show("  slot", n);
n = 10; show("&=", n &= 6); show("  slot", n);
n = 10; show("|=", n |= 6); show("  slot", n);
n = 10; show("^=", n ^= 6); show("  slot", n);
n = 10; show("<<=", n <<= 3); show("  slot", n);
n = -10; show(">>=", n >>= 1); show("  slot", n);
n = -10; show(">>>=", n >>>= 1); show("  slot", n);

// ── the sharp edges of the operators themselves, read as values ─────────
// Each of these is a place where the answer is not the naive one, and a
// value position is where a wrong answer would be seen.
n = 1; show("<<= 33 (count masked to 5 bits)", n <<= 33);
n = 1; show(">>>= 32 (count 0, not a wipe)", n >>>= 32);
n = -1; show(">>>= 0 (ToUint32)", n >>>= 0);
n = 2147483647; show("+= 1 then |= 0 (Int32 wrap)", (n += 1) | 0);
n = 5; show("/= 0", n /= 0);
n = 5; show("%= 0", n %= 0);
n = 5; show("*= NaN then |= 0 (NaN -> 0)", (n *= NaN) | 0);
n = 4; show("**= 0.5", n **= 0.5);
n = 0; show("*= -1 is -0", Object.is(n *= -1, -0));
n = 1e21; show("+= 0 keeps exponential form", n += 0);

// ── a string slot: `+=` concatenates and yields the string ──────────────
var s = "ab";
show("string +=", s += "cd");
show("  slot", s);
show("string += number", s += 7);

// ── the yielded value drives control flow ───────────────────────────────
// A `while` whose test IS the step, the `for (;;)` a minifier writes, and
// an `if` over the new value.
var i = 9;
var seen = [];
while ((i -= 2) > 0) seen.push(i);
console.log("while-step: " + seen.join(","));

var acc = 0;
for (var k = 0; (k += 3) < 12; ) acc += k;
console.log("for-step: k=" + k + " acc=" + acc);

var countdown = 3;
if ((countdown -= 3) === 0) console.log("if-step: reached zero");

// ── a switch DISCRIMINANT: the protobuf tag split ───────────────────────
// `tag >>>= 3` both stores the field number and answers it. The switch
// must see the number.
function fieldOf(tag) {
  var wire = 7 & tag;
  switch ((tag >>>= 3)) {
    case 1:
      return "one/" + wire + "/" + tag;
    case 2:
      return "two/" + wire + "/" + tag;
    default:
      return "other/" + wire + "/" + tag;
  }
}
console.log(fieldOf(8 | 2));
console.log(fieldOf(16 | 0));
console.log(fieldOf(400 | 5));

// ── a CALL ARGUMENT, with the cursor read again afterwards ──────────────
// The reader shape: the argument is the position BEFORE the step in one
// spelling and AFTER it in the other, and both have to be right.
function at(buf, p) {
  return buf[p];
}
var buf = [10, 11, 12, 13, 14, 15, 16, 17];
var pos = 0;
console.log("post-step read: " + at(buf, (pos += 4)) + " pos=" + pos);
pos = 0;
console.log("two steps: " + at(buf, (pos += 1)) + "," + at(buf, (pos += 1)) + " pos=" + pos);

// ── COMMA operands: what a minifier makes of a statement sequence ───────
var a = 1;
var b = 2;
var c = (a += 1, b += 10, a + b);
console.log("comma: a=" + a + " b=" + b + " c=" + c);

// ── chained and nested ──────────────────────────────────────────────────
var p = 1;
var q = 2;
show("nested", (p += q += 3));
console.log("  p=" + p + " q=" + q);

// ── ORDER: the target is read BEFORE the right-hand side runs ───────────
// `x += f()` is `x = x + f()` with x read first, so a right-hand side that
// writes x cannot be seen by this operation — only by the next read.
var ord = 1;
function bump() {
  ord = 100;
  return 5;
}
show("read-before-rhs", (ord += bump()));
show("  slot", ord);

// ── FIELD targets: an identifier receiver and `this` ────────────────────
// The same rule over a property, which is the spelling the codec's reader
// uses for its cursor.
function Cursor(buf) {
  this.buf = buf;
  this.pos = 0;
  this.len = buf.length;
}
Cursor.prototype.u8 = function () {
  // `(this.pos += 1) - 1`, not `this.pos++`: increment of a field in
  // expression position is its own gap (SC1045) and this file is not
  // about it.
  return this.buf[(this.pos += 1) - 1];
};
Cursor.prototype.skip4 = function () {
  // the value of the step is the new position, and the read uses it
  return this.buf[(this.pos += 4) - 1];
};
Cursor.prototype.grow = function (k) {
  return (this.len += k);
};
var cur = new Cursor([1, 2, 3, 4, 5, 6, 7, 8]);
console.log("u8: " + cur.u8() + " pos=" + cur.pos);
console.log("skip4: " + cur.skip4() + " pos=" + cur.pos);
console.log("grow: " + cur.grow(2) + " len=" + cur.len);

var box = { hits: 0, tag: "t" };
show("identifier receiver", (box.hits += 3));
show("  slot", box.hits);
show("string field", (box.tag += "!"));

// ── BIGINT slots keep their own operator family ─────────────────────────
// Printed through their own helper: a bigint has no checked-dynamic
// representation, so the untyped `show` above cannot take one.
/**
 * @param {string} label
 * @param {bigint} value
 */
function showBig(label, value) {
  // no `typeof`: it is a separate gap over statically-typed values, and
  // the annotation above is what gives this one a static type
  console.log(label + " -> bigint " + String(value));
}
var big = 1024n;
showBig("bigint >>=", (big >>= 4n));
showBig("bigint *=", (big *= 3n));
showBig("  slot", big);
