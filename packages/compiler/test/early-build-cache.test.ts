/* The early build cache, end to end through the real `compile()`.
 *
 * Two obligations, and the second is the one that matters:
 *   - an unchanged rebuild must HIT (otherwise the thing does nothing);
 *   - anything that changes the program must MISS.
 *
 * The negative cases are deliberately chosen to be ones a naive "hash the
 * source files" cache would get wrong. */

import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compile } from "../src/index.js";
import { FRAGMENT_VERSION, type LoweringFragment } from "../src/frontend/lowering/fragment.js";
import {
  publishEarlyBuildCache,
  readEarlyBuildCache,
  scriptcEnvironmentFingerprint,
  cacheVerificationDivergences,
  cacheVerifyEnabled,
  type CacheVerificationSubject,
  earlyCacheCounters,
  resetEarlyCacheCounters,
  writeEarlyCacheCounterFile,
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

  /* Verify mode's comparison, mutant per field FOUND.
   *
   * Same reasoning as the key test above, one layer in: the thing this mode
   * exists to catch is a field that silently stops being compared, so the
   * mode must not itself compare a remembered list. A field added to
   * EarlyBuildMetadata tomorrow gets a mutant here for free. */
  it("verification diverges on every metadata field, enumerated from the object rather than listed", () => {
    const meta = {
      backend: "llvm" as const,
      llvmRefusal: null,
      features: { regex: true },
      advisories: [],
      advisorySourceTexts: {},
      npmStatic: [],
    };
    const subject = () => ({ meta: { ...meta }, artifacts: new Map([["program.tu", new Uint8Array([1, 2, 3])]]) });

    // Control: identical subjects must produce NO divergence. Without this a
    // comparison that flagged everything would satisfy the loop below.
    expect(cacheVerificationDivergences(subject(), subject())).toEqual([]);

    const fields = Object.keys(meta);
    expect(fields.length).toBeGreaterThan(0);
    const unnoticed: string[] = [];
    for (const field of fields) {
      const fresh = subject();
      (fresh.meta as unknown as Record<string, unknown>)[field] = "__mutant__";
      const found = cacheVerificationDivergences(subject(), fresh);
      if (!found.some((line) => line.startsWith(`meta.${field}:`))) unnoticed.push(field);
    }
    expect(unnoticed, `metadata fields a stale hit could change unnoticed: ${unnoticed.join(", ")}`).toEqual([]);
  });


  /* Verify mode's FRAGMENT comparison, mutant PER FIELD found.
   *
   * Per field and not per fragment, deliberately. A whole-record mutant is
   * caught by any coarse check and proves nothing about granularity, and
   * granularity is the entire reason this mode exists: the failure worth
   * catching is one stale field inside an otherwise-correct fragment -- a
   * witness list that lost an entry, a mint whose ordinal moved -- not a
   * fragment that is obviously the wrong object.
   *
   * The witness is walked as its own level for the same reason the metadata
   * test walks EarlyBuildMetadata: the witness is where a field gets ADDED,
   * and a new witness field that nothing compares is exactly the bug this
   * mode is for. Add one tomorrow and it gets a mutant here for free. */
  it("verification diverges on every fragment field and every witness field, enumerated rather than listed", () => {
    const fragment = (): LoweringFragment => ({
      version: FRAGMENT_VERSION,
      module: "/p/lib.ts",
      functions: [],
      globals: [],
      mints: [{ localId: "r0", kind: "record" as const, structure: 'record{"a":{"kind":"f64"}}', ordinal: 0, loop: "body" as const }],
      edges: [{ from: "%lib.f", to: "%lib.g" }],
      witness: {
        readEntities: [{ localId: "r9", kind: "record" as const, structure: 'record{"b":{"kind":"string"}}' }],
        helpersReused: [{ internKey: "obj.keys:r9", sites: 2 }],
        reachableSubset: ["%lib.f"],
        moduleGraph: [{ specifier: "./dep", resolved: "/p/dep.ts" }],
        overflowGranted: ["k-granted"],
        overflowDenied: ["k-denied"],
        overflowUnanswered: ["k-neither"],
      },
      probes: [{ op: "file" as const, path: "/p/lib.ts", digest: "d" }],
    });
    const meta = {
      backend: "llvm" as const,
      llvmRefusal: null,
      features: {},
      advisories: [],
      advisorySourceTexts: {},
      npmStatic: [],
    };
    const subject = (): CacheVerificationSubject => ({
      meta: { ...meta },
      artifacts: new Map([["program.tu", new Uint8Array([1, 2, 3])]]),
      fragments: new Map([["/p/lib.ts", fragment()]]),
    });

    // Control: identical subjects must produce NO divergence. Without it, a
    // comparison that flagged everything would satisfy every loop below.
    expect(cacheVerificationDivergences(subject(), subject())).toEqual([]);

    // Every TOP-LEVEL fragment field, enumerated from the object.
    const topFields = Object.keys(fragment()).filter((f) => f !== "witness");
    expect(topFields.length).toBeGreaterThan(0);
    const unnoticedTop: string[] = [];
    for (const field of topFields) {
      const fresh = subject();
      (fresh.fragments!.get("/p/lib.ts") as unknown as Record<string, unknown>)[field] = "__mutant__";
      const found = cacheVerificationDivergences(subject(), fresh);
      if (!found.some((line) => line.startsWith(`fragment /p/lib.ts.${field}:`))) unnoticedTop.push(field);
    }
    expect(unnoticedTop, `fragment fields a stale hit could change unnoticed: ${unnoticedTop.join(", ")}`).toEqual([]);

    // Every WITNESS field, likewise.
    const witnessFields = Object.keys(fragment().witness);
    expect(witnessFields.length).toBeGreaterThan(0);
    const unnoticedWitness: string[] = [];
    for (const field of witnessFields) {
      const fresh = subject();
      const w = (fresh.fragments!.get("/p/lib.ts") as unknown as Record<string, unknown>)["witness"] as Record<string, unknown>;
      w[field] = "__mutant__";
      const found = cacheVerificationDivergences(subject(), fresh);
      if (!found.some((line) => line.startsWith(`fragment /p/lib.ts.witness.${field}:`))) unnoticedWitness.push(field);
    }
    expect(unnoticedWitness, `witness fields a stale hit could change unnoticed: ${unnoticedWitness.join(", ")}`).toEqual([]);

    // A mutant that is a SUBTLE edit rather than a type change, because
    // "__mutant__" would be caught by a comparison that only checked types.
    // One dropped entry from one witness list is the realistic stale-hit
    // shape: the fragment is otherwise entirely correct.
    const dropped = subject();
    dropped.fragments!.get("/p/lib.ts")!.witness.overflowDenied = [];
    expect(
      cacheVerificationDivergences(subject(), dropped)
        .some((line) => line.startsWith("fragment /p/lib.ts.witness.overflowDenied:")),
      "dropping the only negative overflow answer must be caught: a fragment recording just what it found is the defect this witness exists for",
    ).toBe(true);

    // ...and a fragment present on only one side, which is a different
    // failure from a field that moved and must read differently in the log.
    const noFragments = subject();
    noFragments.fragments = new Map();
    expect(
      cacheVerificationDivergences(subject(), noFragments)
        .some((line) => line.includes("not produced by the build")),
    ).toBe(true);
  });

  it("verification diverges on artifact bytes, and on an artifact present on only one side", () => {
    const meta = {
      backend: "llvm" as const,
      llvmRefusal: null,
      features: {},
      advisories: [],
      advisorySourceTexts: {},
      npmStatic: [],
    };
    const cached = { meta, artifacts: new Map([["program.tu", new Uint8Array([1, 2, 3])]]) };

    const differing = { meta, artifacts: new Map([["program.tu", new Uint8Array([1, 2, 4])]]) };
    expect(cacheVerificationDivergences(cached, differing).join("\n")).toContain("artifact program.tu:");

    // Equal length is not equality: a byte-for-byte walk must catch this.
    const sameLength = { meta, artifacts: new Map([["program.tu", new Uint8Array([3, 2, 1])]]) };
    expect(cacheVerificationDivergences(cached, sameLength)).toHaveLength(1);

    const extra = {
      meta,
      artifacts: new Map([
        ["program.tu", new Uint8Array([1, 2, 3])],
        ["program.header", new Uint8Array([9])],
      ]),
    };
    expect(cacheVerificationDivergences(cached, extra).join("\n")).toContain("program.header");
    expect(cacheVerificationDivergences(extra, cached).join("\n")).toContain("program.header");
  });

  /* The flag that turns the mode on must NOT be in the key. SCRIPTC_* is
   * folded by a blanket, so a verify flag inside it would change every key,
   * force a cold miss, and leave no hit to verify -- the mode would report
   * success having checked nothing. SCRIPTC_CACHE_DEBUG is the cautionary
   * twin: it IS in the key, so it can never instrument a cached build. */
  it("the verify flag is excluded from the key, and the debug flag is not", () => {
    const base = { PATH: "x" } as NodeJS.ProcessEnv;
    const withVerify = { ...base, SCRIPTC_CACHE_VERIFY: "1" };
    expect(scriptcEnvironmentFingerprint(withVerify)).toBe(scriptcEnvironmentFingerprint(base));
    expect(cacheVerifyEnabled(withVerify)).toBe(true);
    expect(cacheVerifyEnabled(base)).toBe(false);

    const withDebug = { ...base, SCRIPTC_CACHE_DEBUG: "1" };
    expect(scriptcEnvironmentFingerprint(withDebug)).not.toBe(scriptcEnvironmentFingerprint(base));
  });

  /* The counter exists because the log is hit-only: a reader seeing
   * "14 hits, 0 misses" takes the zero for a measurement rather than for a
   * missing instrument, and recovering the denominator otherwise means
   * walking the cache directory and arguing about whether eviction moved it.
   *
   * The third case is the one that would corrupt the rate: a build with no
   * cache configured must not count as a consultation, or every uncached
   * build in a process silently inflates the denominator. */
  it("counts consultations and hits, and does not count a build with the cache off", async () => {
    const dir = mkdtempSync(join(tmpdir(), "scriptc-early-count-"));
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
          features: {},
          advisories: [],
          advisorySourceTexts: {},
          npmStatic: [],
        },
        frontend: { version: 1, probes: [], stable: true },
      });

      resetEarlyCacheCounters();
      expect(earlyCacheCounters()).toEqual({ consultations: 0, hits: 0 });

      expect(await readEarlyBuildCache(root, options)).not.toBeNull();
      expect(earlyCacheCounters()).toEqual({ consultations: 1, hits: 1 });

      expect(await readEarlyBuildCache(root, { ...options, target: "other" })).toBeNull();
      expect(earlyCacheCounters()).toEqual({ consultations: 2, hits: 1 });

      // Cache off: neither half moves.
      expect(await readEarlyBuildCache(null, options)).toBeNull();
      expect(earlyCacheCounters()).toEqual({ consultations: 2, hits: 1 });
    } finally {
      resetEarlyCacheCounters();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /* The pair has to reach whoever is measuring, and stderr does not: vitest
   * forwards writes made DURING a test and drops an exit handler's, so the
   * number was invisible in exactly the log it exists for. A file under the
   * cache root is not on that path, and it keeps working outside vitest
   * where no afterAll or reporter exists to hang a hook on.
   *
   * The writer is a separate function precisely so it can be tested; an exit
   * handler cannot be. It must also stay synchronous -- an exit handler gets
   * no further turns of the loop, so an async write would never land and the
   * counter would be silently empty. */
  it("writes the pair to a per-process file, and writes nothing below two consultations", async () => {
    const dir = mkdtempSync(join(tmpdir(), "scriptc-early-file-"));
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
          features: {},
          advisories: [],
          advisorySourceTexts: {},
          npmStatic: [],
        },
        frontend: { version: 1, probes: [], stable: true },
      });

      resetEarlyCacheCounters();

      // One consultation is not a rate: nothing is written.
      await readEarlyBuildCache(root, options);
      expect(writeEarlyCacheCounterFile(root)).toBeNull();
      expect(existsSync(join(root, "counters"))).toBe(false);

      // Two: a file appears, naming this process.
      await readEarlyBuildCache(root, { ...options, target: "other" });
      const written = writeEarlyCacheCounterFile(root);
      expect(written).not.toBeNull();
      const files = readdirSync(join(root, "counters"));
      expect(files).toHaveLength(1);
      expect(files[0]).toContain(String(process.pid));
      const recorded = JSON.parse(readFileSync(written!, "utf8")) as {
        pid: number;
        consultations: number;
        hits: number;
      };
      expect(recorded).toMatchObject({ pid: process.pid, consultations: 2, hits: 1 });
    } finally {
      resetEarlyCacheCounters();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
