/* --provenance-sources: a mapped CommonJS package whose module.exports IS a class carrying named statics (ioredis' index.js:
 * `exports = module.exports = require("./Redis").default`, getters for default and Redis, a plain helper), reached through
 * `await import("pkg")` and through static imports. The static form always built; the import() form refused
 * SC1090 "a namespace of 'index.js', a CommonJS `export =` module whose `module.exports` is not a static export table",
 * which is the one site that kept zapo's redis bench arm from building, and once past it the class crossed as a trap
 * function instead of a class value. The compiled binaries must print what Node prints, on both backends, and the
 * import() form must agree with the static form on everything the static form can express. */
import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "vitest";
import { analyze, compile, resolveProvenanceSources, setProvenanceSources } from "@scriptc/compiler";

const execFileAsync = promisify(execFile);
const repoRoot = join(import.meta.dirname, "../..");
const fixtureDir = join(repoRoot, "tests/fixtures/provenance");
const manifest = join(fixtureDir, "manifest-expclass.json");
const dynEntry = join(fixtureDir, "cases/expclass-dynimport/main.ts");
const staticEntry = join(fixtureDir, "cases/expclass-static/main.ts");
const pipeEntry = join(fixtureDir, "cases/expclass-pipeline/main.ts");
const spreadEntry = join(fixtureDir, "cases/expclass-spreadcall/main.ts");
const castEntry = join(fixtureDir, "cases/expclass-castcall/main.ts");
const mgetEntry = join(fixtureDir, "cases/expclass-mgetbuffer/main.ts");
const evalEntry = join(fixtureDir, "cases/expclass-evalbuffer/main.ts");
const destructureEntry = join(fixtureDir, "cases/expclass-dyndestructure/main.ts");
const flavor = process.env["SCRIPTC_SAN"] === "1" ? "san" : "plain";
const outDir = join(repoRoot, "node_modules/.cache/scriptc-tests/provenance-expclass", flavor);
// Recorded from Node (v24.15.0) running the two programs against tests/fixtures/provenance/node_modules/expclass.
const COMMON = "v:k PONG 1 h\n" + "true true true function 2\n";
const DYN_EXPECTED = COMMON + "v:y Redis,__esModule,default,helper,module.exports\n";
const STATIC_EXPECTED = COMMON + "v:y\n";
const CAST_EXPECTED = "3 2 v:k 6\n";
const MGET_EXPECTED = "3 true true 99,33 3\n";
const EVAL_EXPECTED = "field:h1,field:i2 val:LUA 1\n";
const SPREAD_EXPECTED = "3 2 5\n" + "sadd:set:a+b+c,sadd:set2:x\n";
const DESTRUCTURE_EXPECTED = "v:k 3 true\n";
const PIPE_EXPECTED = "cmd3:a,cmd7:b,v:c,cmd69:d 1 true\n" + "0 cmd0:z\n";
const PRIOR = process.env["SCRIPTC_PROVENANCE_MANIFEST"];

afterEach(() => {
  setProvenanceSources(null);
  if (PRIOR === undefined) delete process.env["SCRIPTC_PROVENANCE_MANIFEST"];
  else process.env["SCRIPTC_PROVENANCE_MANIFEST"] = PRIOR;
});

async function run(entry: string, backend: "c" | "llvm", tag: string): Promise<string> {
  process.env["SCRIPTC_PROVENANCE_MANIFEST"] = manifest;
  setProvenanceSources(await resolveProvenanceSources(entry));
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, process.platform === "win32" ? `${tag}-${backend}.exe` : `${tag}-${backend}`);
  const result = await compile(entry, { outPath, outDir, dynamic: false, backend });
  if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
  const { stdout } = await execFileAsync(outPath, [], { encoding: "utf8" });
  return stdout;
}

describe("provenance: a mapped CommonJS package whose module.exports is a class", () => {
  test("preflight and lowering report nothing for the import() form", async () => {
    process.env["SCRIPTC_PROVENANCE_MANIFEST"] = manifest;
    setProvenanceSources(await resolveProvenanceSources(dynEntry));
    const { coverage } = analyze(dynEntry);
    expect(coverage.preflightFailed).toBe(false);
    expect(coverage.diagnostics).toHaveLength(0);
  });

  for (const backend of ["c", "llvm"] as const) {
    test(`the import() binary matches Node on --backend ${backend}`, async () => {
      expect(await run(dynEntry, backend, "dyn")).toBe(DYN_EXPECTED);
    });
    test(`the static-import binary matches Node on --backend ${backend}`, async () => {
      expect(await run(staticEntry, backend, "static")).toBe(STATIC_EXPECTED);
    });
    test(`a spread argument to a prototype-installed command matches Node on --backend ${backend}`, async () => {
      expect(await run(spreadEntry, backend, "spread")).toBe(SPREAD_EXPECTED);
    });
    test(`a member called through an as-unknown cast of a package instance matches Node on --backend ${backend}`, async () => {
      expect(await run(castEntry, backend, "cast")).toBe(CAST_EXPECTED);
    });
    test(`a package command answering a promise of buffers and nulls matches Node on --backend ${backend}`, async () => {
      expect(await run(mgetEntry, backend, "mget")).toBe(MGET_EXPECTED);
    });
    test(`a script command answering buffers through an assertion over unknown matches Node on --backend ${backend}`, async () => {
      expect(await run(evalEntry, backend, "eval")).toBe(EVAL_EXPECTED);
    });
    test(`destructuring the import() namespace directly matches Node on --backend ${backend}`, async () => {
      expect(await run(destructureEntry, backend, "destructure")).toBe(DESTRUCTURE_EXPECTED);
    });
    test(`a class instance handed out as an interface of dozens of methods matches Node on --backend ${backend}`, async () => {
      expect(await run(pipeEntry, backend, "pipe")).toBe(PIPE_EXPECTED);
    });
  }
});
