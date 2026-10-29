/* `export =` from an attested CommonJS package, the saslprep shape: a
 * function with expando members, then `export = fn`.
 *
 * The package is a TypeScript source tree (attested-src/exportequals) under a
 * package.json that is not "type": "module", so under --provenance-sources it
 * is a CommonJS module and `export = saslprep` is its module.exports. The
 * consumer (cases/exportequals/main.ts) reads it three ways: the named import
 * `{ saslprep }` (tsc's CJS emit is `(0, m.saslprep)(...)`), the default
 * import, and a renamed named import; then the expando calls, typeof, and
 * identity between the members and the function.
 *
 * The expected text is Node's, recorded from tsc's CommonJS emit of the same
 * source (lab oracle: transpile the package and the consumer with module
 * commonjs, run under node 24). A consumer reaching `export =` from a file
 * that is NOT provenance-served is still refused (diagnostics.test.ts pins
 * default-export.ts), and this test pins the provenance half. */
import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "vitest";
import {
  analyze,
  compile,
  resolveProvenanceSources,
  setProvenanceSources,
} from "@scriptc/compiler";

const execFileAsync = promisify(execFile);
const repoRoot = join(import.meta.dirname, "../..");
const fixtureDir = join(repoRoot, "tests/fixtures/provenance");
const entry = join(fixtureDir, "cases/exportequals/main.ts");
const manifest = join(fixtureDir, "manifest-exportequals.json");
const flavor = process.env["SCRIPTC_SAN"] === "1" ? "san" : "plain";
const outDir = join(repoRoot, "node_modules/.cache/scriptc-tests/provenance-export-equals", flavor);

const EXPECTED =
  "ABC x!\n" +
  "M N tagged tagged\n" +
  "Q R tagged function function\n" +
  "true true true true\n";

async function buildAndRun(name: string, backend: "c" | "llvm"): Promise<string> {
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, process.platform === "win32" ? `${name}.exe` : name);
  const result = await compile(entry, { outPath, outDir, dynamic: false, backend });
  if (!result.ok) {
    throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
  }
  // The lane is part of the claim: an LLVM build that quietly fell back to C
  // would pass the output comparison and prove nothing about LLVM.
  expect(result.backend).toBe(backend);
  const { stdout } = await execFileAsync(outPath, [], { encoding: "utf8" });
  return stdout;
}

const PRIOR = { manifest: process.env["SCRIPTC_PROVENANCE_MANIFEST"] };
afterEach(() => {
  setProvenanceSources(null);
  if (PRIOR.manifest === undefined) delete process.env["SCRIPTC_PROVENANCE_MANIFEST"];
  else process.env["SCRIPTC_PROVENANCE_MANIFEST"] = PRIOR.manifest;
});

describe("provenance: export = of an attested CommonJS package", () => {
  test("the package maps and the consumer compiles with no preflight error", async () => {
    process.env["SCRIPTC_PROVENANCE_MANIFEST"] = manifest;
    const sources = await resolveProvenanceSources(entry);
    expect(sources.packages.map((p) => p.name)).toEqual(["exportequals"]);
    setProvenanceSources(sources);
    const { coverage } = analyze(entry);
    expect(coverage.preflightFailed).toBe(false);
    expect(coverage.diagnostics).toHaveLength(0);
  });

  test("the C binary matches Node's CommonJS reading", async () => {
    process.env["SCRIPTC_PROVENANCE_MANIFEST"] = manifest;
    setProvenanceSources(await resolveProvenanceSources(entry));
    expect(await buildAndRun("exportequals-c", "c")).toBe(EXPECTED);
  }, 300_000);

  test("the LLVM binary matches Node's CommonJS reading", async () => {
    process.env["SCRIPTC_PROVENANCE_MANIFEST"] = manifest;
    setProvenanceSources(await resolveProvenanceSources(entry));
    expect(await buildAndRun("exportequals-llvm", "llvm")).toBe(EXPECTED);
  }, 300_000);
});
