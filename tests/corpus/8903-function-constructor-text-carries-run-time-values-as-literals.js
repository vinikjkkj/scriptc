// Numbers, booleans, null, undefined and arrays carried into the text as JSON literals.
function konst(v) {
  return new Function('return ' + JSON.stringify(v));
}
console.log(konst(5)(), konst(-5)(), konst(0.1)(), konst(1e21)(), konst(-0)(), 1 / konst(-0)());
console.log(konst(true)(), konst(false)(), konst(null)(), konst(NaN)(), konst(Infinity)());
console.log(konst(undefined)(), konst('s')(), konst([1, 'a', [2]])(), konst({ a: 1, b: [true] })());

// a literal in the text is a fresh object per call of the generated function
const mk = konst({ n: 1 });
const x = mk();
const y = mk();
x.n = 99;
console.log(x === y, y.n);

// arithmetic with an inlined number
function scale(k) { return new Function('x', 'return x * ' + JSON.stringify(k)); }
const triple = scale(3);
const half = scale(0.5);
console.log(triple(7), half(7), scale(-2)(4));
