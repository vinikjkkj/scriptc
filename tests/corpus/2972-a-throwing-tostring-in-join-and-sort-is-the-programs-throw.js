// A toString that throws inside join or sort is the program's exception —
// but a toString reached while an ERROR MESSAGE is being built is not run
// at all, because it would replace the error the program actually hit.
//
// Both halves live in the same runtime renderer, which is why they are one
// fixture: making the display half run the protocol without separating the
// diagnostic half would let a user `toString` raise a second exception over
// the first. Node does not run it either — measured, v25.9.0.
function boxed(v) {
  return v;
}
function show(tag, s) {
  console.log(tag + " = " + s);
}
function T(tag, f) {
  try {
    show(tag, f());
  } catch (e) {
    show(tag, "caught " + e.name + ": " + e.message);
  }
}

var ran = 0;
var boom = boxed({
  toString: function () {
    ran++;
    throw new TypeError("no string for you");
  },
});

// DISPLAY: the throw propagates, catchably, and the remaining elements'
// toStrings — user code with side effects — do not run.
var second = 0;
var after = boxed({
  toString: function () {
    second++;
    return "after";
  },
});
T("join element", function () {
  return boxed([boom, after]).join("");
});
show("later element ran", second);

// The SEPARATOR converts first, once, before any element (the spec reads
// ToString(separator) ahead of the loop), so its throw beats every element.
var elems = 0;
var counted = boxed({
  toString: function () {
    elems++;
    return "e";
  },
});
T("join separator", function () {
  return boxed([counted, counted]).join(boom);
});
show("elements ran", elems);

// SortCompare converts x then y; the sort abandons at the first throw.
T("sort default", function () {
  return boxed([boom, "b"]).sort().join("|");
});

// DIAGNOSTIC: the same value used where an error message names it. Node
// renders the callback's TYPE, never its string image, and the comparator
// message renders the "[object Object]" constant even for an object whose
// toString works — so neither can reach user code.
var before = ran;
T("not a function", function () {
  return boxed([1]).forEach(boom);
});
T("bad comparator", function () {
  return boxed([1, 2]).sort(boom);
});
show("toString ran while building messages", ran - before);

// The type rendering, across the kinds a callback slot can hold.
T("cb object", function () {
  return boxed([1]).forEach(boxed({}));
});
T("cb number", function () {
  return boxed([1]).forEach(boxed(5));
});
T("cb string", function () {
  return boxed([1]).forEach(boxed("hi"));
});
T("cb null", function () {
  return boxed([1]).forEach(boxed(null));
});
T("cb undefined", function () {
  return boxed([1]).forEach(boxed(undefined));
});
T("cb boolean", function () {
  return boxed([1]).forEach(boxed(true));
});
T("cb array", function () {
  return boxed([1]).forEach(boxed([1, 2]));
});

console.log("done");
