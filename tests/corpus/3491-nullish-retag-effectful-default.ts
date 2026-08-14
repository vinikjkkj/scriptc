// The RETAGGED `??` with an EFFECTFUL default.
//
// `a ?? b` where the default widens the result union used to lower to an
// interned helper taking BOTH operands, so `b` was evaluated eagerly. JS
// evaluates it lazily, so the shape was restricted to effect-free defaults
// and everything else fenced. The re-tag now happens in the non-nullish
// branch, where the default is not evaluated at all.
//
// Every case below asserts the LAZINESS as a value, not as a comment: a
// counter the default increments must still read 0 after a present left.
// The shapes are zapo's — a clock call over a sub-union left, an
// optional-chain index read, a variable narrowed out of `unknown`, and a
// record default over a record-armed left.

let calls = 0;
function clock(): number {
    calls += 1;
    return 7;
}

interface Long {
    high: number;
    low: number;
    unsigned: boolean;
}

// A SUB-UNION left (two non-unit arms) into a two-arm result: the arm-wise
// re-tag, with the default only reached on the unit tags.
function stamp(a: number | null | Long | undefined): number | Long {
    return a ?? clock();
}

const long: Long = { high: 1, low: 2, unsigned: false };
console.log(JSON.stringify(stamp(5)), calls);
console.log(JSON.stringify(stamp(long)), calls);
console.log(JSON.stringify(stamp(null)), calls);
console.log(JSON.stringify(stamp(undefined)), calls);

// ONE non-unit arm, and a default that is an optional-chain index read —
// not droppable (an index read can trap), so this fenced before.
function target(id: string | null | undefined, meta: { [k: string]: string | undefined } | undefined): string | undefined {
    return id ?? meta?.["target_id"];
}
console.log(target("direct", { target_id: "meta" }));
console.log(target(null, { target_id: "meta" }));
console.log(target(null, undefined));
console.log(target(undefined, {}));

// The default is a variable NARROWED out of `unknown`: the narrowing
// bridge is a checked extraction, which is a call, which was never
// droppable either.
function decode(v: number): string | null {
    return v === 1 ? "one" : null;
}
function nameOrRaw(raw: unknown): unknown {
    if (typeof raw !== "number") return raw;
    return decode(raw) ?? raw;
}
console.log(JSON.stringify(nameOrRaw(1)), JSON.stringify(nameOrRaw(2)), JSON.stringify(nameOrRaw("s")));

// A REF arm re-tagging: the extraction is +1 and the ownership moves into
// the new box. Run it in a loop so a leaked or double-released box shows
// up under SCRIPTC_RC_AUDIT=1 rather than only in a size number.
interface Node2 {
    tag: string;
}
function pick(n: Node2 | null, made: () => Node2[]): Node2 | Node2[] {
    return n ?? made();
}
let built = 0;
const make = (): Node2[] => {
    built += 1;
    return [{ tag: "made" }];
};
let acc = "";
for (let i = 0; i < 200; i += 1) {
    const r = pick(i % 2 === 0 ? { tag: "given" } : null, make);
    acc = Array.isArray(r) ? r[0]!.tag : r.tag;
}
console.log(acc, built);

// The left evaluates EXACTLY ONCE even when it is a call.
let reads = 0;
function readLeft(): string | null {
    reads += 1;
    return reads === 1 ? "first" : null;
}
function orLen(): string | number {
    return readLeft() ?? clock();
}
console.log(orLen(), reads, calls);
console.log(orLen(), reads, calls);
