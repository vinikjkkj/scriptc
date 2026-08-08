// Compiling the C test binaries.
//
// These tests used to hardcode `clang`. On a machine without it every one of
// them failed at spawn -- which reads as "the runtime is broken" when it
// actually means "the harness could not run". scriptc itself builds with
// whatever `SCRIPTC_CC` names (zig cc, here), so the tests accept the same
// override and default to clang so CI is unchanged.
//
// Two platform details the old call sites got away with because they only
// ever ran on POSIX: Windows will not exec an extensionless file, and the
// runtime's libc shim TU (stpcpy, arc4random_buf) is a separate translation
// unit that the real build driver links in -- see backend/cc.ts.
import { execFile } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "../src");

export const exeSuffix = process.platform === "win32" ? ".exe" : "";

/** Path of a test binary, carrying the platform's executable suffix. */
export function testBin(buildDir: string, name: string): string {
  return join(buildDir, name + exeSuffix);
}

/** The C compiler as argv: `zig cc` is two words, `clang` is one. */
function ccArgv(): string[] {
  return (process.env.SCRIPTC_TEST_CC ?? "clang").trim().split(/\s+/);
}

// Whether this compiler can actually LINK an AddressSanitizer binary. zig's
// mingw target compiles the instrumentation and then has no asan runtime to
// link it against, so the probe has to go all the way to an executable.
let asanProbe: Promise<boolean> | undefined;
function asanWorks(): Promise<boolean> {
  return (asanProbe ??= (async () => {
    const dir = await mkdtemp(join(tmpdir(), "scr-asan-"));
    try {
      const c = join(dir, "p.c");
      await writeFile(c, "int main(void){return 0;}\n");
      const [cc, ...pre] = ccArgv();
      await execFileAsync(cc!, [...pre, "-fsanitize=address", "-o", join(dir, "p" + exeSuffix), c]);
      return true;
    } catch {
      return false;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  })());
}

let asanWarned = false;

/* The vendored zlib TUs, and the same list backend/cc.ts compiles per
 * target (ZLIB_SOURCES there: every root *.c except the gzFile file-I/O
 * units). `-lz` names a SYSTEM library that zig's mingw target does not
 * have -- "unable to find dynamic system library 'z'" -- so a bytes test
 * that hardcodes -lz cannot build at all on a zigcc/Windows box, and a
 * whole test FILE that never compiles reports zero failing tests. */
const ZLIB_SOURCES = ["adler32.c", "compress.c", "crc32.c", "deflate.c", "infback.c", "inffast.c", "inflate.c", "inftrees.c", "trees.c", "uncompr.c", "zutil.c"];

let zlibProbe: Promise<string[]> | undefined;
let zlibWarned = false;

/** How to give a test binary zlib: `-lz` where the toolchain has a system
 * libz, the vendored sources otherwise (the driver's own cross recipe). */
function zlibArgs(): Promise<string[]> {
  return (zlibProbe ??= (async () => {
    const dir = await mkdtemp(join(tmpdir(), "scr-zlib-"));
    try {
      const c = join(dir, "p.c");
      await writeFile(c, '#include <zlib.h>\nint main(void){return (int)(long)zlibVersion();}\n');
      const [cc, ...pre] = ccArgv();
      await execFileAsync(cc!, [...pre, "-o", join(dir, "p" + exeSuffix), c, "-lz"]);
      return ["-lz"];
    } catch {
      if (!zlibWarned) {
        zlibWarned = true;
        console.warn(`[cc] no system libz here; linking the VENDORED zlib snapshot instead (backend/cc.ts's cross recipe).`);
      }
      const vendor = join(srcDir, "..", "vendor", "zlib");
      // -I for the snapshot's own zlib.h (scr_zlib.c includes it), then the
      // TUs in place of the library.
      return ["-I", vendor, ...ZLIB_SOURCES.map((f) => join(vendor, f))];
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  })());
}

/**
 * Compile a test binary. Appends the platform's shim TU and system libraries,
 * and drops sanitizer flags the toolchain cannot link -- loudly, because a
 * test that quietly stops checking for leaks is worse than one that skips.
 * `-lz` is resolved the same way: a system libz when there is one, the
 * vendored snapshot when there is not.
 */
export async function ccCompile(args: readonly string[]): Promise<void> {
  const [cc, ...pre] = ccArgv();
  let argv = [...args];

  const sanitized = argv.some((a) => a.startsWith("-fsanitize="));
  if (sanitized && !(await asanWorks())) {
    argv = argv.filter((a) => !a.startsWith("-fsanitize="));
    if (!asanWarned) {
      asanWarned = true;
      console.warn(
        `[cc] ${cc} cannot link -fsanitize=address here; running these tests ` +
          `UNSANITIZED. Behaviour is still checked, memory errors are not.`,
      );
    }
  }

  if (argv.includes("-lz")) {
    const z = await zlibArgs();
    argv = argv.flatMap((a) => (a === "-lz" ? z : [a]));
  }

  if (process.platform === "win32") {
    const shim = join(srcDir, "scr_win.c");
    if (!argv.some((a) => a.endsWith("scr_win.c"))) argv.push(shim);
    for (const lib of ["-ladvapi32", "-liphlpapi", "-lws2_32"]) {
      if (!argv.includes(lib)) argv.push(lib);
    }
  }

  await execFileAsync(cc!, [...pre, ...argv]);
}

/* ------------------------- oracle case accounting -------------------------
 * Every C oracle here ends with `fprintf(stderr, "%ld/%ld cases passed")`,
 * and every call site used to check it with `/^(\d+)\/\1 cases passed$/`.
 * That regex asserts the NUMERATOR equals the DENOMINATOR and nothing else,
 * so the two can drift away from the POPULATION together and the gate stays
 * green: "0/0 cases passed" matches. It is not hypothetical plumbing --
 * these harnesses drop case lines silently by construction (test_number.c
 * `if (!tab) continue;`, and every one of them reads with a fixed-size
 * fgets buffer that splits an over-long line into a header it mis-parses
 * and a tail it skips), so a re-generated, truncated or mis-encoded case
 * file shrinks the run with no signal at all.
 *
 * expectCasesPassed pins the denominator to the committed case file. Same
 * fix shape as order-parity's "baseline accounting" and llvm-differential's
 * "tier accounting": the corpus is the denominator, and a gate that stops
 * covering it says so instead of reporting a smaller success. */

/** Cases a file-driven oracle must run: its case file's non-blank lines. */
export function caseFileSize(casesFile: string): number {
  return readFileSync(casesFile, "utf8").split("\n").filter((l) => l.trim() !== "").length;
}

/**
 * Assert an oracle binary's `<pass>/<total> cases passed` tail reports a
 * clean run over the WHOLE population.
 *
 * `cases` is the committed case-file path: `total` must equal its non-blank
 * line count, plus `extra` for harnesses that also run built-in assertions
 * the file does not carry. With no `cases` (a harness whose cases live in
 * its own C source) the population cannot be counted from here, so the
 * check is only that the run was not empty -- which still closes "0/0".
 */
export function expectCasesPassed(
  stderr: string,
  opts: { cases?: string; extra?: number } = {},
): void {
  const lines = stderr.trim().split("\n").map((l) => l.trimEnd());
  const tail = lines.at(-1) ?? "";
  const m = /^(\d+)\/(\d+) cases passed$/.exec(tail);
  if (m === null) {
    throw new Error(
      `oracle printed no "<pass>/<total> cases passed" tail line (a crash, or a usage/parse bailout ` +
        `before the count). Last line: ${JSON.stringify(tail)}\n${lines.slice(-40).join("\n")}`,
    );
  }
  const passed = Number(m[1]);
  const total = Number(m[2]);
  const expected = opts.cases === undefined ? null : caseFileSize(opts.cases) + (opts.extra ?? 0);
  if (expected !== null && total !== expected) {
    throw new Error(
      `oracle ran ${total} cases but ${opts.cases} holds ${expected} ` +
        `(${caseFileSize(opts.cases!)} non-blank lines${opts.extra ? ` + ${opts.extra} built-in`: ""}). ` +
        `The run and the corpus have drifted apart: cases were skipped, or the case file was ` +
        `re-generated without the harness. Equal pass/total says nothing about this.`,
    );
  }
  if (expected === null && total === 0) {
    throw new Error(`oracle ran 0 cases — "0/0 cases passed" is a vacuous pass, not a green gate.`);
  }
  if (passed !== total) {
    const bad = lines.filter((l) => /^(MISMATCH|BAD LINE|RC AUDIT)/.test(l));
    throw new Error(
      `${total - passed} of ${total} oracle cases FAILED (first ${Math.min(bad.length, 20)} shown):\n` +
        bad.slice(0, 20).join("\n"),
    );
  }
}

/* ---------------------- cwd-bound cases in an oracle ----------------------
 * A committed case file is a promise that Node answers these exact bytes.
 * For the cases that consult the CURRENT DIRECTORY that promise cannot be
 * kept across hosts: both the generator and the C oracle chdir("/"), and
 * that is "/" on a POSIX box but the current DRIVE'S ROOT ("G:\") on
 * Windows. path.win32.resolve("a") is "\a" under the first and "G:\a" under
 * the second; BOTH are what Node says there. 8607 of path-cases.txt's 38214
 * lines are in that class.
 *
 * Re-recording the file on Windows would only move the lie to the other
 * host. Dropping the cases would delete a fifth of the corpus. So: the cases
 * that consult the cwd are re-derived from the RUNNING host's Node, and the
 * rest stay pinned to the committed bytes.
 *
 * Which cases those are is MEASURED, not listed: the generator is run over
 * several synthetic cwds (it takes SCR_ORACLE_PROBE_CWD) and a case counts
 * as cwd-bound when the answers disagree. A written-down list would be a
 * second copy of a fact the generator already knows, and would go stale the
 * first time the corpus grew.
 *
 * The probe set is not arbitrary. It covers every shape a real cwd can have
 * -- root and deep, drive-less and drive-ful -- because a case can consult
 * the cwd and still answer the same under two cwds that happen to share the
 * feature that decides it. And it spells the drive-less ones BOTH ways,
 * because Node has one genuinely host-conditional line: win32.resolve's
 * current-directory fast path returns the cwd verbatim on Windows and
 * slash-flipped on POSIX,
 *
 *     if (!isWindows) path = StringPrototypeReplace(path, forwardSlashRegExp, '\\');
 *
 * and `isWindows` is frozen at module load, so no cwd can make a Windows
 * Node take the POSIX branch. A backslash-spelled cwd reaches the same
 * OUTPUT the POSIX branch produces, which is all the probe needs. Without
 * "\\" in this list twelve `relative(".", …)` cases come back unexplained. */
const PROBE_CWDS = ["/", "/zz/yy", "\\", "\\zz\\yy", "Q:\\", "Q:\\zz\\yy"] as const;

/**
 * A committed/host disagreement on a case the cwd probe says is cwd-free.
 * These are Node behaviours that name or leak `process.platform` itself, so
 * no cwd can reproduce them; each one is a decision about who is right:
 *
 *   "host"      Node names the running platform and so does the port
 *               (`… must be "localhost" or empty on win32`). Take this
 *               host's bytes.
 *   "committed" Node leaked the HOST's platform into an arm that should not
 *               have one and the port is deliberately arm-faithful. Keep the
 *               committed bytes -- the port already matches them.
 *
 * Anything not listed is a real disagreement and throws.
 */
export type CaseException = "host" | "committed";

/** A case line's identity: everything but the trailing expected-value field. */
function caseKey(line: string): string {
  return line.slice(0, line.lastIndexOf("\t"));
}

async function generateCases(gen: string, probeCwd?: string): Promise<string[]> {
  const env = { ...process.env };
  if (probeCwd === undefined) delete env["SCR_ORACLE_PROBE_CWD"];
  else env["SCR_ORACLE_PROBE_CWD"] = probeCwd;
  const { stdout } = await execFileAsync(process.execPath, [gen], {
    env,
    maxBuffer: 1 << 28,
  });
  return stdout.split("\n").filter((l) => l !== "");
}

/**
 * Materialise the case file this host's C oracle should be checked against.
 *
 * Writes `out` with the committed expected values for every cwd-free case
 * and this host's Node's answers for the cwd-bound ones, and asserts along
 * the way that the committed file still holds for everything cwd-free --
 * which is the whole point of committing it. On a POSIX host nothing is
 * rewritten and `out` is the committed file byte for byte.
 *
 * Returns the population and how much of it was re-derived, so the caller
 * can put a floor under both: a probe that stops finding cwd-bound cases
 * has silently turned back into "trust the committed bytes".
 */
export async function materializeHostCases(
  gen: string,
  committedFile: string,
  out: string,
  exceptions: ReadonlyMap<string, CaseException> = new Map(),
): Promise<{ total: number; rederived: number }> {
  const committed = readFileSync(committedFile, "utf8").split("\n").filter((l) => l !== "");
  const [host, ...probes] = await Promise.all([
    generateCases(gen),
    ...PROBE_CWDS.map((c) => generateCases(gen, c)),
  ]);

  const runs = [host!, ...probes];
  for (const [i, run] of runs.entries()) {
    if (run.length !== committed.length) {
      throw new Error(
        `${gen} emitted ${run.length} cases (run ${i}) but ${committedFile} holds ` +
          `${committed.length}. The generator and the committed corpus have drifted apart; ` +
          `re-run the generator into the case file and review the diff.`,
      );
    }
  }

  const lines: string[] = [];
  let rederived = 0;
  const stale: string[] = [];
  const unseen = new Set(exceptions.keys());
  for (let i = 0; i < committed.length; i++) {
    const key = caseKey(committed[i]!);
    unseen.delete(key);
    for (const run of runs) {
      if (caseKey(run[i]!) !== key) {
        throw new Error(
          `case ${i} is ${JSON.stringify(caseKey(run[i]!))} in a fresh run but ` +
            `${JSON.stringify(key)} in ${committedFile}: the generator's case ORDER changed, so ` +
            `line-for-line comparison is meaningless. Regenerate the committed file.`,
        );
      }
    }
    const cwdBound = probes.some((p) => p[i] !== probes[0]![i]);
    // A signed decision outranks the automatic classifier in both
    // directions: "committed" means someone read the divergence and found
    // the PORT right, so the probe must not overrule it later.
    const ex = exceptions.get(key);
    const takeHost = ex === "committed" ? false : cwdBound || ex === "host";
    if (takeHost) {
      lines.push(host![i]!);
      if (host![i] !== committed[i]) rederived++;
    } else {
      lines.push(committed[i]!);
      if (host![i] !== committed[i] && ex !== "committed" && stale.length < 20) {
        stale.push(`  committed ${committed[i]}\n  this host ${host![i]}`);
      }
    }
  }
  if (unseen.size > 0) {
    // An excuse for a case that no longer exists is an excuse nobody is
    // reading -- and the next case to need one will look excused when it
    // is not. Same accounting rule as expectCasesPassed's denominator.
    throw new Error(
      `these documented platform exceptions match no case in ${committedFile} — the corpus moved ` +
        `and the excuse did not: ${[...unseen].map((k) => JSON.stringify(k)).join(", ")}`,
    );
  }
  if (stale.length > 0) {
    throw new Error(
      `${committedFile} disagrees with this host's Node on ${stale.length}+ cases that do NOT ` +
        `consult the cwd, so the platform excuse does not cover them. Either Node changed ` +
        `behaviour or the port's oracle is wrong -- read the diff, do not re-record:\n` +
        stale.join("\n"),
    );
  }
  writeFileSync(out, lines.join("\n") + "\n");
  return { total: lines.length, rederived };
}

/**
 * Assert a child aborted. Node reports abort() as SIGABRT on POSIX; Windows
 * has no signals -- the UCRT turns it into a fail-fast exception, which
 * surfaces as exit status 0xC0000409 (or 3 on the classic path).
 */
export function expectAbort(err: { signal?: string | null; code?: unknown }): void {
  if (process.platform !== "win32") {
    if (err.signal !== "SIGABRT") {
      throw new Error(`expected SIGABRT, got signal ${err.signal} code ${String(err.code)}`);
    }
    return;
  }
  const code = Number(err.code);
  if (code !== 3 && code !== 0xc0000409) {
    throw new Error(`expected an abort status, got ${String(err.code)}`);
  }
}
