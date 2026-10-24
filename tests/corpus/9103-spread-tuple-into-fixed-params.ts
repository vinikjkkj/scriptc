// A tuple spread into fixed parameter positions: each element fills its
// position, a missing optional position is undefined, and the source is
// evaluated once, in source order with the other arguments.
const log: string[] = [];
function tag(x: string): string {
  log.push(x);
  return x;
}
function f(a: number, b: string, c?: boolean): string {
  return `${a}|${b}|${c}`;
}
const t: [number, string] = [1, "x"];
console.log(f(...t));
const u: [number, string, boolean] = [2, "y", true];
console.log(f(...u));
const xs: number[] = [3, 4];
console.log(f(xs[0]!, ...["z"]));
const e: [] = [];
function g(a?: number, b?: string): string {
  return `${a}/${b}`;
}
console.log(g(...e), g(...t), g(5, ...["q"]));
const w: [number, string, boolean] = [7, tag("bb"), false];
console.log(f(...w), log.join(","));
console.log(f(...[8, tag("cc"), true] as [number, string, boolean]), log.join(","));
