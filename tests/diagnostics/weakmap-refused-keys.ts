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
//
// Its first case has since changed sides too, in a different way. Bare
// `object` is ADMITTED now (it is the dyn, keyed on each value's payload --
// corpus 7787), so what stands in its place is the ARGUMENT check that
// survives the admission: a key whose static type already says the runtime
// would refuse it is refused here instead, because a compile-time answer
// beats a throw whenever the type is enough to give one.

interface Rec {
  readonly a: number;
  readonly b: string;
}

// ── 1. BARE `object` IS ADMITTED NOW — this is what it still refuses ────
//
// zapo-js 1.8.2's `prevSessionsSuffixCache` (signal/session/encoding.ts:229)
// used to be here in full and is not, because it compiles: corpus 7787 is
// that side of the line. TypeScript's `object` is the NonPrimitive
// intrinsic and mapType lowers it to the DYN, so such a table is keyed on
// each value's PAYLOAD — scr_dyn_strict_eq's rule, arm for arm, because a
// WeakMap and `===` must agree about what "the same object" is. The stamp
// switches on the runtime kind in scr_weak.c, which is the one place in
// this design where a key's field is not chosen statically.
//
// Admitting the TYPE is not admitting every ARGUMENT, and that is what the
// four sites below are. `weakKeyArgIsIdentity` refuses a key whose static
// type already says the runtime would refuse it — a compile-time answer
// beats a throw whenever the type is enough to give one — so what reaches
// the runtime switch is only what nothing static could have decided.
//
// Each of these previously compiled, on the strong identity Map, and rode
// its documented leak. Refusing them is the trade this file exists to
// record: a diagnostic costs a site, and admitting a key whose death the
// runtime cannot see costs a WRONG ANSWER that ships green.
const objectKeyed = new WeakMap<object, Uint8Array>();

// A RECORD. It crosses into dyn as a COPY, and the copy's origin is a
// record — the kind isSupportedWeakKey refuses at the type level because a
// width coercion rebuilds it, and the kind with no field to stamp.
const oneRow: Rec = { a: 1, b: "x" };
objectKeyed.set(oneRow, new Uint8Array([1]));

// A CLASS INSTANCE. Not for coercion — an upcast is a pointer reinterpret
// and copies nothing — but because an ACYCLIC class is emitted with calloc
// and a lean one-word header, never reaches scr_cyc_free, and which
// classes those are is a module-level fixpoint.
class Holder {
  constructor(readonly n: number) {}
}
objectKeyed.set(new Holder(1), new Uint8Array([2]));

// A MAP. It has an address and a release, and scr_map_release carries no
// weak-key stamp to read — the kind is refused until it does.
const table = new Map<string, number>();
objectKeyed.set(table, new Uint8Array([3]));

// And the READ side takes the same check, because a key argument the
// lowering would have to reshape is no more usable for a lookup than for
// an insert.
console.log(objectKeyed.has(oneRow));

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

// NOT here, and deliberately: a WeakMap DECLARED with a record or a class
// instance as its key type still COMPILES. It rides the strong identity Map
// (types.ts), so it has no diagnostic to pin — it has a documented leak
// instead, narrowed but not removed. Only a table declared over `object`
// takes the weak ride and therefore the argument check in case 1; the two
// spellings now diverge, and that is deliberate rather than an oversight.
// `WeakMap<Rec, V>` is a promise this runtime cannot keep, so it is kept as
// a strong Map with the leak written down; `WeakMap<object, V>` is a
// promise it CAN keep for the payload kinds it can watch die, so it keeps
// it and refuses the rest by name.

// NOT here either: what the RUNTIME refuses. A number, a string, a boolean
// and the units have no address to key on and set() throws Node's own
// `TypeError: Invalid value used as weak map key` for them — but that is a
// runtime answer, reachable only through a value whose static type is
// already `object` or `unknown`, so no diagnostic exists to snapshot. It is
// pinned as a differential instead, in corpus 7787, where every one of those
// messages must match node byte for byte.

console.log(scalarValued, wideKeyed, objectKeyed);
