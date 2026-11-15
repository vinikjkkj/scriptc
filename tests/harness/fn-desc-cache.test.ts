/* The dyn function-descriptor cache (scr_json.c, scr_dyn_new_func_src) answers a function box from a small cache before it interns anything.
 *
 * It used to be direct-mapped with 128 slots and a xor-shift index. On the real apps it missed 4-33% of the boxes (postgres bench: 32.8% after an unrelated
 * change moved the code), because two hot box sites whose indexes collide evict each other on every call, and which pairs collide is decided by code addresses.
 * It is now 4-way set-associative with a multiplicative index, and the bench counts its misses through the lab counter -DSCR_FD_STAT.
 *
 * This test boxes a fresh function value at each of 40 DISTINCT sites, round-robin, 20 times each (800 boxes), and asks the counter for the misses: the cold fills (40) plus whatever
 * a set that happens to hold five of them costs. The bound is generous (25% of the boxes) because which set a function lands in depends on the binary's
 * addresses; what it guards is the failure mode, a cache that misses on most boxes. It also checks that the answers do not depend on the cache: the program prints
 * the same as Node. */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const linux = process.platform === "linux";
const N = 40;
const ROUNDS = 20;

function source(): string {
  const L: string[] = [];
  L.push("function call(f, x) { return f(x); }");
  // N distinct box SITES: each one creates a FRESH closure per call and passes it to a dynamic parameter, so each call boxes a function value (a box per call, as
  // ioredis's then/catch callbacks do), and the sites alternate.
  for (let i = 0; i < N; i++) L.push(`function site${i}(v) { return call((x) => x + v + ${i}, v); }`);
  L.push("const sites = [" + Array.from({ length: N }, (_, i) => `site${i}`).join(", ") + "];");
  L.push("let t = 0;");
  L.push(`for (let i = 0; i < ${N * ROUNDS}; i++) { t = (t + sites[i % ${N}](i)) | 0; }`);
  L.push("console.log(t);");
  return L.join("\n") + "\n";
}

const saved: Record<string, string | undefined> = {};
const keys = ["SCRIPTC_CACHE_DIR", "SCRIPTC_PROF_CFLAGS"] as const;

describe.skipIf(!linux)("the function-descriptor cache keeps its misses near the cold fills", () => {
  beforeAll(() => {
    for (const k of keys) saved[k] = process.env[k];
    process.env["SCRIPTC_CACHE_DIR"] = mkdtempSync(join(tmpdir(), "scriptc-fdcache-cache-"));
    process.env["SCRIPTC_PROF_CFLAGS"] = "-DSCR_FD_STAT";
  });
  afterAll(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  for (const backend of ["c", "llvm"] as const) {
    test(`${backend}: ${N} distinct functions boxed ${N * ROUNDS} times miss at most a quarter of them, and print what Node prints`, async () => {
      const dir = mkdtempSync(join(tmpdir(), `scriptc-fdcache-${backend}-`));
      writeFileSync(join(dir, "m.js"), source());
      const node = execFileSync(process.execPath, [join(dir, "m.js")], { encoding: "utf8" });
      const r = await compile(join(dir, "m.js"), { outPath: join(dir, exeName("m")), outDir: dir, backend });
      if (!r.ok) throw new Error(r.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
      const run = spawnSync(r.binaryPath, [], { encoding: "utf8" });
      expect(run.status).toBe(0);
      expect(run.stdout).toBe(node);
      const m = /SCR_FD_STAT calls=(\d+) miss=(\d+)/.exec(run.stderr);
      expect(m, `no SCR_FD_STAT line: the counter was not compiled in (stderr: ${run.stderr.slice(0, 200)})`).not.toBeNull();
      const calls = Number(m![1]);
      const miss = Number(m![2]);
      expect(calls).toBeGreaterThanOrEqual(N * ROUNDS); // every box went through the cache (the control: the counter really counts)
      expect(miss).toBeGreaterThanOrEqual(N); // and the cold fills are counted too
      expect(miss).toBeLessThanOrEqual(Math.floor(calls / 4));
    }, 600_000);
  }
});
