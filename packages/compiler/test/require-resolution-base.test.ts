/* WHERE NODE IS ASKED FROM - the base a require resolution runs from, and
 * the two rules of package self-reference.
 *
 * A compiled binary reads no node_modules at run time, so a require whose
 * specifier is a build-time constant is decided at BUILD time from what the
 * compiler could see: the per-specifier proof that nothing resolves it
 * (probeNodeRequireRefusal), which walks node_modules directories upward
 * from the file. It was walking upward from where the COMPILER
 * holds the file, which under `--provenance-sources` is a bare git
 * checkout in a content-addressed cache under the user's home directory -
 * a tree the running program has never heard of.
 *
 * The walk does not answer "nothing" from there. It climbs OUT of the
 * cache and answers with whatever node_modules sits above the user's HOME
 * directory. On the build this was found on that was 205 package roots
 * belonging to somebody else's project, while two packages the program
 * really can require were provably absent - and "provably absent" is
 * exactly what compiles to Node's catchable MODULE_NOT_FOUND, which the
 * `try { require(x) } catch` idiom the whole path exists for swallows.
 * A module Node hands over, answered as null, at exit 0.
 *
 * Every case here is THREE-SIDED: Node's own resolver, run from the
 * INSTALLED counterpart, is the oracle, and both compiler answers are
 * compared against it. A one-sided version passes by accident in both
 * directions - a set containing everything never mints a wrong
 * MODULE_NOT_FOUND, and a set containing nothing never fences.
 *
 * The self-reference block is the second half of the same question. Node
 * resolves a package's own name from inside it under two rules the walk
 * ignored: the scope must have an "exports" field, and only the NEAREST
 * enclosing package.json is the file's scope. Over-adding is the LOUD
 * direction (a fence where Node throws), which is why it survived; it is
 * still a refusal the program need not carry, and cell by cell it is the
 * difference between a compiled MODULE_NOT_FOUND and an [SCxxxx].
 *
 * probeNodeRequireRefusal's own self-scope test stays deliberately
 * conservative (any ancestor whose "name" matches answers "not proven
 * missing"): that arm can only ever REFUSE to mint a MODULE_NOT_FOUND, so
 * imprecision there costs nothing a program can observe. The asymmetry is
 * intentional and is asserted below so it cannot drift silently. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { probeNodeRequireRefusal, requireResolutionBase } from "../src/frontend/npm.js";
import { setProvenanceSources } from "../src/frontend/provenance-registry.js";
import { nativePath, tsgoPath } from "../src/frontend/shared.js";

/** Node's own answer, from Node's own resolver, at the path the RUNNING
 * program keeps the file at. Either the resolved filename or the error
 * code - never a guess. */
function nodeResolve(fromFile: string, spec: string): string {
  try {
    return createRequire(pathToFileURL(fromFile)).resolve(spec);
  } catch (e) {
    return (e as NodeJS.ErrnoException).code ?? String(e);
  }
}

function nodeRequireMessage(fromFile: string, spec: string): string | null {
  try {
    createRequire(pathToFileURL(fromFile)).resolve(spec);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

let root = "";
/* The provenance source checkout: no node_modules of its own, sitting
 * under a "home" that HAS one. */
let cacheFile = "";
/* The same file where the running program keeps it. */
let installedFile = "";

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "scriptc-resbase-"));
  // The leak: a node_modules above the source cache, belonging to nobody.
  write(join(root, "home", "node_modules", "resbase-decoy", "package.json"), '{"name":"resbase-decoy","version":"1.0.0","main":"index.js"}');
  write(join(root, "home", "node_modules", "resbase-decoy", "index.js"), "module.exports = 1;\n");
  // The content-addressed checkout the compiler reads the source from.
  write(join(root, "home", "cache", "deadbeef", "package.json"), '{"name":"resbase-pkg","version":"1.0.0"}');
  cacheFile = join(root, "home", "cache", "deadbeef", "src", "index.js");
  write(cacheFile, "module.exports = 2;\n");
  // The driver's installed tree: where the program keeps the same file.
  write(join(root, "proj", "package.json"), '{"name":"resbase-app","version":"1.0.0"}');
  write(join(root, "proj", "node_modules", "resbase-pkg", "package.json"), '{"name":"resbase-pkg","version":"1.0.0","main":"src/index.js"}');
  installedFile = join(root, "proj", "node_modules", "resbase-pkg", "src", "index.js");
  write(installedFile, "module.exports = 2;\n");
  write(join(root, "proj", "node_modules", "resbase-victim", "package.json"), '{"name":"resbase-victim","version":"1.0.0","main":"index.js"}');
  write(join(root, "proj", "node_modules", "resbase-victim", "index.js"), "module.exports = 3;\n");
});

afterAll(() => {
  setProvenanceSources(null);
  rmSync(root, { recursive: true, force: true });
});

function registerProvenance(): void {
  setProvenanceSources({
    packages: [{
      name: "resbase-pkg",
      version: "1.0.0",
      repo: "https://example.invalid/resbase-pkg",
      commit: "deadbeef",
      dir: tsgoPath(join(root, "home", "cache", "deadbeef")),
      installedDir: tsgoPath(join(root, "proj", "node_modules", "resbase-pkg")),
      entries: { "resbase-pkg": tsgoPath(cacheFile) },
    }],
    notes: [],
  });
}

describe("a provenance-mapped source resolves from the INSTALLED tree", () => {
  test("Node itself: the installed counterpart sees the program's packages and not the cache's neighbours", () => {
    // The oracle, stated first so the compiler assertions below have
    // something to be right or wrong ABOUT.
    expect(nodeResolve(installedFile, "resbase-victim")).toContain("resbase-victim");
    expect(nodeResolve(installedFile, "resbase-decoy")).toBe("MODULE_NOT_FOUND");
    // ... and the cache path, which is where the walk used to start,
    // answers the exact opposite. This is the bug, in Node's own words.
    expect(nodeResolve(cacheFile, "resbase-decoy")).toContain("resbase-decoy");
    expect(nodeResolve(cacheFile, "resbase-victim")).toBe("MODULE_NOT_FOUND");
  });


  test("the per-specifier proof follows it too - and this is the silent one", () => {
    registerProvenance();
    // Node hands the module over, so nothing may be PROVEN missing.
    expect(probeNodeRequireRefusal(cacheFile, "resbase-victim")).toBeNull();
    // Node throws, and the compiler is allowed to say so.
    expect(probeNodeRequireRefusal(cacheFile, "resbase-decoy")).not.toBeNull();
  });

  test("MODULE_NOT_FOUND's require stack names the path Node would name", () => {
    registerProvenance();
    const got = probeNodeRequireRefusal(cacheFile, "resbase-nothing-here");
    expect(got).not.toBeNull();
    const want = nodeRequireMessage(installedFile, "resbase-nothing-here");
    expect(want).not.toBeNull();
    // Byte-exact against Node's own message, require stack included.
    expect(got!.message).toBe(want);
    expect(got!.message).toContain(nativePath(installedFile));
    expect(got!.message).not.toContain("deadbeef");
  });

  test("the base itself: mapped for a registered file, identity for every other", () => {
    registerProvenance();
    expect(tsgoPath(requireResolutionBase(cacheFile))).toBe(tsgoPath(installedFile));
    const outsider = join(root, "home", "elsewhere", "x.js");
    expect(requireResolutionBase(outsider)).toBe(outsider);
  });

});

describe("package self-reference, against Node's two rules", () => {
  let withExports = "";
  let noExports = "";
  let innerFile = "";
  let outerFile = "";

  beforeAll(() => {
    write(join(root, "selfref", "withexp", "package.json"), '{"name":"selfref-withexp","version":"1.0.0","exports":{".":"./main.js"}}');
    write(join(root, "selfref", "withexp", "main.js"), "module.exports = 1;\n");
    withExports = join(root, "selfref", "withexp", "sub", "t.js");
    write(withExports, "\n");

    write(join(root, "selfref", "noexp", "package.json"), '{"name":"selfref-noexp","version":"1.0.0","main":"main.js"}');
    write(join(root, "selfref", "noexp", "main.js"), "module.exports = 1;\n");
    noExports = join(root, "selfref", "noexp", "sub", "t.js");
    write(noExports, "\n");

    write(join(root, "selfref", "nested", "package.json"), '{"name":"selfref-outer","version":"1.0.0","exports":{".":"./m.js"}}');
    write(join(root, "selfref", "nested", "m.js"), "module.exports = 1;\n");
    outerFile = join(root, "selfref", "nested", "sub", "t.js");
    write(outerFile, "\n");
    write(join(root, "selfref", "nested", "inner", "package.json"), '{"name":"selfref-inner","version":"1.0.0"}');
    innerFile = join(root, "selfref", "nested", "inner", "sub", "t.js");
    write(innerFile, "\n");
  });




  test("the PROBE stays conservative about self-scopes, on purpose", () => {
    setProvenanceSources(null);
    // Node throws for both of these. The probe answering null means "not
    // proven missing", which costs a fence and never a wrong value - the
    // one direction this arm is allowed to be imprecise in.
    expect(nodeResolve(noExports, "selfref-noexp")).toBe("MODULE_NOT_FOUND");
    expect(probeNodeRequireRefusal(noExports, "selfref-noexp")).toBeNull();
    expect(nodeResolve(innerFile, "selfref-outer")).toBe("MODULE_NOT_FOUND");
    expect(probeNodeRequireRefusal(innerFile, "selfref-outer")).toBeNull();
  });

});

