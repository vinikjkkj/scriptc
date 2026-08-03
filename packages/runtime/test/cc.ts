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

/**
 * Compile a test binary. Appends the platform's shim TU and system libraries,
 * and drops sanitizer flags the toolchain cannot link -- loudly, because a
 * test that quietly stops checking for leaks is worse than one that skips.
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

  if (process.platform === "win32") {
    const shim = join(srcDir, "scr_win.c");
    if (!argv.some((a) => a.endsWith("scr_win.c"))) argv.push(shim);
    for (const lib of ["-ladvapi32", "-liphlpapi", "-lws2_32"]) {
      if (!argv.includes(lib)) argv.push(lib);
    }
  }

  await execFileAsync(cc!, [...pre, ...argv]);
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
