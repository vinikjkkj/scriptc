// Distilled from tests/harness/stackless-values.test.ts when the fiber lane was removed: the program that file compared between the fiber lane and the
// stackless lane is now compared with Node on both backends (plain and sanitized) by the corpus.
// Producers. They exist only to settle a promise of each payload kind.
// EIGHT OF THE NINE HAVE NO AWAIT, and that used to mean none of them was a
// coroutine on either lane. It does not any more: a body with no suspension
// point at all converts now, so eight of these are zero-point coroutines and
// are named in FLOOR_NON_WRAPPERS. The ninth, pu, always suspended --
// returning a union makes its value a promise this function awaits.
async function pf(v: number): Promise<number> { return v + 1; }
async function pb(v: boolean): Promise<boolean> { return v; }
async function ps(v: string): Promise<string> { return v + "!"; }
async function pa(n: number): Promise<number[]> { return [n, n + 1]; }
async function pu(n: number): Promise<number | null> { return n > 0 ? n : null; }
async function pv(): Promise<void> { }
async function pd(n: number): Promise<any> { return n > 0 ? "d" + n : null; }
async function prej(): Promise<number> { throw new Error("boom"); }
// A promise-or-absent union. Awaiting one emits the microtask HOP on its
// non-promise arm -- scr_await_hop, a fiber-only primitive with no stackless
// counterpart -- which is the construct that was invisible to liveness and
// crashed fifteen admitted bodies. It must stay OFF the lane, and the
// cross-lane scan below is armed against exactly this shape.
function mix(flag: boolean): Promise<number> | number { return flag ? pf(1) : 5; }
async function pmaybe(bad: boolean): Promise<number> { if (bad) throw new Error("bad"); return 7; }

// The subjects. Each is a CONVERTED coroutine: one root-level await in a
// varDecl or an expression statement, nothing nested, no loop and no try.
async function wf(v: number): Promise<number> { const x = await pf(v); return x; }
async function wb(v: boolean): Promise<boolean> { const x = await pb(v); return x; }
async function ws(v: string): Promise<string> { const x = await ps(v); return x; }
async function wa(n: number): Promise<number[]> { const x = await pa(n); return x; }
async function wu(n: number): Promise<number | null> { const x = await pu(n); return x; }
async function wd(n: number): Promise<any> { const x = await pd(n); return x; }
async function wtv(): Promise<string> { await pv(); return "void-take"; }
async function wv(n: number): Promise<void> { const x = await pf(n); console.log("vfin  ", x); }
async function wr(): Promise<number> { const x = await prej(); return x; }

// The try half: converted coroutines whose suspension sits under a try.
// wtc resumes inside the try body and its rejection is caught by that same
// try; wcs sites the await in the CATCH body.
async function wtc(bad: boolean): Promise<string> {
  try {
    const x = await pmaybe(bad);
    return "ok:" + x;
  } catch (e) {
    return "caught:" + (e as Error).message;
  }
}
function wrap1(v: number): string { return "w" + v; }

/* THE NESTED SHAPES, and what makes them a different question from the
 * sole-operand ones above. A suspension nested in a larger expression leaves
 * the operands already evaluated sitting in C locals. The park RETURNS to the
 * scheduler, so those locals die and the resume goto jumps over their
 * declarations -- and emitCoroAwait only spilled what was in an RC frame,
 * which newTemp joined only for REFCOUNTED temps. A double sibling was
 * therefore lost and a ScrStr* sibling was not.
 *
 * Every helper below exists to force a REAL TEMP rather than a C constant:
 * n1(8) is a call, 8 folds to an immediate and would pass either way
 * (measured -- the literal twin answered 8004 while the computed one
 * answered NaN, from the same build).
 *
 * Magnitudes are distinguishable PER SHAPE on purpose. The failure mode here
 * is a plausible wrong number, not a crash: with the spill reverted these
 * answered NaN, 4, 4, 2, NaN and a hard abort respectively, so a single
 * shared magnitude would have let one shape's break hide inside another's. */
function n1(v: number): number { return v; }
function s1(v: string): string { return v; }
function j2n(a: number, b: number): number { return a * 1000 + b; }
function j2s(a: string, b: number): string { return a + ":" + b; }
class NPair {
  a: number;
  b: number;
  constructor(a: number, b: number) { this.a = a; this.b = b; }
}
const nbuf: number[] = [10, 20, 30, 40, 50];
async function wdr(n: number): Promise<any> { return await pf(n); }
async function wca(n: number): Promise<string> { return wrap1(await pf(n)); }

// THE BOXED-PARAM SHAPES, one per box-access flavour (f64 / bool / ref).
// A param captured by a closure lives in a ScrBox rather than a C local, and
// on the stackless lane that box is built by the SPAWN WRAPPER, not by the
// body prologue -- the body cannot build it, because the resume function
// declares every local at its top (so the prologue's declaration would be a
// redeclaration) and the frame slot is typed ScrBox * (so storing the raw
// value would put a double or a bool in a pointer slot).
//
// Each reads the captured value AFTER the park. That is the whole point: if
// the box were mis-built, or its frame slot clobbered across the suspension,
// these return a PLAUSIBLE WRONG VALUE rather than crashing -- the class that
// has cost this front the most. A structural scan cannot see it; only running
// both arms and comparing the answer can.
async function wbf(v: number): Promise<number> { const g = () => v; const x = await pf(v); return g() + x; }
async function wbb(v: boolean): Promise<boolean> { const g = () => v; const x = await pb(v); return g() === x; }
async function wbs(v: string): Promise<string> { const g = () => v; const x = await ps(v); return g() + ":" + x; }
async function wrl(n: number): Promise<{ v: number }> { return { v: await pf(n) }; }
async function wrm(n: number): Promise<{ a: string; b: number; c: boolean; d: string }> {
  return { a: "A", b: await pf(n), c: true, d: "D" };
}
async function wtt(pick: boolean): Promise<number> { return pick ? await pf(100) : 7; }
async function wte(pick: boolean): Promise<number> { return pick ? 7 : await pf(200); }
async function wtb(pick: boolean): Promise<number> { return pick ? await pf(300) : await pf(400); }
// One per EMITTER FAMILY, not one per spelling. call/callValue/new/
// strIntrinsic all batch their args into C locals and then consume them;
// bin holds its left operand across the right and has no args at all, so
// no argument-position rule would ever have covered it.
async function wna(n: number): Promise<number> { return j2n(n1(8), await pf(n)); }
async function wnv(n: number): Promise<number> {
  const g: (a: number, b: number) => number = j2n;
  return g(n1(8), await pf(n));
}
async function wnn(n: number): Promise<number> { const p = new NPair(n1(8), await pf(n)); return p.a * 1000 + p.b; }
async function wns(n: number): Promise<number> { return s1("ab").padStart(n1(8), await ps("-" + n)).length; }
async function wnb(n: number): Promise<number> { return n1(8) * 1000 + await pf(n); }
async function wnx(n: number): Promise<number> { return nbuf[n1(1) + await pf(n)]!; }
// The three that were ALWAYS right and must stay right -- they are what
// proves the rule is about the unspilled temp and not about the position.
// wnf is the same call.args position with the await FIRST; wnr the same
// position with a refcounted sibling; wnm a sibling evaluated AFTER.
async function wnf(n: number): Promise<number> { return j2n(await pf(n), n1(8)); }
async function wnr(n: number): Promise<string> { return j2s(s1("S"), await pf(n)); }
async function wnm(n: number): Promise<number> { return j2n(await pf(n), n1(8) * 2); }
// THE DYN KEYED CALL, and it is here to give the cross-lane scan below
// something to find. That scan has always had the right shape -- no
// scr_await_* inside a converted body -- and NO OCCUPANCY for this one,
// because no program in this file made a dynamic call. The gap shipped a
// crash: async.awaitDyn lowers to scr_await_dyn_value, a fiber-only await,
// was registered nowhere, so liveness admitted the function and the emitter
// wrote a fiber await into a body with no fiber. Not a diagnostic -- 0xC0000409
// STATUS_STACK_BUFFER_OVERRUN, after however much output had already flushed.
// It used to stay OFF the lane; it converts now (see the ledger entry), and this row still compares its value against the fiber lane.
async function wdk(n: number): Promise<string> {
  const src = { f: pf };
  const u: unknown = src;
  // @ts-ignore -- a keyed call straight off the dyn value is the point
  await u["f"](n);
  // The SECOND await is not decoration. A dyn await lowers to a libCall, not
  // an awaitExpr, so liveness sees NO suspension point in a function that
  // holds only one -- suspensionLiveness returns null and the function is
  // never admitted. The crash needs a body that IS admitted, which takes a
  // co-resident ordinary await. Drop this line and the row stops testing
  // anything, quietly.
  const x = await pf(n);
  return "dk" + x;
}
async function wcs(bad: boolean): Promise<string> {
  try {
    if (bad) throw new Error("sync");
    return "no-throw";
  } catch (e) {
    const y = await ps("recovered");
    return y;
  }
}

/* THE 'assign' ROUTES. Every magnitude below is distinguishable from every
 * other on its line, because the break these guard is a PLAUSIBLE value --
 * a stale reload answers the pre-park string, not garbage. */

// (A) module globals. gs is refcounted so the old-value release runs; gn is
// not, so the two arms are told apart by content and not only by name.
let gs = "g0";
let gn = 100;
async function wga(n: number): Promise<string> { gs = await ps("a" + n); return gs + "/" + gs.length; }
async function wgn(n: number): Promise<number> { gn = await pf(n); return gn * 2; }

// (B) emitStrAccum. The accumulator is read AFTER the park.
async function wgc(v: string): Promise<string> { let s = "A"; s += await ps(v); return s; }
// ...and here the RIGHT operand reads the accumulator too, so a stale reload
// shows up as the two halves of one string disagreeing with each other
// rather than as a missing line.
async function wgc2(v: string): Promise<string> { let s = "B"; s += (await ps(v)) + s; return s; }

// (C) the plain local store, one per payload kind, plus the boxed target.
async function wgf(n: number): Promise<number> { let x = 7; x = await pf(n); return x; }
async function wgb(v: boolean): Promise<boolean> { let x = false; x = await pb(v); return x; }
async function wgs(v: string): Promise<string> { let x = "z"; x = await ps(v); return x + "/" + x.length; }
async function wgr(n: number): Promise<number[]> { let x: number[] = [9]; x = await pa(n); return x; }
// A closure captures x, so x is BOXED and the store goes through the box --
// the 'boxedUse' arm of recordPoints. c() reads it after the resume, so a
// box that stopped being shared answers 1 where the store wrote n+1.
async function wgx(n: number): Promise<number> { let x = 1; const c = (): number => x; x = await pf(n); return x * 1000 + c(); }
// THE FOURTH LOCAL ROUTE IS A NAMED GAP, not an oversight. The store arm is
// three branches, not two: a FORWARD-captured scalar is boxed AND tdz, and
// its write MINTS the one-element cell (:526) instead of writing through an
// existing one (:535). NO GUARD EXISTS FOR IT and the reason is measured
// rather than assumed:
//   - it cannot be written. 'const c = () => t; let t: number; t = await f()'
//     is refused by the frontend outright -- SC1090, "a binding form with no
//     lowering". A forward-captured CONST reaches :526, but its write is a
//     varDecl, so it never enters this statement arm at all.
//   - it does not occur. Over zapo-rest/app182's IR, of 40 'assign'
//     statements whose value contains a suspension (34 functions), route C1
//     takes 0 -- against A 3, B 0, C2 1, C3 36.
// So the route is open in the emitter and closed to every input anyone can
// currently produce. Recorded here so it is a known hole rather than a
// silent one, and so the day a binding form reaches it the gap has a name.
// Compound assign on a NUMBER: the target is read into a temp BEFORE the park
// and the sum is formed after it, so this is the bin.right family arriving
// through the assign statement rather than through a varDecl.
async function wgp(n: number): Promise<number> { let x = 5; x += await pf(n); return x; }

/* THE HOP. 'await <non-promise>' takes exactly ONE microtask turn and yields
 * the operand itself (lower-exprs.ts:2120): a hidden local, an async.hop, and
 * a read of that local on the far side. Each row below carries a magnitude
 * that a lost reload cannot imitate. */
function vv(): void { }
async function whn(n: number): Promise<number> { const x = await (n * 100); return x + 7; }
async function whs(v: string): Promise<string> { const x = await ("h" + v); return x + "/" + x.length; }
async function wha(n: number): Promise<number[]> { const x = await [n, n + 1]; return x; }
async function whu(): Promise<boolean> { const x = await null; return x === null; }
async function whv(): Promise<string> { await vv(); return "void-hop"; }

/* THE TURN COUNT, which no value above can see. A hop that costs ZERO turns
 * answers every value correctly and still reorders the program; a hop that
 * costs TWO does the same the other way. Two coroutines stepping through
 * three hops each interleave 1:1 if and only if each hop is exactly one
 * turn, so the expected string is hand-computable and both wrong answers are
 * distinguishable from it AND from each other:
 *   one turn  -> a1 b1 a2 b2 a3 b3     (the answer)
 *   zero      -> a1 a2 a3 b1 b2 b3
 *   two       -> a1 b1 ... with a gap, which is neither of the above.
 * The two lanes compute this through genuinely different code -- the fiber
 * hop is scr_await_yield, the stackless one is scr_coro_hop -- so comparing
 * them IS a control here, and the absolute string is pinned besides. */
const horder: string[] = [];
async function hopsteps(tag: string): Promise<void> {
  horder.push(tag + "1"); await 0;
  horder.push(tag + "2"); await 0;
  horder.push(tag + "3");
}
async function who(): Promise<void> {
  const a = hopsteps("a"); const b = hopsteps("b");
  await a; await b;
}

/* THE awaitUnion SHAPES, both arms of each. The promise arm parks on the
 * operand and the unit arm hops, and which one runs is a runtime fact, so a
 * lowering that resumed into the wrong arm would answer the right TYPE with
 * the wrong value -- invisible to a turn count and to a structure check. */
function mixs(flag: boolean): Promise<string> | string { return flag ? ps("p") : "u"; }
function mixv(flag: boolean): Promise<void> | undefined { return flag ? pv() : undefined; }
async function wau(flag: boolean): Promise<number> { const x = await mix(flag); return x * 10; }
async function was(flag: boolean): Promise<string> { const x = await mixs(flag); return x + "/" + x.length; }
async function wav(flag: boolean): Promise<string> { await mixv(flag); return flag ? "pv" : "unit"; }
// Promise<T> | undefined with T non-void: the VALUE-result awaitUnion, which
// takes the scr_union_new_* path on the park arm and the unit-instance path on
// the hop arm. Neither arm exists in app182.
function mixn(flag: boolean): Promise<number> | undefined { return flag ? pf(1) : undefined; }
function mixsu(flag: boolean): Promise<string> | undefined { return flag ? ps("q") : undefined; }
async function waun(flag: boolean): Promise<string> { const x = await mixn(flag); return x === undefined ? "none" : "n" + x; }
async function waus(flag: boolean): Promise<string> { const x = await mixsu(flag); return x === undefined ? "none" : x + "/" + x.length; }

/* THE LOOP SHAPES. Magnitudes are chosen so the plausible failures are
 * distinguishable from the answer AND from each other: a body that runs once
 * answers the first term, an accumulator the frame drops answers the last,
 * and a counter that resets does not terminate. */
async function wln(): Promise<number> {
  let s = 0; let i = 0;
  while (i < 3) { s += await pf(i); i++; }
  return s;
}
async function wls(): Promise<string> {
  let s = ""; let i = 0;
  while (i < 3) { s = s + await ps(String(i)); i++; }
  return s + "/" + s.length;
}
async function wlf(): Promise<number> {
  let s = 0;
  for (let i = 0; i < 3; i++) { s += await pf(i * 10); }
  return s;
}
async function wld(): Promise<number> {
  let s = 0; let i = 0;
  do { s += await pf(i); i++; } while (i < 2);
  return s;
}
async function wlc(): Promise<number> {
  let s = 0; let i = 0;
  while (i < 4) { const v = await pf(i); i++; if (v % 2 === 0) { continue; } s += v; }
  return s;
}
async function wlb(): Promise<number> {
  let s = 0; let i = 0;
  while (i < 10) { const v = await pf(i); i++; if (v >= 3) { break; } s += v; }
  return s;
}
async function wlnest(): Promise<number> {
  let s = 0; let i = 0;
  while (i < 2) { let j = 0; while (j < 2) { s += await pf(i * 10 + j); j++; } i++; }
  return s;
}
async function wlfo(): Promise<number> {
  let s = 0;
  for (const x of [1, 2]) { s += await pf(x); }
  return s;
}

/* THE forOf SHAPES. Magnitudes separate the plausible failures: a cursor that
 * reloads as 0 never terminates, one that reloads past the end answers the
 * first term, and a shared inner/outer cursor answers a number neither loop
 * would produce alone. */
async function wfo1(): Promise<number> {
  let s = 0;
  for (const x of [1, 2, 3]) { s += await pf(x); }
  return s;
}
async function wfo2(): Promise<string> {
  let s = "";
  for (const x of ["a", "b"]) { s = s + await ps(x); }
  return s + "/" + s.length;
}
async function wfo3(): Promise<number> {
  let s = 0;
  for (const i of [1, 2]) { for (const j of [10, 20]) { s += await pf(i * j); } }
  return s;
}
async function wfo4(): Promise<number> {
  let s = 0;
  for (const x of [1, 2, 3, 4]) { const v = await pf(x); if (v % 2 === 0) { continue; } s += v; }
  return s;
}
async function wfo5(): Promise<number> {
  const fs: (() => number)[] = [];
  for (const x of [1, 2]) { const v = await pf(x); fs.push((): number => x + v); }
  return fs[0]() * 10 + fs[1]();
}

// The pending-return shape: the await is OUTSIDE the try, so this is D1 and
// has always been converted; the 'return' crosses a finally, which is what
// emitted a value-return into a void resume function.
async function wfy5(n: number): Promise<number> {
  let v = await pf(n);
  try { return v; } finally { v = 999; }
}

/* THE SHAPE-(2) SHAPES. fobs makes the finally side effect observable, so a
 * finally that is skipped or run twice shows as a number rather than as
 * nothing. */
let fobs = 0;
async function wfy1(n: number): Promise<string> {
  try { const x = await pf(n); return "t" + x; } finally { fobs = fobs + 1; }
}
async function wfy2(bad: boolean): Promise<string> {
  try { const x = await pmaybe(bad); return "ok" + x; }
  catch (e) { return "c:" + (e as Error).message; }
  finally { fobs = fobs + 10; }
}
async function wfy3(bad: boolean): Promise<string> {
  try { if (bad) { throw new Error("b"); } return "nothrow"; }
  catch (e) { const y = await ps("c"); return y + "!"; }
  finally { fobs = fobs + 100; }
}
// THE (b) ROW. The await is INSIDE the try, so the park sits between the
// sc_pret snapshot and the read of it -- the geometry wfy5 does not have.
async function wfy4(n: number): Promise<number> {
  try { return await pf(n); } finally { fobs = fobs + 1000; }
}
// SHAPE (1): the suspension is INSIDE the finally body. Must stay on fibers.
async function wfy6(n: number): Promise<number> {
  let s = 0;
  try { s = 1; } finally { s = s + await pf(n); }
  return s;
}
// THE OTHER HALF OF SHAPE (1), and it exists because the refusal wfy6 used
// to occupy had NO occupant once wfy6 stopped occupying it.
//
// NO BACKTICK IN HERE, and that is not style: this comment lives inside the
// SOURCE template literal, so one would close the string and the file would
// not parse. (It did not, once.)
// wfy6 has no "return" crossing its finally and a try body that cannot
// throw, so the emitter writes that finally body ONCE. This one returns
// THROUGH the finally, so the body is written again at the return site --
// and each copy draws its own state out of a plan that allotted the IR node
// one. That is what the LLVM lane refuses now, by COUNTING the copies at
// emission rather than by refusing every suspending finally up front.
//
// THE RETURNED VALUE IS REFCOUNTED ON PURPOSE: that is the geometry that
// mints the %pretSlot snapshot, so if the copy limit is ever lifted this row
// is already
// standing in the position where the slot must come from the frame. The C
// lane converts it today and answers "w3", which is what makes this a
// coverage row rather than a quarantine entry.
async function wfy7(n: number): Promise<string> {
  try { return "w" + n; } finally { fobs = fobs + await pf(n); }
}


/* THE FOUR STATEMENT POSITIONS. Each magnitude distinguishes the plausible
 * wrong answer: wif taking the other branch, wrs storing through a container
 * the park lost, wsw resuming with its case-scoped local reset to NULL. */
async function wif(n: number): Promise<string> {
  if (await pb(n > 0)) { return "yes"; }
  return "no";
}
async function wrs(n: number): Promise<number> {
  const r = { v: 0 };
  r.v = await pf(n);
  return r.v;
}
async function wby(n: number): Promise<number> {
  const a = new Uint8Array(2);
  a[0] = await pf(n);
  return a[0];
}
async function wsw(n: number): Promise<string> {
  switch (n) {
    case 1: { const s = await ps("a"); return s + "/1"; }
    case 2: { const s = await ps("b"); return s + "/2"; }
    default: return "d";
  }
}
async function wsd(n: number): Promise<string> {
  switch (await pf(n)) {
    case 1: return "one";
    case 2: return "two";
    default: return "other";
  }
}
async function wst(n: number): Promise<string> {
  switch (n) {
    case await pf(0): return "t1";
    default: return "td";
  }
}
// No braces: the local is declared at the TOP LEVEL of the case body, which
// is the only shape emitSwitch NULL-resets at the top of the statement.
async function wsu(n: number): Promise<string> {
  switch (n) {
    case 1:
      const s = await ps("u");
      return s + "/1";
    default:
      return "du";
  }
}

async function main(): Promise<void> {
  const f = await wf(41);
  console.log("f64   ", f);
  const b1 = await wb(true); const b2 = await wb(false);
  console.log("bool  ", b1, b2);
  const s = await ws("x");
  console.log("str   ", s, s.length);
  const a = await wa(5);
  console.log("ref   ", a.join(","), a.length);
  const u1 = await wu(2); const u2 = await wu(-1);
  console.log("union ", u1, u2);
  const d1 = await wd(3); const d2 = await wd(-3);
  console.log("dyn   ", d1, d2, typeof d1, typeof d2);
  const tv = await wtv();
  console.log("tvoid ", tv);
  await wv(7);
  // The rejection path. A try block is not in the slice, so the catch lives
  // HERE, in a function the lane never converts -- what is under test is that
  // the converted wrapper turns a rejected await into the SAME rejection.
  try {
    await wr();
    console.log("rej   ", "NO THROW -- the rejection was swallowed");
  } catch (e) {
    console.log("rej   ", (e as Error).message, e instanceof Error);
  }
  const tc1 = await wtc(false); const tc2 = await wtc(true);
  console.log("try   ", tc1, tc2);
  const cs1 = await wcs(false); const cs2 = await wcs(true);
  console.log("catch ", cs1, cs2);
  const dr = await wdr(10); const ca = await wca(20); const rl = await wrl(30);
  console.log("sole  ", dr, ca, rl.v, typeof dr);
  // Structured payloads are compared FIELD BY FIELD, not by "a record came
  // back". A record crossing a suspension can return with a field missing,
  // a field holding its neighbour's value, or the fields in the wrong order,
  // and every one of those survives a turn count and a structure check --
  // which is exactly how the bool that was always false got through.
  const m = await wrm(50);
  console.log("rec   ", m.a, "|", m.b, "|", m.c, "|", m.d, "|", typeof m.a, typeof m.b, typeof m.c);
  // Each arm is exercised and printed separately: a swap shows as 401/301
  // rather than as a missing line, and 7 pins the non-awaiting arm.
  console.log("tern  ", await wtt(true), await wtt(false), "|", await wte(true), await wte(false));
  console.log("tern2 ", await wtb(true), await wtb(false));
  const r1 = await wrl(60);
  console.log("rec1  ", r1.v, "|", typeof r1.v);
  console.log("dynkey", await wdk(5));
  // THE NESTED SHAPES. Printed one per line with distinguishable
  // magnitudes, because the break they guard is a plausible number.
  console.log("ncall ", await wna(3), "|", await wnv(3), "|", await wnn(3));
  console.log("nmisc ", await wns(3), "|", await wnb(3), "|", await wnx(0));
  console.log("nok   ", await wnf(3), "|", await wnr(3), "|", await wnm(3));
  const bf = await wbf(11); const bb = await wbb(true); const bs = await wbs("q");
  console.log("boxp  ", bf, bb, bs, bs.length);
  // THE 'assign' ROUTES, one line per emitter route.
  console.log("asg-g ", await wga(5), "|", await wgn(20), "|", gs, gn);
  console.log("asg-c ", await wgc("k"), "|", await wgc2("k"));
  console.log("asg-l ", await wgf(3), "|", await wgb(true), "|", await wgs("y"), "|", (await wgr(4)).join(","));
  console.log("asg-x ", await wgx(3), "|", await wgp(3));
  console.log("hop   ", await whn(3), "|", await whs("k"), "|", (await wha(4)).join(","));
  console.log("hop2  ", await whu(), "|", await whv());
  await who();
  console.log("hopord", horder.join(" "));
  console.log("aunion", await wau(true), await wau(false), "|", await was(true), await was(false), "|", await wav(true), await wav(false));
  console.log("aunion2", await waun(true), await waun(false), "|", await waus(true), await waus(false));
  console.log("loop  ", await wln(), "|", await wls(), "|", await wlf(), "|", await wld());
  console.log("loop2 ", await wlc(), "|", await wlb(), "|", await wlnest(), "|", await wlfo());
  console.log("forof ", await wfo1(), "|", await wfo2(), "|", await wfo3(), "|", await wfo4(), "|", await wfo5());
  console.log("pret  ", await wfy5(3));
  console.log("fin   ", await wfy1(3), "|", await wfy2(false), await wfy2(true), "|", await wfy3(true), "|", await wfy4(3), "|", await wfy6(3), "|", await wfy7(3), "|", fobs);
  console.log("four  ", await wif(1), await wif(-1), "|", await wrs(3), "|", await wby(4));
  console.log("four2 ", await wsw(1), await wsw(2), await wsw(3), "|", await wsd(0), await wsd(1), await wsd(5), "|", await wst(1), await wst(9), "|", await wsu(1), await wsu(9));
  console.log("done");
}
void main();
