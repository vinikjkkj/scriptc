// The EVOLVING object literal and the keyed write in VALUE position —
// protobufjs's enum-table factory, which is one line and needs both.
//
//     $root.E2EE = (function () {
//         var valuesById = {}, values = Object.create(valuesById);
//         return values[valuesById[0] = "E2EE"] = 0, values;
//     })();
//
// Three things have to hold together:
//
//   1. `var e = {}` in a JS file is an object that GROWS its own keys.
//      tsc's expando inference answers a type naming every property a
//      later assignment adds (`{ 0: string }`), but the value the
//      declaration creates has none of them — `console.log(e)` right
//      after it prints `{}`, and a fixed-shape struct cannot print that.
//   2. `Object.create(e)` links to that object LIVE: a key added to the
//      prototype AFTER the child exists reads through the child, own-key
//      observations (Object.keys / JSON.stringify / hasOwn) never see it,
//      and a write to the child SHADOWS instead of mutating.
//   3. `t[k] = v` is an expression, and its value is `v`. The enum
//      factory nests one inside another's KEY (`t[e[0] = "A"] = 0`),
//      returns them through a comma chain, and a parenthesized
//      assignment can be the RECEIVER — `(t = Object.create(e))[k] = 0`.
//
// Node is the oracle byte-for-byte.
"use strict";

// 1. The declaration creates the EMPTY object, whatever tsc names.
var empty = {};
console.log(empty, JSON.stringify(empty), Object.keys(empty).length);
empty[0] = "late";
console.log(empty, JSON.stringify(empty), Object.keys(empty).length);

// 2+3. The factory, verbatim in shape: nested keyed writes in value
// position, a comma chain, expando prototype.
function mkEnum() {
  var e = {}, t = Object.create(e);
  return t[e[0] = "A"] = 0, t[e[1] = "B"] = 1, t[e[2] = "C"] = 2, t;
}
var E = mkEnum();
// Own keys are the FORWARD table; the prototype answers the reverse one.
console.log(JSON.stringify(E), Object.keys(E).join(","));
console.log(E.A, E.B, E.C);
console.log(E[0], E[1], E[2]);
console.log(Object.hasOwn(E, "A"), Object.hasOwn(E, "0"), "0" in E);

// Two calls make two independent tables.
var E2 = mkEnum();
console.log(E === E2, JSON.stringify(E2), E2[1]);

// The yielded value of a keyed write is the assigned value, not the key.
var box = {};
var yielded = (box["k"] = 41 + 1);
console.log(yielded, JSON.stringify(box));
var chained = {};
var alsoYielded = (chained[chained["a"] = "b"] = "c");
console.log(alsoYielded, JSON.stringify(chained));

// A PARENTHESIZED ASSIGNMENT as the receiver, with an assignment key.
var proto = {}, child;
(child = Object.create(proto))[proto[7] = "seven"] = 7;
console.log(JSON.stringify(child), Object.keys(child).join(","), child[7], child.seven);

// Live delegation: a key added to the prototype AFTER the child exists.
proto[8] = "eight";
console.log(child[8], JSON.stringify(child), Object.keys(child).join(","));

// A write SHADOWS the prototype rather than mutating it.
var base = {};
base["tag"] = "from-proto";
var kid = Object.create(base);
console.log(kid.tag, Object.hasOwn(kid, "tag"));
kid["tag"] = "own";
console.log(kid.tag, base.tag, JSON.stringify(kid), JSON.stringify(base));

// 4. The NULL-prototype dictionary takes the same writes, and inherits
// nothing at all.
var dict = Object.create(null);
var back = (dict[1 + 1] = "two");
console.log(back, JSON.stringify(dict), Object.keys(dict).join(","));
dict[dict["name"] = "id"] = "value";
console.log(JSON.stringify(dict), Object.keys(dict).join(","));
console.log(dict);

// Keys stringify — ToPropertyKey. A number and its digits are one key,
// in both positions.
function keyForms() {
  var keys = {};
  keys[3] = "num";
  console.log(keys["3"], JSON.stringify(keys), Object.keys(keys).length);
  var y = (keys["3"] = "str");
  console.log(y, keys[3], Object.keys(keys).length, JSON.stringify(keys));
}
keyForms();

// Insertion order is the enumeration order for string keys — which is
// what makes the enum table's own output stable, forward and reverse.
function ordering() {
  var ord = {};
  ord["z"] = 1;
  var mid = (ord["a"] = 2);
  ord["m"] = 3;
  console.log(mid, Object.keys(ord).join(","), JSON.stringify(ord));
}
ordering();

console.log("done");
