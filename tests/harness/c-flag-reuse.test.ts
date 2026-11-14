/* A VARIANT THAT CHANGES ONLY C-COMPILER FLAGS REUSES THE LOWERING; ONE THAT CHANGES EMISSION DOES NOT; A KEPT BUILD CAN BE RE-LINKED.
 *
 * The early cache answers before the frontend and codegen run. Its key used to contain every SCRIPTC_* variable, so an extra -D or -include
 * (SCRIPTC_PROF_CFLAGS), another -O level, or a different -o missed it and paid the full lowering again (25 minutes on the zapo apps) for
 * a program whose emitted C was byte-identical. The key now leaves out nine variables that only backend/cc.ts reads (the list and its
 * tripwire are in packages/compiler/test/early-cache-env.test.ts) and the output path and --layout-profile, which act on the native stage alone.
 *
 *   plain, then SCRIPTC_PROF_CFLAGS=-D...  -- the second build logs "early cache hit" and its binary prints what Node prints;
 *   plain, then SCRIPTC_STABLE_NAMES=0     -- the negative control: an emission variable still re-lowers (no hit);
 *   plain, then --layout-profile           -- hits too, and the binary is instrumented;
 *   --from-kept <stem>.keep.json           -- re-runs clang and the link from the kept directory (split parts included) with new C flags;
 *                                             it refuses --sanitize against a plain keep, because the emitted program would differ.
 * Both backends; SCRIPTC_SPLIT_PARTS=3 makes the C build a split program. */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { compile, compileKept } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const repoRoot = join(import.meta.dirname, "../..");
const linux = process.platform === "linux";
const SRC = join(repoRoot, "tests/corpus/4651-a-union-spread-whose-source-is-a-narrowed-arm-of-its-own-slot.ts");

const keys = ["SCRIPTC_CACHE_DIR", "SCRIPTC_SPLIT_PARTS", "SCRIPTC_PROF_CFLAGS", "SCRIPTC_STABLE_NAMES"] as const;
const saved: Record<string, string | undefined> = {};

function run(bin: string): string {
  return execFileSync(bin, [], { encoding: "utf8" });
}

async function build(
  dir: string,
  tag: string,
  backend: "c" | "llvm",
  env: Record<string, string> = {},
  extra: { layoutProfile?: boolean } = {},
): Promise<{ bin: string; hit: boolean }> {
  for (const k of ["SCRIPTC_PROF_CFLAGS", "SCRIPTC_STABLE_NAMES"]) delete process.env[k];
  Object.assign(process.env, env);
  const writes: string[] = [];
  const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    writes.push(String(chunk));
    return true;
  });
  try {
    const r = await compile(join(dir, "m.ts"), { outPath: join(dir, exeName(tag)), outDir: dir, backend, ...extra });
    if (!r.ok) throw new Error(r.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
    return { bin: r.binaryPath, hit: writes.some((w) => w.includes("early cache hit")) };
  } finally {
    spy.mockRestore();
    for (const k of ["SCRIPTC_PROF_CFLAGS", "SCRIPTC_STABLE_NAMES"]) delete process.env[k];
  }
}

describe.skipIf(!linux)("C-flag-only variants reuse the lowering", () => {
  beforeAll(() => {
    for (const k of keys) saved[k] = process.env[k];
    process.env["SCRIPTC_CACHE_DIR"] = mkdtempSync(join(tmpdir(), "scriptc-cflagreuse-cache-"));
    process.env["SCRIPTC_SPLIT_PARTS"] = "3";
  });
  afterAll(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  for (const backend of ["c", "llvm"] as const) {
    test(`${backend}: a -D variant hits and matches Node, an emission variable misses, --layout-profile hits, --from-kept re-links`, async () => {
      const dir = mkdtempSync(join(tmpdir(), `scriptc-cflagreuse-${backend}-`));
      copyFileSync(SRC, join(dir, "m.ts"));
      const node = execFileSync(process.execPath, ["--experimental-strip-types", join(dir, "m.ts")], { encoding: "utf8" });

      const a = await build(dir, "a", backend);
      expect(a.hit).toBe(false);
      expect(run(a.bin)).toBe(node);
      if (backend === "c") expect(readdirSync(dir).filter((f) => /^m\.part\d+\.c$/.test(f)).length).toBeGreaterThanOrEqual(2);
      expect(existsSync(join(dir, "m.keep.json"))).toBe(true);

      const b = await build(dir, "b", backend, { SCRIPTC_PROF_CFLAGS: "-DCFG_PROBE=1" });
      expect(b.hit).toBe(true);
      expect(run(b.bin)).toBe(node);

      const c = await build(dir, "c", backend, { SCRIPTC_STABLE_NAMES: "0" });
      expect(c.hit).toBe(false);
      expect(run(c.bin)).toBe(node);

      const d = await build(dir, "d", backend, {}, { layoutProfile: true });
      expect(d.hit).toBe(true);
      expect(run(d.bin)).toBe(node);
      expect(execFileSync("nm", [d.bin], { encoding: "utf8", maxBuffer: 1 << 28 })).toContain("scr_lp_");

      // the keep file from the LAST real build (c) is what --from-kept reads; re-link it with a new -D
      const keep = JSON.parse(readFileSync(join(dir, "m.keep.json"), "utf8")) as { backend: string; parts: string[] };
      expect(keep.backend).toBe(backend);
      process.env["SCRIPTC_PROF_CFLAGS"] = "-DCFG_PROBE=2";
      const eOut = join(dir, exeName("e"));
      try {
        await compileKept(join(dir, "m.keep.json"), { outPath: eOut });
      } finally {
        delete process.env["SCRIPTC_PROF_CFLAGS"];
      }
      expect(run(eOut)).toBe(node);

      // the kept build was not --sanitize: a sanitized re-link would run a program emitted differently
      await expect(compileKept(join(dir, "m.keep.json"), { outPath: join(dir, exeName("f")), sanitize: true })).rejects.toThrow(/--sanitize/);
    }, 600_000);
  }
});
