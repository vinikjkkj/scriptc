/* Nested require() destructuring desugars to the flat read of the export
 * followed by an ordinary destructuring of that value (js-desugar.ts). The
 * tests pin what it rewrites, what it leaves for preflight to refuse, and
 * that no line moves. */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { jsDesugar, NODE_COMPAT_VERSION } from "../src/frontend/js-desugar.js";

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

  test("a tsc helper declared with a this guard becomes the function", () => {
    const src = "var __pick = (this && this.__pick) || function (o) { return o; };\nclass C { m() { return __pick(1); } }\n";
    expect(run(src)).toBe("var __pick = function (o) { return o; };\nclass C { m() { return __pick(1); } }\n");
    // a name the program writes as a member, a name outside tsc's __ space, and another guard are left alone
    expect(run(src + "exports.__pick = 1;\n")).toBeNull();
    expect(run("var pick = (this && this.pick) || function (o) { return o; };\n")).toBeNull();
    expect(run("var __pick = (this && this.__other) || function (o) { return o; };\n")).toBeNull();
  });

  test("instance fields initialized to undefined become bare declarations; statics keep their spelling", () => {
    const out = run("class A { a = undefined; #b = void 0; c = 1; static s = undefined; d = null; }\n")!;
    expect(out).toBe("class A { a; #b; c = 1; static s = undefined; d = null; }\n");
    expect(run("class A { a = 1; }\n")).toBeNull();
    expect(run("class A { a: number | undefined = undefined; }\n", "/p/m.ts")).toBeNull();
  });

  const privateSrc = [
    "var __classPrivateFieldGet = (this && this.__classPrivateFieldGet) || function (receiver, state, kind, f) { return state.get(receiver); };",
    "var __classPrivateFieldSet = (this && this.__classPrivateFieldSet) || function (receiver, state, value, kind, f) { state.set(receiver, value); return value; };",
    "var _C_instances, _a, _C_count, _C_made, _C_bump, _C_total_get, _C_total_set;",
    "class C {",
    "    constructor() {",
    "        _C_instances.add(this);",
    "        _C_count.set(this, 0);",
    "    }",
    "    inc() { return __classPrivateFieldGet(this, _C_instances, \"m\", _C_bump).call(this, 1); }",
    "    total() { __classPrivateFieldSet(this, _C_instances, 4, \"a\", _C_total_set); return __classPrivateFieldGet(this, _C_instances, \"a\", _C_total_get); }",
    "    static made() { return __classPrivateFieldGet(_a, _a, \"f\", _C_made); }",
    "}",
    "_a = C, _C_count = new WeakMap(), _C_instances = new WeakSet(), _C_bump = function _C_bump(by) {",
    "    __classPrivateFieldSet(this, _C_count, __classPrivateFieldGet(this, _C_count, \"f\") + by, \"f\");",
    "    return __classPrivateFieldGet(this, _C_count, \"f\");",
    "}, _C_total_get = function _C_total_get() { return __classPrivateFieldGet(this, _C_count, \"f\") * 2; }, _C_total_set = function _C_total_set(v) { __classPrivateFieldSet(this, _C_count, v / 2, \"f\"); };",
    "_C_made = { value: 3 };",
    "",
  ].join("\n");

  test("tsc-downleveled private members become native private members", () => {
    const out = run(privateSrc)!;
    expect(out).not.toBeNull();
    expect(out).not.toContain("__classPrivateField");
    expect(out).not.toContain("_C_");
    expect(out).toContain("static #made = 3;");
    expect(out).toContain("#count = 0;");
    expect(out).toContain("return this.#bump(1);");
    expect(out).toContain("(this.#count = this.#count + by)");
    expect(out).toContain("get #total()");
    expect(out).toContain("set #total(v)");
    expect(out).toContain("return C.#made;");
  });

  test("private member shapes tsc does not emit leave the file as written", () => {
    // another receiver than `this`
    expect(run(privateSrc.replace("__classPrivateFieldGet(this, _C_instances, \"m\", _C_bump).call(this, 1)", "__classPrivateFieldGet(other, _C_instances, \"m\", _C_bump).call(other, 1)"))).not.toContain("#bump");
    // a state name used any other way
    expect(run(privateSrc.replace("return __classPrivateFieldGet(this, _C_count, \"f\");\n}, _C_total_get", "return _C_count;\n}, _C_total_get"))).not.toContain("#count");
  });

  test("conditionals over the Node version take their branch", () => {
    const src = "const E = process.version.charCodeAt(1) < 55 && process.version.charCodeAt(2) === 46\n  ? require('./lib/old')\n  : require('./lib/modern');\n";
    const out = run(src)!;
    expect(out).toContain("require('./lib/modern')");
    expect(out).not.toContain("./lib/old");
    expect(out.split("\n").length).toBe(src.split("\n").length);
    const ifs = run("if (process.versions.node.slice(0, 2) === '99') { require('./never'); } else { require('./ok'); }\n")!;
    expect(ifs).toContain("require('./ok')");
    expect(ifs).not.toContain("./never");
    // a test with any operand the evaluator does not know is not a probe
    expect(run("const x = process.version.charCodeAt(1) < f() ? 1 : 2;\n")).toBeNull();
    expect(run("const x = cond ? require('./a') : require('./b');\n")).toBeNull();
  });

  test("a deferred let assigned one new before its readers is annotated; every other shape is left alone", () => {
    const ok = "function f(cfg) {\n  let h;\n  if (cfg) {\n    h = new ns.Cmd(1);\n    h.on('x', () => h.v);\n  }\n}\n";
    const out = run(ok)!;
    expect(out).toContain("/** @type {InstanceType<typeof ns.Cmd>} */ let h;");
    expect(out.split("\n").length).toBe(ok.split("\n").length);
    // a second write, a read before the assignment, a read outside the assigning block, a
    // typed declaration, and a non-name callee are not the shape
    expect(run("function f() {\n  let h;\n  h = new A();\n  h = new A();\n  return () => h.v;\n}\n")).toBeNull();
    expect(run("function f() {\n  let h;\n  const g = () => h.v;\n  h = new A();\n  return g;\n}\n")).toBeNull();
    expect(run("function f(c) {\n  let h;\n  if (c) {\n    h = new A();\n  }\n  return () => h.v;\n}\n")).toBeNull();
    expect(run("function f() {\n  /** @type {B} */\n  let h;\n  h = new A();\n  return () => h.v;\n}\n")).toBeNull();
    expect(run("function f() {\n  let h;\n  h = new (get())();\n  return () => h.v;\n}\n")).toBeNull();
    expect(run("function f() {\n  let h;\n  h = new A();\n  h++;\n  return () => h.v;\n}\n")).toBeNull();
  });

  test("the folded Node version is the runtime's compatibility target", () => {
    const lib = readFileSync(join(import.meta.dirname, "../../runtime/src/scr_lib.c"), "utf8");
    const m = /#define SCR_NODE_COMPAT_VERSION "([^"]+)"/.exec(lib);
    expect(m, "scr_lib.c no longer defines SCR_NODE_COMPAT_VERSION").not.toBeNull();
    expect(NODE_COMPAT_VERSION).toBe(m![1]);
  });
});
