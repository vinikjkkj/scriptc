// THE OTHER DIRECTION of 5940. That program asserts that
// `class D extends <ambient declare class>` throws where Node throws; a
// compiler that refused, or mis-lowered, EVERY `extends` in the language
// would satisfy it just as well. This program is the shape of the mistake
// that would go unnoticed otherwise: every neighbouring heritage form that
// DOES have a runtime, asserted to still produce Node's answer.
//
// Nothing here is exotic. That is the point — the rule in 5940 fires on a
// heritage identifier resolving to a top-level `declare class` nothing
// defines, and this file is the list of things that look like that from a
// distance and are not.

import { EventEmitter } from "node:events";

// 1 — a program class base, with super() and a super method call.
class Animal {
  nm: string;
  constructor(nm: string) {
    this.nm = nm;
  }
  speak(): string {
    return this.nm + " speaks";
  }
}
class Dog extends Animal {
  speak(): string {
    return super.speak() + " woof";
  }
}
console.log("1", new Dog("rex").speak());

// 2 — a stdlib error base.
class MyErr extends Error {
  constructor() {
    super("boom");
    this.name = "MyErr";
  }
}
console.log("2", new MyErr().message, new MyErr().name);

// 3 — a stdlib error base one level down the built-in hierarchy.
class MyTypeErr extends TypeError {}
console.log("3", new MyTypeErr("t").message, new MyTypeErr("t") instanceof TypeError);

// 4 — an EventEmitter base (a builtin whose ClassInfo is registered, not
// declared in the program — the resolution path the ambient class was
// wrongly sharing).
class Bus extends EventEmitter {}
const bus = new Bus();
bus.on("ping", (v: number) => console.log("4", v));
bus.emit("ping", 7);

// 5 — a class merged with an INTERFACE. The merge partner is a
// type-world declaration on the same symbol, which is exactly the shape
// the ambient predicate has to look past without being fooled by.
interface Merged {
  extra?: string;
}
class Merged {
  v: number;
  constructor(v: number) {
    this.v = v;
  }
  twice(): number {
    return this.v * 2;
  }
}
class SubMerged extends Merged {
  constructor() {
    super(21);
  }
}
console.log("5", new SubMerged().twice());

// 6 — a GENERIC class over a program base. Generic families do not take
// the throw shell (they reach the heritage guard instead), so a family
// over a REAL base has to be shown still compiling.
class Box<T> extends Animal {
  v: T;
  constructor(v: T) {
    super("box");
    this.v = v;
  }
}
console.log("6", new Box<number>(3).v, new Box<string>("s").speak());

// 7 — a class EXPRESSION over a program base.
const K = class extends Animal {
  constructor() {
    super("k");
  }
};
console.log("7", new K().speak());

// 8 — three levels of program classes, fields at each level.
class L1 {
  a = 1;
}
class L2 extends L1 {
  b = 2;
}
class L3 extends L2 {
  c = 3;
}
const l = new L3();
console.log("8", l.a, l.b, l.c);

// 9 — an ambient class used ONLY as a type, in the same file as classes
// that DO extend things. No value touches it, so nothing throws and the
// annotation must not become a refusal.
declare class NeverExtended {
  readonly q: number;
}
function annotates(a: NeverExtended): number {
  return a.q;
}
console.log("9", typeof annotates);

// (The `declare module` case — a class inside a module augmentation is
// deliberately OUTSIDE this rule, because the augmentation names a real
// package whose import resolves at run time — lives in
// tests/harness/ambient-extends.test.ts instead: an augmentation of a
// package that does not exist is a tsc error under this directory's
// tsconfig, so it cannot be a corpus program.)

console.log("done");
