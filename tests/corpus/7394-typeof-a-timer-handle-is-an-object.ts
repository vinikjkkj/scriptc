// `typeof` and `in` over the stdlib OPAQUE HANDLES — `NodeJS.Timeout`
// (setTimeout/setInterval) and `NodeJS.Immediate` (setImmediate).
//
// Those interfaces map to F64 in this compiler: the value carried is the
// numeric timer id the runtime registry keys on, and `.ref()`/`.unref()`/
// `.hasRef()` lower over it (frontend/types.ts's Timeout arm). Node's value
// is an OBJECT, so two questions about it were answered from the
// REPRESENTATION instead of the declared type:
//
//     typeof t              Node "object";  this compiler said "number"
//     typeof t === 'object' Node true;      this compiler said false
//     'unref' in t          Node true;      this compiler REFUSED
//                             (SC1090 "'in' on 'number' receivers")
//
// The first two were a SILENT WRONG ANSWER: exit 0, both backends, zero
// diagnostics. The shape is not exotic — it is the standard way a library
// tells a Node timer from a browser one, and zapo's own
// `store-mysql/cleanup.ts:59` and `store-postgres/cleanup.ts` are both
// exactly:
//
//     if (typeof this.timer === 'object' && 'unref' in this.timer) {
//         this.timer.unref()
//     }
//
// so a compiled store silently skipped the unref and held the event loop
// open. `typeof` is the one consumer that never needs the VALUE, and `in`
// over a declared member set asks the same kind of question, so both now
// read the declared type.
//
// WHAT MUST STILL BE ANSWERED THE OTHER WAY, and is pinned below:
//   - a plain `number` still answers "number";
//   - `Timeout | undefined` does NOT fold — Node answers "undefined" for
//     that arm, so the per-arm chain keeps it;
//   - `Timeout | null` DOES fold, because Node answers "object" for null
//     too, so the union has one answer;
//   - a user's own `interface Timeout` is not the library's and takes the
//     ordinary record path.
// A key the interface does not declare STILL REFUSES; that half cannot
// live here (this program must build) and is pinned in
// tests/diagnostics/timer-handle-unmodelled-key.ts.

const t = setInterval(() => {
    console.log("interval body never runs: cleared on the same turn");
}, 100_000);

console.log("1 typeof:", typeof t);
console.log("2 is object:", typeof t === "object");
console.log("3 is number:", typeof t === "number");
console.log("4 members:", "ref" in t, "unref" in t, "hasRef" in t, "refresh" in t);

// The zapo guard, verbatim in shape.
if (typeof t === "object" && "unref" in t) {
    t.unref();
    console.log("5 unref branch taken, hasRef now:", t.hasRef());
} else {
    console.log("5 unref branch NOT taken");
}
t.ref();
console.log("6 ref'd again, hasRef:", t.hasRef());
clearInterval(t);

// ── the `Timeout | null` slot a `let` keeps: ONE answer, so it folds ──
let slot: ReturnType<typeof setTimeout> | null = null;
console.log("7 null arm:", typeof slot);
slot = setTimeout(() => {
    console.log("timeout body never runs: cleared on the same turn");
}, 100_000);
console.log("8 handle arm:", typeof slot);
if (typeof slot === "object" && "unref" in slot) {
    slot.unref();
    console.log("9 slot unref'd");
}
clearTimeout(slot);

// ── the `| undefined` arm must NOT fold: Node says "undefined" ────────
let maybe: ReturnType<typeof setTimeout> | undefined;
console.log("10 undefined arm:", typeof maybe);
maybe = setTimeout(() => {
    console.log("never runs");
}, 100_000);
console.log("11 assigned arm:", typeof maybe);
clearTimeout(maybe);

// ── setImmediate's handle rides the same rule ─────────────────────────
const im = setImmediate(() => {
    console.log("12 immediate ran");
});
console.log("13 immediate:", typeof im, "hasRef" in im, "unref" in im);
im.unref();
im.ref();
console.log("14 immediate hasRef:", im.hasRef());

// ── a plain number is still a number ──────────────────────────────────
const n = 7;
console.log("15 plain number:", typeof n, typeof n === "object");

// ── a user's own interface of the same name is not the library's ──────
interface Timeout {
    readonly ticks: number;
}
const own: Timeout = { ticks: 3 };
console.log("16 own interface:", typeof own, "ticks" in own);

export {};
