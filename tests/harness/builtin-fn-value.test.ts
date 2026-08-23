/* A BUILTIN held as a VALUE — the differential, and the boundary.
 *
 * Two fixtures and one wall.
 *
 * pure.ts is the offline half: `isNaN`, `isFinite`, `parseFloat`,
 * `encodeURI` and `decodeURIComponent` aliased, passed, stored in a
 * record field and an array, returned, `??`-defaulted, captured by a
 * closure that outlives its frame, reassigned through a `let`, and
 * compared with `===` down every one of those routes.
 *
 * fetch-value.tmpl.ts is the half that decides zapo's row 5, against the
 * fetch-static origin: `fetch` as a value, `options.fetch ?? fetch`, and
 * the two cells a wrong answer would hide — the request the server
 * actually SEES when it arrives through the value, and a network failure
 * REJECTING rather than resolving.
 *
 * WHY IDENTITY IS THE FIRST THING BOTH FIXTURES ASSERT. The value is a
 * zero-capture closure over a synthesized module function, and the
 * backends intern exactly that shape into one immortal static closure —
 * so `a === isNaN` is true only as long as nothing ADAPTS the value on
 * its way into a slot. An adapter is a fresh pointer. `const a =
 * parseInt; a === parseInt` printed `false` against Node's `true` during
 * development, because `typeof parseInt` maps to `(string, number |
 * undefined) => number` (the radix is optional) and the adapter fired.
 * The gate in lower-fnvalue.ts closes that, and the last block in this
 * file is what keeps it closed: `parseInt` and `encodeURIComponent` must
 * STILL REFUSE. A green fixture with a silently re-opened gate would
 * otherwise look exactly like a green fixture.
 *
 * BOTH BACKENDS, because the LLVM lane keeps its own bookkeeping and has
 * shipped wrong while the C twin was right.
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const repoRoot = join(import.meta.dirname, "../..");
const fixtureDir = join(repoRoot, "tests/fixtures/builtin-fn-value");
const originPath = join(repoRoot, "tests/fixtures/fetch-static/origin.mjs");
const sanitize = process.env["SCRIPTC_SAN"] === "1";

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
      reject(new Error(`builtin-fn-value fixture timed out\nstderr:\n${err}`));
    }, 180_000);
    child.stdout.on("data", (c: Buffer) => (out += c.toString("utf8")));
    child.stderr.on("data", (c: Buffer) => (err += c.toString("utf8")));
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (signal) {
        reject(new Error(`builtin-fn-value fixture died to ${signal}\n${out}\n${err}`));
        return;
      }
      resolve({ stdout: out, stderr: err, exitCode: code ?? 0 });
    });
  });
}

/** Lays a fixture source down in its own directory with a tsconfig — NOT
 * under node_modules, where Node refuses to strip types and the Node lane
 * would answer an EMPTY stdout that every comparison then passes. */
function stage(root: string, name: string, source: string): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "main.ts"), source, "utf8");
  writeFileSync(join(dir, "tsconfig.json"), TSCONFIG, "utf8");
  return dir;
}

/** Compiles one snippet and answers its diagnostic codes — the boundary
 * rows below assert on these. */
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

let workDir = "";

// ------------------------------------------------------------- offline half

let pureDir = "";
let pureNode: Run | null = null;

// --------------------------------------------------------------- fetch half

interface Origins {
  proc: ReturnType<typeof spawn>;
  http: string;
  alt: string;
}

function startOrigins(): Promise<Origins> {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [originPath], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`origin never reported PORTS\nstderr:\n${err}`));
    }, 30_000);
    proc.stderr?.on("data", (c: Buffer) => {
      err += c.toString("utf8");
      const m = /PORTS (\d+) (\d+) (\d+)/.exec(err);
      if (m) {
        clearTimeout(timer);
        resolve({ proc, http: `http://127.0.0.1:${m[1]}`, alt: `http://127.0.0.1:${m[3]}` });
      }
    });
    proc.on("error", reject);
  });
}

let origins: Origins | null = null;
let fetchDir = "";
let fetchNode: Run | null = null;

beforeAll(async () => {
  workDir = mkdtempSync(join(tmpdir(), "scriptc-builtin-fn-value-"));
  pureDir = stage(workDir, "pure", readFileSync(join(fixtureDir, "pure.ts"), "utf8"));
  pureNode = await run(process.execPath, [join(pureDir, "main.ts")], pureDir);

  origins = await startOrigins();
  fetchDir = stage(
    workDir,
    "fetch",
    readFileSync(join(fixtureDir, "fetch-value.tmpl.ts"), "utf8")
      .replaceAll("__HTTP__", origins.http)
      .replaceAll("__ALT__", origins.alt),
  );
  fetchNode = await run(process.execPath, [join(fetchDir, "main.ts")], fetchDir);
}, 600_000);

afterAll(() => {
  origins?.proc.kill();
});

/** Cell by cell before the whole-stream compare, so a failure names the
 * case rather than dumping sixty lines of context. */
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

describe("builtins as values, against Node", () => {
  test("Node's own answers are the baseline, and they are complete", () => {
    expect(pureNode, "the Node lane did not run").not.toBeNull();
    expect(pureNode!.exitCode, `Node lane failed:\n${pureNode!.stderr}`).toBe(0);
    expect(pureNode!.stdout.trimEnd().split("\n").at(-1)).toBe("END done");
    // A floor on the matrix: a fixture edited down to nothing must fail
    // here rather than report a green 3-cell comparison.
    expect(pureNode!.stdout.trimEnd().split("\n").length).toBeGreaterThanOrEqual(70);

    expect(fetchNode, "the fetch Node lane did not run").not.toBeNull();
    expect(fetchNode!.exitCode, `Node fetch lane failed:\n${fetchNode!.stderr}`).toBe(0);
    expect(fetchNode!.stdout.trimEnd().split("\n").at(-1)).toBe("END done");
    expect(fetchNode!.stdout.trimEnd().split("\n").length).toBeGreaterThanOrEqual(35);
    // The whole point of the fetch fixture: the value form is the SAME
    // function object as the global. If this line ever reads false, every
    // identity cell below is comparing two wrongs.
    expect(fetchNode!.stdout).toContain("id-alias true");
  });

  for (const backend of ["c", "llvm"] as const) {
    test(
      `${backend}: every offline cell matches Node`,
      async () => {
        const outDir = join(pureDir, backend);
        mkdirSync(outDir, { recursive: true });
        const built = await compile(join(pureDir, "main.ts"), {
          outPath: join(outDir, exeName("program")),
          outDir,
          backend,
          sanitize,
        });
        expect(
          built.ok,
          "the builtin-as-a-value fixture must COMPILE:\n" +
            (built.diagnostics ?? []).map((d) => `${d.code}: ${d.message}`).join("\n"),
        ).toBe(true);
        compareCells(backend, pureNode!, await run(built.binaryPath!, [], outDir));
      },
      900_000,
    );

    test(
      `${backend}: every fetch-as-a-value cell matches Node`,
      async () => {
        const outDir = join(fetchDir, backend);
        mkdirSync(outDir, { recursive: true });
        const built = await compile(join(fetchDir, "main.ts"), {
          outPath: join(outDir, exeName("program")),
          outDir,
          backend,
          sanitize,
        });
        expect(
          built.ok,
          "the fetch-as-a-value fixture must COMPILE — this is zapo's row 5:\n" +
            (built.diagnostics ?? []).map((d) => `${d.code}: ${d.message}`).join("\n"),
        ).toBe(true);
        compareCells(backend, fetchNode!, await run(built.binaryPath!, [], outDir));
      },
      900_000,
    );
  }
});

/* THE BOUNDARY. Each row is a thing this feature deliberately does NOT
 * do, and the reason a green fixture above is not enough: every one of
 * them would be a SILENT wrong answer if it started compiling by
 * accident, and a refusal is the only loud state available. */
describe("the boundary this feature stops at", () => {
  test(
    "parseInt as a value still refuses — the gate that keeps identity honest",
    async () => {
      // `typeof parseInt` maps to `(string, number | undefined) => number`
      // because the radix is optional, so the value would be ADAPTED into
      // its own slot and `a === parseInt` would print false against Node's
      // true. Measured, not argued: it did, before the gate existed.
      const codes = await refusalCodes(
        workDir,
        "no-parseint",
        'const a = parseInt\nconsole.log(a("42", 10), a === parseInt)\n',
      );
      expect(codes.length, "parseInt as a value must not compile").toBeGreaterThan(0);
      expect(codes).toContain("SC2020");
    },
    900_000,
  );

  test(
    "encodeURIComponent as a value still refuses — a union parameter is not the table's shape",
    async () => {
      // Declared `(uriComponent: string | number | boolean) => string`.
      // The table's entry is the string form, so the gate declines rather
      // than offering a value that accepts a narrower argument set than
      // the name does.
      const codes = await refusalCodes(
        workDir,
        "no-euc",
        'const a = encodeURIComponent\nconsole.log(a("x y"))\n',
      );
      expect(codes.length, "encodeURIComponent as a value must not compile").toBeGreaterThan(0);
      expect(codes).toContain("SC2020");
    },
    900_000,
  );

  test(
    "fetch.name and fetch.length still refuse — and a USER function's now answer",
    async () => {
      // The two halves moved apart, and that is the right shape rather
      // than a drift. This row used to assert that a user function's
      // `.name` was SC2020 as well, with a note that the day someone
      // landed function-object properties they should land for every
      // function at once. Someone did (lower-fnprops.ts, tests/harness/
      // fn-identity.test.ts): a user function's `.name` and `.length` now
      // fold from the value's proven CREATION SITE.
      //
      // A BUILTIN has no creation site in the program. `fetch` is an
      // ambient `declare function` — its real name and its real parameter
      // list belong to an implementation nothing in the program can see —
      // so it keeps its refusal, which is what this half now pins.
      const builtin = await refusalCodes(
        workDir,
        "no-fetch-name",
        "console.log(fetch.name, fetch.length)\n",
      );
      expect(builtin, "fetch.name must not compile").toContain("SC2020");
      const dir = stage(
        workDir,
        "user-name",
        "function g(s: string): number { return s.length }\nconsole.log(g.name, g.length)\n",
      );
      const built = await compile(join(dir, "main.ts"), {
        outPath: join(dir, exeName("program")),
        outDir: dir,
        backend: "c",
      });
      expect(
        built.ok,
        "a user function's .name must compile:\n" +
          (built.diagnostics ?? []).map((d) => `${d.code}: ${d.message}`).join("\n"),
      ).toBe(true);
      const mine = await run(built.binaryPath!, [], dir);
      const node = await run(process.execPath, [join(dir, "main.ts")], dir);
      expect(node.stdout.trim()).toBe("g 1");
      expect(mine.stdout, "a user function's .name must answer what Node answers").toBe(node.stdout);
    },
    900_000,
  );

  test(
    "a builtin METHOD taken off its object still refuses — the `this` question",
    async () => {
      const mathMax = await refusalCodes(
        workDir,
        "no-math-max",
        "const m = Math.max\nconsole.log(m(1, 2))\n",
      );
      expect(mathMax.length, "Math.max as a value must not compile").toBeGreaterThan(0);
      const consoleLog = await refusalCodes(
        workDir,
        "no-console-log",
        'const p = console.log\np("hi")\n',
      );
      expect(consoleLog.length, "console.log as a value must not compile").toBeGreaterThan(0);
    },
    900_000,
  );

  test(
    "`typeof fetch` as a TYPE still refuses — zapo's record at wa-version-fetcher.ts:47",
    async () => {
      // THE row that does not close, stated as a test rather than as
      // prose. The value form landed; the TYPE did not, because mapping
      // `typeof fetch` to the one-argument value signature would let this
      // record compile and would then turn every two-argument call through
      // the field into a NEW refusal inside a body that produces none
      // today. When someone lands RequestInit, this test is the one to
      // delete — deliberately, with the census in hand.
      const codes = await refusalCodes(
        workDir,
        "no-typeof-fetch",
        "interface Opts { readonly fetch?: typeof fetch }\n" +
          "async function f(o: Opts): Promise<number> {\n" +
          '  const impl = o.fetch ?? fetch\n' +
          '  return (await impl("http://127.0.0.1:1/x")).status\n' +
          "}\n" +
          "f({}).catch(() => console.log('caught'))\n",
      );
      expect(codes.length, "`typeof fetch` in a record must not compile yet").toBeGreaterThan(0);
      expect(codes).toContain("SC2011");
    },
    900_000,
  );

  test(
    "a user function MERGING with a builtin keeps the builtin out of it",
    async () => {
      // Provenance, and the reason the gate tests EVERY declaration rather
      // than `some`. `function isNaN(n: number)` at module scope does not
      // shadow the ambient `declare function isNaN` — it MERGES with it
      // into one symbol carrying both declarations, and the loose
      // isStdlibSymbol test says yes to that symbol. With the loose test
      // this program COMPILED and answered the library's function for a
      // direct call while the alias answered the user's. It refuses
      // instead, exactly as it does before this feature: the merged type
      // is an overload set, and a compiled function value is one
      // signature.
      const merged = await refusalCodes(
        workDir,
        "shadow-merge",
        [
          "function encodeURI(s: string): string { return s + '!' }",
          "const a = encodeURI",
          "console.log(a('q'), encodeURI('z'), a === encodeURI)",
          "",
        ].join("\n"),
      );
      expect(merged, "a merged user/library function must not take the builtin value").toContain(
        "SC2007",
      );
    },
    900_000,
  );

  test(
    "`.bind` on a builtin answers exactly what `.bind` on a USER function answers",
    async () => {
      // THE ERASURE IS FIXED, AND THIS ROW IS WHY IT COST NOTHING TO
      // FIND IT AGAIN. It used to record a DIVERGENCE rather than bless
      // it: in TypeScript `f.bind(x)` was an erasure that compiled to `f`
      // itself, so `g.bind(null) === g` printed `true` where Node prints
      // `false`, and this row asserted only that the builtin half and the
      // user half gave the SAME answer — "the day someone fixes the
      // erasure, both move together and this row still passes".
      //
      // They moved together. The TypeScript arm now mints a real wrapper
      // (lower-calls.ts, bindThisClosure's `pushThis: false` arm), the two
      // halves are still equal, and the answer they are equal AT is now
      // Node's. The uniformity assertion is kept as it was — it is the
      // property this feature could break — and the recorded Node line
      // below is now an assertion about the compiler too.
      const dir = stage(
        workDir,
        "bind-uniformity",
        [
          "function mine(n: number): boolean { return n === 42 }",
          "const bm = mine.bind(null)",
          "const bb = isNaN.bind(null)",
          "console.log(bm === mine, bb === isNaN)",
          "",
        ].join("\n"),
      );
      const built = await compile(join(dir, "main.ts"), {
        outPath: join(dir, exeName("program")),
        outDir: dir,
        backend: "c",
      });
      expect(
        built.ok,
        "the bind-uniformity fixture must compile:\n" +
          (built.diagnostics ?? []).map((d) => `${d.code}: ${d.message}`).join("\n"),
      ).toBe(true);
      const mineRun = await run(built.binaryPath!, [], dir);
      const [userAnswer, builtinAnswer] = mineRun.stdout.trim().split(" ");
      expect(
        builtinAnswer,
        "a bound builtin must compare the way a bound user function does",
      ).toBe(userAnswer);
      // And Node's own answer for both, recorded so the divergence is
      // visible in the file rather than only in a report.
      const node = await run(process.execPath, [join(dir, "main.ts")], dir);
      expect(node.stdout.trim()).toBe("false false");
      expect(mineRun.stdout.trim(), "and both now answer what Node answers").toBe("false false");
    },
    900_000,
  );

  test(
    "a user function that really does shadow keeps its own lowering",
    async () => {
      // The BLOCK-scoped spelling is a genuine shadow — a separate symbol,
      // no merge — and it must compile to the user's function.
      const dir = stage(
        workDir,
        "shadow-block",
        [
          "function main(): void {",
          "  const isNaN = (n: number): boolean => n === 42",
          "  const a = isNaN",
          "  console.log(a(42), a(1))",
          "}",
          "main()",
          "",
        ].join("\n"),
      );
      const built = await compile(join(dir, "main.ts"), {
        outPath: join(dir, exeName("program")),
        outDir: dir,
        backend: "c",
      });
      expect(
        built.ok,
        "a shadowing user function must still compile:\n" +
          (built.diagnostics ?? []).map((d) => `${d.code}: ${d.message}`).join("\n"),
      ).toBe(true);
      const mine = await run(built.binaryPath!, [], dir);
      const node = await run(process.execPath, [join(dir, "main.ts")], dir);
      expect(mine.stdout).toBe(node.stdout);
      expect(node.stdout.trim()).toBe("true false");
    },
    900_000,
  );
});
