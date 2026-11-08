/* A record whose declaration retypes a slot of the implementation's record (rows 24783-24785).
 *
 * standard-as-callback's shape, as a mapped package with declaration twins: `errorObj` is `{ e: {} }`, `tryCatcher` answers it
 * where its declaration says `void | { e: Error }`, and asCallback compares the answer to `errorObj` by identity.
 *
 *   24783 identity and aliasing: `ret === errorObj`, the caught Error read as `ret.e`, a write through either name read
 *         through the other.
 *   24784 the lost Error: the placeholder slot `{ e: {} }` (an empty literal that is the value of a property, authored JS) is
 *         assigned the caught Error; it used to be an empty record, so the Error was lost and the cast to `{ e: Error }` threw.
 *   24785 the package's own asCallback, verbatim: its two `ret === utils_1.errorObj` comparisons were SC1090; a throwing callback
 *         is rethrown later (an uncaught error: non-zero exit, stderr names it).
 *
 * Each assertion is a RUN of a --dynamic-free binary on BOTH backends against what Node v24.15.0 printed. */
import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "vitest";
import { compile, resolveProvenanceSources, setProvenanceSources } from "@scriptc/compiler";

const execFileAsync = promisify(execFile);
const repoRoot = join(import.meta.dirname, "../..");
const fixtureDir = join(repoRoot, "tests/fixtures/provenance");
const manifest = join(fixtureDir, "manifest-sacb.json");
const flavor = process.env["SCRIPTC_SAN"] === "1" ? "san" : "plain";
const outDir = join(repoRoot, "node_modules/.cache/scriptc-tests/provenance-retyped-slot-identity", flavor);

const PRIOR = process.env["SCRIPTC_PROVENANCE_MANIFEST"];
afterEach(() => {
  setProvenanceSources(null);
  if (PRIOR === undefined) delete process.env["SCRIPTC_PROVENANCE_MANIFEST"];
  else process.env["SCRIPTC_PROVENANCE_MANIFEST"] = PRIOR;
});

const CASES: { name: string; row: number; stdout: string; fails?: string }[] = [
  { name: "main", row: 24783, stdout: "true\nboom true\ntrue\ntrue\n" },
  { name: "lost", row: 24784, stdout: "boom true\n" },
  { name: "asCallback", row: 24785, stdout: "ok null 7\n", fails: "callback threw" },
];

describe("provenance: a retyped declaration slot is the implementation's own slot", () => {
  for (const c of CASES) {
    for (const backend of ["c", "llvm"] as const) {
      test(`row ${c.row} (${c.name}) matches Node on --backend ${backend}`, async () => {
        const entry = join(fixtureDir, `cases/sacb/${c.name}.ts`);
        process.env["SCRIPTC_PROVENANCE_MANIFEST"] = manifest;
        setProvenanceSources(await resolveProvenanceSources(entry));
        mkdirSync(outDir, { recursive: true });
        const outPath = join(outDir, process.platform === "win32" ? `${c.name}-${backend}.exe` : `${c.name}-${backend}`);
        const result = await compile(entry, { outPath, outDir, dynamic: false, backend });
        if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
        if (c.fails === undefined) {
          const { stdout } = await execFileAsync(outPath, [], { encoding: "utf8" });
          expect(stdout).toBe(c.stdout);
        } else {
          const err = await execFileAsync(outPath, [], { encoding: "utf8" }).then(
            () => null,
            (e: { code?: number; stdout?: string; stderr?: string }) => e,
          );
          expect(err).not.toBeNull();
          expect(err!.code).not.toBe(0);
          expect(err!.stdout).toBe(c.stdout);
          expect(err!.stderr).toContain(c.fails);
        }
      });
    }
  }
});
