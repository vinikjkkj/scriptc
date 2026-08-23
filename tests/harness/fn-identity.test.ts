/* What a FUNCTION IS, as a value: identity, `.name`, `.length` — against
 * Node, on BOTH backends, plus the wall the family stops at.
 *
 * THREE THINGS THIS FILE EXISTS TO KEEP FROM COMING BACK.
 *
 * 1. `g.bind(null) === g` answered `true`. A bound function is a NEW
 *    function object in every engine. The TypeScript arm of
 *    `Function.prototype.bind` was an ERASURE — it compiled to the target
 *    itself — so a bound function equalled its target, two separate binds
 *    equalled each other, and a bound function stored in a record equalled
 *    the original. Nothing said so: an erasure emits no trap, so the trap
 *    census could not see it and never will. Only a running program
 *    compared against Node can.
 *
 * 2. `g.name` and `g.length` were SC2020 for EVERY function in the
 *    language. Closing that refusal is only worth anything if it does not
 *    become a wrong answer, and there are four separate ways it could:
 *    the REFERENCE-site spelling instead of the creation site (`const h =
 *    g; h.name` is `"g"`, not `"h"`); NamedEvaluation skipped (an
 *    anonymous arrow on a `const` takes the binding's name); the `"bound
 *    "` prefix missing, or not stacking on a rebind; and `length` read off
 *    the mapped TYPE instead of the erased parameter list, which answers 1
 *    for `(n: number, m?: number)` where Node answers 2. Every one of
 *    those has its own cell.
 *
 * 3. A program that DEFINES a global's name got the LIBRARY's function.
 *    At the top level of a SCRIPT `function isNaN(n) {...}` MERGES with
 *    the ambient declaration rather than shadowing it, `isStdlibSymbol`
 *    answered `.some` over the merged symbol, and six globals ran the
 *    wrong body. The fixture calls each of them.
 *
 * BOTH BACKENDS, because the LLVM lane keeps its own bookkeeping and has
 * shipped wrong while the C twin was right.
 *
 * THE BOUNDARY ROWS ARE NOT DECORATION. The name/length fold is honest
 * only because it DECLINES what it cannot prove, and a fold that quietly
 * widened to a parameter would still pass every differential cell above
 * while printing `"f"` where Node prints the caller's `"g"`. The last
 * block pins the declines.
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const repoRoot = join(import.meta.dirname, "../..");
const fixturePath = join(repoRoot, "tests/fixtures/fn-identity/pure.ts");

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
      reject(new Error(`fn-identity fixture timed out\nstderr:\n${err}`));
    }, 180_000);
    child.stdout.on("data", (c: Buffer) => (out += c.toString("utf8")));
    child.stderr.on("data", (c: Buffer) => (err += c.toString("utf8")));
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (signal) {
        reject(new Error(`fn-identity fixture died to ${signal}\n${out}\n${err}`));
        return;
      }
      resolve({ stdout: out, stderr: err, exitCode: code ?? 0 });
    });
  });
}

/** Lays a source down in its own directory with a tsconfig — NOT under
 * node_modules, where Node refuses to strip types and the Node lane would
 * answer an EMPTY stdout that every comparison then passes. */
function stage(root: string, name: string, source: string): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "main.ts"), source, "utf8");
  writeFileSync(join(dir, "tsconfig.json"), TSCONFIG, "utf8");
  return dir;
}

/** Compiles one snippet and answers its diagnostic codes — the boundary
 * rows assert on these. */
async function refusalCodes(root: string, name: string, source: string): Promise<string[]> {
  const dir = stage(root, name, source);
  const built = await compile(join(dir, "main.ts"), {
    outPath: join(dir, exeName("program")),
    outDir: dir,
    backend: "c",
  });
  if (built.ok) return [];
  return (built.diagnostics ?? []).map((d) => d.code);
}

/** Compiles a snippet that MUST compile and answers what it printed. */
async function output(root: string, name: string, source: string): Promise<string> {
  const dir = stage(root, name, source);
  const built = await compile(join(dir, "main.ts"), {
    outPath: join(dir, exeName("program")),
    outDir: dir,
    backend: "c",
  });
  expect(
    built.ok,
    `${name} must compile:\n` + (built.diagnostics ?? []).map((d) => `${d.code}: ${d.message}`).join("\n"),
  ).toBe(true);
  return (await run(built.binaryPath!, [], dir)).stdout;
}

let workDir = "";
let fixtureDir = "";
let nodeRun: Run | null = null;

beforeAll(async () => {
  workDir = mkdtempSync(join(tmpdir(), "scriptc-fn-identity-"));
  fixtureDir = stage(workDir, "pure", readFileSync(fixturePath, "utf8"));
  nodeRun = await run(process.execPath, [join(fixtureDir, "main.ts")], fixtureDir);
}, 600_000);

/** Cell by cell before the whole-stream compare, so a failure names the
 * case rather than dumping fifty lines of context. */
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

describe("a function as a value, against Node", () => {
  test("Node's own answers are the baseline, and they are complete", () => {
    expect(nodeRun, "the Node lane did not run").not.toBeNull();
    expect(nodeRun!.exitCode, `Node lane failed:\n${nodeRun!.stderr}`).toBe(0);
    const lines = nodeRun!.stdout.trimEnd().split("\n");
    expect(lines.at(-1)).toBe("END done");
    // A floor on the matrix: a fixture edited down to nothing must fail
    // here rather than report a green 3-cell comparison.
    expect(lines.length).toBeGreaterThanOrEqual(50);
    // The three answers every other cell is measured against. If Node ever
    // printed `true` for the first of these, every identity cell below
    // would be comparing two wrongs.
    expect(nodeRun!.stdout).toContain("bind-vs-target false");
    expect(nodeRun!.stdout).toContain("name-alias g");
    expect(nodeRun!.stdout).toContain("len-opt 2");
  });

  for (const backend of ["c", "llvm"] as const) {
    test(
      `${backend}: every cell matches Node`,
      async () => {
        const built = await compile(join(fixtureDir, "main.ts"), {
          outPath: join(fixtureDir, exeName(`program-${backend}`)),
          outDir: fixtureDir,
          backend,
        });
        expect(
          built.ok,
          `${backend} build failed:\n` +
            (built.diagnostics ?? []).map((d) => `${d.code}: ${d.message}`).join("\n"),
        ).toBe(true);
        compareCells(backend, nodeRun!, await run(built.binaryPath!, [], fixtureDir));
      },
      900_000,
    );
  }
});

describe("the boundary the function-object properties stop at", () => {
  test(
    "a PARAMETER's .name still refuses — the case that decides the fold's honesty",
    async () => {
      // The value comes from the caller; nothing at this site knows it. A
      // fold that answered here would print the parameter's own spelling,
      // "f", where Node prints the caller's "g" — a refusal turned into a
      // silent wrong answer, which is the one trade this project does not
      // make.
      const name = await refusalCodes(
        workDir,
        "param-name",
        [
          "function g(n: number): boolean { return n === 42 }",
          "function take(f: (n: number) => boolean): string { return f.name }",
          "console.log(take(g))",
          "",
        ].join("\n"),
      );
      expect(name, "a parameter's .name must not compile").toContain("SC2020");
      const len = await refusalCodes(
        workDir,
        "param-length",
        [
          "function take(f: (n: number) => boolean): number { return f.length }",
          "console.log(take(() => true))",
          "",
        ].join("\n"),
      );
      // Node answers 0 here — the argument is a zero-parameter arrow — so
      // reading the count off the parameter's TYPE would print 1.
      expect(len, "a parameter's .length must not compile").toContain("SC2020");
    },
    900_000,
  );

  test(
    "a REASSIGNED binding's .name still refuses",
    async () => {
      const codes = await refusalCodes(
        workDir,
        "reassigned-name",
        [
          "function g(n: number): boolean { return n === 42 }",
          "function h(n: number): boolean { return n === 7 }",
          "let f = g",
          "f = h",
          "console.log(f.name)",
          "",
        ].join("\n"),
      );
      expect(codes, "a reassigned binding's .name must not compile").toContain("SC2020");
    },
    900_000,
  );

  test(
    "an AMBIENT declaration's .name still refuses — a builtin included",
    async () => {
      // `declare function` names a value this program did not write: the
      // real name and the real parameter list belong to an implementation
      // nothing here can see. This is also what keeps every stdlib
      // global's .name where it was.
      const codes = await refusalCodes(workDir, "ambient-name", "console.log(fetch.name, fetch.length)\n");
      expect(codes, "fetch.name must not compile").toContain("SC2020");
    },
    900_000,
  );

  test(
    "the receiver's own effects are not folded away",
    async () => {
      // The fold emits a literal and never lowers the receiver, so a
      // receiver that could DO something declines rather than losing the
      // effect.
      const codes = await refusalCodes(
        workDir,
        "effectful-receiver",
        [
          "class K { m(n: number): boolean { return n === 42 } }",
          "console.log(new K().m.name)",
          "",
        ].join("\n"),
      );
      expect(codes.length, "an effectful receiver must not fold").toBeGreaterThan(0);
    },
    900_000,
  );

  test(
    "the EXACT-arity rule survives .call — a cast that hides a parameter still refuses",
    async () => {
      // The compiled ABI has no missing-argument default, so a short list
      // through `.call` keeps the fence rather than silently mis-calling.
      // Node answers NaN here; a compiled short call cannot, and the
      // refusal is loud.
      const codes = await refusalCodes(
        workDir,
        "call-short",
        [
          "function two(a: number, b: number): number { return a + b }",
          "console.log((two as (a: number) => number).call(null, 1))",
          "",
        ].join("\n"),
      );
      expect(codes, "a short .call must not compile").toContain("SC1090");
    },
    900_000,
  );

  test(
    "a bound function's identity is fresh per BIND, not per call site",
    async () => {
      // The wrapper is interned per signature, so a single lift backs
      // every bind of that shape. If the CLOSURE were interned with it,
      // two binds in a loop would be one object and this would print
      // `true` — the exact defect the erasure had, one layer down.
      const out = await output(
        workDir,
        "bind-per-site",
        [
          "function g(n: number): boolean { return n === 42 }",
          "const made: ((n: number) => boolean)[] = []",
          "for (let i = 0; i < 3; i++) made.push(g.bind(null))",
          "console.log(made[0] === made[1], made[1] === made[2], made[0] === g, made[0]!(42))",
          "",
        ].join("\n"),
      );
      expect(out.trim()).toBe("false false false true");
    },
    900_000,
  );

  test(
    "a class method's .bind keeps the receiver it always kept",
    async () => {
      // The `pushThis: false` arm is the TypeScript one and must not have
      // reached the class-method path, which binds a real receiver.
      const out = await output(
        workDir,
        "method-bind",
        [
          "class K {",
          "  v: number",
          "  constructor(v: number) { this.v = v }",
          "  m(): number { return this.v }",
          "}",
          "const k = new K(7)",
          "const b1 = k.m.bind(k)",
          "const b2 = k.m.bind(k)",
          "console.log(b1(), b1 === b2)",
          "",
        ].join("\n"),
      );
      expect(out.trim()).toBe("7 false");
    },
    900_000,
  );

  test(
    "a TYPE-space merge with the library still resolves to the library",
    async () => {
      // The shadow fix turns on a user VALUE declaration. An `interface`
      // augmentation adds no value, so the library's own lowering must
      // still be reached through it — this is the case `isStdlibSymbol`
      // answered `.some` for in the first place.
      const out = await output(
        workDir,
        "type-merge",
        [
          "interface Array<T> { scriptcMarker?: T }",
          "const a = [3, 1, 2]",
          "console.log(a.join(','), a.indexOf(2), Math.max(1, 2), isNaN(Number('x')))",
          "",
        ].join("\n"),
      );
      expect(out.trim()).toBe("3,1,2 2 2 true");
    },
    900_000,
  );
});
