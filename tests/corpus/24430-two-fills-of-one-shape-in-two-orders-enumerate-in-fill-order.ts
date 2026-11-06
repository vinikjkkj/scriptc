// tests/diagnostics/two-fills-of-one-shape-in-two-orders.ts used to refuse these: a record filled through a RUN-TIME KEY,
// by two loops that fill one shape in two orders. Each instance now lists its keys in the order they were first written,
// so both enumerate as Node does (Object.keys and JSON.stringify).

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
