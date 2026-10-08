/* THE STACKLESS LANE MUST GIVE THE SAME ANSWERS, not just the same turn count.
 *
 * WHY THIS EXISTS. The lane shipped with a wrong-ANSWER bug and every gate was
 * green: an `async` function returning a boolean fulfilled its promise through
 * the f64 field, while every awaiter -- stackless and fiber alike -- reads the
 * separate `b` field. So `await f()` answered false whatever f returned, 62
 * times over in the shipped zapo-rest build, and the Noise handshake rejected
 * every certificate because its verifier is one of them.
 *
 * Nothing caught it, and the reason is worth stating: the turns ruler counts
 * MICROTASK TURNS, run-poison.sh counts turns, the TU-split guard checks
 * STRUCTURE. The corpus runs with the knob absent. Not one check compared a
 * VALUE the lane produced -- a lane with no value coverage can be green and
 * wrong at the same time, which is exactly what happened.
 *
 * WHY THE FIRST VERSION OF THIS FILE WAS ALSO BLIND, which is the same lesson
 * one level up. It listed one async function per result kind and compared the
 * program's output -- but a function with NO await is not a suspension point,
 * and `stacklessPlan` returns null for it; an await NESTED in a call argument
 * (`console.log("x", await f())`) is not straight-line, and one non-D1 point
 * disqualifies the WHOLE function. So of the nine lines it printed, exactly
 * ONE came from a converted coroutine. Measured in its own emitted C: the
 * stackless arm contained one `scr_coro_take_bool` and one
 * `scr_coro_finish_bool` and nothing else. Every other "kind" it claimed to
 * cover was the same fiber code compiled twice, identical by construction.
 *
 * Two rules fall out, and this file obeys both.
 *
 *   1. A payload kind is only covered by a WRAPPER that is actually converted:
 *      one root-level `const x = await p...;` and a plain `return x;`. The
 *      wrapper's RETURN type drives coroFinish and the await's RESULT type
 *      drives coroTake, so one wrapper per kind guards both halves. None of
 *      them needs `return await`, a loop or a try, so this file guards the
 *      same kinds on every slice and does not have to be rewritten per slice.
 *
 *   2. The coverage itself needs a control that can go red. Comparing output
 *      cannot report "this kind stopped being converted" -- that failure makes
 *      the two arms MORE equal, not less. So the stackless arm's emitted C is
 *      read back and every wrapper's resume function must be in it, by name.
 *      If a future liveness change drops one, that assertion fails while the
 *      output comparison stays green.
 *
 * THE THIRD FIELD IS payload_kind, and the two lanes already disagree on it.
 * ScrPromise stores a fulfillment in three places -- f64, b and payload --
 * discriminated by a fourth member, payload_kind. The shipped bug was a value
 * written into the wrong one of the first three; the asymmetry below is in the
 * fourth. The fiber lane's completion dispatch has FIVE arms
 * (void/f64/bool/string/ref) and coroFinish has FOUR, so a string-returning
 * coroutine settles through scr_promise_fulfill_ref on the stackless lane and
 * scr_promise_fulfill_str on the fiber one: the same program leaves the same
 * promise SCR_EXC_REF on one lane and SCR_EXC_STR on the other. The take
 * dispatch has the same shape of gap -- the fiber lane routes a dyn-typed
 * await through scr_await_dyn, which boxes BY payload_kind (a void
 * fulfillment answers the undefined VALUE, never NULL), while coroTake routes
 * it through scr_coro_take_ref, which answers p->payload and therefore NULL.
 *
 * MEASURED, both arms still print the same thing, and the reason is worth
 * writing down rather than rediscovering: every reader that distinguishes STR
 * from REF for a FULFILLMENT either reads the payload pointer directly
 * (scr_await_str, scr_promise_payload_str) or dispatches on the STATIC inner
 * type (the dyn-box settle adapters), and the retain/release pair handed to
 * fulfill_ref for a string is scr_str_retain/scr_str_release either way, so
 * the trace, the gcfree and the combinator copy all behave identically. It is
 * a latent divergence, not a live one. It is recorded here because the next
 * reader that switches on payload_kind turns it back into the bool bug, and
 * because `ws` and `wd` below are the two wrappers that would make that
 * moment loud instead of silent.
 *
 * This compares the two lanes' OUTPUT on one program built both ways, with the
 * knob as the only difference. It sets the knob itself rather than reading it,
 * so it guards the lane on the ordinary knob-absent gate. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const repoRoot = join(import.meta.dirname, "../..");
const cacheDir = join(repoRoot, "node_modules/.cache/scriptc-tests");
const sanitize = process.env["SCRIPTC_SAN"] === "1";

/* The wrappers, and what each one is here to prove. The name is the IR
 * function name, which is also the emitted resume function's suffix -- that is
 * what makes the arming check below able to name the kind that went missing.
 *
 * `take` is the arm coroTake picks for the await's result type; `finish` is the
 * arm coroFinish picks for the wrapper's return type. The fiber lane's two
 * dispatches have SIX arms each (void/f64/bool/string/dyn/ref) and the
 * stackless ones have FOUR (void/f64/bool/ref), so string and dyn are the two
 * places where the lanes can only be shown equal by running them. */
const WRAPPERS: ReadonlyArray<{ name: string; take: string; finish: string; converted: boolean }> = [
  { name: "wf", take: "f64", finish: "f64", converted: true },
  { name: "wb", take: "bool", finish: "bool", converted: true },
  { name: "ws", take: "ref", finish: "ref", converted: true }, // string: fiber uses await_str/fulfill_str
  { name: "wa", take: "ref", finish: "ref", converted: true },
  { name: "wu", take: "ref", finish: "ref", converted: true },
  { name: "wd", take: "ref", finish: "ref", converted: true }, // dyn: fiber uses scr_await_dyn
  { name: "wtv", take: "void", finish: "ref", converted: true },
  { name: "wv", take: "f64", finish: "void", converted: true },
  { name: "wr", take: "f64", finish: "f64", converted: true }, // rejects: finishes through _throw
  // THE TRY HALF, now lowered. These two were written before the slice with
  // `converted: false`, and the ledger went red naming both the moment the
  // liveness change landed -- which is the handover this file was built for.
  // Censused over the user's own program (zapo-rest app182, the IR the shipped
  // binary was built from): of the 211 functions a finally-free `try` slice
  // buys, 211 catch the rejection in the same try and 9 site the suspension in
  // the CATCH body. Two shapes, and these are them.
  //
  // The third shape -- a rejection CROSSING the try uncaught -- is absent on
  // purpose. All 46 of its instances in that program are try/finally with no
  // catch, so it cannot arrive before `finally` does, and `finally` needs the
  // frame's own exception cell. A wrapper for a shape the slice does not
  // convert would fail the arming check below, which is the control doing its
  // job: it refuses coverage the lane does not have.
  { name: "wtc", take: "f64", finish: "ref", converted: true },
  { name: "wcs", take: "ref", finish: "ref", converted: true },
  // THE SOLE-OPERAND SHAPES. The await is the ONLY operand of the expression
  // wrapping it, so nesting is positional and the frame carries nothing extra.
  // These three are the measured dominant idioms over zapo-rest, not invented
  // ones: wdr is `return await f()` in a handler declared `any` (a dyn
  // conversion on the result -- 131 points, 117 of them in one file), wca is a
  // one-argument call (33 points), wrl a one-field record literal (14).
  { name: "wdr", take: "f64", finish: "ref", converted: true },
  { name: "wca", take: "f64", finish: "ref", converted: true },
  // The boxed-param shapes. Before the spawn-wrapper boxing landed these were
  // refused outright (fn:boxedParam was the largest blocker on the ladder:
  // 133 carriers, 109 of them blocked by nothing else), so marking them
  // converted here is what makes the arming check below fail loudly if that
  // lowering ever regresses.
  { name: "wbf", take: "f64", finish: "f64", converted: true },
  { name: "wbb", take: "bool", finish: "bool", converted: true },
  { name: "wbs", take: "ref", finish: "ref", converted: true },
  // wrl is here as a NEGATIVE entry, and it corrected a mistake in my own
  // measurement. A one-field record literal looks sole-operand to the eye and
  // my arity scan credited 14 points to it, but the scan read the wrong node:
  // a recordLit holds `fields` as entries that carry no `kind`, so the
  // literal itself counts ZERO operands, never becomes transparent, and the
  // await stays nested. The scan had measured the ENTRY, which does have one.
  // The ledger caught it on the first run. It stays as a ledger entry so the
  // shape is named rather than silently absent, and it goes red the day a
  // record literal does start converting.
  { name: "wrl", take: "f64", finish: "ref", converted: true },
  // The multi-field twin. It was a NEGATIVE entry while nesting blocked --
  // "two fields are two operands, so the before/after hazard is real" -- and
  // the hazard turned out not to be the operand count at all: a record
  // literal consumes each field into the record before emitting the next, so
  // nothing of it is ever in flight. It converts now, and the ledger named it
  // the moment it did, which is the handover this file was built for.
  { name: "wrm", take: "f64", finish: "ref", converted: true },
  // THE NESTED SHAPES, one per emitter family. Each was measurably WRONG
  // before temps were spilled -- NaN, 4, 4, 2, NaN and a hard abort -- and
  // each carries its own magnitude so one shape's break cannot hide in
  // another's line.
  { name: "wna", take: "f64", finish: "f64", converted: true }, // call.args
  { name: "wnv", take: "f64", finish: "f64", converted: true }, // callValue.args
  { name: "wnn", take: "f64", finish: "f64", converted: true }, // new.args
  { name: "wns", take: "ref", finish: "f64", converted: true }, // strIntrinsic.args
  { name: "wnb", take: "f64", finish: "f64", converted: true }, // bin.right
  { name: "wnx", take: "f64", finish: "f64", converted: true }, // bin inside an index
  // The controls: same positions, no unspilled sibling. These were right
  // before the fix and must stay right, because they are what shows the rule
  // is the temp and not the position.
  { name: "wnf", take: "f64", finish: "f64", converted: true }, // await FIRST
  { name: "wnr", take: "f64", finish: "ref", converted: true }, // refcounted sibling
  { name: "wnm", take: "f64", finish: "f64", converted: true }, // sibling AFTER
  // A NEGATIVE entry, and the one that arms the cross-lane scan. An awaited
  // DYNAMIC keyed call is a fiber-only await with no stackless counterpart,
  // so the function stays on the fiber lane. Un-register "async.awaitDyn"
  // from suspends.ts and this flips: the ledger names wdk, and the
  // fiber-only scan names `sc_cr_wdk: scr_await_dyn_value`.
  { name: "wdk", take: "ref", finish: "f64", converted: false },
  // TERNARY ARMS. The specific defect here is not "no value came back" but
  // THE WRONG ARM with a plausible value: a ternary that resumes into the
  // opposite branch returns the right type, the right width, and the wrong
  // answer -- invisible to a turn count, a structure check, and to any guard
  // that only proves a number arrived. So the two arms carry values that are
  // distinguishable FROM EACH OTHER, not merely from garbage.
  { name: "wtt", take: "f64", finish: "f64", converted: true },
  { name: "wte", take: "f64", finish: "f64", converted: true },
  { name: "wtb", take: "f64", finish: "f64", converted: true },
  // THE `assign` SHAPES -- `x = await ...` as a STATEMENT ROOT. They went in
  // as NEGATIVE entries while the rootOk carve-out stood, and the ledger named
  // all ten the moment it was lifted, which is the handover this file exists
  // for. They are grouped BY EMITTER ROUTE, because
  // emit-stmts.ts:505 has three and only one of them is the plain store:
  //   (A) the module-global arm (:510-517) -- target is a C static, and the
  //       OLD value is released AFTER the await returns.
  //   (B) emitStrAccum (:520 -> :1364) -- the ONLY assign shape that READS
  //       the target after the park: it emits the right operand first and
  //       then reads the accumulator. Liveness KILLS the target as a def
  //       (recordPoints deletes every `defs` entry that is not boxed), so
  //       what keeps it correct is coroFrameLocals adding every REFCOUNTED
  //       local independently of liveness. That is a load-bearing coupling
  //       between two rules written for different reasons, and it is why
  //       this route gets its own guards instead of riding on the plain one.
  //   (C) the plain local store (:519-), boxed and not.
  { name: "wga", take: "ref", finish: "ref", converted: true }, // A: global, refcounted
  { name: "wgn", take: "f64", finish: "f64", converted: true }, // A: global, scalar
  { name: "wgc", take: "ref", finish: "ref", converted: true }, // B: s += await
  { name: "wgc2", take: "ref", finish: "ref", converted: true }, // B: right ALSO reads s
  { name: "wgf", take: "f64", finish: "f64", converted: true }, // C: f64
  { name: "wgb", take: "bool", finish: "bool", converted: true }, // C: bool
  { name: "wgs", take: "ref", finish: "ref", converted: true }, // C: string
  { name: "wgr", take: "ref", finish: "ref", converted: true }, // C: ref
  { name: "wgx", take: "f64", finish: "f64", converted: true }, // C: BOXED target
  { name: "wgp", take: "f64", finish: "f64", converted: true }, // C: compound assign, await in bin.right
  // THE HOP SHAPES -- `await <non-promise>`, which lowers to a hidden local,
  // an `async.hop` libCall and a read of that local. They went in as NEGATIVE
  // entries and the ledger named all six the moment the hop became a
  // lowerable suspension point.
  //
  // The hop is the first POINT that is not an IR node kind: its node kind is
  // "libCall", so for as long as liveness keyed on SUSPENDING_NODE_KINDS it
  // could not be seen, could not draw a state index, and kept its whole
  // function on the fiber lane via hasFiberOnlySuspender.
  //
  // What each one is here to prove: the hidden `%awaited` local is written
  // BEFORE the hop and read AFTER it, so every row fails loudly if the frame
  // does not carry it across the park. The refcounted rows additionally put
  // that local on the release path.
  { name: "whn", take: "f64", finish: "f64", converted: true }, // f64 operand
  { name: "whs", take: "ref", finish: "ref", converted: true }, // string: refcounted across the hop
  { name: "wha", take: "ref", finish: "ref", converted: true }, // array: refcounted across the hop
  { name: "whu", take: "ref", finish: "bool", converted: true }, // bare unit (await null)
  { name: "whv", take: "void", finish: "ref", converted: true }, // void operand
  { name: "who", take: "ref", finish: "void", converted: true }, // the ordering DRIVER -- ordinary awaits, no hop
  // THE ROW THAT ARMS THE TURN GUARD. `who` drives the interleaving but
  // holds no hop at all, so it converts with or without this slice and
  // would have stayed green if hops stopped converting -- caught by the
  // revert control, which named five of six. `hopsteps` is the function
  // whose three hops the 1:1 interleaving actually measures.
  { name: "hopsteps", take: "void", finish: "void", converted: true },
];

const SOURCE = `
// Producers. None of these has an await, so none is a coroutine on either
// lane -- they exist only to settle a promise of each payload kind.
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
// It must stay OFF the lane, and the ledger entry below says so.
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
  console.log("done");
}
void main();
`;

interface Arm {
  exe: string;
  cSource: string;
}

async function buildArm(knob: boolean): Promise<Arm> {
  const previous = process.env["SCRIPTC_STACKLESS"];
  if (knob) process.env["SCRIPTC_STACKLESS"] = "1";
  else delete process.env["SCRIPTC_STACKLESS"];
  try {
    // The knob is part of the KEY. It is not part of the compiler's own cache
    // key, so two arms sharing an output directory would share one binary and
    // the comparison would pass by being the same program twice.
    const key = createHash("sha256").update(SOURCE).update(knob ? "on" : "off")
      .update(sanitize ? "san" : "plain").digest("hex").slice(0, 16);
    const outDir = join(cacheDir, `stackless-values-${key}`);
    const file = join(outDir, "prog.ts");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(file, SOURCE);
    const r = await compile(file, { outPath: join(outDir, exeName("prog")), outDir, sanitize, backend: "c", keepC: true });
    if (!r.ok) throw new Error(r.diagnostics.map((d: any) => `${d.code}: ${d.message}`).join("\n"));
    return { exe: r.binaryPath, cSource: readFileSync(join(outDir, "prog.c"), "utf8") };
  } finally {
    if (previous === undefined) delete process.env["SCRIPTC_STACKLESS"];
    else process.env["SCRIPTC_STACKLESS"] = previous;
  }
}

describe("the stackless lane answers what the fiber lane answers", () => {

  test("every await result kind survives the state machine", async () => {
    const [on, off] = [await buildArm(true), await buildArm(false)];

    // THE ARMING CHECK, and it is about the C rather than the path: the two
    // arms get different output directories by construction (the knob is in
    // the cache key), so comparing binary PATHS proves nothing and cannot
    // fail. What has to be true is that the knob reached the emitter.
    expect(off.cSource, "the fiber arm must contain no coroutine lowering")
      .not.toMatch(/scr_coro_(take|finish)_/);
    expect(on.cSource, "the knob did not reach the emitter")
      .toMatch(/scr_coro_finish_/);

    // THE PER-KIND CONTROL. A kind silently dropping off the lane makes the
    // two arms MORE equal, so the output comparison below cannot report it.
    // Each wrapper must be a converted coroutine in the stackless arm, and the
    // take/finish arm it exercises must be present in the emitted C.
    const converted = WRAPPERS.filter((w) => w.converted);
    // No regex, and that is deliberate: the word-boundary escape this used to
    // carry lost a backslash on its way through a heredoc and became the
    // BACKSPACE character, so the control matched nothing and reported all nine
    // wrappers missing. The emitted spelling needs no escape at all.
    const onLane = (w: { name: string }): boolean => on.cSource.includes(`sc_cr_${w.name}(`);
    expect(converted.filter((w) => !onLane(w)).map((w) => w.name),
      "wrappers that are NOT converted -- these kinds are unguarded").toEqual([]);
    for (const arm of new Set(converted.map((w) => `scr_coro_take_${w.take}`))) {
      expect(on.cSource, `${arm} is never emitted -- the kind it carries is unguarded`).toContain(arm);
    }
    for (const arm of new Set(converted.map((w) => `scr_coro_finish_${w.finish}`))) {
      expect(on.cSource, `${arm} is never emitted -- the kind it carries is unguarded`).toContain(arm);
    }

    // THE SCOPE LEDGER, and it is the same control pointed the other way. A
    // shape joining the lane with no value coverage is how D1 shipped a wrong
    // answer; these wrappers are written and RUNNING but not yet convertible,
    // so the file records which shapes are deliberately off-lane instead of
    // leaving the gap unnamed. When the try lowering lands this fails BY NAME
    // and the fix is to flip that wrapper's `converted` to true -- which is
    // the same edit that switches its real value coverage on.
    expect(WRAPPERS.filter((w) => !w.converted && onLane(w)).map((w) => w.name),
      "these shapes now CONVERT -- flip `converted: true` so their coverage counts")
      .toEqual([]);
    expect(on.cSource, "the rejection completion is never emitted").toContain("scr_coro_finish_throw");

    // NO FIBER CALL MAY APPEAR IN AN ADMITTED BODY, checked in the artifact.
    //
    // This was a diagnostic on 2026-10-06 and is a permanent criterion now.
    // A function admitted to the stackless lane has NO FIBER; a fiber-only
    // primitive reaching its body aborts at runtime with "await outside an
    // async function". It happened: `async.hop` suspends but was absent from
    // liveness's list, so fifteen bodies were admitted while still emitting
    // scr_await_hop. One occurrence invalidates the whole coverage number,
    // because the lane is then lowering something it cannot lower.
    //
    // Reading the emitted C is the only check that catches this WITHOUT
    // running the binary and without the specific function being exercised.
    //
    // ARMED, and here is how to reproduce it: open nesting (make blockDepth
    // never increment in liveness) and disable the fiber-only fence
    // (hasFiberOnlySuspender). `pu` is then admitted while still emitting the
    // microtask hop, and this assertion fails naming
    // "sc_cr_pu: scr_await_hop" -- the exact defect that produced exit=127.
    // With the fence restored it is clean again. Two earlier attempts to arm
    // it failed because no hop-bearing body was admissible at all; it took
    // the derived admission existing before the broken state could be built
    // deliberately.
    {
      const bodies = on.cSource.split(/^(?=[A-Za-z ]*void sc_cr_)/m);
      const offenders: string[] = [];
      for (const b of bodies) {
        const m = /^[A-Za-z ]*void (sc_cr_[A-Za-z0-9_]+)\(ScrCoroBase/.exec(b);
        if (!m) continue;
        // No escape sequences here on purpose: this file has had a
        // backslash eaten by a heredoc five times today, and an escape
        // that degrades silently inside a regex or a string is the exact
        // failure this test exists to prevent elsewhere.
        const nl = String.fromCharCode(10);
        const end = b.indexOf(nl + "}" + nl);
        const body = end > 0 ? b.slice(0, end) : b;
        const fiber = [...new Set(body.match(/scr_await_[a-z0-9_]+/g) ?? [])];
        if (fiber.length > 0) offenders.push(`${m[1]}: ${fiber.join(", ")}`);
      }
      expect(offenders, "fiber-only calls inside a stackless body -- these abort at runtime, and the coverage number is void")
        .toEqual([]);
    }

    /* NO TEMP MAY BE LOST ACROSS A PARK, read out of the artifact.
     *
     * A resume function RETURNS to the scheduler, so every C local in it
     * dies and the resume goto jumps over the declarations. A temp
     * established before a label and read after it without a reload is
     * therefore indeterminate -- and the failure is a plausible number, not
     * a crash: this lane answered NaN for 8004, 4 for 8004 and 2 for 8.
     *
     * THIS READS THE C RATHER THAN THE EMITTER, and that is the whole point.
     * The emitter mints temps at about 45 sites, only three of which are the
     * new*Temp methods that the spill registration went into. A check
     * written against a list of those sites would be the same hand-kept copy
     * that a list of non-lowerable POSITIONS would have been -- and that
     * list, built from three probed spellings, would have admitted new.args
     * in silence. Every sc_t/sc_i in a converted body is covered here,
     * whatever minted it.
     *
     * ARMED, and here is how to reproduce it: drop the frames.length
     * registration in newTemp back to `if (isRefCounted(type))`. Nine of the
     * bodies in this program go red by name -- wna, wnv, wnn, wns, wnb, wnx
     * and three more whose literal operands only survive because the C
     * compiler rematerialises a constant.
     *
     * KNOWN APPROXIMATION, stated rather than hidden: a write is taken to
     * re-establish a temp on every path. That is the direction that can MISS
     * a hazard, so this is a net under the value guards above and not a
     * replacement for them. */
    {
      const nl = String.fromCharCode(10);
      const LABEL = /^\s*sc_S[0-9]+:/;
      const DECL = /^\s*(?:const\s+)?[A-Za-z_][A-Za-z0-9_]*(?:\s*\*)*\s+\*?(sc_[ti][0-9]+)\s*(?:=|;)/;
      const WRITE = /^\s*\*?(sc_[ti][0-9]+)\s*=[^=]/;
      const NAME = /sc_[ti][0-9]+/g;
      const lost: string[] = [];
      for (const b of on.cSource.split(/^(?=[A-Za-z ]*void sc_cr_)/m)) {
        const m = /^[A-Za-z ]*void (sc_cr_[A-Za-z0-9_]+)\(ScrCoroBase/.exec(b);
        if (!m) continue;
        const end = b.indexOf(nl + "}" + nl);
        const lines = (end > 0 ? b.slice(0, end) : b).split(nl);
        if (!lines.some((l) => LABEL.test(l))) continue;
        const valid = new Map<string, boolean>();
        // A resume label lands INSIDE one arm, so the sibling arm is not
        // reachable from it. Without this the nullish shapes report a hazard
        // that cannot happen -- measured: they answered correctly on all
        // three lanes while being flagged.
        const opened: Array<[Map<string, boolean>, Map<string, boolean> | null]> = [];
        const reads = (text: string, self: string | null): void => {
          for (const t of text.match(NAME) ?? []) {
            if (t !== self && valid.get(t) === false) {
              lost.push(`${m[1]}: ${t}`);
              valid.set(t, true); // report each temp once per body
            }
          }
        };
        for (const raw of lines) {
          const l = raw.trim();
          if (/^}\s*else\s*{/.test(l) && opened.length > 0) {
            const top = opened[opened.length - 1]!;
            opened[opened.length - 1] = [top[0], new Map(valid)];
            valid.clear();
            for (const [k, v] of top[0]) valid.set(k, v);
            continue;
          }
          if (l.endsWith("{")) { opened.push([new Map(valid), null]); continue; }
          if (l.startsWith("}") && opened.length > 0) {
            const [, thenExit] = opened.pop()!;
            if (thenExit) for (const [k, v] of thenExit) if (!v) valid.set(k, false);
            continue;
          }
          if (LABEL.test(raw)) {
            for (const [k, v] of valid) if (v) valid.set(k, false);
            continue;
          }
          const d = DECL.exec(raw);
          if (d) {
            const eq = raw.indexOf("=");
            if (eq >= 0) reads(raw.slice(eq + 1), d[1]!);
            valid.set(d[1]!, true);
            continue;
          }
          const w = WRITE.exec(raw);
          if (w) {
            reads(raw.slice(raw.indexOf("=") + 1), w[1]!);
            valid.set(w[1]!, true);
            continue;
          }
          reads(raw, null);
        }
      }
      expect([...new Set(lost)],
        "temps established before a resume label and read after it -- the park loses these, and the answer is a plausible wrong number")
        .toEqual([]);
    }

    const run = (exe: string): string => execFileSync(exe, [], { encoding: "utf8" });
    const fiber = run(off.exe);
    // The reference arm has to be sane before it can referee: a fiber lane
    // that was itself wrong would make a matching stackless lane look right.
    expect(fiber, "the fiber arm is the reference and must be sane").toContain("bool   true false");
    expect(fiber, "the fiber arm must reach the rejection, not swallow it").toMatch(/rej\s+boom true/);
    expect(fiber, "the fiber arm must run to completion").toContain("done");
    // THE assign ROUTES, asserted as ABSOLUTE VALUES on BOTH arms.
    //
    // "the two arms agree" is not a control here. One mechanism can break
    // both: coroFrameLocals, the rule that actually keeps route (B) correct,
    // is shared with nothing lane-specific, and a frontend change that
    // reordered emitStrAccum would move the fiber arm too. So each line is
    // pinned to the value the language requires, computed by hand from the
    // producers above, and checked on the reference arm BEFORE the arms are
    // compared to each other.
    //
    //   wga(5)  gs = await ps("a5") = "a5!"            -> "a5!/3"
    //   wgn(20) gn = await pf(20)  = 21                -> 42
    //   wgc     "A" += ps("k")="k!"                    -> "Ak!"
    //   wgc2    "B" += ps("k") + s   (s read BOTH sides of the park) -> "Bk!B"
    //   wgf(3)  x starts 7, becomes pf(3)=4            -> 4   (a dead store answers 7)
    //   wgs     x starts "z", becomes "y!"             -> "y!/2"
    //   wgr(4)  x starts [9], becomes [4,5]            -> "4,5"
    //   wgx(3)  x boxed, store through the box, closure reads it back
    //           -> 4*1000 + 4 = 4004  (an unshared box answers 4001)
    //   wgp(3)  x starts 5, += pf(3)=4                  -> 9   (a lost left
    //           operand answers 4, a stale one answers 5)
    const ASSIGN_LINES = [
      "asg-g  a5!/3 | 42 | a5! 21",
      "asg-c  Ak! | Bk!B",
      "asg-l  4 | true | y!/2 | 4,5",
      "asg-x  4004 | 9",
      // The hop rows. whn: 3*100 + 7. whs: "hk" is 2 chars. wha: the awaited
      // array survives the park. whu: `await null` answers null, not
      // undefined. who: 1:1 interleaving is one turn per hop, exactly.
      "hop    307 | hk/2 | 4,5",
      "hop2   true | void-hop",
      "hopord a1 b1 a2 b2 a3 b3",
    ];
    for (const line of ASSIGN_LINES) {
      expect(fiber, `the reference arm must already answer: ${line}`).toContain(line);
    }
    expect(run(on.exe), "the stackless lane disagrees with fibers").toEqual(fiber);
    for (const line of ASSIGN_LINES) {
      expect(run(on.exe), `the stackless lane answers the wrong value: ${line}`).toContain(line);
    }
  });
});
