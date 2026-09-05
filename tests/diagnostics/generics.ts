// Top-level generic function declarations monomorphize (calls, and VALUES
// whose reference pins one concrete signature); every other generic form
// stays rejected with a specific message.
function id<T>(x: T): T {
  return x;
}
// These two now COMPILE (no diagnostics): alias bindings register the
// target, and a generic-signature annotation monomorphizes like the
// unannotated alias — the unpinned-VALUE fences live in
// generic-value-bindings.ts.
function useAsValue(): void {
  const alias = id;
  alias(1);
}
function storeGenericSignature(): void {
  const keep: <T>(x: T) => T = id;
  keep(1);
}
// (`const genericArrow = <T>(x: T): T => x` at module scope now COMPILES —
// the generic value-binding rule; its fences live in
// generic-value-bindings.ts.)
function outer(): void {
  function nested<T>(x: T): T {
    return x;
  }
}
// A body construct that only fails for SOME instantiations reports the
// instantiation that triggered it.
function joinAll<T>(a: T[]): string {
  return a.join(",");
}
console.log(joinAll([1, 2]));
console.log(joinAll([[1], [2]]));

// Generic CLASSES monomorphize per instantiation; the family-level fences
// are the ones with no per-instantiation story.
class Box<T> {
  v: T;
  constructor(v: T) {
    this.v = v;
  }
}
// The uninstantiated family as a value: no thunk, no single ctor ABI.
const BoxAlias = Box;
// A base that mentions the class's own type parameters differs per
// instantiation, so the family SPLITS: each instantiation extends the base
// its own arguments named and the family is not their common ancestor. The
// class itself compiles; what it gives up is the one thing that needed the
// ancestor link — an `instanceof` interval covering the whole family.
class Chained<T> extends Box<T> {
  constructor(v: T) {
    super(v);
  }
}
function chainedInstanceOf(v: Chained<number>): boolean {
  return v instanceof Chained;
}
console.log(chainedInstanceOf(new Chained(1)));
// Generic class expressions: each evaluation would mint a distinct FAMILY.
const ExprFamily = class <T> {
  x: T | undefined;
};

// Reached: unreached bodies never lower, so their rejections only exist
// when something on the entry path uses them.
useAsValue();
storeGenericSignature();
outer();

// Reached: collection defers its diagnostics until a reference makes
// them relevant; these references are what makes them count.
new Box(1);
new Chained(2);
new ExprFamily<number>();
