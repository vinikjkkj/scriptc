// `Uint8Array` as a VALUE — the constructor object, not a name.
//
// Every other standard-library global taken as a value in a JavaScript
// source is the identifier chokepoint's opaque IDENTITY TOKEN: an
// interned string naming it. That is sound for a value a program only
// ever COMPARES, and the two things a string cannot do — be called,
// answer a member — were supposed to meet a fence at each use site.
//
// `Uint8Array` breaks the rule, because programs read THROUGH it, and a
// member read off a string is not a fence: it is `undefined`. protobufjs
// does it twice at module init, once on each half of the codec:
//
//     util.Array = typeof Uint8Array !== "undefined" ? Uint8Array : Array;
//     Writer.alloc = util.pool(Writer.alloc, util.Array.prototype.subarray);
//     Reader.prototype._slice = util.Array.prototype.subarray
//                            || util.Array.prototype.slice;
//
// and the program died three reads later, on `.subarray` of undefined,
// with ZERO traps emitted. By the time `.prototype` is asked for,
// `util.Array` is a runtime dyn value — no frontend lift can see the
// access at all, which is why this is a value the runtime HOLDS rather
// than a lowered member like `String.prototype.charCodeAt`.
//
// What has to hold together:
//
//   1. ONE object per process, for the constructor AND its prototype:
//      `Uint8Array === Uint8Array`, `Uint8Array.prototype ===
//      Uint8Array.prototype`, and an instance's [[Prototype]] link all
//      read identity.
//   2. Node's OWN/INHERITED split. The methods live on
//      %TypedArray%.prototype, not on Uint8Array.prototype, so
//      `Object.hasOwn(Uint8Array.prototype, "subarray")` is FALSE while
//      `"subarray" in Uint8Array.prototype` is true. One flat object
//      would have to answer one of them wrongly.
//   3. A detached method is NOT bound: `Uint8Array.prototype.subarray`
//      and `b.subarray` are the same function object in Node and neither
//      remembers a receiver, so `.call(b, …)` is what supplies one — and
//      a receiver that is not a typed array throws Node's own message.
//   4. subarray is a VIEW and slice is a COPY, through EVERY spelling.
//      The dyn method arm used to copy for both, so
//      `holder.b.subarray(2, 4)[0] = 77` was lost where
//      `b.subarray(2, 4)[0] = 77` landed: the same source text, two
//      answers, no diagnostic.
//   5. `new` through the value builds a real typed array, and a plain
//      call throws Node's requires-'new' TypeError.
//
// DELIBERATE DIVERGENCES, none printed:
//   * The methods this runtime does not implement (`fill`, `map`, `set`,
//     …) answer a FUNCTION here, like Node's, and refuse LOUDLY when
//     called — the same refusal the ordinary `b.fill(0)` spelling gives,
//     from the same body. Node runs them.
//   * `Uint8Array.prototype.buffer` refuses instead of answering: there
//     is no free-standing ArrayBuffer value in a static build.
//   * A Buffer's `.constructor` refuses by name rather than answering the
//     Uint8Array one, which would be the silent wrong answer.
//   * `P.subarray.call(b, …)` where `P` is a STATICALLY bound
//     `Uint8Array.prototype` keeps the pre-existing SC1090
//     Function.prototype.call fence (tsc still types the member callable,
//     so the compiled-function-value arm claims it first). Reached
//     through an untyped binding — which is every spelling protobufjs
//     writes — it lowers.
//   * `globalThis` itself is still a token, so reading a global off a DYN
//     globalThis (`var g = globalThis; g2 = id(g); g2.Uint8Array`) answers
//     undefined where Node answers the constructor. Pre-existing and
//     unchanged: the two spellings this file does print
//     (`globalThis.Uint8Array` and the destructure) both resolve
//     statically and both answer the singleton.

function id(x) { return x; }  // erases the checker type, like the bundle's `var util = exports`

// ── 1. one object, and Node's shape ───────────────────────────────────
var P = Uint8Array.prototype;
var Q = Uint8Array.prototype;
console.log("1.1 one prototype", P === Q);
console.log("1.2 typeof", typeof Uint8Array, typeof P);
console.log("1.3 back-link", P.constructor === Uint8Array);
console.log("1.4 name/length", Uint8Array.name, Uint8Array.length);
console.log("1.5 toString", String(Uint8Array));
console.log("1.6 BYTES_PER_ELEMENT", Uint8Array.BYTES_PER_ELEMENT, P.BYTES_PER_ELEMENT);
console.log("1.7 keys are empty", JSON.stringify(Object.keys(P)), JSON.stringify(Object.keys(Uint8Array)));
console.log("1.8 own vs inherited",
  Object.hasOwn(P, "constructor"), Object.hasOwn(P, "BYTES_PER_ELEMENT"),
  Object.hasOwn(P, "subarray"), "subarray" in P);
console.log("1.9 globalThis is the same global",
  typeof globalThis.Uint8Array, globalThis.Uint8Array === Uint8Array);

// ── 2. the shape protobufjs writes, whole ─────────────────────────────
var util = {};
util.Array = typeof Uint8Array !== "undefined" ? Uint8Array : Array;
var A = id(util.Array);
console.log("2.1 not Array", A !== Array, A === Uint8Array);
console.log("2.2 prototype", typeof A.prototype, A.prototype === P);
console.log("2.3 subarray", typeof A.prototype.subarray, A.prototype.subarray.name);
var _slice = A.prototype.subarray || A.prototype.slice;
console.log("2.4 the || picked subarray", _slice.name, _slice.length);

// util.pool, verbatim from protobufjs/src/util/pool.js.
function pool(alloc, slice, size) {
  var SIZE = size || 8192, MAX = SIZE >>> 1, slab = null, offset = SIZE;
  return function pool_alloc(size) {
    if (size < 1 || size > MAX) return alloc(size);
    if (offset + size > SIZE) { slab = alloc(SIZE); offset = 0; }
    var buf = slice.call(slab, offset, offset += size);
    if (offset & 7) offset = (offset + 8) & ~7;
    return buf;
  };
}
var alloc = pool(function (n) { return new A(n); }, _slice);
var b1 = alloc(4); b1[0] = 10; b1[1] = 11; b1[2] = 12; b1[3] = 13;
var b2 = alloc(3); b2[0] = 20; b2[1] = 21; b2[2] = 22;
console.log("2.5 pooled lengths", b1.length, b2.length);
console.log("2.6 pooled contents", b1[0], b1[3], b2[0], b2[2]);
console.log("2.7 slabs do not collide", b1[0] !== b2[0] && b1[3] === 13 && b2[2] === 22);
// A large request bypasses the pool and goes straight to alloc.
var big = alloc(9000);
console.log("2.8 over MAX goes direct", big.length);

// ── 3. the receiver protocol ──────────────────────────────────────────
var t = function (label, f) {
  try { console.log(label, f()); }
  catch (e) { console.log(label, "THREW " + e.name + ": " + e.message); }
};
t("3.1 plain object", function () { return A.prototype.subarray.call({}, 0); });
t("3.2 undefined", function () { return A.prototype.subarray.call(undefined, 0); });
t("3.3 null", function () { return A.prototype.subarray.call(null, 0); });
t("3.4 a number", function () { return A.prototype.subarray.call(5, 0); });
t("3.5 an array", function () { return A.prototype.subarray.call([1, 2], 0); });
t("3.6 a real receiver", function () {
  return A.prototype.subarray.call(new Uint8Array([1, 2, 3, 4]), 1, 3).length;
});

// ── 4. subarray VIEWS, slice COPIES, through every spelling ───────────
function views(sub) {
  var b = new Uint8Array([1, 2, 3, 4]);
  var s = sub(b);
  s[0] = 99;
  return [b[1], s[0], s.length];
}
console.log("4.1 static spelling", JSON.stringify(views(function (b) { return b.subarray(1, 3); })));
console.log("4.2 dyn spelling", JSON.stringify(views(function (b) { return id(b).subarray(1, 3); })));
console.log("4.3 through the prototype", JSON.stringify(views(function (b) { return _slice.call(b, 1, 3); })));
function copies(sl) {
  var b = new Uint8Array([1, 2, 3, 4]);
  var s = sl(b);
  s[0] = 99;
  return [b[1], s[0], s.length];
}
console.log("4.4 slice static", JSON.stringify(copies(function (b) { return b.slice(1, 3); })));
console.log("4.5 slice dyn", JSON.stringify(copies(function (b) { return id(b).slice(1, 3); })));
console.log("4.6 slice through the prototype",
  JSON.stringify(copies(function (b) { return A.prototype.slice.call(b, 1, 3); })));
// A view of a view resolves to the owner, and negative indices clamp
// from the end like slice's.
var owner = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
var v1 = id(owner).subarray(2, 7);
var v2 = id(v1).subarray(1, -1);
v2[0] = 88;
console.log("4.7 view of a view", v1.length, v2.length, owner[3], v1[1]);

// ── 5. construction ───────────────────────────────────────────────────
console.log("5.1 new from a length", new A(3).length);
var fromArr = new A([1, 2, 300]);
console.log("5.2 new from an array", fromArr.length, fromArr[0], fromArr[2]);
var fromBytes = new A(new Uint8Array([7, 8]));
console.log("5.3 new from a typed array", fromBytes.length, fromBytes[1]);
console.log("5.4 the copy is independent", (function () {
  var src = new Uint8Array([7, 8]);
  var cp = new A(src);
  cp[0] = 1;
  return [src[0], cp[0]];
})().join(","));
console.log("5.5 no arguments", new A().length);
t("5.6 called without new", function () { return A(4); });
t("5.7 a negative length", function () { return new A(-1); });

// ── 6. `new x.constructor(0)` — protobufjs's Reader.prototype.raw ─────
var reader = id({ buf: new Uint8Array([1, 2, 3]), pos: 0 });
console.log("6.1 constructor", typeof reader.buf.constructor,
  reader.buf.constructor === Uint8Array);
console.log("6.2 built through it", new reader.buf.constructor(0).length);
console.log("6.3 the raw() branch", (function (start, end) {
  return start === end ? new reader.buf.constructor(0) : _slice.call(reader.buf, start, end);
})(1, 1).length);
console.log("6.4 the other branch", (function (start, end) {
  return start === end ? new reader.buf.constructor(0) : _slice.call(reader.buf, start, end);
})(0, 2).length);

// ── 7. the members this tier does not implement ───────────────────────
// Node HAS them, so the READ answers a function here too; the refusal
// lands where the work would, and it is the same refusal the ordinary
// call spelling gives.
console.log("7.1 they read as functions",
  typeof A.prototype.fill, typeof A.prototype.set, typeof A.prototype.map,
  typeof A.prototype.toBase64);
console.log("7.2 a name nothing declares", A.prototype.zzz);

// ── 8. an instance still behaves like one ─────────────────────────────
var inst = new A([3, 1, 2]);
console.log("8.1 length/index", inst.length, inst[0], inst[2]);
console.log("8.2 instanceof", inst instanceof Uint8Array);
console.log("8.3 JSON", JSON.stringify(inst));
console.log("8.4 at", id(inst).at(-1), id(inst).at(0));
console.log("8.5 writes land", (function () { inst[1] = 9; return inst[1]; })());
console.log("done");
