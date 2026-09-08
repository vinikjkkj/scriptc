/* The module namespace as a FIRST-CLASS VALUE, differential against Node,
 * and the three refusals that keep it from answering almost-right.
 *
 * WHY THIS FILE EXISTS AT ALL. `staticDynNsBuilderOf` (lower-island.ts) is
 * the one path in the static lane that materializes a namespace object.
 * Nothing in the corpus reaches it — every corpus `import()` is either
 * --dynamic or the const-binding shape the STATEMENT tier claims first —
 * and so it sat with a hard C-compile failure in it: the builder was
 * pushed with an empty `captures` array, which marks a lifted CLOSURE, and
 * the call site emits a direct call, so `zig cc` said "too few arguments
 * to function call, single argument 'sc_env' was not specified". A path
 * with no test is a path that does not compile.
 *
 * WHY EVERY CELL IS HERE. With the call fixed, the value it produced was
 * measured against node v25.9.0 and was WRONG in four independent ways,
 * all silent, all at exit 0:
 *
 *   - a `let` export read its value AT IMPORT, where Node's namespace
 *     property is a LIVE view of the exporter's binding;
 *   - `ns.k = 1` succeeded and read back, where Node throws TypeError;
 *   - `delete ns.k` succeeded, where Node throws TypeError (and then
 *     Object.keys was short by one, which is how it was first noticed);
 *   - two `import()`s of one module compared `!==`, where Node answers
 *     the SAME object.
 *
 * Each of those is a row below. The reading and enumerating half is the
 * rest: those cells are what a checked-dynamic object CAN be, and a
 * regression there looks like a working feature until one of them runs.
 *
 * BOTH BACKENDS, because the LLVM lane carries its own dynObjLit emit and
 * would not have carried the namespace mark on its own.
 *
 * THE SECOND HALF of this file is the CommonJS `export =` shape — the one
 * --npm-static's own rewrite emits — which every package above is not, and
 * which was silently wrong in a fifth way: the namespace had ONE key where
 * Node has five, and the two shared none. Its own section header carries
 * the measurement.
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    strict: true,
    module: "nodenext",
    moduleResolution: "nodenext",
    target: "es2022",
    lib: ["es2023", "dom"],
  },
  include: ["*.ts"],
});

interface Run {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function run(cmd: string, args: string[], cwd: string): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`module-ns-value fixture timed out\nstderr:\n${err}`));
    }, 180_000);
    child.stdout.on("data", (c: Buffer) => (out += c.toString("utf8")));
    child.stderr.on("data", (c: Buffer) => (err += c.toString("utf8")));
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (signal) {
        reject(new Error(`module-ns-value fixture died to ${signal}\n${out}\n${err}`));
        return;
      }
      resolve({ stdout: out, stderr: err, exitCode: code ?? 0 });
    });
  });
}

function stage(root: string, name: string, files: Record<string, string>): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  for (const [f, body] of Object.entries(files)) {
    const p = join(dir, f);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body, "utf8");
  }
  writeFileSync(join(dir, "tsconfig.json"), TSCONFIG, "utf8");
  return dir;
}

/** One package in the fixture's own node_modules, opted into --npm-static.
 * A bare specifier is what reaches the namespace BUILDER — a relative one
 * is a program module, whose `import()` the const-binding statement tier
 * claims before any value is built. */
function pkg(name: string, js: string, dts: string): Record<string, string> {
  return {
    [`node_modules/${name}/package.json`]: JSON.stringify(
      {
        name,
        version: "1.0.0",
        type: "module",
        main: "./dist/index.js",
        types: "./dist/index.d.ts",
        exports: { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } },
      },
      null,
      2,
    ),
    [`node_modules/${name}/dist/index.js`]: js,
    [`node_modules/${name}/dist/index.d.ts`]: dts,
  };
}

/* A package with NO mutable export — the class the snapshot can serve.
 * `n` is module-private and reachable only through exported FUNCTIONS,
 * which is the live read that DOES work: the function reads the module's
 * own storage, so it needs no namespace property to be live. */
const PURE = pkg(
  "purelib",
  [
    `export const konst = 1;`,
    `export function fn() { return 7; }`,
    `export class K { constructor() { this.v = 3; } }`,
    `let n = 0;`,
    `export function bump() { n++; }`,
    `export function reads() { return n; }`,
    `export default "theDefault";`,
    ``,
  ].join("\n"),
  [
    `export declare const konst: number;`,
    `export declare function fn(): number;`,
    `export declare class K { v: number }`,
    `export declare function bump(): void;`,
    `export declare function reads(): number;`,
    `declare const _default: string;`,
    `export default _default;`,
    ``,
  ].join("\n"),
);

/* The namespace is held in an `any` binding before it is used: that is the
 * shape a program that STORES a namespace has, and the shape past which no
 * type-directed fence can fire. Reaching the builder at all needs a
 * position the const-binding tier does NOT claim — `.then()` is the one
 * zapo's own codec writes. */
const MAIN = [
  `export {};`,
  `let held: any = null;`,
  `await import("purelib").then((mod: unknown) => { held = mod; });`,
  `console.log("typeof", typeof held);`,
  `console.log("keys", Object.keys(held).join(","));`,
  `console.log("missingtype", typeof held.nope);`,
  `console.log("missingin", "nope" in held);`,
  `console.log("hasin", "konst" in held);`,
  `console.log("memtypes", typeof held.fn + "/" + typeof held.K + "/" + typeof held.konst);`,
  `console.log("default", String(held.default));`,
  `console.log("esmodule", "__esModule" in held);`,
  `console.log("json", JSON.stringify(held));`,
  `console.log("callmember", held.fn());`,
  `console.log("reads0", held.reads());`,
  `held.bump();`,
  `console.log("readsLIVE", held.reads());`,
  `console.log("passed", ((x: any): string => Object.keys(x).length + ":" + typeof x.fn)(held));`,
  ``,
  `// Node answers the SAME namespace object for every import of one`,
  `// module. Two fresh literals compare false; the interned one does not.`,
  `let held2: any = null;`,
  `await import("purelib").then((mod: unknown) => { held2 = mod; });`,
  `console.log("identity", held2 === held);`,
  ``,
].join("\n");

let workDir = "";
let fixtureDir = "";
let nodeRun: Run | null = null;

beforeAll(async () => {
  workDir = mkdtempSync(join(tmpdir(), "scriptc-module-ns-value-"));
  fixtureDir = stage(workDir, "nsv", { ...PURE, "main.ts": MAIN });
  nodeRun = await run(process.execPath, [join(fixtureDir, "main.ts")], fixtureDir);
}, 600_000);

function compareCells(backend: string, expected: Run, actual: Run): void {
  const keyOf = (l: string): string => l.split(" ")[0] ?? "";
  const actualLines = actual.stdout.split("\n");
  for (const line of expected.stdout.split("\n")) {
    const key = keyOf(line);
    if (key === "") continue;
    const mine = actualLines.find((l) => keyOf(l) === key);
    expect(mine, `${backend}: '${key}' never ran (Node answered: ${line})`).toBeDefined();
    expect(mine, `${backend}: '${key}' differs from Node`).toBe(line);
  }
  expect(actual.stdout).toBe(expected.stdout);
  expect(actual.exitCode).toBe(expected.exitCode);
}

describe("a compiled module's namespace as a first-class value", () => {
  test("Node ran the fixture at all", () => {
    expect(nodeRun, "beforeAll never produced a Node run").not.toBeNull();
    expect(nodeRun!.stderr, `Node refused the fixture:\n${nodeRun!.stderr}`).toBe("");
    expect(nodeRun!.exitCode).toBe(0);
    // A green comparison against an EMPTY oracle proves nothing.
    expect(nodeRun!.stdout.split("\n").filter((l) => l !== "").length).toBeGreaterThan(13);
    // The two cells the value was silently wrong on before this row existed.
    expect(nodeRun!.stdout).toContain("readsLIVE 1");
    expect(nodeRun!.stdout).toContain("identity true");
  });

  for (const backend of ["c", "llvm"] as const) {
    test(`${backend}: every cell is Node's bytes`, async () => {
      const exe = join(fixtureDir, exeName(`nsv-${backend}`));
      const built = await compile(join(fixtureDir, "main.ts"), {
        outPath: exe,
        outDir: fixtureDir,
        backend,
        npmStatic: ["purelib"],
      });
      expect(
        built.ok,
        `compile refused:\n${(built.diagnostics ?? []).map((d) => `${d.code} ${d.message}`).join("\n")}`,
      ).toBe(true);
      const got = await run(exe, [], fixtureDir);
      compareCells(backend, nodeRun!, got);
    }, 900_000);
  }
});

/* ------------------------------------------------------------- boundaries */

describe("the three cells a snapshot cannot be, and how each refuses", () => {
  test("a MUTABLE export refuses the whole namespace VALUE, and says why", async () => {
    const dir = stage(workDir, "live", {
      ...pkg(
        "livelib",
        `export const konst = 1;\nexport let counter = 0;\nexport function bump() { counter++; }\n`,
        `export declare const konst: number;\nexport declare let counter: number;\nexport declare function bump(): void;\n`,
      ),
      "main.ts": [
        `export {};`,
        `let held: any = null;`,
        `await import("livelib").then((mod: unknown) => { held = mod; });`,
        `console.log(typeof held);`,
        ``,
      ].join("\n"),
    });
    const built = await compile(join(dir, "main.ts"), {
      outPath: join(dir, exeName("live")),
      outDir: dir,
      backend: "c",
      npmStatic: ["livelib"],
    });
    expect(built.ok, "a namespace over a `let` export must not build").toBe(false);
    const diags = built.diagnostics ?? [];
    expect(diags.map((d) => d.code)).toContain("SC1013");
    const text = diags.map((d) => `${d.message}\n${d.hint ?? ""}`).join("\n");
    // It must name the EXPORT, not just the module...
    expect(text).toContain("'counter'");
    // ...and say what is missing, rather than only "not yet".
    expect(text).toContain("LIVE view");
    // The refusal must be a DIAGNOSTIC, never the ICE it was first:
    // raised after the builder name was registered, the aborted body left
    // the call site naming a function nothing pushed.
    expect(diags.map((d) => d.code), "a refusal here must not be an ICE").not.toContain("SC9001");
  }, 600_000);

  for (const [what, stmt] of [
    ["assigning", `held.konst = 99;`],
    ["deleting", `delete held.konst;`],
  ] as const) {
    test(`${what} a namespace property refuses loudly instead of landing on the snapshot`, async () => {
      const dir = stage(workDir, `mut-${what}`, {
        ...PURE,
        "main.ts": [
          `export {};`,
          `let held: any = null;`,
          `await import("purelib").then((mod: unknown) => { held = mod; });`,
          `try { ${stmt} console.log("outcome", "no-throw"); }`,
          `catch (e) { console.log("outcome", "threw"); console.log("msg", (e as Error).message); }`,
          `console.log("konst", held.konst);`,
          `console.log("keys", Object.keys(held).join(","));`,
          ``,
        ].join("\n"),
      });
      const built = await compile(join(dir, "main.ts"), {
        outPath: join(dir, exeName(`mut-${what}`)),
        outDir: dir,
        backend: "c",
        npmStatic: ["purelib"],
      });
      expect(
        built.ok,
        `compile refused:\n${(built.diagnostics ?? []).map((d) => `${d.code} ${d.message}`).join("\n")}`,
      ).toBe(true);
      const got = await run(join(dir, exeName(`mut-${what}`)), [], dir);
      // Node throws a TypeError here and this build throws its own refusal:
      // a DIVERGENCE, named. What must never happen is the write landing.
      expect(got.stdout, "the mutation must not be accepted").toContain("outcome threw");
      expect(got.stdout, "the refusal must name the namespace").toContain("module namespace object");
      // ...and the object must be untouched afterwards, exactly as in Node.
      expect(got.stdout).toContain("konst 1");
      expect(got.stdout).toContain("keys K,bump,default,fn,konst,reads");
    }, 900_000);
  }
});

/* ------------------------------------------------------- the CJS barrel */

/* THE SHAPE `--npm-static`'S OWN REWRITE EMITS, and the one every package
 * above is not. Every fixture in this file so far is ESM SOURCE, where
 * `getExports()` carries one symbol per exported name and the builder had
 * only to read it. A CommonJS `export =` module carries exactly ONE —
 * `export=` — so the same walk built a namespace of `default` alone, and
 * `default` resolved to no global, so it crossed as a TRAP function.
 *
 * Measured on the parent of this change against node v25.9.0, on this repo's own
 * `gtdefine` fixture: node answered `WIDTH,__esModule,default,leaf,
 * module.exports` and the compiled namespace answered `default` — the two
 * shared NO key — with the build green, npmStatic status "static", zero
 * diagnostics, exit 0. `tests/fixtures/npm/cases/npmstatic-dynimport-cjs`
 * is the two-line repro; this is the cell-for-cell pin.
 *
 * The package below is the `Object.defineProperty(exports, 'n', { get })`
 * family — what tsc emits for a re-exporting barrel, and what
 * npm-static-rewrite.ts rewrites into `module.exports = { ... }`. It is
 * staged here rather than borrowed from tests/fixtures/npm because this
 * file compares against a NODE run of the same tree and needs the package
 * resolvable from its own workdir.
 *
 * `module.exports` is a namespace key on node v25 and newer ONLY
 * (measured: present on v25.2.1/v25.9.0/v26.7.0, absent on
 * v20.20.2/v21.6.2/v22.18.0). It is compared against the Node this suite
 * SPAWNS, which is the Node this repository gates under — the rule
 * sqlite-dynimport.test.ts states for the same alias key. Under an older
 * Node the `keys` cell reads as a regression that is really an oracle
 * swap. */
function cjsPkg(name: string, files: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {
    [`node_modules/${name}/package.json`]: JSON.stringify(
      { name, version: "1.0.0", main: "./dist/index.js", types: "./dist/index.d.ts" },
      null,
      2,
    ),
  };
  for (const [f, body] of Object.entries(files)) out[`node_modules/${name}/${f}`] = body;
  return out;
}

const BARREL = cjsPkg("cjsbarrel", {
  "dist/leaf.js": [
    `"use strict";`,
    `Object.defineProperty(exports, "__esModule", { value: true });`,
    `exports.leaf = void 0;`,
    `function leaf() { return "leafy"; }`,
    `exports.leaf = leaf;`,
    ``,
  ].join("\n"),
  "dist/leaf.d.ts": `export declare function leaf(): string;\n`,
  "dist/index.js": [
    `"use strict";`,
    `Object.defineProperty(exports, "__esModule", { value: true });`,
    `exports.WIDTH = void 0;`,
    `var leaf_1 = require("./leaf.js");`,
    `Object.defineProperty(exports, "leaf", { enumerable: true, get: function () { return leaf_1.leaf; } });`,
    `exports.WIDTH = 7;`,
    ``,
  ].join("\n"),
  "dist/index.d.ts": `export declare function leaf(): string;\nexport declare const WIDTH: number;\n`,
});

/* Every cell the ESM fixture pins, plus the three the CJS interop adds:
 * `default` is the module.exports OBJECT (not a function — the trap it
 * used to be answered "function", which is the arm a `typeof candidate
 * === 'function'` driver probe takes), the `module.exports` alias is the
 * SAME object as `default`, and one name read through either is one
 * value. */
const BARREL_MAIN = [
  `export {};`,
  `let held: any = null;`,
  `await import("cjsbarrel").then((mod: unknown) => { held = mod; });`,
  `console.log("typeof", typeof held);`,
  `console.log("keys", Object.keys(held).join(","));`,
  `console.log("memtypes", typeof held.leaf + "/" + typeof held.WIDTH + "/" + typeof held.__esModule);`,
  `console.log("call", held.leaf());`,
  `console.log("width", String(held.WIDTH));`,
  `console.log("esmodule", String(held.__esModule));`,
  `console.log("missingtype", typeof held.nope);`,
  `console.log("missingin", "nope" in held);`,
  `console.log("hasin", "leaf" in held);`,
  `console.log("defaulttype", typeof held.default);`,
  `console.log("defaultleaf", typeof held.default.leaf);`,
  `console.log("defaultcall", held.default.leaf());`,
  `console.log("alias", String(held.default === held["module.exports"]));`,
  `console.log("samefn", String(held.leaf === held.default.leaf));`,
  `console.log("passed", ((x: any): string => Object.keys(x).length + ":" + typeof x.leaf)(held));`,
  ``,
  `let held2: any = null;`,
  `await import("cjsbarrel").then((mod: unknown) => { held2 = mod; });`,
  `console.log("identity", String(held2 === held));`,
  ``,
].join("\n");

describe("a CommonJS `export =` package's namespace — the shape --npm-static rewrites", () => {
  let barrelDir = "";
  let barrelNode: Run | null = null;

  beforeAll(async () => {
    barrelDir = stage(workDir, "nsv-cjs", { ...BARREL, "main.ts": BARREL_MAIN });
    barrelNode = await run(process.execPath, [join(barrelDir, "main.ts")], barrelDir);
  }, 600_000);

  test("Node ran the fixture at all", () => {
    expect(barrelNode, "beforeAll never produced a Node run").not.toBeNull();
    expect(barrelNode!.exitCode, `Node refused the fixture:\n${barrelNode!.stderr}`).toBe(0);
    // A green comparison against an EMPTY oracle proves nothing.
    expect(barrelNode!.stdout.split("\n").filter((l) => l !== "").length).toBeGreaterThan(15);
    // The cells the compiled namespace was silently wrong on, written out
    // rather than only compared — so a wrong ORACLE is visible here too.
    expect(barrelNode!.stdout).toContain("keys WIDTH,__esModule,default,leaf,module.exports");
    expect(barrelNode!.stdout).toContain("memtypes function/number/boolean");
    expect(barrelNode!.stdout).toContain("defaulttype object");
    expect(barrelNode!.stdout).toContain("alias true");
    expect(barrelNode!.stdout).toContain("samefn true");
  });

  for (const backend of ["c", "llvm"] as const) {
    test(`${backend}: every cell is Node's bytes`, async () => {
      const exe = join(barrelDir, exeName(`nsvcjs-${backend}`));
      const built = await compile(join(barrelDir, "main.ts"), {
        outPath: exe,
        outDir: barrelDir,
        backend,
        npmStatic: ["cjsbarrel"],
      });
      expect(
        built.ok,
        `compile refused:\n${(built.diagnostics ?? []).map((d) => `${d.code} ${d.message}`).join("\n")}`,
      ).toBe(true);
      const got = await run(exe, [], barrelDir);
      compareCells(backend, barrelNode!, got);
    }, 900_000);
  }
});

/* The half that is a REFUSAL, and must stay one. A CJS namespace's name
 * set is Node's LEXER's, and this build reads it off the canonical export
 * table --npm-static's rewrite appends. A `module.exports =` that is not
 * a table — the forwarding form `module.exports = require("./x")` is the
 * common one — has no table to read, so the namespace would be SHORT:
 * `undefined` for a name Node answers, silently, which is the defect this
 * whole section exists for. moduleNsOwnKeys (lower-namespaces.ts) already
 * refuses the same question for `Object.keys` on the same rule, and so
 * does the `export *` arm of the builder itself. A PRICE LIST, not a
 * match: Node loads this package and answers every name. */
describe("a CJS module.exports the table cannot be read off refuses by name", () => {
  test("a forwarding `module.exports = require(...)` entry does not build a namespace", async () => {
    const dir = stage(workDir, "nsv-cjs-fwd", {
      ...cjsPkg("cjsforward", {
        "dist/core.js": `"use strict";\nexports.alpha = "alpha";\n`,
        "dist/core.d.ts": `export declare const alpha: string;\n`,
        "dist/index.js": `"use strict";\nmodule.exports = require("./core.js");\n`,
        "dist/index.d.ts": `export declare const alpha: string;\n`,
      }),
      // The cast position, not the `.then` one every case above uses: a
      // forwarding entry's INFERRED type carries `default: typeof
      // import(...)`, and `.then` over that is SC2020 ("no scriptc
      // lowering yet") before the namespace builder is ever asked — the
      // refusal under test would never be reached. Measured; this is the
      // repro fixture's own spelling.
      "main.ts": [
        `export {};`,
        `const held = (await import("cjsforward")) as unknown as Record<string, unknown>;`,
        `console.log(typeof held["alpha"]);`,
        ``,
      ].join("\n"),
    });
    const built = await compile(join(dir, "main.ts"), {
      outPath: join(dir, exeName("nsvfwd")),
      outDir: dir,
      backend: "c",
      npmStatic: ["cjsforward"],
    });
    expect(built.ok, "a namespace whose key set cannot be read must not build").toBe(false);
    const diags = built.diagnostics ?? [];
    const text = diags.map((d) => `${d.code} ${d.message}\n${d.hint ?? ""}`).join("\n");
    // It must name the MODULE and what is missing, not just "not yet"...
    expect(text).toContain("CommonJS `export =` module");
    expect(text, "the refusal must say a name would be missing").toContain("MISSING");
    // ...and it must be a diagnostic, never the ICE a refusal raised after
    // the builder name was registered would be.
    expect(diags.map((d) => d.code), "a refusal here must not be an ICE").not.toContain("SC9001");
  }, 600_000);

  /* THE CUT THAT WAS SILENTLY SHORT, and the guard that catches it. A
   * table followed by a member export — `module.exports = { … };
   * module.exports.extra = "extra";` — is ONE module.exports object to
   * Node's lexer, and a first cut of the fix read the table alone:
   * `keys default,hi,module.exports` against node's
   * `default,extra,hi,module.exports`, and `typeof ns.extra` was
   * "undefined" where node says "string", at exit 0 with no diagnostic.
   * The same silence, one shape over.
   *
   * What stops it now is Node's OWN rule as the last word: cjs-lexer.ts
   * mirrors Node's lexer, and any name it sees that the built namespace
   * does not carry refuses. This case is that guard's positive control —
   * remove the lexer check and it goes green with a short namespace. */
  test("a member export after the table refuses rather than shortening the namespace", async () => {
    const dir = stage(workDir, "nsv-cjs-member", {
      ...cjsPkg("cjsmember", {
        "dist/index.js": [
          `"use strict";`,
          `function hi() { return "hi"; }`,
          `module.exports = { hi };`,
          `module.exports.extra = "extra";`,
          ``,
        ].join("\n"),
        "dist/index.d.ts": `export declare function hi(): string;\nexport declare const extra: string;\n`,
      }),
      "main.ts": [
        `export {};`,
        `const held = (await import("cjsmember")) as unknown as Record<string, unknown>;`,
        `console.log(typeof held["extra"]);`,
        ``,
      ].join("\n"),
    });
    const built = await compile(join(dir, "main.ts"), {
      outPath: join(dir, exeName("nsvmember")),
      outDir: dir,
      backend: "c",
      npmStatic: ["cjsmember"],
    });
    expect(built.ok, "a namespace short by a lexer-visible name must not build").toBe(false);
    const text = (built.diagnostics ?? []).map((d) => `${d.code} ${d.message}`).join("\n");
    // The refusal must name the EXPORT that would have gone missing.
    expect(text).toContain("'extra'");
    expect(text).toContain("Node's CommonJS lexer sees");
  }, 600_000);

  /* THE SECOND SHAPE THE SAME GUARD CAUGHT. An `__esModule` stamp AFTER
   * the table is a namespace key to Node — `__esModule,default,hi,
   * module.exports` — and the lexer check briefly EXEMPTED `__esModule`,
   * on the reasoning that the rewrite spells it into the table whenever
   * the lexer sees it. True for a rewritten file; this file is not one,
   * and the exemption answered `default,hi,module.exports`, silently, at
   * exit 0. There is no name the guard may exempt. */
  test("an __esModule stamp after the table is a key like any other", async () => {
    const dir = stage(workDir, "nsv-cjs-esmodule", {
      ...cjsPkg("cjsstamp", {
        "dist/index.js": [
          `"use strict";`,
          `function hi() { return "hi"; }`,
          `module.exports = { hi };`,
          `Object.defineProperty(exports, "__esModule", { value: true });`,
          ``,
        ].join("\n"),
        "dist/index.d.ts": `export declare function hi(): string;\n`,
      }),
      "main.ts": [
        `export {};`,
        `const held = (await import("cjsstamp")) as unknown as Record<string, unknown>;`,
        `console.log(Object.keys(held).join(","));`,
        ``,
      ].join("\n"),
    });
    const built = await compile(join(dir, "main.ts"), {
      outPath: join(dir, exeName("nsvstamp")),
      outDir: dir,
      backend: "c",
      npmStatic: ["cjsstamp"],
    });
    expect(built.ok, "a namespace short by __esModule must not build").toBe(false);
    const text = (built.diagnostics ?? []).map((d) => `${d.code} ${d.message}`).join("\n");
    expect(text).toContain("'__esModule'");
    expect(text).toContain("Node's CommonJS lexer sees");
  }, 600_000);
});
