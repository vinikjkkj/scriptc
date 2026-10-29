// Math.fround used as a value (not called in place): as a callback to map, as a
// local alias that is then called, and as an argument of another Math call. The
// callback form receives (value, index, array), which fround ignores.
const values = [1.1, 0.1, 16777217, -0, NaN];
const rounded = values.map(Math.fround);
console.log(rounded, rounded.map((v) => Object.is(v, -0)));
const alias = Math.fround;
console.log(alias(1.1), alias(-0), alias(2 ** 128));
console.log(Math.max(Math.fround(0.1), Math.fround(0.2)), Math.abs(Math.fround(-1.1)));
