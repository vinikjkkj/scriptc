/* THE EARLY CACHE PUBLISHES ONLY THE BYTES THIS BUILD WROTE.
 *
 * Two builds that share an output directory write the same <stem>.c; a build copies that file into the cache some time after writing it, and the
 * other build can truncate or rewrite it in between. The digest used to be taken from the copy, so a half-written unit with no main became a valid
 * entry and every later build "hit" it and failed to link. writeEmitted() now records the digest of each unit this build writes and the publish
 * refuses a file that no longer matches. The test plants the truncation (the control: it must make the old behaviour publish 1 entry) and checks
 * an untouched file still publishes. */
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { FrontendInputTracker } from "../src/frontend/input-tracker.js";
import { publishEarlyBuildCache, writeEmitted } from "../src/frontend/early-cache.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function publish(truncate: boolean): Promise<number> {
  const base = mkdtempSync(join(tmpdir(), "early-cache-publish-"));
  dirs.push(base);
  const root = join(base, "cache");
  const out = join(base, "o");
  mkdirSync(out, { recursive: true });
  const cPath = join(out, "x.c");
  await writeEmitted(cPath, "int main(void){return 0;}\n");
  if (truncate) writeFileSync(cPath, "int x"); // another build truncating the same path after this one wrote it
  const options = { implementation: "i", nodeVersion: "v", compileOptions: "c", provenance: "p", target: "t", cc: "cc", environment: "e", entryPath: join(out, "x.ts"), outPath: join(out, "x.bin"), outDir: out, cwd: out, env: {}, argv: [], compilerFingerprint: "t" };
  await publishEarlyBuildCache(root, options as never, {
    cPath,
    cPathParts: [],
    cPathHeader: undefined,
    irPath: undefined,
    meta: { backend: "c", llvmRefusal: null, features: {}, advisories: [], advisorySourceTexts: {}, npmStatic: [] },
    frontend: new FrontendInputTracker().snapshot(),
  } as never);
  try {
    return readdirSync(join(root, "early-build")).length;
  } catch {
    return 0;
  }
}

test("an untouched unit publishes (positive control)", async () => {
  expect(await publish(false)).toBe(1);
});

test("a unit truncated after this build wrote it is not published", async () => {
  expect(await publish(true)).toBe(0);
});
