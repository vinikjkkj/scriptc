/* Nested require() destructuring desugars to the flat read of the export
 * followed by an ordinary destructuring of that value (js-desugar.ts). The
 * tests pin what it rewrites, what it leaves for preflight to refuse, and
 * that no line moves. */
import { describe, expect, test } from "vitest";
import { jsDesugar } from "../src/frontend/js-desugar.js";

const run = (text: string, file = "/p/m.js"): string | null => jsDesugar(file, text);

describe("jsDesugar", () => {
  test("a nested pattern becomes a flat read plus a destructuring", () => {
    const out = run("const { A: { b, c } } = require('./x');\nconsole.log(b, c);\n");
    expect(out).not.toBeNull();
    expect(out).toContain("const { A: __sc_n");
    expect(out).toMatch(/const \{ b, c \} = __sc_n\d+;/);
    // the statement's require stays a plain single-level binding
    expect(out).toContain("= require('./x');");
  });

  test("three levels nest outermost first", () => {
    const out = run("const { A: { B: { c } }, d } = require('./x');\n")!;
    const decls = out.match(/const \{[^}]*\} = [^;]+;/g)!;
    expect(decls.length).toBe(3);
    expect(decls[0]).toContain("require('./x')");
    expect(decls[1]).toMatch(/B: __sc_n\d+/);
    expect(decls[2]).toMatch(/\{ c \}/);
  });

  test("line breaks of the original statement are kept, so no later line moves", () => {
    const src = "const {\n  A: { b }\n} = require('./x');\nlet z = 1;\n";
    const out = run(src)!;
    expect(out.split("\n").length).toBe(src.split("\n").length);
    expect(out.split("\n").findIndex((l) => l.startsWith("let z"))).toBe(
      src.split("\n").findIndex((l) => l.startsWith("let z")),
    );
  });

  test("flat patterns, defaults and rest are left alone (preflight still decides them)", () => {
    expect(run("const { a, b } = require('./x');\n")).toBeNull();
    expect(run("const { A: { b = 1 } } = require('./x');\n")).toBeNull();
    expect(run("const { A: { ...r } } = require('./x');\n")).toBeNull();
    expect(run("const { A: { b } } = other('./x');\n")).toBeNull();
  });

  test("only .js/.cjs files are rewritten", () => {
    const src = "const { A: { b } } = require('./x');\n";
    expect(run(src, "/p/m.ts")).toBeNull();
    expect(run(src, "/p/m.d.ts")).toBeNull();
    expect(run(src, "/p/m.cjs")).not.toBeNull();
  });
  test("process module, getBuiltinModule and the UMD wrapper", () => {
    expect(run("const process = require('process');\nprocess.nextTick(f);\n")).toBe(";\nprocess.nextTick(f);\n");
    expect(run("const dc = process.getBuiltinModule('node:diagnostics_channel');\n")).toBe(
      "const dc = require('node:diagnostics_channel');\n",
    );
    const umd =
      "(function (global, factory) {\n  if (typeof exports === 'object') { factory(exports); if (typeof module === 'object') module.exports = preferDefault(exports); }\n})(this, function (_exports) {\n  Object.defineProperty(_exports, '__esModule', { value: true });\n  _exports.default = void 0;\n  function Pair() {}\n  var _default = (_exports.default = Pair);\n});\n";
    const out = run(umd)!;
    expect(out).toContain("function Pair() {}");
    expect(out).toContain("var _default = Pair;");
    expect(out).toContain("module.exports = Pair;");
    expect(out).not.toContain("_exports");
    expect(out.split("\n").length).toBe(umd.split("\n").length);
    // a wrapper that uses the exports parameter any other way is left alone
    expect(run(umd.replace("function Pair() {}", "_exports.extra = 1; function Pair() {}"))).toBeNull();
  });
});
