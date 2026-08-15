// A class-value slot ANNOTATED with a base class and initialized with a
// derived one: `const slot: typeof Animal = Spider`. The annotation is the
// slot's type — tsc answers `Animal` for `new slot(...)` and reads the
// base's static side through it — while the VALUE is the derived class
// object, so construction through the slot dispatches the derived
// constructor and the derived method table. Both halves have to agree:
// the lowering used to pin the INITIALIZER's class (the erasure-alias
// rule for `export const C = Impl as unknown as CCtor`), which made the
// compiler and the checker describe one expression two ways and reached
// the IR validator as an internal error instead of a diagnostic.
//
// The alias shape the rule exists for is pinned right below it: an
// UNANNOTATED alias, and a construct-signature-interface annotation, both
// still name the class they alias.
class Animal {
  legs: number;
  constructor(legs: number) {
    this.legs = legs;
  }
  speak(): string {
    return "...";
  }
  static kind(): string {
    return "animal";
  }
}

class Spider extends Animal {
  constructor(legs: number) {
    super(legs);
  }
  speak(): string {
    return "skitter";
  }
}

// The widening slot: annotation Animal, value Spider.
const slot: typeof Animal = Spider;
console.log("slot name:", slot.name);
console.log("slot static:", slot.kind());

// Reading a member straight off the construction is the shape that
// catches a disagreement: tsc types `new slot(2)` as Animal and the
// member read is emitted against Animal, so a lowering that constructed
// Spider here handed the IR two types for one expression.
console.log("made:", new slot(2).legs, new slot(2).speak());
const made = new slot(2);
console.log("made instanceof:", made instanceof Animal, made instanceof Spider);

// The same slot inside a function body (the local face of the rule).
function build(n: number): string {
  const local: typeof Animal = Spider;
  return local.name + ":" + String(new local(n).legs) + ":" + new local(n).speak();
}
console.log("built:", build(8));

// A base-typed slot holding the BASE keeps working the same way.
const plain: typeof Animal = Animal;
console.log("plain:", plain.name, new plain(4).speak());

// The erasure alias the cast rule models: no annotation at all.
const AliasNoAnn = Spider;
console.log("alias:", AliasNoAnn.name, new AliasNoAnn(6).speak());

// ... and the published-class shape: the annotation is a construct
// signature, which names no class, so the alias still resolves.
interface SpiderCtor {
  new (legs: number): Animal;
}
const Published: SpiderCtor = Spider as unknown as SpiderCtor;
console.log("published:", new Published(3).speak());

console.log("end");
