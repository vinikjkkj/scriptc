// The adapter is a CLOSURE over the callback, so it participates in
// refcounting like any other function value, and it is built per HOF call
// site — including sites inside a loop, inside another HOF's callback, and
// over element types that are themselves refcounted (records holding
// strings and arrays). Run under SCRIPTC_RC_AUDIT this program must exit 0.
//
// Also pinned here: the widened parameter may be a union of MORE than the
// element plus a unit — `E | string | undefined` wraps into the same arm —
// and a callback that RETURNS a record keeps the map result's element type
// (the adapter converts arguments, never the result: its return slot is the
// callback's own).

type E = { id: string; tags: string[] };
type Out = { key: string; count: number };

const rows: E[] = [
    { id: "a", tags: ["x", "y"] },
    { id: "b", tags: [] },
    { id: "c", tags: ["z"] },
];

function toOut(e: E | null | undefined): Out {
    return { key: e ? e.id : "-", count: e ? e.tags.length : -1 };
}
function wideMulti(e: E | string | undefined): string {
    if (e === undefined) return "u";
    if (typeof e === "string") return e;
    return e.id;
}

console.log(rows.map(toOut).map((o) => o.key + o.count).join(","));
console.log(rows.map(wideMulti).join(","));

// Nested: the outer callback's body runs an inner HOF with its own widened
// callback, so two adapters are live at once per outer iteration.
const grouped: string[] = rows.map((row) => row.tags.map((t: string | undefined) => (t ?? "") + row.id).join("+"));
console.log(grouped.join("|"));

// In a loop: the adapter closure is created and released on every pass.
let acc = "";
for (let i = 0; i < 3; i++) {
    acc += rows.map(toOut).length;
    acc += rows.filter((e: E | undefined) => e !== undefined && e.tags.length > 0).length;
}
console.log(acc);

// The callback is itself held in a variable first, then handed over: the
// adapter wraps the VALUE, not the declaration.
const held: (e: E | null | undefined) => Out = toOut;
console.log(rows.map(held).map((o) => o.count).join(","));

// A returned array of records survives past the call (the adapter must not
// have taken ownership of anything it hands on).
function build(): Out[] {
    return rows.map(toOut);
}
const built = build();
console.log(built.length, built[2]!.key);
