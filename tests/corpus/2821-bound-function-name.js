"use strict";
// Function.prototype.name is a property of the VALUE, fixed when the
// function is created — not of the binding that happens to spell it at the
// point of use. `var g = f; g.name` is "f" in every JS engine, and a bound
// function's name is "bound " prefixed onto whatever its TARGET is called,
// stacking once per rebind. The compiler resolves an identifier to the
// declaration that created the value (jsFuncValueNameOf) and derives the
// bind prefix from that, so an alias, a partial application and a rebind
// all answer what Node answers. `.length` is the bound function's REMAINING
// arity, which the bind wrapper's own parameter list already carries.
function f(a, b, c) { return [a, b, c].join(","); }

var g = f;                       // plain alias
var b1 = f.bind({ z: 1 });       // bind, no bound arguments
var b2 = f.bind({ z: 1 }, "x");  // partial application
var b3 = b1.bind({ z: 2 });      // rebind: the prefix stacks
var anon = function () { return 1; };            // NamedEvaluation
var ba = (function () { return 2; }).bind({});   // anonymous target

console.log(f.name, g.name);
console.log(b1.name, b2.name, b3.name);
console.log(f.bind({}, "q").name);
console.log(anon.name);
console.log(JSON.stringify(ba.name));
console.log(f.length, b1.length, b2.length, b3.length);

// The name rides the boxed value too, so inspect spells it the same way.
console.log(g);
console.log(b1);

// A bound function still CALLS with its receiver and its bound arguments.
function greet(x) { return x + " " + this.z; }
console.log(greet.bind({ z: "here" })("hi"));
console.log(greet.bind({ z: "there" }, "yo")());
