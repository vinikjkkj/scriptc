/* A GENERIC class declared in a package's `.d.ts` (`declare class Ring<T = any>`, `export = Ring`) whose
 * compiled `.js` twin is a function constructor with prototype methods and a getter-only `length`
 * (denque, which ioredis keeps its command queues in).
 *
 * Four things stood between that shape and a build, and the consumer here exercises each:
 *  - the declaration never paired with its twin (a type-parameterised class was excluded), so the receiver
 *    mapped to a record arm and every call refused ("no compiled implementation");
 *  - the recognizer rejected the twin's `Object.defineProperty(Ring.prototype, "length", { get: function ... })`
 *    as a non-data descriptor, so the constructor was never a class;
 *  - `new Ring()` from a JavaScript file lowered the paired constructor as a plain function value;
 *  - the queue fields are assigned in methods, not the constructor, so each reads `Ring | undefined`, and a
 *    getter read through that union ("reading 'length' on a union-typed value") had no lowering.
 *
 * Every assertion is a RUN of a --dynamic-free binary on BOTH backends against a string recorded from Node
 * (v24.15.0) over the same package. */
import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "vitest";
import { compile, resolveProvenanceSources, setProvenanceSources } from "@scriptc/compiler";

const execFileAsync = promisify(execFile);
const repoRoot = join(import.meta.dirname, "../..");
const fixtureDir = join(repoRoot, "tests/fixtures/provenance");
const flavor = process.env["SCRIPTC_SAN"] === "1" ? "san" : "plain";
const outDir = join(repoRoot, "node_modules/.cache/scriptc-tests/provenance-twin-generic", flavor);

const PRIOR = process.env["SCRIPTC_PROVENANCE_MANIFEST"];
afterEach(() => {
  setProvenanceSources(null);
  if (PRIOR === undefined) delete process.env["SCRIPTC_PROVENANCE_MANIFEST"];
  else process.env["SCRIPTC_PROVENANCE_MANIFEST"] = PRIOR;
});

async function buildAndRun(name: string, backend: "c" | "llvm"): Promise<string> {
  const manifest = join(fixtureDir, `manifest-${name}.json`);
  const entry = join(fixtureDir, `cases/${name}/main.js`);
  process.env["SCRIPTC_PROVENANCE_MANIFEST"] = manifest;
  setProvenanceSources(await resolveProvenanceSources(entry));
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, process.platform === "win32" ? `${name}-${backend}.exe` : `${name}-${backend}`);
  const result = await compile(entry, { outPath, outDir, dynamic: false, backend });
  if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
  expect(result.backend).toBe(backend);
  const { stdout } = await execFileAsync(outPath, [], { encoding: "utf8" });
  return stdout;
}

const EXPECTED = "3 3 a\n" + "a,b,c 0\n" + "1 2 2\n" + "z ring\n" + "<q>\n" + "10\n" + "<w> 8 undefined\n";

describe("provenance: a generic declared export= class paired with its function-constructor twin", () => {
  for (const backend of ["c", "llvm"] as const) {
    test(`push, shift, peek and the getter-only length through nullable fields match Node (${backend})`, async () => {
      expect(await buildAndRun("twingen", backend)).toBe(EXPECTED);
    }, 300_000);
  }
});

/* The real thing: denque 2.1.0 verbatim, the queue ioredis keeps its command and offline queues in. Its constructor
 * assigns two fields in one branch only, a dozen of its methods read `arguments`, `length` is a getter-only accessor
 * defined through Object.defineProperty, and its raw `@returns {Array}` JSDoc is the form tsgo reports and 5.9.3 does not. */
const EXPECTED_DENQUE =
  "3 3/3 a c\n" +
  "a,b,c 0/3 true\n" +
  "5,10,20,30,40 40 5 3\n" +
  "20 10,30 10 30\n" +
  "0 undefined true\n" +
  "30 20 49 30\n";

describe("provenance: denque, a generic declared export= class with a branch-assigned, arguments-reading constructor function", () => {
  for (const backend of ["c", "llvm"] as const) {
    test(`ioredis' queue usage (push, shift, unshift, pop, splice, peek, clear, length) matches Node (${backend})`, async () => {
      expect(await buildAndRun("twinden", backend)).toBe(EXPECTED_DENQUE);
    }, 300_000);
  }
});
