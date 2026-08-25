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
import { pruneCacheOnce, runtimeFingerprint, runtimeSrcDir } from "../src/backend/cc.js";

const temps: string[] = [];
async function tmp(prefix: string): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), prefix));
  temps.push(d);
  return d;
}
afterAll(async () => {
  for (const d of temps) await rm(d, { recursive: true, force: true });
});

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
