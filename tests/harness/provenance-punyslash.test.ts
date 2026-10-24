/* --provenance-sources: `require("punycode/")` (a trailing slash) names the npm
 * package punycode, not the deprecated builtin, the same way Node resolves it.
 *
 * The shape is tr46 5.x (mongodb's URL stack): a CommonJS package whose
 * `require("punycode/")` used to be refused as a builtin (SC1010 "the 'punycode/'
 * module is not supported yet"), because the provenance prescan took the package
 * name of `punycode/` to be the builtin `punycode` and skipped it. Positive control:
 * the base refuses this fixture with that SC1010 at tr46lite/index.js:5.
 * The punycode fixture is a stand-in body (identity = name and version); the
 * pinned behaviour is the specifier resolution. Both backends, byte-compared with Node.
 */
import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "vitest";
import { compile, resolveProvenanceSources, setProvenanceSources } from "@scriptc/compiler";

const execFileAsync = promisify(execFile);
const repoRoot = join(import.meta.dirname, "../..");
const fixtureDir = join(repoRoot, "tests/fixtures/provenance");
const entry = join(fixtureDir, "cases/punyslash/main.ts");
const manifest = join(fixtureDir, "manifest-punyslash.json");
const flavor = process.env["SCRIPTC_SAN"] === "1" ? "san" : "plain";
const outDir = join(repoRoot, "node_modules/.cache/scriptc-tests/provenance-punyslash", flavor);
const EXPECTED = "man~ana.com\nmaana~pta\n2.3.1\n";
const PRIOR = process.env["SCRIPTC_PROVENANCE_MANIFEST"];

afterEach(() => {
  setProvenanceSources(null);
  if (PRIOR === undefined) delete process.env["SCRIPTC_PROVENANCE_MANIFEST"];
  else process.env["SCRIPTC_PROVENANCE_MANIFEST"] = PRIOR;
});

describe("provenance: require('punycode/') with a trailing slash is the npm package", () => {
  for (const backend of ["c", "llvm"] as const) {
    test(`${backend}: compiles static and the binary matches Node`, async () => {
      process.env["SCRIPTC_PROVENANCE_MANIFEST"] = manifest;
      setProvenanceSources(await resolveProvenanceSources(entry));
      mkdirSync(outDir, { recursive: true });
      const outPath = join(outDir, process.platform === "win32" ? `punyslash-${backend}.exe` : `punyslash-${backend}`);
      const result = await compile(entry, { outPath, outDir, dynamic: false, backend });
      if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
      const { stdout } = await execFileAsync(outPath, [], { encoding: "utf8" });
      expect(stdout).toBe(EXPECTED);
    }, 120_000);
  }
});
