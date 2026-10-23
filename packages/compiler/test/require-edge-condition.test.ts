/* A require() edge takes the "require" export condition.
 *
 * pg publishes `exports["."] = { import: ./esm/index.mjs, require:
 * ./lib/index.js }` and pg-pool lazily `require('pg')`s inside a method. One
 * registry answer for both edges sent that CommonJS require to the ESM
 * wrapper, which imports lib/index.js, which requires pg-pool: a CommonJS/ESM
 * cycle Node never forms (SC1016 on the whole pg driver). The registry now
 * keeps a second answer for require() edges, chosen by the importing file's
 * flavor (.cjs, or .js outside a "type": "module" scope). */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { resolveProjectImport } from "../src/frontend/resolve.js";
import { setProvenanceSources } from "../src/frontend/provenance-registry.js";
import { tsgoPath } from "../src/frontend/shared.js";

let root = "";
const w = (p: string, t: string): void => {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, t);
};
const reg = (withRequire: boolean): void =>
  setProvenanceSources({
    packages: [{
      name: "dualpkg",
      version: "1.0.0",
      repo: "https://example.invalid/dualpkg",
      commit: "cafe",
      dir: tsgoPath(join(root, "dualpkg")),
      entries: { dualpkg: tsgoPath(join(root, "dualpkg", "esm", "index.mjs")) },
      ...(withRequire ? { requireEntries: { dualpkg: tsgoPath(join(root, "dualpkg", "lib", "index.js")) } } : {}),
    }],
    notes: [],
  });

beforeAll(() => {
  root = mkdtempSync(join(process.env["TMPDIR"] ?? tmpdir(), "reqcond-"));
  w(join(root, "dualpkg", "package.json"), JSON.stringify({ name: "dualpkg", exports: { ".": { import: "./esm/index.mjs", require: "./lib/index.js" } } }));
  w(join(root, "dualpkg", "esm", "index.mjs"), "export default 1;\n");
  w(join(root, "dualpkg", "lib", "index.js"), "module.exports = 1;\n");
  w(join(root, "dualpkg", "lib", "user.js"), "module.exports = () => require('dualpkg');\n");
  w(join(root, "dualpkg", "lib", "user.cjs"), "module.exports = () => require('dualpkg');\n");
  w(join(root, "dualpkg", "esm", "user.mjs"), "import x from 'dualpkg'; export default x;\n");
  w(join(root, "dualpkg", "esm", "user.ts"), "import x from 'dualpkg'; export default x;\n");
  w(join(root, "esmscope", "package.json"), JSON.stringify({ name: "esmscope", type: "module" }));
  w(join(root, "esmscope", "user.js"), "import x from 'dualpkg'; export default x;\n");
});
afterAll(() => {
  setProvenanceSources(null);
  rmSync(root, { recursive: true, force: true });
});

describe("export condition by edge kind", () => {
  test("Node itself: require takes lib, import takes esm (the oracle)", () => {
    const nm = join(root, "nm");
    w(join(nm, "node_modules", "dualpkg", "package.json"), JSON.stringify({ name: "dualpkg", exports: { ".": { import: "./esm/index.mjs", require: "./lib/index.js" } } }));
    w(join(nm, "node_modules", "dualpkg", "esm", "index.mjs"), "");
    w(join(nm, "node_modules", "dualpkg", "lib", "index.js"), "");
    expect(createRequire(pathToFileURL(join(nm, "a.js"))).resolve("dualpkg")).toMatch(/lib[\\/]index\.js$/);
  });
  test("a CommonJS file's edge answers the require target; ESM spellings keep the import target", () => {
    reg(true);
    const at = (f: string): string | null => resolveProjectImport(join(root, "dualpkg", f), "dualpkg");
    expect(at("lib/user.js")).toMatch(/lib[\\/]index\.js$/);
    expect(at("lib/user.cjs")).toMatch(/lib[\\/]index\.js$/);
    expect(at("esm/user.mjs")).toMatch(/esm[\\/]index\.mjs$/);
    expect(at("esm/user.ts")).toMatch(/esm[\\/]index\.mjs$/);
    expect(resolveProjectImport(join(root, "esmscope", "user.js"), "dualpkg")).toMatch(/esm[\\/]index\.mjs$/);
  });
  test("positive control: without the require entry the CommonJS file lands on the ESM wrapper (the defect)", () => {
    reg(false);
    expect(resolveProjectImport(join(root, "dualpkg", "lib", "user.js"), "dualpkg")).toMatch(/esm[\\/]index\.mjs$/);
  });
});
