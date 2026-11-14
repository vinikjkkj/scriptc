/* STABLE NAMES FOR THE EMITTERS' COUNTER-NAMED HELPERS (backend/helper-names.ts), AND FOR THE PER-RECORD-SHAPE SYMBOLS (backend/mangle.ts
 * shape tokens: sc_rs_r<n>, sc_rnew_r<n>, sc_rretain_r<n>, sc_rrelease_r<n>, sc_rtrace_r<n>, sc_rgcfree_r<n>, where <n> comes from the
 * shape's structure and not from the frontend's first-seen shape number).
 *
 * sc_td_N, sc_dc_N, sc_da_N, sc_dm_N ... used to be numbered by the order the emitter first needed them, so a cast added early renumbered
 * every helper after it and any symbol-keyed profile or section-ordering file went stale. They are now named from what they are. This
 * file pins the property on both backends:
 *
 *   - the same source emitted twice carries the identical set of helper symbols;
 *   - the same program with an unrelated cast of a NEW shape inserted above everything keeps every helper name of the original (the new
 *     cast only ADDS names), while with SCRIPTC_STABLE_NAMES=0 (the counter names, the negative control) the same edit renames some;
 *   - every helper symbol is a plain identifier and is unique.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { emitModule } from "../src/backend/emission/emitter.js";
import { emitLlvmModule } from "../src/backend/llvm/emitter.js";
import type { IrModule } from "../src/ir/nodes.js";
import { lowerToIr } from "../src/frontend/lowering/lowerer.js";
import { loadProgram } from "../src/frontend/program.js";

const BASE = `
type P = string | number | null;
interface Rec { id: number; name: string; tags: string[] }
function asRec(x: unknown): Rec { return x as Rec; }
function asNums(x: unknown): number[] { return x as number[]; }
function asP(x: unknown): P[] { return x as P[]; }
function take(x: any): string { return JSON.stringify(x); }
const r: Rec = { id: 1, name: "a", tags: ["t"] };
console.log(take(r), take([1, 2, 3]), take(["x", 2, null]));
console.log(asRec(JSON.parse('{"id":2,"name":"b","tags":[]}')).name, asNums(JSON.parse("[1,2]")).length, asP(JSON.parse('["a",1,null]')).length);
`;
const EDITED = `
interface Other { q: boolean; z: number[] }
function asOther(x: unknown): Other { return x as Other; }
console.log(asOther(JSON.parse('{"q":true,"z":[1]}')).z.length);
${BASE}`;

const saved = process.env["SCRIPTC_STABLE_NAMES"];
afterEach(() => {
  if (saved === undefined) delete process.env["SCRIPTC_STABLE_NAMES"];
  else process.env["SCRIPTC_STABLE_NAMES"] = saved;
});

function lower(source: string): IrModule {
  const dir = mkdtempSync(join(tmpdir(), "scriptc-helpernames-"));
  const entry = join(dir, "main.ts");
  writeFileSync(entry, source);
  const load = loadProgram(entry);
  const r = lowerToIr(load.program, load.entry, load.moduleOrder);
  expect(r.diagnostics.map((d) => `${d.code} ${d.message}`)).toEqual([]);
  return r.module!;
}

const FAMILIES = "dc|dlit|da|td|dm|ut|ue|us|uj|jw|pda|velem|vsync|rsm|dfk|dfs|dfb|dfa|rkg|rks";
const SYM = new RegExp(`\\bsc_(?:${FAMILIES})_[0-9a-z]+(?:_\\d+)?\\b|\\bsc_(?:rs|rnew|rretain|rrelease|rtrace|rgcfree)_r[0-9]+(?:_\\d+)?\\b`, "g");

function symbols(text: string): string[] {
  return [...new Set(text.match(SYM) ?? [])].sort();
}

for (const [label, emit] of [
  ["C", (m: IrModule) => emitModule(m)],
  ["LLVM", (m: IrModule) => emitLlvmModule(m)],
] as const) {
  test(`${label}: the same source emitted twice carries the same helper symbols`, () => {
    delete process.env["SCRIPTC_STABLE_NAMES"];
    const a = symbols(emit(lower(BASE)));
    const b = symbols(emit(lower(BASE)));
    expect(a.length).toBeGreaterThan(5);
    expect(b).toEqual(a);
  });

  test(`${label}: an unrelated cast of a new shape keeps every helper name of the original, and the counter names do not`, () => {
    delete process.env["SCRIPTC_STABLE_NAMES"];
    const a = symbols(emit(lower(BASE)));
    const b = new Set(symbols(emit(lower(EDITED))));
    expect(a.filter((s) => !b.has(s))).toEqual([]);
    expect(b.size).toBeGreaterThan(a.length);
    /* negative control: with counter names the edit changes what the names mean, so the same set check cannot tell and the TEXT of a
     * helper's definition is compared instead: the first helper's body under its name differs between the two programs */
    process.env["SCRIPTC_STABLE_NAMES"] = "0";
    const ta = emit(lower(BASE));
    const tb = emit(lower(EDITED));
    const body = (t: string, name: string): string => {
      const i = t.indexOf(`${name}(`);
      return t.slice(i, i + 400);
    };
    const names = symbols(ta).filter((s) => /_\d+$/.test(s));
    expect(names.length).toBeGreaterThan(3);
    expect(names.some((n) => body(ta, n) !== body(tb, n))).toBe(true);
  });

  test(`${label}: helper symbols are unique plain identifiers`, () => {
    delete process.env["SCRIPTC_STABLE_NAMES"];
    const text = emit(lower(EDITED));
    const defs = [...text.matchAll(new RegExp(`^[^\\n;]*\\b(sc_(?:${FAMILIES})_[0-9a-z]+(?:_\\d+)?)\\([^\\n]*\\{`, "gm"))].map((m) => m[1]!);
    expect(new Set(defs).size).toBe(defs.length);
  });
}
