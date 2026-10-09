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
import { beforeAll, describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";
import { auditModule } from "./cross-park-slot-oracle.js";

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
  // THE awaitUnion SHAPES. `await u` on a promise-or-absent union suspends on
  // BOTH arms: the promise arm parks, the unit arm takes the bare hop. It is
  // ONE point sharing ONE state and ONE resume label, and the resume tells the
  // arms apart by sc_awaited.
  //
  // `mix` has been declared in this program since the slice before last and
  // was never awaited, so this shape had NO value coverage at all -- the
  // ledger listed it as the thing that must stay off the lane, and nothing
  // checked what it answered. Each row drives BOTH arms with values that
  // differ from each other, because the failure here is the WRONG ARM with a
  // plausible answer.
  //
  // WHICH OF THESE IS ACTUALLY THE awaitUnion NODE, because the first version
  // of this block got it wrong and the rows still went green. `Promise<T> | T`
  // is the SETTLE-OR-VALUE contract and the frontend DESUGARS it into a
  // ternary holding an ordinary awaitExpr and an async.hop -- two points, two
  // states, already converted by the hop slice. Only `Promise<T> | <unit>`
  // reaches `awaitUnionExpr` (lower-exprs.ts:2039). So wau/was guard the
  // desugar (worth having, and not what they claimed) and the three `*u` rows
  // below are the ones that reach the two-armed lowering.
  //
  // Verified by reading the emitted C rather than by the ledger: sc_cr_wav
  // holds `if (tag == 0) { ... scr_coro_park ... } else { ... scr_coro_hop
  // ... } sc_S1:;` -- one state, one shared label -- while sc_cr_was holds
  // three states and a retained promise.
  { name: "wau", take: "ref", finish: "f64", converted: true }, // DESUGAR, Promise<T>|T
  { name: "was", take: "ref", finish: "ref", converted: true }, // DESUGAR, Promise<T>|T
  // The real awaitUnion rows. app182 contains ZERO value-result awaitUnions
  // (all 31 of its points are the void shape), so waun/waus are coverage by
  // CAPACITY: the measured program could not have refuted the value path and
  // neither could a green corpus.
  { name: "wav", take: "void", finish: "ref", converted: true }, // awaitUnion, VOID result
  { name: "waun", take: "ref", finish: "ref", converted: true }, // awaitUnion, f64 arm
  { name: "waus", take: "ref", finish: "ref", converted: true }, // awaitUnion, string arm
  // THE LOOP SHAPES. The dispatch goto jumps INTO the loop body, which is the
  // same "jump into a block" the try slice relies on, and a plain loop's
  // carried state is ordinary IrLocals the frame already holds. Each row
  // exists for a distinct way that could be false:
  //   wln  a NON-refcounted loop-carried accumulator -- covered by liveness
  //        alone, not by the "every owned local" rule
  //   wls  a refcounted one, through emitStrAccum, inside a loop
  //   wlf  `for`, whose update clause runs after the resume
  //   wld  `do/while`, whose condition is at the BOTTOM
  //   wlc  `continue` taken AFTER a resume
  //   wlb  `break` taken AFTER a resume
  //   wlnest  an inner loop whose counter must not survive the outer pass
  { name: "wln", take: "f64", finish: "f64", converted: true },
  { name: "wls", take: "ref", finish: "ref", converted: true },
  { name: "wlf", take: "f64", finish: "f64", converted: true },
  { name: "wld", take: "f64", finish: "f64", converted: true },
  { name: "wlc", take: "f64", finish: "f64", converted: true },
  { name: "wlb", take: "f64", finish: "f64", converted: true },
  { name: "wlnest", take: "f64", finish: "f64", converted: true },
  // A NEGATIVE entry, and the one that can go wrong in silence. A forOf names
  // only its binding: its iterable reference and its cursor are
  // backend-internal and are NOT IrLocals, so `live` cannot name them and the
  // frame cannot carry them. It must STAY on the fiber lane, and this row
  // fails the moment it stops doing so.
  // wlfo WAS the negative row for the forOf exclusion. The cursor hoist buys
  // it, so it flips here -- which is the handover this ledger exists for: the
  // row that said "this must stay off the lane" is the row that names the day
  // it stops needing to.
  { name: "wlfo", take: "f64", finish: "f64", converted: true },
  // THE forOf SHAPES. "The gap was never the iterable" STOOD HERE AND WAS
  // FALSE ON THIS LANE -- the C reading was carried onto a backend where it
  // does not hold, so it is corrected rather than deleted. On the C lane the
  // iterable is a local the RC frame spills whole. Here `emitExpr` hands back
  // an SSA `%tN`, and the RC frame carries its OWNERSHIP, not its DEFINITION:
  // once the body parks, the loop condition and body head become reachable
  // from the resume label through the back edge and that definition no longer
  // dominates them. Measured, not reasoned -- the first build of this slice
  // carried only the cursor and zig cc rejected it with 14 "Instruction does
  // not dominate all uses". Both the cursor AND the iterable are carried now.
  // Each row below is a distinct way the carry could still be wrong:
  //   wfo1  the cursor itself: a wrong reload re-runs or skips iterations
  //   wfo2  a refcounted ELEMENT bound per iteration, across the park
  //   wfo3  NESTED forOf -- two cursors, and the inner must not clobber the
  //         outer when the inner resumes
  //   wfo4  `continue` taken after a resume, so the increment still runs
  //   wfo5  a CAPTURED loop variable: a fresh box per iteration, which the
  //         resume must not re-mint or share
  { name: "wfo1", take: "f64", finish: "f64", converted: true },
  { name: "wfo2", take: "ref", finish: "ref", converted: true },
  { name: "wfo3", take: "f64", finish: "f64", converted: true },
  { name: "wfo4", take: "f64", finish: "f64", converted: true },
  { name: "wfo5", take: "f64", finish: "f64", converted: true },
  // THE PENDING-RETURN ROW, and it guards a defect that was ALREADY SHIPPED
  // rather than a shape this slice admits. Its only await is OUTSIDE the try,
  // so it is a plain D1 function and has been converted since the first
  // merged slice -- but its `return` crosses a finally, and the pending-return
  // dispatch emitted `return sc_pret;` into a VOID resume function. On a clean
  // base checkout this program does not compile at all.
  //
  // It survived six slices, every gate and every measurement because the
  // measured program contains no function of this shape: occupancy zero,
  // capacity live. It is here so the shape has an occupant.
  //
  // The value is the second half: a `return` crossing a finally SNAPSHOTS its
  // value before the finally runs, so the mutation must be invisible and this
  // must answer 4. A lost snapshot answers 999 -- a plausible number that no
  // structure check or turn count can see.
  { name: "wfy5", take: "f64", finish: "f64", converted: true },
  // THE SHAPE-(2) ROWS: a point in a try/catch GUARDED by a finally. These
  // resume with an exception possibly pending, which is what the fat frame
  // answers, and they are the population this slice admits.
  //
  // wfy4 is the (b) row. It was written expecting the OPPOSITE geometry from
  // wfy5 -- await inside the try, so the park would fall between the sc_pret
  // write and its read -- and the emitted C REFUTES that, which is why the
  // comment says so instead of the prediction.
  //
  // sc_cr_wfy4 emits: park, resume label, THEN `sc_pret = ...`, then the jump
  // to the pending-return copy, then the read. The park PRECEDES the write,
  // and it does so by construction rather than by luck: sc_pret is written at
  // the return site, which is after the awaited value has been taken, and it
  // is read after the finally runs -- and a shape-(2) finally body holds no
  // park. The only way to interleave one is to put the suspension INSIDE the
  // finally body, which is shape (1) and is not in this slice.
  //
  // So (b) is not owed by this population at all. The risk is ABSENT by
  // construction, which is a different claim from "guarded", and the
  // difference is why this paragraph exists.
  { name: "wfy1", take: "f64", finish: "ref", converted: true },
  { name: "wfy2", take: "f64", finish: "ref", converted: true },
  { name: "wfy3", take: "ref", finish: "ref", converted: true },
  { name: "wfy4", take: "f64", finish: "f64", converted: true },
  // SHAPE (1), a suspension INSIDE the finally body -- and this row DID fail
  // the day it stopped being out of scope, which is what it was written for.
  // D4 admitted it: the emitter writes that body once per completion path, so
  // one IR node becomes up to three emitted sites, each with its own state.
  // The one-state-per-point equality could not survive that and became two
  // inclusions; see emit-stmts.ts and tests/harness/stackless-finally-body
  // .test.ts, which guards the three paths and the multiplicity this file
  // only has to notice.
  { name: "wfy6", take: "f64", finish: "f64", converted: true },
  // The multi-copy half of shape (1); see its definition in SOURCE. It was the
  // last wrapper on the C lane's ledger and OFF the LLVM floor, and it is on
  // both now: the LLVM lane draws a state per EMITTED site, so the two copies
  // of its finally body take a state each instead of overflowing a plan that
  // allotted the IR node one.
  { name: "wfy7", take: "f64", finish: "ref", converted: true },
  // THE FOUR STATEMENT POSITIONS, as one slice because they are DISJOINT: no
  // remaining function in the measured program carries two of them, so their
  // reach is additive exactly. Grouped by COST, not by nature -- `if`,
  // `recordSet` and `bytesSet` are rootOk carve-outs like `assign` was, while
  // `switch` was a DEPTH blocker like `loop`.
  //
  // wsw is the sharp one. emitSwitch NULL-resets refcounted case-scoped
  // locals at the TOP of the statement and a resume re-enters BELOW that
  // reset, so the row exists to show the frame reload stands rather than
  // being clobbered. It carries a refcounted local for exactly that reason.
  //
  // wsd and wst are CAPACITY: the measured program has zero awaits in a
  // switch discriminant or a case test, so neither it nor a green corpus
  // could refute those two.
  { name: "wif", take: "bool", finish: "ref", converted: true },
  { name: "wrs", take: "f64", finish: "f64", converted: true },
  { name: "wby", take: "f64", finish: "f64", converted: true },
  { name: "wsw", take: "ref", finish: "ref", converted: true },
  { name: "wsd", take: "f64", finish: "ref", converted: true },
  { name: "wst", take: "f64", finish: "ref", converted: true },
  // AND THE ROW THAT ACTUALLY REACHES THE NULL-RESET. wsw above declares its
  // local inside BRACES, which makes it a nested block -- and emitSwitch
  // resets only locals declared at the TOP LEVEL of a case body, because
  // "nested blocks manage their own scopes". Measured in the emitted C: the
  // whole guard program contained ZERO `case-scoped` resets, so the risk this
  // slice named as its sharpest was not being exercised by the guard written
  // for it. wsu drops the braces and is the row that reaches it.
  { name: "wsu", take: "ref", finish: "ref", converted: true },
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
`;

interface Arm {
  exe: string;
  /** The emitted program TU, re-read from disk. `.c` on the C lane and `.ll`
   * on the LLVM one -- NOT interchangeable, and not a cosmetic difference:
   * index.ts actively REMOVES the other backend's artifact after a build
   * (pruneStaleArtifacts rm's stem + (backend === "llvm" ? ".c" : ".ll")), so
   * an LLVM build leaves no prog.c on disk at all. Reading the wrong name here
   * throws ENOENT, and a suite red about a missing FILE looks exactly like a
   * suite red about a missing LOWERING while measuring the prune policy
   * instead. The name follows the lane for that reason. */
  artifact: string;
}

/* THE RESUME FUNCTION'S SPELLING IS THE SAME TOKEN ON BOTH LANES, which is
 * what lets one ledger referee two backends. mangleCoroResume is
 * backend-neutral (mangle.ts), so the C lane emits
 *     static void sc_cr_ws(ScrCoroBase *sc_b) {
 * and the LLVM lane
 *     define internal void @sc_cr_ws(ptr %sc_b)
 * and "sc_cr_ws(" is a substring of both. No regex, and that is deliberate:
 * the word-boundary escape this file used to carry lost a backslash on its
 * way through a heredoc and became the BACKSPACE character, so the control
 * matched nothing and reported every wrapper missing. */
const resumeName = (name: string): string => `sc_cr_${name}(`;

/** Every resume function in an artifact, keyed by its mangled name, as the
 * text between its opening line and its closing brace.
 *
 * TWO SPELLINGS, ONE SHAPE. The C lane opens a resume with
 *     static void sc_cr_ws(ScrCoroBase *sc_b) {
 * and closes it with a brace in column 0; the LLVM lane opens with
 *     define internal void @sc_cr_ws(ptr %sc_b) ... {
 * and closes the same way. The scans below are about what a body CONTAINS,
 * not about how it is punctuated, so they take their bodies from here and
 * stay lane-neutral.
 *
 * Returning a MAP rather than an array is deliberate: a scan that reports an
 * offender has to name it, and a splitter that loses the name turns a precise
 * failure into a count. */
function resumeBodies(artifact: string, lane: Lane): Map<string, string> {
  const nl = String.fromCharCode(10);
  const out = new Map<string, string>();
  const open = lane === "llvm"
    ? /^define [^@\n]*@(sc_cr_[A-Za-z0-9_]+)\(/
    : /^[A-Za-z ]*void (sc_cr_[A-Za-z0-9_]+)\(ScrCoroBase/;
  const lines = artifact.split(nl);
  for (let i = 0; i < lines.length; i++) {
    const m = open.exec(lines[i]!);
    if (!m) continue;
    let j = i + 1;
    while (j < lines.length && lines[j] !== "}") j++;
    out.set(m[1]!, lines.slice(i, j).join(nl));
  }
  return out;
}

/* THE LLVM LANE'S FLOOR -- the wrappers its emitter lowers today (40 of the 80
 * planned, 32 of them from the dispatch slice and 8 from the multi-state and
 * hop one).
 *
 * THIS IS A FLOOR, NOT A PREDICATE, and the difference is the whole reason it
 * is safe to write names here. The predicate lives in
 * backend/llvm/coro.ts (llvmCoroLowers) and is recomputed from the plan on
 * every build; this list is a MEASUREMENT of what that predicate admitted on
 * this program, pinned so that a wrapper silently dropping off the lane fails
 * BY NAME instead of making the two arms more equal. Run any build with
 * SCRIPTC_LLVM_CORO_CENSUS=1 to print the predicate's verdict, with a reason,
 * for every planned function -- that is how this list was produced and how it
 * should be re-derived rather than edited by hand.
 *
 * WHY IT IS NOT THE "P" THE SLICE WAS SCOPED AGAINST, because the gap is a
 * real finding and not a drift. P was defined as "exactly one suspension
 * point, it is a park, not a hop, and no unnamed temp is owned across it", and
 * its membership was computed by reading the knob-ON prog.c and counting
 * `sc_tmp_` fields in each frame. That count is a C-EMITTER ARTIFACT: the C
 * emitter pushes EVERY temp into its RC frame, refcounted or not, so a dead
 * scalar argument gets a frame slot. `await pf(v)` with a `number` argument
 * therefore shows a `double sc_tmp_sc_t0` and falls out of P, while
 * `await ps(v)` with a `string` argument shows none -- the string temp's +1 is
 * MOVED into the call and leaves the frame. The spill is spurious in the first
 * case: the C reload at the resume label writes a local nothing reads again.
 *
 * On this lane there is no such spill to be spurious. `B.tmp()` enters no
 * frame, and the scalar argument's `%t` is simply not referenced after the
 * park -- so the shapes P excluded for carrying a dead C temp are lowerable
 * here, and the measured set is wider than P rather than different from it.
 * The narrow reading would have cost coverage to match a number derived from
 * the other backend's bookkeeping. */
const LLVM_FLOOR: ReadonlySet<string> = new Set([
  "wf", "wb", "ws", "wa", "wu", "wd", "wtv", "wv", "wr",
  "wtc", "wdr", "wca", "wbf", "wbb", "wbs", "wcs",
  "wgn", "wgf", "wgb", "wgs", "wgr", "wgx",
  "wlc", "wlb",
  // THE forOf SHAPES. Their cursor AND their iterable now live in the frame:
  // both are loop state re-entered through the back edge, which no append-time
  // scan can see, so the lowering DEMANDS they be carried instead of waiting to
  // be told. Moved out of NOT_LOWERED_BY_REASON in the same commit that bought
  // them, which is what that table's own instruction asks for.
  "wlfo", "wfo1", "wfo2", "wfo3", "wfo4", "wfo5",
  "wfy5", "wfy1", "wfy2", "wfy3", "wfy4",
  // + SHAPE (1), BOTH HALVES, and they arrived one slice apart for reasons
  // worth keeping side by side.
  //
  // `wfy6` has no `return` crossing its finally and a try body that cannot
  // throw, so the emitter writes that body ONCE. It came in when the blanket
  // structural refusal was deleted -- the refusal named `%pretSlot` and `wfy6`
  // mints none, so the wrapper filed under the condition could not exercise
  // it.
  //
  // `wfy7` returns a refcounted value THROUGH its finally, so the body is
  // written again at the return site: one IR suspension node, two emitted park
  // sites. It came in when the emitter stopped allotting states per PLAN POINT
  // and started allotting one per EMITTED SITE -- the one-state-per-point
  // equality became the two inclusions the C lane already carries. Its
  // artifact shows the mechanism directly: two resume labels and two dispatch
  // cases for a plan holding one point, with `%pretSlot` riding the frame.
  "wfy6", "wfy7",
  "wif", "wsd", "wsu",
  // THE MULTI-STATE DISPATCH. More than one suspension point is a second
  // state, a second resume block and a second spill site. `who` parks twice in
  // sequence; `wsw` parks in two different case bodies of one switch, which is
  // also where a resume label first lands inside a statement the dispatch jumps
  // into.
  "who", "wsw",
  // THE BARE MICROTASK HOP (`async.hop`). `hopsteps` is the multi-state one and
  // is what the `hopord` turn row measures: two hops, and the 1:1 interleaving
  // holds only if each costs exactly one turn. The other five are one hop each,
  // one per operand kind, and each carries its hidden `%awaited` local across
  // the suspension.
  "hopsteps", "whn", "whs", "wha", "whu", "whv",
  // + the cross-park temp slice. The frame now carries the SSA values that
  // outlive a suspension, so a shape is no longer refused for having evaluated
  // something before its await. The groups these came from were LABELS on one
  // mechanism: a value that will be read after a block that `ret`s. See the
  // deleted condition 3 in coro.ts.
  "wrm", "wtt", "wte", "wtb",
  "wna", "wnv", "wnn", "wns", "wnb", "wnx", "wnf", "wnr", "wnm",
  "wgc", "wgc2", "wgp",
  "wln", "wls", "wlf", "wld", "wlnest",
  "wrl", "wrs", "wby", "wga",
  "wst",
  // + the awaitUnion slice. ONE point, ONE state, ONE resume label, TWO
  // suspension calls -- the park arm and the hop arm share the label and are
  // told apart on the far side by `sc_awaited`. These three were blocked on
  // the cross-park temp mechanism, not on the block shape: the operand is a
  // refcounted `ScrUnion *` read again after the resume, and it cannot ride
  // `sc_awaited` because that field is the arm discriminator.
  //
  // THEIR VALUE COVERAGE IS THE `aunion`/`aunion2` ROWS, which drive BOTH arms
  // of all three with per-arm-distinct answers. That is what makes this move a
  // purchase rather than a reclassification: resuming into the wrong arm
  // answers the right TYPE with the wrong value, which no turn count and no
  // structure check can report.
  "wav", "waun", "waus",
  // + the PROMOTED cross-park temp. A temp live at a SECOND suspension cannot
  // be carried as an SSA reload at all -- the reload is defined in one resume
  // block and re-spilling it at the next asks that definition to dominate a
  // site the dispatch also enters directly -- so these two were refused on a
  // real toolchain error rather than on caution. They are carried in an
  // ALLOCA now: stored where the value is computed, loaded at every use, and
  // moved through the frame by the cross-park SLOT mechanism that already
  // existed. Nothing about the SSA carry changed, which is why the other
  // seventy-six artifacts are untouched.
  //
  // WHAT THEY EXERCISE, counted rather than assumed: each holds ONE temp
  // across TWO suspensions -- the awaitUnion's park arm and the following
  // microtask hop. That is the whole of what this lane exercises today. This
  // used to point at a group below for the shape exercising THREE and what
  // stopped it; that group is gone and the list below is empty, so the
  // unexercised depth is now recorded here and nowhere else -- no wrapper in
  // this ledger carries a temp across three suspensions, and nothing refuses
  // one either. It is uncovered, not blocked.
  "wau", "was",
]);

/* THE OTHER HALF OF THE PARTITION -- the shapes the LLVM lane does NOT lower,
 * grouped by the reason its emitter gave, and WRITTEN OUT rather than derived.
 *
 * WHY IT IS A LITERAL LIST AND NOT A COMPUTATION. The obvious shortcut is
 * "everything converted that is not in the floor", or worse, "whatever the
 * emitter refused". Either one lets the emitter feed BOTH sides of the
 * comparison, and a test whose expectation is produced by its subject is green
 * for ever -- it cannot answer the one question it exists for, which is whether
 * the partition MOVED. Spelled out, a shape that starts or stops converting
 * fails by name and someone has to move the line on purpose.
 *
 * WHY GROUPED BY CAUSE instead of one flat set. A bucket forces a new entry to
 * be CLASSIFIED, so the list stays a worklist rather than a quarantine: each
 * group names the mechanism a later slice has to build, and the biggest group
 * is the next slice's subject. It currently holds NO group, so there is no
 * next subject here -- that is the list doing its job, not the list being
 * obsolete, and the paragraph below says what keeps it honest while empty.
 * The reasons are the emitter's own words --
 * build anything with SCRIPTC_LLVM_CORO_CENSUS=1 AND SCRIPTC_NO_CACHE=1 to
 * print one line per planned function with its verdict, which is how this list
 * was produced and how it should be re-derived rather than hand-edited.
 *
 * BOTH VARIABLES, and the second is not optional. The census is printed by the
 * emitter, and an early cache hit skips codegen, so a warm build prints
 * nothing -- indistinguishable from "nothing was planned". The census variable
 * is itself in the cache key, so the first run with it set reports and every
 * run after is served the previous answer in silence.
 *
 * NOTHING HERE WAS EVER PERMANENT, and the list emptying is the proof. Every
 * name that passed through it was a shape the C lane already converted, so
 * each group was work that existed rather than a limit that had been
 * discovered -- and every one of them has now been done. A name arriving here
 * again is a regression or a newly admitted shape, never a verdict. */
const NOT_LOWERED_BY_REASON: ReadonlyArray<readonly [string, readonly string[]]> = [
  // THIS LIST IS EMPTY, AND THAT IS A STATE AND NOT A DELETION. Every wrapper
  // the C lane converts, the LLVM lane converts too; the gap between the two
  // ledgers is closed. The list stays because it is half of the partition the
  // test below checks -- a wrapper that stops converting has to be put here by
  // name, deliberately, rather than quietly dropping off the floor, and
  // assertion (0) fails until it is classified on one side or the other.
  //
  // A `finally` BODY THE EMITTER WRITES MORE THAN ONCE was the last group,
  // holding `wfy7`. The body is copied once per completion path -- the
  // fallthrough, the exception path, and one per `return` crossing the region
  // -- so one IR suspension node became several emitted park sites, each
  // drawing a state out of a plan that allotted the node ONE, and the emitter
  // counted them and refused.
  //
  // WHAT CLOSED IT is what this table said it would take: a state per emitted
  // SITE instead of per IR node. The dispatch is written after the body
  // instead of before it, `plan.points.length` stopped being the state count,
  // and D5's equality became the two inclusions the C lane already carried.
  // `wfy7` is in LLVM_FLOOR above.
  //
  // THE GROUP BEFORE IT was wider still -- every suspension inside a finally
  // body, refused on the strength of the `%pretSlot` snapshot a `return`
  // crossing one leaves behind. `wfy6` has no such return, mints no slot, and
  // lowered correctly: a condition refusing a shape its own stated hazard did
  // not reach, with a ledger row under it that was not an example of it.
  // `wfy7` was written to BE the example, which is how the second removal got
  // a subject that could fail.
  //
  // A TEMP CROSSING A SECOND SUSPENSION USED TO BE A GROUP HERE, and it is
  // gone rather than emptied: the mechanism it was waiting for -- an alloca
  // written at the definition and read at every use, carried through the frame
  // by the slot mechanism -- exists, and `wau` and `was` are in the floor.
  //
  // THE PASS-CAP GROUP THAT STOOD HERE IS GONE TOO, and what closed it was
  // not a bigger number. The text it replaced said a body with more than
  // CORO_SPILL_PASS_CAP violations "runs out of passes before it runs out of
  // temps", and offered a three-await concatenation as the measured example:
  //   return "h" + n + "|" + (await ps("a")) + "|" + (await ps("b")) + ...
  // That shape is now LOWERED, checked in both directions -- refused
  // `cross-park-temp-passes>12` against 79e6902d0 and answering `h7|a!|b!|c!`
  // against this base. So the promotion is exercised at three crossings as
  // well as two, and nothing is blocked one mechanism earlier any more.
  //
  // THE CAP WAS NOT THE LIMIT IT NAMED. The loop found one violation per pass
  // because the rules THROW, but the reason it could not finish `main` was
  // that the SLOT carry drew its names from `tmp()`: four per carried slot
  // per suspension, which renumbered every temp minted after the first one.
  // Each promotion moved the violating temp by exactly 84 and the loop
  // re-found the SAME value under a new name. Four hundred passes produced
  // four hundred names for one temp, all at generation 24 in block
  // `exc.k108`. slotCarryName makes the carry mint nothing, and a two-pass
  // probe then collects the whole set at once -- coro.ts and emitter.ts
  // carry the argument.
];

/* NON-WRAPPER COROUTINES -- THE BACK DOOR THE LEDGER CANNOT SEE.
 *
 * Everything above is keyed on WRAPPERS, which is the ledger of shapes this
 * file was written to exercise. The program contains async functions that are
 * not wrappers -- the producers the wrappers await, and `main` itself -- and a
 * partition built from the ledger is blind to all of them. They can start
 * lowering, stop lowering, or change shape, and nothing here would say so.
 *
 * THIS IS NOT HYPOTHETICAL AND IT WAS NOT CAUGHT BY A TEST. The cross-park
 * temp slice lowered `pu` as a side effect of deleting the nesting condition.
 * It surfaced only as an inconsistency between two aggregates -- "69 lowered"
 * against "68 wrappers" -- in a report. An aggregate is not a guard: it has no
 * failing direction, and the next reader sees one number.
 *
 * SO THE ARTIFACT IS THE AUTHORITY HERE, not the ledger. The assertion below
 * reads EVERY `sc_cr_*` the emitter produced and requires the set to equal
 * LLVM_FLOOR plus exactly these names. A function entering or leaving the lane
 * fails by name whichever side of the ledger it is on.
 *
 * Re-derive with SCRIPTC_LLVM_CORO_CENSUS=1 AND SCRIPTC_NO_CACHE=1. */
const LLVM_FLOOR_NON_WRAPPERS: ReadonlyArray<readonly [string, string]> = [
  // `pu` IS BACK, AND THE TABLE IS WHY ANYONE CAN TELL. It lowered once before
  // -- deleting the nesting condition bought it, and the only trace was two
  // aggregates disagreeing in a report -- then refused itself out again when
  // the second-suspension limit landed. It is here a third time because the
  // promotion closed that limit. The movement is visible this time, in a
  // table, instead of being inferred from a number.
  //
  // ITS VALUE IS COVERED, which is what this column is for: `pu` is the
  // producer behind the `union` row (`2 null`), awaited by `wu` on both arms,
  // so a lowering that answered the wrong value fails the output comparison
  // rather than passing as a count.
  ["pu", "the Promise<T|null> producer; its value is the `union` row, both arms"],
  // `main` IS THE PROGRAM, which is what makes its value column the widest
  // one in this file rather than the thinnest. Every line the comparison
  // below reads is printed BY this function -- 38 of them, 866 bytes -- so a
  // lowering that dropped a statement, took a wrong arm or lost a value
  // fails the output comparison against the fiber arm rather than passing as
  // a count. Measured: all four legs (base/candidate x knob on/off) print the
  // same 866 bytes.
  //
  // IT IS ALSO THE FIRST NON-WRAPPER HERE THAT IS NOT A PRODUCER, and the
  // first body on this lane with 102 suspensions. It took 55 cross-park temps
  // and 54 promotions to lower, which is why the two mechanisms it needed --
  // a slot carry that renumbers nothing, and a probe that collects the whole
  // set in one emission -- are written up where they live and only named
  // here. Its row moved from LLVM_NOT_LOWERED_NON_WRAPPERS, where it had sat
  // under five different first-blockers.
  ["main", "the program itself; its value is all 38 printed lines, against the fiber arm"],
];

/* NON-WRAPPERS THIS LANE DOES NOT LOWER, and why -- same back door, other
 * side. EMPTY AT THIS BASE, and emptied rather than deleted.
 *
 * `main` WAS ITS ONLY EVER OCCUPANT and it was refused at five successive
 * bases for five DIFFERENT first blockers -- `points=100` at c03fcd699,
 * `nested-in-expression` at af6419f8f, `cross-park-temp-passes>12`,
 * `temp-crosses-two-suspensions=%t2462`, and `cross-park-temp-passes>12`
 * once more at 79e6902d0. That is the census showing only the FIRST blocker,
 * five times over, against one unchanged body. The assertion below checks a
 * name is ABSENT and never why, which is exactly how four stale spellings sat
 * beside a green test. `main` is now in LLVM_FLOOR_NON_WRAPPERS.
 *
 * WHAT THE PASS CAP TURNED OUT TO BE, since this list carried its warning for
 * three bases. The warning said raising CORO_SPILL_PASS_CAP from 12 would
 * silently buy coverage, so naming `main` here would MOVE A TEST when someone
 * did. The mechanism was right and the diagnosis under it was not: raising it
 * to 400 bought nothing at all. The loop was not running out of passes, it
 * was re-finding ONE violation under 400 different names, because the slot
 * carry drew four `tmp()` names per slot per suspension and renumbered the
 * body under it. Every pass reported generation 24, defining generation 21
 * and block `exc.k108`; only the `%tN` moved, by exactly 84 = 4 * 21.
 *
 * SO THE CAP IS NOW A BACKSTOP AND NOT A GATE, which is what it always said
 * it was (coro.ts: "THE BOUND IS NOT THE TERMINATION ARGUMENT"). The probe
 * hands the fixpoint everything in one go, so a body that reaches 12 passes
 * is one the probe DECLINED -- a refusal, an unreadable type, or a violation
 * the second probe pass newly saw. Raising the number would not help it.
 *
 * A NEW ROW HERE still means what it always did: a non-wrapper coroutine this
 * lane does not lower, named so the artifact assertion below can hold it to
 * ABSENCE, with the reason re-derived (SCRIPTC_LLVM_CORO_CENSUS=1 AND
 * SCRIPTC_NO_CACHE=1) rather than copied. */
const LLVM_NOT_LOWERED_NON_WRAPPERS: ReadonlyArray<readonly [string, string]> = [];

const LLVM_NOT_LOWERED: ReadonlySet<string> = new Set(
  NOT_LOWERED_BY_REASON.flatMap(([, names]) => names),
);

type Lane = "c" | "llvm";

/** Which wrappers THIS lane is expected to have converted. The C emitter
 * lowers every function the plan admits, so its expectation is the ledger
 * itself; the LLVM emitter lowers a strict subset, so its expectation is the
 * floor above -- and the gap between that floor and the ledger is reported by
 * name rather than trimmed away. See the ledger test below. */
const expectedOnLane = (lane: Lane, w: { name: string; converted: boolean }): boolean =>
  w.converted && (lane === "c" || LLVM_FLOOR.has(w.name));

async function buildArm(knob: boolean, backend: Lane): Promise<Arm> {
  const previous = process.env["SCRIPTC_STACKLESS"];
  if (knob) process.env["SCRIPTC_STACKLESS"] = "1";
  else delete process.env["SCRIPTC_STACKLESS"];
  try {
    // The knob is part of the KEY. It is not part of the compiler's own cache
    // key, so two arms sharing an output directory would share one binary and
    // the comparison would pass by being the same program twice. The BACKEND
    // joins the key for exactly the same reason: both lanes write their
    // artifact and their exe to the same two names.
    const key = createHash("sha256").update(SOURCE).update(knob ? "on" : "off")
      .update(sanitize ? "san" : "plain").update(backend).digest("hex").slice(0, 16);
    const outDir = join(cacheDir, `stackless-values-${key}`);
    const file = join(outDir, "prog.ts");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(file, SOURCE);
    // keepC IS A NO-OP TODAY and is kept anyway: nothing under packages/ reads
    // the option (request-init.test.ts:414 got here first and wrote it down).
    // What actually keeps the artifact on disk is the prune deleting only the
    // OTHER backend's file. The read below must not be taken to rest on keepC.
    const r = await compile(file, { outPath: join(outDir, exeName("prog")), outDir, sanitize, backend, keepC: true });
    if (!r.ok) throw new Error(r.diagnostics.map((d: any) => `${d.code}: ${d.message}`).join("\n"));
    return { exe: r.binaryPath, artifact: readFileSync(join(outDir, backend === "llvm" ? "prog.ll" : "prog.c"), "utf8") };
  } finally {
    if (previous === undefined) delete process.env["SCRIPTC_STACKLESS"];
    else process.env["SCRIPTC_STACKLESS"] = previous;
  }
}

/* RUN ON BOTH BACKENDS. The pin this file carried (`backend: "c"`, twice) was
 * never a statement that the check is C-specific -- it was that only the C
 * emitter had a stackless lowering to check. The LLVM lane grew one at S1, so
 * the lane is a parameter now.
 *
 * THE LLVM LANE COVERS A STRICT SUBSET, and the gap is ASSERTED rather than
 * tolerated: the partition test below fails if a shape leaves the floor AND if
 * one joins it without someone moving the line. The alternative was to narrow
 * the ledger per lane until the work passed it, which is the "green by
 * construction" move: a criterion trimmed to fit. The three tests are split so
 * that one failing cannot hide the others -- vitest stops a test at its first
 * failed expectation, so folding them into one would let the partition's red
 * hide whether the lowered shapes actually work. */
describe.each(["c", "llvm"] as const)("the stackless lane answers what the fiber lane answers (%s)", (lane) => {

  // Built once per lane and shared by the three tests below: each arm is a
  // full compile of a 480-line program, and building them per test would pay
  // for six.
  let on!: Arm, off!: Arm;
  beforeAll(async () => {
    [on, off] = [await buildArm(true, lane), await buildArm(false, lane)];
  }, 600_000);

  test("every await result kind survives the state machine", async () => {

    // THE ARMING CHECK, and it is about the C rather than the path: the two
    // arms get different output directories by construction (the knob is in
    // the cache key), so comparing binary PATHS proves nothing and cannot
    // fail. What has to be true is that the knob reached the emitter.
    expect(off.artifact, "the fiber arm must contain no coroutine lowering")
      .not.toMatch(/scr_coro_(take|finish)_/);
    expect(on.artifact, "the knob did not reach the emitter")
      .toMatch(/scr_coro_finish_/);

    // THE PER-KIND CONTROL. A kind silently dropping off the lane makes the
    // two arms MORE equal, so the output comparison below cannot report it.
    // Each wrapper this LANE is expected to convert must be a converted
    // coroutine in the stackless arm, and the take/finish arm it exercises
    // must be present in the emitted TU.
    //
    // `expectedOnLane` is the ledger for C and the ledger INTERSECTED WITH P
    // for LLVM. The seventy the intersection removes are not dropped: they are
    // the subject of the ledger test below, which fails naming every one.
    const converted = WRAPPERS.filter((w) => expectedOnLane(lane, w));
    // No regex, and that is deliberate: the word-boundary escape this used to
    // carry lost a backslash on its way through a heredoc and became the
    // BACKSPACE character, so the control matched nothing and reported all nine
    // wrappers missing. The emitted spelling needs no escape at all.
    const onLane = (w: { name: string }): boolean => on.artifact.includes(resumeName(w.name));
    expect(converted.filter((w) => !onLane(w)).map((w) => w.name),
      `wrappers this lane (${lane}) must convert and does not -- these kinds are unguarded`).toEqual([]);
    // The take/finish arms are CALL-SITE driven, so the set asserted here is
    // the set the expected wrappers actually exercise. Asserting an arm no
    // expected wrapper uses would claim coverage the lane does not have.
    //
    // THE `take` COLUMN DESCRIBES THE FIBER ARM, and for a hop wrapper that is
    // not what this lane emits: a bare hop carries no operand, so it takes
    // NOTHING on the far side. whn/whs/wha/whu/whv therefore exercise no take
    // arm at all here. The assertions below still hold, because every arm they
    // name is reached by some other floor wrapper -- which is the point: the
    // set is derived from the expected wrappers, so it cannot outrun them.
    for (const arm of new Set(converted.map((w) => `scr_coro_take_${w.take}`))) {
      expect(on.artifact, `${arm} is never emitted -- the kind it carries is unguarded`).toContain(arm);
    }
    for (const arm of new Set(converted.map((w) => `scr_coro_finish_${w.finish}`))) {
      expect(on.artifact, `${arm} is never emitted -- the kind it carries is unguarded`).toContain(arm);
    }

    expect(on.artifact, "the rejection completion is never emitted").toContain("scr_coro_finish_throw");

    // THE HOP, asserted on BOTH lanes. It is the one suspension primitive that
    // is NOT reached through the take/finish dispatches above, so nothing else
    // in this test would notice it going missing -- and a hop that stopped
    // being emitted does not make the program wrong, it makes it answer every
    // value correctly in the wrong NUMBER OF TURNS. That failure is visible
    // only in the `hopord` row below, and only because two coroutines are
    // stepped through it 1:1. This is the cheap structural half of that guard.
    expect(on.artifact, "the microtask hop is never emitted -- the hop shapes are unguarded")
      .toContain("scr_coro_hop");

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
      const offenders: string[] = [];
      for (const [name, body] of resumeBodies(on.artifact, lane)) {
        const fiber = [...new Set(body.match(/scr_await_[a-z0-9_]+/g) ?? [])];
        if (fiber.length > 0) offenders.push(`${name}: ${fiber.join(", ")}`);
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
    // THE LANE GATE ON THIS SCAN, and it is a declared limit rather than an
    // omission. Everything below parses C: `sc_t4 = ...` declarations, brace
    // nesting, `} else {`, and `sc_S1:;` labels. The LLVM lane has none of
    // those spellings -- its temps are SSA `%tN` registers, which cannot even
    // be redefined, so the same defect takes a different form there (a use not
    // dominated by its definition) and needs a different detector. That
    // detector exists and is not this one: the emitter-side cross-park temp
    // invariant in backend/llvm/blocks.ts fails the BUILD, so an LLVM artifact
    // reaching this file has already passed it. Running this C parser over a
    // .ll would match nothing and report a clean sweep -- a counter reading
    // zero mechanically, which is the failure this whole file exists to
    // prevent. Skipped loudly, in one place, with the replacement named.
    if (lane === "c") {
      const nl = String.fromCharCode(10);
      const LABEL = /^\s*sc_S[0-9]+:/;
      const DECL = /^\s*(?:const\s+)?[A-Za-z_][A-Za-z0-9_]*(?:\s*\*)*\s+\*?(sc_[ti][0-9]+)\s*(?:=|;)/;
      const WRITE = /^\s*\*?(sc_[ti][0-9]+)\s*=[^=]/;
      const NAME = /sc_[ti][0-9]+/g;
      const lost: string[] = [];
      for (const b of on.artifact.split(/^(?=[A-Za-z ]*void sc_cr_)/m)) {
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
  }, 600_000);

  /* THE PARTITION -- which shapes this lane converts and which it does not,
   * asserted in BOTH directions and GREEN.
   *
   * WHY A PARTITION AND NOT A STANDING RED. The first version of this test
   * failed on purpose, listing the shapes the LLVM lane does not cover, so
   * that partial coverage could not be read as whole coverage. It did that
   * badly. A permanent red trains every reader to ignore red, and it bills
   * that cost to people who had nothing to do with this slice -- and it is the
   * WEAKER assertion besides, because a red "these 46 are missing" only ever
   * catches one direction, and catches it by being noise.
   *
   * Asserting the partition is strictly stronger. It fails when one of the
   * lowered shapes STOPS converting -- a real regression, which the output
   * comparison cannot see because a dropped conversion makes the two arms MORE
   * equal, not less -- and it fails when one of the not-lowered shapes STARTS
   * converting without someone moving the line deliberately. The second
   * direction is the one a red could never have: a shape joining the lane with
   * no value coverage is exactly how this lowering shipped a wrong answer
   * once, and a test that was already failing would have absorbed it in
   * silence.
   *
   * THE EXHAUSTIVENESS CHECK IS WHAT KEEPS THE TWO LISTS HONEST. Both sides
   * are literal, so nothing stops them drifting apart from the ledger except
   * requiring that together they cover it exactly, with no overlap. That makes
   * a NEW wrapper fail here until it is classified, rather than defaulting
   * into whichever side happens to be derived.
   *
   * WHAT IS NOT ASSERTED, said plainly: the REASON attached to each group.
   * Nothing here can check it -- only the emitter knows why it refused, and
   * asking it would be asking the subject to grade itself. The reasons are
   * documentation, re-derived with SCRIPTC_LLVM_CORO_CENSUS=1, and the
   * grouping exists so the list reads as a worklist rather than a quarantine. */
  test("the partition: exactly these shapes convert on this lane, and exactly those do not", () => {
    const onLane = (name: string): boolean => on.artifact.includes(resumeName(name));
    const ledger = WRAPPERS.filter((w) => w.converted).map((w) => w.name);
    // The C emitter lowers every function the plan admits, so its partition is
    // the whole ledger against nothing; only the LLVM lane has two sides.
    const lowered = lane === "c" ? new Set(ledger) : LLVM_FLOOR;
    const notLowered = lane === "c" ? new Set<string>() : LLVM_NOT_LOWERED;

    // (0) The two sides must TILE the ledger: no name in both, none in
    // neither. Without this a wrapper could be dropped from both lists and
    // every assertion below would still pass.
    expect([...lowered].filter((n) => notLowered.has(n)),
      "these names are on BOTH sides of the partition").toEqual([]);
    expect(ledger.filter((n) => !lowered.has(n) && !notLowered.has(n)),
      "converted wrappers classified on NEITHER side -- a new shape needs a side chosen for it")
      .toEqual([]);
    expect([...lowered, ...notLowered].filter((n) => !ledger.includes(n)),
      "names in the partition that the ledger does not carry as converted").toEqual([]);

    // (1) Everything this lane claims to lower, it lowers.
    expect([...lowered].filter((n) => !onLane(n)).sort(),
      `shapes this lane (${lane}) is recorded as lowering and does NOT -- a regression, and the ` +
        `output comparison cannot report it: a dropped conversion makes the two arms MORE equal`)
      .toEqual([]);

    // (2) Everything it does not claim, it does not lower. This is the
    // direction a standing red could never assert.
    expect([...notLowered].filter((n) => onLane(n)).sort(),
      `shapes this lane (${lane}) now lowers that the partition records as NOT lowered. If a ` +
        `slice widened the admission, move these out of NOT_LOWERED_BY_REASON and into ` +
        `LLVM_FLOOR -- deliberately, in the same commit -- so their value coverage starts ` +
        `counting. Run with SCRIPTC_LLVM_CORO_CENSUS=1 for the emitter's own verdict`)
      .toEqual([]);


    // (4) THE CLOSED SET, over the ARTIFACT rather than over the ledger.
    //
    // Assertions (1) and (2) are both keyed on names the ledger carries, so
    // between them they say nothing about a coroutine that is not a wrapper.
    // `pu` walked through that gap: it began lowering when the nesting
    // condition was deleted, and the only trace was two aggregates
    // disagreeing in a report.
    //
    // This reads every resume function the emitter actually emitted and
    // requires the set to be EXACTLY the floor plus the named non-wrappers.
    // Both directions fail by name, and nothing can enter the lane uncounted
    // -- including a function the ledger has never heard of.
    if (lane === "llvm") {
      const emitted = new Set(
        [...on.artifact.matchAll(/^define [^@]*@sc_cr_([A-Za-z0-9_$.]+)\(/gm)].map((m) => m[1]!),
      );
      const claimed = new Set([...lowered, ...LLVM_FLOOR_NON_WRAPPERS.map(([n]) => n)]);
      expect([...emitted].filter((n) => !claimed.has(n)).sort(),
        `the emitter lowered coroutines NOTHING in this file claims. If they are wrappers, the ` +
          `partition above missed them; if they are not, add them to LLVM_FLOOR_NON_WRAPPERS ` +
          `with the reason their value is covered -- an aggregate count is not a guard`)
        .toEqual([]);
      expect([...claimed].filter((n) => !emitted.has(n)).sort(),
        `claimed as lowered and absent from the artifact -- a dropped conversion, which the ` +
          `output comparison cannot report because it makes the two arms MORE equal`)
        .toEqual([]);
      // And the other side of the back door: a non-wrapper recorded as NOT
      // lowered must not appear.
      //
      // THE LIST IS EMPTY AT THIS BASE, so this expectation cannot fail here
      // -- which is worth saying rather than leaving for a reader to notice.
      // It is not green by construction for ever: it is the only thing that
      // holds a named non-wrapper to ABSENCE, and it earned that when it held
      // `main` through five different first blockers. Its older job was to
      // make raising CORO_SPILL_PASS_CAP move a test; that purchase turned out
      // not to exist (raising the cap to 400 bought nothing -- see the list's
      // own header), so what this guards now is a non-wrapper quietly
      // ENTERING the lane, which assertion (4) above also catches by name.
      expect(LLVM_NOT_LOWERED_NON_WRAPPERS.map(([n]) => n).filter((n) => emitted.has(n)),
        `a non-wrapper recorded as NOT lowered is now lowered. If the pass cap was raised, that ` +
          `is a deliberate purchase and this list is where it gets declared`)
        .toEqual([]);
    }

    // (3) The ledger's own direction, unchanged and still load-bearing on both
    // lanes: a shape the ledger calls NOT converted must not be on either
    // lane. When a slice converts one, the fix is to flip its `converted` to
    // true -- the same edit that switches its real value coverage on.
    expect(WRAPPERS.filter((w) => !w.converted && onLane(w.name)).map((w) => w.name),
      "these shapes now CONVERT -- flip `converted: true` so their coverage counts")
      .toEqual([]);
  });

  test("the stackless lane answers what the fiber lane answers", () => {
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
      // awaitUnion, both arms of all three shapes. wau: pf(1)=2 -> 20 on the
      // promise arm, 5 -> 50 on the unit arm. was: "p!" is 2 chars, "u" is 1.
      // wav pins the void shape, whose unit arm returns no value at all.
      "aunion 20 50 | p!/2 u/1 | pv unit",
      // The value-result awaitUnion, both arms. waun: pf(1)=2 -> "n2" on the
      // park arm, undefined -> "none" on the hop arm. waus: "q!" is 2 chars.
      "aunion2 n2 none | q!/2 none",
      // The loop rows. wln 1+2+3=6. wls "0!1!2!" is 6 chars. wlf
      // pf(0)+pf(10)+pf(20) = 1+11+21 = 33. wld runs twice: 1+2 = 3.
      // wlc keeps the odd results only: 1+3 = 4. wlb stops at 3: 1+2 = 3.
      // wlnest 1+2+11+12 = 26. wlfo stays on fibers and must still answer 5.
      "loop   6 | 0!1!2!/6 | 33 | 3",
      "loop2  4 | 3 | 26 | 5",
      // forOf. wfo1 pf(1)+pf(2)+pf(3) = 2+3+4 = 9. wfo2 "a!b!" is 4 chars.
      // wfo3 pf(10)+pf(20)+pf(20)+pf(40) = 11+21+21+41 = 94. wfo4 keeps the
      // odd results: 3+5 = 8. wfo5 captures x per iteration: (1+2)*10 + (2+3).
      "forof  9 | a!b!/4 | 94 | 8 | 35",
      // The pending return: pf(3)=4 is snapshotted BEFORE the finally writes
      // 999, so 4 is the only correct answer and 999 is the failure.
      "pret   4",
      // Shape (2). wfy1 pf(3)=4 -> "t4". wfy2 answers 7 clean and catches
      // "bad" otherwise. wfy3 awaits in the CATCH body. wfy4 returns THROUGH
      // the finally with the park between snapshot and read. wfy6 awaits
      // INSIDE the finally body and converts as of D4 -- which is what put a
      // park between sc_pret's snapshot and its read for the first time, and
      // sent the slot into the coroutine frame. wfy7 does the same AND
      // returns through it, so its finally body is EMITTED TWICE and the two
      // copies take a state each; `w3` is now the STACKLESS answer on both
      // lanes, and a lowering that resumed into the wrong copy would answer
      // with the finally's own arithmetic instead of the snapshot.
      // fobs tallies the finallys that ran: 1 + 10 + 10 + 100 + 1000, plus
      // wfy7's pf(3)=4.
      "fin    t4 | ok7 c:bad | c!! | 4 | 5 | w3 | 1125",
      // The four statement positions. wif picks a branch on an awaited bool.
      // wrs/wbs store pf(3)=4 and pf(4)=5 through a container evaluated
      // BEFORE the park. wsw resumes inside a case body holding a refcounted
      // local the statement NULL-reset above it. wsd awaits the
      // discriminant, wst awaits a case test.
      "four   yes no | 4 | 5",
      "four2  a!/1 b!/2 d | one two other | t1 td | u!/1 du",
    ];
    for (const line of ASSIGN_LINES) {
      expect(fiber, `the reference arm must already answer: ${line}`).toContain(line);
    }
    expect(run(on.exe), "the stackless lane disagrees with fibers").toEqual(fiber);
    for (const line of ASSIGN_LINES) {
      expect(run(on.exe), `the stackless lane answers the wrong value: ${line}`).toContain(line);
    }
  }, 600_000);

  /* THE CROSS-PARK SLOT ORACLE, over the artifact the arms above already built.
   *
   * WHY IT IS HERE AND NOT A LANE OF ITS OWN. It costs a CFG walk of a module
   * this describe has in memory -- no build, no link, no program -- and it adds
   * no test FILE, so the suite partition is unchanged. A standalone lane over
   * the corpus would buy partition churn and a new flakiness surface for every
   * block, and nothing measured justifies that yet.
   *
   * WHAT IT ADDS OVER THE VALUE COMPARISON ABOVE, which is the honest question
   * to ask of a second guard. Measured on three planted defects:
   *   - a dropped frame local on a scalar read after the park: the value
   *     comparison catches it too, by disagreeing.
   *   - a dropped frame local that is RETAINED after the park: caught too, by
   *     crashing.
   *   - a resume-path reload dropped for a local whose only post-resume reads
   *     are NULL-safe releases: the program exits 0 and prints BYTE-IDENTICAL
   *     output to the fiber arm, every test in this file passes, and only this
   *     oracle reports it. That third one is why it ships.
   * It also LOCATES: it names the function and the slot, where the comparison
   * can only say the lanes disagree.
   *
   * ONLY THE LLVM LANE. The C lane's resume body is a C function whose locals
   * are declarations, not allocas, and this reads LLVM text. */
  if (lane === "llvm") {
    test("no slot is read across a park that did not re-write it", () => {
      const audit = auditModule(on.artifact);

      // THE POPULATION IS ASSERTED FIRST, because a zero population is not a
      // pass. An admission change that stopped lowering these bodies would
      // leave nothing to examine and every expectation below would hold
      // vacuously -- the exact shape this file was built to refuse.
      expect(audit.suspending, "nothing suspending to examine").toBeGreaterThan(0);
      expect(audit.allocasExamined, "no slots to examine").toBeGreaterThan(0);

      // THE CONTROL. This host verifies the IR it is handed at parse, so an
      // artifact that compiled is dominance clean and this must read empty. It
      // is not the product: it proves the CFG reader that produces the result
      // below is reading the right graph.
      expect(audit.ssa, "the CFG reader disagrees with a verifier that accepted this module").toEqual([]);

      expect(audit.slots, "a slot is carried across a park without being carried").toEqual([]);
    }, 600_000);
  }
});
