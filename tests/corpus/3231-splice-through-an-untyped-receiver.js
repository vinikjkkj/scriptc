// Array.prototype.splice reached through a receiver the compiler cannot
// type -- protobufjs's EventEmitter.prototype.off is literally
// `n.splice(o, 1)` over `this._listeners[e]`, and it refused on the NAME:
// `splice` sat in the set of names a dyn-representable prototype declares,
// so every dyn-receiver `.splice(...)` kept the fence while `push`, `pop`
// and `slice` -- the same prototype, the same shape -- compiled.
//
// The three argument counts are three different operations and the reason
// an in-band default cannot express them: splice() removes NOTHING,
// splice(start) removes the whole tail, splice(start, n) removes n.
//
// The second half is the dispatch's other receivers: an object whose OWN
// member happens to be named `splice` calls that member with `this` bound,
// and every kind whose prototype lacks the name keeps Node's TypeError.

function shape(a) {
  return JSON.stringify(a);
}

// --- the argument-count split -------------------------------------------
function spliceNone(a) {
  return [shape(a.splice()), shape(a)];
}
function spliceFrom(a, s) {
  return [shape(a.splice(s)), shape(a)];
}
function spliceCount(a, s, n) {
  return [shape(a.splice(s, n)), shape(a)];
}
function spliceInsert(a, s, n, x, y, z) {
  return [shape(a.splice(s, n, x, y, z)), shape(a)];
}

console.log("none  ", spliceNone([1, 2, 3]).join(" | "));
console.log("from  ", spliceFrom([1, 2, 3, 4, 5], 1).join(" | "));
console.log("from0 ", spliceFrom([1, 2, 3], 0).join(" | "));
console.log("fromEq", spliceFrom([1, 2, 3], 3).join(" | "));
console.log("count ", spliceCount([1, 2, 3, 4, 5], 1, 2).join(" | "));
console.log("count0", spliceCount([1, 2, 3], 1, 0).join(" | "));
console.log("insert", spliceInsert([1, 2, 3, 4, 5], 1, 2, "x", "y", "z").join(" | "));

// --- the index rules: negative, fractional, out of range ----------------
console.log("neg   ", spliceFrom([1, 2, 3, 4, 5], -2).join(" | "));
console.log("negBig", spliceFrom([1, 2, 3], -99).join(" | "));
console.log("frac  ", spliceCount([1, 2, 3, 4], 1.7, 1.9).join(" | "));
console.log("past  ", spliceInsert([1, 2, 3], 10, 5, "q", "r", "s").join(" | "));
console.log("negCnt", spliceCount([1, 2, 3, 4], 1, -5).join(" | "));
console.log("bigCnt", spliceCount([1, 2, 3, 4], 1, 99).join(" | "));
console.log("empty ", spliceCount([], 0, 3).join(" | "));
// An explicit undefined deleteCount is ToIntegerOrInfinity(undefined) = 0,
// which is NOT the one-argument form: splice(1, undefined) removes
// nothing where splice(1) removes the tail. Two arguments, two answers.
console.log("undefCt", spliceCount([1, 2, 3], 1, undefined).join(" | "));
console.log("undefSt", spliceFrom([1, 2, 3], undefined).join(" | "));
console.log("insUndf", spliceInsert([1, 2, 3], 1, 1, undefined, null, 0).join(" | "));

// --- growing and shrinking the SAME array, repeatedly -------------------
// The in-place rewrite moves references around; doing it many times over
// one array is what catches an ownership mistake (a leak or a double
// release) rather than a one-shot spelling error.
function churn(a) {
  var i = 0;
  while (i < 40) {
    a.splice(1, 1, "a" + i, "b" + i);
    a.splice(2, 2);
    a.splice(a.length, 0, i);
    i++;
  }
  return a.length + ":" + a.slice(0, 4).join(",");
}
console.log("churn ", churn([0, 1, 2]));

// --- splice through JSON.parse (the true checked-dynamic receiver) ------
var parsed = JSON.parse('{"xs":[10,20,30,40],"ys":["p","q"]}');
console.log("json  ", shape(parsed.xs.splice(1, 2)), shape(parsed.xs));
parsed.ys.splice(1, 0, "mid");
console.log("jsonI ", shape(parsed.ys));

// --- the emitter shape this came from -----------------------------------
function Emitter() {
  this._listeners = Object.create(null);
}
Emitter.prototype.on = function (evt, fn, ctx) {
  (this._listeners[evt] || (this._listeners[evt] = [])).push({ fn: fn, ctx: ctx || this });
  return this;
};
Emitter.prototype.off = function (evt, fn) {
  var list = this._listeners[evt];
  if (!list) return this;
  for (var i = 0; i < list.length; ) {
    if (list[i].fn === fn) list.splice(i, 1);
    else ++i;
  }
  return this;
};
Emitter.prototype.emit = function (evt, v) {
  var list = this._listeners[evt];
  var out = [];
  if (list) for (var i = 0; i < list.length; i++) out.push(list[i].fn.call(list[i].ctx, v));
  return out.join(",");
};

var em = new Emitter();
function one(v) {
  return "one:" + v;
}
function two(v) {
  return "two:" + v;
}
em.on("m", one).on("m", two).on("m", one);
console.log("emit  ", em.emit("m", 7));
em.off("m", one);
console.log("off   ", em.emit("m", 7));
em.off("m", two);
console.log("offAll", JSON.stringify(em.emit("m", 7)));

// --- the OTHER receivers the dispatch now reaches -----------------------
// An own member wins over the array method, and runs with `this` bound.
function callSplice(o) {
  return o.splice(1, 2);
}
console.log("ownFn ", callSplice({ tag: "T", splice: function (a, b) { return this.tag + a + b; } }));

function tryIt(f) {
  try {
    return "ok:" + f();
  } catch (e) {
    return e.name + ": " + e.message;
  }
}
console.log("onStr ", tryIt(function () { return callSplice("abcdef"); }));
console.log("onNum ", tryIt(function () { return callSplice(12345); }));
console.log("onObj ", tryIt(function () { return callSplice({ a: 1 }); }));
console.log("onNul ", tryIt(function () { return callSplice(null); }));
