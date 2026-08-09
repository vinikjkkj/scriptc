// A prototype method whose NAME collides with one of String.prototype's
// Annex B HTML wrappers -- `sub`, which is `mul`'s partner in every 64-bit
// integer library. This is the shape of the `long` package bundled inside
// protobufjs, minified the same way: a constructor function, its prototype
// aliased to a short name, methods assigned onto the alias, and the short
// spellings assigned FROM the long ones.
//
// `sub` used to refuse on the name alone: a dyn receiver calling any name
// String.prototype declares kept the fence, because a stored-member read
// would silently mis-answer a real string method. `mul` compiled and `sub`
// did not, in the same expression. The dispatch answers for a dyn string
// now, so every other receiver kind gets the prototype-chain call JS
// specifies.
//
// The second half is the string side of that same dispatch: all thirteen
// wrappers over a value the compiler cannot see is a string (it comes out
// of JSON.parse), including the escaping rule -- a `"` inside an ATTRIBUTE
// value becomes &quot;, and nothing else is escaped, `<` and `&` included.

function L(lo, hi) {
  this.low = lo | 0;
  this.high = hi | 0;
}
var S = L.prototype;

S.subtract = function (o) {
  return new L(this.low - o.low, this.high - o.high);
};
S.sub = S.subtract;
S.multiply = function (o) {
  return new L(this.low * o.low, this.high * o.high);
};
S.mul = S.multiply;
S.negate = function () {
  return new L(-this.low, -this.high);
};
S.neg = S.negate;
S.show = function () {
  return this.low + ":" + this.high;
};
// `this.sub(...)` INSIDE another prototype method -- the receiver is the
// instance, and the method is found on the chain.
S.compare = function (o) {
  return this.sub(o).show();
};
// The chained spelling the `long` bundle actually carries:
// `n.mul(t).sub(this)`.
S.mulSub = function (o) {
  return this.mul(o).sub(o).show();
};

var a = new L(9, 4);
var b = new L(3, 1);
console.log(a.compare(b));
console.log(a.mulSub(b));
console.log(a.mul(b).sub(a).show());
console.log(a.neg().sub(b).show());

// A method that does NOT exist is still Node's TypeError, name collision
// or not.
try {
  a.blink();
} catch (e) {
  console.log(e.name + ": " + e.message);
}

// ── the string side of the same dispatch ──────────────────────────────
var parsed = JSON.parse('{"s":"a\\"b<c&d"}');
var s = parsed.s;
console.log(s.sub(), s.sup(), s.big(), s.small());
console.log(s.bold(), s.italics(), s.fixed(), s.blink(), s.strike());
console.log(s.anchor('x"y'));
console.log(s.link('h"i'));
console.log(s.fontcolor('r"g'), s.fontsize(7));
// A missing argument is undefined, and ToString(undefined) is "undefined".
console.log(s.fontcolor());
// The argument takes ToString with the object protocol, receiver bound.
console.log(s.anchor({ toString: function () { return "N" + this.n; }, n: 4 }));
// An empty receiver still wraps.
console.log(JSON.parse('{"e":""}').e.bold());
