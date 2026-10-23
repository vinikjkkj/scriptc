/* A declaration-file type whose implementation twin is COMPILED is the
 * class the twin builds, not a second record representation of it.
 *
 * `mixinpool` is mysql2's promise surface reduced to its three mechanisms:
 *
 *   1. the declaration names the type `Pool` (a class over a mixin whose
 *      generic, overloaded `execute` lives in a type literal) and the code
 *      builds `PromisePool`, which the declaration never mentions: the two
 *      meet only through `createPool` (declared `: Pool`, built `new
 *      PromisePool`), so the witness is read off the module's exports;
 *   2. `execute(sql, params)` has untyped parameters, so it owns no vtable
 *      slot and a boxed instance (`this.core`, an untyped constructor
 *      parameter holding a `Core`) can only run `this.core.run(...)` through
 *      the default instance listed on the class (IrClassDef.dynMethods);
 *   3. the twin's module init has to RUN for a named import of a function
 *      the twin exports as storage (`exports.createPool = createPool`).
 *
 * Any of the three missing prints a refusal, a crash at start, or
 * "this.core.run is not a function" where Node prints the four lines below.
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
const entry = join(fixtureDir, "cases/mixinpool/main.ts");
const manifest = join(fixtureDir, "manifest-mixinpool.json");
const flavor = process.env["SCRIPTC_SAN"] === "1" ? "san" : "plain";
const outDir = join(repoRoot, "node_modules/.cache/scriptc-tests/provenance-twin-witness", flavor);

const EXPECTED = "SELECT:2/1\n" + "SELECT 2:2/1\n" + "2\n" + "boom from a\n";

const PRIOR = process.env["SCRIPTC_PROVENANCE_MANIFEST"];
afterEach(() => {
  setProvenanceSources(null);
  if (PRIOR === undefined) delete process.env["SCRIPTC_PROVENANCE_MANIFEST"];
  else process.env["SCRIPTC_PROVENANCE_MANIFEST"] = PRIOR;
});

describe("provenance: a declaration type is the class its compiled twin builds", () => {
  for (const backend of ["c", "llvm"] as const) {
    test(`mixinpool compiles static and matches Node (${backend})`, async () => {
      process.env["SCRIPTC_PROVENANCE_MANIFEST"] = manifest;
      setProvenanceSources(await resolveProvenanceSources(entry));
      mkdirSync(outDir, { recursive: true });
      const outPath = join(outDir, process.platform === "win32" ? `mixinpool-${backend}.exe` : `mixinpool-${backend}`);
      const result = await compile(entry, { outPath, outDir, dynamic: false, backend, npmStatic: ["mixinpool"] });
      if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
      const { stdout } = await execFileAsync(outPath, [], { encoding: "utf8" });
      expect(stdout).toBe(EXPECTED);
    }, 600_000);
  }
});
