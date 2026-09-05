// Set support boundaries: what stays rejected at LOWERING, with specific
// messages. Elements are Map's KEY types (string or number — SameValueZero
// hashing is honest for exactly those); everything else is fenced.

// Array seeds lower (`new Set(["a", "b"])` is a corpus program now); a
// non-array seed — another Set, any iterable — typechecks against the lib
// but keeps the fence: never silently an empty set.
const seeded = new Set(new Set(["a", "b"]));

// Elements must be string or number — the new-site diagnostic names the
// element type.
const byFlag = new Set<boolean>();

// Record elements would need pointer-identity hashing and cycle tracing —
// fenced for now.
const recs = new Set<{ id: number }>();

// Set-typed slots elsewhere report the ordinary unsupported-type diagnostic.
function useBad(s: Set<boolean>): number {
  return s.size;
}

// Sets as union arms DO have a narrowing test now — `x instanceof Set` is
// the union's tag compare — so a set arm sits beside units and beside data
// siblings alike. Map arms keep the unit-only rule.
function maybeSet(cond: boolean): Set<string> | undefined {
  return undefined;
}

// The one set-arm shape with no test: TWO of them. `instanceof Set` answers
// true for both, `typeof` answers "object" for both, and nothing else
// separates a `Set<string>` from a `Set<number>` at run time.
function twoSets(cond: boolean): Set<string> | Set<number> {
  return cond ? new Set<string>() : new Set<number>();
}

// A MAP arm beside a data sibling keeps its own fence — no lowering emits
// `instanceof Map`, so the rule would be ahead of the test.
function mapArm(cond: boolean): string | Map<string, number> {
  return cond ? "s" : new Map<string, number>();
}

// Sets as array elements: ScrArr has no set element kind.
const rows: Set<string>[] = [];

// Sets are not JSON (Node stringifies them as the useless "{}" husk;
// scriptc rejects instead of shipping that).
const s = new Set<string>();
console.log(JSON.stringify(s));

// Set methods have no bound-value form — call them directly.
const adder = s.add;

// Reached: collection defers its diagnostics until a reference makes
// them relevant; these references are what makes them count.
useBad(new Set<boolean>());
maybeSet(true);
twoSets(true);
mapArm(true);
