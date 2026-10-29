// Object.is over a dyn (any) operand is SameValue on numbers: NaN is NaN, +0 is
// not -0, and every other pair is ===. The dyn side meets a number literal, a
// dyn number, a number-typed variable, and a number that came through JSON on
// either side of the call.
const nan: any = NaN;
const pz: any = 0;
const nz: any = -0;
const one: any = 1;
const big: any = 1e300;
const jnz: any = JSON.parse("-0");
const jpz: any = JSON.parse("0");
console.log("nan", Object.is(nan, NaN), Object.is(NaN, nan), Object.is(nan, nan), Object.is(nan, 0 / 0));
console.log("zero", Object.is(nz, -0), Object.is(-0, nz), Object.is(pz, -0), Object.is(nz, 0), Object.is(pz, 0));
console.log("zero json", Object.is(jnz, -0), Object.is(jpz, 0), Object.is(jnz, jpz), Object.is(jpz, nz));
console.log("dyn-dyn", Object.is(nz, jnz), Object.is(pz, jpz), Object.is(nan, JSON.parse("null") ?? NaN));
console.log("numbers", Object.is(one, 1), Object.is(1, one), Object.is(one, 2), Object.is(big, 1e300));
console.log("infinity", Object.is(big, Infinity), Object.is(nan, Infinity), Object.is(nz, Number.NEGATIVE_INFINITY));
let x: number = 5;
let y: number = NaN;
console.log("typed", Object.is(x, one), Object.is(one, x), Object.is(y, nan), Object.is(nan, y), Object.is(x, 5));
console.log("neg typed", Object.is(-0, nz), Object.is(nz, -0), Object.is(y, 0 / 0));
const arr: any[] = [NaN, -0, 0, 1];
console.log("elements", Object.is(arr[0], NaN), Object.is(arr[1], -0), Object.is(arr[2], -0), Object.is(arr[3], 1));
