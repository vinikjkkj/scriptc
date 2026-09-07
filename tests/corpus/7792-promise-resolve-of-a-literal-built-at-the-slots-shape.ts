// `Promise.resolve({ ... })` written INSIDE a call whose slot spells a
// wider record — and why the answer is the literal's own construction and
// not an adapter.
//
// `resolve<T>(value: T): Promise<Awaited<T>>` puts a conditional type
// between the slot's contextual type and T, so the inference that supplies
// a payload in every ordinary slot never runs: an object literal written
// at the call keeps its OWN inferred type. `Promise.resolve({ phash })`
// into a `Promise<C> | C` slot therefore arrives as
// `Promise<{ phash: string }>`, and what stands between that and
// `Promise<C>` is a WIDTH COERCION INSIDE A PROMISE PAYLOAD — the one
// conversion `coercibleValue` does not carry, so `promiseCoerceAdapter`
// declines and the union coercion reports SC2003 ("union types must match
// exactly"), a message about unions for a source that is not one.
// zapo-js 1.8.2's `client/coordinators/WaMessageDispatchCoordinator.ts:867`
// is the site: the sender-key fanout hook returns
// `Promise.resolve({ phash: computePhashV2(targets) })` into a
// settle-or-value slot whose payload names three optional members.
//
// THE FIX IS AT THE LITERAL, NOT AT THE PROMISE. The literal is built at
// the SLOT's shape — the completion rule fills each missing
// optional-flavored member with its undefined arm, exactly as
// `const v: C = { phash }` does — so the promise is CONSTRUCTED at the
// slot's payload and no conversion exists to run.
//
// Teaching the width family into the payload instead would have routed it
// through `promiseCoerceAdapter`'s `async (p) => coerce(await p)`, and
// that is a MICROTASK TURN Node does not take: `const q: Promise<Wide> = p`
// is a relabel in JS, not a re-fulfilment. A turn Node does not take is a
// wrong answer, not a cost — which is why the interleave below is part of
// what this program pins, and why it is written so the promise under test
// is the ONLY thing between the ticks.
//
// It is sound because the literal is WRITTEN HERE: nothing else holds a
// reference, so there is no identity to preserve. The same rule declines
// three neighbours it cannot prove — a literal carrying a member the slot
// does not name (it would DROP), a literal with a spread (its source may
// carry runtime keys the slot's shape has no slot for), and a NAMED value
// (`(await p) === named` is observable in Node). Those live in
// tests/diagnostics/promise-resolve-literal-refusals.ts.

type Fanout = {
    readonly extraParticipants?: readonly { readonly jid: string }[];
    readonly customNodes?: readonly string[];
    readonly phash?: string;
};

const log: string[] = [];

async function publish(customize: () => Promise<Fanout> | Fanout): Promise<void> {
    const r = await customize();
    log.push("keys:" + Object.keys(r).join(","));
    log.push("json:" + JSON.stringify(r));
    log.push("phash:" + (r.phash ?? "<none>"));
    log.push("extra:" + String(r.extraParticipants === undefined));
}

// ── 1. The site's shape: one named member, two completed ─────────────────
async function one(): Promise<void> {
    await publish(() => {
        return Promise.resolve({ phash: "2:abc" });
    });
}

// ── 2. A CONCISE arrow body, same slot ────────────────────────────────────
async function two(): Promise<void> {
    await publish(() => Promise.resolve({ customNodes: ["a", "b"] }));
}

// ── 3. Members written OUT OF the slot type's declared order. Own-key
// order is the LITERAL's own writing order on both sides: the literal is
// one recordLit at the slot's shape, so reconcileKeyOrders sees its
// spelling and re-picks the shape's enumeration to match -- the same
// answer `const v: Solo = { soloPhash, soloParticipants }` gets.
//
// It needs its OWN slot type, with its own MEMBER NAMES -- shapes intern
// structurally, so a same-shaped alias is the same shape -- because that
// re-pick is only available while a shape has exactly ONE spelling. A
// shape built by literals spelled two different ways keeps its declared
// order for both, and the one written out of that order then enumerates
// wrong. That divergence is not this rule's and not promises': a pair of
// plain annotated `const`s of one optional-member type, spelled in two
// orders and enumerated through a parameter, reproduces it exactly.
type Solo = {
    readonly soloParticipants?: readonly { readonly jid: string }[];
    readonly soloNodes?: readonly string[];
    readonly soloPhash?: string;
};

async function three(): Promise<void> {
    const out: Promise<Solo> | Solo = Promise.resolve({
        soloPhash: "3:zzz",
        soloParticipants: [{ jid: "a@s" }],
    });
    const r = await out;
    log.push("keys:" + Object.keys(r).join(","));
    log.push("json:" + JSON.stringify(r));
}

// ── 4. Every member supplied: nothing to complete, and the rule must not
// change what an already-exact literal does.
async function four(): Promise<void> {
    await publish(() =>
        Promise.resolve({
            extraParticipants: [{ jid: "b@s" }],
            customNodes: ["n"],
            phash: "4:full",
        }),
    );
}

// ── 5. The NON-promise arm of the same slot, unchanged ───────────────────
async function five(): Promise<void> {
    await publish(() => {
        return { phash: "5:plain" };
    });
}

// ── 6. THE TICK LEDGER. The literal is built at the ANNOTATED payload
// (one contextual constituent rather than a settle-or-value union, which
// is the same rule asked without the union), and the promise it makes is
// ALREADY RESOLVED — so Node runs the `.then` reaction on the first turn
// after the call, before `t2`. An adapter (`async (p) => coerce(await p)`)
// would insert a turn of its own and the `settled` line would slide past
// `t2`. That is the whole reason the fix is at the literal.
async function ticks(): Promise<void> {
    const p: Promise<Fanout> = Promise.resolve({ phash: "6:tick" });
    void p.then((v) => {
        log.push("settled:" + (v.phash ?? "<none>"));
    });
    log.push("t1");
    await Promise.resolve();
    log.push("t2");
    await Promise.resolve();
    log.push("t3");
    const got = await p;
    log.push("t4:" + Object.keys(got).join(","));
}

// ── 7. The same ledger through the SETTLE-OR-VALUE slot, whose await
// walks the union's own tag. Both arms are exercised above; here only the
// turn count is under test.
async function unionTicks(): Promise<void> {
    const slot: Promise<Fanout> | Fanout = Promise.resolve({ phash: "7:tick" });
    log.push("u1");
    const got = await slot;
    log.push("u2:" + (got.phash ?? "<none>"));
}

async function main(): Promise<void> {
    await one();
    await two();
    await three();
    await four();
    await five();
    await ticks();
    await unionTicks();
    console.log(log.join("\n"));
}

void main();
