// The three SILENT wrong key orders, made loud. Each one is the SAME defect
// the walk already refused one syntactic step away, and each one shipped a
// different object from Node's with no diagnostic of any kind until now.
// Measured on both backends against node v25.9.0 before the fix
// (tests/perf/keyorder/boundary/p/p06, p19, p20).

// ---- 1. A SPREAD CONTRIBUTES KEYS. The spelling test used to give up at
// the first property that was not a plain assignment, so a literal holding a
// spread escaped it entirely. JS fixes a key's position where it is FIRST
// defined, so this object is c,b,a; the shape enumerates b,a,c.
const base = { b: 1, a: 2 };
const head = { c: 3, ...base };
console.log(Object.keys(head).join(","));

// ---- 2. A FUNCTION RETURN carries its literal's risk. `exprKeyRisk` used to
// resolve a call only through the compiler's own generated helpers, so the
// very same literal was refused at the top level and silent one frame away.
interface Three {
    readonly a: number;
    readonly b: number;
    readonly c: number;
}
function mk(): Three {
    return { c: 3, a: 1, b: 2 };
}
console.log(JSON.stringify(mk()));

// ---- 3. A RECORD FILLED BY ASSIGNMENT. There is no literal to test: the
// order is made by the writes. Node answers b,a; the struct answers its
// shape's a,b.
interface Pair {
    a?: number;
    b?: number;
}
const filled: Pair = {};
filled.b = 1;
filled.a = 2;
console.log(Object.entries(filled).map((e) => e[0]).join(";"));
