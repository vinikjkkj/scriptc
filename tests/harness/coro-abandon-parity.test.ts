/* CLAUSE 3.5, ADJUDICATED BY MEASUREMENT RATHER THAN BY THE CLAUSE'S OWN GUESS.
 *
 * docs/stackless-frame-contract.md:135-146 says two things, and only the
 * first is normative:
 *
 *   (a) "Every refcounted field live in the frame must be released on every
 *       exit path, including the rejecting one."  -- an obligation ON THE
 *       CODEGEN.
 *   (b) "If the codegen cannot discharge 3.5 on all paths, the right fix is a
 *       per-function `drop` hook in ScrCoroBase; that costs 8 bytes on every
 *       frame, so it is deliberately not there yet."  -- a CONDITIONAL offer.
 *
 * The contract's "Not covered yet" list carried (b) as an open item for
 * months. It is not an open item: it is an offer whose CONDITION had never
 * been measured. This file measures it.
 *
 * WHAT IS PINNED HERE, AND WHY IT IS WORTH A FILE.
 *
 * The answer "the drop hook is never owed" rests ENTIRELY on the codegen
 * continuing to release every frame slot on every exit path. Nothing else in
 * the repo re-takes that measurement: coro-abandoned-count.test.ts drives
 * frames with NO refcounted payload across the park, so every one of its
 * programs would pass with every frame release deleted. This file carries
 * payload across the suspension -- a heap string, an array and an object,
 * all read AFTER the resume so the emitter must put them in the frame -- and
 * asks the RC audit. The day a frame slot stops being released, this file is
 * what goes red, and the day it goes red is the day the hook becomes owed.
 *
 * THIS IS NOT A TIMING SEAM AND NOTHING HERE SLEEPS. The discriminator is a
 * PROCESS EXIT CODE and a literal stderr line, both deterministic. The trap
 * that a sibling test fell into -- copying a shape whose seam is armed by a
 * clamp that this seam does not have, so the loop slept the window out and
 * the arm consumed one blocking turn and zero rows -- cannot arise: there is
 * no window, no clamp and no turn budget in any assertion below.
 *
 * THE FIBER ARM IS A REFERENCE FOR OUTPUT, NOT A SECOND MEASUREMENT OF 3.5,
 * and saying so is the point. With SCRIPTC_STACKLESS=0 there is no coroutine
 * frame at all, so the fiber arm is GREEN BY CONSTRUCTION against every
 * frame-release defect this file exists to catch -- it would stay green with
 * emit-coro.ts emptied out. It is here only to supply the oracle for stdout
 * and the exit code, which is a different question from whether a frame slot
 * was released. An assertion that ONLY compared the two lanes would
 * discriminate nothing, which is why every shape below is also asserted
 * against the audit directly.
 *
 * Source strings join on String.fromCharCode(10) rather than using escapes,
 * for the reason the sibling file gives: an escape crossing a second parse
 * layer has been eaten silently more than once in this repo.
 */
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const execFileAsync = promisify(execFile);
const NL = String.fromCharCode(10);
let workDir = "";

beforeAll(() => { workDir = mkdtempSync(join(tmpdir(), "scriptc-c35parity-")); });
afterAll(() => { rmSync(workDir, { recursive: true, force: true }); });

/* THE PAYLOAD. Three refcounted kinds, declared BEFORE the suspension and
 * read AFTER it, so each one is a frame field rather than a C automatic the
 * resume label jumps over. Without these lines every program in this file is
 * a frame whose payload is empty and the audit has nothing to find -- which
 * is exactly the gap this file closes against its sibling. */
const PAY = [
  "  const s: string = 'x'.repeat(10) + String(1)",
  "  const arr: number[] = [1, 2, 3]",
  "  const o: { k: string } = { k: s }",
];

/* EVERY EXIT PATH A FRAME CAN ACTUALLY TAKE, enumerated from scr_coro.c
 * rather than invented: a frame leaves through scr_coro_finish_void/f64/
 * bool/ref (normal return), through scr_coro_finish_throw (an escaped
 * exception, whether or not anyone is attached to the promise), or it never
 * leaves at all (parked at loop exit). The rejecting path -- the one the
 * clause calls out by name -- reaches the first of those through a catch. */
const SHAPES: readonly (readonly [string, string])[] = [
  /* The clause's own named case: the await REJECTS, the body catches it and
   * runs to a normal return with the payload still live. */
  ["reject-caught", [
    "async function a(): Promise<number> {",
    ...PAY,
    "  let hit: number = 0",
    "  try {",
    "    await Promise.reject<number>(new Error('boom'))",
    "  } catch (e) {",
    "    hit = 1",
    "  }",
    "  return s.length + arr.length + o.k.length + hit",
    "}",
    "a().then((v: number): void => { console.log('done', v) })",
  ].join(NL) + NL],
  /* Ordinary fulfilment, payload live across the park. */
  ["fulfil", [
    "async function a(): Promise<number> {",
    ...PAY,
    "  const v: number = await Promise.resolve<number>(1)",
    "  return s.length + arr.length + o.k.length + v",
    "}",
    "a().then((v: number): void => { console.log('done', v) })",
  ].join(NL) + NL],
  /* THE CONSUMER DISAPPEARS: nobody holds the result promise, but the
   * AWAITED one still settles, so the frame is resumed and completes. This
   * is the shape most easily mistaken for abandonment and it is not one. */
  ["consumer-dropped", [
    "async function a(): Promise<number> {",
    ...PAY,
    "  const v: number = await Promise.resolve<number>(1)",
    "  return s.length + arr.length + o.k.length + v",
    "}",
    "void a()",
    "console.log('spawned')",
  ].join(NL) + NL],
  /* The frame's own promise rejects with nobody attached: scr_coro_finish_throw
   * with the payload live, and the program dies through the unhandled-rejection
   * path rather than through a return. */
  ["unhandled-rejection", [
    "async function a(): Promise<number> {",
    ...PAY,
    "  await Promise.resolve<number>(1)",
    "  if (arr.length === 3) { throw new Error('boom ' + s + o.k) }",
    "  return 0",
    "}",
    "void a()",
    "console.log('spawned')",
  ].join(NL) + NL],
  /* The SYNCHRONOUS PREFIX: the body throws before it ever suspends, so the
   * frame dies inside scr_coro_resume_entry's escaped-exception arm without
   * having parked once. The payload is already in the frame by then. */
  ["throw-before-first-await", [
    "async function a(): Promise<number> {",
    ...PAY,
    "  if (arr.length === 3) { throw new Error('early ' + s + o.k) }",
    "  const v: number = await Promise.resolve<number>(1)",
    "  return v",
    "}",
    "a().then((v: number): void => { console.log('ok', v) },",
    "         (e: unknown): void => { console.log('caught') })",
  ].join(NL) + NL],
];

/* THE ONE RESIDUE. Parked on a promise with no resolver and nothing holding
 * the result, so the loop exhausts with the frame still suspended and every
 * emitted release still sitting after the resume label. */
const PARKED_FOREVER = [
  "async function a(): Promise<void> {",
  ...PAY,
  "  await new Promise<void>((): void => {})",
  "  console.log(s, arr.length, o.k)",
  "}",
  "void a()",
  "console.log('spawned')",
].join(NL) + NL;

const COUNT_RE = /scriptc RC audit: ([0-9]+) coroutine\(s\) abandoned/;
const FAILED_RE = /scriptc RC AUDIT FAILED: (.*) live at exit/;
const FIBER_SKIP_RE = /scriptc RC audit skipped: ([0-9]+) fiber\(s\) never resumed/;

interface Run { stdout: string; stderr: string; code: number }

async function buildAndRun(name: string, src: string, knob: boolean): Promise<Run> {
  const dir = join(workDir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "main.ts"), src, "utf8");
  const prevKnob = process.env["SCRIPTC_STACKLESS"];
  const prevAudit = process.env["SCRIPTC_RC_AUDIT"];
  /* `0`, NOT absent. The lane has shipped ON since K1, so deleting the
   * variable would set BOTH arms to stackless and every lane comparison in
   * this file would compare a lane with itself and report agreement. */
  process.env["SCRIPTC_STACKLESS"] = knob ? "1" : "0";
  process.env["SCRIPTC_RC_AUDIT"] = "1";
  try {
    const built = await compile(join(dir, "main.ts"), {
      outPath: join(dir, exeName("program")), outDir: dir, backend: "c",
    });
    expect(built.ok, (built.diagnostics ?? []).map((d) => d.code).join(",")).toBe(true);
    try {
      const r = await execFileAsync(built.binaryPath!, [], { encoding: "utf8", timeout: 120_000 });
      return { stdout: r.stdout, stderr: r.stderr, code: 0 };
    } catch (e) {
      const x = e as { stdout?: string; stderr?: string; code?: number };
      return { stdout: x.stdout ?? "", stderr: x.stderr ?? "", code: x.code ?? -1 };
    }
  } finally {
    if (prevKnob === undefined) delete process.env["SCRIPTC_STACKLESS"];
    else process.env["SCRIPTC_STACKLESS"] = prevKnob;
    if (prevAudit === undefined) delete process.env["SCRIPTC_RC_AUDIT"];
    else process.env["SCRIPTC_RC_AUDIT"] = prevAudit;
  }
}

describe("clause 3.5: the codegen discharges it on every exit path a frame can take", () => {
  for (const [name, src] of SHAPES) {
    test("the frame payload is released on the " + name + " path", async () => {
      const k1 = await buildAndRun("c35-" + name + "-k1", src, true);

      /* THE MEASUREMENT. A frame slot that is not released shows up here as a
       * nonzero count, and scr_console.c answers it with _Exit(99). This
       * assertion -- not the lane comparison below -- is what makes the
       * `drop` hook unowed. */
      expect(
        FAILED_RE.exec(k1.stderr)?.[1] ?? null,
        "a frame slot survived the " + name + " exit path; clause 3.5 is NOT " +
          "discharged there and the drop hook becomes owed. stderr: " + k1.stderr,
      ).toBeNull();
      /* And it is not merely that nothing leaked: nothing was ABANDONED
       * either, so the clean audit is not the trivial one you get from a
       * frame that never existed. */
      expect(
        COUNT_RE.test(k1.stderr),
        "the " + name + " shape abandoned a frame; it is supposed to complete",
      ).toBe(false);
      expect(k1.code, "exit code on the " + name + " path").not.toBe(99);

      /* THE OUTPUT ORACLE, and nothing more. See the header: with the knob
       * off there is no frame, so this arm cannot fail the way the audit
       * assertions above can. It answers "did the program still compute the
       * right thing", which is a different question. */
      const k0 = await buildAndRun("c35-" + name + "-k0", src, false);
      expect(k1.stdout, "lane disagreement on stdout for " + name).toBe(k0.stdout);
      expect(k1.code, "lane disagreement on the exit code for " + name).toBe(k0.code);
    }, 600_000);
  }
});

describe("the one residue: a frame parked when the loop exits", () => {
  /* The contract calls this "exactly what happens to an abandoned fiber
   * today". MEASURED, IT IS NOT EXACTLY THAT, and the difference is a
   * process exit code -- the loudest observable a program has.
   *
   * scr_console.c:61-64 prints the coroutine line and FALLS THROUGH to the
   * leak check, which finds the abandoned frame's deliberately retained
   * payload and calls _Exit(99). scr_console.c:67-71 prints the fiber
   * notice and RETURNS, so the leak check never runs and the process exits 0.
   *
   * Both halves are deliberate where they were written -- the coroutine line
   * exists precisely so the failure is EXPLAINED rather than silent -- so
   * this test pins the divergence instead of erasing it. What it refuses to
   * let stand is the contract sentence claiming the two lanes behave alike,
   * because that sentence is the stated reason for leaving 3.5's residue
   * open, and it is false in the reassuring direction. */
  test("the two lanes diverge, and the divergence is the EXIT CODE", async () => {
    const k1 = await buildAndRun("c35-parked-k1", PARKED_FOREVER, true);
    const k0 = await buildAndRun("c35-parked-k0", PARKED_FOREVER, false);

    expect(k1.stdout, "both lanes must still run the program").toBe(k0.stdout);

    /* Stackless: named, counted, and FAILED. */
    expect(Number(COUNT_RE.exec(k1.stderr)?.[1] ?? "-1"),
      "one frame was abandoned and the line must say so; stderr: " + k1.stderr).toBe(1);
    expect(FAILED_RE.test(k1.stderr),
      "the abandoned frame's payload must still reach the leak check; stderr: " + k1.stderr).toBe(true);
    expect(k1.code, "the leak check answers with _Exit(99)").toBe(99);

    /* Fiber: named, and SKIPPED. */
    expect(Number(FIBER_SKIP_RE.exec(k0.stderr)?.[1] ?? "-1"),
      "the fiber lane must print its own skip notice; stderr: " + k0.stderr).toBe(1);
    expect(FAILED_RE.test(k0.stderr),
      "the fiber lane returns before the leak check and must not report one").toBe(false);
    expect(k0.code, "the fiber lane exits cleanly on the same source").toBe(0);

    /* The sentence under test, stated as an assertion rather than as prose. */
    expect(k1.code === k0.code,
      "docs/stackless-frame-contract.md:141-143 claims an abandoned frame behaves " +
        "'exactly' as an abandoned fiber. If this ever becomes true, that sentence " +
        "is correct again and this test is the thing to delete.").toBe(false);
  }, 600_000);
});
