/* The binary SIZE CLASSES, in one place because two suites weigh the same
 * artifacts for the same reason: island.test.ts pins that the embedded
 * engine never leaks into a static build, and regex.test.ts pins that
 * linking libregexp costs a library, not an engine.
 *
 * The absolute numbers are toolchain- and container-format-specific and
 * page-granular, so each platform is calibrated from a measurement and
 * given roughly one native page of headroom. What the bounds actually
 * protect is the DISTANCE between classes, which is the same everywhere:
 *
 *   static → regex   ≈ +135 KB   (libregexp + libunicode)
 *   static → engine  ≈ +620 KB   (the embedded QuickJS archive)
 *
 * Measurements:
 *   linux   Ubuntu 24.04 / clang (the canonical Sandbox): 387,600 static,
 *           540,232 with regex linked.
 *   darwin  Mach-O, ~353 KB static (segments round to 16 KB, so a few
 *           hundred bytes of new runtime can tip a whole page).
 *   win32   PE/COFF via `zig cc -target x86_64-windows-gnu`, 2026-08-08:
 *           626,688 static and 763,904 with regex — a +137,216 delta, the
 *           same library-sized step. The baseline is ~240 KB above the ELF
 *           one because mingw's CRT links statically; that is a constant
 *           of the container format, not runtime growth, and it cannot
 *           hide an engine-sized jump any more than the other two can.
 */
const platform = process.platform;

/** A default-built hello-world: no regex, no engine. */
export const STATIC_CLASS_MAX =
  platform === "linux" ? 392_000 : platform === "win32" ? 632_000 : 361_000;

/** A program that uses regex: libregexp + libunicode, never the engine. */
export const REGEX_CLASS_MAX =
  platform === "linux" ? 545_000 : platform === "win32" ? 769_000 : 512_000;

/** An --dynamic build that actually enters an island carries the engine.
 * A floor rather than a ceiling — the assertion is that the engine IS
 * there, which is true by a wide margin on every container format. */
export const ENGINE_CLASS_MIN = 500_000;
