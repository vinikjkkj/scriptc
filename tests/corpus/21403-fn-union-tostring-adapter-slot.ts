// A function value flowing into a `Function` slot is adapted to the slot's
// type; its text is still the text of the function it wraps.
function twice(n: number): number {
  return n * 2;
}
function take(f: Function): string {
  return f.toString();
}
const wrapped = (n: number): number => n + 100;
console.log(take(twice));
console.log(take(wrapped));
const nested: string | Function = take(twice) === "" ? "none" : twice;
console.log(String(nested));
console.log(take(function named(x: number) { return x; }));
