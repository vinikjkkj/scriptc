function f2(a: number, b: number, c: string): string { return `${a}|${b}|${c}`; }
const k: [number, number] = [1, 2];
console.log(f2(...k, 'z'));
const kk: [number, string] = [8, 'w'];
console.log(f2(0, ...kk));
function f3(a: number, b: string): string { return `${a}${b}`; }
const t3: [number, string] = [7, 'q'];
console.log(f3(...t3));
let n = 0;
function tag(x: number): number { console.log('tag', x); n += x; return x; }
function mk(): [number, string] { console.log('mk'); return [tag(4), 'm']; }
console.log(f2(tag(1), ...mk()));
console.log(n);
function g(a: number, ...r: number[]): string { return `${a}:${r.join(',')}`; }
const e: [] = [];
console.log(g(3, ...e));
const w: [number, number, number] = [4, 5, 6];
console.log(g(...w));
