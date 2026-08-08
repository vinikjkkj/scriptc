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
import { readFileSync } from "node:fs";
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
