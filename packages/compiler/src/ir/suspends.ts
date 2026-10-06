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
export type SuspendingLibCall = "async.hop";

export const SUSPENDING_LIB_CALLS = [
  "async.hop",
] as const satisfies readonly SuspendingLibCall[];

type _LibCallsCovered = AssertNever<
  Exclude<SuspendingLibCall, (typeof SUSPENDING_LIB_CALLS)[number]>
>;

/** Which suspenders the STACKLESS lane can lower. A suspender absent here is
 * fiber-only, and a function containing one must not be admitted. Today the
 * state machine has no counterpart for the microtask hop, so `async.hop`
 * keeps its function on the fiber lane. */
export const STACKLESS_LOWERABLE_LIB_CALLS: ReadonlySet<string> = new Set<SuspendingLibCall>([]);

/** Emit a fiber-only runtime primitive. The first argument is not decoration:
 * it forces the emission site to name a REGISTERED suspender, so a new
 * fiber-only call cannot reach the output without appearing in the list above
 * that liveness reads. */
export function fiberOnly(_which: SuspendingLibCall, c: string): string {
  return c;
}

const _used: readonly unknown[] = [
  null as unknown as _NodeKindsCovered,
  null as unknown as _LibCallsCovered,
];
void _used;
