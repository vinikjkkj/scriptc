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
 *
 * RECALIBRATED 2026-08-08, same toolchain, after SCR_DYN_OBJINST (the
 * class-instance dyn kind) landed in the always-linked dyn core: 632,320
 * static. Measured A/B on the same tree, the kind itself is +2,048 — one
 * page — and the other +3,584 is drift the win32 ceiling had already
 * absorbed since the calibration above (main measured 630,272 immediately
 * before this change, 1,728 under the old bound). Recording both halves
 * because the second is the one that will bite the next feature: the
 * headroom was nearly gone and the number did not say so.
 *
 * What these bounds protect is the DISTANCE between classes, and the
 * distances are untouched — a 2 KB kind cannot hide a 135 KB library or a
 * 620 KB engine. linux and darwin cannot be re-measured from this box, so
 * they move by exactly the +2,048 this change costs everywhere, which
 * preserves whatever headroom each had rather than inventing new headroom
 * for a platform nobody weighed.
 */
const platform = process.platform;

/** A default-built hello-world: no regex, no engine. */
export const STATIC_CLASS_MAX =
  platform === "linux" ? 394_048 : platform === "win32" ? 637_000 : 363_048;

/** A program that uses regex: libregexp + libunicode, never the engine. */
export const REGEX_CLASS_MAX =
  platform === "linux" ? 547_048 : platform === "win32" ? 774_000 : 514_048;

/** An --dynamic build that actually enters an island carries the engine.
 * A floor rather than a ceiling — the assertion is that the engine IS
 * there, which is true by a wide margin on every container format. */
export const ENGINE_CLASS_MIN = 500_000;
