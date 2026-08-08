/* The C compiler the HARNESS ITSELF drives.
 *
 * Four suites build native code of their own — library mode's K-fixture
 * probes (library-mode, library-int, library-contract) and the outbound-FFI
 * archive (ffi) — and every one of them spelled `clang` as a literal. That
 * is a harness fact, not a compiler fact: scriptc's own driver has read
 * SCRIPTC_CC/SCRIPTC_TARGET since the cross lanes landed (backend/cc.ts's
 * resolveCc), so on a box whose toolchain is `zig cc` the LIBRARY was built
 * by zig and the PROBE was handed to a compiler that does not exist. Every
 * test in those files then failed at spawn with ENOENT — which reads as
 * "library mode is broken" when it means "the harness could not run".
 *
 * The recipe here is not new either: library-cross.test.ts has linked these
 * exact probes with `zig cc -target <triple>` plus the win32 embedder libs
 * since it landed, but only behind SCRIPTC_CROSS=1. This module is that
 * recipe hoisted out of the env-gated lane so the DEFAULT lane uses it too,
 * with the driver taken from resolveCc — the same function the archive
 * under test was built with, so probe and archive can never disagree about
 * compiler or target.
 *
 * Three platform facts the old call sites got away with by only ever
 * running on POSIX:
 *   - an archive carries no `-l` flags, so a win32 EMBEDDER spells the
 *     system DLLs the runtime units import on its own link line;
 *   - Windows will not exec an extensionless file (see exe.ts);
 *   - zig's mingw target compiles ASan instrumentation and then has no
 *     asan runtime to link it against.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveCc, targetPlatform } from "../../packages/compiler/src/backend/cc.js";

/* `nm`'s "defined symbols only" flag, in the spelling BOTH nm's understand.
 * `-U` is llvm-nm's (Apple's `nm` is llvm-nm, which is why the K suites got
 * away with `-gU` on macOS); in GNU binutils ≥ 2.38 `-U` is the short form
 * of `--unicode=<mode>` and swallows the very next argument — so `nm -gU
 * <archive>` consumed the archive as a unicode mode and fell back to its
 * default operand, reporting `nm: 'a.out': No such file`. `--defined-only`
 * is spelled the same by both. */
export const NM_DEFINED_ONLY = ["-g", "--defined-only"];

/* The win32 embedder link contract — library-cross.test.ts's
 * WIN32_EMBEDDER_LIBS verbatim: advapi32 (RtlGenRandom behind
 * arc4random_buf, GetUserNameA), iphlpapi (GetAdaptersAddresses behind
 * os.networkInterfaces), ws2_32 (inet_ntop/htonl) — exactly the
 * unconditional win32 set cc.ts links into every win32 executable. */
export const WIN32_EMBEDDER_LIBS = ["-ladvapi32", "-liphlpapi", "-lws2_32"];

/** The platform the harness's own native output will run on: the
 * SCRIPTC_TARGET triple's OS under a cross build, the host's otherwise —
 * the same rule the compiler's link flags follow. */
export function ccTargetPlatform(): string {
  return targetPlatform(resolveCc());
}

/** `probe` → `probe.exe` when the target is Windows. A harness that spawns
 * what it just built owns the suffix (exe.ts); this one follows the TARGET
 * rather than the host, because the archive it links against did. */
export function probeName(stem: string): string {
  return stem + (ccTargetPlatform() === "win32" ? ".exe" : "");
}

/**
 * A probe's stdout, with the mingw CRT's text-mode line endings folded back.
 *
 * The probes are plain C: their own `printf("...\n")` goes through the
 * CRT's TEXT-mode stdout on Windows, which writes CRLF. That is a fact
 * about the embedder host, not about the library under test — the archive
 * hands the sink bytes, and the probe prints them. library-cross.test.ts
 * has folded exactly this back on its Windows execution leg since it
 * landed, with the same reasoning; the executable lanes never normalize
 * anything because they compare Windows Node against a Windows binary and
 * both sides agree. Identity when the target is not Windows.
 */
export function probeStdout(raw: string): string {
  return ccTargetPlatform() === "win32" ? raw.replaceAll("\r\n", "\n") : raw;
}

let asanProbe: boolean | undefined;

/**
 * Whether this driver can LINK an AddressSanitizer binary. Compiling the
 * instrumentation is not enough — zig's mingw target does that and then has
 * no runtime to link against — so the probe goes all the way to an
 * executable. Cached per worker process.
 */
export function asanLinkable(): boolean {
  if (asanProbe !== undefined) return asanProbe;
  const driver = resolveCc();
  const dir = mkdtempSync(join(tmpdir(), "scr-harness-asan-"));
  try {
    const c = join(dir, "p.c");
    writeFileSync(c, "int main(void){return 0;}\n");
    execFileSync(driver.argv[0]!, [
      ...driver.argv.slice(1),
      ...driver.targetArgs,
      "-fsanitize=address",
      "-o",
      join(dir, probeName("p")),
      c,
    ]);
    asanProbe = true;
  } catch {
    asanProbe = false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return asanProbe;
}

/**
 * Compile (and, unless `link` is false, link) a harness-owned native
 * program with the driver the compiler itself would use. `args` is the
 * historical bare-clang command line; the driver prefix, the cross-target
 * flags, the platform link requirements, and the win32 embedder libs are
 * supplied here.
 *
 * Callers pass `-o <path>` themselves and should build that path with
 * probeName().
 */
export function ccProbe(args: readonly string[], opts: { link?: boolean } = {}): void {
  const driver = resolveCc();
  const linking = opts.link ?? true;
  execFileSync(driver.argv[0]!, [
    ...driver.argv.slice(1),
    ...driver.targetArgs,
    ...args,
    ...(linking ? driver.linkArgs : []),
    ...(linking && targetPlatform(driver) === "win32" ? WIN32_EMBEDDER_LIBS : []),
  ]);
}

/* The disposition of a child that called abort(). POSIX reports it as
 * SIGABRT; Windows has no signals — the UCRT turns abort() into a fail-fast
 * exception, which surfaces as exit status 0xC0000409 (or 3 on the classic
 * path). Same knowledge as packages/runtime/test/cc.ts's expectAbort, in the
 * shape the harness's spawnSync/execFile call sites hand back (`status` from
 * spawnSync, `code` from an execFile rejection). */
const WIN32_ABORT_STATUSES = new Set([3, 0xc0000409]);

interface ChildDisposition {
  status?: number | null;
  code?: unknown;
  signal?: string | null;
}

export function isAbort(run: ChildDisposition): boolean {
  if (process.platform !== "win32") return run.signal === "SIGABRT";
  const status = run.status ?? (typeof run.code === "number" ? run.code : null);
  return status !== null && WIN32_ABORT_STATUSES.has(status >>> 0);
}

/** Assertion form of isAbort, with the observed disposition in the message. */
export function expectAbort(run: ChildDisposition): void {
  if (!isAbort(run)) {
    throw new Error(
      `expected the child to abort, got status ${String(run.status ?? run.code)} ` +
        `signal ${String(run.signal)}`,
    );
  }
}
