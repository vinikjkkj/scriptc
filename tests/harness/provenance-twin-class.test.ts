/* A class declared in a package's `.d.ts` whose compiled `.js` twin defines it.
 *
 * Const/let and functions already crossed the declaration/twin boundary: the
 * binding resolves to the twin's own storage or function. A CLASS did not, and
 * the failure was never one message -- `new Box(4)` mapped the declaration to a
 * structural record (SC2002 "record shapes must match exactly", got the twin's
 * nominal class), `b.get()` refused "no compiled implementation", and `extends`
 * found no base. The declaration and the twin described one class and the
 * compiler saw two.
 *
 * The repair makes them ONE: a declaration-file class whose twin defines a
 * class under the same export name is the twin's class everywhere it is named
 * (instance type, static side, construction, members, instanceof, extends).
 *
 * Every assertion is a RUN of a --dynamic-free binary on BOTH backends against
 * a string recorded from Node (v24.15.0). An earlier attempt that resolved the
 * declaration straight to its twin compiled and then printed `0` for a const
 * set to 7 and crashed on a call, so value fidelity (const, function, class,
 * method, static, field, instanceof, extends) is what is asserted, never
 * "it compiles". */
import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "vitest";
import { compile, resolveProvenanceSources, setProvenanceSources } from "@scriptc/compiler";

const execFileAsync = promisify(execFile);
const repoRoot = join(import.meta.dirname, "../..");
const fixtureDir = join(repoRoot, "tests/fixtures/provenance");
const manifest = join(fixtureDir, "manifest-twinclass.json");
const flavor = process.env["SCRIPTC_SAN"] === "1" ? "san" : "plain";
const outDir = join(repoRoot, "node_modules/.cache/scriptc-tests/provenance-twin-class", flavor);

const PRIOR = process.env["SCRIPTC_PROVENANCE_MANIFEST"];
afterEach(() => {
  setProvenanceSources(null);
  if (PRIOR === undefined) delete process.env["SCRIPTC_PROVENANCE_MANIFEST"];
  else process.env["SCRIPTC_PROVENANCE_MANIFEST"] = PRIOR;
});

async function buildAndRun(
  entry: string,
  name: string,
  backend: "c" | "llvm",
  manifestPath: string = manifest,
): Promise<string> {
  process.env["SCRIPTC_PROVENANCE_MANIFEST"] = manifestPath;
  setProvenanceSources(await resolveProvenanceSources(entry));
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, process.platform === "win32" ? `${name}-${backend}.exe` : `${name}-${backend}`);
  const result = await compile(entry, { outPath, outDir, dynamic: false, backend });
  if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
  const { stdout } = await execFileAsync(outPath, [], { encoding: "utf8" });
  return stdout;
}

const BACKENDS = ["c", "llvm"] as const;

const EXPECTED_ESM =
  "get=4\n" +
  "limit=7 twice=42\n" +
  "make=9 kind=box\n" +
  "other7\n" +
  "truefalsetrue\n" +
  "v=4\n" +
  "v2=11\n" +
  "mine=16true8\n" +
  "24\n";

describe("provenance: a class declared in a .d.ts and defined by its .js twin", () => {
  for (const backend of BACKENDS) {
    test(`named import: construction, methods, statics, fields, instanceof, extends (${backend})`, async () => {
      const entry = join(fixtureDir, "cases/twinclass/main.ts");
      expect(await buildAndRun(entry, "twinclass", backend)).toBe(EXPECTED_ESM);
    });
  }
});

/* The CommonJS spelling of the same boundary: a require binding whose module
 * is a declaration with a compiled twin. Two things were missing. The binding
 * itself (`rs.X`) was refused as a default import used as a value, and the
 * require statement named no init for the twin, so a program that got past the
 * first read printed `limit=0` for a constant Node reads as 7. */
const EXPECTED_REQUIRE = "limit=7\n" + "twice=42\n" + "destructured=7 4\n";

describe("provenance: a require binding of a .d.ts module with a compiled twin", () => {
  for (const backend of BACKENDS) {
    test(`const, function and destructured members cross, initialised (${backend})`, async () => {
      const entry = join(fixtureDir, "cases/twinclassreq/main.js");
      expect(await buildAndRun(entry, "twinclassreq", backend)).toBe(EXPECTED_REQUIRE);
    });
  }
});

/* Classes through the require binding. The receiver of a static call/read and
 * the base of an `extends` clause were bare identifiers only; a qualified one
 * (`rs.Box.make(9)`, `class X extends rs.Base`) answered "constructing values
 * other than classes", "no compiled implementation" and "no base class declares
 * it". `exports.default = Client` in the twin against `export default class` in
 * the declaration is the default-export form ("twin defines it as a function"
 * in the field measurement). */
const EXPECTED_REQUIRE_CLASSES =
  "get=4\n" +
  "make=9 kind=box\n" +
  "other7\n" +
  "truefalsetrue\n" +
  "v=4\n" +
  "v2=11\n" +
  "pong:a\n" +
  "pong:q2\n" +
  "sub-pong:sub5true\n" +
  "my-pong:ktruetrue\n" +
  "6sub-pong:sub\n";

describe("provenance: classes through a require binding of a .d.ts module with a compiled twin", () => {
  for (const backend of BACKENDS) {
    test(`construction, qualified statics, default export, extends with super, instanceof (${backend})`, async () => {
      const entry = join(fixtureDir, "cases/twinclassjs/main.js");
      expect(await buildAndRun(entry, "twinclassjs", backend)).toBe(EXPECTED_REQUIRE_CLASSES);
    });
  }
});

/* The DEFAULT import of a declaration-with-twin CommonJS module:
 * `import mysql from "pkg/promise"; mysql.createPool(...)`. esModuleInterop
 * types the binding as the module namespace and Node binds the TWIN's
 * module.exports there. The call refused "no compiled implementation" (the
 * mysql2 shape), and once the binding resolved, the twin's init was not run for
 * a default binding: the build compiled and the binary aborted/segfaulted, a
 * silent-wrong-answer class. */
const EXPECTED_DEFAULT = "SELECT:2/1\n" + "SELECT 2:2/1\n" + "2\n" + "boom from a\n";

describe("provenance: the default import of a .d.ts module with a compiled twin", () => {
  for (const backend of BACKENDS) {
    test(`mysql.createPool through the default binding runs the twin (${backend})`, async () => {
      const entry = join(fixtureDir, "cases/mixinpooldefault/main.ts");
      const mp = join(fixtureDir, "manifest-mixinpool.json");
      expect(await buildAndRun(entry, "mixinpooldefault", backend, mp)).toBe(EXPECTED_DEFAULT);
    });
  }
});
