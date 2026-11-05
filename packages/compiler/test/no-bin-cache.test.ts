/* SCRIPTC_NO_BIN_CACHE=1: every program is compiled live, the runtime objects stay cached (cc.ts cacheRootDir /
 * objectCacheRootDir). The Windows test lanes run under it so a verdict is never a cached binary, without paying the
 * runtime's ~60 sources again for every program. */
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { cacheRootDir, objectCacheRootDir } from "../src/backend/cc.js";
import { compile } from "../src/index.js";

const SAVED = { ...process.env };
afterEach(() => {
  for (const k of ["SCRIPTC_NO_CACHE", "SCRIPTC_NO_BIN_CACHE", "SCRIPTC_CACHE_DIR"]) {
    if (SAVED[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED[k];
  }
});

describe("the narrower cache switch", () => {
  test("the binary cache is off and the object cache stays on", () => {
    process.env["SCRIPTC_CACHE_DIR"] = "/x/cache";
    delete process.env["SCRIPTC_NO_CACHE"];
    process.env["SCRIPTC_NO_BIN_CACHE"] = "1";
    expect(cacheRootDir()).toBeNull();
    expect(objectCacheRootDir()).toBe("/x/cache");
    process.env["SCRIPTC_NO_CACHE"] = "1";
    expect(objectCacheRootDir()).toBeNull();
    delete process.env["SCRIPTC_NO_BIN_CACHE"];
    expect(cacheRootDir()).toBeNull();
    delete process.env["SCRIPTC_NO_CACHE"];
    expect(cacheRootDir()).toBe("/x/cache");
    expect(objectCacheRootDir()).toBe("/x/cache");
  });

  test("a build publishes objects and no binary, and the executable equals the uncached build's", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scr-nobin-"));
    try {
      const src = join(dir, "p.ts");
      await writeFile(src, 'console.log("live", 1 + 2);\n');
      const build = async (name: string, env: Record<string, string>): Promise<Buffer> => {
        for (const k of ["SCRIPTC_NO_CACHE", "SCRIPTC_NO_BIN_CACHE"]) delete process.env[k];
        Object.assign(process.env, env, { SCRIPTC_CACHE_DIR: join(dir, "cache") });
        const out = join(dir, name);
        const r = await compile(src, { outPath: out, outDir: dir, backend: "c" });
        expect(r.ok).toBe(true);
        return readFile(out);
      };
      const none = await build("none.bin", { SCRIPTC_NO_CACHE: "1" });
      const obj = await build("obj.bin", { SCRIPTC_NO_BIN_CACHE: "1" });
      expect(obj.equals(none)).toBe(true);
      expect(existsSync(join(dir, "cache", "obj"))).toBe(true);
      expect(existsSync(join(dir, "cache", "bin"))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 300_000);
});
