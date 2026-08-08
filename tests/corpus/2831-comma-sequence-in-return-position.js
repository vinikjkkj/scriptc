// A comma SEQUENCE in `return` position, whose leading operands need real
// control flow.
//
// `return a, b, v;` is what terser leaves wherever the source had statements
// and then a return, and the operands it packs in there are the same ones it
// packs everywhere else: short-circuit guards (`o(e) || (e = d(e))`) and
// value-less conditionals (`cond ? f() : g()`). Neither is a straight-line
// write, and a comma in VALUE position had nowhere to put a branch — the
// effect had to be emitted mid-expression, so the lowering refused.
//
// A ReturnStatement evaluates its Expression and nothing else: no target
// reference, no sibling operand, no re-evaluation. So `a; b; return v;` is
// the same evaluation in the same order, and the leading operands can simply
// become statements.
//
// The shape that made this worth closing is protobufjs's `float.js` — the
// IEEE-754 reader/writer install, one `return` with two typeof-guarded
// conditionals whose arms are IIFEs, run at module load by every protobufjs
// build before any message type exists. Section 1 is that file in miniature.
//
// A JavaScript entry: the minifier output this comes from is JS.

function show(label, value) {
  console.log(label + " -> " + typeof value + " " + String(value));
}

// ── 1. float.js: typeof-guarded conditionals with IIFE arms ─────────────
// Both arms are guarded feature tests whose value is discarded; only the
// third operand, `exports`, is the returned value.
function floatFactory(exports) {
  return "undefined" != typeof Float32Array
    ? (function () {
        var t = new Float32Array([-0]);
        var n = new Uint8Array(t.buffer);
        exports.f32le = 128 === n[3];
        exports.f32how = "typed";
      })()
    : (function () {
        exports.f32le = false;
        exports.f32how = "fallback";
      })(),
    "undefined" != typeof Float64Array
      ? (function () {
          var t = new Float64Array([-0]);
          var n = new Uint8Array(t.buffer);
          exports.f64le = 128 === n[7];
          exports.f64how = "typed";
        })()
      : (function () {
          exports.f64le = false;
          exports.f64how = "fallback";
        })(),
    exports;
}
var fx = floatFactory({ f32le: null, f32how: "?", f64le: null, f64how: "?" });
console.log("f32 " + fx.f32how + " le=" + fx.f32le + " | f64 " + fx.f64how + " le=" + fx.f64le);

// BOTH arms are live code, and the condition is a real runtime test — the
// sequence is split, not folded. Driving the same factory with a condition
// the compiler cannot know takes the other arm and runs the other IIFE.
function eitherFactory(exports, useTyped) {
  return useTyped
    ? (function () { exports.how = "typed"; })()
    : (function () { exports.how = "fallback"; })(),
    exports;
}
console.log(
  "arms -> " + eitherFactory({ how: "?" }, true).how +
  " / " + eitherFactory({ how: "?" }, false).how,
);

// ── 2. the short-circuit guard, long.js's spelling ──────────────────────
// `o(e) || (e = d(e)), <value>` — coerce the argument, then answer. Sixteen
// of protobufjs's Long methods are written exactly this way.
function isLong(v) { return typeof v === "object" && v !== null; }
function fromNumber(v) { return { lo: v | 0, hi: v < 0 ? -1 : 0 }; }
function addTo(self, e) {
  return isLong(e) || (e = fromNumber(e)), { lo: self.lo + e.lo, hi: self.hi + e.hi };
}
var base = { lo: 100, hi: 0 };
show("addTo(long)", JSON.stringify(addTo(base, { lo: 5, hi: 1 })));
show("addTo(number)", JSON.stringify(addTo(base, 7)));
show("addTo(negative)", JSON.stringify(addTo(base, -3)));

// `a && (b = …)` in the same slot, and a THREE-operand chain.
function guardedTriple(state, n) {
  return n > 0 && (state.seen = state.seen + n),
    n < 0 ? (state.neg = state.neg + 1) : (state.nonneg = state.nonneg + 1),
    state.seen * 10 + state.neg;
}
var st = { seen: 0, neg: 0, nonneg: 0 };
console.log(guardedTriple(st, 3), guardedTriple(st, -1), guardedTriple(st, 0));
console.log("state " + st.seen + " " + st.neg + " " + st.nonneg);

// ── 3. ORDER, and that only the TAIL is the value ───────────────────────
var trace = [];
function t(tag, value) { trace.push(tag); return value; }
function ordered() {
  return t("a", 1), t("b", 2), t("c", 3);
}
show("value is the tail", ordered());
console.log("order " + trace.join(""));

// A leading operand that THROWS skips every later operand and the return.
function explode() { throw new Error("stop"); }
function note(tag) { trace.push(tag); }
function boom(fail) {
  return fail ? explode() : note("ok"),
    note("after"),
    "reached";
}
trace = [];
show("no throw", boom(false));
console.log("order " + trace.join(","));
trace = [];
try {
  show("throws", boom(true));
} catch (err) {
  console.log("caught " + err.message + " | order " + trace.join(","));
}

// The tail is evaluated LAST, so it sees every effect the leading operands
// made.
function tailSeesEffects(o) {
  return o.n = o.n + 1, o.n = o.n * 2, o.n;
}
console.log(tailSeesEffects({ n: 5 }), tailSeesEffects({ n: 0 }));

// ── 4. nested chains, parentheses, and an explicitly grouped left ───────
// A comma chain associates left, so `(a, b), c` and `a, (b, c)` are the same
// sequence — and a parenthesized whole is still one.
function assoc(o) {
  return (o.a = 1, o.b = 2), (o.c = o.a + o.b), o.a + o.b + o.c;
}
console.log(assoc({}));
function nestedRight(o) {
  return o.x = 1, (o.y = 2, o.z = o.x + o.y), o.z * 3;
}
console.log(nestedRight({}));

// ── 5. the shape inside a loop, a try, and a nested function ────────────
function scan(list) {
  var total = 0;
  for (var i = 0; i < list.length; i++) {
    total += (function (v) {
      return typeof v === "string" ? (v = v.length) : (v = v | 0), v * 2;
    })(list[i]);
  }
  return total;
}
console.log(scan([1, "abc", 4, "de", 0]));

function guarded(n) {
  try {
    return n < 0 && (n = -n), n * 2;
  } finally {
    trace.push("finally" + n);
  }
}
trace = [];
console.log(guarded(-4), guarded(4), trace.join(" "));

// A returned FUNCTION value after leading effects — the module-factory
// shape, where the sequence installs and the tail hands back the callable.
function makeCounter(reg) {
  return reg.installed = true,
    reg.kind = "counter",
    function () { return reg.n = reg.n + 1, reg.n; };
}
var reg = { n: 0, installed: false, kind: "?" };
var counter = makeCounter(reg);
console.log(counter(), counter(), counter(), reg.installed, reg.kind);

// ── 6. a function EXPRESSION's return, the module-factory spelling ──────
var bumpTwice = function (o) { return o.k = o.k + 1, o.k = o.k + 1, o.k; };
console.log(bumpTwice({ k: 0 }), bumpTwice({ k: 10 }));
// An arrow's CONCISE body is a returned expression too, and a straight-line
// sequence has always compiled there (the seqExpr path). It is a different
// node from a ReturnStatement, so a concise body whose leading operand needs
// control flow still keeps the value-position fence — write the arrow with a
// braced body and a `return` and it lowers.
var conciseSeq = (o) => (o.k = o.k + 1, o.k * 2);
console.log(conciseSeq({ k: 4 }), conciseSeq({ k: 0 }));

// ── 7. the whole point: the codec init this unblocks ────────────────────
// A protobuf writer whose float support is installed by the section-1
// sequence, then used. Before this closed, the module never finished
// loading, so nothing below it existed.
function writerFactory(exports) {
  return exports.encodeFloat = "undefined" != typeof Float32Array
      ? function (val) {
          var f = new Float32Array([val]);
          var b = new Uint8Array(f.buffer);
          return b[0] + "," + b[1] + "," + b[2] + "," + b[3];
        }
      : function () { return "0,0,0,0"; },
    exports.ready = true,
    exports;
}
var w = writerFactory({ ready: false, encodeFloat: null });
console.log("ready=" + w.ready + " f32(1.5)=" + w.encodeFloat(1.5) + " f32(-2)=" + w.encodeFloat(-2));
