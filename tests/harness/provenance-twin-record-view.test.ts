/* The record view of a declaration type whose compiled JS twin is a class with UNTYPED methods
 * (corpus 23850; the Promise constructor value it needs is corpus 23851).
 *
 * `twinrec` is mysql2's promise surface reduced to the mechanisms that stood between a
 * `PromisePool` and a program's own `{ execute(...): Promise<[unknown, unknown]>; end(): Promise<void> }`:
 *
 *   1. the declared `Pool` is paired with the twin class `PromisePool` that lives in ANOTHER file
 *      (lib/promise/pool.js, reached by require), so the class is in the program and the value is
 *      its instance (the older notes that said the class had no ClassInfo came from a probe that
 *      imported the package from a pnpm symlink: the Node-resolution probe for the tree's own
 *      requires started from the symlink instead of the realpath, so every statement after the
 *      first require counted as dead);
 *   2. `execute(sql, args)` and `query(sql, args)` have untyped parameters, so they own no vtable
 *      slot: a record's method field binds the method's all-dynamic default instance to the
 *      instance (the slot's parameters convert in, surplus ones drop, the result converts out);
 *   3. those methods answer `new this.Promise(...)`, a checked-dynamic value: a Promise slot takes
 *      it by Node's resolution rule (dyn.adoptPromise) and checks the payload, and the `Promise`
 *      constructor itself is a function object `new` can run (corpus 23851).
 *
 * The refusals that STAY are pinned too: a record or class payload cannot be extracted from the
 * checked-dynamic answer exactly (a class instance Node hands over unchanged would throw), so the
 * store's `{ execute: PoolConnection['execute'] }` and a direct generic call whose declared
 * payload holds record arms fail at compile time, never at run time.
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

/* Recorded from Node v24.15.0 (`node --experimental-strip-types cases/twinrec/main.ts`). */
const EXPECTED =
  "sqlRun 10\n" +
  "query q:Q1:2 1\n" +
  "sqlRun 10\n" +
  "caught boom from a\n" +
  "count 2\n" +
  "sqlRun 10\n" +
  "shut\n" +
  "shut\n" +
  "ended\n";

/* cases/twinrec/direct.ts, recorded the same way. */
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

describe("provenance: a twin class with untyped methods behind a program's own record", () => {
  for (const backend of ["c", "llvm"] as const) {
    test(`23850: records, direct generic calls and end() match Node (${backend})`, async () => {
      const entry = join(fixtureDir, "cases/twinrec/main.ts");
      const { result, outPath } = await build(entry, "twinrec", backend);
      if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
      const { stdout } = await execFileAsync(outPath, [], { encoding: "utf8" });
      expect(stdout).toBe(EXPECTED);
    }, 600_000);
  }

  for (const backend of ["c", "llvm"] as const) {
    test(`23850: direct calls of the declared generic, overloaded members match Node (${backend})`, async () => {
      const entry = join(fixtureDir, "cases/twinrec/direct.ts");
      const { result, outPath } = await build(entry, "twinrec-direct", backend);
      if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
      const { stdout } = await execFileAsync(outPath, [], { encoding: "utf8" });
      expect(stdout).toBe(DIRECT_EXPECTED);
    }, 600_000);
  }

  test("23850: the store's executor record stays a compile-time refusal (record arms in the payload)", async () => {
    const entry = join(fixtureDir, "cases/twinrec-refused/store-executor.ts");
    const { result } = await build(entry, "store-executor", "c");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics.map((d) => d.code)).toContain("SC2002");
  }, 600_000);

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
