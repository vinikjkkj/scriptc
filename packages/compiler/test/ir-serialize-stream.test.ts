/* The streaming IR encoder must be byte-identical to the JSON.stringify(mod, replacer, 2) it replaced (readers, caches and
 * diffs depend on the bytes), and must not need a document-sized string (V8 caps one near 512 MiB; zapo's sqlite and mysql
 * bench arms lower to more than that). */
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import type { IrModule } from "../src/ir/nodes.js";
import { emitModuleJson, serializeModule, writeModuleFile } from "../src/ir/serialize.js";

/* The ORIGINAL serializer, verbatim: the reference every case compares against. */
function reference(mod: unknown): string {
  return JSON.stringify(mod, (_key, value) => {
    if (typeof value === "number" && !Number.isFinite(value)) {
      if (Number.isNaN(value)) return { $nonfinite: "nan" };
      return { $nonfinite: value > 0 ? "inf" : "-inf" };
    }
    if (typeof value === "number" && Object.is(value, -0)) return { $nonfinite: "-0" };
    return value;
  }, 2);
}
const same = (v: unknown): void => {
  expect(serializeModule(v as IrModule)).toBe(reference(v));
};

test("scalars, nesting and the empty forms print exactly as JSON.stringify does", () => {
  same({});
  same([]);
  same({ a: [], b: {}, c: [[]], d: [{}], e: null, f: true, g: false, h: "x" });
  same({ n: [1, -1, 1.5, 1e21, 1e-7, 123456789012345680000, 0.1 + 0.2] });
  same({ deep: { a: { b: { c: { d: [1, [2, [3, [4]]]] } } } } });
});

test("the sentinels, negative zero and non-finite numbers", () => {
  same({ v: [NaN, Infinity, -Infinity, -0, 0, 5] });
  same({ k: { x: NaN }, y: -0 });
});

test("undefined, functions and symbols drop from objects and print null in arrays", () => {
  same({ a: undefined, b: () => 1, c: Symbol("s"), d: 1 });
  same({ list: [undefined, () => 1, Symbol("s"), 2, null] });
  same({ a: undefined });
});

test("strings: escapes, unicode, lone surrogates, keys that need escaping", () => {
  same({ s: 'q"uote\\ \n\t\u0000\u001f    é 😀 \ud800 \udc00 end' });
  same({ 'we"ird\nkey': 1, "": 2, "\ud800": 3 });
});

test("toJSON is applied before the replacer, and Map/Set/Date follow JSON.stringify", () => {
  same({ d: new Date(0), m: new Map([[1, 2]]), s: new Set([1]) });
  same({ t: { toJSON: (k: string) => ({ key: k, n: NaN }) }, arr: [{ toJSON: () => undefined }] });
});

test("a BigInt throws the same way", () => {
  expect(() => serializeModule({ x: 1n } as unknown as IrModule)).toThrow(TypeError);
  expect(() => reference({ x: 1n })).toThrow(TypeError);
});

/* Deterministic fuzz: random trees over every value kind above. */
test("500 random trees are byte-identical", () => {
  let seed = 0x9e3779b9;
  const rnd = (): number => {
    seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0;
    return seed / 0x100000000;
  };
  const scalars: unknown[] = [null, true, false, 0, -0, 1, -7, 3.25, 1e21, NaN, Infinity, -Infinity, "", "a", "é\n", "\ud800", undefined, () => 0];
  const gen = (d: number): unknown => {
    const r = rnd();
    if (d > 5 || r < 0.35) return scalars[Math.floor(rnd() * scalars.length)];
    if (r < 0.65) return Array.from({ length: Math.floor(rnd() * 5) }, () => gen(d + 1));
    const o: Record<string, unknown> = {};
    for (let i = Math.floor(rnd() * 5); i > 0; i--) o[`k${Math.floor(rnd() * 8)}`] = gen(d + 1);
    return o;
  };
  for (let i = 0; i < 500; i++) same({ root: gen(0) });
});

test("chunked delivery joins to the same bytes, in chunks near 1 MiB", () => {
  const big = { fns: Array.from({ length: 6000 }, (_, i) => ({ name: `fn${i}`, body: Array.from({ length: 40 }, (_, j) => ({ kind: "numLit", value: i * j, type: { kind: "f64" } })) })) };
  const chunks: string[] = [];
  emitModuleJson(big as unknown as IrModule, (c) => chunks.push(c));
  expect(chunks.length).toBeGreaterThan(2);
  expect(Math.max(...chunks.map((c) => c.length))).toBeLessThan(2 * (1 << 20));
  expect(chunks.join("")).toBe(reference(big));
});

test("writeModuleFile writes the same bytes to disk", () => {
  const dir = mkdtempSync(join(tmpdir(), "irser-"));
  try {
    const big = { a: Array.from({ length: 200000 }, (_, i) => ({ i, s: `v${i}`, n: i % 7 === 0 ? NaN : i })) };
    const p = join(dir, "m.ir.json");
    writeModuleFile(p, big as unknown as IrModule);
    const text = readFileSync(p, "utf8");
    expect(statSync(p).size).toBeGreaterThan(2 * (1 << 20));
    expect(text).toBe(reference(big));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
