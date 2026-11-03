// The same for TypeScript source: Node's type stripper blanks every erasable form at its position (annotations,
// definite/optional marks, modifiers, declare fields, overload signatures, implements, type parameters), newlines survive.
function anyv(x: any): any { return x; }
interface I { a: number }
class C1 implements I {
  a: number = 1;
  declare d: string;
  #priv: number[] = [];
  static #sp = 2;
  f = (x: number): number => x + 1;
  m?(): void;
  over(a: string): void;
  over(a: number): void;
  over(a: any): void { void a; }
  async am(): Promise<number> { return 1; }
  static { void C1.#sp; }
  get v(): number { return this.#priv.length; }
  set v(n: number) { void n; }
}
class C2 { constructor(a: number, b: string = "x", ...rest: number[]) { void [a, b, rest]; } }
const mk = (n: number = 0) => class Anon { t!: number; static n = n; x = (n as any) as number; };
const h: any = {}; h.C1 = C1; h.C2 = C2; h.A = mk(1);
for (const k of ["C1", "C2", "A"]) { console.log(String(anyv(h[k]))); }
