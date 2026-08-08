// One value, one answer, whichever spelling reached it.
// JS's ToString over a value in the checked-dynamic tree lives in three
// copies — the per-program display walker, the runtime's renderer, and
// the runtime's join/sort renderer — and a copy that answers a kind
// differently from the others is one value giving two answers depending
// on how it was spelled. These are the arms where they must agree.
function boxed(v) {
  return v;
}
function show(tag, s) {
  console.log(tag + " = " + s);
}

// A caught error crosses into `unknown` as the tree's error encoding.
// Error.prototype.toString shadows Object.prototype's, so BOTH spellings
// answer "Name: message" — the renderer behind `.toString()` used to
// answer the "[object Object]" constant instead.
var err;
try {
  throw new TypeError("kaboom");
} catch (e) {
  err = boxed(e);
}
show("String(err)", String(err));
show("err.toString()", err.toString());
show("String([err])", String(boxed([err])));
show("`${err}`", `${err}`);

// An object with its OWN toString answers it through every spelling.
var own = boxed({
  toString: function () {
    return "OWN";
  },
});
show("String(own)", String(own));
show("own.toString()", own.toString());
show("String([own])", String(boxed([own])));

// A RegExp owns RegExp.prototype.toString, which is NOT
// Object.prototype's.
var re = boxed(/ab+c/gi);
show("String(re)", String(re));
show("re.toString()", re.toString());

// An error with no message renders its name alone, and one with no name
// renders the message alone — the same joining rule in every copy.
var bare;
try {
  throw new RangeError("");
} catch (e) {
  bare = boxed(e);
}
show("String(bare)", String(bare));
show("bare.toString()", bare.toString());
console.log("done");
