/* The dead-initializer pass (ir/dead-init.ts): a never-read module const whose initializer is provably pure is not built.
 *   - positive controls: an unused const built by a pure table builder, or by Object.keys/values/entries + map/filter/fromEntries over a static record, is
 *     DROPPED (the `assign` leaves its `%init` function) and the module still validates;
 *   - negative controls: a read const, a const whose initializer calls a function that writes a module counter, a const read only through a function never
 *     called (a read), a mutable binding and a const whose initializer cannot be seen through are KEPT, each with its reason;
 *   - SCRIPTC_DEADINIT=off drops nothing. */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { loadProgram } from "../src/frontend/program.js";
import { lowerToIr } from "../src/frontend/lowering/lowerer.js";
import { validateModule } from "../src/ir/validate.js";
import { deadInitPass } from "../src/ir/dead-init.js";
import type { IrModule } from "../src/ir/nodes.js";

function lower(files: Record<string, string>): IrModule {
  const dir = mkdtempSync(join(tmpdir(), "scriptc-deadinit-"));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  const load = loadProgram(join(dir, "main.ts"));
  try {
    const r = lowerToIr(load.program, load.entry, load.moduleOrder);
    if (r.module === null) throw new Error(`lowering refused: ${r.diagnostics.map((d) => `${d.code} ${d.message}`.slice(0, 160)).join(" | ")}`);
    return r.module;
  } finally {
    load.dispose();
  }
}

const TABLE = `
const SRC: Record<string, { code: number }> = { a: { code: 1 }, b: { code: 2 } };
function view(): Record<string, { c: number }> {
  const out: Record<string, { c: number }> = {};
  for (const [k, v] of Object.entries(SRC)) out[k] = { c: v.code * 2 };
  return out;
}
export const GONE_VIEW = view();
export const GONE_KEYS = Object.keys(SRC).map((k) => k + "!");
export const GONE_FROM = Object.fromEntries(Object.entries(SRC).map(([k, v]) => [k, v.code]));
export const KEPT_USED = view();
export let KEPT_MUT = [1, 2];
let calls = 0;
function bump(): number[] { calls += 1; return [calls]; }
export const KEPT_IMPURE = bump();
function lateRead(): number { return GONE_LATE.length; }
export const GONE_LATE = [1, 2, 3];
console.log(Object.keys(KEPT_USED).length, calls, KEPT_MUT.length, typeof lateRead);
`;

afterEach(() => delete process.env["SCRIPTC_DEADINIT"]);

const verdict = (r: ReturnType<typeof deadInitPass>, name: string): string => {
  if (r.dropped.some((d) => d.endsWith(`.${name}`))) return "drop";
  const k = r.kept.find((x) => x.id.endsWith(`.${name}`));
  return k !== undefined ? `keep: ${k.reason}` : "not a candidate";
};

test("an unused pure table build is dropped; a read const, an impure call, a mutable binding and a binding read by a function are kept", () => {
  const m = lower({ "main.ts": TABLE });
  const r = deadInitPass(m);
  expect(verdict(r, "GONE_VIEW")).toBe("drop");
  expect(verdict(r, "GONE_KEYS")).toBe("drop");
  expect(verdict(r, "GONE_FROM")).toBe("drop");
  expect(verdict(r, "KEPT_USED")).toBe("not a candidate"); // read in main
  expect(verdict(r, "KEPT_MUT")).toBe("not a candidate"); // mutable binding
  expect(verdict(r, "KEPT_IMPURE")).toMatch(/^keep: /); // the call writes a module counter
  expect(verdict(r, "GONE_LATE")).toBe("not a candidate"); // lateRead() names it: a read, even if never called
  // the assign is gone from the init function, and the module still validates
  const init = m.functions.filter((f) => f.name.startsWith("%init."));
  const assigned = JSON.stringify(init.map((f) => f.body));
  expect(assigned.includes("GONE_VIEW")).toBe(false);
  expect(assigned.includes("KEPT_USED")).toBe(true);
  expect(validateModule(m)).toEqual([]);
});

// The multi-file cases (a re-exported const no importer reads: dropped; a const read through a namespace object: kept) are corpus rows 25612 and 25614, which
// go through the CLI module resolution the unit lowering helper does not have.

test("SCRIPTC_DEADINIT=off drops nothing", () => {
  process.env["SCRIPTC_DEADINIT"] = "off";
  const r = deadInitPass(lower({ "main.ts": TABLE }));
  expect(r.dropped).toEqual([]);
});

// deadinit2: a record shape that also has a dyn cast keeps a view arm in every `Object.entries` over it. The arm is dead when the iterated record is a
// frozen literal confined to read-only uses; it is live (kept) when the table is boxed to a dyn first or the iteration is over a Proxy.
const VIEWED = (extra: string, table: string): string => `
const SPEC = ${table};
type Spec = typeof SPEC;
type Cfg = { code: number; type: string; defaultValue: number | boolean | string };
function fromJson(s: string): Spec { return JSON.parse(s) as Spec; }
function build(spec: Spec): Record<string, { c: number; t: string; d: number | boolean | string }> {
  const view = {} as Record<string, { c: number; t: string; d: number | boolean | string }>;
  for (const [name, entry] of Object.entries(spec)) view[name] = Object.freeze({ c: entry.code, t: entry.type, d: entry.defaultValue });
  return Object.freeze(view);
}
${extra}
export const UNUSED_VIEW = build(SPEC);
const other = fromJson("{}");
console.log(SPEC.alpha.code, other);
`;
const FROZEN = `Object.freeze({ alpha: Object.freeze({ code: 1, type: "int", defaultValue: 10 }), beta: Object.freeze({ code: 2, type: "bool", defaultValue: false }), gamma: Object.freeze({ code: 3, type: "string", defaultValue: "g" }) })`;

test("an unused view built by Object.entries over a read-only frozen table is dropped; boxing the table to a dyn first keeps it", () => {
  expect(verdict(deadInitPass(lower({ "main.ts": VIEWED("", FROZEN) })), "UNUSED_VIEW")).toBe("drop");
  // positive control for the negative below: the same program with the table escaping to dyn code must be KEPT (the view arm may then be live)
  const kept = verdict(deadInitPass(lower({ "main.ts": VIEWED("const boxed: unknown = SPEC; console.log(typeof boxed);", FROZEN) })), "UNUSED_VIEW");
  expect(kept).toMatch(/^keep: /);
});

// The init-order cases (table boxed by a module that runs after the view's module: dropped; before it: kept) are multi-file, so they are corpus rows 25698 and 25699.
