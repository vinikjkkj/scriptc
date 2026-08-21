/* THE GUARDED KEYED READ, and the dial that prices it.
 *
 * `if (input.node.attrs.id) { attrs.id = input.node.attrs.id }` is zapo's
 * most common statement, and after the lookup TABLE and the `<enc>` switch
 * were closed it was the largest population of ABORT.real left: twenty-six
 * of the forty-one remaining call sites, all one idea. The GUARD is already
 * served — `ensureBool` routes a keyed read through
 * `recordKeyReadAtSlotWidth(e, DYN)` and answers `false` on a miss — while
 * the GUARDED read is a fresh `recordKeyGet` at the checker's bare `string`
 * one token later, and it is that one that carries `scr_trap_fmt`.
 *
 * The trap cannot be deleted: `recordKeyGetHelper` is interned per (shape,
 * width) and shared with the reads that really can miss, so removing it
 * there trades a loud failure for a wild pointer on those — the reason
 * `block/walkers` proved fifteen sites unreachable and still refused to
 * touch it. What moves is the CALL SITE.
 *
 * WHAT THIS FILE ASSERTS, and why each assertion is here:
 *
 *   1. with the rule ON, no guarded shape emits the trap AT ALL — the
 *      keyed read is the only one in the program, so `scr_trap_fmt(record
 *      has no key` going to zero is the call site moving and nothing else;
 *   2. with `SCRIPTC_GUARDKEY_OFF=1` every one of them emits it again —
 *      the removal control, so "the rule fires nowhere" and "there was
 *      nothing to fire on" cannot be confused;
 *   3. every CONTROL is BYTE-IDENTICAL with the dial on and off. A rule
 *      that also moved a read no guard proved would be a silent widening,
 *      and a byte comparison is the only check that sees it. (The
 *      hazard `switcharm-dials` names: a decline has to be a byte-identical
 *      TU, not merely a program that still compiles.)
 *   4. nothing becomes a compile-time REFUSAL. Trading a runtime kill for
 *      an SC-coded diagnostic would RAISE the refusal census, which is the
 *      opposite of the objective; every program here compiles clean on both
 *      sides of the dial.
 */
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { compile } from "../src/index.js";

const HEAD = `type Attrs = Record<string, string>;\ntype Nums = Record<string, number>;\n`;

/* One program per guarded SPELLING. Each holds exactly one keyed read of a
 * record shape, so the trap count is a direct reading of that one site. */
const GUARDED: readonly (readonly [string, string])[] = [
  ["truthiness", `export function f(a: Attrs): string { if (a.id) { return a.id } return "n" } console.log(f({ id: "x" }));`],
  ["bracket", `export function f(a: Attrs): string { if (a["id"]) { return a["id"] } return "n" } console.log(f({ id: "x" }));`],
  ["computed", `export function f(a: Attrs, k: string): string { if (a[k]) { return a[k] } return "n" } console.log(f({ id: "x" }, "id"));`],
  ["mixed-spelling", `export function f(a: Attrs): string { if (a.id) { return a["id"] } return "n" } console.log(f({ id: "x" }));`],
  ["neq-undefined", `export function f(a: Attrs): string { if (a.id !== undefined) { return a.id } return "n" } console.log(f({ id: "x" }));`],
  ["neq-null", `export function f(a: Attrs): string { if (a.id != null) { return a.id } return "n" } console.log(f({ id: "x" }));`],
  ["typeof", `export function f(a: Attrs): string { if (typeof a.id !== "undefined") { return a.id } return "n" } console.log(f({ id: "x" }));`],
  ["else-of-eq", `export function f(a: Attrs): string { if (a.id === undefined) { return "n" } else { return a.id } } console.log(f({ id: "x" }));`],
  ["else-of-not", `export function f(a: Attrs): string { if (!a.id) { return "n" } else { return a.id } } console.log(f({ id: "x" }));`],
  ["and-right", `export function f(a: Attrs): number { return a.id && a.id.length > 0 ? 1 : 0 } console.log(f({ id: "x" }));`],
  ["ternary-true", `export function f(a: Attrs): string { return a.id ? a.id : "n" } console.log(f({ id: "x" }));`],
  ["ternary-false", `export function f(a: Attrs): string { return !a.id ? "n" : a.id } console.log(f({ id: "x" }));`],
  ["number-record", `export function f(n: Nums): number { if (n.one !== undefined) { return n.one + 1 } return -1 } console.log(f({ one: 1 }));`],
  ["nested-receiver", `export function f(b: { readonly a: Attrs }): string { if (b.a.id) { return b.a.id } return "n" } console.log(f({ a: { id: "x" } }));`],
  ["typeof-eq-kind", `export function f(a: Attrs): string { return typeof a.id === "string" ? a.id : "n" } console.log(f({ id: "x" }));`],
  ["typeof-not-undefined-eq", `export function f(a: Attrs): string { return !(typeof a.id === "undefined") ? a.id : "n" } console.log(f({ id: "x" }));`],
  ["eq-definite", `const T = "retry"; export function f(a: Attrs): string { return a.id === T ? a.id : "n" } console.log(f({ id: "retry" }));`],
  ["or-both-prove", `const T = "retry"; const U = "rekey"; export function f(a: Attrs): string { return a.id === T || a.id === U ? a.id : "n" } console.log(f({ id: "retry" }));`],
  ["typeof-eq-undefined-else", `export function f(a: Attrs): string { return typeof a.id === "undefined" ? "n" : a.id } console.log(f({ id: "x" }));`],
  ["for-in-own-keys", `export function f(h: Attrs): Attrs { const o: Attrs = {}; for (const k in h) { o[k] = h[k] } return o } console.log(f({ id: "x" }).id);`],
];

/* Every control: a shape no guard proves. Each must keep the exact bytes it
 * has with the rule off. */
const CONTROLS: readonly (readonly [string, string])[] = [
  ["other-key", `export function f(a: Attrs): string { if (a.id) { return a.from } return "n" } console.log(f({ id: "x", from: "y" }));`],
  ["other-receiver", `export function f(a: Attrs, b: Attrs): string { if (b.id) { return a.id } return "n" } console.log(f({ id: "x" }, { id: "y" }));`],
  ["root-reassigned", `export function f(a: Attrs, b: Attrs): string { let r = a; if (r.id) { r = b; return r.id } return "n" } console.log(f({ id: "x" }, { id: "y" }));`],
  ["region-deletes", `export function f(a: Attrs): string { const c: Attrs = { ...a }; if (c.id) { delete c.from; return c.id } return "n" } console.log(f({ id: "x", from: "y" }));`],
  ["key-reassigned", `export function f(a: Attrs, k: string, j: string): string { if (a[k]) { k = j; return a[k] } return "n" } console.log(f({ id: "x", j: "y" }, "id", "j"));`],
  ["optional-chain", `export function f(a: Attrs | undefined): string { if (a?.id) { return a.id } return "n" } console.log(f({ id: "x" }));`],
  ["nested-function", `export function f(a: Attrs): number { if (a.id) { const p = (): number => a.id.length; return p() } return -1 } console.log(f({ id: "x" }));`],
  ["unguarded", `export function f(a: Attrs): string { return a.id } console.log(f({ id: "x" }));`],
  ["guard-in-else-only", `export function f(a: Attrs): string { if (a.id) { return "y" } return a.id } console.log(f({ id: "x" }));`],
  ["or-only-one-proves", `const T = "retry"; export function f(a: Attrs): string { return a.id === T || a.from === T ? a.id : "n" } console.log(f({ id: "retry" }));`],
  ["eq-undefined-true-arm", `export function f(a: Attrs): string { if (a.id === undefined) { return a.id } return "y" } console.log(f({ id: "x" }));`],
  ["for-in-other-object", `export function f(h: Attrs, g: Attrs): Attrs { const o: Attrs = {}; for (const k in g) { o[k] = h[k] } return o } console.log(f({ id: "x" }, { id: "y" }).id);`],
];

const TRAP = /scr_trap_fmt\("scriptc: TypeError: record has no key/g;
const count = (tu: string, re: RegExp): number => (tu.match(re) ?? []).length;

const DIALS = ["SCRIPTC_GUARDKEY_OFF"] as const;

let dir: string | undefined;
let seq = 0;

async function emit(program: string, off: readonly string[]): Promise<{ tu: string; diags: string[] }> {
  dir ??= await mkdtemp(join(tmpdir(), "scriptc-guardkey-"));
  // The emitted TU carries its entry path in a comment on every function,
  // so two variants differ by their FILENAME before they differ by a
  // lowering. Same-length tags plus a normalisation pass make a byte
  // comparison mean what it says. (assignarm-dials' own note.)
  const tag = String(seq++).padStart(4, "0");
  const src = join(dir, `main-${tag}.ts`);
  await writeFile(src, `${HEAD}${program}\nexport {};\n`, "utf8");
  const saved = DIALS.map((k) => [k, process.env[k]] as const);
  try {
    for (const k of DIALS) delete process.env[k];
    for (const k of off) process.env[k] = "1";
    const res = await compile(src, {
      outPath: join(dir, `program-${tag}`),
      outDir: dir,
      backend: "c",
      emitOnly: true,
    });
    if (!res.ok) return { tu: "", diags: res.diagnostics.map((x) => x.message) };
    const tu = await readFile(res.cPath, "utf8");
    return { tu: tu.split(`main-${tag}.ts`).join("main.ts").split(`program-${tag}`).join("program"), diags: [] };
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe("the guarded keyed read", () => {
  test("every guarded spelling loses its aborting call site, and gets it back with the dial", async () => {
    for (const [name, program] of GUARDED) {
      const off = await emit(program, ["SCRIPTC_GUARDKEY_OFF"]);
      expect(off.diags, name).toEqual([]);
      // Non-trivial: the read really does carry the abort with the rule off.
      expect(count(off.tu, TRAP), `${name} (dial off -> abort present)`).toBeGreaterThan(0);

      const on = await emit(program, []);
      expect(on.diags, name).toEqual([]);
      expect(count(on.tu, TRAP), `${name} (rule on -> abort gone)`).toBe(0);
    }
  }, 240_000);

  test("every control is BYTE-IDENTICAL with the rule on and off", async () => {
    for (const [name, program] of CONTROLS) {
      const on = await emit(program, []);
      const off = await emit(program, ["SCRIPTC_GUARDKEY_OFF"]);
      expect(on.diags, name).toEqual([]);
      expect(off.diags, name).toEqual([]);
      expect(on.tu.length, `${name} (length)`).toBe(off.tu.length);
      expect(on.tu === off.tu, `${name} (bytes)`).toBe(true);
    }
  }, 240_000);

  test("the controls that CAN miss keep their abort — the trap is not deleted anywhere", async () => {
    for (const name of ["unguarded", "guard-in-else-only", "other-key", "other-receiver", "eq-undefined-true-arm"] as const) {
      const program = CONTROLS.find((c) => c[0] === name)![1];
      const on = await emit(program, []);
      expect(on.diags, name).toEqual([]);
      expect(count(on.tu, TRAP), `${name} keeps its miss path`).toBeGreaterThan(0);
    }
  }, 120_000);

  test("nothing becomes a compile-time refusal on either side of the dial", async () => {
    for (const [name, program] of [...GUARDED, ...CONTROLS]) {
      for (const off of [[], ["SCRIPTC_GUARDKEY_OFF"]] as const) {
        const r = await emit(program, off);
        expect(r.diags, `${name} ${off.length ? "off" : "on"}`).toEqual([]);
        expect(/\[SC\d{4}/.test(r.tu), `${name} ${off.length ? "off" : "on"} SC-coded refusal`).toBe(false);
      }
    }
  }, 480_000);
});
