// Math.fround coerces its argument with ToNumber, as every Math member does:
// numeric strings (with whitespace and hex), the empty string, booleans, null,
// undefined (NaN), arrays by their one element, and objects through valueOf.
// Values that reach it dyn (any) take the same path. The valueOf call count
// shows the coercion runs exactly once per call. A BigInt throws a TypeError.
// The literal non-number arguments go through `any`: the checker rejects them
// as Math arguments, and the dyn path is the one this row pins.
const asAny = (v: unknown): any => v;
console.log(Math.fround(asAny("1.1")), Math.fround(asAny(" 0x10 ")), Math.fround(asAny("")), Math.fround(asAny("abc")));
console.log(Math.fround(asAny(true)), Math.fround(asAny(false)), Math.fround(asAny(null)), Math.fround(asAny(undefined)));
console.log(Math.fround(asAny([])), Math.fround(asAny([7])), Math.fround(asAny([1, 2])));
console.log(Math.fround(asAny({ valueOf() { return 3.3; } })));

let calls = 0;
const counted: any = { valueOf() { calls++; return 0.5; } };
console.log(Math.fround(counted), calls);

const anyS: any = "2.5";
const anyN: any = null;
const anyU: any = undefined;
const anyB: any = true;
const anyO: any = { valueOf() { return 1.1; } };
const anyA: any = [9];
console.log(Math.fround(anyS), Math.fround(anyN), Math.fround(anyU), Math.fround(anyB));
console.log(Math.fround(anyO), Math.fround(anyA));

const anyBig: any = 1n;
try {
  console.log(Math.fround(anyBig));
} catch (e) {
  console.log("bigint", e instanceof TypeError);
}
const anyNaN: any = "nope";
console.log("dyn nan", Object.is(Math.fround(anyNaN), NaN));
