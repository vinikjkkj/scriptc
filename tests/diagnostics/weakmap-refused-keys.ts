// The REFUSED side of the WeakMap key boundary.
//
// This file exists because a predicate tested only on what it accepts is
// untested. It replaces weakmap-traced-array-key.ts, whose two headline
// cases (an array of records, an array of arrays) are now ADMITTED: phase 3
// hooked scr_cyc_free, where both deaths of a cycle-headered object
// converge, so a traced array's collector death is observed and it is a
// sound weak key. Corpus 7786 is that side of the line.
//
// What is left refused is refused for reasons that have nothing to do with
// the collector hook, and each one is here.

interface Rec {
  readonly a: number;
  readonly b: string;
}

// ── 1. BARE `object`, and the reason it is not "just another key kind" ──
//
// This is zapo-js 1.8.2's `prevSessionsSuffixCache`
// (signal/session/encoding.ts:229) verbatim, and it is the one WeakMap in
// that tree still refused. TypeScript's `object` is the NonPrimitive
// intrinsic — a TOP type over every non-primitive — and mapType lowers it
// to the DYN, not to any concrete heap kind.
//
// A dyn key cannot be keyed on its box. `scr_dyn_strict_eq` says so in as
// many words: the box is a boundary artifact and the JS value is the
// PAYLOAD, so two boxes of one object compare ===-equal. An address-keyed
// table over boxes would therefore miss every lookup a program makes — a
// silently useless cache, which is not a better outcome than a refusal.
// Keying on the payload instead is the sound design and it is a larger
// change: the stamp would have to switch on the RUNTIME kind (so it could
// no longer be the statically-chosen key_mark function pointer that keeps
// a stray store impossible), and several payload kinds — a number, a bool,
// the unit singletons — have no address to key on at all, so set() would
// owe them a loud refusal of its own.
//
// The call sites are here too, because they carry their own diagnostics
// and it is the four together that a zapo census counts.
const objectKeyed = new WeakMap<object, Uint8Array>();
const someRows: readonly Rec[] = [{ a: 1, b: "x" }];
objectKeyed.set(someRows, new Uint8Array([1]));
console.log(objectKeyed.has(someRows));

// ── 2. A KEY ARGUMENT THE LOWERING WOULD HAVE TO COPY ────────────────────
//
// `readonly Narrow[]` is assignable to `readonly Wide[]` — tsc admits it
// because `b` is optional — so nothing about the TYPES refuses this. What
// refuses it is that the two are different IR shapes, so `widthCoerce`'s
// array arm rebuilds the array element by element and the value that
// reaches the table is a FRESH one.
//
// That the copy happens is measured, not argued. A function taking
// `readonly Wide[]`, called twice with the SAME `readonly Narrow[]`
// binding, receives two DIFFERENT arrays: scriptc answers `false` to
// `first === second` where node answers `true`. As an ordinary width
// coercion that is the documented copy stance; at a weak-map key position
// it is the difference between a cache and a wrong answer.
//
// Under a strong Map the same shape costs a wasted slot and a lookup that
// misses; that failure is measured too, on corpus m32. Under a WEAK map it
// is worse: the entry is keyed on a temporary that dies at the end of this
// statement, so either the table holds an entry on an address the allocator
// is about to hand out again — a wrong answer — or the death hook fires at
// once and the cache can never hit.
//
// The check is at the ARGUMENT position and not on the key TYPE, because
// that is where the copy would be inserted and it is the only place the
// question is decidable: admission happens in mapType, which is a pure
// type-to-type function and cannot see any call site.
interface Narrow {
  readonly a: number;
}
interface Wide {
  readonly a: number;
  readonly b?: string;
}
const wideKeyed = new WeakMap<readonly Wide[], Uint8Array>();
const narrowRows: readonly Narrow[] = [{ a: 1 }];
wideKeyed.set(narrowRows, new Uint8Array([2]));

// ── 3. A SCALAR VALUE ────────────────────────────────────────────────────
// An admitted key kind is not enough on its own: the table stores a
// pointer, and a number is not one.
const scalarValued = new WeakMap<Uint8Array, number>();

// ── 4. THE SURFACE A WEAK TABLE CANNOT ANSWER HONESTLY ───────────────────
// size/clear/delete/iteration would each have to report entries whose keys
// may already be gone. JS withholds them from WeakMap for the same reason,
// so this is the language's line and not an extra restriction.
const admitted = new WeakMap<Uint8Array, Uint8Array>();
console.log(admitted.delete(new Uint8Array([3])));

// NOT here, and deliberately: a RECORD-keyed or CLASS-INSTANCE-keyed
// WeakMap still COMPILES. It rides the strong identity Map (types.ts), so
// it has no diagnostic to pin — it has a documented leak instead, narrowed
// but not removed by phase 3. A record is refused the weak ride because it
// width-coerces (case 2's hazard, at the type level rather than the site);
// a class instance because an ACYCLIC class is emitted with calloc and a
// lean one-word header, never reaches scr_cyc_free at all, and whether a
// given class is traced is a module-level fixpoint that
// isSupportedWeakKey — a pure IrType function — cannot see.

console.log(scalarValued, wideKeyed, objectKeyed);
