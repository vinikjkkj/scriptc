// Math.max/min.apply(thisArg, xs) and .call(thisArg, ...) fold like the spread call, NaN and signed zero exact, the receiver evaluated for effects.
const xs = [4, 9, 2];
console.log(Math.max.apply(null, xs), Math.min.apply(Math, xs), Math.max.apply(null, [1, NaN, 3]), Math.min.apply(null, [0, -0]), Math.max.apply(null, [-0, 0]));
console.log(Math.max.apply(null, []), Math.min.apply(null, []), Math.max.call(null, 3, 8, 5), Math.min.call(Math), Math.max.call(undefined, 1));
let n = 0; const tick = () => ++n;
console.log(Math.max.apply(tick(), xs), n, Math.max.apply(null, xs.map((x) => x * 2)));
const big: number[] = []; for (let i = 0; i < 1000; i++) big.push((i * 7919) % 1013);
console.log(Math.max.apply(null, big), Math.min.apply(null, big));
