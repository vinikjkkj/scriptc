// Logical and compound assignments through accessors: a getter runs once per
// statement, the setter only when the test asks for a store, and an ordinary
// assignment still runs after its operands in JavaScript's order.
let log = "";
class Acc {
  private _v: number = 1;
  get v(): number { log += "g"; return this._v; }
  set v(x: number) { log += "s" + x + ";"; this._v = x; }
  private _s: string | undefined = undefined;
  get s(): string | undefined { log += "G"; return this._s; }
  set s(x: string | undefined) { log += "S;"; this._s = x; }
}
class Outer { acc: any; constructor(a: any) { this.acc = a; } }

const o = new Outer(new Acc());
o.acc.v += 4;          // get, set
o.acc.v ||= 9;         // get only (truthy 5)
o.acc.s ??= "x";       // get, set
o.acc.s ??= "y";       // get only
o.acc.s &&= "z";       // get, set
console.log(log);
console.log(o.acc.v, o.acc.s);

const u: any = { n: 2, arr: ["a"] };
function mark(t: string, v: any): any { log += t; return v; }
u.n = mark("<", 3) + u.n;     // ordinary assignment, control
u.n **= 2;
u.n >>>= 1;
u.n %= 3;
u.arr[0] += mark("R", "b");
console.log(u.n, u.arr.join(""), log.slice(-6));
