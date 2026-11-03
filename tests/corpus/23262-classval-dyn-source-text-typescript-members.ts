// A class method whose body holds a ternary and an optional parameter keeps its text in a TypeScript class value.
function anyv(x: any): any { return x; }
class Base { constructor(public_: number) { void public_; } }
class A extends Base {
  static s: number = 5;
  x!: number;
  protected y?: string;
  readonly w: number = 1;
  constructor(a: number) { super(a); this.x = a as number; }
  m(a: number, b?: string): number { return a + (b ? 1 : 0); }
  get g(): number { return 1; }
  static make<T>(v: T): T { return v; }
}
const mk = (n: number = 0) => class Made extends A { static n: number = n; private z: number[] = []; override m(a: number): number { return a * 2; } };
const h: any = {}; h.M = mk(1);
console.log(String(anyv(A)));
console.log(String(h.M));
