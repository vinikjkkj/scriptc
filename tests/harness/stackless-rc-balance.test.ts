/* WHAT ENTERS THE PARK LEAVES WITH THE SAME COUNT.
 *
 * The guards in stackless-values.test.ts prove the lane ANSWERS what the
 * fiber lane answers. They cannot see a REFERENCE COUNT: a coroutine that
 * returns the right value and leaks the object graph behind it passes every
 * one of them. This file is that missing axis, and it exists because the gap
 * shipped a real defect.
 *
 * THE DEFECT, measured on six lines. coroFrameLocals built the frame from
 * liveness's LIVE SET -- "will be read again" -- while the release path at
 * function end touches every OWNED local. Those two disagree exactly where a
 * local is never read after the suspension but still owns a reference. A
 * resume RE-ENTERS the resume function, so its C locals run their "= NULL"
 * declarations again before the dispatch goto; an unspilled owned local was
 * therefore NULL by the time its release ran, the release was a no-op, and
 * the whole graph it owned leaked.
 *
 *   const o = new Holder(...)    // +1, and never read after the await
 *   const s = o.name             // +1, read after -- so IT was spilled
 *   const n = await p(1)
 *   console.log(s.length + n)    // leaked: 1 object, 2 strings, 1 array
 *
 * Measured width on the user's own program before the fix: 707 of 990
 * converted functions (71.4%) held at least one owned local the frame did
 * not carry, 1,849 in all. Binding a field read to a local before an await
 * is an ordinary idiom, which is why this was never a corner case.
 *
 * THE CONTROL THE RULE HAS TO EXPLAIN is the last row: reading o.name AFTER
 * the park makes o live, so it was always in the frame and never leaked.
 * That is what makes "every owned local" the right rule rather than the
 * lazier "every local", which would also pass these rows.
 *
 * ARMING, done rather than asserted: take the fn.locals loop out of
 * coroFrameLocals in emit-coro.ts and the first four rows go red by name
 * while field-after-park stays green.
 *
 * WHY EVERY ROW CARRIES THREE LIVENESS CHECKS. A clean audit means nothing
 * from a program that did not run, from a binary with no audit compiled in,
 * or from a function the lane never converted. All three produced false
 * clean results while this was being found -- one batch of sixteen rows was
 * a broken process invocation reporting NONE every single time. So each row
 * asserts the audit is in the binary, the body really is a coroutine, and
 * the program printed output of its own, before it believes a clean audit. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const repoRoot = join(import.meta.dirname, "../..");
const cacheDir = join(repoRoot, "node_modules/.cache/scriptc-tests");

const HEAD = [
  "class Holder {",
  "  name: string",
  "  items: string[]",
  '  constructor(n: string) { this.name = n; this.items = [n, n + "2"] }',
  "}",
  "async function p(n: number): Promise<number> { return n + 1 }",
  'async function ps(n: number): Promise<string> { return "v" + String(n) }',
  "",
].join("\n");

/** Each case prints exactly one line of its own, so "did it run" is checkable. */
const CASES: ReadonlyArray<{ name: string; why: string; src: string }> = [
  {
    name: "field-string",
    why: "a local bound to a string field read, never read after the park",
    src: [
      "async function main(): Promise<void> {",
      '  const o = new Holder("x" + String(Date.now() % 3))',
      "  const s = o.name",
      "  const n = await p(1)",
      "  console.log(s.length + n)",
      "}",
      "void main()",
      "",
    ].join("\n"),
  },
  {
    name: "field-array",
    why: "the same shape over an array field -- the leak is structural, not per type",
    src: [
      "async function main(): Promise<void> {",
      '  const o = new Holder("x" + String(Date.now() % 3))',
      "  const a = o.items",
      "  const n = await p(1)",
      "  console.log(a.length + n)",
      "}",
      "void main()",
      "",
    ].join("\n"),
  },
  {
    name: "field-before-park",
    why: "used BEFORE the park and never after -- being in SCOPE at the park is enough",
    src: [
      "async function main(): Promise<void> {",
      '  const o = new Holder("x" + String(Date.now() % 3))',
      "  const s = o.name",
      "  const n = await p(s.length)",
      "  console.log(n)",
      "}",
      "void main()",
      "",
    ].join("\n"),
  },
  {
    name: "abort-signal",
    why: "the shape this was found through: a signal bound off its own controller",
    src: [
      "async function main(): Promise<void> {",
      "  const c = new AbortController()",
      "  const sig = c.signal",
      "  const n = await p(1)",
      "  console.log((sig.aborted ? 1 : 0) + n)",
      "}",
      "void main()",
      "",
    ].join("\n"),
  },
  /* THE assign ROUTES. A different question from the four rows above, and
   * here because lifting the rootOk carve-out for "assign" put a RELEASE
   * PATH inside a coroutine for the first time.
   *
   * Those rows all leak by FAILING to release. An assign can be wrong the
   * other way too: each of its five emitter routes overwrites a binding
   * that already held a reference, so each must release the OLD value
   * EXACTLY ONCE, on the far side of a park, after the resume has re-run
   * the C locals' "= NULL" declarations. One release too few is a leak and
   * one too many is a double free, and the value guards in
   * stackless-values.test.ts see NEITHER -- they read the new value, which
   * is correct under both failures.
   *
   * Route by route: C3 releases the local (emit-stmts.ts:538), A releases a
   * module static (:516), C2 releases through the box (:535), and B is the
   * odd one -- emitStrAccum MOVES the accumulator's own reference into the
   * concat (:1376-1378) instead of releasing it, so a release there would
   * BE the double free. */
  {
    name: "assign-overwrite-local",
    why: "route C3: a refcounted local overwritten across a park -- the old value is released after the resume",
    src: [
      "async function main(): Promise<void> {",
      '  let s = new Holder("x" + String(Date.now() % 3)).name',
      "  s = await ps(1)",
      "  console.log(s.length)",
      "}",
      "void main()",
      "",
    ].join("\n"),
  },
  {
    name: "assign-global",
    why: "route A: the target is a C static, not a frame field, and its old value is released on the far side of the park",
    src: [
      'let g = "g" + String(Date.now() % 3)',
      "async function main(): Promise<void> {",
      "  g = await ps(1)",
      "  console.log(g.length)",
      "}",
      "void main()",
      "",
    ].join("\n"),
  },
  {
    name: "assign-accumulator",
    why: "route B: emitStrAccum MOVES the accumulator in rather than releasing it, and reads the target back AFTER the park",
    src: [
      "async function main(): Promise<void> {",
      '  let s = "a" + String(Date.now() % 3)',
      "  s += await ps(1)",
      "  console.log(s.length)",
      "}",
      "void main()",
      "",
    ].join("\n"),
  },
  {
    name: "assign-boxed",
    why: "route C2: the store goes through the box, so scr_box_set_ref owns the release of the old value",
    src: [
      "async function main(): Promise<void> {",
      '  let s = "a" + String(Date.now() % 3)',
      "  const c = (): number => s.length",
      "  s = await ps(1)",
      "  console.log(s.length + c())",
      "}",
      "void main()",
      "",
    ].join("\n"),
  },
  {
    name: "assign-scalar",
    why: "THE CONTROL: a non-refcounted target runs no release at all, so it stays green and shows the axis is the release and not the assign",
    src: [
      "async function main(): Promise<void> {",
      "  let n = 0",
      "  n = await p(1)",
      "  console.log(n)",
      "}",
      "void main()",
      "",
    ].join("\n"),
  },
  /* THE HOP. `await <non-promise>` lowers to a hidden `%awaited` local, an
   * async.hop, and a read of that local on the far side (lower-exprs.ts:2120).
   * When the operand is refcounted that hidden local owns a reference ACROSS
   * the park and is on the release path at function end -- the same shape the
   * four rows above were written for, reached through a point that is not an
   * IR node kind. It is worth its own rows because the hop is the first point
   * whose frame membership nobody chose by hand: `%awaited` is an ordinary
   * IrLocal, so coroFrameLocals carries it only because it is refcounted. */
  {
    name: "hop-string",
    why: "a hidden %awaited local holding a string across a bare hop",
    src: [
      "async function main(): Promise<void> {",
      '  const s = await ("h" + String(Date.now() % 3))',
      "  console.log(s.length)",
      "}",
      "void main()",
      "",
    ].join("\n"),
  },
  {
    name: "hop-array",
    why: "the same through an array operand -- the leak would be the whole graph, not one string",
    src: [
      "async function main(): Promise<void> {",
      '  const a = await [new Holder("x" + String(Date.now() % 3)).name]',
      "  console.log(a.length)",
      "}",
      "void main()",
      "",
    ].join("\n"),
  },
  {
    name: "hop-scalar",
    why: "THE CONTROL: an f64 operand puts nothing refcounted across the hop, so it stays green",
    src: [
      "async function main(): Promise<void> {",
      "  const n = await (Date.now() % 3)",
      "  console.log(n >= 0 ? 1 : 0)",
      "}",
      "void main()",
      "",
    ].join("\n"),
  },
  {
    name: "field-after-park",
    why: "THE CONTROL: reading the field after the park makes the object live, so it was in the frame all along and never leaked",
    src: [
      "async function main(): Promise<void> {",
      '  const o = new Holder("x" + String(Date.now() % 3))',
      "  const n = await p(1)",
      "  console.log(o.name.length + n)",
      "}",
      "void main()",
      "",
    ].join("\n"),
  },
];

async function build(name: string, src: string): Promise<{ exe: string; c: string }> {
  const prevKnob = process.env["SCRIPTC_STACKLESS"];
  const prevAudit = process.env["SCRIPTC_RC_AUDIT"];
  process.env["SCRIPTC_STACKLESS"] = "1";
  process.env["SCRIPTC_RC_AUDIT"] = "1";
  try {
    const full = HEAD + src;
    const key = createHash("sha256").update(full).update("rcbalance").digest("hex").slice(0, 16);
    const outDir = join(cacheDir, `rcbalance-${name}-${key}`);
    mkdirSync(outDir, { recursive: true });
    const file = join(outDir, "main.ts");
    writeFileSync(file, full);
    const r = await compile(file, {
      outPath: join(outDir, exeName("prog")),
      outDir,
      backend: "c",
      keepC: true,
      sanitize: false,
    });
    if (!r.ok) {
      throw new Error(
        `${name} failed to compile:\n` +
          r.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"),
      );
    }
    return { exe: r.binaryPath, c: readFileSync(join(outDir, "main.c"), "utf8") };
  } finally {
    if (prevKnob === undefined) delete process.env["SCRIPTC_STACKLESS"];
    else process.env["SCRIPTC_STACKLESS"] = prevKnob;
    if (prevAudit === undefined) delete process.env["SCRIPTC_RC_AUDIT"];
    else process.env["SCRIPTC_RC_AUDIT"] = prevAudit;
  }
}

describe("a coroutine returns every reference it took across a park", () => {
  test.for(CASES.map((c) => [c.name, c] as const))(
    "%s",
    async ([, c]) => {
      const built = await build(c.name, c.src);

      // (1) The audit is compiled IN. Without this a clean result is a
      //     DID-NOT-RUN wearing a pass.
      expect(
        readFileSync(built.exe).includes(Buffer.from("scriptc RC audit")),
        `${c.name}: the binary carries no RC audit, so a clean result proves nothing`,
      ).toBe(true);

      // (2) The body really is a coroutine. A shape that quietly stops
      //     converting would make this file green by not testing the lane.
      expect(
        built.c.includes("sc_cr_main("),
        `${c.name}: main is not a coroutine here -- the knob did not reach the emitter`,
      ).toBe(true);

      // (3) The program ran. The audit exits nonzero on a leak, so a
      //     throwing spawn is the expected path and the output is on the error.
      let out = "";
      try {
        out = execFileSync(built.exe, [], {
          encoding: "utf8",
          timeout: 120_000,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (e: unknown) {
        const err = e as { stdout?: string; stderr?: string };
        out = String(err.stdout ?? "") + String(err.stderr ?? "");
      }
      const own = out.split("\n").filter((l) => /\S/.test(l) && !l.startsWith("scriptc"));
      expect(
        own.length,
        `${c.name}: the program printed nothing of its own -- it did not run:\n${out}`,
      ).toBeGreaterThan(0);

      // (4) THE AXIS. Nothing refcounted may outlive the program.
      const failed = /scriptc RC AUDIT FAILED: .*? live at exit/.exec(out);
      expect(
        failed?.[0] ?? null,
        `${c.name} (${c.why}) -- the coroutine did not return every reference it took`,
      ).toBeNull();
    },
    600_000,
  );
});
