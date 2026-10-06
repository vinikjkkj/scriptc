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
  // wrl is here as a NEGATIVE entry, and it corrected a mistake in my own
  // measurement. A one-field record literal looks sole-operand to the eye and
  // my arity scan credited 14 points to it, but the scan read the wrong node:
  // a recordLit holds `fields` as entries that carry no `kind`, so the
  // literal itself counts ZERO operands, never becomes transparent, and the
  // await stays nested. The scan had measured the ENTRY, which does have one.
  // The ledger caught it on the first run. It stays as a ledger entry so the
  // shape is named rather than silently absent, and it goes red the day a
  // record literal does start converting.
  { name: "wrl", take: "f64", finish: "ref", converted: false },
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
async function wdr(n: number): Promise<any> { return await pf(n); }
async function wca(n: number): Promise<string> { return wrap1(await pf(n)); }
async function wrl(n: number): Promise<{ v: number }> { return { v: await pf(n) }; }
async function wcs(bad: boolean): Promise<string> {
  try {
    if (bad) throw new Error("sync");
    return "no-throw";
  } catch (e) {
    const y = await ps("recovered");
    return y;
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

    const run = (exe: string): string => execFileSync(exe, [], { encoding: "utf8" });
    const fiber = run(off.exe);
    // The reference arm has to be sane before it can referee: a fiber lane
    // that was itself wrong would make a matching stackless lane look right.
    expect(fiber, "the fiber arm is the reference and must be sane").toContain("bool   true false");
    expect(fiber, "the fiber arm must reach the rejection, not swallow it").toMatch(/rej\s+boom true/);
    expect(fiber, "the fiber arm must run to completion").toContain("done");
    expect(run(on.exe), "the stackless lane disagrees with fibers").toEqual(fiber);
  });
});
