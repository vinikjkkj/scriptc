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
// they compile: tests/corpus/7796 carries them. So does the disagreement
// itself - two fills in two orders, enumerated in each instance's own order
// - in tests/corpus/24430. What stays refused is the instance leaving its
// type: the widened slot cannot carry the order the fill made.

// ---- 1. TWO fills of ONE shape in two orders, each WIDENED into an 'unknown' slot.
type Name = "omega" | "alpha" | "zeta";
function forward(): unknown {
    const view = {} as Record<Name, number | undefined>;
    for (const k of ["omega", "alpha", "zeta"]) {
        view[k as Name] = 1;
    }
    return view;
}
function backward(): unknown {
    const view = {} as Record<Name, number | undefined>;
    for (const k of ["zeta", "alpha", "omega"]) {
        view[k as Name] = 2;
    }
    return view;
}
console.log(Object.keys(forward() as object).join(","), Object.keys(backward() as object).join(","));
