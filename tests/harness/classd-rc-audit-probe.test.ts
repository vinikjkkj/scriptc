/* Class D diagnosis probe (not part of the differential contract): compiles
 * a small fixed list of suspected-leaking corpus programs plus two
 * deliberate control programs, runs each compiled binary directly, and
 * prints the RAW (unfiltered) stdout/stderr/exitCode for every one.
 *
 * CI's differential-suite.ts filters "scriptc RC audit skipped:" lines out
 * of stderr before comparing, and the separate npm.test.ts/sqlite-dynimport
 * assertions that fail Class D only read exitCode -- neither ever prints
 * the RC audit's own report text anywhere a human can read it. This file
 * exists solely to capture that text, on whichever host runs it.
 *
 * SCRIPTC_RC_AUDIT=1 turns the audit on WITHOUT requiring -fsanitize=address
 * (cc.ts's optAuditArgs: the define is a separate dial from ASan since
 * f9ba8ec2d). SCRIPTC_SAN=1 turns both on together (the real "san" flavor).
 * Set whichever the caller wants; this file does not force either.
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { test } from "vitest";
import { compile } from "@scriptc/compiler";

const execFileAsync = promisify(execFile);
const repoRoot = join(import.meta.dirname, "../..");
const sanitize = process.env["SCRIPTC_SAN"] === "1";

/** The brief's own illustrative failing assertion is
 * tests/harness/fetch-dispatcher.test.ts:250 -- a DIFFERENT mechanism from
 * the generator/async corpus programs above (real undici-shaped fetch with
 * a live HTTP origin, not a bare pending promise). That file's own Class B
 * compile bug (scr_fetch_dispatch.c's fd_set collision) blocked it from
 * ever running on Linux until fd_obj_set's rename landed, so whatever it
 * reports under san here was NEVER measured before. Reproduced standalone
 * (not by importing the test file, which has vitest-only beforeAll/afterAll
 * wiring) against the SAME fixture template and origin script it uses. */
function startOrigin(originScript: string): Promise<{ proc: ReturnType<typeof spawn>; http: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [originScript], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`fetch-dispatcher origin never reported PORTS\nstderr:\n${err}`));
    }, 30_000);
    proc.stderr?.on("data", (c: Buffer) => {
      err += c.toString("utf8");
      const m = /PORTS (\d+) (\d+) (\d+)/.exec(err);
      if (m) {
        clearTimeout(timer);
        resolve({ proc, http: `http://127.0.0.1:${m[1]}` });
      }
    });
    proc.on("error", reject);
  });
}

async function probeFetchDispatcher(outRoot: string): Promise<void> {
  const originScript = join(repoRoot, "tests/fixtures/fetch-static/origin.mjs");
  const origin = await startOrigin(originScript);
  try {
    const outDir = join(outRoot, "fetch-dispatcher-diff");
    mkdirSync(outDir, { recursive: true });
    const src = readFileSync(join(repoRoot, "tests/fixtures/fetch-dispatcher/client.tmpl.ts"), "utf8").replaceAll(
      "__HTTP__",
      origin.http,
    );
    const file = join(outDir, "main.ts");
    writeFileSync(file, src, "utf8");
    writeFileSync(
      join(outDir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          module: "nodenext",
          moduleResolution: "nodenext",
          target: "es2022",
          lib: ["es2023", "dom"],
        },
        include: ["*.ts"],
      }),
    );
    const result = await compile(file, {
      outPath: join(outDir, `program${process.platform === "win32" ? ".exe" : ""}`),
      outDir,
      sanitize,
      dynamic: false,
      backend: "c",
    });
    console.log(`\n=== fetch-dispatcher-diff (sanitize=${sanitize}) ===`);
    if (!result.ok) {
      console.log("COMPILE FAILED:");
      for (const d of result.diagnostics) console.log(`  ${d.code}: ${d.message}`);
      return;
    }
    try {
      const { stdout, stderr } = await execFileAsync(result.binaryPath, [], {
        encoding: "buffer",
        cwd: outDir,
        timeout: 120_000,
      });
      console.log(`EXIT: 0`);
      console.log(`STDOUT: ${JSON.stringify(stdout.toString("utf8"))}`);
      console.log(`STDERR: ${JSON.stringify(stderr.toString("utf8"))}`);
    } catch (err) {
      const e = err as { code?: unknown; stdout?: Buffer; stderr?: Buffer };
      console.log(`EXIT: ${String(e.code)}`);
      console.log(`STDOUT: ${JSON.stringify((e.stdout ?? Buffer.alloc(0)).toString("utf8"))}`);
      console.log(`STDERR: ${JSON.stringify((e.stderr ?? Buffer.alloc(0)).toString("utf8"))}`);
    }
  } finally {
    origin.proc.kill();
  }
}

interface Program {
  name: string;
  file: string; // repo-relative, OR an inline "sourceText" below
  sourceText?: string;
  dynamic?: boolean;
}

// The four corpus programs the original CI-LINUX-FAILURES.txt classification
// named under Class D ("san4", "san9", "san15"), still present at this
// commit.
const CORPUS_PROGRAMS: Program[] = [
  { name: "1024-async-pending-exit", file: "tests/corpus/1024-async-pending-exit.ts" },
  {
    name: "5934-generators-labeled-jump-skips-close",
    file: "tests/corpus/5934-generators-labeled-jump-skips-close.ts",
  },
  { name: "2014-generators-values", file: "tests/corpus/2014-generators-values.ts" },
  { name: "2019-generators-loops", file: "tests/corpus/2019-generators-loops.ts" },
];

// The original CI-LINUX-FAILURES.txt classification's other two named
// programs ("abandoned-handles" / "promise-bridge-forever" in
// npm.test.ts): both still exist as fixtures, both are the SAME shape (an
// async function awaiting a promise nobody settles), but under --dynamic
// (the island/quickjs engine), which has its own counting allocator and
// its own teardown path -- a genuinely different mechanism from the
// plain corpus programs above, not just a repeat of the same one.
const DYNAMIC_PROGRAMS: Program[] = [
  { name: "npm-abandoned-handles", file: "tests/fixtures/npm/cases/abandoned-handles/main.ts", dynamic: true },
  {
    name: "npm-promise-bridge-forever",
    file: "tests/fixtures/npm/cases/promise-bridge-forever/main.ts",
    dynamic: true,
  },
];

// Mandatory positive/negative instrument controls: a deliberate leak must
// print the FAILED line and exit 99; an equivalent clean program must print
// nothing and exit 0. Written standalone (no runtime import needed -- the
// compiler links the whole runtime for any program that allocates one
// string) so this file alone proves the matcher/audit pairing on whatever
// host runs it.
const CONTROL_LEAK: Program = {
  name: "control-leak",
  file: "<inline>",
  sourceText: [
    "// deliberate leak: this object must never be referenced again,",
    "// but nothing releases it before exit.",
    'const leaked: { tag: string } = { tag: "leak-me" };',
    "console.log(leaked.tag);",
    "",
  ].join("\n"),
};
const CONTROL_CLEAN: Program = {
  name: "control-clean",
  file: "<inline>",
  sourceText: ['console.log("clean");', ""].join("\n"),
};

async function runOne(outRoot: string, p: Program): Promise<void> {
  console.log(`\n=== ${p.name} (sanitize=${sanitize}, dynamic=${p.dynamic ?? false}) ===`);
  try {
    const outDir = join(outRoot, p.name);
    mkdirSync(outDir, { recursive: true });
    let file = join(repoRoot, p.file);
    if (p.sourceText !== undefined) {
      file = join(outDir, "src.ts");
      writeFileSync(file, p.sourceText);
    }
    // compile() can either return { ok:false, diagnostics } (a frontend
    // refusal) OR THROW (a CcCompileError from the native toolchain itself
    // rejecting the emitted C -- a real, distinct failure mode measured
    // once already in this probe: 2014-generators-values.ts compiles clean
    // under zig cc/Windows but clang-22/Linux hard-errors on a pointer-type
    // mismatch at a scr_gen_of_coro call site). Catching only one of the
    // two would have silently stopped this loop and lost every program
    // after the first such case -- which is exactly what happened before
    // this try/catch was added.
    const result = await compile(file, {
      outPath: join(outDir, `program${process.platform === "win32" ? ".exe" : ""}`),
      outDir,
      sanitize,
      dynamic: p.dynamic ?? false,
      ...(p.dynamic ? {} : { backend: "c" as const }),
    });
    if (!result.ok) {
      console.log("COMPILE FAILED:");
      for (const d of result.diagnostics) console.log(`  ${d.code}: ${d.message}`);
      return;
    }
    try {
      const { stdout, stderr } = await execFileAsync(result.binaryPath, [], { encoding: "buffer" });
      console.log(`EXIT: 0`);
      console.log(`STDOUT: ${JSON.stringify(stdout.toString("utf8"))}`);
      console.log(`STDERR: ${JSON.stringify(stderr.toString("utf8"))}`);
    } catch (err) {
      const e = err as { code?: unknown; stdout?: Buffer; stderr?: Buffer };
      console.log(`EXIT: ${String(e.code)}`);
      console.log(`STDOUT: ${JSON.stringify((e.stdout ?? Buffer.alloc(0)).toString("utf8"))}`);
      console.log(`STDERR: ${JSON.stringify((e.stderr ?? Buffer.alloc(0)).toString("utf8"))}`);
    }
  } catch (err) {
    console.log(`COMPILE THREW: ${err instanceof Error ? err.message : String(err)}`);
  }
}

test(
  "classd probe: dump raw RC audit output for suspected leaking programs",
  async () => {
    const outRoot = mkdtempSync(join(tmpdir(), "classd-probe-"));
    try {
      for (const p of [CONTROL_LEAK, CONTROL_CLEAN, ...CORPUS_PROGRAMS, ...DYNAMIC_PROGRAMS]) {
        await runOne(outRoot, p);
      }
      try {
        await probeFetchDispatcher(outRoot);
      } catch (err) {
        console.log(`\n=== fetch-dispatcher-diff threw: ${err instanceof Error ? err.message : String(err)} ===`);
      }
    } finally {
      rmSync(outRoot, { recursive: true, force: true });
    }
  },
  900_000,
);
