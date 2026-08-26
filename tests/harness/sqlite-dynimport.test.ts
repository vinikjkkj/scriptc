/* `await import("better-sqlite3")` in the STATIC lane — the seam, and the
 * refusals around it.
 *
 * sqlite.test.ts pins the driver itself: 64 cells reached through a
 * static `import Database from "better-sqlite3"`. This file pins the
 * OTHER way in. The static lane serves better-sqlite3 itself over the
 * vendored amalgamation, so an `import()` of it names the same package
 * and answers the same namespace — a resolved promise of an object with
 * better-sqlite3's three export names on it, each a TRAP function. Every
 * use of the namespace is decided by TYPE and never by the value: `new
 * ns.default(path)` is claimed by its result type (lowerSqliteNew never
 * lowers its callee) and `ns.default` as a VALUE is refused by name —
 * but only while the namespace still HAS that type. One `: unknown`
 * annotation on the binding and every read is a plain dynamic member
 * access, which is why the VALUES have to be right too.
 *
 * ── the row this file exists to keep closed ───────────────────────────
 *
 * Routing a dynamic import to the WRONG module is silent and
 * catastrophic — a database that opens, accepts writes, and is not the
 * one the program meant. So which module answered is PROVED here, not
 * inferred, three ways that fail differently:
 *
 *   the decoy      the fixture runs in a directory where a REAL
 *                  better-sqlite3 package is installed whose only export
 *                  throws "DECOY WAS LOADED". Node in that directory
 *                  loads it and dies; the compiled binary answers every
 *                  cell. The control is ARMED — the decoy is proved
 *                  loadable in the same test — so "the decoy did not
 *                  load" cannot be an inert instrument.
 *   the link gate  an `await import("better-sqlite3")` whose namespace is
 *                  never constructed costs what `await
 *                  Promise.resolve(Object.create(null))` costs plus the
 *                  three export TRAPS (2,048 bytes, measured) and not one
 *                  byte of the engine or the amalgamation; adding `new
 *                  ns.default(":memory:")` costs the amalgamation.
 *   the cells      every line matches better-sqlite3 13.0.3, on BOTH
 *                  backends. A driver that half-answered would diverge
 *                  here long before it diverged anywhere a user looks.
 *
 * ── and the boundary that must survive ────────────────────────────────
 *
 * A dynamic import whose specifier is not a string literal must still
 * refuse, loudly and by name. Two shapes, two different refusals, both
 * asserted below: a genuinely computed specifier is a BUILD error
 * (SC2012), and the named-constant idiom — which the compiler's own
 * dynamicImportSpecOf folds but TypeScript does NOT type — compiles to a
 * rejected promise whose message names the spelling that works. The
 * second is the subtle one: under a folded constant the awaited value is
 * `any`, so none of the type-directed machinery above fires and the
 * construction the message names is never claimed. Measured on BOTH
 * checkers (typescript 5.9.3 and the 7.0.2 this build uses): a `const M =
 * "better-sqlite3"` and even a `declare const M: "better-sqlite3"` type
 * `import(M)` as `any`. The compiler's own dynamicImportSpecOf folds the
 * specifier fine — the fold is not the constraint, and that is why it is
 * not the guard either.
 *
 * The oracle is RECORDED, for sqlite.test.ts's reason (the gate needs no
 * native dependency installed in this repo) and re-checked against a live
 * addon whenever one resolves — reported, never passed quietly, when it
 * cannot.
 *
 * PROVENANCE of the recording: re-verified line for line against a live
 * better-sqlite3 13.0.3 under Node v25.9.0 on 2026-08-26. Note for
 * whoever re-records it: `ns.keys` is NODE-VERSION dependent. The same
 * installed 13.0.3 answers `SqliteError,default,module.exports` under
 * v25.9.0 and `SqliteError,default` under v22.18.0 — the `module.exports`
 * alias key is newer interop, not a property of the package. Record under
 * the Node this repository GATES under, or this cell reads as a
 * regression that is really an oracle swap. (13.0.3 ships Node-API
 * prebuilds and loads on both; the ABI-locked NODE_MODULE_VERSION 127
 * story belongs to node-gyp builds from source, not to this package.)
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const repoRoot = join(import.meta.dirname, "../..");
const fixtureDir = join(repoRoot, "tests/fixtures/sqlite-dynimport");
const sanitize = process.env["SCRIPTC_SAN"] === "1";

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
      reject(new Error(`sqlite-dynimport fixture timed out\nstderr:\n${err}`));
    }, 180_000);
    child.stdout.on("data", (c: Buffer) => (out += c.toString("utf8")));
    child.stderr.on("data", (c: Buffer) => (err += c.toString("utf8")));
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (signal) {
        reject(new Error(`sqlite-dynimport fixture died to ${signal}\nstdout:\n${out}\nstderr:\n${err}`));
        return;
      }
      resolve({ stdout: out, stderr: err, exitCode: code ?? 0 });
    });
  });
}

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    strict: true,
    module: "nodenext",
    moduleResolution: "nodenext",
    target: "es2022",
    lib: ["es2023"],
    types: ["node"],
  },
  include: ["*.ts"],
});

/** A directory holding an installed better-sqlite3 whose ONLY export
 * throws. Node loads it; a correctly-routed static binary never sees it. */
function plantDecoy(dir: string): void {
  const pkg = join(dir, "node_modules/better-sqlite3");
  mkdirSync(pkg, { recursive: true });
  writeFileSync(
    join(pkg, "package.json"),
    JSON.stringify({ name: "better-sqlite3", version: "99.0.0", main: "index.js" }),
  );
  writeFileSync(
    join(pkg, "index.js"),
    "module.exports = function Decoy() { throw new Error('DECOY WAS LOADED'); };\n",
  );
  writeFileSync(join(dir, "package.json"), JSON.stringify({ type: "commonjs" }));
}

let workDir = "";
let golden: string[] = [];
let live: string | null = null;
let liveWhy = "";

beforeAll(async () => {
  workDir = mkdtempSync(join(tmpdir(), "scriptc-sqlite-dyn-"));
  writeFileSync(join(workDir, "tsconfig.json"), TSCONFIG);
  golden = readFileSync(join(fixtureDir, "node-answers.txt"), "utf8").split("\n");
  try {
    const { createRequire } = await import("node:module");
    const require = createRequire(join(repoRoot, "package.json"));
    require.resolve("better-sqlite3");
    const liveDir = join(workDir, "live");
    mkdirSync(liveDir, { recursive: true });
    writeFileSync(join(liveDir, "package.json"), JSON.stringify({ type: "module" }));
    const r = await run(
      process.execPath,
      ["--experimental-strip-types", "--no-warnings", join(fixtureDir, "main.ts"), join(liveDir, "live.db")],
      liveDir,
    );
    if (r.exitCode === 0) live = r.stdout;
    else liveWhy = `the addon is installed but the fixture exited ${r.exitCode}: ${r.stderr.slice(0, 400)}`;
  } catch (e) {
    liveWhy = `better-sqlite3 is not loadable here (${(e as Error).message.split("\n")[0]})`;
  }
}, 600_000);

describe("better-sqlite3 through a dynamic import", () => {
  test("the instrument can say 'no difference' AND can fail", () => {
    // Without this, a comparison that is structurally inert reads exactly
    // like a comparison that passed.
    const nonEmpty = golden.filter((l) => l !== "");
    expect(nonEmpty.length).toBeGreaterThanOrEqual(24);
    expect(nonEmpty.at(-1)).toBe("END done");
    expect(nonEmpty[0]).toBe("ns.typeof object");
    // The four namespace-object cells specifically: they are the ones an
    // empty stand-in passes half of, so a fixture edited down to the
    // driver would look green while the seam went unmeasured.
    expect(nonEmpty).toContain("ns.keys SqliteError,default,module.exports");
    expect(nonEmpty).toContain("ns.json {}");
    expect(nonEmpty).toContain("ns.hasDefault true");
    expect(nonEmpty).toContain("ns.hasInherited false");
    // ...and the three that the four above CANNOT distinguish: an
    // undefined-valued stand-in passes all four and answers "undefined"
    // here, which is the arm the standard optional-driver probe
    // (`typeof candidate === 'function'`) reads as "no driver".
    expect(nonEmpty).toContain("ns.typeof.default function");
    expect(nonEmpty).toContain("ns.typeof.SqliteError function");
    // The negative control for those two: a key the namespace does NOT
    // have must still answer "undefined", or the stand-in is answering
    // "function" to everything and proves nothing.
    expect(nonEmpty).toContain("ns.typeof.absent undefined");
    // ...and armed: the same comparison, against one mutated cell.
    const mutated = [...golden];
    mutated[0] = "ns.typeof function";
    expect(mutated).not.toEqual(golden);
    expect(golden).toEqual([...golden]);
  });

  test("the recording still matches a live better-sqlite3, where one can load", () => {
    if (live === null) {
      console.warn(`[sqlite-dynimport] the live-oracle self-check did NOT run — ${liveWhy}`);
      expect(liveWhy).not.toBe("");
      return;
    }
    expect(live.split("\n")).toEqual(golden);
  });

  for (const backend of ["c", "llvm"] as const) {
    test(
      `${backend}: every cell matches better-sqlite3, and the decoy is never loaded`,
      async () => {
        const outDir = join(workDir, `run-${backend}`);
        mkdirSync(outDir, { recursive: true });
        const built = await compile(join(fixtureDir, "main.ts"), {
          outPath: join(outDir, exeName("program")),
          outDir,
          backend,
          sanitize,
        });
        expect(
          built.ok,
          `the dynamic-import fixture must COMPILE on ${backend}:\n` +
            (built.diagnostics ?? []).map((d) => `${d.code}: ${d.message}`).join("\n"),
        ).toBe(true);

        // The decoy goes in the RUN directory, so the only thing that can
        // route this program is what the compiler baked in.
        plantDecoy(outDir);
        // Armed: prove the decoy is loadable here before concluding
        // anything from the fact that it was not loaded.
        const decoyProbe = await run(
          process.execPath,
          [
            "-e",
            "try { new (require('better-sqlite3'))(':memory:'); console.log('NO THROW'); }" +
              " catch (e) { console.log('THREW ' + e.message); }",
          ],
          outDir,
        );
        expect(
          decoyProbe.stdout.trim(),
          "the decoy control is INERT — Node did not load the planted package, so 'the binary did not load it' proves nothing",
        ).toBe("THREW DECOY WAS LOADED");

        const native = await run(built.binaryPath!, [join(outDir, "fixture.db")], outDir);
        const lines = native.stdout.split("\n");
        const keyOf = (l: string): string => l.split(" ")[0] ?? "";
        for (const line of golden) {
          const key = keyOf(line);
          if (key === "") continue;
          const mine = lines.find((l) => keyOf(l) === key);
          expect(mine, `${backend}: '${key}' never ran (better-sqlite3 answered: ${line})`).toBeDefined();
          expect(mine, `${backend}: '${key}' differs from better-sqlite3`).toBe(line);
        }
        expect(native.stdout.split("\n")).toEqual(golden);
        expect(native.exitCode).toBe(0);
        // The database it wrote is a real SQLite file, not a lookalike.
        expect(readFileSync(join(outDir, "fixture.db")).subarray(0, 15).toString("latin1")).toBe(
          "SQLite format 3",
        );
      },
      900_000,
    );
  }
});

describe("the link gate, through import()", () => {
  test(
    "an unconstructed namespace costs a resolved promise and nothing more",
    async () => {
      const cases = {
        // The control is not "no import" — an `await` of anything costs
        // the async machinery. It is the same await, of the same shape of
        // value, with no package named.
        control:
          "async function main(): Promise<void> {\n" +
          "  const ns: unknown = await Promise.resolve(Object.create(null) as unknown);\n" +
          '  console.log("gate", typeof ns);\n}\nvoid main();\n',
        unused:
          "async function main(): Promise<void> {\n" +
          '  const ns = await import("better-sqlite3");\n' +
          '  console.log("gate", typeof ns);\n}\nvoid main();\n',
        used:
          "async function main(): Promise<void> {\n" +
          '  const ns = await import("better-sqlite3");\n' +
          '  const db = new ns.default(":memory:");\n' +
          '  console.log("gate", typeof ns);\n  db.close();\n}\nvoid main();\n',
      };
      const sizes: Record<string, number> = {};
      for (const [name, src] of Object.entries(cases)) {
        const dir = join(workDir, `gate-${name}`);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "tsconfig.json"), TSCONFIG);
        writeFileSync(join(dir, "main.ts"), src);
        const built = await compile(join(dir, "main.ts"), {
          outPath: join(dir, exeName("program")),
          outDir: dir,
          backend: "c",
          sanitize,
        });
        expect(built.ok, `the ${name} gate program must compile`).toBe(true);
        sizes[name] = readFileSync(built.binaryPath!).length;
      }
      // The namespace's three exports are TRAP functions, so that
      // `typeof ns.default` answers "function" the way Node does even
      // after the namespace is widened past its type. Three lifted
      // zero-parameter fences and their messages are what the
      // unconstructed namespace costs over the control: MEASURED at 2,048
      // bytes on the C backend, bounded generously here because the
      // number this gate exists to exclude is six hundred THOUSAND. The
      // strong form ("to the byte") held only while the exports were
      // undefined-valued, which is the silent wrong answer this fixture
      // now pins the other way.
      const nsCost = sizes["unused"]! - sizes["control"]!;
      expect(nsCost, "the unconstructed namespace must cost the trap closures and nothing else").toBeLessThanOrEqual(
        16_384,
      );
      expect(nsCost, "the trap closures are not free — a zero here means they stopped being emitted").toBeGreaterThan(0);
      // Neither the amalgamation nor the engine is linked until the
      // namespace is CONSTRUCTED from.
      expect(sizes["used"]! - sizes["control"]!).toBeGreaterThan(600_000);
      expect(sizes["used"]! - sizes["unused"]!).toBeGreaterThan(600_000);
    },
    900_000,
  );
});

describe("the boundary: a specifier that should not route must refuse by name", () => {
  const build = async (
    name: string,
    src: string,
  ): Promise<{ ok: boolean; diags: string; binaryPath?: string }> => {
    const dir = join(workDir, `neg-${name}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "tsconfig.json"), TSCONFIG);
    writeFileSync(join(dir, "main.ts"), src);
    const built = await compile(join(dir, "main.ts"), {
      outPath: join(dir, exeName("program")),
      outDir: dir,
      backend: "c",
      sanitize,
    });
    return {
      ok: built.ok,
      diags: (built.diagnostics ?? []).map((d) => `${d.code}: ${d.message}`).join("\n"),
      ...(built.binaryPath !== undefined ? { binaryPath: built.binaryPath } : {}),
    };
  };

  test(
    "a computed specifier is a build error, not a route",
    async () => {
      const r = await build(
        "computed",
        "async function main(): Promise<void> {\n" +
          "  const name = process.argv[2] as string;\n" +
          "  const ns = await import(name);\n" +
          "  console.log(typeof ns);\n}\nvoid main();\n",
      );
      expect(r.ok, `a computed specifier must not compile:\n${r.diags}`).toBe(false);
      expect(r.diags).toMatch(/SC2012/);
    },
    900_000,
  );

  test(
    "the named-constant idiom refuses at the await, naming the spelling that works",
    async () => {
      const r = await build(
        "const-spec",
        "const M = 'better-sqlite3';\n" +
          "async function main(): Promise<void> {\n" +
          "  try {\n" +
          "    const ns = await import(M);\n" +
          "    console.log('LOADED', typeof ns);\n" +
          "  } catch (e) {\n" +
          "    const x = e as NodeJS.ErrnoException;\n" +
          "    console.log('REFUSED:', x.message);\n" +
          "  }\n}\nvoid main();\n",
      );
      // It COMPILES — import()'s failure channel is in-band, which is
      // where Node puts a load failure and where the optional-dependency
      // try/import pattern catches it.
      expect(r.ok, `the constant form must still compile:\n${r.diags}`).toBe(true);
      const out = await run(r.binaryPath!, [], join(workDir, "neg-const-spec"));
      expect(out.stdout).toContain("REFUSED:");
      expect(out.stdout).toContain("better-sqlite3");
      expect(out.stdout).toContain("STRING LITERAL");
      expect(out.stdout).not.toContain("LOADED");
    },
    900_000,
  );

  test(
    "the namespace's default as a VALUE is refused, exactly as it is off a static namespace import",
    async () => {
      const dynamic = await build(
        "default-value-dyn",
        "async function main(): Promise<void> {\n" +
          '  const ns = await import("better-sqlite3");\n' +
          "  const D = ns.default;\n" +
          "  console.log(typeof D);\n}\nvoid main();\n",
      );
      const staticNs = await build(
        "default-value-static",
        'import * as ns from "better-sqlite3";\n' + "const D = ns.default;\nconsole.log(typeof D);\n",
      );
      expect(dynamic.ok, `aliasing the namespace's default must refuse:\n${dynamic.diags}`).toBe(false);
      expect(staticNs.ok).toBe(false);
      expect(dynamic.diags).toMatch(/SC2020/);
      // The same refusal, not a different one: the two spellings of the
      // same namespace must not have two boundaries.
      expect(dynamic.diags).toMatch(/typeof import\("better-sqlite3"\)\.default/);
      expect(staticNs.diags).toMatch(/typeof import\("better-sqlite3"\)\.default/);
    },
    900_000,
  );

  test(
    "a package the static lane does NOT serve keeps its own refusal",
    async () => {
      // A real installed package the static lane does NOT serve, planted
      // here rather than named from the repo: the case must not depend on
      // what happens to be installed beside a temp directory.
      const pkg = join(workDir, "neg-unserved/node_modules/notserved");
      mkdirSync(pkg, { recursive: true });
      writeFileSync(
        join(pkg, "package.json"),
        JSON.stringify({ name: "notserved", version: "1.0.0", main: "index.js", types: "index.d.ts" }),
      );
      writeFileSync(join(pkg, "index.js"), "exports.hello = () => 1;\n");
      writeFileSync(join(pkg, "index.d.ts"), "export declare function hello(): number;\n");
      const r = await build(
        "unserved",
        "async function main(): Promise<void> {\n" +
          "  try {\n" +
          "    const ns = await import('notserved');\n" +
          "    console.log('LOADED', typeof ns);\n" +
          "  } catch (e) {\n" +
          "    const x = e as NodeJS.ErrnoException;\n" +
          "    console.log('REFUSED:', x.message);\n" +
          "  }\n}\nvoid main();\n",
      );
      expect(r.ok, `the unserved-package form must still compile:\n${r.diags}`).toBe(true);
      const out = await run(r.binaryPath!, [], join(workDir, "neg-unserved"));
      expect(out.stdout).toContain("REFUSED:");
      expect(out.stdout).toContain("embedded dynamic engine");
      expect(out.stdout).not.toContain("LOADED");
    },
    900_000,
  );
});
