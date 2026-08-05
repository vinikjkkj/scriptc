// An ARROW written against a slot whose declared type is a GENERIC signature
// — the producer half that had no rule:
//
//   function applyAll(f: <S extends Key>(k: S, v: VMap[S]) => string): string
//   applyAll((k, v) => `${MAP[k]}=${v}`)
//
// The slot's own TYPE already maps by binding every type parameter to its
// CONSTRAINT: the body type-checks for every type satisfying the constraint,
// so the constraint itself is among them, and one instantiation is always
// honest. A NAMED generic function flowing into such a slot is pinned by the
// same rule. The arrow declares no type parameters of its own — they come
// from the CONTEXTUAL signature — so nothing bound them, and `S` reached the
// body unresolved.
//
// The erasure is exact rather than a widening, and that is the whole
// soundness argument: every instantiation of `S extends 'a' | 'b' | 'c'` is a
// string literal, and every string literal has the same representation, so a
// monomorphized instance would emit identical code. Where the covered field
// types DISAGREE the surrounding machinery keeps its own fences — a keyed
// read whose fields have no one common type refuses outright, and a
// heterogeneous key-indexed return crosses back through a CHECKED union
// narrow rather than being reinterpreted.
//
// What this pins against Node: the key-indexed record read whose index is the
// open parameter, the key-indexed VALUE type in a parameter position, every
// key of the closed constraint, a CAPTURING arrow (proving it is a real
// closure and not re-lowered per call), a nested arrow inside the erased
// body, the erased arrow passed on to a second consumer and stored in an
// array, a key travelling as a variable rather than a literal, and a second
// constraint alive in the same program so the bindings are per arrow.
//
// The key ORDER matters: 'c' is last in the constraint but first at the call,
// so a lowering that silently used declaration order would print the wrong
// value.

const MAP = {
  a: "alpha",
  b: "beta",
  c: "gamma",
} as const;

type Key = keyof typeof MAP;
type Named = (typeof MAP)[Key];

interface VMap {
  readonly a: "one" | "two";
  readonly b: "three";
  readonly c: "four" | "five";
}

type Render = <S extends Key>(k: S, v: VMap[S]) => string;

// A SECOND generic signature with a different constraint, so a leaked global
// binding would show up as the wrong key set.
type Label = <F extends "short" | "long">(form: F) => string;

// A consumer that drives every key of the constraint, in an order that is NOT
// the declaration order.
function applyAll(f: Render): string {
  return [f("c", "four"), f("a", "one"), f("b", "three"), f("a", "two"), f("c", "five")].join("|");
}

// A second consumer: the key travels as a VARIABLE, so the callee reads it at
// runtime instead of seeing a literal.
function applyKey(f: Render, k: Key): string {
  if (k === "a") return f(k, "one");
  if (k === "b") return f(k, "three");
  return f(k, "five");
}

// The erased value stored and re-read, to show it is an ordinary first-class
// closure once erased.
function applyEach(fs: readonly Render[], k: Key): string {
  const out: string[] = [];
  for (const f of fs) out.push(applyKey(f, k));
  return out.join(",");
}

function label(f: Label): string {
  return `${f("short")}/${f("long")}`;
}

function main(): void {
  // 1. The arrow written directly at a parameter slot: the key-indexed record
  //    read with the open parameter as the index.
  console.log(applyAll((k, v) => `${MAP[k]}=${v}`));

  // 2. A CAPTURING arrow. The counter lives in main's frame, so one closure
  //    must exist across all five calls.
  let calls = 0;
  console.log(
    applyAll((k, v) => {
      calls += 1;
      // A NESTED arrow inside the erased body: the bindings must still be
      // live for its own parameter and for its capture of `k` and `v`.
      const render = (prefix: string): string => `${prefix}${calls}:${MAP[k]}:${v}`;
      return render("#");
    }),
  );
  console.log(`calls=${calls}`);

  // 3. The key-indexed read landing in a local typed by the whole value
  //    union, and the key as a runtime variable.
  const keys: readonly Key[] = ["b", "c", "a", "c"];
  for (const k of keys) {
    console.log(
      applyKey((kk, v) => {
        const named: Named = MAP[kk];
        return `${named}<-${kk}(${v})`;
      }, k),
    );
  }

  // 4. Two distinct erased arrows alive at once, stored in an array and read
  //    back — the bindings are per arrow, not one global.
  console.log(
    applyEach(
      [(k, v) => `L:${MAP[k]}:${v}`, (k, v) => `R:${v}:${MAP[k]}`],
      "a",
    ),
  );
  console.log(
    applyEach(
      [(k, v) => `L:${MAP[k]}:${v}`, (k, v) => `R:${v}:${MAP[k]}`],
      "c",
    ),
  );

  // 5. A different constraint in the same program.
  console.log(label((form) => (form === "short" ? "s" : "looong")));
  console.log(label((form) => `[${form}]`));

  console.log(`calls=${calls}`);
}

main();
