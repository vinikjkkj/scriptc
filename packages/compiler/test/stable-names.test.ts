/* LIFTED CLOSURES KEEP THEIR NAMES ACROSS UNRELATED EDITS.
 *
 * The lowerer used to name every lifted lambda `%fn<N>` from one module-wide counter, so adding a function with a lambda
 * above everything else renamed every lambda below it. stable-names.ts names a lambda from its parent function and its
 * ordinal inside that parent instead. This file pins the property that makes the names useful (a profile, an order file or a
 * diff keyed on them survives an edit somewhere else):
 *
 *   - build A, then build B = A plus an unrelated function with lambdas inserted ABOVE everything and one function given an
 *     extra lambda: the lambdas of every other function carry exactly the same names in both builds;
 *   - the negative control is SCRIPTC_STABLE_NAMES=0 (the old counter names): on the same two programs it must NOT preserve
 *     them, so a pass that did nothing could not pass;
 *   - names are unique and carry no counter.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import type { IrFunction, IrModule } from "../src/ir/nodes.js";
import { lowerToIr } from "../src/frontend/lowering/lowerer.js";
import { loadProgram } from "../src/frontend/program.js";

const BASE = `
function stable(xs: number[]): number {
  return xs.map((x) => x + 1).filter((x) => x > 1).reduce((a, b) => a + b, 0);
}
function other(xs: string[]): string[] {
  return xs.map((s) => s + "!").filter((s) => s.length > 1);
}
function changed(xs: number[]): number[] {
  return xs.map((x) => x * 2);
}
class K {
  items: number[] = [];
  total(): number {
    return this.items.map((x) => x + 1).reduce((a, b) => a + b, 0);
  }
}
console.log(stable([1, 2, 3]), other(["a", "bb"]), changed([1]), new K().total());
`;

/** The same program with an unrelated function (with lambdas) inserted ABOVE all others, and one function given an extra lambda. */
const EDITED = `
function inserted(xs: number[]): number[] {
  return xs.map((x) => x - 1).filter((x) => x > 0).map((x) => x * 3);
}
${BASE.replace("return xs.map((x) => x * 2);", "return xs.map((x) => x * 2).filter((x) => x > 0);").replace(
  "console.log(", "console.log(inserted([5]), ")}`;

function lower(source: string): IrModule {
  const dir = mkdtempSync(join(tmpdir(), "scriptc-stablenames-"));
  const entry = join(dir, "main.ts");
  writeFileSync(entry, source);
  const load = loadProgram(entry);
  const r = lowerToIr(load.program, load.entry, load.moduleOrder);
  expect(r.diagnostics.map((d) => `${d.code} ${d.message}`)).toEqual([]);
  expect(r.module).not.toBeNull();
  return r.module!;
}

/** parent function name -> the lifted lambdas whose names it mentions, in document order */
function lambdasByParent(m: IrModule): Map<string, string[]> {
  const isLambda = (n: string): boolean => /^%fn(\.[0-9a-z]{6}\.|\d)/.test(n);
  const names = new Set(m.functions.filter((f: IrFunction) => isLambda(f.name)).map((f: IrFunction) => f.name));
  const out = new Map<string, string[]>();
  for (const f of m.functions) {
    if (isLambda(f.name)) continue;
    const found: string[] = [];
    const stack: unknown[] = [f.body];
    while (stack.length > 0) {
      const n = stack.pop();
      if (typeof n === "string") {
        if (names.has(n) && !found.includes(n)) found.push(n);
      } else if (Array.isArray(n)) {
        for (let i = n.length - 1; i >= 0; i--) stack.push(n[i]);
      } else if (n !== null && typeof n === "object") {
        const rec = n as Record<string, unknown>;
        const ks = Object.keys(rec);
        for (let i = ks.length - 1; i >= 0; i--) if (ks[i] !== "loc" && ks[i] !== "type") stack.push(rec[ks[i]!]);
      }
    }
    if (found.length > 0) out.set(f.name, found);
  }
  return out;
}

const UNCHANGED = ["stable", "other"]; /* `changed` gained a lambda, `inserted` is new; the class method and main are checked by name below */
const saved = process.env["SCRIPTC_STABLE_NAMES"];
afterEach(() => {
  if (saved === undefined) delete process.env["SCRIPTC_STABLE_NAMES"];
  else process.env["SCRIPTC_STABLE_NAMES"] = saved;
});

test("the lambdas of untouched functions keep their names across an unrelated edit", () => {
  delete process.env["SCRIPTC_STABLE_NAMES"];
  const a = lambdasByParent(lower(BASE));
  const b = lambdasByParent(lower(EDITED));
  for (const parent of UNCHANGED) {
    const key = [...a.keys()].find((k) => k === parent || k.endsWith(`.${parent}`) || k.endsWith(`_${parent}`));
    expect(key, `a parent named ${parent} with lambdas`).toBeDefined();
    expect(a.get(key!)!.length).toBeGreaterThan(0);
    expect(b.get(key!), `${parent}'s lambdas`).toEqual(a.get(key!));
  }
  /* the class method's lambdas too */
  const k = [...a.keys()].find((x) => x.includes("K") && x.includes("total"));
  expect(k).toBeDefined();
  expect(b.get(k!)).toEqual(a.get(k!));
});

test("negative control: with the counter names the same edit renames them", () => {
  process.env["SCRIPTC_STABLE_NAMES"] = "0";
  const a = lambdasByParent(lower(BASE));
  const b = lambdasByParent(lower(EDITED));
  const key = [...a.keys()].find((k) => k.endsWith("stable") || k.endsWith("_stable") || k.endsWith(".stable"));
  expect(key).toBeDefined();
  expect(b.get(key!)).not.toEqual(a.get(key!));
});

test("names are unique and carry no counter", () => {
  delete process.env["SCRIPTC_STABLE_NAMES"];
  const m = lower(EDITED);
  const names = m.functions.map((f: IrFunction) => f.name);
  expect(new Set(names).size).toBe(names.length);
  /* every lambda some function mentions has a stable name; a lambda nothing mentions is dead code and keeps its counter name */
  const mentioned = [...lambdasByParent(m).values()].flat();
  expect(mentioned.length).toBeGreaterThan(5);
  expect(mentioned.filter((n) => /^%fn\d/.test(n))).toEqual([]);
});
