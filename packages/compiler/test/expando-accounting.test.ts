/* The accounting for expando members' SECOND half — the accessor pair
 * that lets a dyn box over a function value reach the member's module
 * global (lower-expando.ts's "the other spelling of the same member").
 *
 * Why an accounting test and not just behavior: the bug this machinery
 * closes was a DUPLICATION — a function value's members had two storages
 * (the module global the name-spelled read uses, the closure's
 * own-property table every dyn box uses) and the two disagreed in both
 * directions. The fix keeps one storage and forwards the other route to
 * it, which only holds while EVERY registered member gets its pair. A
 * member that is silently neither bound nor skipped-for-a-named-reason is
 * the old split restored for that member, and it looks exactly like
 * nothing.
 *
 * So the partition is checked, not assumed: `members === bound +
 * skipSymbolKey + skipForeignRecv + skipNotBoxable` is asserted at the end
 * of every lowering (lowerer.ts), which makes the whole corpus lane the
 * coverage — and the detector is ARMED below with a deliberately broken
 * tally, because a green suite proves the sum balances, not that anything
 * ever computed it.
 *
 * The counters are process-global and monotonic (their own header says the
 * suite reads deltas), and lowerToIr runs collection once per PASS —
 * validation/discovery and emit — so a delta counts each member once per
 * pass. Nothing here asserts an absolute count for that reason: the claims
 * are RATIOS between counters plus the emitted bind keys, both of which are
 * pass-count independent. */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { loadProgram } from "../src/frontend/program.js";
import { lowerToIr } from "../src/frontend/lowering/lowerer.js";
import { assertExpandoAccounting, expandoCounters } from "../src/frontend/lowering/lower-expando.js";
import type { IrModule } from "../src/ir/nodes.js";

function lower(source: string, ext: string): { delta: Record<string, number>; ir: IrModule } {
  const dir = mkdtempSync(join(tmpdir(), "scriptc-expando-"));
  const entry = join(dir, `main.${ext}`);
  writeFileSync(entry, source);
  const before = { ...expandoCounters };
  const load = loadProgram(entry);
  try {
    const res = lowerToIr(load.program, load.entry, load.moduleOrder);
    const delta: Record<string, number> = {};
    for (const k of Object.keys(expandoCounters) as (keyof typeof expandoCounters)[]) {
      delta[k] = expandoCounters[k] - before[k];
    }
    if (res.module === null) throw new Error(res.diagnostics.map((d) => d.message).join("; "));
    return { delta, ir: res.module };
  } finally {
    load.dispose();
  }
}

/** The `dyn.expandoBind` calls the module carries, by key — the emitted
 * proof that a member's box route reaches its global. */
function boundKeys(ir: IrModule): string[] {
  const keys: string[] = [];
  const walk = (e: unknown): void => {
    if (e === null || typeof e !== "object") return;
    const n = e as { kind?: string; fn?: string; args?: unknown[] };
    if (n.kind === "libCall" && n.fn === "dyn.expandoBind") {
      const key = (n.args?.[1] ?? null) as { kind?: string; value?: string } | null;
      if (key?.kind === "strLit" && key.value !== undefined) keys.push(key.value);
    }
    for (const v of Object.values(n)) {
      if (Array.isArray(v)) v.forEach(walk);
      else walk(v);
    }
  };
  for (const f of ir.functions) f.body.forEach(walk);
  return keys.sort();
}

test("every string-keyed member of a same-file receiver binds its accessor pair", () => {
  const { delta, ir } = lower(
    [
      "function Writer(n) { this.n = n; }",
      'Writer.TAG = "w";',
      "Writer.count = 0;",
      'Writer.opts = { deep: "d" };',
      'Writer.alloc = function (n) { return "a" + n; };',
      "const conv = function (x) { return x + 1; };",
      'conv.unit = "u";',
      "const h = {};",
      "h.f = Writer;",
      "h.c = conv;",
      "console.log(h.f.TAG, h.f.count, h.f.opts.deep, h.f.alloc(1), h.c.unit);",
    ].join("\n"),
    "js",
  );
  // A function declaration and a callable const, five members between
  // them, every one bound and none skipped.
  expect(delta["members"]).toBeGreaterThan(0);
  expect(delta["bound"]).toBe(delta["members"]);
  expect(delta["skipSymbolKey"]).toBe(0);
  expect(delta["skipForeignRecv"]).toBe(0);
  expect(delta["skipNotBoxable"]).toBe(0);
  expect(delta["bindDeclined"]).toBe(0);
  expect(boundKeys(ir)).toEqual(["TAG", "alloc", "count", "opts", "unit"]);
  expect(() => assertExpandoAccounting(expandoCounters)).not.toThrow();
});

test("a symbol-keyed member is a NAMED skip, not a silent one", () => {
  const { delta, ir } = lower(
    [
      "const kTag: unique symbol = Symbol('kTag');",
      "function f(): void {}",
      "f[kTag] = 1;",
      'f.plain = "p";',
      "console.log(f[kTag], f.plain);",
    ].join("\n"),
    "ts",
  );
  // One of the two members has no spelling a dyn keyed read can arrive
  // with, and it lands in the named skip rather than nowhere.
  expect(delta["skipSymbolKey"]).toBeGreaterThan(0);
  expect(delta["bound"]).toBe(delta["skipSymbolKey"]);
  expect(delta["members"]).toBe(delta["bound"] + delta["skipSymbolKey"]);
  expect(boundKeys(ir)).toEqual(["plain"]);
  expect(() => assertExpandoAccounting(expandoCounters)).not.toThrow();
});

test("the detector fires: a tally that does not add up is an error, not a shrug", () => {
  const broken = { ...expandoCounters, members: expandoCounters.members + 1 };
  expect(() => assertExpandoAccounting(broken)).toThrow(/expando member accounting/);
});
