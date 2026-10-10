/* THE ASYNC-GENERATOR REFUSAL, EXERCISED.
 *
 * `ir/liveness.ts` keeps every `async function*` off the stackless lane with
 * a FUNCTION-level gate. Until 2026-10-10 the reason written beside that gate
 * said the yield's `scr_await_hop` was "the one suspender this lane declares
 * it cannot lower" -- a sentence the tree had already contradicted
 * (`async.hop` is on `STACKLESS_LOWERABLE_LIB_CALL_LIST`) and which was wrong
 * in FORM even when it was written, because that hop lives inside
 * `scr_agen_yield_settle` in the runtime and is not an IR node any suspender
 * analysis could see.
 *
 * The reason is now the real one -- the frame-backed generator protocol has
 * no async half -- and it is written at the gate. What this file adds is the
 * part a comment cannot do: it RUNS the refusal.
 *
 * WHY A REFUSAL NEEDS A TEST AT ALL. A refusal that is never exercised is
 * indistinguishable from a refusal that stopped happening. The three ways
 * this one can silently stop being true are all covered here:
 *
 *   1. The gate is deleted or weakened, and an async generator reaches the
 *      stackless lowering. ASSERTED: no frame-backed generator symbol is
 *      emitted for it, on EITHER backend. The two backends refuse by
 *      INDEPENDENT mechanisms -- the C emitter throws a named error from
 *      `emitProgram` if one reaches the plan map, the LLVM backend refuses
 *      every generator in `coroRefusalReason` -- so this file asks both.
 *   2. The refusal starts costing correctness. ASSERTED: the program's output
 *      is compared against NODE, not against the other lane, and the fixture
 *      is written so the comparison can see a TURN-ORDER defect and not only
 *      a value defect. JS's `AsyncGeneratorYield` awaits its operand, which
 *      is one microtask turn per yield; a stackless yield charges zero (see
 *      emit-gen-coro.ts). That is the fourth missing piece at the gate, and
 *      it is the one that would NOT show up as a crash.
 *   3. The test goes green BY CONSTRUCTION because nothing in the program
 *      was ever on the stackless lane. ASSERTED FIRST, before anything else:
 *      the same build must convert the plain `async` function that sits
 *      beside the generator. A zero conversion count is only a measurement
 *      once something was measured -- `generator-lane-parity.test.ts` wasted
 *      its first run on exactly this and says so at length.
 *
 * THE PLANTED REDS, each run before this file was committed, each with the
 * message it produced. "Could this check have come out red?" is asked of
 * every assertion here, and answered by doing it.
 *
 *   A. Delete `if (fn.generator !== undefined && fn.async === true) return
 *      null;` from `ir/liveness.ts`. C LANE, BOTH FIXTURES RED on the first
 *      assertion: "build: BUILD FAILED [threw: emitter bug: async generator
 *      nums entered the stackless plan map. This lowering is written for
 *      SYNCHRONOUS generators only -- no microtask hop, no settle thunk, no
 *      request promise...]". LLVM LANE STAYS GREEN -- `coroRefusalReason`
 *      refuses every generator on its own, so that deletion alone cannot
 *      colour the LLVM arms. Recorded rather than left unknown.
 *   A2. A, PLUS deleting `if (fn.generator !== undefined) return "generator";`
 *      from `backend/llvm/coro.ts`. The `llvm: yielding` arm STILL passes --
 *      `yieldExpr` is on LLVM_UNLOWERABLE_POINT_KIND_LIST, so the point-kind
 *      list catches that shape. The `llvm: NO yield point` arm goes RED, and
 *      the way it goes red is the point of this whole pair: the emitted .ll
 *      does not assemble --
 *        anllvm.ll:298:46: error: base element of getelementptr must be sized
 *          %t8 = getelementptr inbounds %sc_cf_empty, ptr %sc_b, i64 0, i32 1
 *      A frame type with no body, for a generator the point-kind list cannot
 *      see. That is why the gate is at FUNCTION level on BOTH backends.
 *   B. Pin `SCRIPTC_STACKLESS=0` in `build` instead of `1`. ALL FOUR ARMS RED
 *      on the non-vacuity assertion: "the plain async function did NOT
 *      convert: ... resumes=[] ...: expected '' to contain 'sc_cr_plain'".
 *      Note what else that run showed: STDOUT STILL MATCHED NODE. The output
 *      comparison alone would have reported success over a build in which
 *      nothing was on the lane at all, which is why non-vacuity is asserted
 *      FIRST.
 *   C. Set NODE_SRC to the interleave a lowering that DROPPED the yield's hop
 *      would print -- two plain turns per generator iteration instead of
 *      three. BOTH `yielding` ARMS RED: "output differs from node: ...
 *      stdout=\"p=42\\nt0\\nt1\\nt2\\nv=0\\n...\"". So this file can see a
 *      TURN-COUNT defect and not merely a value defect, which is the one
 *      failure mode in the list at the gate that never crashes.
 *
 * THE SECOND FIXTURE HAS NO `yield` IN IT, and that is the whole reason the
 * gate cannot move to the point level: an `async function*` is legal with no
 * `yield` at all, and its plan then holds `[awaitExpr]` and no `yieldExpr`.
 * Measured 2026-10-10. No point-kind list can see that shape. */
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const execFileAsync = promisify(execFile);
const NL = String.fromCharCode(10);
const sanitize = process.env["SCRIPTC_SANITIZE"] === "1";

/* Anchored on tokens the PROSE of an emitted file cannot contain: the
 * definition's opening paren and brace. A comment is a reference to every
 * text scanner, and this front has been bitten by a count that matched one. */
const C_RESUME_DEF =
  /void[ ]+sc_cr_[A-Za-z0-9_]+[(]ScrCoroBase[ ]*[*][ ]*[A-Za-z0-9_]+[)][ ]*[{]/g;
const LL_RESUME_DEF = /define[ ]+internal[ ]+void[ ]+@sc_cr_[A-Za-z0-9_$.]+[(]/g;

interface Built {
  readonly ok: boolean;
  readonly diag: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number | string;
  /** Emitted translation units found. ZERO IS NOT A MEASUREMENT: it means
   * the lane produced nothing to read, which is a different fact from
   * "nothing converted" and must never share its 0. */
  readonly units: number;
  /** Names of the coroutine resume functions actually defined. */
  readonly resumes: readonly string[];
  /** The whole emitted artifact, for symbol-level questions. */
  readonly artifact: string;
}

function scan(outDir: string): { units: number; resumes: string[]; artifact: string } {
  let units = 0;
  const resumes: string[] = [];
  let artifact = "";
  for (const f of readdirSync(outDir)) {
    const isC = f.endsWith(".c") || f.endsWith(".scrh");
    const isLl = f.endsWith(".ll");
    if (!isC && !isLl) continue;
    units++;
    const text = readFileSync(join(outDir, f), "utf8");
    artifact += text;
    const re = isLl ? LL_RESUME_DEF : C_RESUME_DEF;
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) resumes.push(m[0]);
  }
  return { units, resumes, artifact };
}

/** Build and run, THROWING NOTHING: a compile refusal is data here, because
 * one of the declared reds IS a refused build. */
async function build(stem: string, src: string, backend: "c" | "llvm"): Promise<Built> {
  const dir = mkdtempSync(join(process.env["TMP"] ?? process.env["TMPDIR"] ?? ".", "agenref-" + stem + "-"));
  const entry = join(dir, stem + ".ts");
  writeFileSync(entry, src);
  const dead = (diag: string): Built => ({
    ok: false, diag, stdout: "", stderr: "", code: -1, units: -1, resumes: [], artifact: "",
  });
  const saved = process.env["SCRIPTC_STACKLESS"];
  /* THE LANE IS PINNED ON, not left to the default. The default flipped to ON
   * on 2026-10-09 and could flip again; a file whose subject is "what the
   * stackless lane does with this shape" must not be able to measure the
   * fiber lane by accident and report agreement. */
  process.env["SCRIPTC_STACKLESS"] = "1";
  try {
    let result: Awaited<ReturnType<typeof compile>>;
    try {
      result = await compile(entry, { outPath: join(dir, exeName(stem)), outDir: dir, sanitize, backend });
    } catch (e) {
      return dead("threw: " + String((e as Error).message ?? e).slice(0, 900));
    }
    if (!result.ok) return dead(JSON.stringify(result.diagnostics ?? []).slice(0, 900));
    const s = scan(dir);
    try {
      const r = await execFileAsync(result.binaryPath, [], { encoding: "utf8", timeout: 180_000 });
      return { ok: true, diag: "", stdout: r.stdout, stderr: r.stderr, code: 0, ...s };
    } catch (e) {
      const x = e as { stdout?: string; stderr?: string; code?: number; signal?: string };
      return {
        ok: true, diag: "", stdout: x.stdout ?? "", stderr: x.stderr ?? "",
        code: x.signal ?? x.code ?? -1, ...s,
      };
    }
  } finally {
    if (saved === undefined) delete process.env["SCRIPTC_STACKLESS"];
    else process.env["SCRIPTC_STACKLESS"] = saved;
  }
}

function say(label: string, b: Built): string {
  if (!b.ok) return label + ": BUILD FAILED [" + b.diag + "]";
  return label + ": exit=" + String(b.code) + " units=" + String(b.units) +
    " resumes=" + JSON.stringify(b.resumes) +
    " stdout=" + JSON.stringify(b.stdout) + " stderr=" + JSON.stringify(b.stderr.slice(0, 400));
}

/* THE FIXTURE INTERLEAVES A SECOND CHAIN WITH THE GENERATOR ON PURPOSE.
 *
 * `tick()` resolves a chain of plain microtasks alongside the `for await`, so
 * the printed ORDER encodes how many turns each `yield` costs. With the
 * generator on the fiber lane the order matches Node; a lowering that dropped
 * the yield's hop would print the same VALUES in a different ORDER, and a
 * value-only comparison would stay green against it. That defect is item 4 of
 * the list at the gate, and it is the only one of the four that does not
 * announce itself with a crash.
 *
 * `plain` is the NON-VACUITY ANCHOR: an ordinary async function with a
 * straight-line await, which this lane does convert. The first assertion of
 * every arm is that `sc_cr_plain` is in the artifact. */
const SRC = [
  "async function* nums(): AsyncGenerator<number, void, undefined> {",
  "  let i = 0;",
  "  while (i < 3) {",
  "    await Promise.resolve();",
  "    yield i;",
  "    i = i + 1;",
  "  }",
  "}",
  "async function plain(a: number): Promise<number> {",
  "  const v = await Promise.resolve(a);",
  "  return v + 1;",
  "}",
  "async function tick(): Promise<void> {",
  "  let n = 0;",
  "  while (n < 8) {",
  "    await Promise.resolve();",
  "    console.log('t' + String(n));",
  "    n = n + 1;",
  "  }",
  "}",
  "async function main(): Promise<void> {",
  "  console.log('p=' + String(await plain(41)));",
  "  const t = tick();",
  "  for await (const v of nums()) { console.log('v=' + String(v)); }",
  "  console.log('gen-done');",
  "  await t;",
  "  console.log('done');",
  "}",
  "void main();",
].join(NL) + NL;

/* An `async function*` with NO yield: legal JS, and its plan holds
 * `[awaitExpr]` with no `yieldExpr` anywhere. It is here to pin that the gate
 * must stay at FUNCTION level -- a point-kind list cannot refuse this. */
const SRC_NOYIELD = [
  "async function* empty(): AsyncGenerator<number, void, undefined> {",
  "  await Promise.resolve();",
  "  return;",
  "}",
  "async function plain(a: number): Promise<number> {",
  "  const v = await Promise.resolve(a);",
  "  return v + 1;",
  "}",
  "async function main(): Promise<void> {",
  "  console.log('p=' + String(await plain(41)));",
  "  let n = 0;",
  "  for await (const v of empty()) { n = n + v; }",
  "  console.log('n=' + String(n));",
  "}",
  "void main();",
].join(NL) + NL;

/** What Node prints for SRC. NOT A GUESS, and the distinction earned its
 * place: the interleave predicted from reading the lowering was
 * `t0 t1 | v=0 | t2 t3 | v=1`, and the oracle prints `t0 t1 t2 | v=0 |
 * t3 t4 t5 | v=1` -- THREE plain turns per generator iteration, not two.
 * Produced by running this exact fixture under node v25.9.0 (the gate's
 * node) and cross-checked identical on v22.18.0, so the expectation is not
 * hostage to which node is first on PATH.
 *
 * The three turns are the body's own `await`, the `AsyncGeneratorYield` hop
 * that `scr_agen_yield_settle` takes, and the consumer's await of the
 * request promise. A lowering that dropped the middle one would print these
 * same VALUES with `v=` one line earlier each time. */
const NODE_SRC = [
  "p=42", "t0", "t1", "t2", "v=0", "t3", "t4", "t5", "v=1", "t6", "t7", "v=2",
  "gen-done", "done",
].join(NL) + NL;

const NODE_NOYIELD = ["p=42", "n=0"].join(NL) + NL;

/** The generator's own frame-backed spawn. If an async generator ever DID
 * take the stackless lowering, this is the symbol that would appear. */
function genLowered(b: Built): boolean {
  return b.artifact.includes("scr_gen_of_coro") || b.artifact.includes("scr_gen_coro_alloc");
}

describe("an async generator stays off the stackless lane, and the program is still right", () => {
  for (const backend of ["c", "llvm"] as const) {
    test(backend + ": yielding async generator", async () => {
      const b = await build("ag" + backend, SRC, backend);
      expect(b.ok, say("build", b)).toBe(true);
      // NON-VACUITY FIRST. Everything below is meaningless if this lane
      // converted nothing in this program.
      expect(b.units, say("no artifact to read -- this is not a zero conversion count", b))
        .toBeGreaterThan(0);
      expect(b.resumes.join(" "), say("the plain async function did NOT convert", b))
        .toContain("sc_cr_plain");
      // THE REFUSAL.
      expect(b.resumes.join(" "), say("an async generator was LOWERED", b)).not.toContain("sc_cr_nums");
      expect(genLowered(b), say("a frame-backed generator was spawned", b)).toBe(false);
      // AND IT IS STILL RIGHT, against NODE -- values and turn order.
      expect(b.code, say("binary died", b)).toBe(0);
      expect(b.stdout, say("output differs from node", b)).toBe(NODE_SRC);
    }, 900_000);

    test(backend + ": async generator with NO yield point", async () => {
      const b = await build("an" + backend, SRC_NOYIELD, backend);
      expect(b.ok, say("build", b)).toBe(true);
      expect(b.units, say("no artifact to read", b)).toBeGreaterThan(0);
      expect(b.resumes.join(" "), say("the plain async function did NOT convert", b))
        .toContain("sc_cr_plain");
      expect(b.resumes.join(" "), say("a yieldless async generator was LOWERED", b))
        .not.toContain("sc_cr_empty");
      expect(genLowered(b), say("a frame-backed generator was spawned", b)).toBe(false);
      expect(b.code, say("binary died", b)).toBe(0);
      expect(b.stdout, say("output differs from node", b)).toBe(NODE_NOYIELD);
    }, 900_000);
  }
});
