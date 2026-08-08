// join and the default sort comparator run the ELEMENT'S OWN toString.
// Array.prototype.join and SortCompare both convert through JS's ToString,
// which means an own or inherited `toString` runs, a RegExp answers
// /source/flags, and a caught error answers "Name: message". The runtime's
// join/sort renderer answered the "[object Object]" constant for all three
// instead, so a dyn array printed one thing where the same value printed
// another through String() — and the default sort ORDERED on the constant,
// which is a wrong answer you cannot see by looking at any single element.
function boxed(v) {
  return v;
}
function show(tag, s) {
  console.log(tag + " = " + s);
}

// An own toString, through join and through the sort key.
var own = boxed({
  toString: function () {
    return "OWN";
  },
});
show("join own", boxed([own, "b"]).join(""));
show("String(own)", String(own));

// The sort ORDER must come from the toString image: "OWN" sorts BEFORE
// "b", and so does the "[object Object]" constant — so the probe uses an
// image that sorts the other way round and cannot pass by coincidence.
var zed = boxed({
  toString: function () {
    return "zzz";
  },
});
show("sort order", boxed([zed, "b"]).sort().join("|"));

// A prototype-chain toString counts too: `K.prototype.toString = fn` is
// where JS programs put one.
function K() {}
K.prototype.toString = function () {
  return "K!";
};
show("join proto", boxed([new K(), new K()]).join("+"));

// RegExp owns RegExp.prototype.toString.
show("join regexp", boxed([/ab+c/gi]).join(""));

// A caught error carries the tree's error encoding, which renders
// Error.prototype.toString.
var err;
try {
  throw new TypeError("kaboom");
} catch (e) {
  err = boxed(e);
}
show("join error", boxed([err]).join(""));

// ...unless it carries its OWN toString, which shadows Error.prototype's.
// The display walker used to check the error encoding BEFORE the protocol,
// so this answered the encoded form through String() and the override
// through .toString(): one value, two answers.
var err2;
try {
  throw new RangeError("rk");
} catch (e) {
  err2 = boxed(e);
}
err2.toString = function () {
  return "MINE";
};
show("String(err2)", String(err2));
show("err2.toString()", err2.toString());
show("join err2", boxed([err2]).join(""));
show("sort err2", boxed([err2, "b"]).sort().join("|"));

// Nested arrays flatten through the same recursion.
show("nested join", boxed([[own, "x"], "y"]).join("|"));

// Nullish elements still print empty and still take a separator.
show("nullish", boxed([own, null, undefined, "t"]).join("-"));

console.log("done");
