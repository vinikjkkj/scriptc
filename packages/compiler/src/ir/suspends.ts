/* WHAT SUSPENDS -- the one place that says so, read by both sides.
 *
 * WHY THIS FILE EXISTS. The stackless lane admits a function when every
 * suspension in it can be lowered without a fiber. Deciding that needs a list
 * of what suspends, and liveness kept its own: a Set of IR node kinds. The
 * emitter kept a different opinion, implicitly, in the shape of which
 * constructs it lowers through fiber-only primitives. The two drifted, and on
 * 2026-10-06 the drift shipped a crash: `async.hop` is a libCall, not a node
 * kind, so it was absent from liveness's list. It yields a microtask turn --
 * it suspends -- and liveness could not see it. Fifteen functions were
 * admitted to the stackless lane while still containing one, and the binary
 * aborted with "await outside an async function".
 *
 * That was the FOURTH instance in one day of a copy kept beside the thing it
 * copies: operandCount's hand-listed unary kinds, a 20-entry statement list
 * against 24 in nodes.ts, the gate reporting a HEAD pointer as if it were
 * tree content, and this. Adding "async.hop" to the old Set would have been
 * the fifth, waiting for the next suspending construct.
 *
 * THE BINDING IS TWO-WAY AND IT IS A TYPE ERROR TO BREAK IT. A const array
 * bound to a union in one direction only still lets a new union member slip
 * in unlisted, and every consumer then rejects it by default -- silence, not
 * a failure. So each list is `satisfies readonly <Union>[]` (nothing in the
 * array that is not in the union) AND passed through AssertNever (nothing in
 * the union that is not in the array). A new suspending construct cannot be
 * added in one place: it fails to compile until it is in both.
 *
 * AND THE EMITTER IS BOUND TOO. A fiber-only primitive may only be emitted
 * through `fiberOnly`, which demands the name of the registered suspender it
 * belongs to. Emitting one for an unregistered construct is a type error at
 * the emission site, which is where the knowledge actually lives.
 */

/** Fails to compile unless T is `never`. The reverse half of each binding. */
type AssertNever<T extends never> = T;

/* ── IR node kinds that suspend ──────────────────────────────────────── */

export type SuspendingNodeKind =
  | "awaitExpr"
  | "awaitUnionExpr"
  | "yieldExpr"
  | "genResume"
  | "agenResume";

export const SUSPENDING_NODE_KINDS = [
  "awaitExpr",
  "awaitUnionExpr",
  "yieldExpr",
  "genResume",
  "agenResume",
] as const satisfies readonly SuspendingNodeKind[];

type _NodeKindsCovered = AssertNever<
  Exclude<SuspendingNodeKind, (typeof SUSPENDING_NODE_KINDS)[number]>
>;

/* ── library calls that suspend ──────────────────────────────────────── */

/* These are not node kinds and that is exactly why they were missed. A
 * libCall looks like any other call in the IR; only the runtime entry point
 * it lowers to knows that it yields. */
export type SuspendingLibCall =
  | "async.hop"
  /* THE SECOND INSTANCE OF EXACTLY WHAT THIS FILE WAS BUILT FOR, found
   * 2026-10-06. `async.awaitDyn` lowers to scr_await_dyn_value, a fiber-only
   * await, and it sat NINE LINES BELOW the `async.hop` case that goes through
   * `fiberOnly` -- same nature, its own comment even says "the hop rides the
   * loop" -- while being registered nowhere. liveness could not see it, so it
   * admitted functions holding one and the emitter wrote a fiber await into a
   * body that has no fiber.
   *
   * Not "await outside an async function" like the hop was:
   * STATUS_STACK_BUFFER_OVERRUN, the process fail-fasting after whatever it
   * had already flushed. Measured on corpus program 4611 -- six lines and
   * exit 0 knob-absent, one line and 0xC0000409 knob-on, deterministic 10/10
   * -- then narrowed by cutting down to `await u["clear"]()`, a keyed dynamic
   * call with NO arguments. Not the function-typed parameter, not the promise
   * arm, not that method or that object: any awaited dynamic dispatch.
   *
   * TWO CARRIERS IN THE CORPUS, not one. A sweep of 227 dumps found
   * `4611-dyn-func-generator-param-callable` and
   * `4631-readonly-map-in-a-record-through-unknown`, and BOTH were observed
   * crashing 0xC0000409 at f30d0d146 with the knob on, each carrying
   * `scr_await_dyn_value` inside `sc_cr_main`. The fence covers both because
   * it lives in the shared analysis, but the defect record has to name both
   * or the latent size reads as half what it was.
   *
   * The carriers that were REFUSED were refused by an accident rather than
   * by the fence: they hold an `awaitDyn` and nothing else, so `points === 0`,
   * `suspensionLiveness` returns null, and `stacklessPlan` bails before the
   * fence is ever consulted. Add one ordinary `await` to any of them and it
   * is admitted with a fiber park inside a coroutine frame. One is named
   * `destroyIfSupported`, the same name as the single occurrence in the
   * user's app182 -- so this is ONE LIBRARY IDIOM surfacing in three places,
   * not three independent findings.
   *
   * WHICH MEANS THE REACH COST OF REGISTERING THIS CANNOT BE MEASURED
   * THROUGH LIVENESS. It reads 0 functions and 0 points, but only because
   * the blindness that caused the bug also hides its cost. The honest
   * measurement is the other arm: un-registering `async.hop` moves +15
   * functions and +28 points, reproducing the "fifteen functions" this
   * header already attributes to the hop defect.
   *
   * A SUBTLETY worth keeping, because it decides whether a test of this is
   * real: a dyn await is a libCall, not an awaitExpr, so a function whose
   * ONLY suspension is one has no suspension POINT -- suspensionLiveness
   * returns null and it is never admitted. The crash needs a body made
   * admissible by a co-resident ordinary await. A reproducer without one
   * tests nothing and looks fine.
   *
   * Registered rather than lowered because the stackless lane has no
   * counterpart for the hop it performs, exactly as with `async.hop`: a
   * function holding one stays on the fiber lane. */
  | "async.awaitDyn"
  /* THE THIRD, AND THE ONE THE NAME-BASED FENCE COULD NEVER HAVE CAUGHT.
   * A node:test subtest runs INLINE ON THE RUNNER FIBER, so when the
   * subtest body awaits, scr_test_sub parks its caller -- and nothing
   * about the spelling says so. `Fenced<S>` keys on `scr_await_`, which is
   * a naming convention; this one walks straight past it.
   *
   * Found by the parking census in tests/harness/fiber-only-census.test.ts,
   * which derives "parks" from the runtime -- a function reaching a
   * scr_switch whose destination is return_to -- instead of from a name.
   * That census was built to prove it COULD find a second unregistered
   * site; it found a real one.
   *
   * Measured: a parent test whose subtest awaits exits 0xC0000409 with the
   * knob on and prints nothing, against 12 correct lines and exit 0 with
   * it off, with scr_test_sub sitting inside sc_cr__x25_fn0. A SYNCHRONOUS
   * subtest does not crash, which is why the existing fixtures missed it:
   * the park only happens when the subtest body itself suspends. */
  | "test.sub"
  | "test.subEmpty";

export const SUSPENDING_LIB_CALLS = [
  "async.hop",
  "async.awaitDyn",
  "test.sub",
  "test.subEmpty",
] as const satisfies readonly SuspendingLibCall[];

type _LibCallsCovered = AssertNever<
  Exclude<SuspendingLibCall, (typeof SUSPENDING_LIB_CALLS)[number]>
>;

/** Which suspenders the STACKLESS lane can lower. A suspender absent here is
 * fiber-only, and a function containing one must not be admitted. Today the
 * state machine has no counterpart for the microtask hop, so `async.hop`
 * keeps its function on the fiber lane. */
export const STACKLESS_LOWERABLE_LIB_CALL_LIST = [
  "async.hop",
] as const satisfies readonly SuspendingLibCall[];

/** The lowerable ones, as a type, so the POINT KIND below is derived from
 * this list rather than restated beside it. */
export type StacklessLowerableLibCall = (typeof STACKLESS_LOWERABLE_LIB_CALL_LIST)[number];

export const STACKLESS_LOWERABLE_LIB_CALLS: ReadonlySet<string> =
  new Set<SuspendingLibCall>(STACKLESS_LOWERABLE_LIB_CALL_LIST);

/* ── what a SUSPENSION POINT may be ──────────────────────────────────
 *
 * A point is not the same set as a NODE KIND, and the difference is the
 * whole reason the hop was invisible to liveness for as long as it was: a
 * lowerable suspending libCall has node kind "libCall", so a walk keyed on
 * SUSPENDING_NODE_KINDS cannot see it, and a point it cannot see gets no
 * state index, no live set and no dispatch case.
 *
 * BOUND IN BOTH DIRECTIONS ON PURPOSE. The type is DERIVED from the
 * lowerable list, so registering a new lowerable libCall without giving it a
 * point kind fails `_PointKindsCovered`; and the array is `satisfies` the
 * type, so a kind with nothing behind it fails there. A union with no
 * runtime enumeration is how a new member compiles clean and is
 * default-rejected by every consumer in silence. */
export type SuspensionPointKind = SuspendingNodeKind | `libCall:${StacklessLowerableLibCall}`;

export const SUSPENSION_POINT_KINDS = [
  "awaitExpr",
  "awaitUnionExpr",
  "yieldExpr",
  "genResume",
  "agenResume",
  "libCall:async.hop",
] as const satisfies readonly SuspensionPointKind[];

type _PointKindsCovered = AssertNever<
  Exclude<SuspensionPointKind, (typeof SUSPENSION_POINT_KINDS)[number]>
>;

/** The point kind a lowerable libCall contributes. One spelling, one place. */
export function libCallPointKind(fn: StacklessLowerableLibCall): SuspensionPointKind {
  return `libCall:${fn}`;
}

/** Emit a fiber-only runtime primitive. The first argument is not decoration:
 * it forces the emission site to name a REGISTERED suspender, so a new
 * fiber-only call cannot reach the output without appearing in the list above
 * that liveness reads. */
export function fiberOnly(_which: SuspendingLibCall, c: string): FencedC {
  return c as FencedC;
}

/* THE FENCE WAS OPT-IN, AND THAT IS HOW THE SECOND ONE GOT THROUGH.
 *
 * `fiberOnly` binds the sites that CALL it. Nothing compelled an emission
 * site to call it, so `async.awaitDyn` was written nine lines below
 * `async.hop` -- same nature, same file, same switch -- emitting
 * scr_await_dyn_value raw, and liveness never saw it. A fiber await landed
 * in a body with no fiber and the process fail-fasted with
 * STATUS_STACK_BUFFER_OVERRUN. Registering that one closed the instance; it
 * did not close the CLASS, because the next person to add a
 * fiber-only primitive still has nothing stopping them.
 *
 * So the obligation moves into the TYPE. A C fragment that spells
 * `scr_await_` is rejected by the emission entry point unless it carries the
 * brand, and the only thing that mints the brand is `fiberOnly`, which
 * demands the name of a REGISTERED suspender. A new fiber-only primitive
 * written by someone who never read any of this does not compile.
 *
 * It keys on the `scr_await_` spelling, which is a NAMING CONVENTION and
 * therefore the honest limit of this fence: a suspending primitive lowered
 * under some other name escapes it. That gap is covered by the separate
 * runtime-symbol census (enumeration by PROPERTY, not by name); the two are
 * complementary and neither subsumes the other. */
declare const FENCED: unique symbol;

/** A C fragment that has been through the fiber-only fence. */
export type FencedC = string & { readonly [FENCED]: true };

/** The emission entry point's parameter type. A raw fragment spelling a
 * fiber-only primitive resolves to the error object below, which no string
 * is assignable to, so the call site fails to compile with the reason in
 * the message. A `FencedC` is `string & brand`, which is not assignable to
 * a template literal type, so it falls through untouched. */
export type Fenced<S extends string> =
  S extends `${string}scr_await_${string}`
    ? { readonly __fiberOnlyPrimitiveMustGoThrough_fiberOnly_see_ir_suspends_ts: never }
    : S;

const _used: readonly unknown[] = [
  null as unknown as _NodeKindsCovered,
  null as unknown as _LibCallsCovered,
  null as unknown as _PointKindsCovered,
];
void _used;
