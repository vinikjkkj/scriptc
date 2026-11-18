/* THE FOLDED TWIN (index.ts tryFold, lowerer.ts foldedTwinCheck): the pin reload and the twin reload are one load, and the
 * folded program's own emit pass checks that it carries exactly the twins today's sequential twin reload would give it.
 *
 * Every arm lowers the same program and compares the whole IR with SCRIPTC_TWIN_FOLD=off (today's path):
 *   - folded: the fold applies (the pin sits before, inside and after the listeners; a lone-statement registration, an
 *     expression-bodied arrow, a named function and a nested listener are all twinned) and the IR is IDENTICAL;
 *   - the fold's own checks fire on a deliberately broken fold (positive controls), and the result is still today's IR: a fold that
 *     missed a twin (BREAK=dropone), numbered one differently (renumber), moved the insertions wrongly (shift) or copied a
 *     listener without the pins inside it (nopin) falls back to the sequential path;
 *   - the same broken folds with the check switched off (BREAK=...,nocheck) produce a DIFFERENT IR, so the controls are not
 *     vacuous: the check is what stands between them and the output. */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { runFrontend } from "../src/index.js";

const PROG = `
import { EventEmitter } from "node:events";
class Box extends EventEmitter { n = 0; label = "a"; }
const b = new Box();
const loose: any = b;
loose.n = "str";
const hold: { v: any } = { v: b };
class Pre { n = 1; m = 2; }
function onThing(v: number): void { console.log("thing", typeof v, v + 1); }
b.on("thing", onThing);
if (process.argv.length > 0) b.on("lone", (v: number) => { console.log("lone", typeof v, v + 1); });
const reg = (): Box => b.on("expr", (v: number) => { console.log("expr", typeof v, v * 2); });
reg();
b.on("x", (v: number) => {
  class Loc { n = 3; k = v; }
  const l = new Loc();
  const bag: { v: any } = { v: l };
  console.log("typed", typeof v, v + 1, l.n, l.k, typeof bag.v.k);
});
class Post { n = 4; }
b.on("y", (s: string, t: number) => {
  const inner = new Box();
  inner.on("z", (q: number) => { console.log("inner", typeof q, q * 2); });
  hold.v.emit.apply(inner, ["z", "7"]);
  console.log("y", typeof s, typeof t, new Post().n, new Pre().n);
});
const em = hold.v;
em.emit.apply(em, ["x", "5"]);
em.emit.apply(em, ["y", 1, "2"]);
console.log(String(loose.n), b.label);
`;

const ENVS = ["SCRIPTC_TWIN_FOLD", "SCRIPTC_TWIN_FOLD_BREAK", "SCRIPTC_TWIN_WHY"];
afterEach(() => { for (const k of ENVS) delete process.env[k]; });

let file = "";
function lowerWith(env: Record<string, string>): { ir: string; why: string } {
  if (file === "") {
    const dir = mkdtempSync(join(tmpdir(), "scriptc-twinfold-"));
    mkdirSync(dir, { recursive: true });
    file = join(dir, "main.ts");
    writeFileSync(file, PROG);
  }
  for (const k of ENVS) delete process.env[k];
  Object.assign(process.env, { SCRIPTC_TWIN_WHY: "1" }, env);
  const lines: string[] = [];
  const realWrite = process.stderr.write.bind(process.stderr);
  (process.stderr as { write: unknown }).write = (chunk: string | Uint8Array): boolean => { lines.push(String(chunk)); return true; };
  const fe = runFrontend(file);
  try {
    if (fe.preflight.length > 0) throw new Error(`preflight: ${fe.preflight[0]!.message}`);
    const r = fe.lower({});
    if (r.module === null) throw new Error(`lowering refused: ${r.diagnostics.map((d) => `${d.code} ${d.message}`.slice(0, 160)).join(" | ")}`);
    return { ir: JSON.stringify(r.module), why: lines.filter((l) => l.startsWith("[twin")).join("") };
  } finally {
    (process.stderr as { write: unknown }).write = realWrite;
    fe.dispose();
  }
}

test("the folded reload gives today's IR and says it folded", () => {
  const seq = lowerWith({ SCRIPTC_TWIN_FOLD: "off" });
  expect(seq.why).toContain("[twin] reload");
  const fold = lowerWith({});
  expect(fold.why).toMatch(/\[twinfold\] folded: 6 twin marker/);
  expect(fold.why).toContain("a twin copy carries");
  expect(fold.ir === seq.ir).toBe(true);
}, 300_000);

test.each(["dropone", "renumber", "shift", "nopin"])("a broken fold (%s) is caught and the IR is today's; unchecked it differs", (brk) => {
  const seq = lowerWith({ SCRIPTC_TWIN_FOLD: "off" });
  const caught = lowerWith({ SCRIPTC_TWIN_FOLD_BREAK: brk });
  expect(caught.why).toMatch(/\[twinfold\] fallback/);
  expect(caught.why).toContain("[twin] reload");
  expect(caught.ir === seq.ir).toBe(true);
  // the control is not vacuous: without the check, or for a fold that never reaches a load, the broken fold changes the program
  // (shift is stopped by the preflight of the folded program before any check, so it has no unchecked arm)
  if (brk !== "shift") {
    const raw = lowerWith({ SCRIPTC_TWIN_FOLD_BREAK: `${brk},nocheck` });
    expect(raw.why).toMatch(/\[twinfold\] folded: check skipped/);
    expect(raw.ir === seq.ir).toBe(false);
  }
}, 300_000);
