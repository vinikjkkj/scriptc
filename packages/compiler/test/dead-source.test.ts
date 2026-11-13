/* DEAD-SOURCE ARRAY CROSSINGS (ir/dead-source.ts).
 *
 * The pass marks a typed-array -> dyn crossing `srcDead` only when the array's local is read exactly once, by that crossing, in the same
 * loop nesting as its declaration, and is neither boxed by a closure nor a parameter. This file pins the verdict on each case the
 * corpus row 25220 checks against Node, plus the two controls: SCRIPTC_OWNXFER=0 marks nothing, and SCRIPTC_OWNXFER_FORCE=1 marks every
 * local-array crossing (what makes the used-after row diverge from Node in the harness).
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import type { IrModule } from "../src/ir/nodes.js";
import { lowerToIr } from "../src/frontend/lowering/lowerer.js";
import { loadProgram } from "../src/frontend/program.js";

const saved = { off: process.env["SCRIPTC_OWNXFER"], force: process.env["SCRIPTC_OWNXFER_FORCE"] };
afterEach(() => {
  for (const [k, v] of [["SCRIPTC_OWNXFER", saved.off], ["SCRIPTC_OWNXFER_FORCE", saved.force]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function lower(source: string): IrModule {
  const dir = mkdtempSync(join(tmpdir(), "scriptc-deadsrc-"));
  const entry = join(dir, "main.ts");
  writeFileSync(entry, source);
  const load = loadProgram(entry);
  const r = lowerToIr(load.program, load.entry, load.moduleOrder);
  expect(r.diagnostics.map((d) => `${d.code} ${d.message}`)).toEqual([]);
  return r.module!;
}

/** every array-typed `dynFrom(varRef)` in the module, as [local name, srcDead] in source order */
function crossings(m: IrModule): Array<[string, boolean]> {
  const out: Array<[string, boolean]> = [];
  const names = new Map<string, string>();
  for (const f of m.functions) for (const l of f.locals ?? []) names.set(l.id, l.name);
  const seen = new Set<object>();
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) { for (const x of n) walk(x); return; }
    if (n === null || typeof n !== "object" || seen.has(n)) return;
    seen.add(n);
    const r = n as Record<string, unknown>;
    if (r["kind"] === "dynFrom") {
      const v = r["value"] as Record<string, unknown>;
      if (v["kind"] === "varRef" && (v["type"] as { kind: string }).kind === "array") out.push([names.get(v["localId"] as string) ?? "?", r["srcDead"] === true]);
    }
    for (const k of Object.keys(r)) if (k !== "loc" && k !== "type") walk(r[k]);
  };
  walk(m.functions.map((f) => f.body));
  return out;
}

const PRE = `function consume(x: any): string { return String(x.length); }\n`;
const CASES: Array<[string, string, boolean]> = [
  ["last use", `{ const lastuse: number[] = [1, 2]; consume(lastuse); }`, true],
  ["used after", `{ const usedafter: number[] = [1, 2]; consume(usedafter); console.log(usedafter.length); }`, false],
  ["read twice in one statement", `{ const twice: number[] = [1, 2]; consume(twice); consume(twice); }`, false],
  ["captured by a closure", `{ const captured: number[] = [1]; const f = () => captured.length; consume(captured); f(); }`, false],
  ["declared outside a loop", `{ const outer: number[] = [1]; for (let i = 0; i < 2; i++) consume(outer); }`, false],
  ["declared inside the loop", `{ for (let i = 0; i < 2; i++) { const inner: number[] = [i]; consume(inner); } }`, true],
  ["reassigned", `{ let re: number[] = [1]; consume(re); re = [2]; }`, false],
  ["a parameter", `function p(arg: number[]): string { return consume(arg); } p([1]);`, false],
];

for (const [label, body, expected] of CASES) {
  test(`${label}: srcDead is ${expected}`, () => {
    delete process.env["SCRIPTC_OWNXFER"];
    delete process.env["SCRIPTC_OWNXFER_FORCE"];
    const cs = crossings(lower(PRE + body));
    expect(cs.length, "a crossing to look at").toBeGreaterThan(0);
    for (const [, dead] of cs.slice(0, 1)) expect(dead).toBe(expected);
  });
}

test("negative control: SCRIPTC_OWNXFER=0 marks nothing", () => {
  process.env["SCRIPTC_OWNXFER"] = "0";
  const cs = crossings(lower(PRE + CASES[0]![1]));
  expect(cs.length).toBeGreaterThan(0);
  expect(cs.every(([, dead]) => !dead)).toBe(true);
});

test("positive control: SCRIPTC_OWNXFER_FORCE=1 marks a used-after crossing too", () => {
  process.env["SCRIPTC_OWNXFER_FORCE"] = "1";
  const cs = crossings(lower(PRE + CASES[1]![1]));
  expect(cs.length).toBeGreaterThan(0);
  expect(cs.every(([, dead]) => dead)).toBe(true);
});
