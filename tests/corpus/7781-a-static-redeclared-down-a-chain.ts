// A static REDECLARED down an inheritance chain — the walk that answers
// `Sub.tag`.
//
// Statics are not vtable slots: `C.x` resolves at compile time by walking the
// prototype chain of class OBJECTS, and a class that declares `x` itself owns
// separate storage from its base's. The rule the walk must keep is JS's own
// lookup: it stops at the first class object carrying an own property named
// `x`. A class that declares one and whose declaration this compiler declines
// to lower — a static accessor, `static x?: T = e` — still carries that own
// property at runtime, so the walk must stop there too and the use fence
// rather than resolve past it to a base whose storage would answer something
// else. This program pins the positive half: every level that redeclares gets
// its OWN answer, every level that does not inherits the nearest one above,
// and both readings hold before and after the base's storage is written.
//
// `declare static x: T` is deliberately absent: it installs no own property
// at all, so the walk past it IS the JS lookup, and it is a type-world word
// with nothing to run.

class Root {
  static tag: string | undefined = 'root';
  static shared = 'root-shared';
  static who(): string {
    // Resolved against ROOT, by name, wherever it is called from — statics
    // never dispatch.
    return 'Root:' + (Root.tag ?? 'unset');
  }
}

class Middle extends Root {
  static override tag: string | undefined = 'middle';
  static override who(): string {
    return 'Middle:' + (Middle.tag ?? 'unset');
  }
}

// Declares nothing of its own: both names resolve up the chain.
class Leaf extends Middle {}

// Redeclares only ONE of the two, and at the initializer-less spelling — its
// own storage starts as undefined while `shared` keeps coming from Root. The
// spelling is `string | undefined` and not `?`: an optional static narrows the
// class STATIC SIDE, which tsc will not let a subclass do to a required one.
class Sibling extends Root {
  static override tag: string | undefined;
}

console.log('--- own vs inherited');
console.log(Root.tag, Middle.tag, Leaf.tag, Sibling.tag);
console.log(Root.shared, Middle.shared, Leaf.shared, Sibling.shared);

console.log('--- the static methods resolve by name too');
console.log(Root.who());
console.log(Middle.who());
console.log(Leaf.who());
console.log(Sibling.who());

console.log('--- writing one level does not move the others');
Root.tag = 'root-2';
console.log(Root.tag, Middle.tag, Leaf.tag, Sibling.tag);
Middle.tag = 'middle-2';
console.log(Root.tag, Middle.tag, Leaf.tag, Sibling.tag);
Sibling.tag = 'sibling-2';
console.log(Root.tag, Middle.tag, Leaf.tag, Sibling.tag);
console.log(Root.who(), Middle.who());

console.log('--- writing the inherited one writes the declaring class');
Root.shared = 'root-shared-2';
console.log(Root.shared, Middle.shared, Leaf.shared, Sibling.shared);

console.log('--- instances are unaffected');
const insts: Root[] = [new Root(), new Middle(), new Leaf(), new Sibling()];
console.log(insts.length);
console.log(Root.tag, Middle.tag, Leaf.tag, Sibling.tag);
