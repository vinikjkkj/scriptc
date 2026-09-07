// The REFUSED side of `Promise.resolve(<object literal>)` built at the
// slot's shape.
//
// The rule that admits it is in lower-builtins.ts: an object literal
// WRITTEN INSIDE the call, whose contextual constituents agree on ONE
// record payload the literal can be built at, is built AT that payload
// instead of at the type tsc inferred for it — because
// `resolve<T>(value: T): Promise<Awaited<T>>` puts a conditional type
// between the slot and T, so the slot's type never reaches the literal and
// what stands between `Promise<{ phash: string }>` and `Promise<C>` is a
// width coercion inside a promise payload, the one conversion
// `coercibleValue` does not carry. Corpus
// 7792-promise-resolve-of-a-literal-built-at-the-slots-shape.ts is the
// admitted side; zapo-js 1.8.2's
// `client/coordinators/WaMessageDispatchCoordinator.ts:867` is the site
// that motivated it.
//
// This file is the other side, because a predicate tested only on what it
// accepts is untested. Each case below keeps the SC2003 it had before the
// rule existed, and each one is a case where taking it would answer
// something Node does not.

type Fanout = {
    readonly extraParticipants?: readonly { readonly jid: string }[];
    readonly customNodes?: readonly string[];
    readonly phash?: string;
};

function run(customize: () => Promise<Fanout> | Fanout): void {
    void customize();
}

// ── 1. A MEMBER THE SLOT DOES NOT NAME ───────────────────────────────────
//
// tsc never freshness-checks this position: the literal's contextual type
// is the type PARAMETER, so the excess-property check that would reject
// `const v: Fanout = { phash, bogus }` never runs, and `{ phash: string;
// bogus: number }` is perfectly assignable to a slot whose members are all
// optional. Building it at `Fanout` would therefore DROP `bogus` — the
// value would lose an own key Node keeps, silently. The rule requires
// every member the literal names to exist on the slot's shape.
run(() => Promise.resolve({ phash: "1", bogus: 1 }));

// ── 2. A SPREAD ──────────────────────────────────────────────────────────
//
// The spread source may carry RUNTIME keys the slot's shape has no slot
// for — tsc drops an index signature when it infers an object literal's
// type, so the literal's own type is not evidence about what the value
// holds. The same reason `spreadErasedIndexValue` exists one file over,
// and the same stance: the width family does not promise a bridge that
// can drop what Node keeps.
const donor = { phash: "2" };
run(() => Promise.resolve({ ...donor }));

// ── 3. A NAMED VALUE RATHER THAN A LITERAL ───────────────────────────────
//
// `Promise.resolve(named)` then `(await p) === named` is TRUE in Node —
// the promise fulfils with the very object. Rebuilding it at the slot's
// shape would fulfil with a COPY, so an identity a caller can observe
// would be gone. The rule is scoped to a literal WRITTEN AT THE CALL
// precisely because nothing else holds a reference to one; it is the same
// line the bare-`[]` rule beside it draws between a literal and an `arr`.
const named: { readonly phash: string } = { phash: "3" };
run(() => Promise.resolve(named));

// TWO CONTEXTUAL PAYLOADS is not here either, and for the mirror reason: a
// slot spelling `Promise<A> | Promise<B>` gives the literal no one shape,
// so the rule's `payloads.size === 1` gate declines it — but tsc resolves
// the arrow's contextual return against the matching constituent first, so
// the literal reaches the lowering already typed at that arm and the rule
// is never the thing that decides. The gate stays because it is the same
// ambiguity stance `promiseArmFor` takes for two promise arms, and because
// nothing guarantees tsc will always pick.

// A REQUIRED MEMBER WITH NOTHING TO COMPLETE IT is deliberately NOT here.
// `recordWidthPlan` would decline that pair — the completion rule fills a
// missing member with its undefined arm, which only an optional-flavored
// one has — but tsc gets there first: `Promise<{ phash: string }>` really
// IS checked against `Promise<Strict>` at this position, so such a program
// fails preflight with SC0001 and the rule is never asked. The guard stays
// in the rule because it is the width family's own statement about the
// pair, not because a program can reach it from here.
