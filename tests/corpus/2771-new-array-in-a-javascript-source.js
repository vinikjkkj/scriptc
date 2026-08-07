// `new Array(...)` in a JavaScript source, where the checker types the
// result `any[]` and there is no static array to build.
//
// The static tier already lowers `new Array(n)` (arrayNewLen) and the
// elements form (an array literal) whenever the element type has a home.
// A JavaScript source usually has none: the lib's one-number overload
// says `any[]` outright, and `any` has no static representation — so the
// whole construct met SC2011 ("no static representation but runs in the
// embedded dynamic engine"). The array LITERAL at the same slot did not:
// it has built a dyn ARRAY there since the JS declaration fallback
// shipped. This is the constructor taking the same fallback, so
// length/index/method uses ride the keyed-dyn paths that already carry
// them.
//
// Two facts about `new Array` make it more than "the literal with a
// length". A single NUMBER argument is a LENGTH and any other single
// value is the array's one ELEMENT — a fact about the runtime value, so
// an implicitly-any argument cannot be decided statically and the
// dispatch happens where JS does it. And a length that is not a
// non-negative integer below 2^32 is a `RangeError: Invalid array
// length`, not a truncation.
//
// DECLARED, and deliberately not probed below: JS's holes are this
// tier's undefined values. `new Array(3)` answers 3 for `.length`, ",,"
// for `join`, `[null,null,null]` for `JSON.stringify` and `undefined`
// for every index read — all exactly Node — but `0 in a` answers true
// where Node says false, `Object.keys(a)` lists the indices Node omits,
// and `forEach`/`map` visit slots Node skips. That is the same stance
// the keyed index write already took ("holes padding with undefined
// exactly like JS length growth"), stated rather than pretended away.

// --- the length form, and the index fill it is written for ------------
var a = new Array(3);
console.log(a.length, JSON.stringify(a), a.join(","), String(a));
console.log(Array.isArray(a), typeof a[0], a[0], a[7]);
for (var i = 0; i < a.length; i++) a[i] = i * 2;
console.log(a.join(","), a.length);
// A write past the end grows the array, JS-style.
a[5] = "x";
console.log(a.length, JSON.stringify(a));
console.log(new Array(0).length, JSON.stringify(new Array(0)));

// --- the runtime-arity spelling: protobufjs's aspromise tail ----------
// `new Array(arguments.length - 1)` then an index fill is the reason this
// construct is on the critical path at all. (Zero declared parameters
// here: `arguments` beside a declared parameter is its own item.)
function pack() {
  var out = new Array(arguments.length - 1);
  var offset = 1;
  var index = 0;
  while (offset < arguments.length) out[index++] = arguments[offset++];
  return out;
}
console.log(JSON.stringify(pack("skip", 1, 2, 3)));
console.log(JSON.stringify(pack("skip")));
console.log(pack("skip", "a").length, JSON.stringify(pack("skip", null, false)));
// The no-argument call asks for a length of -1, which is not a length.
try {
  pack();
} catch (err) {
  console.log("pack()", err.name + ": " + err.message);
}

// --- no arguments, and the ELEMENTS form ------------------------------
var e = new Array();
console.log(e.length, JSON.stringify(e));
e.push(1);
e.push("two");
console.log(JSON.stringify(e), e.length);
console.log(JSON.stringify(new Array(1, 2, 3)));
console.log(JSON.stringify(new Array("a", "b")));

// --- the ONE-argument fork, decided by the runtime VALUE ---------------
// `v` is implicitly any: nothing static says whether the call means a
// length or an element, and guessing either way is wrong at every call
// with the other kind.
function mk(v) {
  return new Array(v);
}
console.log(JSON.stringify(mk(2)), mk(2).length);
console.log(JSON.stringify(mk("2")), mk("2").length);
console.log(JSON.stringify(mk(null)), mk(null).length);
console.log(JSON.stringify(mk(true)), JSON.stringify(mk([7])));
console.log(JSON.stringify(mk(0)), JSON.stringify(mk("")));

// --- lengths that are not lengths --------------------------------------
function bad(n) {
  try {
    return "length " + new Array(n).length;
  } catch (err) {
    return err.name + ": " + err.message;
  }
}
console.log(bad(-1));
console.log(bad(1.5));
console.log(bad(NaN));
console.log(bad(4294967296));
console.log(bad(Infinity));
console.log(bad(-0));
console.log(bad(2));
// The literal spelling throws the same way, out of a nested call.
try {
  console.log(new Array(-3).length);
} catch (err) {
  console.log("caught", err.name, err.message);
}
