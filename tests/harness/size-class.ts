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
 *
 * RECALIBRATED AGAIN 2026-08-09, same toolchain, after SCR_DYN_ARRBUF (the
 * ArrayBuffer dyn kind) joined the same always-linked core: 637,440 static,
 * over the 637,000 above. Measured A/B on two worktrees at the same commit,
 * the arithmetic is:
 *
 *   main (b165184)   635,904        <- 3,584 above the last calibration
 *   this change      637,440        <- +1,536 for the kind itself
 *
 * so of the 4,680 bytes of headroom the last recalibration left, 3,584 were
 * gone to unrelated merges BEFORE this change compiled a line, and the kind
 * spent the remaining 1,096 and 440 more. That is the second time running
 * that the ceiling was reached mostly by drift, which is the number worth
 * carrying forward: a dyn kind costs one page or less (+2,048 then, +1,536
 * now — this one is cheaper because only the ArrayBuffer half is always
 * linked; the child-stream handle ops live in the gated scr_dyn_handle.c
 * and a hello-world never links them), while the gap between calibrations
 * costs two.
 *
 * The REGEX class was measured SEPARATELY rather than moved by the static
 * delta, and it is as well, because it does not grow by the same amount:
 *
 *   main (b165184)   773,632        <- 368 bytes under the old 774,000
 *   this change      776,704        <- +3,072, TWICE the static delta
 *
 * Assuming the two classes move together would have set this bound 1,536
 * bytes too low and turned a green canary red for the next reader. Note
 * also how little room the regex ceiling had left: 368 bytes, against the
 * static one's 4,680 — the tighter of the two, and nothing said so.
 *
 * MEASURED AGAIN 2026-08-09, same toolchain, after SCR_DYN_BIG (the
 * bigint dyn kind) joined the same always-linked core — and this time
 * NOTHING MOVES, which is the point of writing it down:
 *
 *   this change   638,976 static   (+1,536 over the 637,440 above)
 *                 778,752 regex    (+2,048 over the 776,704 above)
 *
 * Both are UNDER the bounds already set (3,024 and 2,248 of headroom
 * left), so the win32 numbers stay where they are. Raising a ceiling one
 * has not reached only loosens the canary, and the previous two
 * recalibrations raised because they TIPPED, not as a ritual.
 *
 * The third dyn kind in a row costs a page or less (+2,048, +1,536,
 * +1,536), which is now enough of a series to plan against — and this
 * one is at the cheap end for a reason worth copying rather than
 * rediscovering: the bigint PAYLOAD behaviour (766 lines of digits) is
 * not here at all. scr_bigint.c stays gated on `opts.bigint`, and the
 * always-linked core reaches it through an installed five-entry ops
 * table (ScrDynBigOps), the arrangement scr_dyn_jsval_ops already used.
 * What a hello-world pays for is the switch arms and one static pointer.
 * That the gating is real rather than assumed is not a matter of taste
 * either: the first attempt called the GATED constructor from the
 * always-linked structuredClone arm, and this very hello-world failed to
 * link on `undefined symbol: scr_dyn_from_big` — the same failure mode
 * scr_big_low_u64 produced one change earlier. The accounting suite now
 * asserts it (bytes-table-accounting.test.ts).
 *
 * linux and darwin cannot be weighed from this box, so they DO move by
 * exactly what the kind costs here — +1,536 static, +2,048 regex — which
 * preserves whatever headroom each had rather than silently spending it
 * on a platform nobody can re-measure. Same rule the two calibrations
 * above applied, applied to the platforms that need it and not to the
 * one that does not.
 *
 * win32 therefore gets one honest page over each new measurement:
 * 637,440 + 4,096 -> 642,000 static, 776,704 + 4,096 -> 781,000 regex.
 * linux and darwin cannot be weighed from this box, so they move by
 * exactly what this change costs here — +1,536 static, +3,072 regex —
 * which preserves whatever headroom each had rather than inventing new
 * headroom for a platform nobody measured. The static->regex DISTANCE the
 * pair actually protects is untouched: a 3 KB kind cannot hide a 135 KB
 * library or a 620 KB engine.
 *
 * RECALIBRATED 2026-08-11, same toolchain, after the promise
 * payload-conversion MEMO (one pointer on ScrPromise plus three small
 * always-linked functions in scr_async.c). It tipped BOTH bounds, and it
 * is the first change here whose two classes move by the SAME amount:
 *
 *   main (e348a0c)   641,536 static   780,800 regex
 *   this change      642,048 static   781,312 regex
 *
 * +512 on each, against 464 bytes of static headroom and 200 of regex
 * headroom. Two things to carry forward. First, this change costs ONE
 * EIGHTH of a page and still tipped both ceilings: the calibrations above
 * left less room than their arithmetic suggests, for the third time
 * running. Second, the classes moved identically because the cost is
 * always-linked code in scr_async.c, which both lanes carry unchanged —
 * the warning above that regex does NOT move by the static delta is about
 * changes the regex lane duplicates, and this is not one. Measured
 * separately anyway, as that warning demands, rather than derived: the
 * static->regex DISTANCE is 139,264 bytes on BOTH sides, byte for byte,
 * which is the invariant this pair exists to protect.
 *
 * win32 gets one honest page over each new measurement: 642,048 + 4,096
 * -> 646,000 static, 781,312 + 4,096 -> 785,000 regex. linux and darwin
 * cannot be weighed from this box, so they move by exactly what the
 * change costs here — +512 each — which preserves whatever headroom each
 * had rather than inventing new headroom for a platform nobody measured.
 */
const platform = process.platform;

/** A default-built hello-world: no regex, no engine. */
export const STATIC_CLASS_MAX =
  platform === "linux" ? 397_632 : platform === "win32" ? 646_000 : 366_632;

/** A program that uses regex: libregexp + libunicode, never the engine. */
export const REGEX_CLASS_MAX =
  platform === "linux" ? 552_680 : platform === "win32" ? 785_000 : 519_680;

/** An --dynamic build that actually enters an island carries the engine.
 * A floor rather than a ceiling — the assertion is that the engine IS
 * there, which is true by a wide margin on every container format. */
export const ENGINE_CLASS_MIN = 500_000;
