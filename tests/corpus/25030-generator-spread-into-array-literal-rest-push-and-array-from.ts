function* g(n: number): Generator<number> { for (let i = 0; i < n; i++) yield i * 2; }
function* h(): Generator<string, number> { yield "a"; yield "b"; return 7; }
function* side(log: string[]): Generator<number> { log.push("start"); yield 1; log.push("mid"); yield 2; log.push("end"); }
function f(...xs: number[]) { return xs.length + ":" + xs.join("+"); }
const a = [...g(3)];
console.log(a.join(","));
const b = [0, ...g(2), 9, ...h()];
console.log(b.join(","));
const c = Array.from(g(4));
console.log(c.length, c.join(","));
console.log(f(...g(5)));
console.log(f(1, ...g(2), 3));
const log: string[] = [];
const d = [...side(log), ...side(log)];
console.log(d.join(","), log.join("|"));
const e: number[] = [];
e.push(...g(3));
console.log(e.join(","));
const m = Array.from(g(3), (x, i) => x + i);
console.log(m.join(","));
const gen = g(3);
gen.next();
console.log([...gen].join(","), [...gen].length);
class Box { *[Symbol.iterator](): Generator<number> { yield 4; yield 5; } }
console.log(Array.from(new Box()).join(","));
function take(...args: unknown[]): void { console.log(args.length, args.join("|")); }
take(...g(2));
take(1, ...h());
