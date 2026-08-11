// Promise IDENTITY across a payload conversion.
//
// A promise's payload slot is typed per kind, so a `Promise<T>` cannot
// stand in for a `Promise<unknown>`: the compiler bridges the two with an
// adapter that awaits the source and converts what comes out. JavaScript's
// assignment creates no promise, so every one of these comparisons is
// about ONE object in Node and the bridge must not be visible.
//
// Both directions matter and both are here. Same-in/same-out (the same
// source through the same slot is the same object) is the answer a dedup
// map's eviction guard depends on. Different-in/different-out (two sources
// stay two objects) is the answer a memo that is too coarse would destroy,
// and it is the more dangerous of the two because a shared promise where
// the program expects distinct ones is silent.
async function mk(v: string): Promise<string> {
    return v;
}

async function main(): Promise<void> {
    const p = mk("p");
    const q = mk("q");

    // ── same in, same out ────────────────────────────────────────────
    const m = new Map<string, Promise<unknown>>();
    m.set("p", p);
    console.log("same-in/same-out:", m.get("p") === p);
    console.log("stable across reads:", m.get("p") === p, m.get("p") === p);

    // Two independent WIDE bindings of one source are one object.
    const w1: Promise<unknown> = p;
    const w2: Promise<unknown> = p;
    console.log("two wide bindings:", w1 === w2);

    // ── different in, different out ──────────────────────────────────
    m.set("q", q);
    console.log("different-in/different-out:", m.get("q") === p, m.get("q") === q);
    console.log("two sources stay two:", m.get("p") === m.get("q"));
    const w3: Promise<unknown> = q;
    console.log("wide bindings of two sources:", w1 === w3);
    console.log("a key that was never set:", m.get("z") === p);

    // ── a conversion is still a conversion ───────────────────────────
    // Two DIFFERENT slots over ONE source: the memo key is the (source,
    // conversion) pair, so each destination keeps its own payload
    // representation and each one memo-hits on its own.
    const opt = new Map<string, Promise<string | undefined>>();
    opt.set("p", p);
    console.log("second conversion memo-hits:", opt.get("p") === p);
    console.log("first conversion still hits:", m.get("p") === p);

    // ── and the values still arrive ──────────────────────────────────
    const wide = m.get("p");
    console.log("payloads:", await p, await q);
    console.log("through the wide slot:", wide === undefined ? "gone" : "held");
    console.log("delete:", m.delete("p"), m.get("p") === p);
}

void main();
