// The three SILENT wrong key orders, made loud, and since made EXACT. Cases 1
// and 2 (a spread, a function return) and the plain filled record now
// enumerate in Node's order: they live in
// tests/corpus/24429-spread-return-and-filled-record-enumerate-in-node-order.ts
// and compile. What is left here is the crossing that still refuses: a record
// filled by assignment, widened into an 'unknown' slot.
// Measured on both backends against node v25.9.0 before the fix
// (tests/perf/keyorder/boundary/p/p06, p19, p20).

// ---- 3. A RECORD FILLED BY ASSIGNMENT, WIDENED. The order is made by the
// writes and the widened slot cannot carry it. Node answers b,a.
interface Pair {
    a?: number;
    b?: number;
}
const filled: Pair = {};
filled.b = 1;
filled.a = 2;
const wide: unknown = filled;
console.log(Object.keys(wide as object).join(";"));
