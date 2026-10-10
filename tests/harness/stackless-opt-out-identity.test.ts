/* THE TWO LANES, EACH PINNED TO THE ARM THAT NAMES IT.
 *
 * RENAMED AND REAIMED 2026-10-09, when the lane's default INVERTED. This file
 * landed that same morning as `stackless-knob-absent-identity.test.ts`, and
 * its criterion was written for a tree in which the knob-ABSENT build was the
 * shipped one:
 *
 *     artifact(knob=1, machinery neutralised) == artifact(knob absent)
 *
 * The lowering now ships ON (ir/coro-plans.ts) and `SCRIPTC_STACKLESS=0` is
 * the opt-out. Both sides of that equality moved at once: "knob absent" is
 * the STACKLESS lane now, so the sentence it used to state -- the machinery
 * costs the shipped artifact nothing -- is no longer something anyone wants
 * to be true. The machinery is SUPPOSED to change the shipped artifact.
 *
 * SO THE ONE CRITERION SPLIT INTO TWO, and this file carries both.
 *
 *   JOB A -- THE OPT-OUT IS A TRUE OPT-OUT. The same compiled comparison as
 *   before, with one arm respelled:
 *
 *       artifact(SCRIPTC_STACKLESS=0)
 *           == artifact(knob=1, machinery neutralised)
 *
 *   Every assertion that used to prove the SHIP guarantee proves this one
 *   unchanged. Its worth went UP rather than down. While the fiber lane was
 *   the default, every gate run exercised it and nothing had to prove the
 *   escape hatch worked; now nothing exercises it unless something asks --
 *   and the fiber lane is the REFERENCE ARM of every instrument on this
 *   front: the two-arm harness tests, the differential, the parity rigs. A
 *   reference arm that has quietly stopped being the pre-stackless compiler
 *   does not make those instruments FAIL. It makes them agree with
 *   themselves. This is what stands between that and nobody noticing.
 *
 *   JOB B -- THE DEFAULT REALLY IS THE STACKLESS LANE. New here, and it is
 *   the actual ship guarantee now:
 *
 *       artifact(knob absent) == artifact(knob=1), and the machinery ran
 *
 *   It exists because of a property of this repo the flip exposed: EVERY
 *   OTHER KNOB-AWARE TEST NAMES ITS ARM EXPLICITLY. All of them set "1" or
 *   "0" per arm, so if the flip failed to take -- a stale dist, a reverted
 *   predicate, a cache serving the previous lowering -- not one of them
 *   would go red. The default is the one thing the rest of the suite cannot
 *   see, and it is the thing that ships.
 *
 * WHAT WAS CONSIDERED AND REJECTED: mirroring Job A as
 * `artifact(knob=0) == artifact(the old knob-absent build)`. That is a
 * CROSS-COMMIT comparison, and the last paragraph of this header already
 * rules that whole class out of this suite and assigns it to the merge. It
 * would also go red on every unrelated change to the emitter, which is the
 * "regenerated reflexively" failure named just below.
 *
 * WHY ANY OF THIS IS A TEST AND NOT A HABIT. Six slices landed on the
 * original guarantee and not one of them was checked by anything that runs
 * on its own -- it was checked by a person, by hand, with a pair of two-leg
 * shell scripts. A guarantee verified by habit is a guarantee that ends when
 * the habit does, and the worst outcome is already on the record: an ARMED
 * run of that hand check returned rc=0 WITH THE PLANT IN PLACE. A control
 * that cannot fail is not a control, and "the legs matched" is not evidence
 * when nothing established that mismatched legs would have been noticed.
 *
 * WHAT MAKES "WITHOUT THE MACHINERY" CHECKABLE IN ONE TREE. There is no tree
 * without the machinery any more, and pinning a pre-stackless commit as a
 * golden would go red on every unrelated change to the emitter -- a test
 * regenerated reflexively protects nothing. So the counterfactual is built
 * instead of fetched: `stacklessPlan` is the machinery's SOLE production
 * entry point (ir/coro-plans.ts is its only caller outside instruments), so
 * a build in which it answers `null` for every function IS the build without
 * the machinery. Job A then reads, in one tree:
 *
 *     artifact(knob=1, machinery neutralised) == artifact(SCRIPTC_STACKLESS=0)
 *
 * and the two sides really are compiled, not reasoned about.
 *
 * THE ARMING IS THE POINT, AND IT IS THREE INDEPENDENT WITNESSES. Each one
 * can put this file in the red on its own, and each fails differently:
 *
 *   - the SPY CALL COUNT. Zero under the OPT-OUT is the direct statement
 *     that no stackless code ran at all -- strictly stronger than "the bytes
 *     matched". Read the other way round it is the whole of Job B in one
 *     number: NON-ZERO on the knob-ABSENT leg is what says the default
 *     flipped. Non-zero with the knob on is what proves the spy is still
 *     installed; the day vitest's ESM interception stops reaching this
 *     module, that count reads zero on the knob-on leg and this file says so
 *     instead of passing on an instrument that quietly detached.
 *   - the NON-DEGENERATE FIXTURE. The knob-on artifact must actually differ
 *     from the opt-out one. A fixture whose two legs agree because it
 *     carries nothing the machinery converts proves identity by having
 *     nothing to compare, which is how a green file covers zero.
 *   - the SHIPPED VALUE POISON (backend/emission/coro-poison.ts), a real
 *     mutation of real emitted text, with its own site counter. Its header
 *     claims nothing consults it under the opt-out; that sentence is prose,
 *     and prose is not a control. Here it is a
 *     measured zero on one leg and a measured, EXACTLY PREDICTED byte delta
 *     on the other.
 *
 * THE PREDICTIONS ARE EXACT, NEVER THRESHOLDS. `scr_coro_finish_bool` is
 * twenty characters and `scr_coro_finish_f64` is nineteen, and the poison
 * substitutes one for the other and counts itself doing it. So N sites move
 * the artifact by EXACTLY N bytes, and the before/after token counts have to
 * balance in both directions as well -- every bool arm gone, every one of
 * them arrived on the f64 side. "It changed" would pass on a poison wired to
 * the wrong place; this does not.
 *
 * ONE OUTPUT DIRECTORY PER LANE, AND THE ARTIFACT IS COPIED OUT AFTER EACH
 * LEG. The emitted TU carries its own output path, so legs compiled in two
 * directories differ by construction -- by bytes that are literally the
 * directory name. That defect has already broken the first control of two
 * slices on this front. Measured here rather than assumed: the opt-out
 * legs below are byte-identical while their ENVIRONMENTS differ (the poison
 * flag is present in one and absent in the other), which is also the direct
 * evidence that the environment fingerprint is a cache key and not emitted.
 *
 * A CACHED LEG CANNOT FAKE A PASS HERE. Two of these legs share an identical
 * environment and differ only by the spy, which no cache key can see -- so a
 * served artifact would compare one leg against itself. SCRIPTC_NO_CACHE
 * keeps that from arising, and the spy call count is what would CATCH it if
 * it ever did: a leg answered from cache runs no emitter and records no
 * calls, which is a red arming assertion rather than a quiet green.
 *
 * WHAT THIS FILE DOES NOT COVER, so nobody reads it as more than it is. It
 * catches stackless-only code being CONSULTED on an opt-out build. It
 * cannot catch stackless work that changes code on the COMMON path -- a
 * widened shared struct, an edit to BlockBuilder that moves every function's
 * output. No single-tree plant can: the leak is in code both legs run. That
 * class needs the opt-out artifact of the branch compared against the
 * opt-out artifact of main, which is a two-revision check and belongs to
 * the merge rather than to this suite.
 */
import { describe, expect, test, beforeAll, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compile } from "@scriptc/compiler";
// The SOURCE modules by relative path -- the convention the other
// internals-facing harness tests use. There is no package subpath export for
// backend internals, and there should not be.
import * as liveness from "../../packages/compiler/src/ir/liveness.js";
import {
  POISON_ENV,
  poisonSites,
  resetPoisonSites,
} from "../../packages/compiler/src/backend/emission/coro-poison.js";
import { exeName } from "./exe.js";

/* THE FIXTURE HAS TO BE ABLE TO BUILD THE CASE THAT FAILS, which here means
 * three things at once, and each is asserted below rather than eyeballed:
 *
 *   - every wrapper is a SINGLE ROOT-POSITION await, so the LLVM lane's
 *     admission predicate takes all of them and the release lane is really
 *     the lane under test. A fixture the LLVM lane refuses is a hard SC3001
 *     under an explicit backend, which is the loud outcome; the quiet one
 *     this guards against is measuring the C lane twice and calling it two
 *     lanes.
 *   - TWO bool-returning coroutines, so the finish-arm poison lands on more
 *     than one site. A one-site prediction is satisfied by any wiring that
 *     fires once, and cannot tell "wired" from "wired to one place of
 *     several".
 *   - the f64 and string arms are here as NEGATIVE space: the poison is
 *     typed, so they must come through it untouched. A poison that moved
 *     them would be over-reaching, and the token arithmetic below sees it.
 */
const SOURCE = `
async function pb(n: number): Promise<boolean> { return n > 0; }
async function pn(n: number): Promise<number> { return n + 1; }
async function ps(s: string): Promise<string> { return s + "!"; }
async function flag(n: number): Promise<boolean> { const a = await pb(n); return a; }
async function both(n: number): Promise<boolean> { const b = await pb(n - 1); return b; }
async function sum(n: number): Promise<number> { const x = await pn(n); return x + 1; }
async function tag(s: string): Promise<string> { const u = await ps(s); return u + "?"; }
async function main(): Promise<void> {
  console.log("flag", await flag(3), await both(0));
  console.log("sum", await sum(1));
  console.log("tag", await tag("a"));
}
void main();
`;

type Lane = "c" | "llvm";

/* THE KNOB HAS THREE ARMS NOW AND ALL THREE ARE NAMED, because two of them
 * used to be one. Before the default flipped, "absent" and "off" were the
 * same build and the code below spelled "off" as a `delete`. They are
 * different builds now -- "absent" is the SHIPPED lane -- and a `delete`
 * standing in for "off" would make every identity assertion in this file
 * compare the stackless lane against itself and pass. */
type Arm = "on" | "off" | "absent";

/** What one compiled leg leaves behind. `planCalls` is the machinery's own
 * pulse: how many times its sole entry point answered during THIS leg. */
interface Leg {
  artifact: string;
  planCalls: number;
  sites: number;
  lane: Lane;
}

/** Every leg of a lane compiles into ONE directory and the artifact is read
 * out before the next leg overwrites it -- see the header. */
function laneDir(lane: Lane): string {
  return join(
    import.meta.dirname,
    "../../node_modules/.cache/scriptc-tests",
    `stackless-arms-${lane}`,
  );
}

async function leg(
  lane: Lane,
  opts: { knob: Arm; poison: boolean; neutralise: boolean },
): Promise<Leg> {
  const outDir = laneDir(lane);
  mkdirSync(outDir, { recursive: true });
  // Both artifact names, unconditionally: a lane prunes the other's artifact,
  // and a stale file left by the previous leg and read back as this leg's
  // output is the quietest way for two legs to "agree".
  for (const stale of ["prog.c", "prog.ll", exeName("prog")]) {
    const p = join(outDir, stale);
    if (existsSync(p)) rmSync(p);
  }
  const file = join(outDir, "prog.ts");
  writeFileSync(file, SOURCE);

  const prevKnob = process.env["SCRIPTC_STACKLESS"];
  const prevPoison = process.env[POISON_ENV];
  const prevCache = process.env["SCRIPTC_NO_CACHE"];
  // "absent" is a DELETE on purpose and is the only arm that may be one: it
  // is the build a user gets, and the point of the `absent` legs is that
  // nothing here told the compiler which lane to take.
  if (opts.knob === "absent") delete process.env["SCRIPTC_STACKLESS"];
  else process.env["SCRIPTC_STACKLESS"] = opts.knob === "on" ? "1" : "0";
  if (opts.poison) process.env[POISON_ENV] = "finish-arm";
  else delete process.env[POISON_ENV];
  // See the header: two legs here differ only by the spy, which no cache key
  // can see. The spy count would catch a served artifact; this keeps the
  // situation from arising in the first place.
  process.env["SCRIPTC_NO_CACHE"] = "1";

  const spy = vi.spyOn(liveness, "stacklessPlan");
  if (opts.neutralise) spy.mockReturnValue(null);
  resetPoisonSites();
  try {
    const r = await compile(file, {
      outPath: join(outDir, exeName("prog")),
      outDir,
      backend: lane,
    });
    if (!r.ok) {
      throw new Error(r.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
    }
    return {
      artifact: readFileSync(join(outDir, lane === "llvm" ? "prog.ll" : "prog.c"), "utf8"),
      planCalls: spy.mock.calls.length,
      sites: poisonSites(),
      lane: r.backend,
    };
  } finally {
    spy.mockRestore();
    const restore = (k: string, v: string | undefined): void => {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    };
    restore("SCRIPTC_STACKLESS", prevKnob);
    restore(POISON_ENV, prevPoison);
    restore("SCRIPTC_NO_CACHE", prevCache);
  }
}

/** Occurrences, not lines: two arms on one line are two sites, and a
 * line-counting grep would under-read exactly where the poison over-reaches. */
const occurrences = (hay: string, needle: string): number => hay.split(needle).length - 1;

for (const lane of ["llvm", "c"] as const) {
  describe(`the ${lane} lane takes the arm it is told, and the opt-out is untouched by the stackless machinery`, () => {
    let off!: Leg;
    let on!: Leg;
    let absent!: Leg;
    let offNeutral!: Leg;
    let onNeutral!: Leg;
    let offPoison!: Leg;

    beforeAll(async () => {
      off = await leg(lane, { knob: "off", poison: false, neutralise: false });
      on = await leg(lane, { knob: "on", poison: false, neutralise: false });
      absent = await leg(lane, { knob: "absent", poison: false, neutralise: false });
      offNeutral = await leg(lane, { knob: "off", poison: false, neutralise: true });
      onNeutral = await leg(lane, { knob: "on", poison: false, neutralise: true });
      offPoison = await leg(lane, { knob: "off", poison: true, neutralise: false });
    }, 900_000);

    /* -- THE ARMING. Everything below is worthless if this is not green, so
     * it is asserted first and on its own. -- */
    test("ARMED: the fixture converts, the lane is the one named, and the spy is live", () => {
      // The lane really is the lane named, on every leg.
      expect(off.lane, "the opt-out leg was emitted by the wrong backend").toBe(lane);
      expect(on.lane, "the knob-ON leg was emitted by the wrong backend").toBe(lane);
      expect(onNeutral.lane, "the neutralised leg was emitted by the wrong backend").toBe(lane);
      // The machinery's pulse. Zero here means the spy detached -- NOT that
      // the build is clean.
      expect(
        on.planCalls,
        "the spy recorded no call on a knob-ON build: it is not installed, and every identity assertion below is vacuous",
      ).toBeGreaterThan(0);
      // The fixture is not degenerate: the machinery really does move this
      // program. Identity proved over a program nothing converts is identity
      // proved over nothing.
      expect(
        on.artifact,
        "the knob-ON artifact equals the opt-out one -- this fixture converts nothing and guards nothing",
      ).not.toEqual(off.artifact);
      expect(
        occurrences(on.artifact, "scr_coro_"),
        "no coroutine lowering in the knob-ON artifact",
      ).toBeGreaterThan(0);
    });

    test("JOB A: under SCRIPTC_STACKLESS=0 the machinery is never consulted", () => {
      // The direct statement, and stronger than any byte comparison: the sole
      // entry point did not answer once.
      expect(off.planCalls, "stacklessPlan ran on an opt-out build").toBe(0);
      expect(offPoison.planCalls, "stacklessPlan ran on an opt-out build").toBe(0);
      // And not one stackless byte reached the artifact.
      expect(
        occurrences(off.artifact, "scr_coro_"),
        "an opt-out artifact carries coroutine lowering",
      ).toBe(0);
    });

    /* JOB B -- THE SHIPPING DEFAULT. See the header: every other knob-aware
     * test in this repo names its arm, so this is the only place that can
     * observe whether the default flipped at all. It is deliberately stated
     * three ways, because the three fail for different reasons: the artifact
     * (a stale dist or a served cache gives the old one), the machinery's own
     * pulse (a reverted predicate makes it zero), and the inequality against
     * the opt-out (which is what makes the first two non-vacuous). */
    test("JOB B: with the knob ABSENT the build is the STACKLESS one", () => {
      expect(
        absent.planCalls,
        "stacklessPlan never answered on a knob-absent build: the lane does NOT ship on",
      ).toBeGreaterThan(0);
      expect(
        absent.artifact,
        "the knob-absent artifact is not the knob-ON artifact: the default did not flip",
      ).toEqual(on.artifact);
      expect(
        absent.artifact,
        "the knob-absent artifact equals the opt-out one -- the two lanes are not distinguishable here and this assertion is vacuous",
      ).not.toEqual(off.artifact);
      expect(
        occurrences(absent.artifact, "scr_coro_"),
        "a knob-absent artifact carries no coroutine lowering",
      ).toBeGreaterThan(0);
    });

    test("JOB A, THE CRITERION: neutralising the machinery reproduces the opt-out artifact exactly", () => {
      // The counterfactual, compiled rather than argued: a build whose sole
      // stackless entry point answers nothing IS the build without the
      // machinery, and it has to be the opt-out artifact byte for byte.
      expect(
        onNeutral.artifact.length,
        "byte length differs with the machinery neutralised",
      ).toBe(off.artifact.length);
      expect(
        onNeutral.artifact,
        "neutralising the machinery did NOT reproduce the opt-out artifact",
      ).toEqual(off.artifact);
      // And the opt-out leg does not even need neutralising to get there.
      expect(
        offNeutral.artifact,
        "the opt-out artifact moved when the machinery was neutralised",
      ).toEqual(off.artifact);
    });

    test("the shipped value poison cannot reach an opt-out build", () => {
      expect(offPoison.sites, "the value poison substituted on an opt-out build").toBe(0);
      expect(
        offPoison.artifact,
        "an opt-out artifact moved under the value poison",
      ).toEqual(off.artifact);
    });
  });
}

/* The poison's ARITHMETIC is pinned on the C lane alone, and the asymmetry is
 * measured rather than conceded: coro-poison.ts is imported by exactly one
 * module, backend/emission/emit-coro.ts, so the LLVM lane never consults it
 * and its site count reads zero there even on a knob-ON build. Asserting the
 * site count inside the lane loop above would therefore be a lie on one of
 * the two lanes, which is why the loop asserts only what both lanes can see
 * and the arithmetic lives here.
 *
 * It is worth its own legs rather than riding the loop's: this is the one
 * witness in the file that is NOT the vitest spy, so it is what keeps the
 * whole argument from resting on a single interception mechanism. */
describe("the value poison's substitution balances exactly, on the lane that has it", () => {
  let on!: Leg;
  let onPoison!: Leg;
  beforeAll(async () => {
    on = await leg("c", { knob: "on", poison: false, neutralise: false });
    onPoison = await leg("c", { knob: "on", poison: true, neutralise: false });
  }, 900_000);

  test("every substituted site is one bool arm gone and one f64 arm arrived", () => {
    const n = onPoison.sites;
    // Wired, and to more than one place: a one-site poison cannot tell
    // "wired" from "wired to one place of several".
    expect(n, "the value poison is not wired into the C emission path").toBeGreaterThanOrEqual(2);
    // Each site is the whole story of the delta, in all four directions.
    expect(
      occurrences(on.artifact, "scr_coro_finish_bool"),
      "the site count disagrees with the clean artifact",
    ).toBe(n);
    expect(
      occurrences(onPoison.artifact, "scr_coro_finish_bool"),
      "a bool arm survived the poison",
    ).toBe(0);
    expect(
      occurrences(onPoison.artifact, "scr_coro_finish_f64"),
      "the f64 side did not receive every substituted site",
    ).toBe(occurrences(on.artifact, "scr_coro_finish_f64") + n);
    // `scr_coro_finish_bool` is 20 characters and `scr_coro_finish_f64` is
    // 19, so N sites are EXACTLY N bytes and nothing else moved.
    expect(
      on.artifact.length - onPoison.artifact.length,
      "the delta is not exactly one byte per substituted site",
    ).toBe(n);
  });
});
