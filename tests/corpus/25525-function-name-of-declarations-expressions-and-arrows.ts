// A function's name: its declaration's, a named expression's own, the binding's for an anonymous one, and "" for one with no binding.
function foo() {}
const arrow = () => 1;
const anon = function () { return 2; };
const named = function inner() { return 3; };
let later = function () {};
let assigned: () => number;
assigned = () => 1;
console.log(foo.name, arrow.name, anon.name, named.name, later.name, assigned.name);
console.log((function () {}).name === "", (() => 1).name === "", (function () {}).name.length);
const make = () => () => 1;
const inner = make();
console.log(inner.name === "", make.name, `${foo.name}!`, typeof foo.name);
