// JSON.stringify with a space typed as a union (number | string | undefined): a run-time
// tag read picks the gap. A number clamps to 0..10 spaces, a string keeps its first
// 10 UTF-16 units, undefined is the compact text, and each function is a different callee.
function f(sp: number | string | undefined): string {
  return JSON.stringify({ a: [1, 2], b: 'x' }, null, sp);
}
function g(sp: any): string {
  return JSON.stringify({ a: [1, 2], b: 'x' }, null, sp as number | string | undefined);
}
function h(sp: number | undefined): string {
  return JSON.stringify([1, { c: 2 }], null, sp);
}
console.log(f(2));
console.log(f('ab'));
console.log(f(undefined));
console.log(f(0));
console.log(f(''));
console.log(f(42.9));
console.log(g(3));
console.log(g('-----'));
console.log(g(undefined));
console.log(h(1));
console.log(h(undefined));
