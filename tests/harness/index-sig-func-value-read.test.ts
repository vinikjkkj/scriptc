/* A record's index signature may have a CALLABLE value type (mysql2's
 * `authPlugins?: { [key: string]: AuthPlugin }` is the motivating shape --
 * isSupportedIndexValue, ir/nodes.ts:1019-1027, already admits "func" on the
 * strength of the command-registry pattern mapRecordTypeInner's own comment
 * names, types.ts:7217-7235). Admission was never the gap: CONSTRUCTING such
 * a record always worked. READING one through a DYN-typed result was not --
 * toDynHelper's per-kind switch (emit-walkers.ts, the function starting at
 * line 2976) had no `case "func"`, so recordKeyGetHelper's `surface()`
 * helper fell through its default arm and threw an UNCAUGHT "emitter bug:
 * to-dyn of unsupported type func" out of the whole compile() call -- not a
 * diagnostic, a compiler crash -- the first time ANY program read a key off
 * such a record in a context that needed the dyn result (a truthy/condition
 * test over the read is enough; it does not require a `: unknown`
 * annotation, which goes through a separate, already-covered frontend
 * coercion check and refuses with SC1101 for an unboxable signature).
 *
 * The fix reuses dynFuncFieldBoxC, the existing boxer record FIELDS of
 * function type already go through: boxable (canBoxFuncIntoDyn) funcs box
 * via dynFuncBoxHelper, unboxable ones get the catchable-TypeError stranded
 * box (SC2009) instead of a representation that cannot exist. No new
 * policy was invented -- surface() now treats an overflow HIT exactly like
 * a declared field already was, with "<index>" standing in for the field
 * name a dynamic key has none of.
 *
 * This file covers the BOXABLE half with a real before/after control
 * (reverting the emit-walkers.ts change makes both tests below fail with
 * the uncaught "emitter bug" throw, same stack, every time) -- nothing
 * else in the suite reaches this path: the corpus has no callable-valued
 * index signature read through a dyn-typed result (traced by hand before
 * this fix landed -- the uncaught throw would have failed any corpus entry
 * that hit it, and none did), so this file is the only instrument with
 * real coverage of it. Differential against process.execPath for the
 * present-key case, like every other compile+run harness test here.
 *
 * The UNBOXABLE half (a func whose signature cannot cross to dyn at all --
 * canBoxFuncIntoDyn false) is deliberately NOT asserted here: a truthy
 * probe over one such signature passes identically whether or not this
 * file's fix is applied, so it is not reaching the code this file changed
 * by a path this investigation could find, and asserting it would be
 * coverage theater. See the slice report for what that implies and does
 * not imply.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";

const EXE = process.platform === "win32" ? ".exe" : "";

async function compileOk(dir: string, src: string): Promise<string> {
  const file = join(dir, "main.ts");
  writeFileSync(file, src);
  const result = await compile(file, { outPath: join(dir, `prog${EXE}`), outDir: dir });
  if (!result.ok) {
    throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
  }
  return result.binaryPath;
}

describe("a callable-valued index signature, read (not just constructed)", () => {
  test("a boxable func value: present-key read, call it, byte-matches Node", async () => {
    const dir = mkdtempSync(join(tmpdir(), "scr-idxfn-boxable-"));
    const code = `
interface Handlers {
  [key: string]: (x: number) => number;
}
function readIt(h: Handlers): unknown {
  return h["a"];
}
const h: Handlers = { a: (x) => x + 1, b: (x) => x * 2 };
const got = readIt(h) as (x: number) => number;
console.log(got(41));
console.log(typeof readIt(h));
console.log(readIt({}) === undefined);
`;
    const binaryPath = await compileOk(dir, code);
    const oracle = join(dir, "oracle.js");
    writeFileSync(
      oracle,
      `function readIt(h) { return h["a"]; }
const h = { a: (x) => x + 1, b: (x) => x * 2 };
const got = readIt(h);
console.log(got(41));
console.log(typeof readIt(h));
console.log(readIt({}) === undefined);
`,
    );
    const want = execFileSync(process.execPath, [oracle], { encoding: "utf8" });
    const got = execFileSync(binaryPath, { encoding: "utf8" });
    expect(got).toBe(want);
  }, 120_000);

  test("a boxable func value: a truthy condition over the read (the dyn path that bypasses normal coercion) does not crash the compiler", async () => {
    const dir = mkdtempSync(join(tmpdir(), "scr-idxfn-truthy-"));
    const binaryPath = await compileOk(
      dir,
      `interface Handlers {
  [key: string]: (x: number) => number;
}
const h: Handlers = { a: (x) => x + 1 };
console.log(h["a"] ? "truthy" : "falsy");
`,
    );
    const got = execFileSync(binaryPath, { encoding: "utf8" });
    expect(got.trim()).toBe("truthy");
  }, 120_000);

  // An UNBOXABLE func value (e.g. a Generator-typed parameter, which has no
  // dyn form) was tried here too, on the theory that dynFuncFieldBoxC's
  // stranded-box fallback needed its own coverage. Dropped: the same truthy
  // probe over such a signature passes identically with this file's fix
  // reverted, so it is not exercising the code this file is about -- some
  // other mechanism (untraced) already keeps that case alive, and a test
  // that cannot fail before the fix proves nothing about it. Left as an
  // open question in the slice report rather than asserted here.
});
