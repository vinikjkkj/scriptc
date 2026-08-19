// A GUARD looks through the checker-driven ARM bridge, the way it has always
// looked through the dyn one.
//
// tsc's control-flow analysis narrows a `T | undefined` reference to `T` at
// its use sites, and the IR value is still the tagged union, so the read is
// bridged with a tag-checked extraction (`narrowedArmHelper`). That is right
// for a use that NEEDS the value. It is wrong for a use that only asks
// WHETHER there is one — and every such use was getting it:
//
//     const s: string | undefined = <something tsc types `string`>
//     s === undefined     ->  folded to a constant FALSE   (Node: true)
//     s == null           ->  folded to a constant FALSE   (Node: true)
//     typeof s            ->  folded to "string"           (Node: "undefined")
//     !s                  ->  uncaught TypeError           (Node: true)
//
// Four of those are SILENT WRONG ANSWERS at exit 0 — the worst outcome this
// project has, strictly worse than a trap. They are the other half of the
// "r03 SEGFAULT" note that kept the undefined-armed union out of a
// declaration: that note said "`s === undefined` folds to a constant false
// and the payload read is a bare union peek". The peek half was retired by
// `733f4db9` (every checker-driven narrowing goes through a CHECKED
// extraction now — corpus 5090 r08/r09 measures it). The FOLD half was true
// and had never been written down anywhere else.
//
// The fix is one sentence the codebase already contained, applied to the
// other representation. `narrowBridgeDyn` exists so that ToBoolean,
// `=== undefined` and `typeof` ask the DYN underneath a scalar bridge —
// "a bridge is exactly what a truthiness test must look through", because
// a test has an answer for the kinds the bridge's validation rejects.
// `narrowBridgeUnion` is that function one representation over, and the four
// guard destinations ask it: ensureBool, lowerUnitComparison,
// lowerLooseNullCompare, and the typeof operand unwrap.
//
// On an HONEST narrowing nothing changes but the shape of the code: the tag
// really is the arm, so the tag test answers exactly what the fold folded to
// (r01-r06 below are the honest side, and they must keep answering as they
// did). What changes is the DISHONEST case, which is the case Node answers.
//
// `SCRIPTC_ARMGUARD_OFF=1` ablates it; under it this file's r10-r21 diverge.

interface Backend { readonly tag: string }

// ------------------------------------------- 1. the HONEST narrowing side
// Nothing here may move: the value really is the arm tsc proved.
function honest(v: string | undefined): string {
  if (v === undefined) {
    return "absent";
  }
  return "present:" + v + ":" + String(v.length);
}
console.log("r01", honest("abc"));
console.log("r02", honest(undefined));

function honestLoose(v: string | undefined): string {
  return v == null ? "nullish" : "value:" + v;
}
console.log("r03", honestLoose("q"), honestLoose(undefined));

function honestTruthy(v: Backend | undefined): string {
  if (!v) {
    return "falsy";
  }
  return "truthy:" + v.tag;
}
console.log("r04", honestTruthy({ tag: "b" }), honestTruthy(undefined));

function honestTypeof(v: string | undefined): string {
  return typeof v;
}
console.log("r05", honestTypeof("s"), honestTypeof(undefined));

// A narrowing tsc proves with a real runtime test still costs one always-true
// tag compare and answers the same.
function honestChain(v: Backend | undefined): string {
  if (v !== undefined && v.tag.length > 0) {
    return "ok:" + v.tag;
  }
  return "no";
}
console.log("r06", honestChain({ tag: "z" }), honestChain(undefined));

// ---------------------------------------- 2. the DISHONEST narrowing side
// tsc types the initializer as the non-undefined arm; the value is the
// undefined arm. Every guard must answer what Node answers.
const s: string | undefined = undefined as unknown as string;
const b: Backend | undefined = undefined as unknown as Backend;

function row(tag: string, f: () => string): void {
  try {
    console.log(tag, f());
  } catch (e) {
    console.log(tag, "THREW " + (e as Error).name);
  }
}

row("r10 !s        ", () => String(!s));
row("r11 s===undef ", () => String(s === undefined));
row("r12 s!==undef ", () => String(s !== undefined));
row("r13 typeof s  ", () => typeof s);
row("r14 s==null   ", () => String(s == null));
row("r15 s!=null   ", () => String(s != null));
row("r16 Boolean(s)", () => String(Boolean(s)));
row("r17 !b        ", () => String(!b));
row("r18 b===undef ", () => String(b === undefined));
row("r19 typeof b  ", () => typeof b);
row("r20 b==null   ", () => String(b == null));
row("r21 if(!b)    ", () => (!b ? "guard fired" : "guard SKIPPED"));

// A use that NEEDS the value still gets the checked extraction's catchable
// TypeError — nothing became silent, which is the whole point.
row("r22 s.length  ", () => String(s.length));
row("r23 b.tag     ", () => b.tag);

// -------------------------------------- 3. what must NOT be looked through
// A WRITTEN `as` cast is the program's own request for a check, not a
// checker-driven bridge, so it keeps its own behaviour.
const w: string | undefined = "written";
row("r24 as-cast   ", () => String((w as string).length));

// A union with no unit arm has nothing for these tests to find: the fold is
// the honest answer and stays.
const two: string | number = 5 as string | number;
row("r25 two===und ", () => String((two as unknown) === undefined));

console.log("r99 still running");
