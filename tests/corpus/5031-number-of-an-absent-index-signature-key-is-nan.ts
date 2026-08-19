// `Number(bag[k])` on an absent key is NaN, exactly as Node says it is.
//
// The string conversion has had this rule for a long time -- `ensureString`
// re-reads an index-signature keyed read at the SLOT's dyn width
// (stringConvAtDynWidth), so `String(attrs.k)` and `` `${attrs.k}` `` print
// `undefined` where the key is missing. Its numeric twin did not exist, so
// the very same read one call away took the keyed-read helper's miss path:
// `scr_trap_fmt`, an uncatchable process ABORT with no [SCxxxx] tag, past
// every catch clause -- where Node's `Number(undefined)` is simply NaN.
//
// It is zapo's single largest closable abort group: eleven of its
// sixty-four abortable reads are `Number(node.attrs.<k>)`, all of them the
// `attrs.k ? Number(attrs.k) : undefined` shape in the group and receipt
// parsers (`WaGroupCoordinator.ts`, `SCRIPTC_KEYREAD_CENSUS`).
//
// WHY A CONVERSION IS A KEEP-CASE. ToNumber is TOTAL over the kinds the
// width can produce, so a conversion never has to refuse the way a typed
// slot does: the runtime's ToNumber answers NaN for undefined, 0 for null,
// the full string grammar for a string and 1/0 for a boolean -- Node's
// ToNumber exactly. The gate is `isDynSafeReadWidth`, the predicate the
// sibling binding rule already uses, so a REFERENCE-valued signature keeps
// the loud trap rather than trading it for a ToPrimitive dispatch.

const attrs: Readonly<Record<string, string>> = { size: "7", creation: "1700000000", t: "12", junk: "abc" };
const counts: Readonly<Record<string, number>> = { a: 1 } as unknown as Readonly<Record<string, number>>;
const flags: Readonly<Record<string, boolean>> = { on: true } as unknown as Readonly<Record<string, boolean>>;

// ------------------------------------------------------- 1. the zapo shape
console.log("r01", Number(attrs.size), Number(attrs.gone));
console.log("r02", Number(attrs.creation), Number(attrs.t));

// The guarded spelling zapo actually writes, both arms.
function sizeOf(a: Readonly<Record<string, string>>): number | undefined {
  return a.size ? Number(a.size) : undefined;
}
console.log("r03", sizeOf(attrs), sizeOf({}) === undefined);

// The UNGUARDED spelling, which is the one that aborted.
function rawSize(a: Readonly<Record<string, string>>): number {
  return Number(a.size);
}
console.log("r04", rawSize(attrs), Number.isNaN(rawSize({})));

// -------------------------------------------------- 2. the ToNumber grammar
// Every kind the width can produce, against Node's own answers.
console.log("r05", Number(attrs.junk), Number.isNaN(Number(attrs.junk)));
console.log("r06", Number(counts.a), Number(counts.nope), Number.isNaN(Number(counts.nope)));
console.log("r07", Number(flags.on), Number(flags.off), Number.isNaN(Number(flags.off)));

// A hit is the value it always was.
console.log("r08", Number(attrs.size) + 1, Number(attrs.t) * 2);

// NaN propagates the way Node's does.
const miss = Number(attrs.absent);
console.log("r09", miss !== miss, miss + 1 !== miss + 1, String(miss));

// -------------------------------------------- 3. the string conversion twin
// The rule this one is the twin of, on the same reads, so the two
// conversions can be read side by side.
console.log("r10", String(attrs.gone), `${attrs.gone}`, String(attrs.size));

// ------------------------------------------------------- 4. what does NOT move
// A DECLARED field always answers, so nothing widens.
const declared: { readonly n: string; readonly [k: string]: string } = { n: "5", extra: "6" };
console.log("r11", Number(declared.n), Number(declared["extra"]));

// A numeric LITERAL, a number-typed local and a boolean keep their own arms.
const lit = 3;
const b = true;
console.log("r12", Number(lit), Number(b), Number("9"), Number(""));

// Number with no argument is 0 (the arm above the rung).  `Number(undefined)`
// written out loud is not here: it is a pre-existing SC2020 refusal
// ('Number of undefined values', and the same for null), unrelated to this
// rung and untouched by it.
console.log("r13", Number());

// A shape with NO index signature has no keyed read at all.
interface Fixed { readonly a: string }
const fixed: Fixed = { a: "4" };
console.log("r14", Number(fixed.a));

// ------------------------------------------------- 5. the loop zapo runs it in
const stanzas: Readonly<Record<string, string>>[] = [
  { size: "2", t: "1" },
  { t: "2" },
  { size: "4" },
];
for (let i = 0; i < stanzas.length; i += 1) {
  const s = stanzas[i]!;
  const n = Number(s.size);
  console.log("r15." + String(i), Number.isNaN(n) ? "NaN" : n, sizeOf(s) === undefined ? "undefined" : sizeOf(s));
}
console.log("r16", stanzas.filter((s) => !Number.isNaN(Number(s.size))).length);
