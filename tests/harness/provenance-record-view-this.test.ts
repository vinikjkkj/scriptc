/* A package-class method taken through a record view keeps its receiver (rows 24722, 24723; the package-free forms are corpus
 * 24720 and 24721).
 *
 * pg's store shape: a store package (`pgstore`, TypeScript source) takes a pool of a JS package (`pgbind`, a class minted by a
 * factory and typed by an @types twin) and hands it to an async arrow whose parameter is `{ query: PoolClient['query'] }`. The
 * record is a VIEW of the pool; its `query` member is the method's UNBOUND thunk, which reads its receiver off the ambient
 * window. Before: the call through the record opened no window, so the method ran with an undefined receiver ("Cannot read
 * properties of undefined (reading 'tag')", zapo's "expected Pool at $, got undefined"). Now `rec.f(...)` and `rec["f"](...)`
 * run with `this` = the viewed object, and a write to the pool after the record was handed over is read by the next call.
 *
 * Each assertion is a RUN of a --dynamic-free binary on BOTH backends against a string recorded from Node v24.15.0. */
import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "vitest";
import { compile, resolveProvenanceSources, setProvenanceSources } from "@scriptc/compiler";

const execFileAsync = promisify(execFile);
const repoRoot = join(import.meta.dirname, "../..");
const fixtureDir = join(repoRoot, "tests/fixtures/provenance");
const manifest = join(fixtureDir, "manifest-pgbind.json");
const flavor = process.env["SCRIPTC_SAN"] === "1" ? "san" : "plain";
const outDir = join(repoRoot, "node_modules/.cache/scriptc-tests/provenance-record-view-this", flavor);

const PRIOR = process.env["SCRIPTC_PROVENANCE_MANIFEST"];
afterEach(() => {
  setProvenanceSources(null);
  if (PRIOR === undefined) delete process.env["SCRIPTC_PROVENANCE_MANIFEST"];
  else process.env["SCRIPTC_PROVENANCE_MANIFEST"] = PRIOR;
});

/* Recorded from Node v24.15.0 (`node --experimental-strip-types cases/pgbind/<name>.ts`). */
const CASES: { name: string; row: number; expected: string }[] = [
  { name: "main", row: 24722, expected: "pool:x:[1]\n" },
  {
    name: "forms",
    row: 24723,
    expected:
      "text pool:select $1:[7]\n" + "cb null pool:select cb:[1,2]\n" + "element pool:element:[]\n" + "live renamed:after write:[]\n" + "done\n",
  },
];

describe("provenance: a package-class method called through a record view keeps the receiver", () => {
  for (const c of CASES) {
    for (const backend of ["c", "llvm"] as const) {
      test(`row ${c.row} (${c.name}) matches Node on --backend ${backend}`, async () => {
        const entry = join(fixtureDir, `cases/pgbind/${c.name}.ts`);
        process.env["SCRIPTC_PROVENANCE_MANIFEST"] = manifest;
        setProvenanceSources(await resolveProvenanceSources(entry));
        mkdirSync(outDir, { recursive: true });
        const outPath = join(outDir, process.platform === "win32" ? `${c.name}-${backend}.exe` : `${c.name}-${backend}`);
        const result = await compile(entry, { outPath, outDir, dynamic: false, backend });
        if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
        const { stdout } = await execFileAsync(outPath, [], { encoding: "utf8" });
        expect(stdout).toBe(c.expected);
      });
    }
  }
});
