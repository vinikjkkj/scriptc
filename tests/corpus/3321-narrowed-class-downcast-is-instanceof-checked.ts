// The checker's class narrowing reinterprets through an INSTANCEOF-CHECKED
// downcast.
//
// tsc's control-flow analysis narrows a class-typed reference to a
// subclass at its use sites; the IR value is still the base-typed pointer,
// so every such use is bridged by a downcast. That downcast used to be a
// bare pointer reinterpret: the object's vtable was never looked at, and
// soundness rested entirely on tsc having been right. Where tsc is right
// the two are indistinguishable — which is what this program pins. Every
// narrowing below is HONEST, so the interval test always passes and every
// answer is Node's answer.
//
// The dishonest direction cannot be differential: Node reads a missing
// property and prints undefined, scriptc throws the catchable TypeError.
// tests/harness/dyncheck.test.ts covers it, with the two shapes that used
// to answer wrongly instead of loudly — a sibling subclass whose own field
// sits at the SAME offset (the wrong string comes back, exit 0), and the
// base itself, which is shorter than the subclass struct (the read leaves
// the allocation and segfaults).

class Node2 {
  readonly id: number;
  constructor(id: number) {
    this.id = id;
  }
  label(): string {
    return "node" + this.id;
  }
}

class Leaf extends Node2 {
  readonly text: string;
  constructor(id: number, text: string) {
    super(id);
    this.text = text;
  }
  label(): string {
    return "leaf:" + this.text;
  }
}

class Branch extends Node2 {
  readonly kids: number;
  constructor(id: number, kids: number) {
    super(id);
    this.kids = kids;
  }
  label(): string {
    return "branch:" + this.kids;
  }
}

// Three levels: the bridge narrows across more than one link.
class Root extends Branch {
  readonly name: string;
  constructor(id: number, kids: number, name: string) {
    super(id, kids);
    this.name = name;
  }
  label(): string {
    return "root:" + this.name;
  }
}

// 1. instanceof narrowing — the honest original, field and method.
function describe(n: Node2): string {
  if (n instanceof Root) return "R " + n.name + " " + n.kids + " " + n.label();
  if (n instanceof Branch) return "B " + n.kids + " " + n.label();
  if (n instanceof Leaf) return "L " + n.text + " " + n.label();
  return "N " + n.id + " " + n.label();
}

const all: Node2[] = [new Leaf(1, "a"), new Branch(2, 3), new Root(4, 5, "top"), new Node2(6)];
for (const n of all) console.log(describe(n));

// 2. An HONEST user type predicate — tsc's word, and it happens to be true.
function isLeaf(n: Node2): n is Leaf {
  return n instanceof Leaf;
}
function leafText(n: Node2): string {
  return isLeaf(n) ? n.text : "-";
}
for (const n of all) console.log(leafText(n));

// 3. The narrowed receiver read TWICE, and its field into a slot.
function twice(n: Node2): string {
  if (n instanceof Root) {
    const a: string = n.name;
    const b: string = n.name;
    return a + "/" + b + "/" + n.kids;
  }
  return "-";
}
console.log(twice(new Root(7, 8, "dup")));
console.log(twice(new Leaf(9, "no")));

// 4. An ASSERTION function — the other checker-only class narrowing, and
//    the one with no runtime test in sight at the use site at all.
function assertLeaf(n: Node2): asserts n is Leaf {
  if (!(n instanceof Leaf)) throw new Error("not a leaf");
}
function viaAssert(n: Node2): string {
  assertLeaf(n);
  return n.text + "/" + n.label();
}
console.log(viaAssert(new Leaf(10, "asserted")));
try {
  console.log("unreachable", viaAssert(new Branch(10, 1)));
} catch (e) {
  console.log("assert:", (e as Error).message);
}

// 5. The narrowed value flowing into a parameter, an element and a field.
function takeLeaf(l: Leaf): string {
  return l.text + "#" + l.id;
}
type Holder = { readonly leaf: Leaf };
function route(n: Node2): string {
  if (!(n instanceof Leaf)) return "-";
  const arr: Leaf[] = [n];
  const h: Holder = { leaf: n };
  return takeLeaf(n) + "|" + takeLeaf(arr[0]!) + "|" + h.leaf.text;
}
console.log(route(new Leaf(11, "flow")));
console.log(route(new Branch(12, 0)));

// 6. A narrowing inside a hot loop: the check runs 2000 times and always
//    passes.
let sum = 0;
let names = 0;
for (let i = 0; i < 2000; i++) {
  const n: Node2 = i % 3 === 0 ? new Leaf(i, "x") : i % 3 === 1 ? new Branch(i, i) : new Root(i, i, "r");
  if (n instanceof Root) {
    names += n.name.length;
    sum += n.kids;
  } else if (n instanceof Branch) {
    sum += n.kids;
  } else if (n instanceof Leaf) {
    sum += n.text.length;
  }
}
console.log("sum", sum, "names", names);

// 7. A ternary over the narrowing, and the negated guard's else branch.
function pick(n: Node2): string {
  return n instanceof Branch ? "b" + n.kids : "o" + n.id;
}
console.log(pick(new Branch(13, 14)), pick(new Leaf(15, "z")), pick(new Root(16, 17, "q")));

// 8. Narrowing a value that arrives through an array read and a field read.
const holders: Holder[] = [{ leaf: new Leaf(18, "held") }];
const fromField: Node2 = holders[0]!.leaf;
if (fromField instanceof Leaf) console.log("field", fromField.text);

// 9. Two sibling subclasses with SAME-NAMED fields at the same offset: the
//    read has to answer from the class the value really is.
class SameA extends Node2 {
  readonly tag: string;
  constructor(id: number, tag: string) {
    super(id);
    this.tag = tag;
  }
}
class SameB extends Node2 {
  readonly tag: string;
  constructor(id: number, tag: string) {
    super(id);
    this.tag = tag;
  }
}
function tagOf(n: Node2): string {
  if (n instanceof SameA) return "A" + n.tag;
  if (n instanceof SameB) return "B" + n.tag;
  return "?";
}
console.log(tagOf(new SameA(19, "aa")), tagOf(new SameB(20, "bb")), tagOf(new Leaf(21, "cc")));
