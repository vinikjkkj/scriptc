/* A declaration-file `const` whose compiled JS twin is the value (corpus 24050).
 *
 * pg-types ships `index.d.ts` beside `index.js`. The declaration spells `arrayParser` a FUNCTION with `any`
 * positions and an `any[]` return, while `lib/arrayParser.js` exports an OBJECT with a `create` member, so
 * under Node `typeof arrayParser` is "object", `arrayParser.create(...)` works and `arrayParser(...)` throws.
 * The declaration's own slot is a second global nothing assigns and its type has no representation, so it
 * refused the whole build (pg: index.d.ts:137:14 SC2011) and, where its type mapped, a member read through the
 * module binding called a NULL closure. A declaration-file const whose twin is compiled now owns no slot; the
 * twin's storage, typed by what the JS assigns, is what every read reaches.
 *
 * The refusals that STAY are pinned: calling or storing the value as the declaration's function type is a
 * compile-time SC2011 at the use (never a deferred throw), and a declared name the JS never exports refuses
 * where it is read (Node fails at link time there).
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
const manifest = join(fixtureDir, "manifest-pgtypes.json");
const flavor = process.env["SCRIPTC_SAN"] === "1" ? "san" : "plain";
const outDir = join(repoRoot, "node_modules/.cache/scriptc-tests/provenance-twin-dts-const", flavor);

/* Recorded from Node v24.15.0 (`node --experimental-strip-types cases/pgtypes/<case>.ts`). */
const MAIN_EXPECTED = "42\nstring\n[ 1, 2, 3 ]\n[ 'a!', 'b!' ]\nobject\n";
const CREATE_EXPECTED = "object [ 'create' ] function\n[ 2, 4, 6 ]\n";

const PRIOR = process.env["SCRIPTC_PROVENANCE_MANIFEST"];
afterEach(() => {
  setProvenanceSources(null);
  if (PRIOR === undefined) delete process.env["SCRIPTC_PROVENANCE_MANIFEST"];
  else process.env["SCRIPTC_PROVENANCE_MANIFEST"] = PRIOR;
});

async function build(file: string, backend: "c" | "llvm") {
  const entry = join(fixtureDir, "cases/pgtypes", file);
  process.env["SCRIPTC_PROVENANCE_MANIFEST"] = manifest;
  setProvenanceSources(await resolveProvenanceSources(entry));
  mkdirSync(outDir, { recursive: true });
  const name = file.replace(/\.ts$/, "");
  const outPath = join(outDir, process.platform === "win32" ? `${name}-${backend}.exe` : `${name}-${backend}`);
  const result = await compile(entry, { outPath, outDir, dynamic: false, backend, npmStatic: ["pgtypes"] });
  return { result, outPath };
}

describe("provenance: a declaration-file const owned by its compiled twin", () => {
  for (const backend of ["c", "llvm"] as const) {
    test(`24050: reads reach the twin's value, declared lies and unused declarations cost nothing (${backend})`, async () => {
      const { result, outPath } = await build("main.ts", backend);
      if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
      const { stdout } = await execFileAsync(outPath, [], { encoding: "utf8" });
      expect(stdout).toBe(MAIN_EXPECTED);
    }, 600_000);

    test(`24050: the object the declaration calls a function keeps its members (${backend})`, async () => {
      const { result, outPath } = await build("create.ts", backend);
      if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
      const { stdout } = await execFileAsync(outPath, [], { encoding: "utf8" });
      expect(stdout).toBe(CREATE_EXPECTED);
    }, 600_000);
  }

  for (const file of ["call.ts", "value.ts"]) {
    test(`24050: ${file} uses the value as the declared function type: a compile-time SC2011, not a deferred throw`, async () => {
      const { result } = await build(file, "c");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.diagnostics.map((d) => d.code)).toContain("SC2011");
    }, 600_000);
  }

  test("24050: reading a declared name the JS never exports is a named refusal", async () => {
    const { result } = await build("undef.ts", "c");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics.map((d) => d.code)).toContain("SC1090");
  }, 600_000);
});
