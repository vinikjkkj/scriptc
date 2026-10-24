function f(a: number, b: string, c?: boolean): string {
  return `${a}/${b}/${c}`;
}
const t: [number, string] = [1, 'x'];
const u: [number, string, boolean] = [2, 'y', true];
console.log(f(...t));
console.log(f(...u));
function g(a: number, ...r: number[]): string {
  return `${a}:${r.length}:${r.join('|')}`;
}
const w: [number, number] = [5, 6];
console.log(g(...w));
console.log(g(1, ...w));
console.log(g(...[9] as [number]));
function h(a: number, b: number, c: number): string { return `${a}${b}${c}`; }
const k: [number, number] = [1, 2];
console.log(h(0, ...k));
