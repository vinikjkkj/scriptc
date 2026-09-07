// A lambda whose slot returns `Promise<C>` — WITHOUT the settle-or-value
// union — and the promise payload the two sides disagreed about.
//
// This is the mirror of 7792. There the callback slot was
// `() => Promise<C> | C`, so the literal written inside `Promise.resolve`
// was built at the slot's payload and the ABI the arrow presented was the
// slot's own UNION: `lambdaSignature`'s union adoption had already made the
// two agree, so the return coercion was an arm wrap and nothing else
// happened. Here the slot is the bare `Promise<C>`, one arm fewer, and that
// adoption does not apply — a SYNC lambda's inferred return is the whole
// `Promise<R>`, so the record adoption beside it (which peels only the
// ASYNC frame) never sees the divergent PAYLOAD either.
//
// What was left was a refusal the compiler manufactured for itself. The
// literal is built AT the slot's payload, which is what keeps the key
// ORDER the program wrote and what keeps the value OFF
// `promiseCoerceAdapter`'s `async (p) => coerce(await p)` — a microtask
// turn Node does not take. So the VALUE is `Promise<C>` while the ABI still
// said `Promise<{ phash: string }>`, and the return coercion fenced SC1090:
// value WIDE, slot NARROW, the exact mirror of the width the record
// adoption already admits one wrapper in.
//
// zapo-js 1.6.2's `client/coordinators/WaMessageDispatchCoordinator.ts:697`
// is the site, and it is the SAME SOURCE LINE as 1.8.2's `:867` — byte for
// byte, `return Promise.resolve({ phash: computePhashV2(phashTargets) })`.
// Only the declaration moved: 1.6.2 spells `customize?: (f) => Promise<C>`
// and 1.8.2 spells `customize?: (f) => Promise<C> | C`. One arm in the
// SIGNATURE decided whether the program compiled.
//
// The promise arm of the adoption ladder closes it, and it costs no
// conversion at all: it renames the ABI's return slot to the type the value
// already has, so the return coercion is identity where it used to be a
// refusal and the closure VALUE matches the callback slot exactly. The tick
// ledgers below are the evidence that nothing was inserted — and they are
// written so the promise under test is the ONLY thing between the ticks,
// because a measurement taken over a WIDENED promise measures the adapter
// rather than the construct (7791's header).

type Fanout = {
    readonly extraParticipants?: readonly { readonly jid: string }[];
    readonly customNodes?: readonly string[];
    readonly phash?: string;
};

const log: string[] = [];

// THE 1.6.2 SLOT: a bare `Promise<C>`, no settle-or-value union.
async function publish(customize: () => Promise<Fanout>): Promise<void> {
    const r = await customize();
    log.push("keys:" + Object.keys(r).join(","));
    log.push("json:" + JSON.stringify(r));
    log.push("phash:" + (r.phash ?? "<none>"));
    log.push("extra:" + String(r.extraParticipants === undefined));
}

// ── 1. The site's shape: a BLOCK body, one named member, two completed ────
async function one(): Promise<void> {
    await publish(() => {
        return Promise.resolve({ phash: "1:abc" });
    });
}

// ── 2. A CONCISE arrow body, same slot ────────────────────────────────────
async function two(): Promise<void> {
    await publish(() => Promise.resolve({ customNodes: ["a", "b"] }));
}

// ── 3. The zapo SPELLING: the callback is a PROPERTY of an object literal
// passed to the call, not a bare argument. The contextual type reaches the
// arrow through the record member rather than through a parameter, and the
// adoption must see it the same way.
type FanoutInput = {
    readonly tag: string;
    readonly customize?: () => Promise<Fanout>;
};

async function publishFrom(input: FanoutInput): Promise<void> {
    log.push("tag:" + input.tag);
    if (input.customize === undefined) {
        log.push("nocustomize");
        return;
    }
    const r = await input.customize();
    log.push("mkeys:" + Object.keys(r).join(","));
    log.push("mjson:" + JSON.stringify(r));
}

async function three(): Promise<void> {
    await publishFrom({
        tag: "3",
        customize: () => {
            return Promise.resolve({ phash: "3:prop" });
        },
    });
    await publishFrom({ tag: "3b" });
}

// ── 4. MEMBERS WRITTEN OUT OF the slot type's declared order, through the
// narrow slot. Own-key order is the LITERAL's own writing order: the value
// is one recordLit at the slot's shape, so reconcileKeyOrders sees its
// spelling and re-picks the shape's enumeration to match. Adopting the ABI
// return type changes no part of that — it renames a slot, it does not
// build a value — and this case is here to say so through `Object.keys`
// and `JSON.stringify`, which are where own-key order is observable.
//
// It needs its OWN slot type with its own MEMBER NAMES, for the reason
// 7792 gives: shapes intern structurally, so a same-shaped alias is the
// same shape, and the re-pick is only available while a shape has exactly
// one spelling.
type Solo = {
    readonly soloParticipants?: readonly { readonly jid: string }[];
    readonly soloNodes?: readonly string[];
    readonly soloPhash?: string;
};

async function publishSolo(customize: () => Promise<Solo>): Promise<void> {
    const r = await customize();
    log.push("skeys:" + Object.keys(r).join(","));
    log.push("sjson:" + JSON.stringify(r));
}

async function four(): Promise<void> {
    await publishSolo(() =>
        Promise.resolve({
            soloPhash: "4:zzz",
            soloParticipants: [{ jid: "a@s" }],
        }),
    );
}

// ── 5. NOTHING DIVERGENT: the slot's payload names exactly the members
// the literal writes, at exactly their types, so the literal's own
// inferred record IS the slot's and both the literal rule and the adoption
// stand down (`!typeEquals` is the first gate on each). The rule must not
// change what an already-exact literal does, and this is the case that
// says so from the side where it is asked and declines.
type Exact = {
    readonly exactA: string;
    readonly exactB: string;
};

async function publishExact(customize: () => Promise<Exact>): Promise<void> {
    const r = await customize();
    log.push("ekeys:" + Object.keys(r).join(","));
    log.push("ejson:" + JSON.stringify(r));
}

async function five(): Promise<void> {
    await publishExact(() =>
        Promise.resolve({ exactA: "5:a", exactB: "5:b" }),
    );
}

// ── 6. AN EXPLICIT RETURN ANNOTATION on the arrow, which compiled before
// the adoption existed and must keep answering the same thing: the
// annotation IS the ABI, so there is nothing to adopt.
async function six(): Promise<void> {
    await publish((): Promise<Fanout> => Promise.resolve({ phash: "6:ann" }));
}

// ── 7. THE TICK LEDGER, with the arrow ANNOTATED — the control. Nothing
// is adopted here (the annotation is the ABI), so this ledger reads the
// literal-at-the-slot construction alone: the promise handed back is
// ALREADY the destination type and ALREADY RESOLVED, so Node runs the
// `.then` reaction on the first turn after the call, before `t2`. An
// adapter would insert a turn of its own and `settled` would slide past
// `t2`. Case 8 is the same ledger with the return type left to inference,
// which is where the adoption fires: the two must read identically, and
// that is the measurement that says the adoption renames rather than
// converts.
async function ticks(): Promise<void> {
    let captured: Promise<Fanout> | null = null;
    const make = (): Promise<Fanout> => Promise.resolve({ phash: "7:tick" });
    captured = make();
    void captured.then((v) => {
        log.push("settled:" + (v.phash ?? "<none>"));
    });
    log.push("t1");
    await Promise.resolve();
    log.push("t2");
    await Promise.resolve();
    log.push("t3");
    const got = await captured;
    log.push("t4:" + Object.keys(got).join(","));
}

// ── 8. The SAME ledger, turn for turn, with the arrow's return type left
// to INFERENCE and the slot supplied by the callback parameter — the shape
// the adoption actually fires on. `usettled` must land between `u1` and
// `u2`, exactly where `settled` lands between `t1` and `t2` above. A turn
// inserted by an adapter would push it past `u2`, and the difference
// between the two ledgers would be the adoption's cost. There is none.
async function callTicks(customize: () => Promise<Fanout>): Promise<void> {
    const p = customize();
    void p.then((v) => {
        log.push("usettled:" + (v.phash ?? "<none>"));
    });
    log.push("u1");
    await Promise.resolve();
    log.push("u2");
    await Promise.resolve();
    log.push("u3");
    const got = await p;
    log.push("u4:" + Object.keys(got).join(","));
}

async function eight(): Promise<void> {
    await callTicks(() => Promise.resolve({ phash: "8:tick" }));
}

async function main(): Promise<void> {
    await one();
    await two();
    await three();
    await four();
    await five();
    await six();
    await ticks();
    await eight();
    console.log(log.join("\n"));
}

void main();
