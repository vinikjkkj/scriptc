// new Function / Function(...) / Function.apply over text that is known when the program is built.
const add = new Function('a', 'b', 'return a + b');
console.log(add(2, 3), add('x', 'y'), add.name, add.length);

const noArgs = Function('return 40 + 2');
console.log(noArgs(), noArgs.length);

const packed = new Function('a, b', 'c', 'return a * b + c');
console.log(packed(3, 4, 5), packed.length);

const viaApply = Function.apply(null, ['x', 'return x * x']);
console.log(viaApply(9));

const loop = new Function('n', 'var s = 0; for (var i = 1; i <= n; i++) { s += i; } return s;');
console.log(loop(10), loop(100));

// each evaluation is a new function object
function make() { return new Function('return 1'); }
const f1 = make();
const f2 = make();
console.log(f1 === f2, f1() === f2());

// the new function sees the global scope only
const g = new Function('v', 'return Math.max(v, 10) + String(v).length');
console.log(g(3), g(300));

// a body with a nested closure and a conditional
const counterFactory = new Function('start', 'var n = start; return function () { return n++; };');
const next = counterFactory(5);
console.log(next(), next(), next());
const pick = new Function('x', 'if (x > 0) { return "pos"; } else if (x < 0) { return "neg"; } return "zero";');
console.log(pick(1), pick(-1), pick(0));
