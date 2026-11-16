// Every consumer of the function-name table ([Function: name], the kind code of a boxed function) and of the function-text table
// (fn.toString, String(fn)): named functions, arrows, methods, a function inside a dyn bag, and an adapter.
function alpha(x: number): number { return x + 1; }
const arrow = (n: number): number => n * 2;
class Box { m(v: string): string { return v + '!'; } static s(): number { return 7; } }
const b = new Box();
console.log(alpha);
console.log(arrow);
console.log(String(alpha));
console.log(arrow.toString());
console.log(`${Box.s}`);
const bag: Record<string, unknown> = { alpha, arrow, nested: { f: alpha } };
console.log(bag);
console.log(typeof bag['alpha'], (bag['alpha'] as (x: number) => number)(41));
const bound = b.m.bind(b);
console.log(bound('x'));
console.log([alpha, arrow]);
