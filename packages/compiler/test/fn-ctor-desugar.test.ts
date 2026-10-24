/* Function-constructor staging (fn-ctor-desugar.ts): a `new Function` over program-known text becomes the function
 * expression the text denotes. Pins what is rewritten, what is left for the loud SC2020 refusal, and (the strong
 * check) that the rewritten program prints exactly what the original prints when both are run. */
import { describe, expect, test } from "vitest";
import { jsDesugar } from "../src/frontend/js-desugar.js";

const run = (text: string): string | null => jsDesugar("/p/m.cjs", text);

/** Runs a program body (the console is injected) and returns what it printed. */
function exec(src: string): string {
  const out: string[] = [];
  const log = (...a: unknown[]): void => {
    out.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
  };
  new Function("console", src)({ log });
  return out.join("\n");
}

const CASES: Record<string, string> = {
  literal: "const f = new Function('a', 'b', 'return a + b'); console.log(f(1, 2), f.name, f.length);",
  callForm: "const f = Function('return 7'); console.log(f());",
  apply: "const f = Function.apply(null, ['x', 'return x * 2']); console.log(f(4));",
  concat: "const b = 'var s = 0;' + ' s += n;' + ' return s;'; console.log(new Function('n', b)(5));",
  template: "const op = '*'; console.log(new Function('x', `return x ${op} 3`)(5));",
  joined: "console.log(new Function('n', ['var o = [];', 'for (var i = 0; i < n; i++) o.push(i);', 'return o.join(\"-\");'].join('\\n'))(4));",
  hole: "function g(k) { return new Function('o', 'return o[' + JSON.stringify(k) + ']'); } console.log(g('a\"b')({ 'a\"b': 1 }), g('z')({ z: 2 }));",
  holeConst: "function g(k) { const t = JSON.stringify(k); return new Function('return ' + t); } console.log(g('s')(), g(3)(), g(null)(), g([1, 2])());",
  holeUndefined: "function g(k) { return new Function('return ' + JSON.stringify(k)); } console.log(g(undefined)() === undefined);",
  choice: "function g(kind) { const r = kind === 'a' ? 'return 1;' : 'return 2;'; return new Function(r); } console.log(g('a')(), g('b')());",
  choice2: "function g(p, q) { return new Function('x', 'return x' + (p ? ' + 1' : '') + (q ? ' * 2' : '')); } console.log(g(0, 0)(5), g(1, 0)(5), g(0, 1)(5), g(1, 1)(5));",
  freshObject: "const k = new Function('return JSON.stringify({a:1})'); console.log(k(), new Function('return 1') === new Function('return 1'));",
  globalsOnly: "const f = new Function('v', 'return Math.max(v, 3) + String(v).length'); console.log(f(10));",
};

describe("functionCtorEdits (through jsDesugar)", () => {
  for (const [name, src] of Object.entries(CASES)) {
    test(`${name}: rewritten, and prints what the original prints`, () => {
      const out = run(src);
      expect(out, "the site was not rewritten").not.toBeNull();
      expect(out).not.toMatch(/\bnew Function\b|\bFunction\s*\(|Function\.apply/);
      expect(exec(out!)).toBe(exec(src));
    });
  }

  test("positive control: the matcher for 'still contains a Function constructor' fires on an unrewritten site", () => {
    const src = "function f(t) { return new Function(t); }";
    expect(run(src)).toBeNull();
    expect(src).toMatch(/\bnew Function\b/);
  });

  test("text that does not fold is left for the SC2020 refusal", () => {
    expect(run("function f(t) { return new Function(t); }")).toBeNull();
    expect(run("function f(t) { return new Function('return ' + t); }")).toBeNull();
    expect(run("function f(t) { return new Function('return ' + String(t)); }")).toBeNull();
    expect(run("function f(t) { return new Function('return ' + `${t}`); }")).toBeNull();
    expect(run("function f(ks, s) { return Function.apply(null, ks.concat(s)); }")).toBeNull();
    expect(run("function f() { let s = 'return 1'; s += ';'; return new Function(s); }")).toBeNull();
  });

  test("a syntax error Node would throw at run time is not deferred", () => {
    expect(run("new Function('return (');")).toBeNull();
    expect(run("new Function('a b', 'return 1');")).toBeNull();
    // a body cannot close the function it is in
    expect(run("new Function('}); console.log(1); (function () {');")).toBeNull();
  });

  test("a free name that resolves to a local at the site is refused (Function bodies see globals only)", () => {
    expect(run("const x = 1; const f = new Function('return x');")).toBeNull();
    expect(run("function g(y) { return new Function('return y'); }")).toBeNull();
    expect(run("const f = new Function('return require(\"fs\")');")).toBeNull();
    // the same name bound INSIDE the new function is not free
    expect(run("const x = 1; const f = new Function('x', 'return x');")).not.toBeNull();
    expect(run("const x = 1; const f = new Function('var x = 2; return x');")).not.toBeNull();
    // a global that no local shadows is fine
    expect(run("const f = new Function('return Math.PI');")).not.toBeNull();
  });

  test("a hole is only accepted in expression position", () => {
    expect(run("function g(k) { return new Function('return {' + JSON.stringify(k) + ': 1}'); }")).toBeNull();
    expect(run("function g(k) { return new Function('return \"' + JSON.stringify(k) + '\"'); }")).toBeNull();
    expect(run("function g(k) { return new Function('o', 'o.' + JSON.stringify(k)); }")).toBeNull();
  });

  test("a hole reached through a const must be stable", () => {
    expect(run("function g(o) { const t = JSON.stringify(o.k); return new Function('return ' + t); }")).toBeNull();
    expect(run("function g(k) { const t = JSON.stringify(k); k = 2; return new Function('return ' + t); }")).toBeNull();
    expect(run("function g(k) { const t = JSON.stringify(k); return new Function('return ' + t); }")).not.toBeNull();
  });

  test("a choice over a condition with a call is not a build-time choice", () => {
    expect(run("function g(f) { return new Function(f() ? 'return 1' : 'return 2'); }")).toBeNull();
  });

  test("Function or JSON rebound in the file: nothing is rewritten", () => {
    expect(run("function Function(a) { return a; } new Function('return 1');")).toBeNull();
    expect(run("const JSON = { stringify: (x) => x }; function g(k) { return new Function('return ' + JSON.stringify(k)); }")).toBeNull();
  });

  test("only .js/.cjs files", () => {
    expect(jsDesugar("/p/m.ts", "new Function('return 1');")).toBeNull();
  });
});
