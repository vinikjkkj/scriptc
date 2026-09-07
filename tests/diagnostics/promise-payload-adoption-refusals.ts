// The REFUSED side of the PROMISE arm of `lambdaSignature`'s adoption
// ladder — the rule that lets an unannotated lambda whose slot returns
// `Promise<C>` present that promise as its ABI instead of the
// `Promise<R'>` tsc inferred from its body.
//
// The admitted side is corpus
// 7796-a-promise-payload-adopts-the-callbacks-declared-return.ts, and
// zapo-js 1.6.2's
// `client/coordinators/WaMessageDispatchCoordinator.ts:697` is the site
// that motivated it. This file is the other side, because a predicate
// tested only on what it accepts is untested.
//
// THE ADOPTION IS A RENAME, NOT A CONVERSION. It says the ABI's return
// slot is the slot's promise; it does not build anything, and it cannot
// make a value the return coercion could not already carry. So every case
// below still REFUSES — the adoption fires, the return coercion is then
// asked for a payload conversion that does not exist, and the fence lands
// at the return with the two payloads named. That is the boundary: what
// the rule moves is WHERE a program is refused, never WHETHER.
//
// Each case is one the literal-at-the-slot rule in lower-builtins.ts
// deliberately declines (its own refusals are pinned against the UNION
// slot in promise-resolve-literal-refusals.ts). Here they are asked
// against the NARROW slot, which is the arrangement the promise adoption
// applies to, so the two files together fence the same three shapes from
// both sides of the union/no-union split.

type Fanout = {
    readonly extraParticipants?: readonly { readonly jid: string }[];
    readonly customNodes?: readonly string[];
    readonly phash?: string;
};

// The 1.6.2 slot: a bare `Promise<C>`, no settle-or-value union.
function run(customize: () => Promise<Fanout>): void {
    void customize();
}

// ── 1. A MEMBER THE SLOT DOES NOT NAME ───────────────────────────────────
//
// tsc never freshness-checks inside `Promise.resolve`: the literal's
// contextual type is the type PARAMETER, so the excess-property check that
// would reject `const v: Fanout = { phash, bogus }` never runs. Building it
// at `Fanout` would DROP `bogus`, an own key Node keeps, so the
// literal-at-the-slot rule declines — and the payload that reaches the
// return is then `{ bogus: number; phash: string }`, which no conversion
// carries into `Fanout` inside a promise.
run(() => Promise.resolve({ phash: "1", bogus: 1 }));

// ── 2. A SPREAD ──────────────────────────────────────────────────────────
//
// The spread source may carry RUNTIME keys the slot's shape has no slot
// for — tsc drops an index signature when it infers an object literal's
// type, so the literal's own type is not evidence about what the value
// holds. Declined at the literal for that reason, and refused here for the
// same one: the width family does not promise a bridge that can drop what
// Node keeps.
const donor = { phash: "2" };
run(() => Promise.resolve({ ...donor }));

// ── 3. A NAMED VALUE RATHER THAN A LITERAL ───────────────────────────────
//
// `Promise.resolve(named)` then `(await p) === named` is TRUE in Node — the
// promise fulfils with the very object — so rebuilding it at the slot's
// shape would fulfil with a COPY and lose an identity a caller can observe.
// The literal rule is scoped to a literal WRITTEN AT THE CALL precisely
// because nothing else holds a reference to one, and the adoption does not
// widen that scope: it renames the ABI, the value is still the named
// object's promise, and the payload width it would take to reach `Fanout`
// is the conversion `promiseCoerceAdapter` declines — an
// `async (p) => coerce(await p)` is a microtask turn Node does not take.
const named: { readonly phash: string } = { phash: "3" };
run(() => Promise.resolve(named));
