// INSPECT OMITS THE OPTIONAL KEYS THE RECORD DOES NOT HOLD.
//
// A record slot whose type carries an undefined arm is a KEY of the value
// exactly when its tag is not that arm. The record's own key surfaces have
// always decided it that way -- recordKeysArrayCall's tag test IS
// Object.keys, `in` and Object.hasOwn -- and util.inspect (so console.log,
// so every dump a compiled program prints) read the shape's STATIC field
// list instead. So one value got two answers out of one binary:
//
//   const m: { a: number; b?: number } = { a: 1 };
//   console.log(m)             ->  { a: 1, b: undefined }     (Node: { a: 1 })
//   Object.keys(m).join()      ->  "a"                        (Node: "a")
//
// The gate is now that same tag test, so the two surfaces cannot disagree
// again. Absence decided at RUN time (the conditional-spread carrier) rides
// it unchanged -- the test is a runtime tag read, not a static field list,
// which is the one property estado-perinstance.md's ceiling probe did not
// have.
//
// KNOWN RESIDUE, and it is the representation's, not this rule's:
// `{ b?: T }` and `{ b: T | undefined }` intern to ONE slot, so a field the
// source wrote `undefined` BY HAND is indistinguishable from an omitted one
// and answers ABSENT -- which is what Object.keys/`in`/hasOwn already
// answered for it before this change. Those spellings are deliberately NOT
// in this file: they cannot be byte-exact against Node under one slot, and
// pinning them here would pin the representation rather than the rule.
// estado-perinstance.md section 4 is the census of that residue.
//
// Every expected value below is Node's, taken by running this file.

import { inspect } from "node:util";

interface Poll {
  readonly a: number;
  readonly b?: number;
  readonly c?: string;
  readonly d?: { readonly p: number; readonly q?: number };
  readonly e?: readonly number[];
}

function mk(n: number): Poll {
  if (n === 1) return { a: 1 };
  if (n === 2) return { a: 2, b: 5 };
  if (n === 3) return { a: 3, d: { p: 7 } };
  return { a: 4, b: 1, c: "z", d: { p: 8, q: 9 }, e: [1, 2] };
}

// 1. The zapo shape: a record read at its own type, most keys absent.
//    The two surfaces agree because they now run the same test.
for (let i = 1; i <= 4; i += 1) {
  const m = mk(i);
  console.log("1." + String(i), m);
  console.log("1." + String(i) + "i", inspect(m));
  console.log("1." + String(i) + "k", Object.keys(m).join("|"));
  console.log("1." + String(i) + "j", JSON.stringify(m));
}

// 2. Every key optional and every one absent: an EMPTY object, and Node
//    answers `{}` for one BEFORE the depth budget -- so the empty check has
//    to sit above the depth gate, where the array branch already puts its
//    own.
interface AllOpt {
  readonly x?: number;
  readonly y?: string;
}
function mko(n: number): AllOpt {
  return n === 0 ? {} : { x: n };
}
console.log("2a", mko(0));
console.log("2b", mko(1));
console.log("2c", { w: mko(0) });
console.log("2d", { p: { q: { r: mko(0) } } });
console.log("2e", { p: { q: { r: mko(1) } } });
console.log("2f", [mko(0), mko(1), mko(0)]);
console.log("2g", Object.keys(mko(0)).length);

// 3. Absence decided at RUN time. The carrier is an ordinary field of the
//    interned shape and the answer comes from its tag, so a conditional
//    spread whose arm did not run reads as the absent key it is.
const never: boolean = process.argv.length > 99;
interface Spread {
  readonly k: number;
  readonly opt?: string;
}
const cold: Spread = { k: 1, ...(never ? { opt: "no" } : {}) };
const warm: Spread = { k: 2, ...(never ? {} : { opt: "yes" }) };
console.log("3a", cold);
console.log("3b", warm);
console.log("3c", Object.keys(cold).join("|"), Object.keys(warm).join("|"));

// 4. Boundaries: the same value through a parameter, a return, an array
//    element and a nested field renders identically -- the helper is
//    interned per TYPE, so every boundary shares it.
function viaParam(v: Poll): string {
  return inspect(v);
}
function viaReturn(): Poll {
  return mk(3);
}
console.log("4a", viaParam(mk(1)));
console.log("4b", viaReturn());
console.log("4c", [mk(1), mk(2)]);
console.log("4d", { wrap: mk(1) });

// 5. The depth budget still answers `[Object]` for a NON-empty object past
//    it, and the presence gate does not move that boundary.
console.log("5a", { p: { q: { r: mk(2) } } });
console.log("5b", inspect({ p: { q: { r: mk(1) } } }, { depth: 4 }));

// 6. A class instance is NOT a record: TypeScript's field declarations
//    define own properties, so `b?: number` on a class IS a key holding
//    undefined -- Node prints it and Object.keys lists it, and nothing here
//    touches that path.
class Holder {
  public a = 1;
  public b?: number;
  public constructor(withB: boolean) {
    if (withB) this.b = 2;
  }
}
console.log("6a", new Holder(false));
console.log("6b", new Holder(true));

// 7. A field whose slot has NO undefined arm is unconditional, as before.
interface Plain {
  readonly n: number;
  readonly s: string;
}
const plain: Plain = { n: 1, s: "" };
console.log("7a", plain);
console.log("7b", Object.keys(plain).join("|"));
