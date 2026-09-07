// A record filled through a RUN-TIME KEY, and the order its keys end up in.
//
// `{} as Record<Name, V | undefined>` is the only spelling TypeScript takes
// for a bag keyed by a literal union, and a loop then fills it by a computed
// key. Until now that construction was invisible to the write-order walk: it
// saw a literal that spelled NOTHING and no field write after it, so
// `Object.keys` and `JSON.stringify` answered the SHAPE's order at exit 0
// with no diagnostic of any kind. `moved` below is exactly that program —
// node answers "omega,alpha,zeta,mid" and the struct answered its shape's
// "alpha,mid,omega,zeta".
//
// A fence over every run-time-keyed write was built once and TAKEN BACK OUT,
// correctly: it never asked where the key came from, so it also refused
// tests/corpus/7793, whose fill order IS its source shape's enumeration
// order and DOES agree with the target's. Refusing a program that answers
// exactly what node answers is worse than the class it guards.
//
// What replaced it asks the narrower question — what ORDER do these keys
// arrive in? — and the answer is a FACT for two sources: a record's own
// enumeration, and a literal array of literal-typed elements. Where the fill
// order is known it becomes the shape's order (reconcileKeyOrders re-picks
// declaredOrder to it, the same thing one out-of-order literal gets), so the
// answer is RIGHT rather than refused. Where it is known and no single order
// can serve every fill of the shape, the disagreement is provable and
// refuses; that half cannot appear in a corpus program, and is pinned from
// outside in tests/diagnostics/two-fills-of-one-shape-in-two-orders.ts.

type Name = "omega" | "alpha" | "zeta" | "mid";

// ---- 1. A literal array of key names, in an order the shape does not have.

function moved(): Record<Name, number | undefined> {
    const view = {} as Record<Name, number | undefined>;
    let i = 0;
    for (const k of ["omega", "alpha", "zeta", "mid"]) {
        i = i + 1;
        view[k as Name] = i;
    }
    return view;
}

const m = moved();
console.log(Object.keys(m).join(","));
console.log(JSON.stringify(m));

// ---- 2. The array named ONE indirection away, which is the same literal.

const ORDER: readonly Name[] = ["zeta", "mid", "omega", "alpha"];

interface Cell {
    readonly n: number;
}

function indirect(): Record<Name, Cell | undefined> {
    const bag = {} as Record<Name, Cell | undefined>;
    let i = 10;
    for (const k of ORDER) {
        i = i + 1;
        bag[k] = { n: i };
    }
    return bag;
}
console.log(JSON.stringify(indirect()));

// ---- 3. A CONDITIONAL fill is a SUBSEQUENCE of the order above, and a
// subsequence of a right order is right: an enumeration lists only the keys
// that are PRESENT, in the relative order the shape declares. So the re-pick
// is made from the full sequence and both of these are node-exact.

type Pair = "second" | "first";

function some(skip: string): string {
    const p = {} as Record<Pair, number | undefined>;
    for (const k of ["second", "first"]) {
        if (k !== skip) p[k as Pair] = 1;
    }
    return Object.keys(p).join("/");
}
console.log(some("second"), some("nothing"));

// ---- 4. The 7793 shape: the key comes out of a record's OWN enumeration,
// and the fill order is that source shape's. It AGREES with the target's
// here, which is why nothing is re-picked and nothing is said — the case the
// withdrawn fence got wrong.

type Tag = "alpha" | "beta" | "gamma";
interface Entry {
    readonly code: number;
}

const SOURCE: Record<Tag, Entry> = {
    alpha: { code: 1 },
    beta: { code: 2 },
    gamma: { code: 3 },
};

function through(): Record<Tag, Entry | undefined> {
    const view = {} as Record<Tag, Entry | undefined>;
    for (const [name, entry] of Object.entries(SOURCE)) {
        view[name as Tag] = { code: entry.code };
    }
    return view;
}
const t = through();
console.log(JSON.stringify(t), Object.keys(t).join(","));

// ---- 5. `for...in` over the source is the same fact through another
// spelling, and the key order there DISAGREES with the target's, so this one
// re-picks.

type Slot = "east" | "west";
const FROM: Record<Slot, number> = { west: 1, east: 2 };

function viaForIn(): Record<Slot, number | undefined> {
    const out = {} as Record<Slot, number | undefined>;
    for (const k in FROM) {
        out[k as Slot] = FROM[k as Slot];
    }
    return out;
}
console.log(JSON.stringify(viaForIn()));
