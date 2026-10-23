class A { constructor(x) { this.x = x; } }
class B extends A { constructor(x) { super(x); this.y = 2; } }
class C { constructor() { this.z = 3; } }
const reg = {};
reg.a = A; reg.b = B; reg.c = C;
function mk(k, x) { const K = reg[k]; return new K(x); }
const vals = [mk('a', 1), mk('b', 2), mk('c', 3), 'str', 5, null, undefined, [1], { x: 1 }, new Error('e')];
function test(v) { return [v instanceof A, v instanceof B, v instanceof C, v instanceof Error]; }
for (const v of vals) { console.log(JSON.stringify(test(v))); }
function ask(u) { if (u instanceof B) { return 'B:' + u.y; } if (u instanceof A) { return 'A:' + u.x; } return 'other'; }
console.log(ask(vals[0]), ask(vals[1]), ask(vals[2]), ask(7));
