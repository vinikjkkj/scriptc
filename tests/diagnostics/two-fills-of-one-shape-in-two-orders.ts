// A record filled through a RUN-TIME KEY, made loud where — and ONLY where —
// the disagreement is provable.
//
// `{} as Record<Name, V | undefined>` is the only spelling TypeScript takes
// for a bag keyed by a literal union, and a loop then fills it by a computed
// key. That construction used to be invisible: the write-order walk saw a
// literal spelling nothing and no field write after it, so `Object.keys`
// answered the SHAPE's order at exit 0 with no diagnostic of any kind.
//
// A fence over every run-time-keyed write was built once and taken back out,
// because it never asked where the key came from and so also refused
// tests/corpus/7793 — a program whose fill order IS its source shape's
// enumeration order, agrees with the target's, and is byte-identical to
// node. What is refused here is not "a run-time key". It is a fill order the
// compiler CAN name and that no single declared order can serve.
//
// The agreeing and re-pickable halves cannot appear in this file, because
// they compile: tests/corpus/7796 carries them.

// ---- 1. TWO fills of ONE shape, in two orders. Either order alone would
// become the shape's; together there is no order that is right for both, so
// the re-pick stands down and each fill is measured against the order the
// shape kept. The hint names both.
type Name = "omega" | "alpha" | "zeta";

function forward(): string {
    const view = {} as Record<Name, number | undefined>;
    for (const k of ["omega", "alpha", "zeta"]) {
        view[k as Name] = 1;
    }
    return Object.keys(view).join(",");
}

function backward(): string {
    const view = {} as Record<Name, number | undefined>;
    for (const k of ["zeta", "alpha", "omega"]) {
        view[k as Name] = 2;
    }
    return Object.keys(view).join(",");
}

console.log(forward(), backward());

// ---- 2. The same disagreement reached through JSON.stringify rather than
// Object.keys, and with the fill order taken from a RECORD's enumeration
// instead of a literal array. `SOURCE` enumerates its own literal's order,
// which is not the order the second fill uses.
type Slot = "north" | "south";

const SOURCE: Record<Slot, number> = { south: 1, north: 2 };

function copied(): string {
    const out = {} as Record<Slot, number | undefined>;
    for (const [k, v] of Object.entries(SOURCE)) {
        out[k as Slot] = v;
    }
    return JSON.stringify(out);
}

function reversed(): string {
    const out = {} as Record<Slot, number | undefined>;
    for (const k of ["north", "south"]) {
        out[k as Slot] = 9;
    }
    return JSON.stringify(out);
}

console.log(copied(), reversed());
