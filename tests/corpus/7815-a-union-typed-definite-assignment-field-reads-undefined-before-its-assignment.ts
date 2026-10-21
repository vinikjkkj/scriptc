// A union-typed `x!: A | B` field assigned past the constructor: the slot is
// the declared union plus an undefined arm. A read before the assignment is
// Node's undefined (printing, templates, typeof, comparisons); after it the
// declared union comes back out at its consumer.
class UnionLazy { mode!: string | null; n!: number | string;
  init(): void { this.mode = null; this.n = 5; }
  show() { console.log(this.mode, this.n, typeof this.mode, this.mode === undefined, `${this.mode}`); } }
const u = new UnionLazy();
u.show();
u.init(); u.show();
let m: string | null = u.mode; console.log(m);
function f(x: number | string) { return typeof x; }
console.log(f(u.n));
