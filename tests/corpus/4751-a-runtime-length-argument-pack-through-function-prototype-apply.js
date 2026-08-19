// `fn.apply(thisArg, <runtime-length pack>)` over a COMPILED function value.
//
// protobufjs's `util.asPromise` is the site: it builds `var t = new
// Array(arguments.length - 1)`, fills it by index, and calls
// `r.apply(null, t)` where `r` is the Promise executor's `resolve`. The pack
// has no static length, so no direct call can be spelled for it — and the
// SAME call through a receiver the checker types as `any` has always routed
// to scr_dyn_invoke's FUNC arm and run JS-exact. Only the typed receiver
// refused. This program pins the arity rule the dyn thunk implements
// (`i < argc ? args[i] : undefined` — JS's own), the receiver binding, and
// the two spellings that must keep their old lowering.

"use strict";

function pack(n) {
  var t = new Array(n);
  for (var i = 0; i < n; i++) t[i] = i * 10;
  return t;
}

// --- arity: short packs pad with undefined, long packs drop the tail -------
function one(a) { console.log("one:" + a); return a; }
function two(a, b) { console.log("two:" + a + "|" + b); return "" + a + "/" + b; }

console.log("r0:" + one.apply(null, pack(0)));
console.log("r1:" + one.apply(null, pack(1)));
console.log("r3:" + one.apply(null, pack(3)));
console.log("s2:" + two.apply(null, pack(2)));
console.log("s1:" + two.apply(null, pack(1)));
console.log("s0:" + two.apply(null, pack(0)));

// --- the ARRAY-LITERAL spelling keeps its DIRECT call ----------------------
// (exact arity, no box, no dyn dispatch — the arm that was already there)
console.log("lit:" + one.apply(null, [7]));
console.log("lit2:" + two.apply(null, [7, 8]));

// --- the receiver `apply` binds -------------------------------------------
function reader(sep) { console.log("tag" + sep + this.tag); }
var host = { tag: "H" };
reader.apply(host, pack(0));
reader.apply(host, ["="]);

// --- a REST receiver: `arguments` is the whole pack ------------------------
function counted() {
  console.log("counted:" + arguments.length + ":" + arguments[0] + ":" + arguments[2]);
}
counted.apply(null, pack(0));
counted.apply(null, pack(3));

// --- `arguments` AS the pack: the forwarding wrapper -----------------------
function forward() { return one.apply(null, arguments); }
console.log("fwd1:" + forward(99));
console.log("fwd0:" + forward());

// --- protobufjs's util.asPromise, reduced but unchanged in shape ----------
function asPromise(fn, ctx) {
  var params = new Array(arguments.length - 2);
  var offset = 0;
  var index = 2;
  var pending = true;
  while (index < arguments.length) params[offset++] = arguments[index++];
  return new Promise(function (resolve, reject) {
    params[offset] = function (err) {
      if (pending) {
        pending = false;
        if (err) reject(err);
        else {
          var args = new Array(arguments.length - 1);
          var i = 0;
          while (i < args.length) args[i] = arguments[++i];
          resolve.apply(null, args);
        }
      }
    };
    try {
      fn.apply(ctx || null, params);
    } catch (err) {
      if (pending) { pending = false; reject(err); }
    }
  });
}

function svc(a, cb) { cb(null, "ok:" + a); }
function svcNoValue(cb) { cb(null); }
function svcThrows() { throw new Error("boom"); }

asPromise(svc, null, 5)
  .then(function (v) { console.log("promise:" + v); return asPromise(svcNoValue, null); })
  .then(function (v) { console.log("promise-empty:" + v); return asPromise(svcThrows, null); })
  .then(function () { console.log("unreachable"); })
  .catch(function (e) { console.log("caught:" + e.message); });
