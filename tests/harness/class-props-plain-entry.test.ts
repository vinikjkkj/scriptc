/* A plain data property of a class instance's run-time property table is stored as the bare value, not as a five-element descriptor row.
 *
 * POSITIVE CONTROL: the same program with a NON-default attribute on the property (enumerable: false, written through defineProperty) must keep the
 * row, so 100,000 instances holding one property each cost about 140 bytes more per instance there than with the plain expando write. Both programs
 * print the same sum of what they read back; only the resident size differs. Linux only (the size is read from /proc/self/status), plain build
 * (the cycle arena is off under --sanitize), both backends. */
import { spawnSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const repoRoot = join(import.meta.dirname, "../..");
const cacheDir = join(repoRoot, "node_modules/.cache/scriptc-tests");

const HEAD = [
  'import { readFileSync } from "node:fs";',
  'const rss = (): number => { const m = /VmRSS:\\s+(\\d+)/.exec(readFileSync("/proc/self/status", "utf8")); return m ? Number(m[1]) : -1; };',
  "class Box { name: string; constructor(n: string) { this.name = n; } }",
  "const rt = process.argv.length > 99 ? 'zz' : '';",
  // names the class: it carries a table
  "Object.defineProperty(new Box('seed'), 'seed' + rt, { value: 0, enumerable: true, writable: true, configurable: true });",
  "const k = 'pipelineIndex' + rt;",
  "const N = 100_000;",
  "const boxes: Box[] = [];",
  "const before = rss();",
];
const TAIL = [
  "let sum = 0;",
  "for (let i = 0; i < N; i++) sum += (boxes[i] as any)[k];",
  'console.log("sum", sum, "delta_kB", rss() - before);',
  "",
];
const PLAIN = [...HEAD, "for (let i = 0; i < N; i++) { const b = new Box('b'); (b as any)[k] = i; boxes.push(b); }", ...TAIL].join("\n");
const ROW = [
  ...HEAD,
  "for (let i = 0; i < N; i++) { const b = new Box('b'); Object.defineProperty(b, k, { value: i, enumerable: false, writable: true, configurable: true }); boxes.push(b); }",
  ...TAIL,
].join("\n");

async function build(tag: string, source: string, backend: "c" | "llvm"): Promise<string> {
  const dir = join(cacheDir, `props-plain-${tag}-${backend}`);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const src = join(dir, "p.ts");
  await writeFile(src, source);
  const result = await compile(src, { outPath: join(dir, exeName("program")), outDir: dir, backend });
  if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
  return result.binaryPath;
}

const run = (bin: string): { sum: number; delta: number } => {
  const r = spawnSync(bin, [], { encoding: "utf8" });
  const m = /sum (\d+) delta_kB (-?\d+)/.exec(r.stdout);
  expect(m, `no result line in: ${r.stdout}${r.stderr}`).not.toBeNull();
  return { sum: Number(m![1]), delta: Number(m![2]) };
};

describe.skipIf(process.platform !== "linux")("a plain table property is the bare value", () => {
  for (const backend of ["c", "llvm"] as const) {
    test(`100,000 instances with one plain property hold far less than with a non-default one (${backend})`, async () => {
      const plain = run(await build("plain", PLAIN, backend));
      const row = run(await build("row", ROW, backend));
      expect(plain.sum).toBe(4_999_950_000);
      expect(row.sum).toBe(plain.sum);
      // the control keeps the descriptor row (a 64-byte node and its items buffer): about 14 MB more than the bare value
      expect(row.delta - plain.delta, `row ${row.delta} kB, plain ${plain.delta} kB`).toBeGreaterThan(8_000);
      expect(plain.delta, `row ${row.delta} kB, plain ${plain.delta} kB`).toBeLessThan(row.delta * 0.8);
    }, 480_000);
  }
});
