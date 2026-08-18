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
 *
 * 2026-08-17 — THE BOUNDS DID NOT MOVE, AND THIS TIME THAT IS THE RESULT.
 *
 * Both win32 ceilings had been RED for days, and the pair above cannot say
 * why: a ceiling reports "651264 is not less than 646000" and names no
 * cause, no delta and no owner, so the only cheap response is to raise it.
 * Raising it is also the one response that clears the gate without testing
 * anything, and this pair had been raised four times in three days, three
 * of those times mostly for drift.
 *
 * Bisecting the static assertion over the 108 first-parent merges since the
 * 2026-08-11 calibration (which measured 642,048) names the crossing
 * exactly:
 *
 *   68556310   645,632   last revision under the bound — 368 bytes spare
 *   8eb37c53   649,216   +3,584, first over. Its 68f2e12b put 145 lines of
 *                        base-URL resolution into scr_url.c.
 *
 * scr_url.c was in RUNTIME_SOURCES — unconditional, in every binary the
 * project builds. So the bound was crossed by growing a translation unit
 * that a hello-world links and CANNOT REACH A LINE OF. Weighed:
 *
 *   static hello-world   654,336        16,384 of it scr_url.c (4 pages)
 *   regex program        794,624        16,896 of it scr_url.c
 *
 * and with the unit dropped from the link set both programs link CLEAN.
 * The unit is now link-gated on moduleUsesUrl (backend/cc.ts's `url`), so:
 *
 *   static   654,336 -> 637,952   bound 646,000, was 8,336 OVER, now 8,048 under
 *   regex    794,624 -> 777,728   bound 785,000, was 9,624 OVER, now 7,272 under
 *
 * Both bands go green with the numbers they already had. Note the regex
 * class moved 512 bytes MORE than the static one, exactly as the warning
 * further up this file says it does — measured separately, not derived.
 *
 * -ffunction-sections -fdata-sections -Wl,--gc-sections was tried FIRST and
 * refuted: it recovers 48 bytes of .rdata virtual size and zero bytes of
 * file size. The runtime is densely cross-referenced through static ops
 * tables, so its unreachable code is not linker-dead; it is dead by PROGRAM
 * reachability, which only a gate can see. Do not re-try the flags.
 *
 * Section attribution of the pre-gate 654,336, so the next reader does not
 * start from nothing (file-aligned raw sizes, every byte accounted):
 *
 *   .text 518,144 | .rdata 110,080 | .pdata 22,528 | headers 1,024
 *   .buildid 512 | .data 512 | .tls 512 | .reloc 1,024
 *
 * Of the .text, the 21 always-linked TUs contribute 325,215 bytes; the rest
 * is mingw's static CRT and the program TU. The four biggest always-linked
 * TUs are scr_json.o (105,845 .text), scr_lib.o (46,480), scr_bytes.o
 * (24,649) and scr_string.o (24,085). scr_json.c CANNOT be gated the way
 * scr_url.c was — it holds the scr_dyn_* core and a hello-world's link
 * fails on 16 undefined symbols without it. scr_console.o looks like 66 KB
 * and is not: 65,536 of that is .bss, which costs address space and zero
 * bytes on disk.
 *
 * Still on the table, measured but NOT taken here (one gate at a time, and
 * one is enough to make both bands green): dropping scr_bytes_io.c as well
 * links clean and takes the static class to 625,664, and scr_random_fill.c
 * on top of that to 624,640.
 */
const platform = process.platform;

/** A default-built hello-world: no regex, no engine. */
export const STATIC_CLASS_MAX =
  platform === "linux" ? 397_632 : platform === "win32" ? 646_000 : 366_632;

/** A program that uses regex: libregexp + libunicode, never the engine. */
export const REGEX_CLASS_MAX =
  platform === "linux" ? 552_680 : platform === "win32" ? 785_000 : 519_680;

/* ── the ARMED half of the guard ───────────────────────────────────────
 *
 * The ceilings above protect the DISTANCE between size classes: a 2 KB dyn
 * kind must not be able to hide a 135 KB library or a 620 KB engine. They
 * are deliberately coarse, and being coarse is why they sat red for days
 * saying nothing.
 *
 * These RECORDED figures are the other half, and the loud one. They are
 * what the canonical programs actually weighed when last measured, and the
 * check is TWO-SIDED with a tolerance of one page: a full page of growth
 * fails, and so does a full page of shrink. A shrink matters because it is
 * the failure the ceiling structurally cannot see — this very change is a
 * 16 KB shrink, and no assertion in the suite would have noticed it.
 *
 * When one fails, the fix is never to nudge the number. It is to say in
 * this file what the page BOUGHT, the way every entry above does, and then
 * record the new measurement.
 *
 * win32 only. linux and darwin cannot be weighed from this box, and
 * inventing a figure for a platform nobody measured is the exact mistake
 * the calibrations above keep warning about. Whoever can weigh them should
 * record theirs here; until then they keep the ceilings alone. */
export const SIZE_DRIFT_PAGE = 4_096;

/* 2026-08-18 — SCR_DYN_MAP (the Map/Set dyn kind) joined the same
 * always-linked dyn core, and THE BOUNDS DO NOT MOVE. Measured A/B on two
 * worktrees at the same commit, same toolchain (x86_64-windows-gnu, zig cc
 * 0.16.0, -O2), the two class programs built with default options:
 *
 *   base fb578bc0   637,440 static   777,216 regex
 *   this change     638,976 static   778,240 regex
 *                   +1,536           +1,024
 *
 * against ceilings of 646,000 and 785,000 — 7,024 and 6,760 bytes of
 * headroom left after the change. Neither is reached, and the file's own
 * rule applies: raising a ceiling one has not reached only loosens the
 * canary. So the MAX bounds below are untouched, as they were for
 * SCR_DYN_BIG.
 *
 * The fourth dyn kind in a row costs a page or less (+2,048 OBJINST,
 * +1,536 ARRBUF, +1,536 BIG, +1,536 here), which is now a series worth
 * planning against. This one is at the cheap end for the ARRBUF reason
 * rather than the BIG one: the ScrMap machinery scr_map.c was ALREADY in
 * RUNTIME_SOURCES for every binary, so what the kind adds is the switch
 * arms, three small functions and one payload struct — no new unit and no
 * ops table, because a gated table would have been indirection for a unit
 * that is never gated.
 *
 * The regex class moved 512 bytes LESS than the static one, not more —
 * the third time this pair has moved by different amounts, and the second
 * direction it has done it in. Measured separately, as the warning
 * further up this file demands, and NOT derived from the static delta.
 *
 * One number worth carrying that is nobody's change: base measures 637,440
 * here against the 637,952 RECORDED on 2026-08-17, i.e. main is 512 bytes
 * BELOW its own anchor. The drift page absorbed it silently in both
 * directions. The RECORDED figures below are re-anchored to THIS
 * measurement so the next reader's ±4,096 is measured from something true,
 * which is the whole lesson of the 2026-08-17 bisection above.
 *
 * linux and darwin cannot be weighed from this box. They keep the ceilings
 * alone (there is nothing to move: no bound tipped), for the reason every
 * calibration above gives. */

/** The static hello-world, measured 2026-08-18 (x86_64-windows-gnu, zig cc
 * 0.16.0, -O2), after SCR_DYN_MAP. Base at fb578bc0 weighed 637,440 in the
 * same run; the +1,536 is the kind. */
export const STATIC_CLASS_RECORDED = platform === "win32" ? 638_976 : null;

/** The regex program, measured in the same run on the same tree. Base
 * weighed 777,216; the +1,024 is the kind, and it is deliberately NOT the
 * static delta. */
export const REGEX_CLASS_RECORDED = platform === "win32" ? 778_240 : null;

/** The complaint a recorded-figure check makes, or null when the size is
 * within one page of what was recorded. A string rather than a thrown
 * error so the caller supplies the assertion — and so this function is
 * itself testable, which is what "armed" means: size-class-armed.test.ts
 * plants a page and requires a complaint back. */
export function recordedSizeComplaint(
  what: string,
  actual: number,
  recorded: number | null,
  page: number = SIZE_DRIFT_PAGE,
): string | null {
  if (recorded === null) return null;
  const delta = actual - recorded;
  if (Math.abs(delta) < page) return null;
  const dir = delta > 0 ? "GREW" : "SHRANK";
  return (
    `${what} ${dir} by ${Math.abs(delta)} bytes: ${actual} against the recorded ${recorded} ` +
    `(tolerance one ${page}-byte page; this is ${(Math.abs(delta) / page).toFixed(2)} of one).\n` +
    `This is not a number to nudge. Find what the bytes bought — an always-linked runtime TU that ` +
    `grew, or a new one that a program which cannot reach it now links — and WRITE IT IN ` +
    `tests/harness/size-class.ts beside the other calibrations, then record the new figure. ` +
    `A ${dir === "GREW" ? "growth" : "shrink"} nobody explains is how this pair stopped meaning ` +
    `anything before.`
  );
}

/** An --dynamic build that actually enters an island carries the engine.
 * A floor rather than a ceiling — the assertion is that the engine IS
 * there, which is true by a wide margin on every container format. */
export const ENGINE_CLASS_MIN = 500_000;
