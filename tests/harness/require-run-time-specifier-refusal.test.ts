/* `require(<run-time specifier>)` IS A COMPILE REFUSAL.
 *
 * protobufjs's `inquire()` (shipped in zapo's `spec/proto/index.js`) is
 *
 *     function inquire(m) {
 *       try {
 *         if (typeof require !== 'function') return null;
 *         var mod = require(m);
 *         return mod && (mod.length || Object.keys(mod).length) ? mod : null;
 *       } catch (e) { }
 *       return null;
 *     }
 *
 * A require whose specifier is a RUN-TIME value would have to answer a
 * module NAMESPACE OBJECT out of a module graph that a compiled program
 * fixes at build time, so there is nothing to lower. It used to compile to a
 * fence (first catchable, which `inquire` swallowed into `null` where Node
 * answers a module, and then fatal, which ended the process when reached).
 * Either way the build gave up on the program and the program found out at
 * run time. There is no such arm any more: the build fails, on both lanes,
 * with the tagged diagnostic at the require site, and no binary exists.
 *
 * This file pins that, for every spelling the old verdict served: a builtin,
 * a 'node:' builtin, an installed package, a specifier nothing resolves, and
 * the argument-error shapes. Specifiers the BUILD decides (a written literal,
 * a const one binding away) are not in scope here: they compile, and
 * require-node-parity.test.ts compares them against Node.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";

/* CommonJS on purpose: the ambient `require` this is about exists only in a
 * CJS source. The specifier always arrives through a parameter, so it is a
 * genuine run-time value and never a string-literal type the checker can
 * fold. */
const PROGRAMS: readonly { name: string; src: string }[] = [
  {
    name: "protobufjs inquire() over a builtin",
    src: [
      "function inquire(m) {",
      "  try {",
      "    if (typeof require !== 'function') return null;",
      "    var mod = require(m);",
      "    return mod && (mod.length || Object.keys(mod).length) ? mod : null;",
      "  } catch (e) { }",
      "  return null;",
      "}",
      "console.log('buffer=' + (inquire('buffer') === null ? 'NULL' : 'module'));",
      "",
    ].join("\n"),
  },
  {
    name: "the optional-dependency idiom reading e.code",
    src: [
      "function tryRequire(spec) {",
      "  try { require(spec); return 'GOT'; }",
      "  catch (e) { return String(e.code); }",
      "}",
      "console.log('a=' + tryRequire('no-such-pkg-xyz'));",
      "console.log('f=' + tryRequire(42));",
      "",
    ].join("\n"),
  },
  {
    name: "a 'node:'-prefixed name through a parameter",
    src: [
      "function g(s) { try { return typeof require(s) } catch (e) { return e.code } }",
      "console.log(g('node:path'));",
      "",
    ].join("\n"),
  },
];

const dir = mkdtempSync(join(tmpdir(), "scriptc-reqspec-"));
const nm = join(dir, "node_modules", "scriptc-fence-fixture");
mkdirSync(nm, { recursive: true });
writeFileSync(
  join(nm, "package.json"),
  JSON.stringify({ name: "scriptc-fence-fixture", version: "1.0.0", main: "index.js" }),
  "utf8",
);
writeFileSync(join(nm, "index.js"), "module.exports = { hello: 1 };\n", "utf8");

describe.each(["c", "llvm"] as const)("the run-time-specifier require on the %s backend", (backend) => {
  test.for(PROGRAMS.map((p) => [p.name, p] as const))("%s is refused at build time", async ([, p]) => {
    const slug = p.name.replace(/[^a-z0-9]+/gi, "-").slice(0, 40);
    const src = join(dir, `${slug}-${backend}.cjs`);
    writeFileSync(src, p.src, "utf8");
    const res = await compile(src, {
      outPath: join(dir, `${slug}-${backend}`),
      outDir: join(dir, `${backend}-${slug}`),
      backend,
    });
    expect(res.ok, `${p.name}: built, so the require would be a runtime trap`).toBe(false);
    const diags = res.ok ? [] : res.diagnostics;
    const hit = diags.filter(
      (d) => d.code === "SC2020" && d.message.includes("require() with a run-time specifier"),
    );
    expect(
      hit.length,
      `${p.name}: refused, but not as the run-time specifier: ` +
        diags.map((d) => `${d.code} ${d.message.slice(0, 120)}`).join(" | "),
    ).toBeGreaterThan(0);
  }, 600_000);
});
