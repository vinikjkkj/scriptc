// `.filter(pred)` over a union-element array re-tags every survivor
// through a TAG-CHECKED extraction.
//
// The lowering is a synthetic loop: `for (…) if (f(v)) out.push(narrow(v))`.
// The narrow takes the arm the CHECKER named — and the bool the callback
// answered is not a statement about the tag. A written `v is T` is the
// program's word; an inferred predicate is the checker's reading of a body
// that may itself be a call to a guard that lies. Either way the element
// union carries the claimed arm and the arm the value really holds side by
// side, which is exactly the shape that makes a wrong extraction read one
// record through another's struct.
//
// Where the predicate is honest the check is one compare per survivor and
// it always passes, and that is what this program pins: every filter below
// is truthful, so every answer is Node's answer. A DESCENDANT class in a
// base-class arm is honest too — the payload pointer is prefix-compatible
// and carries its own vtable — so the check admits it and the virtual call
// still reaches the override.
//
// The dishonest direction cannot be differential: Node hands the callback
// the object it was given and lets the later reads answer undefined.
// tests/harness/dyncheck.test.ts covers it with the two shapes that used to
// answer wrongly instead of loudly — a lying guard behind an INFERRED
// predicate over a string-carrying arm (the wrong string came back, exit 0,
// no diagnostic) and the same confusion over a number-carrying arm (the
// read loaded a double as a string pointer: SIGSEGV on both backends).

interface Hit {
  readonly kind: "hit";
  readonly a: string;
}
interface Miss {
  readonly kind: "miss";
  readonly b: number;
}

class Animal {
  readonly name: string;
  constructor(n: string) {
    this.name = n;
  }
  who(): string {
    return "animal " + this.name;
  }
}
class Dog extends Animal {
  readonly breed: string;
  constructor(n: string, b: string) {
    super(n);
    this.breed = b;
  }
  who(): string {
    return "dog " + this.name + "/" + this.breed;
  }
}

function isMiss(v: Hit | Miss): v is Miss {
  return v.kind === "miss";
}

const rows: (Hit | Miss)[] = [
  { kind: "hit", a: "A1" },
  { kind: "miss", b: 1 },
  { kind: "hit", a: "A2" },
  { kind: "miss", b: 2 },
];

// 1. the INFERRED predicate — the arrow carries no return annotation and
//    the checker reads `v is Hit` out of the discriminant test.
const hits = rows.filter((v) => v.kind === "hit");
for (const h of hits) console.log("hit " + h.a);
console.log("hits=" + String(hits.length));

// 2. the WRITTEN predicate — the program's own claim, honest here.
const misses = rows.filter((v): v is Miss => isMiss(v));
for (const m of misses) console.log("miss " + String(m.b));
console.log("misses=" + String(misses.length));

// 3. an inferred predicate that delegates to a written guard, honestly.
const misses2 = rows.filter((v) => isMiss(v));
console.log("misses2=" + String(misses2.length));

// 4. the same helper reached twice with the same (element, arm) pair — one
//    interned loop, one interned extraction.
const hits2 = rows.filter((v) => v.kind === "hit");
console.log("hits2=" + String(hits2.length) + " first=" + hits2[0]!.a);

// 5. the TRUTHY form, which stays unchecked on purpose: the arms Boolean
//    removes are the unit ones and both are falsy, so passing ToBoolean
//    decides the arm all by itself.
const maybe: (string | undefined)[] = ["x", undefined, "", "y", undefined];
const kept = maybe.filter(Boolean);
console.log("kept=" + String(kept.length) + " [" + kept.join(",") + "]");

const nums: (number | null)[] = [1, null, 0, 3];
const keptNums = nums.filter(Boolean);
console.log("keptNums=" + String(keptNums.length) + " [" + keptNums.join(",") + "]");

// 6. a DESCENDANT class in a base-class arm: the element is a Dog, the arm
//    is Animal, and `who()` must still reach Dog's override.
const zoo: (Animal | string)[] = [new Dog("rex", "husky"), "hello", new Animal("plain"), new Dog("fido", "corgi")];
const animals = zoo.filter((v) => typeof v !== "string");
for (const a of animals) console.log(a.who());
console.log("animals=" + String(animals.length));

// 7. a filter inside a loop, so the checked extraction runs many times and
//    the survivors' refcounts have to come out even.
let total = 0;
for (let i = 0; i < 200; i += 1) {
  const round = rows.filter((v) => v.kind === "hit");
  total += round.length;
}
console.log("total=" + String(total));

// 8. an EMPTY survivor set, and one where every element survives.
const none = rows.filter((v) => v.kind === "hit" && v.a === "nope");
console.log("none=" + String(none.length));
const allMiss: (Hit | Miss)[] = [
  { kind: "miss", b: 9 },
  { kind: "miss", b: 8 },
];
console.log("allMiss=" + String(allMiss.filter((v) => isMiss(v)).length));
