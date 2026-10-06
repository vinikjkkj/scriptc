/* THE CROSS-LANE GUARD FOR GENERATOR CHANNELS -- values AND lifecycle.
 *
 * Written BEFORE the synchronous-generator lowering exists, deliberately.
 * The defect this front has paid most for is a value that silently takes
 * the wrong type arm while every gate stays green, and a guard installed
 * after the shapes is a guard whose first run is also the first run of the
 * thing it guards -- so a green says nothing about either.
 *
 * THE INSTRUMENT HAS FOUR PARTS AND ONLY ONE OF THEM IS THE COMPARISON.
 *
 *   1. VALUE PARITY -- the same program built knob-absent and knob-on must
 *      print byte-identical output, for every arm of the yield channel.
 *   2. CONVERSION ACCOUNTING -- how many coroutine resume functions the
 *      knob-on build actually emitted, read out of the EMITTED C. This is
 *      what says whether part 1 means anything: if nothing converted, the
 *      two lanes are the same code and parity is vacuous.
 *   3. LIFECYCLE PARITY -- the same comparison over the EXCEPTIONAL and
 *      TEARDOWN paths, which part 1 never reaches. Added after an audit
 *      found four defects and observed that a program consuming a
 *      generator to exhaustion -- which is all parts 1 and 2 did -- would
 *      have gone GREEN against three of them. See the table below.
 *   4. THE POISON CONTROL -- the same comparison, with a wrong arm injected
 *      into the knob-on build, must come out DIFFERENT. This is what says
 *      part 1 can see a value defect at all.
 *
 * Part 2 is the one usually missing, and its absence is how a cross-lane
 * test reports agreement between a lane and itself. Part 4 is the one that
 * cannot be inferred from a passing run, which is why it is a test and not
 * a comment. PART 3 EXISTS BECAUSE PARTS 1, 2 AND 4 WERE ALL GREEN BY
 * CONSTRUCTION AGAINST A WHOLE CLASS: every program they build consumes its
 * generator to exhaustion with no .throw(), no .return(), no escaping
 * exception and no AsyncLocalStorage.
 *
 * WHAT EACH PART-3 ARM REPROVES, DECLARED BEFORE THE FIRST RUN. If an arm
 * cannot be made to go red by reverting the fix it covers, it is not
 * coverage, it is decoration -- so each names the revert and the colour.
 *
 *   genret    .return(v) INTO A STARTED generator. Reaches emitUnwind with
 *             the GENRET sentinel pending. REVERT A (emitter.ts dispatches
 *             coroUnwind instead of genCoroUnwind): scr_coro_finish_throw
 *             rejects a NULL base->promise -- the knob-on binary DIES, exit
 *             non-zero. REVERT B (drop the genret half of
 *             scr_gen_coro_finish_throw): no crash, the sentinel is never
 *             consumed and the parked value never promoted, so r.value is
 *             WRONG -- a value red, which is the stronger of the two. The
 *             VALUE is asserted, not merely `done`: a lowering that answers
 *             done:true with no value passes a done-only check.
 *   genthrow  .throw(e) into a started generator. Same emitter site as
 *             genret, reached by a DIFFERENT source path -- the pending
 *             check emitted after the yield. Revert A: dies.
 *   bodythrow an exception escaping the converted body. Third path to the
 *             same site, this one from the `throw` statement's own
 *             emitUnwind rather than from a pending check. Revert A: dies.
 *   nextval   the .next(v) argument read back inside the body. The only arm
 *             that emits a take_in at all: with an `undefined` next channel
 *             the yield result is void and NO take_in is emitted, which is
 *             why the three value arms above could never see this. Revert:
 *             emit scr_gen_take_in_f64() (the fibre twin, anchored on
 *             scr_current->gen) and the consumer on the main stack aborts
 *             with "yield outside a generator". bodythrow covers the
 *             REF arm of the same entry point for free: its next channel
 *             is `unknown`, so the yield result is a dyn and take_in_ref
 *             is emitted there.
 *   als       a generator created inside an AsyncLocalStorage context and
 *             released. THE ONLY ONE OF THE FOUR THAT LEAKS IN SILENCE, and
 *             it reads ZERO in any program that does not use ALS -- so
 *             without this arm the defect is invisible by construction.
 *             Built with SCRIPTC_RC_AUDIT=1, which is the observation:
 *             scr_coro_init retains the spawner's ALS context and the
 *             generator lane frees its frame directly, so a raw free()
 *             strands the context and every dyn value in it. Revert (plain
 *             free() instead of scr_gen_coro_frame_free): "scriptc RC AUDIT
 *             FAILED ... dyn value(s) ... live at exit" and exit 99.
 *   collide   two locals whose frame-field names collide under a weaker
 *             sanitiser than mangleLocal's -- `a$b` and `a_b`, both legal
 *             JS and both ordinary in bundled code. This one fails HIGH
 *             (duplicate struct member), but only inside an ADMITTED
 *             function, which is why it stayed invisible while admission
 *             was narrow. Revert (coroField collapsing every
 *             non-alphanumeric to `_`): the knob-on BUILD fails.
 *
 * ONLY THE als ARM BUILDS UNDER THE RC AUDIT. For the others the
 * observation is stdout and the exit code, and an audit build is -O1 with
 * a different code path; running them all under it would widen this guard
 * into a general leak hunt whose first unrelated red would be read as one
 * of these four. Deliberate, not overlooked.
 *
 * PART 1 WAS VACUOUS UNTIL THIS SLICE AND PART 2 SAID SO IN A NUMBER.
 * stacklessPlan used to refuse every generator -- fn.async !== true caught
 * the synchronous ones before the generator gate ever ran -- so
 * EXPECTED_CONVERSIONS was 0 and both lanes emitted the same fiber
 * lowering. The admission gates are now open and the number is 1, so the
 * comparison is between two different lowerings for the first time. Part 4
 * was live even before that, because the poison perturbs the fibre lowering
 * both lanes shared -- which is how the guard was proved able to see a wrong
 * arm before there was a second lane to compare.
 *
 * Source strings join on String.fromCharCode(10) rather than carrying an
 * escape. Escapes crossing a second parse layer were eaten eight times in
 * one day on this front, once planting a control byte into a deliverable;
 * removing the surface beats getting it right once.
 *
 * NOT EXECUTED AT THE TIME OF WRITING. Every expectation below is derived,
 * and the commit that first runs it must say so and move whatever
 * disagrees.
 */
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";
/* Imported by PATH, not through the package index: the index is held by
 * another branch in the current aggregate, and a guard must not require an
 * edit to a file it does not own. tests/harness/cc.ts reaches into the
 * compiler the same way. */
import {
  assertGenPoisonEngaged,
  genPoisonSites,
  resetGenPoison,
} from "../../packages/compiler/src/backend/emission/gen-poison.js";

const execFileAsync = promisify(execFile);
const sanitize = process.env["SCRIPTC_SAN"] === "1";
const NL = String.fromCharCode(10);

/** Generator resume functions the knob-on build must emit, per program.
 *
 * DERIVED, NOT YET MEASURED. Every program below defines exactly one
 * synchronous generator and no async function, and a converted generator
 * emits exactly one resume function, so the count is 1. Top-level code --
 * the for-of, the try/catch, the ALS callback -- is ordinary synchronous
 * code and converts nothing.
 *
 * It was 0 until the admission gates opened in this same slice, and a 0
 * here now would mean NOTHING CONVERTED -- which is the first signal to
 * read, not the last. If the first real run disagrees with 1, the number
 * moves and the commit says which way and why; it is a prediction from
 * reading the emitter, and predictions from reading have been wrong twice
 * in this slice already.
 *
 * Do not relax it into an inequality. An exact count is what turns "some
 * generators converted" into "these did", and a range would hide one that
 * stopped converting. */
const EXPECTED_CONVERSIONS = 1;

/** One program per arm of the yield channel. Each prints every value it
 * yields, so a wrong arm changes stdout rather than merely the C. */
const ARMS: readonly { name: string; scalar: boolean; src: string }[] = [
  {
    name: "f64",
    scalar: true,
    src: [
      "function* nums(): Generator<number, number, undefined> {",
      "  yield 1.5",
      "  yield 0",
      "  yield -2.25",
      "  return 0",
      "}",
      "for (const v of nums()) console.log(v)",
      "",
    ].join(NL),
  },
  {
    name: "bool",
    scalar: true,
    src: [
      "function* flags(): Generator<boolean, number, undefined> {",
      "  yield true",
      "  yield false",
      "  yield true",
      "  return 0",
      "}",
      "for (const v of flags()) console.log(v)",
      "",
    ].join(NL),
  },
  {
    name: "ref",
    scalar: false,
    src: [
      "function* words(): Generator<string, number, undefined> {",
      '  yield "alpha"',
      '  yield ""',
      '  yield "omega"',
      "  return 0",
      "}",
      "for (const v of words()) console.log(v)",
      "",
    ].join(NL),
  },
];

/** PART 3. One program per lifecycle path parts 1, 2 and 4 cannot reach.
 * `audit` turns on SCRIPTC_RC_AUDIT for both lanes, which is the
 * observation for the als arm and only for it. */
const BEHAVIOURS: readonly { name: string; audit: boolean; src: string }[] = [
  {
    /* .return(v) INTO A STARTED generator: the GENRET promotion. The value
     * is printed, not just `done` -- a lowering that completes with no
     * value answers done:true and would pass a done-only assertion. */
    name: "genret",
    audit: false,
    src: [
      "function* nums(): Generator<number, number, undefined> {",
      "  yield 1",
      "  yield 2",
      "  return 0",
      "}",
      "const g = nums()",
      "console.log(g.next().value as number)",
      "const r = g.return(99)",
      "console.log(r.done === true, r.value as number)",
      "console.log(g.next().done === true)",
      "",
    ].join(NL),
  },
  {
    /* .throw() into a started generator: the same emitter site reached
     * through the pending check emitted after a yield. */
    name: "genthrow",
    audit: false,
    src: [
      "function* nums(): Generator<number, number, undefined> {",
      "  yield 1",
      "  yield 2",
      "  return 0",
      "}",
      "const g = nums()",
      "console.log(g.next().value as number)",
      "try {",
      '  g.throw(new Error("boom"))',
      '  console.log("NOT REACHED")',
      "} catch (e) {",
      '  if (e instanceof Error) console.log("propagated", e.message)',
      "}",
      "console.log(g.next().done === true)",
      "",
    ].join(NL),
  },
  {
    /* An exception escaping the converted body: the third path to the same
     * site, from the `throw` statement's own emitUnwind. */
    name: "bodythrow",
    audit: false,
    src: [
      "function* nums(): Generator<number, void, unknown> {",
      "  yield 1",
      '  throw new Error("body")',
      "}",
      "const g = nums()",
      "console.log(g.next().value as number)",
      "try {",
      "  g.next()",
      '  console.log("NOT REACHED")',
      "} catch (e) {",
      '  if (e instanceof Error) console.log("bodyerr", e.message)',
      "}",
      "console.log(g.next().done === true)",
      "",
    ].join(NL),
  },
  {
    /* The .next(v) argument read back INSIDE the body. The next channel is
     * `number` and not `undefined` on purpose: a void next channel emits no
     * take_in at all, which is why every arm above is blind to it. */
    name: "nextval",
    audit: false,
    src: [
      "function* echo(): Generator<number, number, number> {",
      "  const a = yield 1",
      "  console.log(a)",
      "  const b = yield 2",
      "  console.log(b)",
      "  return 0",
      "}",
      "const g = echo()",
      "console.log(g.next(0).value as number)",
      "console.log(g.next(7).value as number)",
      "console.log(g.next(8).done === true)",
      "",
    ].join(NL),
  },
  {
    /* A generator born inside an ALS context and released. The RC audit is
     * the observation: the frame retains the context at scr_coro_init and
     * the generator lane frees the frame directly. */
    name: "als",
    audit: true,
    src: [
      'import { AsyncLocalStorage } from "node:async_hooks"',
      "function* nums(): Generator<number, number, undefined> {",
      "  yield 1",
      "  yield 2",
      "  return 0",
      "}",
      "const als = new AsyncLocalStorage<string>()",
      'const out = als.run("gen-ctx", (): string => {',
      "  for (const v of nums()) console.log(v)",
      '  return als.getStore() ?? "none"',
      "})",
      "console.log(out)",
      "",
    ].join(NL),
  },
  {
    /* Two locals that collide under a weaker sanitiser than mangleLocal's.
     * Both are strings (refcounted, so both enter the frame whatever
     * liveness says) and both are read after a yield, so neither can be
     * folded away. */
    name: "collide",
    audit: false,
    src: [
      "function* pair(seed: string): Generator<string, number, undefined> {",
      '  const a$b = seed + "-dollar"',
      '  const a_b = seed + "-under"',
      "  yield a$b",
      "  yield a_b",
      "  yield a$b + a_b",
      "  return 0",
      "}",
      'for (const v of pair("s")) console.log(v)',
      "",
    ].join(NL),
  },
];

interface Built {
  readonly ok: boolean;
  readonly diag: string;
  readonly stdout: string;
  readonly stderr: string;
  /** 0 on a clean exit; the exit code, or a signal name, otherwise. */
  readonly code: number | string;
  /** Emitted C translation units. Zero means the C lane never ran, which is
   * a different fact from "nothing converted" and must not share its 0. */
  readonly units: number;
  readonly conversions: number;
  readonly sites: number;
}

/** Count coroutine resume functions in the EMITTED C, not in the IR and not
 * from the environment variable. Reading the knob would assert what was
 * asked for rather than what was obtained, which is the distinction this
 * whole file is built on.
 *
 * IT RETURNS THE UNIT COUNT TOO, and that is the fix for how this file
 * wasted its first run. The conversion count was a bare number, and it read
 * 0 for "no generator converted" AND for "there is no C here to read" --
 * which is what actually happened: the builds below did not pin the
 * backend, the default is LLVM, and the whole run compared the LLVM lane
 * against itself while every arm printed the right answer and exited 0.
 * Nine greens would have been reported as the slice working.
 *
 * A zero is only a measurement once something was measured. So the arms
 * assert that units are greater than zero BEFORE they look at resumes, and
 * the message says which of the two zeroes it is. */
interface CScan {
  /** Emitted C translation units (and the shared header) found in outDir. */
  readonly units: number;
  /** Coroutine resume functions defined across them. */
  readonly resumes: number;
}

/* DEFINITIONS ONLY -- the trailing brace is required and is not cosmetic.
 *
 * A resume function is emitted TWICE per converted generator: a forward
 * declaration into the prototype block (emit-coro.ts, so a split program's
 * header can bridge it) and the definition itself. Measured, after this
 * file's second run reported 2 against an expectation of 1 and the artefact
 * showed one generator, one resume function, two mentions:
 *
 *     static void sc_cr_nums(ScrCoroBase *sc_b);
 *     static void sc_cr_nums(ScrCoroBase *sc_b) {
 *
 * EXPECTED_CONVERSIONS = 1 was right and the counter was wrong, which is
 * the opposite of what a bare "2 != 1" suggests -- section 6 reads a count
 * above 1 as "I misread what one program emits", and the misreading was in
 * the instrument. coro-symbol-collect.ts had already hit this and says so
 * in its own comment; this file was written without that line.
 *
 * Spelled with [(] rather than an escape, the way that file spells it: an
 * escape crossing a second parse layer has been eaten eight times on this
 * front, and removing the surface beats getting it right once. */
const RESUME_DEF =
  /void[ ]+sc_cr_[A-Za-z0-9_]+[(]ScrCoroBase[ ]*[*][ ]*[A-Za-z0-9_]+[)][ ]*[{]/g;

function scanEmittedC(outDir: string): CScan {
  let units = 0;
  let resumes = 0;
  for (const f of readdirSync(outDir)) {
    if (!f.endsWith(".c") && !f.endsWith(".scrh")) continue;
    units++;
    const text = readFileSync(join(outDir, f), "utf8");
    RESUME_DEF.lastIndex = 0;
    for (const m of text.matchAll(RESUME_DEF)) {
      void m;
      resumes++;
    }
  }
  return { units, resumes };
}

/** A one-line account of a build+run, for an assertion message.
 *
 * Every red this file can produce is one of: the build refused, the binary
 * died, or the bytes differed. A message that does not say WHICH sends the
 * reader to the wrong file, and four of the six lifecycle arms have a
 * crash or a refused build as their declared red. */
function say(label: string, b: Built): string {
  if (!b.ok) return label + ": BUILD FAILED [" + b.diag + "]";
  return (
    label + ": exit=" + String(b.code) +
    " cUnits=" + String(b.units) +
    " conversions=" + String(b.conversions) +
    " stdout=" + JSON.stringify(b.stdout) +
    " stderr=" + JSON.stringify(b.stderr.slice(0, 600))
  );
}

/** Build and run, SWALLOWING NOTHING AND THROWING NOTHING. A compile
 * refusal and a dead binary are both legitimate observations here -- four
 * arms declare one or the other as their red -- so they come back as data
 * and the arm decides. The previous version asserted result.ok inside this
 * helper, which would have turned the collide arm's declared red into an
 * exception raised from the wrong stack frame. */
async function build(
  stem: string,
  src: string,
  env: Record<string, string | undefined>,
): Promise<Built> {
  const dir = mkdtempSync(join(tmpdir(), "scriptc-genparity-" + stem + "-"));
  const entry = join(dir, stem + ".ts");
  writeFileSync(entry, src);
  /* Per-build, because the site counter is process-global and a second
   * build in the same process would otherwise inherit the first one's
   * count -- the assertion would then pass on evidence from the wrong
   * build, which is the exact shape it exists to prevent. */
  resetGenPoison();
  const saved = new Map<string, string | undefined>();
  for (const [k, v] of Object.entries(env)) {
    saved.set(k, process.env[k]);
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const dead = (diag: string): Built => ({
    ok: false, diag, stdout: "", stderr: "", code: -1, units: -1, conversions: -1, sites: 0,
  });
  try {
    let result: Awaited<ReturnType<typeof compile>>;
    try {
      result = await compile(entry, {
        outPath: join(dir, exeName(stem)),
        outDir: dir,
        sanitize,
        /* THE C LANE, PINNED, and the first run of this file is why.
         *
         * The CLI default backend is LLVM, and the stackless lowering is
         * consulted in zero of that lane's ten files -- index.ts gates it
         * on backend === "c". Without these two options both lanes compiled
         * through LLVM, so the knob changed nothing, the programs printed
         * the right answers, every binary exited 0, and the comparison
         * reported agreement between a lane and itself.
         *
         * keepC as well as backend: the count below reads the emitted C off
         * the disk, and a swept TU is indistinguishable from a TU with no
         * coroutine in it. stackless-values.test.ts -- the one guard on this
         * front that had actually been run before today -- passes both, and
         * copying a working rig beats rediscovering why it has two flags. */
        backend: "c",
        keepC: true,
      });
    } catch (e) {
      /* A C-compiler refusal arrives as a thrown CcCompileError, not as a
       * diagnostic list, and the collide arm's red is exactly that. */
      return dead("threw: " + String((e as Error).message ?? e).slice(0, 600));
    }
    if (!result.ok) return dead(JSON.stringify(result.diagnostics ?? []).slice(0, 600));
    /* Refuses BY NAME if a poison was requested and injected nothing. */
    assertGenPoisonEngaged();
    const scan = scanEmittedC(dir);
    const conversions = scan.resumes;
    const units = scan.units;
    const sites = genPoisonSites();
    try {
      const r = await execFileAsync(result.binaryPath, [], { encoding: "utf8", timeout: 120_000 });
      return { ok: true, diag: "", stdout: r.stdout, stderr: r.stderr, code: 0, units, conversions, sites };
    } catch (e) {
      const x = e as { stdout?: string; stderr?: string; code?: number; signal?: string };
      return {
        ok: true,
        diag: "",
        stdout: x.stdout ?? "",
        stderr: x.stderr ?? "",
        code: x.signal ?? x.code ?? -1,
        units,
        conversions,
        sites,
      };
    }
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const OFF = { SCRIPTC_STACKLESS: undefined, SCRIPTC_GEN_VALUE_POISON: undefined };
const ON = { SCRIPTC_STACKLESS: "1", SCRIPTC_GEN_VALUE_POISON: undefined };
const OFF_AUDIT = { ...OFF, SCRIPTC_RC_AUDIT: "1" };
const ON_AUDIT = { ...ON, SCRIPTC_RC_AUDIT: "1" };

/** The audit's failure line. Its presence is the leak; scr_console.c exits
 * 99 after printing it, so the exit code is asserted too -- a line that
 * stopped being printed while the exit stayed would otherwise read clean. */
const AUDIT_FAILED = "scriptc RC AUDIT FAILED";

describe("generator channel: the two lanes agree on every value", () => {
  for (const arm of ARMS) {
    test(
      arm.name + " yields are identical knob-absent and knob-on",
      async () => {
        const off = await build(arm.name + "-off", arm.src, OFF);
        const on = await build(arm.name + "-on", arm.src, ON);
        expect(off.ok, say("off", off)).toBe(true);
        expect(on.ok, say("on", on)).toBe(true);
        expect(off.code, say("off", off)).toBe(0);
        expect(on.code, say("on", on)).toBe(0);

        /* THE LANE, before anything derived from it. A zero conversion
         * count means "no generator converted" only once a C unit was read;
         * with no unit at all it means the C lane never ran, and that is the
         * reading this file shipped its first run on. */
        expect(off.units, "no emitted C on the OFF lane -- " + say("off", off)).toBeGreaterThan(0);
        expect(on.units, "no emitted C on the ON lane -- " + say("on", on)).toBeGreaterThan(0);

        /* PART 1: the comparison. */
        expect(on.stdout, say("on", on) + " | " + say("off", off)).toBe(off.stdout);

        /* PART 2: and what it is worth. A knob-absent build must never
         * carry a coroutine frame; a knob-on build carries exactly as many
         * as the declared expectation. The second number is what tells a
         * reader whether part 1 compared two lanes or one lane with
         * itself. */
        expect(off.conversions, say("off", off)).toBe(0);
        expect(on.conversions, say("on", on)).toBe(EXPECTED_CONVERSIONS);
      },
      300_000,
    );
  }
});

describe("generator lifecycle: the two lanes agree where parts 1-2 never looked", () => {
  for (const b of BEHAVIOURS) {
    test(
      b.name + " behaves identically knob-absent and knob-on",
      async () => {
        const off = await build(b.name + "-off", b.src, b.audit ? OFF_AUDIT : OFF);
        const on = await build(b.name + "-on", b.src, b.audit ? ON_AUDIT : ON);

        /* THE BUILD, asserted on both lanes and named. The collide arm's
         * declared red is the knob-on build refusing; without this it would
         * surface as a stdout mismatch of "" against the real output and
         * send the reader to the lowering instead of to the mangler. */
        expect(off.ok, say("off", off)).toBe(true);
        expect(on.ok, say("on", on)).toBe(true);

        /* THE EXIT CODE, before the bytes. genret, genthrow and bodythrow
         * all declare a CRASH as their red -- a NULL promise rejection --
         * and nextval declares an abort(). A dead binary prints a prefix of
         * the right output, so comparing stdout first would report a
         * truncation and bury the cause. */
        expect(off.code, say("off", off)).toBe(0);
        expect(on.code, say("on", on)).toBe(0);

        /* THE LEAK, which has no stdout. Asserted on BOTH lanes rather than
         * only the one under suspicion: if the fibre lane leaks here too
         * the cause is older than this slice, and a one-sided assertion
         * would have blamed the frame lane for it. */
        if (b.audit) {
          expect(off.stderr, "the FIBRE lane leaks here: " + say("off", off)).not.toContain(AUDIT_FAILED);
          expect(on.stderr, "the FRAME lane leaks here: " + say("on", on)).not.toContain(AUDIT_FAILED);
        }

        /* THE LANE, before anything derived from it. A zero conversion
         * count means "no generator converted" only once a C unit was read;
         * with no unit at all it means the C lane never ran, and that is the
         * reading this file shipped its first run on. */
        expect(off.units, "no emitted C on the OFF lane -- " + say("off", off)).toBeGreaterThan(0);
        expect(on.units, "no emitted C on the ON lane -- " + say("on", on)).toBeGreaterThan(0);

        expect(on.stdout, say("on", on) + " | " + say("off", off)).toBe(off.stdout);
        expect(off.conversions, say("off", off)).toBe(0);
        expect(on.conversions, say("on", on)).toBe(EXPECTED_CONVERSIONS);
      },
      300_000,
    );
  }
});

describe("the comparison can see a wrong arm", () => {
  for (const arm of ARMS.filter((a) => a.scalar)) {
    test(
      "POISON CONTROL: a swapped " + arm.name + " arm makes the lanes DIFFER",
      async () => {
        /* The knob-on build takes a deliberately wrong scalar entry point.
         * gen-poison aborts the build if it finds no site to poison, so
         * this test cannot pass by having injected nothing -- which is the
         * failure mode a control is most likely to have. */
        const off = await build(arm.name + "-ctl-off", arm.src, OFF);
        const bad = await build(arm.name + "-ctl-on", arm.src, {
          SCRIPTC_STACKLESS: "1",
          SCRIPTC_GEN_VALUE_POISON: "yield-arm",
        });
        expect(off.ok, say("off", off)).toBe(true);
        expect(bad.ok, say("bad", bad)).toBe(true);
        expect(bad.units, "no emitted C to poison -- " + say("bad", bad)).toBeGreaterThan(0);
        /* And the injection is accounted for, not assumed: a control that
         * differs for some other reason would otherwise read as proof. */
        expect(bad.sites).toBeGreaterThan(0);
        expect(off.sites).toBe(0);
        expect(bad.stdout).not.toBe(off.stdout);
      },
      300_000,
    );
  }

  test("the ref arm is deliberately NOT poisonable, and that is recorded", () => {
    /* Not an omission. ref takes a release adapter, so swapping into it
     * would fail at the C compiler rather than at the value, testing the
     * build instead of the guard. The ref arm's parity is covered by part 1
     * above; what is not covered is a CONTROL for it, and saying so beats a
     * control that proves the wrong thing. */
    expect(ARMS.filter((a) => !a.scalar).map((a) => a.name)).toEqual(["ref"]);
  });
});
