/* Direct calls of a declared generic, overloaded member on a declaration type whose compiled JS
 * twin is a class with UNTYPED methods (corpus 23850).
 *
 * `twinrec` is mysql2's promise surface reduced to what a direct `pool.query<string>(sql, args)` needs: the
 * declared `Pool` is paired with the twin class `PromisePool` (another file, reached by require), `query` and
 * `execute` have untyped parameters and answer `new this.Promise(...)`, a checked-dynamic value. The declared
 * result is a Promise, so the call takes the answer by Node's resolution rule (dyn.adoptPromise) and checks the
 * payload into the declared one. A payload with record or class arms is not extractable exactly (the checked
 * cast reads a record off a plain object only, so a class instance Node hands over unchanged would throw): a
 * call that READS such a result is a named compile-time refusal, which replaced an internal compiler error,
 * and a call whose awaited result is never read (the store's `await pool.execute(sql, params)`) extracts
 * nothing and answers exactly.
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
const manifest = join(fixtureDir, "manifest-twinrec.json");
const flavor = process.env["SCRIPTC_SAN"] === "1" ? "san" : "plain";
const outDir = join(repoRoot, "node_modules/.cache/scriptc-tests/provenance-twin-record-view", flavor);

/* Recorded from Node v24.15.0 (`node --experimental-strip-types cases/twinrec/direct.ts`). */
const DIRECT_EXPECTED =
  "query q:Q1:2 1\n" +
  "options q:[object Object]:0\n" +
  "inserted\n" +
  "inserted conn\n" +
  "conn q:Q3:0\n" +
  "caught boom from a\n" +
  "count 1\n" +
  "ended\n";

const PRIOR = process.env["SCRIPTC_PROVENANCE_MANIFEST"];
afterEach(() => {
  setProvenanceSources(null);
  if (PRIOR === undefined) delete process.env["SCRIPTC_PROVENANCE_MANIFEST"];
  else process.env["SCRIPTC_PROVENANCE_MANIFEST"] = PRIOR;
});

async function build(entry: string, name: string, backend: "c" | "llvm") {
  process.env["SCRIPTC_PROVENANCE_MANIFEST"] = manifest;
  setProvenanceSources(await resolveProvenanceSources(entry));
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, process.platform === "win32" ? `${name}-${backend}.exe` : `${name}-${backend}`);
  const result = await compile(entry, { outPath, outDir, dynamic: false, backend, npmStatic: ["twinrec"] });
  return { result, outPath };
}

describe("provenance: direct calls of a declared generic member on a twin class with untyped methods", () => {
  for (const backend of ["c", "llvm"] as const) {
    test(`23850: direct calls of the declared generic, overloaded members match Node (${backend})`, async () => {
      const entry = join(fixtureDir, "cases/twinrec/direct.ts");
      const { result, outPath } = await build(entry, "twinrec-direct", backend);
      if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
      const { stdout } = await execFileAsync(outPath, [], { encoding: "utf8" });
      expect(stdout).toBe(DIRECT_EXPECTED);
    }, 600_000);
  }

  test("23850: a direct generic call whose record-armed payload is READ is a named refusal, not an ICE", async () => {
    const entry = join(fixtureDir, "cases/twinrec-refused/direct-record-payload.ts");
    const { result } = await build(entry, "direct-record-payload", "c");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const codes = result.diagnostics.map((d) => d.code);
      expect(codes).toContain("SC1100");
      expect(codes).not.toContain("SC9001");
    }
  }, 600_000);
});
