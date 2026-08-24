/* The ENUMERATING half of a module namespace object, differential against
 * Node, and the boundary that keeps it honest.
 *
 * THE LINE. A module namespace object has two halves that are not the same
 * question. Its KEY SET is a pure function of the module's export table —
 * `Object.keys` never reads a value — and the build holds that table
 * complete for every module in the compiled graph, so the key set folds to
 * a literal at build time. Its OBJECT is exotic: a null prototype, the
 * "Module" toStringTag, one instance per module, and a [[Set]] that always
 * fails. A checked-dynamic object is none of those, so the object keeps
 * its SC1013 fence and the fence names what is missing.
 *
 * WHY EVERY STAR CASE IS HERE. `moduleSymbol.getExports()` answers a
 * module's OWN export table: declarations, named re-exports and
 * `export * as ns` are in it, and star re-exports are NOT — the checker
 * resolves those lazily, per member access. A first cut of this row read
 * the key set off `getExports()` alone and shipped a SHORT list at exit 0
 * with no diagnostic: `export * from "./a"` lost every one of a's names,
 * and a two-hop chain lost all of them. Four cells, both backends, silent.
 * The walk in lower-namespaces.ts is what fixed it, and these cases are
 * what keep it fixed — a regression there looks exactly like a working
 * feature until one of them runs.
 *
 * The three Node rules each get their own case because each is a
 * different way to be wrong: `default` is never re-exported by a star, a
 * LOCAL export shadows a starred one of the same name, and a re-export
 * cycle terminates.
 *
 * BOTH BACKENDS, because the LLVM lane keeps its own bookkeeping and has
 * shipped wrong while the C twin was right.
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
      reject(new Error(`module-ns-keys fixture timed out\nstderr:\n${err}`));
    }, 180_000);
    child.stdout.on("data", (c: Buffer) => (out += c.toString("utf8")));
    child.stderr.on("data", (c: Buffer) => (err += c.toString("utf8")));
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (signal) {
        reject(new Error(`module-ns-keys fixture died to ${signal}\n${out}\n${err}`));
        return;
      }
      resolve({ stdout: out, stderr: err, exitCode: code ?? 0 });
    });
  });
}

/** Lays a multi-file fixture down in its own directory with a tsconfig —
 * NOT under node_modules, where Node refuses to strip types and the Node
 * lane would answer an EMPTY stdout that every comparison then passes. */
function stage(root: string, name: string, files: Record<string, string>): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  for (const [f, body] of Object.entries(files)) writeFileSync(join(dir, f), body, "utf8");
  writeFileSync(join(dir, "tsconfig.json"), TSCONFIG, "utf8");
  return dir;
}

/** Compiles one fixture and answers its diagnostic codes and messages —
 * the boundary rows below assert on these. */
async function refusal(
  root: string,
  name: string,
  files: Record<string, string>,
): Promise<{ codes: string[]; text: string }> {
  const dir = stage(root, name, files);
  const built = await compile(join(dir, "main.ts"), {
    outPath: join(dir, exeName("program")),
    outDir: dir,
    backend: "c",
  });
  if (built.ok) return { codes: [], text: "" };
  const diags = built.diagnostics ?? [];
  return {
    codes: diags.map((d) => d.code),
    // The HINT is where a refusal says what is missing, so it is part of
    // the text these rows assert on.
    text: diags.map((d) => `${d.message}\n${d.hint ?? ""}`).join("\n"),
  };
}

/* ---------------------------------------------------------------- fixture */

/* One program that exercises every shape the fold has to get right, each
 * on its own keyed line so a failure names the case rather than dumping
 * the stream. `m.ts` is deliberately the hardest module the row admits:
 * a local const, a function, a class, a default, a named re-export, an
 * `export * as ns`, a type-only export that must ERASE, and a star chain
 * two hops deep whose near hop shadows one of the far hop's names. */
const FIXTURE: Record<string, string> = {
  "deep.ts": `export const deep = "D";\nexport const shadowed = "from-deep";\n`,
  "mid.ts": `export * from "./deep.ts";\nexport const shadowed = "from-mid";\nexport const mid = "M";\n`,
  "sub.ts": `export const inner = 1;\n`,
  "named.ts": `export const two = 2;\nexport default "namedDefault";\n`,
  "m.ts": [
    `export * from "./mid.ts";`,
    `export { two as alias } from "./named.ts";`,
    `export * as sub from "./sub.ts";`,
    `export const konst = 1;`,
    `export function fn(): number { return 7; }`,
    `export class K { v = 3; }`,
    `export type OnlyAType = number;`,
    `export interface OnlyAnInterface { a: number }`,
    `export default "theDefault";`,
    ``,
  ].join("\n"),
  "empty.ts": `export {};\n`,
  "cyc-a.ts": `export * from "./cyc-b.ts";\nexport const inA = 1;\n`,
  "cyc-b.ts": `export * from "./cyc-a.ts";\nexport const inB = 2;\n`,
  "main.ts": [
    `import * as ns from "./m.ts";`,
    `import * as em from "./empty.ts";`,
    `import * as cyc from "./cyc-a.ts";`,
    ``,
    `// The whole key set, in Node's order. Node sorts a namespace's keys by`,
    `// code unit; the fold sorts the same way, so this line is the sort too.`,
    `console.log("keys", Object.keys(ns).join(","));`,
    ``,
    `// getOwnPropertyNames answers the SAME list — a namespace has no`,
    `// non-enumerable own string key (its one extra own key is a symbol).`,
    `console.log("gopn", Object.getOwnPropertyNames(ns).join(","));`,
    ``,
    `// A star never re-exports 'default': ./named.ts has one and it must not`,
    `// appear, while the module's OWN default must.`,
    `console.log("hasdefault", Object.keys(ns).includes("default"));`,
    `console.log("nonameddefault", Object.keys(ns).filter((k) => k === "namedDefault").length);`,
    ``,
    `// A near star hop shadows a far one: ./mid.ts re-exports ./deep.ts and`,
    `// declares 'shadowed' itself, so the value is mid's.`,
    `console.log("shadowed", ns.shadowed);`,
    ``,
    `// A re-export CYCLE terminates and lists both sides.`,
    `console.log("cycle", Object.keys(cyc).join(","));`,
    ``,
    `// The empty module: the protobufjs inquire() predicate, whose whole`,
    `// question is Object.keys(m).length, answers "null" for it and`,
    `// "module" for a populated one.`,
    `console.log("inquireempty", Object.keys(em).length ? "module" : "null");`,
    `console.log("inquirefull", Object.keys(ns).length ? "module" : "null");`,
    ``,
    `// The fold is a VALUE, not a special form: it flows into an array`,
    `// binding, a length, an includes, and a second read of the same`,
    `// namespace in one expression.`,
    `const ks: string[] = Object.keys(ns);`,
    `console.log("len", ks.length, Object.keys(ns).length);`,
    `console.log("firstlast", ks[0], ks[ks.length - 1]);`,
    ``,
    `// The NO-OVER-FIRE control: an ordinary record's keys are unchanged.`,
    `const rec = { b: 1, a: 2 };`,
    `console.log("record", Object.keys(rec).join(","));`,
    ``,
  ].join("\n"),
};

let workDir = "";
let fixtureDir = "";
let nodeRun: Run | null = null;

beforeAll(async () => {
  workDir = mkdtempSync(join(tmpdir(), "scriptc-module-ns-keys-"));
  fixtureDir = stage(workDir, "ns", FIXTURE);
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

describe("a compiled module's namespace: the key set", () => {
  test("Node ran the fixture at all", () => {
    expect(nodeRun, "beforeAll never produced a Node run").not.toBeNull();
    expect(nodeRun!.stderr, `Node refused the fixture:\n${nodeRun!.stderr}`).toBe("");
    expect(nodeRun!.exitCode).toBe(0);
    // A green comparison against an EMPTY oracle proves nothing.
    expect(nodeRun!.stdout.split("\n").filter((l) => l !== "").length).toBeGreaterThan(9);
  });

  for (const backend of ["c", "llvm"] as const) {
    test(`${backend}: every cell is Node's bytes`, async () => {
      const exe = join(fixtureDir, exeName(`ns-${backend}`));
      const built = await compile(join(fixtureDir, "main.ts"), {
        outPath: exe,
        outDir: fixtureDir,
        backend,
      });
      expect(
        built.ok,
        `compile refused:\n${(built.diagnostics ?? []).map((d) => `${d.code} ${d.message}`).join("\n")}`,
      ).toBe(true);
      const got = await run(exe, [], fixtureDir);
      compareCells(backend, nodeRun!, got);
    }, 600_000);
  }
});

/* --------------------------------------- the SAME omission, the other path */

/* The dynamic-import namespace is built by the same enumeration, and on
 * main it dropped starred names SILENTLY: `ns.starred` read `undefined`
 * where Node answers the value, at exit 0, with no diagnostic. That is a
 * different surface from Object.keys (an engine-marshalled object, only
 * under --dynamic) reached through the same one-line mistake, so it gets
 * its own row rather than trusting that one fix covered both. */
describe("a dynamic-import namespace carries its export-star names too", () => {
  const DYN_FIXTURE: Record<string, string> = {
    "a.ts": `export const starred = "S";\n`,
    "m.ts": `export * from "./a.ts";\nexport const local = 1;\n`,
    "main.ts": [
      `// @dynamic`,
      `import { local } from "./m.ts";`,
      `const MOD = "./m.ts";`,
      `const ns = await import(MOD);`,
      `console.log("static", local);`,
      `console.log("starred", (ns as Record<string, unknown>)["starred"]);`,
      `console.log("local", (ns as Record<string, unknown>)["local"]);`,
      ``,
    ].join("\n"),
  };

  test("c: the starred binding is the value, not undefined", async () => {
    const dir = stage(workDir, "dynstar", DYN_FIXTURE);
    const nodeSide = await run(process.execPath, [join(dir, "main.ts")], dir);
    expect(nodeSide.stdout).toContain("starred S");
    const exe = join(dir, exeName("dynstar"));
    const built = await compile(join(dir, "main.ts"), {
      outPath: exe,
      outDir: dir,
      backend: "c",
      dynamic: true,
    });
    expect(
      built.ok,
      `compile refused:\n${(built.diagnostics ?? []).map((d) => `${d.code} ${d.message}`).join("\n")}`,
    ).toBe(true);
    const got = await run(exe, [], dir);
    compareCells("c", nodeSide, got);
  }, 900_000);
});

/* ------------------------------------------------------------- boundaries */

describe("the OBJECT still refuses, and the refusal says what is missing", () => {
  test("the bare namespace as a value keeps SC1013, and names the residue", async () => {
    const r = await refusal(workDir, "bare", {
      "m.ts": `export const konst = 1;\n`,
      "main.ts": `import * as ns from "./m.ts";\nconst grabbed: unknown = ns;\nconsole.log(grabbed);\n`,
    });
    expect(r.codes).toContain("SC1013");
    // The refusal must point at the half that DOES compile...
    expect(r.text).toContain("Object.keys(ns)");
    // ...and name the half that does not, rather than saying only "not yet".
    expect(r.text).toContain("null prototype");
  }, 300_000);

  test("Object.values and Object.entries stay fenced — they read every export's VALUE", async () => {
    for (const member of ["values", "entries"]) {
      const r = await refusal(workDir, `obj-${member}`, {
        "m.ts": `export const konst = 1;\n`,
        "main.ts": `import * as ns from "./m.ts";\nconsole.log(Object.${member}(ns).length);\n`,
      });
      expect(r.codes, `Object.${member} must still refuse`).toContain("SC1013");
    }
  }, 600_000);

  test("an export that resolves into a module the build did not compile refuses the WHOLE call", async () => {
    // `export * from "node:path"` is a re-export from a builtin: the names
    // would come from a .d.ts, which is a claim about a module this program
    // does not contain. The whole key set refuses rather than shortening.
    const r = await refusal(workDir, "star-builtin", {
      "m.ts": `export const konst = 1;\nexport * from "node:path";\n`,
      "main.ts": `import * as ns from "./m.ts";\nconsole.log(Object.keys(ns).length);\n`,
    });
    expect(r.codes.length).toBeGreaterThan(0);
    expect(r.codes.some((c) => c === "SC1013" || c === "SC1014")).toBe(true);
  }, 300_000);

  test("the no-over-fire control: a BUILTIN namespace is not this row's", async () => {
    // `import * as path from "node:path"` is a stdlib namespace, and
    // moduleNsSourceFileOf answers null for it — its own chokepoints keep
    // ownership. Widening this row to builtins would answer a key set from
    // the compiler's tables where Node answers its own.
    const r = await refusal(workDir, "builtin-ns", {
      "main.ts": `import * as path from "node:path";\nconsole.log(Object.keys(path).length);\n`,
    });
    expect(r.codes.length, "a builtin namespace must not fold through this row").toBeGreaterThan(0);
  }, 300_000);
});
