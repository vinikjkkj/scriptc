// `?.` over an index-signature keyed read, and the FILE-SCOPE composite.
//
// Three guards that estado-resolvestore measured as WRONG and left open.
// All three come from the same lie: tsc types an index-signature read by
// the signature's VALUE type, so `attrs["nope"]` is spelled `string` and
// `bs["nope"]` is spelled `B`, while the key may be absent. The binding
// rules already widen that read - to `dyn` (keyedReadLocalAtDynWidth,
// shipped) or to `T | undefined` (keyedReadLocalAtUndefinedArm) - so the
// VALUE at run time is undefined. Three places still read the checker's
// spelling instead of the slot.
//
// (1) `?.` OVER A WIDENED BINDING, on both widths. recvNeverNullish asks
//     the CHECKER type, sees `string`, concludes `?.` cannot
//     short-circuit and folds it to `.`. The read then takes the narrow
//     bridge (dynCheck into `string`, or the checked arm extraction) and
//     throws on exactly the value `?.` was written to skip. Measured on
//     the SHIPPED dyn rule as much as on the union one, so it was never
//     the union rung's defect. The fix asks the SLOT - peekLocal /
//     globalOf, no lowering - and then looks THROUGH the bridge, which is
//     what `!v`, `v === undefined` and `typeof v` already do
//     (narrowBridgeDyn / narrowBridgeUnion).
//
// (1b) The same lie when the receiver IS the read (`bs["nope"]?.tag`).
//     There is no binding to ask, so the gate is syntactic and the read
//     itself is held at `T | undefined` - the binding rung's own
//     destination, one construct over. This one ABORTED the process.
//
// (3) THE FILE-SCOPE COMPOSITE. A module global never reaches
//     lowerVarDecl's rung ladder: its slot is fixed by collectGlobals and
//     the statement is `assign` of lowerExprExpecting, where
//     coerceToExpected does not offer recordKeyReadAtUndefinedArm. So
//
//         function f() { const a: B | undefined = bs["nope"] }  // undefined
//         const g: B | undefined = bs["nope"]                   // ABORTED
//
//     diverged on nothing but the scope. The SCALAR case had no hole only
//     because keyedReadGlobalIsDyn exists as its own syntactic twin;
//     keyedReadGlobalArmedType is the composite's.
//
// Dials: `SCRIPTC_OPTCHAIN_SLOT_OFF=1` ablates (1) and (1b),
// `SCRIPTC_GLOBALARM_OFF=1` ablates (3). With both off every row below
// reproduces the defect it was written for, and the two are independent.

interface B { readonly tag: string }
const bs: Record<string, B> = { real: { tag: "R" } }
const attrs: Record<string, string> = { id: "yes" }

// ---------------------------- (1) `?.` over a widened binding, both widths
const s = attrs["nope"]
console.log("r01", s?.length)
const b = bs["nope"]
console.log("r02", b?.tag)

// the same two with the key PRESENT - the control that must not move
const s2 = attrs["id"]
console.log("r03", s2?.length)
const b2 = bs["real"]
console.log("r04", b2?.tag)

// ------------------------- (1b) the receiver IS the read (this ABORTED)
console.log("r05", bs["nope"]?.tag)
console.log("r06", bs["nope"]?.["tag"])
console.log("r07", bs["real"]?.tag)
const fns: Record<string, () => string> = { yes: () => "Y" }
const f = fns["nope"]
console.log("r08", f?.())
console.log("r09", fns["yes"]?.())

// a `?.` chain whose result is BOUND, not just printed. Only the guard
// forms are asked of it: a value-CONSUMING coercion (String(t), `${t}`)
// over this binding still throws the arm bridge's catchable TypeError
// where Node coerces to "undefined", because tsc assignment-narrows `t`
// to `string` (the initializer's type) and narrowBridgeUnion covers the
// tests, not the consumers. Named in estado-walkers, not closed here.
const t: string | undefined = bs["nope"]?.tag
console.log("r10", t === undefined, t == null, typeof t)

// ------------------------------- (3) FILE SCOPE, inferred and annotated
const gInf = bs["nope"]
const gAnn: B | undefined = bs["nope"]
const gStr = attrs["nope"]
const gNum: Record<string, number> = { one: 1 }
const gN = gNum["nope"]
console.log("r11", gInf === undefined, gAnn === undefined, gStr === undefined, gN === undefined)
console.log("r12", typeof gInf, typeof gAnn, typeof gStr, typeof gN)
console.log("r13", !gInf, gInf == null, gAnn == null)

// the author's own guard, at file scope, over a composite
function useGlobal(): string {
  if (!gInf) { return "absent" }
  return gInf.tag
}
console.log("r14", useGlobal())

// the SAME four inside a function - the control that already worked
function locals(): void {
  const lInf = bs["nope"]
  const lAnn: B | undefined = bs["nope"]
  const lStr = attrs["nope"]
  console.log("r15", lInf === undefined, lAnn === undefined, lStr === undefined)
}
locals()

// file-scope PRESENT keys - the other control
const pInf = bs["real"]
const pStr = attrs["id"]
console.log("r16", pInf === undefined, pInf.tag, pStr === undefined, pStr.length)

console.log("r99 still running")
