// The webidl callback shape: an untyped callback is checked, wrapped, and the
// wrapper forwards its rest arguments through Reflect.apply.
function convert(value: any, context: string): any {
  if (typeof value !== "function") {
    throw new TypeError(context + " is not a function");
  }
  return (...args: any[]): any => Reflect.apply(value, undefined, args);
}

const twice = convert((x: number): number => x * 2, "callback");
console.log(twice(21));
const join = convert((a: string, b: string, c: string): string => a + b + c, "joiner");
console.log(join("x", "y", "z"));
try {
  convert(7, "first argument");
} catch (e) {
  console.log((e as Error).message);
}
