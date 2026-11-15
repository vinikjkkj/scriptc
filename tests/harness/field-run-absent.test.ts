/* The looped read of a REQUIRED-ABSENT member keeps its catchable TypeError, byte for byte (ir/field-run-loops.ts, recordGetAt).
 *
 * `{} as Record<Union, V>` filled in part, then widened to `Record<string, V>`, runs the %rec.capture helper over EVERY member, unguarded: the first member the completion never
 * filled throws SC9005 (a TypeError naming it) where Node answers undefined (a documented stance, SEMANTICS.md). The loop's read carries the same test and builds the same text
 * (scr_throw_absent_key). Node cannot be the oracle for the throwing lines, so the obligations are:
 *   - the default build really loops (the call to scr_throw_absent_key is in the code) and SCRIPTC_FIELD_LOOP_MIN=0 does not;
 *   - loops on and loops off answer identically, on C and on LLVM, and the answer names the first absent member (k05 is index 5 of the run: not just member 0);
 *   - the TypeError is catchable (the caller tests for it: may-throw knows a reqabsent read throws);
 *   - the line with no absent member is Node's. */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const linux = process.platform === "linux";
const SOURCE = `interface Cell { code: number }
type N = "k00" | "k01" | "k02" | "k03" | "k04" | "k05" | "k06" | "k07" | "k08" | "k09" | "k10" | "k11";
function make(upto: number): Record<N, Cell> {
  const acc = {} as Record<N, Cell>;
  if (upto > 0) acc.k00 = { code: 0 };
  if (upto > 1) acc.k01 = { code: 1 };
  if (upto > 2) acc.k02 = { code: 2 };
  if (upto > 3) acc.k03 = { code: 3 };
  if (upto > 4) acc.k04 = { code: 4 };
  if (upto > 5) acc.k05 = { code: 5 };
  if (upto > 6) acc.k06 = { code: 6 };
  if (upto > 7) acc.k07 = { code: 7 };
  if (upto > 8) acc.k08 = { code: 8 };
  if (upto > 9) acc.k09 = { code: 9 };
  if (upto > 10) acc.k10 = { code: 10 };
  if (upto > 11) acc.k11 = { code: 11 };
  return acc;
}
function tryCapture(upto: number): string {
  try { const w: Record<string, Cell> = make(upto); return 'ok ' + Object.keys(w).length; } catch (e) { return (e as Error).name + ': ' + (e as Error).message; }
}
console.log(tryCapture(12));
console.log(tryCapture(5));
console.log(tryCapture(0));
console.log(tryCapture(11));
`;

const saved: Record<string, string | undefined> = {};
const keys = ["SCRIPTC_CACHE_DIR", "SCRIPTC_FIELD_LOOP_MIN"] as const;

async function build(dir: string, tag: string, backend: "c" | "llvm", min: string | undefined): Promise<{ bin: string; text: string }> {
  if (min === undefined) delete process.env["SCRIPTC_FIELD_LOOP_MIN"];
  else process.env["SCRIPTC_FIELD_LOOP_MIN"] = min;
  const sub = join(dir, tag);
  mkdirSync(sub, { recursive: true });
  const r = await compile(join(dir, "m.ts"), { outPath: join(sub, exeName("m")), outDir: sub, backend });
  if (!r.ok) throw new Error(r.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
  return { bin: r.binaryPath, text: readFileSync(r.cPath, "utf8") };
}

describe.skipIf(!linux)("a looped read of a required-absent member throws the unrolled read's TypeError", () => {
  beforeAll(() => {
    for (const k of keys) saved[k] = process.env[k];
    process.env["SCRIPTC_CACHE_DIR"] = mkdtempSync(join(tmpdir(), "scriptc-fieldrun-absent-cache-"));
  });
  afterAll(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  for (const backend of ["c", "llvm"] as const) {
    test(`${backend}: loops on and off answer the same TypeError text, naming the first absent member`, async () => {
      const dir = mkdtempSync(join(tmpdir(), `scriptc-fieldrun-absent-${backend}-`));
      writeFileSync(join(dir, "m.ts"), SOURCE);
      const marker = backend === "c" ? "scr_throw_absent_key" : "@scr_throw_absent_key";
      const on = await build(dir, "on", backend, undefined);
      expect(on.text, "the default build must loop the capture helper").toContain(marker);
      const off = await build(dir, "off", backend, "0");
      expect(off.text, "SCRIPTC_FIELD_LOOP_MIN=0 must give the unrolled reads").not.toContain(marker);
      const gotOn = execFileSync(on.bin, [], { encoding: "utf8" });
      const gotOff = execFileSync(off.bin, [], { encoding: "utf8" });
      expect(gotOn).toBe(gotOff);
      const lines = gotOn.trimEnd().split("\n");
      expect(lines[0]).toBe("ok 12");
      expect(lines[1]).toMatch(/^TypeError: reading 'k05': this value was completed from a narrower record and never carried that key \(JavaScript answers undefined here, and r\d+\.k05 has no undefined arm to hold it\)$/);
      expect(lines[2]).toContain("reading 'k00'");
      expect(lines[3]).toContain("reading 'k11'");
    }, 600_000);
  }
});
