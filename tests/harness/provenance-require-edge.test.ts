/* --provenance-sources: a CommonJS package that `require`s a package whose
 * hand-written .d.ts spells generic overloads beside its implementation.
 *
 * Two defects stacked here (measured on postgres-array under pg-types):
 *   1. The require binding was not recognised as a module namespace unless the
 *      package was --npm-static, so `list.parse(v, fn)` resolved through the
 *      DECLARATION and was refused as a generic method with no defining object
 *      literal (SC1090).
 *   2. Once it compiled, the program crashed: the twin's module init was never
 *      called (the importer named only the declaration's empty init), so the
 *      exported function's global was null. A silent wrong answer, not a refusal.
 * Both backends, byte-compared with Node.
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
const entry = join(fixtureDir, "cases/reqedge/main.ts");
const manifest = join(fixtureDir, "manifest-reqedge.json");
const flavor = process.env["SCRIPTC_SAN"] === "1" ? "san" : "plain";
const outDir = join(repoRoot, "node_modules/.cache/scriptc-tests/provenance-reqedge", flavor);
const EXPECTED = '[true,false,true]\n["x","y","z"]\n';
const PRIOR = process.env["SCRIPTC_PROVENANCE_MANIFEST"];

afterEach(() => {
  setProvenanceSources(null);
  if (PRIOR === undefined) delete process.env["SCRIPTC_PROVENANCE_MANIFEST"];
  else process.env["SCRIPTC_PROVENANCE_MANIFEST"] = PRIOR;
});

describe("provenance: a require() of a package whose declaration spells generic overloads", () => {
  for (const backend of ["c", "llvm"] as const) {
    test(`${backend}: compiles static and the binary matches Node`, async () => {
      process.env["SCRIPTC_PROVENANCE_MANIFEST"] = manifest;
      setProvenanceSources(await resolveProvenanceSources(entry));
      mkdirSync(outDir, { recursive: true });
      const outPath = join(outDir, process.platform === "win32" ? `reqedge-${backend}.exe` : `reqedge-${backend}`);
      const result = await compile(entry, { outPath, outDir, dynamic: false, backend });
      if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
      const { stdout } = await execFileAsync(outPath, [], { encoding: "utf8" });
      expect(stdout).toBe(EXPECTED);
    }, 120_000);
  }
});
