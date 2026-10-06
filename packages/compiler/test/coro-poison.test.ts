/* The value poison's own guard. Spec: docs/stackless-value-guard.md section 5.
 *
 * A POISON IS AN INSTRUMENT, so it owes the same thing every instrument on
 * this front owes: proof that it can fail, and proof that it engaged. The
 * cautionary case is SCRIPTC_RC_AUDIT, which was born inert -- it passed
 * without having looked at anything, because it is a build-time flag and
 * nothing asserted it had engaged.
 *
 * WHAT IS EXECUTED HERE AND WHAT IS NOT. The substitutions, the counter, the
 * refusal-by-name and the cache-key property are pure functions and run. The
 * byte-identity pair and the end-to-end RED/GREEN shape sets need real
 * builds, so they are written and SKIPPED, with the reason in the title --
 * a test honestly not executed is better than one run in a hurry beside a
 * measurement that already produced a real red. They run with the queued
 * probe when the machine frees.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { BOOL, F64, STRING, VOID, type IrFunction, type IrType } from "../src/ir/nodes.js";
import {
  POISON_ENV,
  activePoison,
  assertPoisonEngaged,
  poisonFinishArm,
  poisonReport,
  poisonSites,
  poisonSpillOrder,
  poisonTakeArm,
  resetPoisonSites,
} from "../src/backend/emission/coro-poison.js";
import { scriptcEnvironmentFingerprint } from "../src/frontend/early-cache.js";

function arm(which: string | undefined): void {
  if (which === undefined) delete process.env[POISON_ENV];
  else process.env[POISON_ENV] = which;
  resetPoisonSites();
}
afterEach(() => arm(undefined));

const local = (id: string, type: IrType) => ({ id, name: id, type });
const fnWith = (...locals: ReturnType<typeof local>[]): IrFunction =>
  ({ name: "f", params: [], returnType: F64, locals, body: [], async: true }) as unknown as IrFunction;

/* -- inert when unset -------------------------------------------------- */

test("with the flag unset every substitution is the identity and no site is counted", () => {
  arm(undefined);
  expect(activePoison()).toBeNull();
  expect(poisonFinishArm(BOOL, "scr_coro_finish_bool")).toBe("scr_coro_finish_bool");
  expect(poisonTakeArm(BOOL, "scr_coro_take_bool")).toBe("scr_coro_take_bool");
  const ids = ["a.0", "b.0"];
  expect(poisonSpillOrder(fnWith(local("a.0", F64), local("b.0", F64)), ids)).toEqual(ids);
  expect(poisonSites()).toBe(0);
  expect(poisonReport(), "a normal build must print nothing, or it pollutes a stderr comparison").toBeNull();
});

test("an unrecognised flag value is not a poison", () => {
  arm("finish_arm"); // underscore, not the hyphen the type spells
  expect(activePoison()).toBeNull();
  expect(poisonFinishArm(BOOL, "scr_coro_finish_bool")).toBe("scr_coro_finish_bool");
});

/* -- the RED/GREEN sets, asserted AS SETS ------------------------------ */

const FINISH_KINDS: ReadonlyArray<[string, IrType]> = [
  ["bool", BOOL], ["f64", F64], ["string", STRING], ["void", VOID],
];

test("finish-arm reddens exactly the bool shapes -- both halves asserted", () => {
  arm("finish-arm");
  const red = FINISH_KINDS.filter(([, t]) => poisonFinishArm(t, "scr_coro_finish_x") !== "scr_coro_finish_x")
    .map(([n]) => n);
  // AS SETS, not as a count: a poison that hits one site where several are
  // owed passes a `> 0` check while under-covering, and one that also hits
  // f64 is MIS-TARGETED rather than merely noisy.
  expect(new Set(red)).toEqual(new Set(["bool"]));
  expect(poisonSites()).toBe(1);
});

test("take-arm reddens exactly the bool shapes", () => {
  arm("take-arm");
  const red = FINISH_KINDS.filter(([, t]) => poisonTakeArm(t, "scr_coro_take_x") !== "scr_coro_take_x")
    .map(([n]) => n);
  expect(new Set(red)).toEqual(new Set(["bool"]));
});

test("finish-arm substitutes the f64 member, which is the historical defect exactly", () => {
  arm("finish-arm");
  // The bool converts to double at the call, so this COMPILES -- which is
  // the whole point: `b` stays zero and every await answers false.
  expect(poisonFinishArm(BOOL, "scr_coro_finish_bool")).toBe("scr_coro_finish_f64");
});

/* -- park-spill: a misdirect, not a drop ------------------------------- */

test("park-spill swaps two same-typed slots and leaves the list a permutation", () => {
  arm("park-spill");
  const fn = fnWith(local("a.0", F64), local("b.0", F64), local("s.0", STRING));
  const ids = ["a.0", "b.0", "s.0"];
  const out = poisonSpillOrder(fn, ids);
  expect(out).not.toEqual(ids);
  // A PERMUTATION, so every value still reaches a real slot of its own type:
  // it dominates, it type-checks, and it is simply the wrong answer. A DROP
  // would be a non-dominating use that the LLVM verifier rejects at build
  // time, which cannot exercise an output comparison at all.
  expect(new Set(out)).toEqual(new Set(ids));
  expect(out).toHaveLength(ids.length);
  expect(poisonSites()).toBe(1);
});

test("park-spill counts NO site when no two adjacent locals share a type", () => {
  arm("park-spill");
  const fn = fnWith(local("a.0", F64), local("s.0", STRING));
  const ids = ["a.0", "s.0"];
  expect(poisonSpillOrder(fn, ids)).toEqual(ids);
  // Counting here would let the liveness assertion pass on a function the
  // poison could not touch.
  expect(poisonSites()).toBe(0);
});

/* -- the liveness assertion: a number, refusing at zero BY NAME -------- */

test("assertPoisonEngaged refuses at zero sites and names the poison", () => {
  arm("finish-arm");
  expect(() => assertPoisonEngaged()).toThrowError(/finish-arm.*ZERO sites/s);
  poisonFinishArm(BOOL, "scr_coro_finish_bool");
  expect(poisonSites()).toBe(1);
  expect(() => assertPoisonEngaged()).not.toThrow();
  expect(poisonReport()).toBe("POISON-SITES  poison=finish-arm  sites=1");
});

test("assertPoisonEngaged refuses when no poison is armed at all", () => {
  arm(undefined);
  expect(() => assertPoisonEngaged()).toThrowError(/not set/);
});

/* -- the cache key, BOTH directions, with no build at all -------------- */

test("the poison is in the cache key when set and absent from it when unset", () => {
  const base = { PATH: "/x", SCRIPTC_TARGET: "x86_64-windows-gnu" } as NodeJS.ProcessEnv;
  const unset = scriptcEnvironmentFingerprint(base);

  // DIRECTION 1 -- set: the fingerprint must move, or the early cache serves
  // an unpoisoned build and the guard goes green while the poison is live.
  const set = scriptcEnvironmentFingerprint({ ...base, [POISON_ENV]: "finish-arm" });
  expect(set).not.toBe(unset);
  // and each poison keys differently, or two poisons share a cached build
  const other = scriptcEnvironmentFingerprint({ ...base, [POISON_ENV]: "take-arm" });
  expect(other).not.toBe(set);

  // DIRECTION 2 -- unset: adding this flag to the tree must not invalidate a
  // single warm cache on the host. The fingerprint is a blanket over the
  // SCRIPTC_* variables PRESENT in the environment, so an absent variable
  // contributes nothing. This is the half that is not obvious.
  expect(scriptcEnvironmentFingerprint({ ...base })).toBe(unset);
  const withUnrelated = { ...base, SCRIPTC_SOMETHING_ELSE: "1" } as NodeJS.ProcessEnv;
  expect(
    scriptcEnvironmentFingerprint(withUnrelated),
    "control: the fingerprint CAN move, so direction 2 is not vacuous",
  ).not.toBe(unset);
});

/* -- needs the machine: written, not executed -------------------------- */

/* -- the build pair: containment, and the line that makes it mean something */

const PROG = [
  'async function pb(v: boolean): Promise<boolean> { return v; }',
  'async function wb(v: boolean): Promise<boolean> { const x = await pb(v); return x; }',
  'async function main(): Promise<void> { console.log("b", await wb(true), await wb(false)); }',
  'main();',
].join(String.fromCharCode(10)) + String.fromCharCode(10);

/** One arm. The output directory is keyed by BOTH the knob and the poison:
 * two arms sharing a directory would share one binary and every comparison
 * below would pass by being the same program twice. */
async function buildArm(knob: boolean, poison: string | undefined): Promise<string> {
  const prevKnob = process.env["SCRIPTC_STACKLESS"];
  const prevP = process.env[POISON_ENV];
  if (knob) process.env["SCRIPTC_STACKLESS"] = "1";
  else delete process.env["SCRIPTC_STACKLESS"];
  arm(poison);
  try {
    // ONE directory and ONE source path for every arm. A per-arm directory
    // bakes its own path into the emitted C -- the generated-from header and
    // every srcComment -- so two arms would differ by 26 lines of path and
    // nothing else, which is how the first version of this test failed.
    // Same lesson as zapobench: vary the output NAME, never the app path.
    //
    // Sharing a directory is safe BECAUSE the poison is in the cache key: a
    // false hit would return identical C, and the knob-ON test below asserts
    // the C DIFFERS, so the pair catches a cache that ignored the flag.
    const outDir = join(import.meta.dirname, "../../..", "node_modules/.cache/scriptc-tests", "coro-poison-arms");
    mkdirSync(outDir, { recursive: true });
    const file = join(outDir, "prog.ts");
    writeFileSync(file, PROG);
    const exe = "prog-" + (knob ? "on" : "off") + "-" + (poison ?? "clean") + ".exe";
    const r = await compile(file, { outPath: join(outDir, exe), outDir, backend: "c", keepC: true });
    if (!r.ok) throw new Error(r.diagnostics.map((d: { code: string; message: string }) => d.code + ": " + d.message).join("; "));
    return readFileSync(join(outDir, "prog.c"), "utf8");
  } finally {
    if (prevKnob === undefined) delete process.env["SCRIPTC_STACKLESS"];
    else process.env["SCRIPTC_STACKLESS"] = prevKnob;
    if (prevP === undefined) delete process.env[POISON_ENV];
    else process.env[POISON_ENV] = prevP;
  }
}

test("knob-absent C is byte-identical with the poison set and unset", { timeout: 120_000 }, async () => {
  // THE EMBARKATION CRITERION. A debugging tool is exactly what would break
  // it without anyone noticing, so it is asserted rather than argued.
  const clean = await buildArm(false, undefined);
  const poisoned = await buildArm(false, "finish-arm");
  expect(poisoned, "the poison reached knob-ABSENT output -- embarkation criterion broken").toEqual(clean);
  // and the arming check: knob-absent emits no coroutine at all, so the
  // equality above is not green merely because nothing was emitted either way
  expect(clean).not.toMatch(/scr_coro_finish_/);
});

test("knob-ON C DIFFERS with the poison set, and the ARTIFACT accounts for every site", { timeout: 120_000 }, async () => {
  // The must-change line. Without it the test above is green when the poison
  // does nothing at all -- including when it was never wired up.
  const on = await buildArm(true, undefined);
  expect(on, "the knob did not reach the emitter").toMatch(/scr_coro_finish_bool/);

  arm("finish-arm");
  const poisoned = await buildArm(true, "finish-arm");
  expect(poisoned).not.toEqual(on);
  // the substitution is the historical defect exactly: bool fulfilled through f64
  expect(poisoned).not.toMatch(/scr_coro_finish_bool/);
  expect(poisoned).toMatch(/scr_coro_finish_f64/);
  // LIVENESS, DERIVED FROM THE ARTIFACT AND NOT FROM A COUNTER.
  //
  // This read poisonSites(), a process-global counter that only increments
  // while emission RUNS. The pipeline is content-addressed: a cache hit
  // returns the poisoned C without re-emitting, so the counter reads zero
  // while the artifact in hand is correct in every respect -- a false RED.
  // Same shape as the -included census header the cache key could not see:
  // THE BUILD CACHE CANNOT SEE THE INSTRUMENT. A counter is the wrong
  // instrument for a cached pipeline however today's defect resolves, so
  // this changes regardless of that answer.
  //
  // Turning the cache off here is NOT the fix: it would measure a pipeline
  // that is not the one that ships.
  //
  // The count is differenced out of the TWO ARTIFACTS instead. Every bool
  // finish in the clean arm must appear as an f64 finish in the poisoned
  // one, exactly once each. It refuses at zero by construction -- a program
  // with no bool finish proves nothing and fails on the first line -- and it
  // is strictly stronger than a counter: a poison that ALSO moved an f64
  // site satisfies "> 0" and fails this.
  //
  // assertPoisonEngaged and poisonReport keep their own tests above, where
  // the calls are in-process and no cache can stand between the act and the
  // count. They are build-time guards; they are not this test's evidence.
  const occurrences = (c: string, re: RegExp): number => (c.match(re) ?? []).length;
  const boolSites = occurrences(on, /scr_coro_finish_bool\(/g);
  expect(boolSites, "nothing to poison: the clean arm emitted no bool finish").toBeGreaterThan(0);
  expect(occurrences(poisoned, /scr_coro_finish_bool\(/g)).toBe(0);
  expect(
    occurrences(poisoned, /scr_coro_finish_f64\(/g) - occurrences(on, /scr_coro_finish_f64\(/g),
    "every bool finish must become exactly one f64 finish, and no other site may move",
  ).toBe(boolSites);
});

test.skip("NOT EXECUTED (needs four arms): the poisoned guard reddens exactly its expected shape set", () => {
  // End-to-end coverage, against stackless-values.test.ts's WRAPPERS ledger:
  // arm each poison, run the four-arm matrix, and assert the set of shapes
  // whose output diverges from the C-knob-off reference EQUALS the expected
  // RED set of docs/stackless-value-guard.md section 5.1 -- and that the
  // expected GREEN set does not diverge. Sets, not counts.
});
