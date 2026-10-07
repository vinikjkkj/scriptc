/* The build cache's two ways of handing out a wrong answer (cc.ts).
 *
 * Both were chased as code regressions before they were recognised as cache
 * defects, and one of them is silent — so these are pinned as properties of
 * the cache, not as symptoms of the programs that tripped over them.
 *
 * 1. SILENT: a stale object under a live key. The obj/ and bin/ keys hash a
 *    "runtime fingerprint" that once covered only packages/runtime/src's own
 *    .c/.h plus four vendor version strings. scr_number.c textually
 *    `#include`s ../vendor/ryu/d2s.c and monocypher's TUs are compiled like
 *    any runtime source, so an edit to the vendored tree did not move the
 *    key: the cached object was linked against a source tree that no longer
 *    matched it, and the binary built clean, ran, and printed wrong numbers.
 *
 * 2. LOUD: `lld-link: error: could not open '…/scr_number.o'`. The LRU sweep
 *    treated the runtime objects as the coldest entries in the tree (they are
 *    written once and only ever read, so nothing moved their mtime) and
 *    evicted them out from under concurrent builds that had already resolved
 *    their paths.
 *
 * The fingerprint tests build a runtime tree of their own under tmp rather
 * than touching the repo's, so they assert the real function's real behaviour
 * without mutating the vendored sources.
 */
import { mkdir, mkdtemp, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import type { CcDriver } from "../src/backend/cc.js";
import { checkToolchain, pruneCacheOnce, runtimeFingerprint, runtimeSrcDir, stampToolchain, toolchainId } from "../src/backend/cc.js";

const temps: string[] = [];
async function tmp(prefix: string): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), prefix));
  temps.push(d);
  return d;
}
afterAll(async () => {
  for (const d of temps) await rm(d, { recursive: true, force: true });
});

/** Collect what the detector writes to stderr. It reports through
 * process.stderr.write like the rest of cc.ts, so the test has to take the
 * same channel rather than a logger seam that production does not use. */
function capture(into: string[]): () => void {
  const original = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: unknown): boolean => {
    into.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  return () => {
    process.stderr.write = original;
  };
}

/** A miniature @scriptc/runtime package: `src` beside `vendor`, the shape
 * runtimeFingerprint walks. */
async function fakeRuntime(): Promise<string> {
  const pkg = await tmp("scr-fp-");
  await mkdir(join(pkg, "src"), { recursive: true });
  await mkdir(join(pkg, "vendor", "ryu"), { recursive: true });
  await mkdir(join(pkg, "vendor", "monocypher"), { recursive: true });
  await writeFile(join(pkg, "src", "scr_runtime.h"), "#define SCR_X 1\n");
  await writeFile(join(pkg, "src", "scr_number.c"), '#include "../vendor/ryu/d2s.c"\n');
  await writeFile(join(pkg, "vendor", "ryu", "d2s.c"), "int d2d(void) { return 1; }\n");
  await writeFile(join(pkg, "vendor", "ryu", "ryu.h"), "int d2d(void);\n");
  await writeFile(join(pkg, "vendor", "monocypher", "monocypher.c"), "int crypto(void) { return 1; }\n");
  return join(pkg, "src");
}

describe("cache key covers every input the build compiles", () => {
  test("a change under vendor/ moves the fingerprint", async () => {
    const rtDir = await fakeRuntime();
    const before = await runtimeFingerprint(rtDir);

    // The exact edit that produced a silently wrong binary: the vendored ryu
    // that scr_number.c textually includes, changed without touching src/.
    await writeFile(join(rtDir, "..", "vendor", "ryu", "d2s.c"), "int d2d(void) { return 2; }\n");
    const after = await runtimeFingerprint(rtDir);

    expect(after).not.toBe(before);
  });

  test("a change under vendor/ in a HEADER moves it too", async () => {
    const rtDir = await fakeRuntime();
    const before = await runtimeFingerprint(rtDir);
    await writeFile(join(rtDir, "..", "vendor", "ryu", "ryu.h"), "int d2d(void); /* v2 */\n");
    expect(await runtimeFingerprint(rtDir)).not.toBe(before);
  });

  test("a change under src/ still moves it", async () => {
    const rtDir = await fakeRuntime();
    const before = await runtimeFingerprint(rtDir);
    await writeFile(join(rtDir, "scr_runtime.h"), "#define SCR_X 2\n");
    expect(await runtimeFingerprint(rtDir)).not.toBe(before);
  });

  /* The instrument must be able to say "no difference" — a fingerprint that
   * changed on every call would pass all three tests above and mean nothing. */
  test("an unchanged tree keeps the same fingerprint", async () => {
    const rtDir = await fakeRuntime();
    expect(await runtimeFingerprint(rtDir)).toBe(await runtimeFingerprint(rtDir));
  });

  /* vendor/.cache holds this cache's OWN products (libqjs.a, the per-target
   * object sets). Hashing them would make the key depend on its own output. */
  test("vendor/.cache is excluded", async () => {
    const rtDir = await fakeRuntime();
    const before = await runtimeFingerprint(rtDir);
    await mkdir(join(rtDir, "..", "vendor", ".cache", "abc"), { recursive: true });
    await writeFile(join(rtDir, "..", "vendor", ".cache", "abc", "built.c"), "int built(void){return 0;}\n");
    expect(await runtimeFingerprint(rtDir)).toBe(before);
  });

  /* The real tree, not a fake one: whatever else changes, the fingerprint must
   * still be reachable and stable for the runtime this compiler actually ships. */
  test("the shipped runtime tree fingerprints stably", async () => {
    const a = await runtimeFingerprint(runtimeSrcDir());
    const b = await runtimeFingerprint(runtimeSrcDir());
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("the LRU sweep spares what a live build is linking", () => {
  /** A cache root shaped like the one that failed in the field.
   *
   * The ages are the whole point. A binary's mtime is bumped on every cache
   * HIT, so live binaries look recent; a runtime object was written once and
   * only ever read, so its mtime never moved again and it looks like the
   * coldest thing in the tree. Objects are therefore aged OLDER than the
   * binaries here — which is exactly why an oldest-first sweep reached them
   * first, and why sparing them has to be a rule and not a side effect of
   * where the byte target happens to land. Both ages are past the sweep's
   * one-hour "never evict anything a live run may be using" guard. */
  async function fakeCache(bins: number, objs: number, bytes = 64 * 1024): Promise<string> {
    const root = await tmp("scr-prune-");
    await mkdir(join(root, "bin"), { recursive: true });
    await mkdir(join(root, "obj", "aaaaaaaaaaaaaaaaaaaaaaaa"), { recursive: true });
    await mkdir(join(root, "staging", "build-live"), { recursive: true });
    const blob = Buffer.alloc(bytes, 7);
    const objOld = new Date(Date.now() - 5 * 60 * 60 * 1000); // never bumped
    const binOld = new Date(Date.now() - 2 * 60 * 60 * 1000); // bumped on hits
    for (let i = 0; i < bins; i++) {
      const p = join(root, "bin", `b${i}`);
      await writeFile(p, blob);
      await utimes(p, binOld, binOld);
    }
    for (let i = 0; i < objs; i++) {
      const p = join(root, "obj", "aaaaaaaaaaaaaaaaaaaaaaaa", `o${i}.o`);
      await writeFile(p, blob);
      await utimes(p, objOld, objOld);
    }
    const live = join(root, "staging", "build-live", "half.o");
    await writeFile(live, blob);
    await utimes(live, objOld, objOld);
    return root;
  }
  const count = async (d: string): Promise<number> => (await readdir(d).catch(() => [])).length;

  test("a sweep evicts binaries and leaves the object set whole", async () => {
    const root = await fakeCache(32, 20);
    const objDir = join(root, "obj", "aaaaaaaaaaaaaaaaaaaaaaaa");
    expect(await count(objDir)).toBe(20);

    // 1 MB against a ~3.3 MB tree: the sweep has real work to do.
    const prev = process.env["SCRIPTC_CACHE_MAX_MB"];
    process.env["SCRIPTC_CACHE_MAX_MB"] = "1";
    try {
      await pruneCacheOnce(root);
    } finally {
      if (prev === undefined) delete process.env["SCRIPTC_CACHE_MAX_MB"];
      else process.env["SCRIPTC_CACHE_MAX_MB"] = prev;
    }

    // The object set is what a concurrent link is holding open by path.
    expect(await count(objDir)).toBe(20);
    // ...and the sweep is not a no-op, or the line above proves nothing.
    expect(await count(join(root, "bin"))).toBeLessThan(32);
    // An in-progress compile is never walked at all.
    expect(await count(join(root, "staging", "build-live"))).toBe(1);
  });

  test("a sweep under the cap evicts nothing", async () => {
    const root = await fakeCache(8, 20);
    const prev = process.env["SCRIPTC_CACHE_MAX_MB"];
    process.env["SCRIPTC_CACHE_MAX_MB"] = "4096";
    try {
      await pruneCacheOnce(root);
    } finally {
      if (prev === undefined) delete process.env["SCRIPTC_CACHE_MAX_MB"];
      else process.env["SCRIPTC_CACHE_MAX_MB"] = prev;
    }
    expect(await count(join(root, "bin"))).toBe(8);
    expect(await count(join(root, "obj", "aaaaaaaaaaaaaaaaaaaaaaaa"))).toBe(20);
  });

  /* The 61-of-80 shape. A cap far below the tree forces the sweep to free
   * nearly everything: with obj/ evictable it emptied the key directory but
   * left the directory itself standing, which is what a reader of the cache
   * saw first and read as a code regression. With obj/ spared the sweep runs
   * out of candidates instead — a cache that is merely over its cap, rather
   * than one that deleted what a running link was about to open. */
  /* Moving staging out of the swept tree is what stops a sweep from deleting
   * an object out of a live compile — and it would leak a staging directory
   * every time a build is killed, which on this host is routine. */
  test("staging is reclaimed only once nothing has written to it for hours", async () => {
    const root = await tmp("scr-staging-");
    await mkdir(join(root, "bin"), { recursive: true });
    const live = join(root, "staging", "build-live");
    const dead = join(root, "staging", "build-dead");
    await mkdir(live, { recursive: true });
    await mkdir(dead, { recursive: true });
    await writeFile(join(live, "a.o"), Buffer.alloc(1024));
    await writeFile(join(dead, "a.o"), Buffer.alloc(1024));
    const old = new Date(Date.now() - 9 * 60 * 60 * 1000);
    await utimes(dead, old, old);

    const prev = process.env["SCRIPTC_CACHE_MAX_MB"];
    process.env["SCRIPTC_CACHE_MAX_MB"] = "4096";
    try {
      await pruneCacheOnce(root);
    } finally {
      if (prev === undefined) delete process.env["SCRIPTC_CACHE_MAX_MB"];
      else process.env["SCRIPTC_CACHE_MAX_MB"] = prev;
    }
    const left = await readdir(join(root, "staging"));
    expect(left).toEqual(["build-live"]); // the running compile is untouched
  });

  /* Sparing obj/ from the byte sweep must not become a disk leak: every
   * runtime or vendor edit mints a fresh key and never revisits the old one.
   * The reclamation that stops that has to tell a DEAD key from a merely old
   * one — which is the same distinction the original sweep got wrong. */
  describe("dead object keys are reclaimed, live ones are not", () => {
    /** `keys` describes one key directory each: [objects, ageHours]. */
    async function objCache(keys: [number, number][], bytes = 64 * 1024): Promise<string> {
      const root = await tmp("scr-objcap-");
      const blob = Buffer.alloc(bytes, 3);
      for (const [i, [objs, ageHours]] of keys.entries()) {
        const dir = join(root, "obj", String(i).repeat(24).slice(0, 24));
        await mkdir(dir, { recursive: true });
        const when = new Date(Date.now() - ageHours * 60 * 60 * 1000);
        for (let o = 0; o < objs; o++) {
          const p = join(dir, `o${o}.o`);
          await writeFile(p, blob);
          await utimes(p, when, when);
        }
      }
      return root;
    }
    const withCaps = async (root: string, objMB: string, fn: () => Promise<void>) => {
      const prevAll = process.env["SCRIPTC_CACHE_MAX_MB"];
      const prevObj = process.env["SCRIPTC_OBJ_CACHE_MAX_MB"];
      process.env["SCRIPTC_CACHE_MAX_MB"] = "4096"; // the byte sweep must not be what acts
      process.env["SCRIPTC_OBJ_CACHE_MAX_MB"] = objMB;
      try {
        await fn();
      } finally {
        if (prevAll === undefined) delete process.env["SCRIPTC_CACHE_MAX_MB"];
        else process.env["SCRIPTC_CACHE_MAX_MB"] = prevAll;
        if (prevObj === undefined) delete process.env["SCRIPTC_OBJ_CACHE_MAX_MB"];
        else process.env["SCRIPTC_OBJ_CACHE_MAX_MB"] = prevObj;
      }
      void root;
    };

    test("a key untouched for days goes when obj/ is over budget", async () => {
      const root = await objCache([
        [20, 72], // dead: nothing has wanted it in three days
        [20, 0.1], // live: a build touched it minutes ago
      ]);
      await withCaps(root, "0.5", () => pruneCacheOnce(root));
      const left = await readdir(join(root, "obj"));
      expect(left).toHaveLength(1);
      expect(await count(join(root, "obj", left[0] as string))).toBe(20); // whole, not half
    });

    test("a key used within the day is kept even over budget", async () => {
      // Both keys are recent: an over-budget obj/ is a tuning problem, and
      // deleting what a build used an hour ago is not the answer to it.
      const root = await objCache([
        [20, 2],
        [20, 3],
      ]);
      await withCaps(root, "0.5", () => pruneCacheOnce(root));
      expect(await readdir(join(root, "obj"))).toHaveLength(2);
    });

    test("under budget, nothing is reclaimed however old", async () => {
      const root = await objCache([
        [20, 500],
        [20, 500],
      ]);
      await withCaps(root, "4096", () => pruneCacheOnce(root));
      expect(await readdir(join(root, "obj"))).toHaveLength(2);
    });
  });

  test("a sweep that cannot reach its target still empties no key directory", async () => {
    const root = await fakeCache(2, 20);
    const prev = process.env["SCRIPTC_CACHE_MAX_MB"];
    process.env["SCRIPTC_CACHE_MAX_MB"] = "0.1";
    try {
      await pruneCacheOnce(root);
    } finally {
      if (prev === undefined) delete process.env["SCRIPTC_CACHE_MAX_MB"];
      else process.env["SCRIPTC_CACHE_MAX_MB"] = prev;
    }
    const keys = await readdir(join(root, "obj"));
    expect(keys.length).toBeGreaterThan(0); // the sweep must not have removed the keyspace
    for (const key of keys) {
      const s = await stat(join(root, "obj", key));
      if (s.isDirectory()) expect(await count(join(root, "obj", key))).toBe(20);
    }
  });
});

/* 3. SILENT, and the one this file was missing: an object built by a
 * DIFFERENT TOOLCHAIN under a live key.
 *
 * vendor/.cache keys the driver as at most one bit -- argv is exactly
 * ["clang"] or it is not -- and three of the six cached units (libqjs.a,
 * libmbedtls.a, curl-stub) carry no driver component at all. The two zig
 * installs on this host both spell "-zigcc" and share a directory, so one
 * builds an object and the other links it. Observed in the wild as
 * libregexp.o and libunicode.o eleven hours apart under an identical key.
 *
 * Neither existing guard reaches it: asserting a compiler version protects
 * what a run COMPILES, not what a cache already HOLDS, and vendor/.cache is
 * gitignored so git status, the dirty-worktree guard and treehash are all
 * blind to it.
 *
 * Widening the key is the fix and it invalidates every cache everywhere at
 * once, so the DETECTOR lands first: a .toolchain stamp written beside the
 * objects and compared on a hit. These tests pin its three outcomes, and the
 * third is the one that matters -- a cache from before the stamp existed
 * must read UNKNOWN and never MATCH, because treating absence as agreement
 * would certify every stale object already on the box.
 */
describe("vendor cache toolchain stamp", () => {
  const driverA: CcDriver = { argv: ["node", "--version"], target: null, targetArgs: [], linkArgs: [] };
  const driverB: CcDriver = { argv: ["node", "-e", ""], target: null, targetArgs: [], linkArgs: [] };

  test("a stamp identifies the toolchain, and two different drivers do not share one", async () => {
    const a = await toolchainId(driverA);
    const b = await toolchainId(driverB);
    expect(a.length).toBeGreaterThan(12);
    expect(a).not.toBe(b);
    // Memoised: the same driver must return the identical string, not merely
    // an equal one recomputed by spawning the compiler again per link.
    expect(await toolchainId(driverA)).toBe(a);
  });

  test("stamp then check: the matching toolchain is silent", async () => {
    const dir = await tmp("scr-tc-match-");
    await stampToolchain(dir, driverA);
    const said: string[] = [];
    const restore = capture(said);
    try {
      await checkToolchain(dir, driverA, "lre");
    } finally {
      restore();
    }
    expect(said).toEqual([]);
  });

  test("a DIFFERENT toolchain under the same key is reported", async () => {
    const dir = await tmp("scr-tc-mismatch-");
    await stampToolchain(dir, driverA);
    const said: string[] = [];
    const restore = capture(said);
    try {
      await checkToolchain(dir, driverB, "lre");
    } finally {
      restore();
    }
    expect(said.join("")).toContain("VENDOR-CACHE-MISMATCH");
    expect(said.join("")).toContain("unit=lre");
  });

  test("ABSENCE reads UNKNOWN, never MATCH", async () => {
    // A cache directory populated before the stamp existed. If this ever
    // passes silently, the detector is certifying every stale object on the
    // machine -- which is strictly worse than not having it.
    const dir = await tmp("scr-tc-nostamp-");
    await writeFile(join(dir, "libregexp.o"), "not really an object");
    const said: string[] = [];
    const restore = capture(said);
    try {
      await checkToolchain(dir, driverA, "qjs");
    } finally {
      restore();
    }
    expect(said.join("")).toContain("VENDOR-CACHE-UNKNOWN");
    expect(said.join("")).not.toContain("VENDOR-CACHE-MISMATCH");
  });

  test("strict mode refuses a mismatch but still tolerates an unstamped cache", async () => {
    const dir = await tmp("scr-tc-strict-");
    await stampToolchain(dir, driverA);
    const prev = process.env["SCRIPTC_VENDOR_CACHE_STRICT"];
    process.env["SCRIPTC_VENDOR_CACHE_STRICT"] = "1";
    const said: string[] = [];
    const restore = capture(said);
    try {
      await expect(checkToolchain(dir, driverB, "lre")).rejects.toThrow(/different toolchain/);
      // An unstamped directory is not evidence of a wrong toolchain, so even
      // strict mode must not fail on it -- otherwise turning strict on would
      // break every build until every cache is repopulated.
      const bare = await tmp("scr-tc-strict-bare-");
      await expect(checkToolchain(bare, driverA, "lre")).resolves.toBeUndefined();
    } finally {
      restore();
      if (prev === undefined) delete process.env["SCRIPTC_VENDOR_CACHE_STRICT"];
      else process.env["SCRIPTC_VENDOR_CACHE_STRICT"] = prev;
    }
  });
});
