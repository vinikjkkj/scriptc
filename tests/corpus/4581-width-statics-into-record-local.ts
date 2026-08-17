// Structural width subtyping, class VALUE → record: the parts 2242 does
// NOT reach.
//
// 2242 pins the base case — a class's own statics projecting into a plain
// interface. What decides whether that projection is reachable at all is
// the SLOT TYPE, and a module-level const's slot type is chosen in
// collectGlobals by an arm that answers for any const whose initializer is
// a bare class identifier, without looking at the annotation. Taking the
// class value there makes classStaticsProjection unreachable and every
// later read fences on a classval receiver. Two directions have to hold at
// once, and this file pins both against each other:
//
//   * a plain interface matched by the STATIC side must PROJECT, including
//     when the statics are INHERITED — classStaticsProjection's own doc
//     comment promises "inherited statics resolve like JS's class-object
//     prototype walk", which nothing exercised;
//   * a CONSTRUCT-signature annotation must still keep the class value,
//     because adopting the interface would lose the only thing that can be
//     constructed. That direction works today and is the regression this
//     file exists to catch: narrowing the first rule must not touch it.
//
// No parameter properties on purpose, so the file needs no
// // @transform-types directive and Node itself is the oracle.
class Base {
  static origin(): string {
    return "base-origin";
  }
  static label = "base-label";
}

class Derived extends Base {
  static extra(): number {
    return 5;
  }
}

// INHERITED static method + own static method in one target shape.
interface Inherited {
  origin(): string;
  extra(): number;
}
const d: Inherited = Derived;
console.log(d.origin(), d.extra());

// An inherited static FIELD, alone in its target shape.
const labelled: { label: string } = Derived;
console.log(labelled.label);

// Two projections of the same class are independent values reading the
// same statics.
const a: { label: string } = Derived;
const b: { label: string } = Derived;
console.log(a.label, b.label, a.label === b.label);

// The class's OWN statics still project when a base exists above them.
const own: { extra(): number } = Derived;
console.log(own.extra());

// The other direction: a CONSTRUCT-signature annotation keeps the class
// value, so `new` through the binding constructs.
class Widget {
  size: number;
  constructor(size: number) {
    this.size = size;
  }
}
interface WidgetCtor {
  new (size: number): Widget;
}
const W: WidgetCtor = Widget;
const made = new W(3);
console.log(made.size, made instanceof Widget);
