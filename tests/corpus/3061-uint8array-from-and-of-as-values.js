// `Uint8Array.from` and `Uint8Array.of` — the two STATIC methods, as
// VALUES and as calls.
//
// protobufjs reads the first one and never calls it. This is the whole
// site, verbatim from `util._configure`:
//
//     util._Buffer_from = Buffer.from !== Uint8Array.from && Buffer.from
//                      || function (value, encoding) { … };
//
// `util.Buffer` is NULL in a compiled program — there is no Buffer
// OBJECT for protobufjs's feature test (`util.global.Buffer.prototype
// .utf8Write`) to find — so Node's answer for the whole conditional and
// this one's agree: both `_Buffer_from` and `_Buffer_allocUnsafe` end up
// null and the library takes its Uint8Array path. But the compiled
// program could not GET there: tsc types `Uint8ArrayConstructor.from` as
// a generic callable member, so the object-literal-method rule claimed
// the read with SC1090, and the trap sat in the arm that never runs —
// where a best-effort trap poisons the whole statement. `_configure()`
// threw where Node returns.
//
// A value that cannot be read is not a value, so both are real:
//
//   1. Node's shape. `from.name` is "from" and `from.length` is 1;
//      `of.length` is 0. One box per process, so `Uint8Array.from ===
//      Uint8Array.from` is identity and `from !== of`.
//   2. Node's OWN/INHERITED split, which is the reason they are answered
//      off the constructor BOX rather than out of its property table:
//      both live on %TypedArray%, so `Object.hasOwn(Uint8Array, "from")`
//      is FALSE while `"from" in Uint8Array` is true, and
//      `Object.keys(Uint8Array)` stays [].
//   3. Node's algorithm. `from` reads an array, another typed array, a
//      string (by CODE POINT), or an array-like `length`/index walk; the
//      element conversion is the ToUint8 WRAP (300 is 44); a mapfn runs
//      with (value, index) and the third argument as `this`; and the
//      receiver, mapfn and source checks throw V8's own TypeErrors, in
//      the spec's order (`from(null, 5)` blames the 5).
//
// DELIBERATE DIVERGENCES, none printed:
//   * `util.Buffer` itself. Node finds a Buffer constructor and takes
//     the `_Buffer_from = Buffer.from` arm; a compiled program finds
//     nothing (`Buffer` as a value is the identifier chokepoint's token,
//     so the feature test's `.prototype` read throws inside its own
//     try/catch) and takes the null arm — protobufjs's browser path,
//     which is the one this tier can run. Section 3 drives both arms
//     with a stand-in so the printed answers agree.
//   * A source this tier cannot iterate — a Set, a Map, a promise, a
//     native handle — refuses BY NAME instead of answering the empty
//     typed array an array-like walk would produce. Node iterates them.
//   * A callable receiver that is not a typed-array constructor is
//     rendered `#<Name>`; V8 renders some of its own builtins
//     differently (`Uint8Array.from.call(Array, …)` says `[object
//     Array]` there). No such receiver exists in this tier.
//   * A TypeScript source keeps SC2020 on the CALL spelling
//     `Uint8Array.from(x)` — the static call has no lowering. This file
//     is JavaScript, where the value is the singleton and the call runs
//     through it.

function show(b) {
  var s = "";
  for (var i = 0; i < b.length; i++) {
    if (i) s += ",";
    s += b[i];
  }
  return "[" + s + "] len=" + b.length;
}

function t(name, fn) {
  try {
    console.log(name, "->", fn());
  } catch (e) {
    console.log(name, "THREW", String(e));
  }
}

// ── 1. the values themselves ─────────────────────────────────────────
console.log("typeof from", typeof Uint8Array.from, "typeof of", typeof Uint8Array.of);
console.log("from.name", Uint8Array.from.name, "from.length", Uint8Array.from.length);
console.log("of.name", Uint8Array.of.name, "of.length", Uint8Array.of.length);
console.log("from === from", Uint8Array.from === Uint8Array.from);
console.log("from === of", Uint8Array.from === Uint8Array.of);
console.log("String(from)", String(Uint8Array.from));

// ── 2. Node's own/inherited split ────────────────────────────────────
console.log("hasOwn(U,from)", Object.hasOwn(Uint8Array, "from"));
console.log("hasOwn(U,of)", Object.hasOwn(Uint8Array, "of"));
console.log("from in U", "from" in Uint8Array, "of in U", "of" in Uint8Array);
console.log("zzz in U", "zzz" in Uint8Array);
console.log("Object.keys(U)", Object.keys(Uint8Array).length);
console.log("U.zzz", String(Uint8Array.zzz));

// ── 3. protobufjs's expression, whole ────────────────────────────────
// The `_configure` chain with a STAND-IN for `util.Buffer`, so both arms
// run and both answer the same here and in Node. The real
// `util.Buffer` is a Buffer CONSTRUCTOR in Node and null in a compiled
// program, so printing what protobufjs actually picks would print two
// different (and both correct) things — the divergence is stated in the
// header instead.
function fallbackFrom(value, encoding) {
  return "fallback:" + value + ":" + encoding;
}
function pickFrom(B) {
  return (B.from !== Uint8Array.from && B.from) || fallbackFrom;
}
var ownFrom = function (v, e) { return "own:" + v + ":" + e; };
// The picked function is CALLED rather than compared, because comparing
// two `any`-typed function values is its own pre-existing fence (SC2011)
// and this file is about the operands, not about that.
console.log("pick(own)", pickFrom({ from: ownFrom })("x", "base64"));
// A shim whose `from` IS `Uint8Array.from` — the exact case the `!==`
// exists to catch. The inequality is false, so the fallback wins.
console.log("pick(shim)", pickFrom({ from: Uint8Array.from })("x", "base64"));
console.log("pick(none)", pickFrom({})("x", "base64"));

// The no-Buffer arm of `_configure`, spelled as protobufjs spells it: a
// CHAINED assignment through a checked-dynamic receiver, in the
// not-taken branch of a conditional expression. It is the shape the trap
// above used to poison, and the chain itself was an ICE ("local
// '%setVal' has bare unit type nullT") the moment the other arm started
// compiling.
var cfg = {};
cfg._Buffer_from = null;
cfg._Buffer_allocUnsafe = null;
cfg._configure = function () {
  var B = cfg.Buffer;
  B
    ? ((cfg._Buffer_from =
        (B.from !== Uint8Array.from && B.from) ||
        function (value, encoding) {
          return new B(value, encoding);
        }),
      (cfg._Buffer_allocUnsafe =
        B.allocUnsafe ||
        function (size) {
          return new B(size);
        }))
    : (cfg._Buffer_from = cfg._Buffer_allocUnsafe = null);
};
cfg._configure();
console.log("_configure", String(cfg._Buffer_from), String(cfg._Buffer_allocUnsafe));

// ── 4. from, over every source this tier reads ───────────────────────
t("from([1,2,300])", function () { return show(Uint8Array.from([1, 2, 300])); });
t("from([])", function () { return show(Uint8Array.from([])); });
t("from([1.7,-1,256,NaN])", function () { return show(Uint8Array.from([1.7, -1, 256, NaN])); });
t('from(["3",null,undefined])', function () { return show(Uint8Array.from(["3", null, undefined])); });
t("from(u8)", function () { return show(Uint8Array.from(new Uint8Array([9, 8]))); });
t('from("123")', function () { return show(Uint8Array.from("123")); });
t('from("1a")', function () { return show(Uint8Array.from("1a")); });
t('from("")', function () { return show(Uint8Array.from("")); });
t("from({length:3,0:5,1:6,2:7})", function () { return show(Uint8Array.from({ length: 3, 0: 5, 1: 6, 2: 7 })); });
t("from({length:2})", function () { return show(Uint8Array.from({ length: 2 })); });
t("from({})", function () { return show(Uint8Array.from({})); });
t("from({length:-1})", function () { return show(Uint8Array.from({ length: -1 })); });
t("from({length:1.9,0:7})", function () { return show(Uint8Array.from({ length: 1.9, 0: 7 })); });
t("from(5)", function () { return show(Uint8Array.from(5)); });
t("from(true)", function () { return show(Uint8Array.from(true)); });
t("from(fn2)", function () { return show(Uint8Array.from(function (a, b) { return a + b; })); });

// A fresh, INDEPENDENT typed array — from() copies, it never aliases.
t("from(u8) is a copy", function () {
  var src = new Uint8Array([1, 2, 3]);
  var out = Uint8Array.from(src);
  out[0] = 99;
  return show(src) + " / " + show(out);
});

// ── 5. the mapfn ─────────────────────────────────────────────────────
t("from([1,2,3], x=>x*2)", function () { return show(Uint8Array.from([1, 2, 3], function (x) { return x * 2; })); });
t("from([1,2,3], (x,i)=>i)", function () { return show(Uint8Array.from([1, 2, 3], function (x, i) { return i; })); });
t("from([1], undefined)", function () { return show(Uint8Array.from([1], undefined)); });
t("from thisArg", function () {
  var out = Uint8Array.from([1, 2], function (x) { return x + this.bump; }, { bump: 10 });
  return show(out);
});
t("mapfn over an array-like", function () {
  return show(Uint8Array.from({ length: 2, 0: 1, 1: 2 }, function (x, i) { return x * 10 + i; }));
});
t("from([1,2],5)", function () { return show(Uint8Array.from([1, 2], 5)); });
t('from([1],"x")', function () { return show(Uint8Array.from([1], "x")); });
t("from([1],{})", function () { return show(Uint8Array.from([1], {})); });
t("from([1],null)", function () { return show(Uint8Array.from([1], null)); });
t("from(null,5) blames the 5", function () { return show(Uint8Array.from(null, 5)); });

// ── 6. the nullish source ────────────────────────────────────────────
t("from()", function () { return show(Uint8Array.from()); });
t("from(undefined)", function () { return show(Uint8Array.from(undefined)); });
t("from(null)", function () { return show(Uint8Array.from(null)); });

// ── 7. of ────────────────────────────────────────────────────────────
t("of()", function () { return show(Uint8Array.of()); });
t("of(1,2,300)", function () { return show(Uint8Array.of(1, 2, 300)); });
t('of("3",null,true)', function () { return show(Uint8Array.of("3", null, true)); });

// ── 8. the receiver ──────────────────────────────────────────────────
// A detached read remembers NO receiver — the same rule the prototype
// methods follow — so calling one bare is Node's "undefined is not a
// constructor", and `.call(Uint8Array, …)` is what supplies one.
t("detached from([1,2])", function () {
  var f = Uint8Array.from;
  return show(f([1, 2]));
});
t("from.call(Uint8Array,[1,2])", function () { return show(Uint8Array.from.call(Uint8Array, [1, 2])); });
t("from.call(null,[1])", function () { return show(Uint8Array.from.call(null, [1])); });
t("from.call(5,[1])", function () { return show(Uint8Array.from.call(5, [1])); });
t("from.call({},[1])", function () { return show(Uint8Array.from.call({}, [1])); });
t("from.call([],[1])", function () { return show(Uint8Array.from.call([], [1])); });
t("of.call(undefined,1)", function () { return show(Uint8Array.of.call(undefined, 1)); });
t("from.call(F,[1])", function () {
  function F() {}
  return show(Uint8Array.from.call(F, [1]));
});

// ── 9. the result is an ordinary typed array ─────────────────────────
t("result identity", function () {
  var b = Uint8Array.from([1, 2, 3]);
  return (
    (b instanceof Uint8Array) + " " +
    (b.constructor === Uint8Array) + " " +
    show(b.subarray(1, 3))
  );
});

console.log("done");
