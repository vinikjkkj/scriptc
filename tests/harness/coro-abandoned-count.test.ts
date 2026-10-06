/* The three proofs owed by the abandoned-coroutine line.
 *
 * The line exists because a coroutine parked on a promise nothing settles is
 * never resumed, every release of its owned frame slots is emitted AFTER the
 * resume label, and the RC audit therefore reported the frame as a leak. The
 * fiber lane already exempts that shape -- but it exempts it ALOUD, with a
 * skip notice. This is the stackless half of that symmetry.
 *
 * WHAT EACH PROOF IS FOR:
 *
 *   1. THE EXACT NUMBER, not "non-zero". A line that counts 1 where there
 *      are 3 is born wrong and looks right, and nothing downstream would
 *      ever catch it. So the program abandons a KNOWN count and the line
 *      must equal it. Two different counts, because a line that always
 *      prints "1" passes a single-count test.
 *
 *   2. BOTH DIRECTIONS. It must appear when there is abandonment and it must
 *      NOT appear when there is none. A detector that cannot stay silent is
 *      not a detector.
 *
 *   3. KNOB-ABSENT CONTAINMENT, MEASURED. This is a runtime change and the
 *      runtime is compiled into everything. The argument "with the knob off
 *      the count is zero, so nothing changes" is the shape of argument that
 *      failed twice in one day, so it is not offered: the shipping binary is
 *      scanned for the literal, and a knob-absent run is executed.
 *
 * Source strings are built by joining on String.fromCharCode(10) rather than
 * written with escapes. Eight times today an escape crossing a second parse
 * layer was silently eaten, once planting a 0x08 into a deliverable.
 */
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const execFileAsync = promisify(execFile);
const NL = String.fromCharCode(10);
let workDir = "";

beforeAll(() => { workDir = mkdtempSync(join(tmpdir(), "scriptc-coroabandon-")); });
afterAll(() => { rmSync(workDir, { recursive: true, force: true }); });

/* N coroutines that park forever: each awaits a promise with no resolver,
 * and each is called WITHOUT await so nothing keeps them alive or settles
 * them. One frame per call, so the abandoned count is exactly N. */
function abandonSrc(n: number): string {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.push("async function a" + i + "(): Promise<void> {");
    out.push("  await new Promise<void>((): void => {})");
    out.push("}");
  }
  for (let i = 0; i < n; i++) out.push("void a" + i + "()");
  out.push("console.log('done')");
  return out.join(NL) + NL;
}

/* The silent case: an async function that COMPLETES. Its frame reaches
 * scr_coro_finish_void and is released, so the live count at exit is 0. */
const SETTLED_SRC = [
  "async function s(): Promise<number> {",
  "  const v = await Promise.resolve(1)",
  "  return v",
  "}",
  "s().then((v): void => { console.log('done', v) })",
].join(NL) + NL;

function stage(name: string, src: string): string {
  const dir = join(workDir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "main.ts"), src, "utf8");
  return dir;
}

async function buildAndRun(
  name: string, src: string, opts: { knob: boolean; audit: boolean },
): Promise<{ stdout: string; stderr: string; binary: string }> {
  const dir = stage(name, src);
  const prevKnob = process.env["SCRIPTC_STACKLESS"];
  const prevAudit = process.env["SCRIPTC_RC_AUDIT"];
  if (opts.knob) process.env["SCRIPTC_STACKLESS"] = "1";
  else delete process.env["SCRIPTC_STACKLESS"];
  if (opts.audit) process.env["SCRIPTC_RC_AUDIT"] = "1";
  else delete process.env["SCRIPTC_RC_AUDIT"];
  try {
    const built = await compile(join(dir, "main.ts"), {
      outPath: join(dir, exeName("program")), outDir: dir, backend: "c",
    });
    expect(built.ok, (built.diagnostics ?? []).map((d) => d.code).join(",")).toBe(true);
    let stdout = "";
    let stderr = "";
    try {
      const r = await execFileAsync(built.binaryPath!, [], { encoding: "utf8", timeout: 120_000 });
      stdout = r.stdout; stderr = r.stderr;
    } catch (e) {
      const x = e as { stdout?: string; stderr?: string };
      stdout = x.stdout ?? ""; stderr = x.stderr ?? "";
    }
    return { stdout, stderr, binary: built.binaryPath! };
  } finally {
    if (prevKnob === undefined) delete process.env["SCRIPTC_STACKLESS"];
    else process.env["SCRIPTC_STACKLESS"] = prevKnob;
    if (prevAudit === undefined) delete process.env["SCRIPTC_RC_AUDIT"];
    else process.env["SCRIPTC_RC_AUDIT"] = prevAudit;
  }
}

const COUNT_RE = /scriptc RC audit: ([0-9]+) coroutine\(s\) abandoned/;

describe("the abandoned-coroutine line", () => {
  test("PROOF 1: the count is EXACT, at two different values", async () => {
    for (const n of [1, 3]) {
      const { stderr } = await buildAndRun("exact" + n, abandonSrc(n), { knob: true, audit: true });
      const m = COUNT_RE.exec(stderr);
      expect(m, "no coroutine line for " + n + " abandoned; stderr was: " + stderr).not.toBeNull();
      /* The number, not its presence. Two values, because a line hardcoded
       * to 1 would satisfy a single-count test. */
      expect(Number(m![1]), "line must report " + n).toBe(n);
    }
  }, 300_000);

  test("PROOF 2 (the silent direction): no abandonment, no line", async () => {
    const { stdout, stderr } = await buildAndRun("settled", SETTLED_SRC, { knob: true, audit: true });
    expect(stdout.trimEnd().endsWith("done 1")).toBe(true);
    expect(stderr, "a completed coroutine must not be reported as abandoned").not.toMatch(COUNT_RE);
  }, 300_000);

  test("PROOF 3a: knob ABSENT prints no coroutine line, even when abandoning", async () => {
    /* Knob off, so the awaits lower to fibers and no coroutine frame exists.
     * The fiber lane's own skip notice may appear -- that is its business and
     * is unchanged by this commit; what must be absent is OUR line. */
    const { stderr } = await buildAndRun("knoboff", abandonSrc(3), { knob: false, audit: true });
    expect(stderr, "the coroutine line must not appear on the fiber lane").not.toMatch(COUNT_RE);
  }, 300_000);

  test("PROOF 3b: the line is compiled OUT of a shipping binary", async () => {
    /* Containment measured on the artefact rather than argued from the
     * ifdef. A shipping build has no SCR_RC_AUDIT, so the literal must not
     * be present in the image at all. */
    const { binary } = await buildAndRun("shipping", abandonSrc(3), { knob: true, audit: false });
    const bytes = readFileSync(binary);
    expect(
      bytes.includes("coroutine(s) abandoned"),
      "the audit-only line reached a binary built without SCR_RC_AUDIT",
    ).toBe(false);
  }, 300_000);
});

/* STILL OWED, and named rather than silently omitted: byte-identity of
 * stdout, stderr and the emitted C for a knob-absent build against the
 * PARENT commit. That is a cross-commit comparison and needs a second
 * worktree at the parent; it cannot be expressed inside one tree, and the
 * two tests above bound the claim without establishing it. */
