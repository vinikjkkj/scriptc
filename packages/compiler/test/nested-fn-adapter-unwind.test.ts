/* The UNWIND after a call through a dyn-checked function member.
 *
 * Annotating an `any` value with an interface that declares a METHOD makes the
 * dyn walker mint an adapter closure (`sc_dfa_*`) which re-validates the call's
 * RESULT against the declared return type. That adapter throws. The caller has
 * to look, or the program keeps running on a NULL result — which is exactly
 * what it used to do: a `typeof` folded from the declared type printed `string`
 * over a `null`, the throw surfaced at exit instead of at the call, and
 * consuming the result read through the NULL and exited 139.
 *
 * computeMayThrow decides whether a `callValue` gets that check, and its
 * dyn-adapter guard used to test only the dynCheck's TOP-LEVEL kind. The func
 * is one level down inside a record for the ordinary spelling, so the flag
 * never set, `indirect` stayed false, and no check was emitted.
 *
 * This file asserts the emitted C directly rather than a program's stdout,
 * because the behavioral pin (tests/corpus/7355-...) can only fail LOUDLY —
 * exit 139 vs exit 1 — while the thing that actually has to hold is
 * structural: EVERY indirect call through an adapted member is followed by a
 * pending-exception test. It is emit-only, so it costs one frontend and no cc.
 *
 * Two hazards it is armed against:
 *
 *  1. VACUITY. A program that plants no adapter, or whose calls the emitter
 *     spells differently than the regex expects, would pass every assertion
 *     below while testing nothing. Both the adapter count and the call-site
 *     count are asserted non-trivial FIRST.
 *  2. AN INSTRUMENT THAT CANNOT SEE A DIFFERENCE. If the emitter simply put a
 *     pending check after every indirect call, this file would pass whatever
 *     computeMayThrow decided. The NEGATIVE control is a program with the same
 *     indirect-call shape and NO dyn check anywhere: its calls must come back
 *     bare. If that control ever starts carrying checks, the positive half has
 *     stopped meaning anything and this test says so.
 */
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { compile } from "../src/index.js";

/* POSITIVE: the func sits one level down, inside a record — the shape the
 * top-level-only guard missed. Also exercises it under a union arm and an
 * array element, so a fix that walked records alone would still fail here. */
const NESTED = [
  `interface Codec { find(k: string): string; readonly count: number }`,
  `const liar: any = { find(k: string) { return k === "hit" ? "FOUND" : null }, count: 7 };`,
  `const c: Codec = liar;`,
  `console.log("1 " + c.find("hit"));`,
  `const miss = c.find("miss");`,
  `console.log("2 " + typeof miss + " " + String(c.count));`,
  ``,
  `interface Boxed { pick(i: number): string; readonly n: number }`,
  `const boxed: any = { pick(i: number) { return "p" + String(i) }, n: 1 };`,
  `const b: Boxed = boxed;`,
  `console.log("3 " + b.pick(0) + " " + String(b.n));`,
  `export {};`,
  ``,
].join("\n");

/* NEGATIVE: the SAME indirect-call shape — a function value in a record field,
 * called through the field — with no `any` and therefore no dyn check, so no
 * adapter can exist and no pending check is owed. */
const PLAIN = [
  `interface Codec { find: (k: string) => string; readonly count: number }`,
  `const c: Codec = { find: (k: string) => k.toUpperCase(), count: 7 };`,
  `console.log("1 " + c.find("hit"));`,
  `const miss = c.find("miss");`,
  `console.log("2 " + typeof miss + " " + String(c.count));`,
  `export {};`,
  ``,
].join("\n");

/* The emitted spelling of an indirect call through a closure value:
 *   ScrStr *sc_t8 = ((ScrStr * (*)(ScrClosure *, ScrStr *))sc_t6->fn)(sc_t6, sc_t7);
 * Anchored on `->fn)(` — the closure-ABI call — so it cannot match a direct
 * call or a libCall. A cast-shaped regex was tried first and matched NOTHING
 * (the doubled `))` before the receiver defeated it); the vacuity test below
 * is what reported that, which is the whole reason it is the first test. */
const INDIRECT_CALL = /->fn\)\(/;

let dir: string | undefined;
async function emit(tag: string, program: string): Promise<string> {
  dir ??= await mkdtemp(join(tmpdir(), "scriptc-nestedfa-"));
  const src = join(dir, `${tag}.ts`);
  await writeFile(src, program, "utf8");
  const res = await compile(src, {
    outPath: join(dir, `program-${tag}`),
    outDir: dir,
    backend: "c",
    emitOnly: true,
  });
  if (!res.ok) {
    throw new Error(`${tag} did not compile: ${res.diagnostics[0]?.message ?? "?"}`);
  }
  return await readFile(res.cPath, "utf8");
}

let cached: Promise<{ nested: string; plain: string }> | undefined;
function both(): Promise<{ nested: string; plain: string }> {
  return (cached ??= (async () => ({
    nested: await emit("nested", NESTED),
    plain: await emit("plain", PLAIN),
  }))());
}

/** Every indirect call in `tu`, paired with whether the next non-blank line
 * tests the pending exception. */
function callSites(tu: string): { line: string; checked: boolean }[] {
  const lines = tu.split("\n");
  const out: { line: string; checked: boolean }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!INDIRECT_CALL.test(lines[i] ?? "")) continue;
    let j = i + 1;
    while (j < lines.length && (lines[j] ?? "").trim() === "") j++;
    out.push({ line: (lines[i] ?? "").trim(), checked: (lines[j] ?? "").includes("scr_exc_pending()") });
  }
  return out;
}

describe("a dyn-checked function member below the top level arms the unwind", () => {
  test("the programs are not vacuous: adapters exist and calls are found", async () => {
    const { nested, plain } = await both();
    // At least one adapter, i.e. the walker really did reach a func.
    expect(nested).toContain("dyn fn adapter to func");
    // Two annotated members, three calls through them.
    expect(callSites(nested).length).toBeGreaterThanOrEqual(3);
    // The control has the same call SHAPE, which is what makes it a control.
    expect(callSites(plain).length).toBeGreaterThanOrEqual(2);
  });

  test("every call through an adapted member tests the pending exception", async () => {
    const { nested } = await both();
    const bare = callSites(nested).filter((s) => !s.checked);
    expect(bare.map((s) => s.line)).toEqual([]);
  });

  test("the control's calls stay bare — the instrument can see a difference", async () => {
    // No dyn check anywhere, so `indirect` is false and these calls owe
    // nothing. If this ever flips, the assertion above has gone vacuous:
    // it would be passing because the emitter checks everything, not
    // because computeMayThrow reached the nested func.
    const { plain } = await both();
    expect(callSites(plain).every((s) => !s.checked)).toBe(true);
  });

  test("the adapter itself still validates the RESULT, not only the arguments", async () => {
    // The check the unwind exists to propagate. Without this line the
    // under-claim would never be detected at all and the three assertions
    // above would be guarding nothing.
    const { nested } = await both();
    // The DEFINITION, not the prototype: the prototype line carries the same
    // comment and ends in `;`, and slicing from it picked up a neighbouring
    // helper's body instead.
    const adapter = nested.slice(nested.indexOf("{ /* dyn fn adapter to func(string)=>string */"));
    const body = adapter.slice(adapter.indexOf("{"), adapter.indexOf("\n}"));
    expect(body).toMatch(/=\s*sc_dc_\d+\(sc_r, NULL\);/);
  });
});
