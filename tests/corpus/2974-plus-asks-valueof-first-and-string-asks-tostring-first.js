// `"" + v` and `String(v)` are DIFFERENT conversions and an object can
// answer them differently — that is the language, not a rounding error.
//
// ToPrimitive takes a hint. `+` (ApplyStringOrNumericBinaryOperator)
// passes none, which is the DEFAULT hint, and OrdinaryToPrimitive runs
// `valueOf` before `toString` for it. `String(v)`, a template span and a
// computed key pass the STRING hint, which runs them the other way round.
// The untyped `+` lowered to the string-hint conversion, so an object
// carrying both methods answered its `toString` through every spelling.
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

var both = boxed({
  valueOf: function () {
    return 42;
  },
  toString: function () {
    return "TS";
  },
});
show("plus", "" + both);
show("plus right", both + "");
show("String", String(both));
show("template", `${both}`);
show("plus number side", "n:" + both);

// valueOf ALONE: `+` takes it, String() never looks (Object.prototype's
// toString answers first and "[object Object]" is a primitive).
var vo = boxed({
  valueOf: function () {
    return 7;
  },
});
show("plus valueOf only", "" + vo);
show("String valueOf only", String(vo));

// toString ALONE: `+` falls through to it, because Object.prototype's
// valueOf answers the object itself, which is not primitive.
var ts = boxed({
  toString: function () {
    return "only";
  },
});
show("plus toString only", "" + ts);
show("String toString only", String(ts));

// The prototype chain counts for both — ToPrimitive is a [[Get]].
function K() {}
K.prototype.valueOf = function () {
  return 5;
};
K.prototype.toString = function () {
  return "Kstr";
};
show("plus proto", "" + boxed(new K()));
show("String proto", String(boxed(new K())));

// A throw inside valueOf is the program's throw, and toString is NOT
// tried after it — the spec calls one method and propagates.
var reached = 0;
var vthrow = boxed({
  valueOf: function () {
    throw new TypeError("valueOf says no");
  },
  toString: function () {
    reached++;
    return "unreached";
  },
});
T("plus throws", function () {
  return "" + vthrow;
});
show("toString reached", reached);

// A String() over the same object takes toString and never throws.
show("String of it", String(vthrow));

// The kinds that have no protocol at all are unchanged by any of this.
show("plus array", "" + boxed([1, 2]));
show("plus number", "" + boxed(3));
show("plus null", "" + boxed(null));
show("plus undefined", "" + boxed(undefined));
show("plus bool", "" + boxed(true));

// The arms that have no USER valueOf must still answer the ordinary
// ToString, NOT the spec's "exhausted the protocol" TypeError: JS's
// Object.prototype.valueOf answers the object itself, so ToPrimitive
// falls THROUGH it to Object.prototype.toString every time. A protocol
// that threw when it found no valueOf would break every plain object.
show("plus plain object", "" + boxed({ a: 1 }));
var caught;
try {
  throw new TypeError("kaboom");
} catch (e) {
  caught = boxed(e);
}
show("plus caught error", "" + caught);
show("plus valueOf returning an object", "" + boxed({
  valueOf: function () {
    return {};
  },
}));
show("plus valueOf object then toString", "" + boxed({
  valueOf: function () {
    return {};
  },
  toString: function () {
    return "T";
  },
}));
show("plus regexp", "" + boxed(/x/g));

// The ONE arm where the protocol really is exhausted: a null-prototype
// object inherits neither method.
T("plus null prototype", function () {
  return "" + boxed(Object.create(null));
});
var np = Object.create(null);
np.toString = function () {
  return "NP";
};
show("plus null prototype with toString", "" + boxed(np));

// Compound assignment is the same operator.
var acc = "x";
acc += both;
show("compound", acc);

console.log("done");
