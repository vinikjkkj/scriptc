// A `let` the declaring file never writes is a const the author did not
// spell, and both adoption arms now say so.
//
// 3771 gave `const v: Iface = live` one meaning at both scopes. Its arm
// refused a `let` for one stated reason -- "a reassignable binding could hold
// another class later" -- and that reason is CHECKABLE rather than assumed:
// bindingNeverReassigned already existed, for the generic-function-binding
// rule, and it is exactly the proof that no later assignment exists. Its file
// walk is the whole story for a module-scope binding (ESM import bindings are
// read-only, so no other file can write one) and strictly conservative for a
// block-scoped one, whose writers are a SUBSET of its declaring file.
//
// The cost of refusing was not a fence. A `let` on the record route COPIES at
// the assignment, so:
//
//   - a mutation made through the class after the binding exists is INVISIBLE
//     through the binding (r02, r06), and
//   - a write made through the binding NEVER REACHES the object (r03, r07).
//
// Both on a program that compiles and exits 0 with values Node does not
// print. No trap census can see that, which is why the `let` half sat unlit
// behind the const half for as long as it did.
//
// The relaxation covers BOTH file-scope spellings, not one: `let v: Iface =
// new Impl()` (the constructedClassInfoOf arm, r09) and `let v: Iface = live`
// / `let v = live as unknown as { ... }` (the adoptedInstanceClassOf arm,
// r05-r08) share one gate, because splitting them would rebuild the very
// two-spellings-two-answers asymmetry 3771 removed.
//
// What deliberately still takes the RECORD route, and so cannot show an
// alias-observing row here:
//   - a `let` the file DOES write (r10-r12): reassignment, a write from
//     inside a nested function, and a destructuring-assignment target. Each
//     row therefore reads the binding only where the copy and the object
//     still agree -- immediately, before any mutation -- and observes the
//     mutation through the CLASS instead.
//   - a merged `var` redeclaration with a second initializer: one symbol,
//     several initializers, writes the assignment scan never sees.

interface Cell {
  readonly tag: string;
  n: number;
  bump(): number;
}

class CellImpl implements Cell {
  public readonly tag = "c1";
  public n = 1;
  public bump(): number {
    this.n += 1;
    return this.n;
  }
}

class OtherCell implements Cell {
  public readonly tag = "c2";
  public n = 50;
  public bump(): number {
    this.n += 10;
    return this.n;
  }
}

// ------------------------------------------------------ 1. BLOCK scope
function blockScope(): void {
  const live = new CellImpl();
  let view: Cell = live;
  console.log("r01", view.tag, view.n);
  live.bump();
  console.log("r02", view.n);
  view.n = 100;
  console.log("r03", live.n, view.n);
  console.log("r04", view.bump(), live.n);
}
blockScope();

// ------------------------------------------------------- 2. FILE scope
const fLive = new CellImpl();
let fView: Cell = fLive;
console.log("r05", fView.tag, fView.n);
fLive.bump();
console.log("r06", fView.n);
fView.n = 100;
console.log("r07", fLive.n, fView.n);
console.log("r08", fView.bump(), fLive.n);

// The `new` spelling at file scope, through the same relaxed gate.
let fNew: Cell = new CellImpl();
fNew.n = 7;
console.log("r09", fNew.n, fNew.bump());

// The CAST spelling at file scope.
const cLive = new CellImpl();
let cView = cLive as unknown as { n: number; bump(): number };
cLive.bump();
cView.n += 5;
console.log("r09b", cLive.n, cView.n, cView.bump());

// ------------------------------------ 3. lets the file DOES write
// A reassigned `let`: it really can hold two classes, so the record route is
// the honest answer and the rows below only read where both agree.
let swapped: Cell = new CellImpl();
console.log("r10", swapped.tag, swapped.n);
swapped = new OtherCell();
console.log("r10b", swapped.tag, swapped.n, swapped.bump());

// Written from inside a nested function — the file walk sees it even though
// no assignment is visible at the declaration.
const nLive = new CellImpl();
let nView: Cell = nLive;
function reset(): void {
  nView = new OtherCell();
}
console.log("r11", nView.n, nView.bump(), nLive.n);
reset();
console.log("r11b", nView.tag, nView.n);

// A DESTRUCTURING-assignment target: bindingNeverReassigned over-approximates
// the pattern, so this binding keeps the record route too.
const dLive = new CellImpl();
let dView: Cell = dLive;
console.log("r12", dView.n, dView.bump(), dLive.n);
[dView] = [new OtherCell()];
console.log("r12b", dView.tag, dView.n);

// ---------------------------------- 4. compound writes through an adopted let
function compound(): void {
  const live = new CellImpl();
  let v: Cell = live;
  v.n += 4;
  console.log("r13", live.n, v.n);
  v.n++;
  console.log("r14", live.n, v.n);
  v.n *= 3;
  console.log("r15", live.n, v.n);
}
compound();

// -------------------------------- 5. an INHERITED field through an adopted let
class Base {
  public depth = 1;
}
class Derived extends Base {
  public n = 2;
  public bump(): number {
    this.n += 1;
    return this.n;
  }
}
interface HasDepth {
  depth: number;
  n: number;
  bump(): number;
}
function inherited(): void {
  const live = new Derived();
  let v: HasDepth = live;
  live.depth = 9;
  console.log("r16", v.depth, v.n);
  v.depth = 20;
  console.log("r17", live.depth, v.bump(), live.n);
}
inherited();

// ------------------------------------------ 6. an exported never-written let
// ESM import bindings are read-only, so the file walk is the whole story even
// for a binding another module can see.
const eLive = new CellImpl();
export let eView: Cell = eLive;
eLive.bump();
console.log("r18", eView.n);
eView.n = 42;
console.log("r19", eLive.n);
