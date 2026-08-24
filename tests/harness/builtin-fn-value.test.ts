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
 * module-member.ts is the third: a member of a node BUILTIN MODULE held
 * as a value (`const d = dirname`, `path.dirname` through the namespace,
 * passed as an argument, in a record field, in an array, captured by a
 * closure that outlives its frame). Same four cells per member — typeof,
 * `===` against the name, `===` against the OTHER spelling, and the value
 * CALLED — because the wrong answer available here is the worst kind: a
 * member that read back as anything other than the same function would be
 * silent. The boundary rows at the end of this file are what keep the
 * allow-list honest: `fs.existsSync`, `path.join`, `path.basename` and
 * `crypto.randomUUID` must STILL refuse, each for a different reason.
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

// --------------------------------------------------- builtin-module members

let memberDir = "";
let memberNode: Run | null = null;

beforeAll(async () => {
  workDir = mkdtempSync(join(tmpdir(), "scriptc-builtin-fn-value-"));
  pureDir = stage(workDir, "pure", readFileSync(join(fixtureDir, "pure.ts"), "utf8"));
  pureNode = await run(process.execPath, [join(pureDir, "main.ts")], pureDir);

  memberDir = stage(workDir, "member", readFileSync(join(fixtureDir, "module-member.ts"), "utf8"));
  memberNode = await run(process.execPath, [join(memberDir, "main.ts")], memberDir);

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

    expect(memberNode, "the module-member Node lane did not run").not.toBeNull();
    expect(memberNode!.exitCode, `Node module-member lane failed:\n${memberNode!.stderr}`).toBe(0);
    expect(memberNode!.stdout.trimEnd().split("\n").at(-1)).toBe("END done");
    expect(memberNode!.stdout.trimEnd().split("\n").length).toBeGreaterThanOrEqual(60);
    // The floor that makes every identity cell below mean something: if
    // Node itself ever answered `false` here, the comparison would be
    // pinning two wrongs together.
    expect(memberNode!.stdout).toContain("path.dirname.ident true");
    expect(memberNode!.stdout).toContain("path.dirname.nsid true");
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

    test(
      `${backend}: every builtin-MODULE-MEMBER cell matches Node`,
      async () => {
        const outDir = join(memberDir, backend);
        mkdirSync(outDir, { recursive: true });
        const built = await compile(join(memberDir, "main.ts"), {
          outPath: join(outDir, exeName("program")),
          outDir,
          backend,
          sanitize,
        });
        expect(
          built.ok,
          "the builtin-module-member fixture must COMPILE:\n" +
            (built.diagnostics ?? []).map((d) => `${d.code}: ${d.message}`).join("\n"),
        ).toBe(true);
        compareCells(backend, memberNode!, await run(built.binaryPath!, [], outDir));
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
    "`typeof fetch` as a TYPE COMPILES now, and answers what Node answers",
    async () => {
      // THIS ROW HAS CHANGED SIDES, and the reason is written here rather
      // than in a report. It used to assert that zapo's record REFUSED, on
      // the argument that mapping `typeof fetch` to the one-argument value
      // signature would let the record compile and would then turn every
      // two-argument call through the field into a NEW refusal inside a
      // body that produced none. That argument was right about the
      // NARROWED mapping and wrong about the row: what closes it is
      // `RequestInit` becoming a real VALUE and `Request` a real type, so
      // the field carries the AMBIENT signature and a two-argument call
      // through it is an ordinary call.
      //
      // It is a DIFFERENTIAL now, not a refusal check, because a record
      // that merely compiles is exactly the failure this file ranks worst.
      // The program dials a dead port: Node rejects, and so must this.
      const dir = stage(
        workDir,
        "typeof-fetch-record",
        "interface Opts { readonly fetch?: typeof fetch }\n" +
          "async function f(o: Opts): Promise<string> {\n" +
          "  const impl = o.fetch ?? fetch\n" +
          "  const init: RequestInit = { method: 'GET' }\n" +
          '  const r = await impl("http://127.0.0.1:1/x", init)\n' +
          "  return String(r.status)\n" +
          "}\n" +
          "async function main(): Promise<void> {\n" +
          "  try { console.log('resolved', await f({})) }\n" +
          "  catch (e) { console.log('rejected', (e as Error).name, (e as Error).message) }\n" +
          "}\n" +
          "void main()\n",
      );
      const built = await compile(join(dir, "main.ts"), {
        outPath: join(dir, exeName("program")),
        outDir: dir,
        backend: "c",
      });
      expect(
        built.ok,
        "zapo's record must compile now:\n" +
          (built.diagnostics ?? []).map((d) => `${d.code}: ${d.message}`).join("\n"),
      ).toBe(true);
      const mine = await run(built.binaryPath!, [], dir);
      const node = await run(process.execPath, [join(dir, "main.ts")], dir);
      expect(node.stdout.trim(), "the Node lane must REJECT against a dead port").toBe(
        "rejected TypeError fetch failed",
      );
      expect(mine.stdout, "and the compiled program must answer the same").toBe(node.stdout);
    },
    900_000,
  );

  test(
    "a builtin value in a slot of ANOTHER function type refuses rather than adapting",
    async () => {
      // The wrong answer that widening `fetch` made reachable, kept
      // reachable on purpose. A slot of a different function type takes an
      // adapter; an adapter is a FRESH closure; a fresh closure is a
      // different pointer, so `rec.call === fetch` printed FALSE against
      // Node's true. Found by RUNNING the differential above with the old
      // narrow annotations, not by reading the lowering.
      const codes = await refusalCodes(
        workDir,
        "narrow-fetch-slot",
        "const rec: { call: (u: string) => Promise<Response> } = { call: fetch }\n" +
          "console.log(rec.call === fetch)\n",
      );
      expect(
        codes.length,
        "a narrowed slot must refuse, not adapt into a silently non-identical value",
      ).toBeGreaterThan(0);
      expect(codes).toContain("SC2020");
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

/* THE BUILTIN-MODULE-MEMBER BOUNDARY. Five rows, five different reasons,
 * and every one of them would be a wrong answer rather than a missing one
 * if it started compiling. The fixture above is green; without these a
 * widened allow-list or a loosened gate would leave it exactly as green. */
describe("the builtin-module-member boundary", () => {
  test(
    "fs.readSync as a value still refuses — the checker's signature is not the row's",
    async () => {
      // The gate: `mapTypeOf` of the member's own type must EQUAL
      // `funcOf(row.params, row.result)`. readSync's declared buffer
      // parameter is not the row's `bytes<u8>`, so a value here would be
      // ADAPTED into its own slot and `f === readSync` would print false
      // against Node's true -- the failure `parseInt` had.
      //
      // This row is on the gate, not on the allow-list: readSync IS
      // allow-listed. What refuses it is the type surface this build
      // reads, and that is the point -- the allow-list widens what MAY be
      // offered, never what is.
      const codes = await refusalCodes(
        workDir,
        "no-readsync",
        [
          'import { readSync } from "node:fs"',
          "const f = readSync",
          "console.log(String(typeof f))",
          "",
        ].join("\n"),
      );
      expect(codes.length, "fs.readSync as a value must not compile").toBeGreaterThan(0);
      expect(codes).toContain("SC1090");
    },
    900_000,
  );

  test(
    "path.join as a value still refuses — a rest parameter has no fixed-arity value form",
    async () => {
      // Node's `join(...paths: string[])`. The func ABI is fixed-arity, so
      // no value this compiler can mint IS that function: a one-argument
      // form would refuse the two-argument call Node accepts, and an
      // array-taking form would be a different function wearing the name.
      const codes = await refusalCodes(
        workDir,
        "no-join",
        [
          'import { join } from "node:path"',
          "const f = join",
          'console.log(f("a", "b"))',
          "",
        ].join("\n"),
      );
      expect(codes.length, "path.join as a value must not compile").toBeGreaterThan(0);
      expect(codes).toContain("SC1090");
    },
    900_000,
  );

  test(
    "path.basename as a value still refuses — an omitted trailing argument the row completes",
    async () => {
      // The row completes basename's omitted suffix to "" (a Node no-op).
      // An exact-arity value form would refuse `basename(p)`, which Node
      // accepts, so the member stays out of the allow-list even though its
      // lowering is otherwise a single libCall.
      const codes = await refusalCodes(
        workDir,
        "no-basename",
        [
          'import { basename } from "node:path"',
          "const f = basename",
          'console.log(f("/a/b.txt", ""))',
          "",
        ].join("\n"),
      );
      expect(codes.length, "path.basename as a value must not compile").toBeGreaterThan(0);
      expect(codes).toContain("SC1090");
    },
    900_000,
  );

  test(
    "fs.readFileSync as a value still refuses — its row is not the whole call",
    async () => {
      // readFileSync's dispatch special-cases the encoding argument and
      // has five other libCall spellings (BUILTIN_MODULE_FN_ALIASES). A
      // value minted from the ROW would answer `fs.readFileSync` where the
      // direct call answers `fs.readFileSyncBuf` or `fs.readFileSyncDyn`,
      // which is a silent wrong answer manufactured BY the value form. It
      // is deliberately absent from BUILTIN_MEMBER_FN_VALUES.
      const codes = await refusalCodes(
        workDir,
        "no-readfilesync",
        [
          'import { readFileSync } from "node:fs"',
          "const f = readFileSync",
          'console.log(f("x", "utf8"))',
          "",
        ].join("\n"),
      );
      expect(codes.length, "fs.readFileSync as a value must not compile").toBeGreaterThan(0);
      expect(codes).toContain("SC1090");
    },
    900_000,
  );

  test(
    "child_process.spawn as a value still refuses — the whole module's calls are special-cased",
    async () => {
      // Every child_process member's call completion is written by hand in
      // lowerBuiltinModuleCall (an omitted args list, spawn's exact
      // `{ stdio: "ignore" }`, execSync's shell flag). None of their rows
      // describes their call, so none of them can have a value form.
      const codes = await refusalCodes(
        workDir,
        "no-spawn",
        [
          'import { spawn } from "node:child_process"',
          "const f = spawn",
          "console.log(String(typeof f))",
          "",
        ].join("\n"),
      );
      expect(codes.length, "child_process.spawn as a value must not compile").toBeGreaterThan(0);
      expect(codes).toContain("SC1090");
    },
    900_000,
  );

  test(
    "a builtin member's .name and .length still refuse",
    async () => {
      // `.name`/`.length` are SC2020 on a USER function value too, so
      // answering them for a builtin member would make these the only
      // functions in the language that have them. The member having a
      // value now must not quietly widen that.
      const codes = await refusalCodes(
        workDir,
        "no-member-name",
        [
          'import { dirname } from "node:path"',
          "const f = dirname",
          "console.log(f.name, f.length)",
          "",
        ].join("\n"),
      );
      expect(codes.length, "a builtin member's .name/.length must not compile").toBeGreaterThan(0);
    },
    900_000,
  );

  test(
    "a value in a slot of another function type refuses rather than adapting",
    async () => {
      // A slot whose function type is not the member's own would take an
      // adapter, and an adapter is a fresh closure: the value held there
      // would compare unequal to the member where Node compares equal.
      // The refusal is the answer, and its hint names `typeof dirname`.
      const codes = await refusalCodes(
        workDir,
        "narrow-slot",
        [
          'import { dirname } from "node:path"',
          'const f: (p: string, extra?: number) => string = dirname',
          'console.log(f("/a/b"))',
          "",
        ].join("\n"),
      );
      expect(codes.length, "a slot of another shape must not silently adapt").toBeGreaterThan(0);
    },
    900_000,
  );
});
