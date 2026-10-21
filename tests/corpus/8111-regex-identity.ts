const a = /x/g;
const b = a;
const c = /x/g;
console.log(a === b, a === c, a !== c, a !== b);
function same(p: RegExp, q: RegExp): boolean { return p === q; }
console.log(same(a, a), same(a, c), same(/y/, /y/));
const arr: RegExp[] = [a, c];
console.log(arr.indexOf(a), arr.indexOf(c), arr.includes(b));
function mk(): RegExp { return /z/; }
console.log(mk() === mk());
const u: RegExp | null = Math.random() > 2 ? a : null;
console.log(u === a, u === null, u !== null);
const n = new RegExp("x", "g");
console.log(n === a, n === n);
if (a === b) console.log("id");
console.log([a, c].filter(r => r !== a).length);
const box: { r: RegExp } = { r: a };
console.log(box.r === a, box.r === c);
const m = new Map<string, RegExp>(); m.set("k", a);
console.log(m.get("k") === a, m.get("k") === c);
function id(u: unknown): unknown { return u; }
console.log((id(a) as RegExp) === a, (id(a) as RegExp) === c);
