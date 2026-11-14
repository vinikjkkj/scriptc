// A function-typed record member read as a VALUE in a module that runs engine code goes through fn.unbind (scr_fn_unbind), which looks at the
// closure's caps[1]. The closure here has two captures, the second held by value.
// six earlier by-value captures of distinct classes intern descriptors 0..5; the descriptor index of the class below is then 6, a traced class,
// so its tagged slot has non-zero bits above bit 48 and a read of it as a box faults
class A0 { v: number; constructor(v: number) { this.v = v; } }
function use0(a: number): () => number { const o = new A0(a); const o2 = new A0(a + 1); return () => o.v + o2.v; }
class A1 { v: number; constructor(v: number) { this.v = v; } }
function use1(a: number): () => number { const o = new A1(a); const o2 = new A1(a + 1); return () => o.v + o2.v; }
class A2 { v: number; constructor(v: number) { this.v = v; } }
function use2(a: number): () => number { const o = new A2(a); const o2 = new A2(a + 1); return () => o.v + o2.v; }
class A3 { v: number; constructor(v: number) { this.v = v; } }
function use3(a: number): () => number { const o = new A3(a); const o2 = new A3(a + 1); return () => o.v + o2.v; }
class A4 { v: number; constructor(v: number) { this.v = v; } }
function use4(a: number): () => number { const o = new A4(a); const o2 = new A4(a + 1); return () => o.v + o2.v; }
class A5 { v: number; constructor(v: number) { this.v = v; } }
function use5(a: number): () => number { const o = new A5(a); const o2 = new A5(a + 1); return () => o.v + o2.v; }
console.log(use0(1)() + use1(1)() + use2(1)() + use3(1)() + use4(1)() + use5(1)());
interface Field { width: () => number; name: string }
class P { n: number; next: P | null = null; constructor(n: number) { this.n = n; } }
function mk(a: number, tag: string): Field {
  const x = new P(a);
  const y = new P(a * 2);
  return { width: () => x.n + y.n, name: tag };
}
const f: Field = mk(3, "w");
const g = f.width;
console.log(g(), f.name);
const o: any = {};                  // a CALL of a dyn `.constructor` makes the module run engine code
try { o.constructor("return 7"); } catch (e) { void e; }
