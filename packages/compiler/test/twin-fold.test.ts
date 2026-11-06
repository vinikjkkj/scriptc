/* The twin reload decided from the discovery pass, and folded into the pin reload.
 *
 * Both are pure speedups: the program they build is the program the old flow built, so the proof is the emitted C. Each case compiles
 * the same source with the shortcut off (SCRIPTC_TWIN_EARLY=0, the old flow) and on, and requires the same C once the tsgo symbol-id
 * suffixes (a run-to-run numbering that is not ours) are masked. A case also names the path the build took, so a shortcut that
 * silently stops being taken fails here instead of turning into a quiet slowdown. */
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { compile } from "../src/index.js";
import { boxesEmittersFromFacts, moduleBoxesEmitters } from "../src/ir/nodes.js";
import type { IrClassDef, IrModule } from "../src/ir/nodes.js";
import { mapTwinEdits } from "../src/frontend/lowering/emitter-twin.js";

const mask = (c: string): string => c.replace(/scriptc-twinfold-\w+/g, "D").replace(/@\d+/g, "@N").replace(/_x40_\d+/g, "_x40_N").replace(/("__@[A-Za-z]+@N", )\d+/g, "$1L");

async function build(source: string, env: Record<string, string | undefined>): Promise<{ c: string; why: string }> {
  const dir = await mkdtemp(join(tmpdir(), "scriptc-twinfold-"));
  const src = join(dir, "main.ts");
  await writeFile(src, source, "utf8");
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) {
    saved[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  let why = "";
  const write = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array): boolean => {
    why += String(chunk);
    return true;
  }) as typeof process.stderr.write;
  try {
    const res = await compile(src, { outPath: join(dir, "program"), outDir: dir, backend: "c", emitOnly: true });
    if (!res.ok) throw new Error(`refused: ${res.diagnostics[0]?.message ?? "?"}`);
    return { c: await readFile(res.cPath, "utf8"), why };
  } finally {
    process.stderr.write = write;
    for (const k of Object.keys(env)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

const TWIN_ONLY = `
import { EventEmitter } from "events";
const bus = new EventEmitter();
bus.on("num", (n: number) => console.log("num", n + 1));
bus.on("pair", (a: string, b: number) => console.log("pair", a, b));
function fire(x: unknown, name: string, ...args: unknown[]): unknown { return (x as any).emit(name, ...args); }
console.log(fire(bus, "num", 5), fire(bus, "pair", "q", 2), fire(bus, "num", "oops"));
`;

const PIN_AND_TWIN = `
import { EventEmitter } from "events";
class Holder { n = 1; keep = 5; tag = "t"; }
function setN(x: any) { x.n = "str"; }
const h = new Holder();
setN(h);
const bus = new EventEmitter();
bus.on("num", (n: number) => { console.log("num", n + 1, h.n, h.keep); });
bus.on("pair", (a: string, c: number) => { console.log("pair", a, c, h.tag); });
function fire(x: unknown, name: string, ...args: unknown[]): unknown { return (x as any).emit(name, ...args); }
console.log(fire(bus, "num", 5), fire(bus, "pair", "q", 2), fire(bus, "num", "oops"));
`;

// A pin edit INSIDE a twinned listener: the folded reload must not be taken.
const PIN_INSIDE_TWIN = `
import { EventEmitter } from "events";
class Holder { n = 1; keep = 5; }
function setN(x: any) { x.n = "str"; }
const h = new Holder();
setN(h);
const bus = new EventEmitter();
bus.on("num", (n: number) => { class Local { m = 2; } const l = new Local(); (l as any).m = "s"; console.log("num", n + 1, h.n, h.keep, l.m); });
function fire(x: unknown, name: string, ...args: unknown[]): unknown { return (x as any).emit(name, ...args); }
console.log(fire(bus, "num", 5), fire(bus, "num", "oops"));
`;

const WHY = { SCRIPTC_TWIN_WHY: "1" };

describe("the twin reload decided from the discovery pass", () => {
  test("a twin-only program takes the early decision and emits what the old flow emitted", async () => {
    const old = await build(TWIN_ONLY, { ...WHY, SCRIPTC_TWIN_EARLY: "0" });
    const now = await build(TWIN_ONLY, { ...WHY, SCRIPTC_TWIN_EARLY: undefined });
    expect(old.why).not.toContain("discovery decision");
    expect(old.why).toContain("[twin] reload: 2 listener(s)");
    expect(now.why).toContain("discovery decision: ok");
    expect(now.why).toContain("[twin] reload: 2 listener(s)");
    expect(mask(now.c)).toBe(mask(old.c));
  }, 120_000);
});

describe("the twin reload folded into the pin reload", () => {
  test("a pin outside the listeners folds into one reload with the same C", async () => {
    const old = await build(PIN_AND_TWIN, { ...WHY, SCRIPTC_TWIN_EARLY: "0" });
    const now = await build(PIN_AND_TWIN, { ...WHY, SCRIPTC_TWIN_EARLY: undefined });
    expect(old.why).toContain("[twin] reload: 2 listener(s)");
    expect(now.why).toContain("[twin] fold: taken (2 marker(s))");
    expect(now.why).toContain("fold verification: consumed 2/2");
    expect(mask(now.c)).toBe(mask(old.c));
  }, 120_000);

  test("a pin inside a twinned listener keeps the two reloads, with the same C", async () => {
    const old = await build(PIN_INSIDE_TWIN, { ...WHY, SCRIPTC_TWIN_EARLY: "0" });
    const now = await build(PIN_INSIDE_TWIN, { ...WHY, SCRIPTC_TWIN_EARLY: undefined });
    expect(now.why).toContain("[twin] fold: not taken: a pin edit touches");
    expect(now.why).toContain("[twin] reload: 1 listener(s)");
    expect(mask(now.c)).toBe(mask(old.c));
  }, 120_000);

  test("the fold switch turns the shortcut off alone", async () => {
    const off = await build(PIN_AND_TWIN, { ...WHY, SCRIPTC_TWIN_FOLD: "0" });
    expect(off.why).not.toContain("[twin] fold:");
    expect(off.why).toContain("[twin] reload: 2 listener(s)");
  }, 120_000);
});

describe("the pieces the decisions stand on", () => {
  const cls = (name: string, base?: string, mixin?: boolean): IrClassDef =>
    ({ name, ...(base !== undefined ? { base } : {}), fields: mixin === true ? [{ name: "__emitter_mixin" }] : [] }) as unknown as IrClassDef;

  test("boxesEmittersFromFacts answers what moduleBoxesEmitters answers over the same facts", () => {
    const classes = [cls("%EventEmitter"), cls("Bus", "%EventEmitter"), cls("Plain")];
    const mod = (functions: unknown[]): IrModule => ({ classes, functions } as unknown as IrModule);
    const dynFrom = (className: string): unknown => ({ kind: "dynFrom", value: { type: { kind: "object", className } } });
    const emitDyn = { kind: "libCall", fn: "emitter.emitDyn", args: [] };
    for (const [fns, emit, from] of [
      [[emitDyn], true, []],
      [[dynFrom("Plain")], false, ["Plain"]],
      [[dynFrom("Bus")], false, ["Bus"]],
      [[], false, []],
    ] as const) {
      expect(boxesEmittersFromFacts(classes, emit, from), JSON.stringify(fns)).toBe(moduleBoxesEmitters(mod([...fns])));
    }
  });

  test("mapTwinEdits moves insertions past pin wrappers and refuses a touch or an overlap", () => {
    const edits = new Map([["a.ts", [{ at: 100, text: "X" }, { at: 300, text: "Y" }]]]);
    const mapped = mapTwinEdits(edits, new Map([["a.ts", [{ start: 10, end: 20, ts: true }, { start: 150, end: 160, ts: false }]]]), []);
    expect(mapped?.get("a.ts")).toEqual([{ at: 109, text: "X" }, { at: 330, text: "Y" }]);
    expect(mapTwinEdits(edits, new Map([["a.ts", [{ start: 100, end: 105, ts: true }]]]), [])).toBeNull();
    expect(mapTwinEdits(edits, new Map([["a.ts", [{ start: 40, end: 60, ts: true }]]]), [{ file: "a.ts", start: 50, end: 90 }])).toBeNull();
  });
});
