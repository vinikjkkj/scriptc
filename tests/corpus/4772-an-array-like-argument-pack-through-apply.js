// `fn.apply(thisArg, pack)` where the pack is ARRAY-LIKE but not an Array.
//
// ECMA-262 7.3.18 CreateListFromArrayLike takes any OBJECT: it reads
// `length`, runs ToLength over it, then reads the index keys 0..len-1.
// Node therefore runs `one.apply(null, new Uint8Array([1,2]))` and
// `one.apply(null, {length:2, 0:100, 1:101})`. This runtime tested the
// value's KIND instead (`list->kind != SCR_DYN_ARR`) and threw
// "CreateListFromArrayLike called on non-object" at both -- which is the
// message for a case that is not this one, since an array-like pack IS an
// object. estado-apply.md 7.2 measured it, priced the fix at 50-70 lines
// of C, and left it; corpus 4751's row closed on top of it and added
// instances.
//
// Every packet below is a RUNTIME value (JSON.parse, or a typed array),
// so no lowering can see its kind -- the pack's kind is a run-time fact,
// which is exactly why no lowering fence could have helped.
//
// The rows that already MATCHED are here too, because a fix that only
// widens is not a fix: a string, a number and a boolean pack are not
// objects and Node throws that same TypeError at them.
"use strict";

function one(a, b) { console.log("one:" + a + "," + b); }

function attempt(label, p) {
  try { one.apply(null, p); } catch (e) { console.log(label + " threw: " + e.message); }
}

// --- the two packs Node runs and this runtime refused ----------------------
attempt("u8", new Uint8Array([1, 2]));
attempt("obj", JSON.parse('{"length":2,"0":100,"1":101}'));

// --- ToLength, in the four shapes that make it a conversion ---------------
attempt("hole", JSON.parse('{"length":3,"0":7}'));        // holes read undefined
attempt("zero", JSON.parse('{"length":0}'));              // an empty pack
attempt("nolen", JSON.parse('{}'));                       // ToLength(undefined) = 0
attempt("frac", JSON.parse('{"length":1.9,"0":"x","1":"y"}')); // truncates toward zero
attempt("neg", JSON.parse('{"length":-1,"0":"x"}'));      // every negative is 0
attempt("strlen", JSON.parse('{"length":"2","0":"s0","1":"s1"}')); // ToNumber first

// (A WIDER typed array -- Uint32Array/Float64Array -- would exercise the
// same element read at its own width, and the runtime arm below does go
// through scr_bytes_get for exactly that reason. It is not pinned here
// because boxing a non-u8 typed value into `unknown` is a separate,
// pre-existing refusal: SC1101 "converting typed values to 'unknown' is
// not supported yet". Named rather than quietly dropped.)

// --- a real array still takes the direct path -----------------------------
attempt("arr", JSON.parse('[5,6]'));

// --- and the packs that are NOT objects keep Node's TypeError -------------
attempt("str", "ab");
attempt("num", 5);
attempt("bool", true);
attempt("null", null);

// --- the receiver binds through an array-like pack too --------------------
function reader(sep) { console.log("tag" + sep + this.tag); }
var host = { tag: "H" };
try {
  reader.apply(host, JSON.parse('{"length":1,"0":"-"}'));
} catch (e) {
  console.log("bind threw: " + e.message);
}

console.log("after");
