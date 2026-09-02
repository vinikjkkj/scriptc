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
