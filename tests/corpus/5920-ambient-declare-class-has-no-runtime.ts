// An ambient `declare class` NOTHING defines has no runtime behind it.
// Node erases the declaration entirely, so touching the binding as a
// VALUE — above all as the callee of a `new` — throws the catchable
// ReferenceError "<name> is not defined" at the use site.
//
// WHY THIS PROGRAM EXISTS: the compiler used to COLLECT such a class like
// a program class and mint `sc_new_<name>` over a calloc'd struct, so
// `new Missing(7)` handed back a zero-initialized instance, `y` read back
// `0`, and the constructor argument was dropped as "surplus" — a SILENT
// wrong answer, exit 0, no diagnostic and no trap. The `declare const`
// spelling of the very same declaration (below, first) always lowered to
// Node's ReferenceError byte-exactly, so the two spellings of one
// declaration disagreed with each other. Both spellings are asserted here
// so a future widening cannot fix one and re-break the other.

// COVERAGE BOUNDARY, stated so nobody reads this file as covering more than
// it does: this program covers the `new <ambient class>` edge. The sibling
// shape `class D extends <ambient-undefined class>` -- which was STILL
// WRONG when this program was added, and said so here -- is now covered by
// 5930 (the throw, run) and 5931 (the shapes it must NOT fire on). Node
// throws `ReferenceError: <name> is not defined` when the DERIVED CLASS
// STATEMENT evaluates, so nothing below it runs; the compiler now compiles
// exactly that throw for a non-generic class declaration, and refuses
// loudly for the shapes the throw shell does not cover.

declare const MissingCtorValue: { new (x: number): { readonly y: number } };
declare class MissingClass {
  constructor(x: number);
  readonly y: number;
  readonly label: string;
  readonly flag: boolean;
}

// 1 — the `declare const` spelling: ReferenceError at the callee.
try {
  const a = new MissingCtorValue(1);
  console.log("const-spelling built", a.y);
} catch (e) {
  console.log("const-spelling:", String(e));
}

// 2 — the `declare class` spelling of the same thing. Same answer.
try {
  const b = new MissingClass(7);
  console.log("class-spelling built", b.y);
} catch (e) {
  console.log("class-spelling:", String(e));
}

// 3 — every field read is unreachable, so none of them can answer a
// fabricated 0 / "" / false. A string field is called out on its own: the
// calloc'd struct left it NULL, and the miscompiled program produced NO
// OUTPUT AT ALL (exit 0) rather than a wrong line.
try {
  const c = new MissingClass(2);
  console.log("fields", c.y, "[" + c.label + "]", c.flag);
} catch (e) {
  console.log("fields:", String(e));
}

// 4 — the throw is the CALLEE's, so it happens before any argument runs.
// (Node resolves `MissingClass` before evaluating `arg()`.)
let argRan = false;
function arg(): number {
  argRan = true;
  return 3;
}
try {
  const d = new MissingClass(arg());
  console.log("arg-order built", d.y);
} catch (e) {
  console.log("arg-order:", String(e));
}
console.log("argument evaluated:", argRan);

// 5 — execution continues normally past every catch.
console.log("done");

// 6 — THE OTHER DIRECTION. The rule above must fire on ambient classes
// NOTHING defines and on nothing else, so the shapes that DO have a
// runtime are asserted in the same program: a widening that "fixed" the
// rows above by refusing every construction would still pass a one-sided
// test.
class Real {
  n: number;
  constructor(n: number) {
    this.n = n;
  }
}
class Sub extends Real {
  constructor() {
    super(9);
  }
}
interface Merged {
  extra(): number;
}
class Merged {
  v: number;
  constructor(v: number) {
    this.v = v;
  }
  extra(): number {
    return this.v + 1;
  }
}
// An ambient class used ONLY as a TYPE is inert: no value is ever touched,
// so nothing throws and the annotation must not become a refusal.
declare class TypeOnly {
  readonly z: number;
}
function takesTypeOnly(t: TypeOnly): number {
  return t.z;
}

console.log("program class:", new Real(5).n);
console.log("subclass:", new Sub().n);
console.log("interface-merged class:", new Merged(2).extra());
console.log("stdlib classes:", new Map<string, number>([["a", 1]]).get("a"), new Error("boom").message);
console.log("ambient class as a TYPE only:", typeof takesTypeOnly);
