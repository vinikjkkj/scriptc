/* THE CROSS-LANE VALUE GUARD FOR GENERATOR CHANNELS.
 *
 * Written BEFORE the synchronous-generator lowering exists, deliberately.
 * The defect this front has paid most for is a value that silently takes
 * the wrong type arm while every gate stays green, and a guard installed
 * after the shapes is a guard whose first run is also the first run of the
 * thing it guards -- so a green says nothing about either.
 *
 * THE INSTRUMENT HAS THREE PARTS AND ONLY ONE OF THEM IS THE COMPARISON.
 *
 *   1. PARITY -- the same program built knob-absent and knob-on must print
 *      byte-identical output, for every arm of the yield channel.
 *   2. CONVERSION ACCOUNTING -- how many coroutine resume functions the
 *      knob-on build actually emitted, read out of the EMITTED C. This is
 *      what says whether part 1 means anything: if nothing converted, the
 *      two lanes are the same code and parity is vacuous.
 *   3. THE POISON CONTROL -- the same comparison, with a wrong arm injected
 *      into the knob-on build, must come out DIFFERENT. This is what says
 *      part 1 can see a value defect at all.
 *
 * Part 2 is the one usually missing, and its absence is how a cross-lane
 * test reports agreement between a lane and itself. Part 3 is the one that
 * cannot be inferred from a passing run, which is why it is a test and not
 * a comment.
 *
 * PART 1 WAS VACUOUS UNTIL THIS SLICE AND PART 2 SAID SO IN A NUMBER.
 * stacklessPlan used to refuse every generator -- fn.async !== true caught
 * the synchronous ones before the generator gate ever ran -- so
 * EXPECTED_CONVERSIONS was 0 and both lanes emitted the same fiber
 * lowering. The admission gates are now open and the number is 1, so the
 * comparison is between two different lowerings for the first time. Part 3
 * was live even before that, because the poison perturbs the fibre lowering
 * both lanes shared -- which is how the guard was proved able to see a wrong
 * arm before there was a second lane to compare.
 *
 * WHEN THE SYNCHRONOUS SLICE LANDS: raise EXPECTED_CONVERSIONS to the number
 * of generator resume functions the knob-on build emits. Do not delete the
 * assertion and do not make it an inequality -- an exact count is what turns
 * "some generators converted" into "these did", and a range would hide a
 * function that stopped converting.
 *
 * NOT EXECUTED AT THE TIME OF WRITING. A gate was in flight; nothing here
 * has been run. Every expectation below is derived, and the commit that
 * first runs it must say so and move whatever disagrees.
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

/** Generator resume functions the knob-on build must emit, per program.
 *
 * DERIVED, NOT YET MEASURED. Each program below defines exactly one
 * synchronous generator and no async function, and a converted generator
 * emits exactly one resume function, so the count is 1. The top-level
 * for-of is ordinary synchronous code and converts nothing.
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
    ].join("\n"),
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
    ].join("\n"),
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
    ].join("\n"),
  },
];

interface Built {
  readonly stdout: string;
  readonly conversions: number;
  readonly sites: number;
}

/** Count coroutine resume functions in the EMITTED C, not in the IR and not
 * from the environment variable. Reading the knob would assert what was
 * asked for rather than what was obtained, which is the distinction this
 * whole file is built on. */
function conversionsIn(outDir: string): number {
  let n = 0;
  for (const f of readdirSync(outDir)) {
    if (!f.endsWith(".c") && !f.endsWith(".scrh")) continue;
    const text = readFileSync(join(outDir, f), "utf8");
    for (const m of text.matchAll(/\bsc_cr_[A-Za-z0-9_]+\s*\(ScrCoroBase/g)) {
      void m;
      n++;
    }
  }
  return n;
}

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
  try {
    const result = await compile(entry, {
      outPath: join(dir, exeName(stem)),
      outDir: dir,
      sanitize,
    });
    expect(result.ok, !result.ok ? JSON.stringify(result.diagnostics, null, 2) : "").toBe(true);
    if (!result.ok) return { stdout: "", conversions: -1, sites: 0 };
    /* Refuses BY NAME if a poison was requested and injected nothing. */
    assertGenPoisonEngaged();
    const { stdout } = await execFileAsync(result.binaryPath);
    return { stdout, conversions: conversionsIn(dir), sites: genPoisonSites() };
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const OFF = { SCRIPTC_STACKLESS: undefined, SCRIPTC_GEN_VALUE_POISON: undefined };
const ON = { SCRIPTC_STACKLESS: "1", SCRIPTC_GEN_VALUE_POISON: undefined };

describe("generator channel: the two lanes agree on every value", () => {
  for (const arm of ARMS) {
    test(
      arm.name + " yields are identical knob-absent and knob-on",
      async () => {
        const off = await build(arm.name + "-off", arm.src, OFF);
        const on = await build(arm.name + "-on", arm.src, ON);

        /* PART 1: the comparison. */
        expect(on.stdout).toBe(off.stdout);

        /* PART 2: and what it is worth. A knob-absent build must never
         * carry a coroutine frame; a knob-on build carries exactly as many
         * as the declared expectation. The second number is what tells a
         * reader whether part 1 compared two lanes or one lane with
         * itself. */
        expect(off.conversions).toBe(0);
        expect(on.conversions).toBe(EXPECTED_CONVERSIONS);
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
