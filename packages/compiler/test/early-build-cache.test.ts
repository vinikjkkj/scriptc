/* The early build cache, end to end through the real `compile()`.
 *
 * Two obligations, and the second is the one that matters:
 *   - an unchanged rebuild must HIT (otherwise the thing does nothing);
 *   - anything that changes the program must MISS.
 *
 * The negative cases are deliberately chosen to be ones a naive "hash the
 * source files" cache would get wrong. */

import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compile } from "../src/index.js";
import {
  publishEarlyBuildCache,
  readEarlyBuildCache,
  scriptcEnvironmentFingerprint,
  type EarlyBuildCacheOptions,
} from "../src/frontend/early-cache.js";

interface Fixture {
  dir: string;
  entry: string;
  outDir: string;
  outPath: string;
  cache: string;
}

function fixture(source: string): Fixture {
  const dir = mkdtempSync(join(tmpdir(), "scriptc-early-cache-"));
  const entry = join(dir, "prog.ts");
  writeFileSync(entry, source);
  const outDir = join(dir, "out");
  const cache = join(dir, "cache");
  mkdirSync(cache, { recursive: true });
  return { dir, entry, outDir, outPath: join(outDir, "prog.exe"), cache };
}

/** Runs compile() far enough to produce (or restore) the TU, without paying
 * for clang. Returns the emitted TU bytes and whether the run was a hit. */
async function buildTu(f: Fixture): Promise<{ tu: string; hit: boolean }> {
  const previousCache = process.env["SCRIPTC_CACHE_DIR"];
  const previousNoCache = process.env["SCRIPTC_NO_CACHE"];
  process.env["SCRIPTC_CACHE_DIR"] = f.cache;
  delete process.env["SCRIPTC_NO_CACHE"];
  const chunks: string[] = [];
  const write = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array) => {
    chunks.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    await compile(f.entry, { outPath: f.outPath, outDir: f.outDir });
  } finally {
    process.stderr.write = write;
    if (previousCache === undefined) delete process.env["SCRIPTC_CACHE_DIR"];
    else process.env["SCRIPTC_CACHE_DIR"] = previousCache;
    if (previousNoCache !== undefined) process.env["SCRIPTC_NO_CACHE"] = previousNoCache;
  }
  const tuPath = join(f.outDir, "prog.ll");
  let tu: string;
  try {
    tu = readFileSync(tuPath, "utf8");
  } catch {
    tu = readFileSync(join(f.outDir, "prog.c"), "utf8");
  }
  return { tu, hit: chunks.join("").includes("early cache hit") };
}

describe("early build cache", () => {
  it("an unchanged rebuild hits and reproduces the TU byte for byte", async () => {
    const f = fixture('const xs: number[] = [1, 2, 3];\nconsole.log(xs.join("-"));\n');
    try {
      const first = await buildTu(f);
      expect(first.hit).toBe(false);
      const second = await buildTu(f);
      expect(second.hit).toBe(true);
      expect(second.tu).toBe(first.tu);
    } finally {
      rmSync(f.dir, { recursive: true, force: true });
    }
  });

  it("an edited entry misses, and the TU changes", async () => {
    const f = fixture('console.log("first");\n');
    try {
      const first = await buildTu(f);
      expect(first.hit).toBe(false);
      writeFileSync(f.entry, 'console.log("second");\n');
      const second = await buildTu(f);
      expect(second.hit).toBe(false);
      expect(second.tu).not.toBe(first.tu);
      expect(second.tu).toContain("second");
    } finally {
      rmSync(f.dir, { recursive: true, force: true });
    }
  });

  it("a newly-created module that wins resolution misses", async () => {
    // No recorded READ goes stale here. Only the retained failed probe for the
    // .ts candidate can see it.
    const f = fixture('import { v } from "./dep.js";\nconsole.log(v);\n');
    try {
      writeFileSync(join(f.dir, "dep.js"), 'export const v = "from-js";\n');
      const first = await buildTu(f);
      expect(first.hit).toBe(false);
      expect(first.tu).toContain("from-js");

      writeFileSync(join(f.dir, "dep.ts"), 'export const v: string = "from-ts";\n');
      const second = await buildTu(f);
      expect(second.hit).toBe(false);
      expect(second.tu).toContain("from-ts");
    } finally {
      rmSync(f.dir, { recursive: true, force: true });
    }
  });

  it("a SCRIPTC_* knob nobody allowlisted still changes the key", () => {
    // The blanket env rule. cc.ts records what an allowlist cost: a forced
    // include outside the fingerprint rebuilt a byte-identical exe and
    // reported the previous instrument's numbers.
    const base = scriptcEnvironmentFingerprint({ SCRIPTC_TARGET: "x86_64-windows-gnu" });
    const knob = scriptcEnvironmentFingerprint({
      SCRIPTC_TARGET: "x86_64-windows-gnu",
      SCRIPTC_SOME_FUTURE_KNOB: "1",
    });
    expect(knob).not.toBe(base);
    // ...while the three variables that configure only this cache do not.
    expect(
      scriptcEnvironmentFingerprint({
        SCRIPTC_TARGET: "x86_64-windows-gnu",
        SCRIPTC_CACHE_DIR: "/somewhere",
        SCRIPTC_CACHE_MAX_MB: "16",
      }),
    ).toBe(base);
  });

  it("two compiler arms over byte-identical input do not share an entry", async () => {
    // The A/B rig's failure mode, and the reason `implementation` is in the
    // key at all. Two compiler builds read the same entry, the same
    // node_modules and the same runtime C; the only difference is the
    // compiler. Serving arm A's TU to arm B would be green, silent, and would
    // turn every downstream number into a floor measurement wearing a result.
    //
    // The end-to-end half of this is in the block log: the same tiny program
    // built under two compiler dists produced impl dfa21c2f6708 / 57599d37df61
    // and TUs 92E9FEB3A9EAD324 / 4F6925E70B5CEBCD, with each arm re-hitting
    // its OWN entry afterwards. This is the part a unit test can hold.
    const dir = mkdtempSync(join(tmpdir(), "scriptc-early-arms-"));
    try {
      const outDir = join(dir, "out");
      mkdirSync(outDir, { recursive: true });
      const tu = join(outDir, "prog.ll");
      writeFileSync(tu, "; arm A\n");
      const root = join(dir, "cache");
      const armA: EarlyBuildCacheOptions = {
        entryPath: join(dir, "prog.ts"),
        outDir,
        outPath: join(outDir, "prog.exe"),
        compileOptions: "{}",
        provenance: "null",
        target: "test",
        cc: "zigcc",
        nodeVersion: process.version,
        implementation: "compiler-dist-A",
        environment: "env",
        profFlavor: "",
        cwd: dir,
      };
      const armB = { ...armA, implementation: "compiler-dist-B" };
      const meta = {
        backend: "llvm" as const,
        llvmRefusal: null,
        features: {},
        advisories: [],
        advisorySourceTexts: {},
        npmStatic: [],
      };
      const publish = { cPath: tu, cPathParts: [], cPathHeader: undefined, irPath: undefined, meta };
      const frontend = { version: 1 as const, probes: [], stable: true };
      await publishEarlyBuildCache(root, armA, { ...publish, frontend });
      expect(await readEarlyBuildCache(root, armA)).not.toBeNull();
      // Arm B must not see arm A's entry...
      expect(await readEarlyBuildCache(root, armB)).toBeNull();
      // ...and once B publishes, both arms keep their own.
      writeFileSync(tu, "; arm B\n");
      await publishEarlyBuildCache(root, armB, { ...publish, frontend });
      expect(await readEarlyBuildCache(root, armA)).not.toBeNull();
      expect(readFileSync(tu, "utf8")).toBe("; arm A\n");
      expect(await readEarlyBuildCache(root, armB)).not.toBeNull();
      expect(readFileSync(tu, "utf8")).toBe("; arm B\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a tampered stamp and a corrupted artifact both read as a miss", async () => {
    const dir = mkdtempSync(join(tmpdir(), "scriptc-early-stamp-"));
    try {
      const outDir = join(dir, "out");
      mkdirSync(outDir, { recursive: true });
      const tu = join(outDir, "prog.ll");
      writeFileSync(tu, "; translation unit\n");
      const root = join(dir, "cache");
      const options: EarlyBuildCacheOptions = {
        entryPath: join(dir, "prog.ts"),
        outDir,
        outPath: join(outDir, "prog.exe"),
        compileOptions: "{}",
        provenance: "null",
        target: "test",
        cc: "zigcc",
        nodeVersion: process.version,
        implementation: "impl",
        environment: "env",
        profFlavor: "",
        cwd: dir,
      };
      await publishEarlyBuildCache(root, options, {
        cPath: tu,
        cPathParts: [],
        cPathHeader: undefined,
        irPath: undefined,
        meta: {
          backend: "llvm",
          llvmRefusal: null,
          features: { regex: false },
          advisories: [],
          advisorySourceTexts: {},
          npmStatic: [],
        },
        frontend: { version: 1, probes: [], stable: true },
      });
      expect(await readEarlyBuildCache(root, options)).not.toBeNull();

      // Rewrite the stored artifact without touching the stamp: the digest
      // no longer matches, so the entry must not be served.
      const { readdirSync } = await import("node:fs");
      const keyDir = join(root, "early-build", readdirSync(join(root, "early-build"))[0]!);
      writeFileSync(join(keyDir, "program.tu"), "; tampered\n");
      expect(await readEarlyBuildCache(root, options)).toBeNull();

      // An unstable snapshot is never published at all.
      await publishEarlyBuildCache(root, { ...options, cwd: `${dir}-other` }, {
        cPath: tu,
        cPathParts: [],
        cPathHeader: undefined,
        irPath: undefined,
        meta: {
          backend: "llvm",
          llvmRefusal: null,
          features: {},
          advisories: [],
          advisorySourceTexts: {},
          npmStatic: [],
        },
        frontend: { version: 1, probes: [], stable: false },
      });
      expect(await readEarlyBuildCache(root, { ...options, cwd: `${dir}-other` })).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is off entirely when SCRIPTC_CACHE_DIR is unset", async () => {
    const f = fixture('console.log("no cache");\n');
    const previous = process.env["SCRIPTC_CACHE_DIR"];
    try {
      delete process.env["SCRIPTC_CACHE_DIR"];
      const chunks: string[] = [];
      const write = process.stderr.write.bind(process.stderr);
      process.stderr.write = ((chunk: string | Uint8Array) => {
        chunks.push(String(chunk));
        return true;
      }) as typeof process.stderr.write;
      try {
        await compile(f.entry, { outPath: f.outPath, outDir: f.outDir });
        await compile(f.entry, { outPath: f.outPath, outDir: f.outDir });
      } finally {
        process.stderr.write = write;
      }
      expect(chunks.join("")).not.toContain("early cache hit");
      const { readdirSync } = await import("node:fs");
      expect(() => readdirSync(join(f.cache, "early-build"))).toThrow();
    } finally {
      if (previous !== undefined) process.env["SCRIPTC_CACHE_DIR"] = previous;
      rmSync(f.dir, { recursive: true, force: true });
    }
  });

  /* The tests above each name ONE thing that must change the key, and the
   * header calls them "deliberately chosen" -- chosen, that is, from what
   * their author remembered. That shape cannot cover a field added tomorrow,
   * and the field nobody remembers is exactly the one that silently stops
   * participating.
   *
   * So this test names no fields. It enumerates them from the options object
   * itself and demands a miss for each one it FINDS. Add a field to
   * EarlyBuildCacheOptions and forget it in cacheKey(), and this goes red
   * naming that field, with nobody having edited this test.
   *
   * Why a miss is the right probe rather than reading cacheKey() directly:
   * an unfolded field leaves entryDir identical AND satisfies the
   * `stamp.key !== cacheKey(options)` guard, so it surfaces as a HIT. The
   * observable behaviour is the thing that matters anyway. */
  it("every options field participates in the key, enumerated from the object rather than listed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "scriptc-early-structural-"));
    try {
      const outDir = join(dir, "out");
      mkdirSync(outDir, { recursive: true });
      const tu = join(outDir, "prog.ll");
      writeFileSync(tu, "; translation unit\n");
      const root = join(dir, "cache");
      const baseline: EarlyBuildCacheOptions = {
        entryPath: join(dir, "prog.ts"),
        outDir,
        outPath: join(outDir, "prog.exe"),
        compileOptions: "{}",
        provenance: "null",
        target: "test",
        cc: "zigcc",
        nodeVersion: process.version,
        implementation: "impl",
        environment: "env",
        profFlavor: "",
        cwd: dir,
      };
      await publishEarlyBuildCache(root, baseline, {
        cPath: tu,
        cPathParts: [],
        cPathHeader: undefined,
        irPath: undefined,
        meta: {
          backend: "llvm",
          llvmRefusal: null,
          features: {},
          advisories: [],
          advisorySourceTexts: {},
          npmStatic: [],
        },
        frontend: { version: 1, probes: [], stable: true },
      });

      // Control. Without it, a fixture that missed on EVERYTHING -- a typo in
      // `root`, say -- would satisfy every assertion below for the wrong
      // reason, and this test would pass while proving nothing.
      expect(await readEarlyBuildCache(root, baseline)).not.toBeNull();

      const fields = Object.keys(baseline) as (keyof EarlyBuildCacheOptions)[];
      // The enumeration itself must not be empty, or the loop is vacuous.
      expect(fields.length).toBeGreaterThan(0);

      const ignored: string[] = [];
      for (const field of fields) {
        const mutant: EarlyBuildCacheOptions = { ...baseline, [field]: `${baseline[field]}-mutant` };
        if ((await readEarlyBuildCache(root, mutant)) !== null) ignored.push(field);
      }
      expect(ignored, `options fields that do not participate in the cache key: ${ignored.join(", ")}`).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
