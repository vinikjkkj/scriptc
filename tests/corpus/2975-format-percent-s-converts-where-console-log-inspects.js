// util.format's `%s` and console.log's plain arguments are two different
// conversions, and they differ on exactly one shape: an object carrying
// its own toString.
//
// Node's formatter reads
//     !hasBuiltInToString(arg) ? String(arg) : inspect(arg)
// for a %s POSITION, and inspects unconditionally for a trailing
// argument. One runtime call served both, so `%s` inspected an object
// whose toString Node would have called.
import { format } from "node:util";
function boxed(v) {
  return v;
}
function show(tag, s) {
  console.log(tag + " = " + s);
}

var calls = 0;
var us = boxed({
  toString: function () {
    calls++;
    return "USER";
  },
});

// %s converts...
show("format %s", format("%s", us));
show("calls after %s", calls);
// ...console.log's %s is util.format's %s.
console.log("%s", us);
show("calls after console %s", calls);
// ...and a trailing argument inspects, which does not call it at all.
// (The inspected text itself is not printed here: how a boxed member
// function renders its NAME is Node's property-key inference, a
// different question from which conversion ran.)
format("x", us);
show("calls after rest arg", calls);

// A prototype-chain toString is a user toString too.
function K() {}
K.prototype.toString = function () {
  return "K!";
};
show("format %s proto", format("%s", boxed(new K())));

// Everything whose toString comes from a built-in prototype inspects,
// which is what the fall-through already did.
show("plain object", format("%s", boxed({ a: 1 })));
show("array", format("%s", boxed([1, 2])));
show("number", format("%s", boxed(5)));
show("string", format("%s", boxed("hi")));
show("null", format("%s", boxed(null)));
show("undefined", format("%s", boxed(undefined)));
show("boolean", format("%s", boxed(true)));

// The %s conversion is user code, so its throw is the program's throw.
var boom = boxed({
  toString: function () {
    throw new TypeError("no %s for you");
  },
});
try {
  show("throwing %s", format("%s", boom));
} catch (e) {
  show("throwing %s", "caught " + e.name + ": " + e.message);
}

console.log("done");
