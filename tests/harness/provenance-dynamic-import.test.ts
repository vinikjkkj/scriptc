/* --provenance-sources: a mapped package reached ONLY through `await import("pkg")`.
 * The preflight module order walks static edges (and, for --npm-static packages, dynamic ones);
 * a provenance-mapped specifier named only by import() never entered it, so its declaration twin
 * (index.d.ts -> index.js) was never ordered and every value read refused "ships only a
 * declaration file". Found through zapo's `await import('@zapo-js/store-mysql')`, whose
 * `mysql.createPool` (mysql2/promise) refused SC1090 while the static-import form built clean.
 * The static binary must match the recorded Node output on BOTH backends. */
import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "vitest";
import { analyze, compile, resolveProvenanceSources, setProvenanceSources } from "@scriptc/compiler";

const execFileAsync = promisify(execFile);
const repoRoot = join(import.meta.dirname, "../..");
const fixtureDir = join(repoRoot, "tests/fixtures/provenance");
const entry = join(fixtureDir, "cases/authoredjs-dynimport/main.ts");
const cjsEntry = join(fixtureDir, "cases/authoredjs-dynimport-cjs/main.ts");
const cjsManifest = join(fixtureDir, "manifest-authoredjs.json");
const pgEntry = join(fixtureDir, "cases/pgshape/main.ts");
const pgManifest = join(fixtureDir, "manifest-pgshape.json");
const manifest = join(fixtureDir, "manifest-dynimport.json");
const flavor = process.env["SCRIPTC_SAN"] === "1" ? "san" : "plain";
const outDir = join(repoRoot, "node_modules/.cache/scriptc-tests/provenance-dynimport", flavor);
const EXPECTED =
  "protocol=5\n" + "wire.regular=0\n" + "wire.private=2\n" + "fn.count=3\n" + "CHAT_OPEN=3\n" + "LT128=3\n";
const PRIOR = process.env["SCRIPTC_PROVENANCE_MANIFEST"];

afterEach(() => {
  setProvenanceSources(null);
  if (PRIOR === undefined) delete process.env["SCRIPTC_PROVENANCE_MANIFEST"];
  else process.env["SCRIPTC_PROVENANCE_MANIFEST"] = PRIOR;
});

describe("provenance: a mapped package reached only through import()", () => {
  test("preflight and lowering report nothing", async () => {
    process.env["SCRIPTC_PROVENANCE_MANIFEST"] = manifest;
    setProvenanceSources(await resolveProvenanceSources(entry));
    const { coverage } = analyze(entry);
    expect(coverage.preflightFailed).toBe(false);
    expect(coverage.diagnostics).toHaveLength(0);
  });

  for (const backend of ["c", "llvm"] as const) {
    test(`the static binary matches Node on --backend ${backend}`, async () => {
      process.env["SCRIPTC_PROVENANCE_MANIFEST"] = manifest;
      setProvenanceSources(await resolveProvenanceSources(entry));
      mkdirSync(outDir, { recursive: true });
      const outPath = join(outDir, process.platform === "win32" ? `dyn-${backend}.exe` : `dyn-${backend}`);
      const result = await compile(entry, { outPath, outDir, dynamic: false, backend });
      if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
      const { stdout } = await execFileAsync(outPath, [], { encoding: "utf8" });
      expect(stdout).toBe(EXPECTED);
    });
  }
});

/* A mapped AUTHORED-JavaScript (CommonJS) package named by import() directly: the namespace is built from its
 * module.exports (lexer-detected names + default), through the same builder --npm-static packages use. Before:
 * the build was clean and the site became a rejected promise at run time. */
describe("provenance: import() of a mapped CommonJS package", () => {
  const CJS_EXPECTED = EXPECTED + "default.protocol=5\n";
  for (const backend of ["c", "llvm"] as const) {
    test(`the namespace answers what Node answers on --backend ${backend}`, async () => {
      process.env["SCRIPTC_PROVENANCE_MANIFEST"] = cjsManifest;
      setProvenanceSources(await resolveProvenanceSources(cjsEntry));
      mkdirSync(outDir, { recursive: true });
      const outPath = join(outDir, process.platform === "win32" ? `cjs-${backend}.exe` : `cjs-${backend}`);
      const result = await compile(cjsEntry, { outPath, outDir, dynamic: false, backend });
      if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
      const { stdout } = await execFileAsync(outPath, [], { encoding: "utf8" });
      expect(stdout).toBe(CJS_EXPECTED);
    });
  }
});

/* pg's shape (PG row 24633 equivalent): a mapped package whose export object holds `Pool`, a class minted per evaluation by a factory
 * (`class BoundPool extends Pool` closing over the Client), constructed by a TypeScript caller through the import() namespace member.
 * Node resolves import("pgshape") to its ESM wrapper. Before: SC1090 "constructing 'Pool' (a namespace member with no class lowering)". */
describe("provenance: new through an import() namespace member holding a per-evaluation class", () => {
  const PG_EXPECTED =
    "h1:5432 max=3 client=pg-client | h2:undefined max=10 client=pg-client\n" + "true true true BoundPool function\n" + "false\n" + "true false\n";
  for (const backend of ["c", "llvm"] as const) {
    test(`the constructed pools behave as in Node on --backend ${backend}`, async () => {
      process.env["SCRIPTC_PROVENANCE_MANIFEST"] = pgManifest;
      setProvenanceSources(await resolveProvenanceSources(pgEntry));
      mkdirSync(outDir, { recursive: true });
      const outPath = join(outDir, process.platform === "win32" ? `pg-${backend}.exe` : `pg-${backend}`);
      const result = await compile(pgEntry, { outPath, outDir, dynamic: false, backend });
      if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
      const { stdout } = await execFileAsync(outPath, [], { encoding: "utf8" });
      expect(stdout).toBe(PG_EXPECTED);
    });
  }
});
