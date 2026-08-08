// A STRING METHOD taken as a VALUE, in JavaScript — the per-member LIFT.
//
// protobufjs's `longbits.js` opens its module body with
//
//     var charCodeAt = String.prototype.charCodeAt;
//     LongBits.fromHash = function (hash) { return charCodeAt.call(hash, 0) | ... };
//
// so the intrinsic is bound once and every use goes through
// `Function.prototype.call`. The tempting answer — hand back an opaque
// identity token for the READ — would make each of those `.call`s a
// runtime "is not a function" that no trap census can see. The answer here
// is a real function whose body IS the lowering an ordinary
// `s.charCodeAt(i)` call site gets, with the receiver resolved from the
// ambient-receiver window the bound wrapper opens.
//
// A detached method is not bound to whatever it was read through, so the
// receiver is resolved per call, exactly as the spec's first two steps say:
// RequireObjectCoercible, then ToString.

// 1. The protobufjs shape itself.
var charCodeAt = String.prototype.charCodeAt;
function firstFour(hash) {
  return (
    charCodeAt.call(hash, 0) +
    charCodeAt.call(hash, 1) * 256 +
    charCodeAt.call(hash, 2) * 65536 +
    charCodeAt.call(hash, 3) * 16777216
  );
}
console.log(charCodeAt.call("abc", 0), charCodeAt.call("abc", 1), charCodeAt.call("abc", 2));
console.log(firstFour("abcd"));

// 2. Out of range is NaN, not a throw — the intrinsic's own answer, which
//    is the point of lifting to the intrinsic instead of re-deriving it.
console.log(String(charCodeAt.call("abc", 9)));

// 3. The receiver a method is READ through is not remembered:
//    `"zzz".charCodeAt` and `String.prototype.charCodeAt` are the same
//    function in Node, and neither carries a `this`.
var alsoCharCodeAt = "zzz".charCodeAt;
console.log(alsoCharCodeAt.call("A", 0));

// 4. ToString of the receiver (step 2), object protocol included, so a
//    number receiver reads the digits of its decimal rendering.
console.log(charCodeAt.call(42, 0), charCodeAt.call(42, 1));

// 5. RequireObjectCoercible (step 1). Skipping it is the difference
//    between a lift and a silent wrong answer: ToString(undefined) is
//    "undefined", so this would otherwise answer 117.
try { charCodeAt.call(null, 0); } catch (e) { console.log(e.name + ": " + e.message); }
try { charCodeAt.call(undefined, 0); } catch (e) { console.log(e.name + ": " + e.message); }

// 6. Called with NO receiver at all. This file is an ES module, so `this`
//    is undefined at the call and step 1 throws — the same throw, reached
//    without any `.call` in sight.
try { charCodeAt(0); } catch (e) { console.log(e.name + ": " + e.message); }

// 7. `.apply` with a statically known argument list is the same machinery.
console.log(charCodeAt.apply("xyz", [1]));

// 8. The rule is per-member, not per-name: a member lifts only when the
//    checker's own signature for it is exactly the one the string
//    intrinsic implements. These four are; `split` (a `string | RegExp`
//    separator) and `slice` (omitted-argument defaults) are not, and keep
//    their fence.
var charAt = String.prototype.charAt;
var toUpperCase = String.prototype.toUpperCase;
var repeat = String.prototype.repeat;
var trim = String.prototype.trim;
console.log(charAt.call("hello", 1), toUpperCase.call("mixed Case"));
console.log(repeat.call("ab", 3), "[" + trim.call("  pad  ") + "]");

// 9. The lifted value is an ordinary function value from here on: it can
//    be passed, stored and re-bound, and `Function.prototype.bind` routes
//    the receiver through the same window.
var boundToAbc = charCodeAt.bind("abc");
console.log(boundToAbc(0), boundToAbc(2));
function twice(f, s) { return f.call(s, 0) + f.call(s, 1); }
console.log(twice(charCodeAt, "AB"));
