// Container arms compare by identity; a number arm never equals a container arm.
type Box = number[] | Map<string, number> | number;
const xs: number[] = [1, 2];
const m = new Map<string, number>([['a', 1]]);
function same(a: Box, b: Box): boolean { return a === b; }
console.log(same(xs, xs), same(xs, [1, 2]), same(m, m), same(m, xs), same(3, xs));
console.log(same(3, 3), same(0, -0), same(NaN, NaN), same(m, 1));
