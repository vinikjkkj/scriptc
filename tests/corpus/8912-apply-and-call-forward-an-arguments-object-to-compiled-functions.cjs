// Function.prototype.apply / call on compiled functions whose argument list is not the callee's own arity: a list the
// call spells out, an array literal, and the `arguments` object of the forwarding function. A short list pads with
// undefined and a long one drops its surplus, which is the language's rule.
function arity() { return arguments.length; }
function pair(a, b) { return String(a) + '|' + String(b); }
function who(greeting) { return greeting + ' ' + (this && this.name); }

console.log(arity.apply(null, [1, 2, 3]), arity.call(null, 1), arity.apply(undefined, []), arity.call(null));
console.log(pair.call(null, 'x'), pair.apply(null, ['x', 'y', 'z']), pair.call(null), pair.apply(null, [undefined, null]));
console.log(who.call({ name: 'ada' }, 'hi'), who.apply({ name: 'bob' }, ['yo']));

function forward() { return pair.apply(this, arguments); }
console.log(forward(1), forward(1, 2), forward(1, 2, 3), forward());

function spy(fn) {
  return function () {
    var seen = arguments.length;
    return seen + ':' + fn.apply(this, arguments);
  };
}
var wrapped = spy(pair);
console.log(wrapped('a', 'b'), wrapped('a'), wrapped());
var counted = spy(arity);
console.log(counted(1, 2, 3), counted());

var rest = function (...xs) { return xs.length + ':' + xs.join(','); };
console.log(rest.call(null, 'p', 'q'), rest.apply(null, ['r']), rest.apply(null, []));
