/* A record with a run of interchangeable members converts through ONE loop over a table of them, not one block per member.
 *
 * The to-dyn converter and the dynCheck builder of a record emit one block of C (or LLVM IR) per member; a record with 2,151 members (zapo's WA_ABPROPS) was
 * 400 KB of straight-line code per helper. field-loop.ts (C) and backend/llvm/dyn.ts (LLVM) turn a run of SCRIPTC_FIELD_LOOP_MIN (default 8) or more members
 * that differ only in the member they handle into a loop over a static table; any member that differs ends the run and keeps the unrolled code.
 *
 * Three obligations:
 *   - the loop is really emitted for a wide uniform record and NOT for a narrow one (positive control and threshold);
 *   - SCRIPTC_FIELD_LOOP_MIN=0 turns it off and gives today's code (negative control), and the program answers the same either way;
 *   - the answer is Node's, on both backends, including the text of a failing member, which carries ITS OWN key from the table. */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const linux = process.platform === "linux";

function program(members: number): string {
  const L: string[] = [];
  L.push("interface Cell { code: number; label: string; on: boolean }");
  L.push("function mk(i: number): Cell { return { code: i * 3 + 1, label: 'cell' + i, on: i % 3 === 0 }; }");
  L.push("type Wide = {");
  for (let i = 0; i < members; i++) L.push(`  c${i}: Cell;`);
  L.push("};");
  L.push("const wide: Wide = {");
  for (let i = 0; i < members; i++) L.push(`  c${i}: mk(${i}),`);
  L.push("};");
  L.push("function through(x: unknown): unknown { return x; }");
  L.push("function check(doc: unknown): string { try { const w = doc as Wide; return 'ok ' + w.c0.code + ' ' + w.c" + (members - 1) + ".label; } catch (e) { return (e as Error).message; } }");
  L.push("const u = through(wide);");
  L.push("console.log(JSON.stringify(u).length, Object.keys(u as object).length);");
  L.push("const base = JSON.stringify(wide);");
  L.push("console.log(check(JSON.parse(base)));");
  L.push("const d1 = JSON.parse(base); delete d1.c" + Math.min(13, members - 1) + "; console.log(check(d1));");
  L.push("const d2 = JSON.parse(base); d2.c" + Math.min(5, members - 1) + ".code = 'x'; console.log(check(d2));");
  L.push("const d3 = JSON.parse(base); d3.c" + (members - 1) + " = null; console.log(check(d3));");
  return L.join("\n") + "\n";
}

const saved: Record<string, string | undefined> = {};
const keys = ["SCRIPTC_CACHE_DIR", "SCRIPTC_FIELD_LOOP_MIN", "SCRIPTC_KEEP_C"] as const;

async function build(dir: string, tag: string, backend: "c" | "llvm", min: string | undefined): Promise<{ bin: string; text: string }> {
  if (min === undefined) delete process.env["SCRIPTC_FIELD_LOOP_MIN"];
  else process.env["SCRIPTC_FIELD_LOOP_MIN"] = min;
  const sub = join(dir, tag);
  mkdirSync(sub, { recursive: true });
  const r = await compile(join(dir, "m.ts"), { outPath: join(sub, exeName("m")), outDir: sub, backend });
  if (!r.ok) throw new Error(r.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
  return { bin: r.binaryPath, text: readFileSync(r.cPath, "utf8") };
}

describe.skipIf(!linux)("a record of identical members converts through one loop over a field table", () => {
  beforeAll(() => {
    for (const k of keys) saved[k] = process.env[k];
    process.env["SCRIPTC_CACHE_DIR"] = mkdtempSync(join(tmpdir(), "scriptc-fieldloop-cache-"));
  });
  afterAll(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  for (const backend of ["c", "llvm"] as const) {
    test(`${backend}: present for 40 members, absent for 4 and when disabled, same answers as Node and as each other`, async () => {
      const dir = mkdtempSync(join(tmpdir(), `scriptc-fieldloop-${backend}-`));
      writeFileSync(join(dir, "m.ts"), program(40));
      const node = execFileSync(process.execPath, ["--experimental-strip-types", join(dir, "m.ts")], { encoding: "utf8" });
      const marker = backend === "c" ? "members of one shape and one kind of handling" : "@sc_ft_";

      const on = await build(dir, "on", backend, undefined);
      expect(on.text, "no field-table loop in the default build of a 40-member record").toContain(marker);
      const off = await build(dir, "off", backend, "0");
      expect(off.text, "SCRIPTC_FIELD_LOOP_MIN=0 must give the unrolled code").not.toContain(marker);
      expect(on.text.length, "the looped helpers must be smaller than the unrolled ones").toBeLessThan(off.text.length);

      const gotOn = execFileSync(on.bin, [], { encoding: "utf8" });
      const gotOff = execFileSync(off.bin, [], { encoding: "utf8" });
      expect(gotOn).toBe(gotOff);
      // Node does not check an `as` cast: only the success lines and the key list can be compared with it; the failure texts are compared loops-on against loops-off
      expect(gotOn.split("\n").slice(0, 2).join("\n")).toBe(node.split("\n").slice(0, 2).join("\n"));
      expect(gotOn).toContain("expected number at $.c5.code, got string");
      expect(gotOn).toContain("expected object at $.c13, got undefined");
      expect(gotOn).toContain("expected object at $.c39, got null");

      // below the threshold the record keeps its unrolled blocks
      writeFileSync(join(dir, "m.ts"), program(4));
      const narrow = await build(dir, "narrow", backend, undefined);
      expect(narrow.text).not.toContain(marker);
    }, 600_000);
  }
});
