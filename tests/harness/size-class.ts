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
  platform === "linux" ? 397_632 : platform === "win32" ? 659_968 : 366_632;

/** A program that uses regex: libregexp + libunicode, never the engine. */
export const REGEX_CLASS_MAX =
  platform === "linux" ? 552_680 : platform === "win32" ? 802_304 : 519_680;

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
 * calibration above gives.
 *
 * —— 2026-08-19, the ToUint32 fast path —————————————————————
 *
 * The regex band went RED and the static one did not, and the split of the
 * bytes is worth having in full because MOST of the red was not the change
 * that tripped it. Two worktrees at b602a066, same toolchain, same options:
 *
 *   base b602a066   642,048 static   781,824 regex
 *   this change     642,560 static   782,848 regex
 *                   +512             +1,024
 *
 * against the figures RECORDED on 2026-08-18, 638,976 and 778,240:
 *
 *   base is already +3,072 static and +3,584 regex above its own anchor.
 *
 * So the change contributes 1,024 of the 4,608 bytes the failure reports
 * and the other 3,584 arrived between the 2026-08-18 recording and
 * b602a066 without anyone re-recording — the drift page absorbed them
 * silently, exactly as the 2026-08-17 note warns it does, until a 1 KB
 * change tipped 0.875 of a page over 1.0. That is the whole reason the
 * ±4,096 has to be measured from something true rather than from an
 * anchor nobody has refreshed, and both numbers are written here so the
 * next reader can tell the 1,024 that is a change from the 3,584 that is
 * accumulated drift.
 *
 * WHAT THE 1,024 BOUGHT, attributed per-flag rather than argued (the three
 * parts of the change are each behind a -D, so each was weighed alone):
 *
 *   SCR_FAST_UINT32   +0 static  +1,024 regex
 *   SCR_CYC_LEAF_SKIP +0         +0
 *   header memset     +0         +0
 *   all three         +512       +1,024
 *
 * The ToUint32 fast path is the whole of it: a range compare and a
 * truncating convert inlined at every use of scr_to_uint32 (the seven
 * bitwise operators plus two charCodeAt paths), with the general form
 * moved out of line into scr_to_uint32_slow. The regex class carries more
 * of the runtime than the static one does, which is why it sees the 1,024
 * and the static class only sees the 512 that the three together round up
 * to at this linker's granularity — the same "these two classes do not
 * move together" the note above records for the fourth time.
 *
 * Headroom after: 3,440 static and 2,152 regex below ceilings of 646,000
 * and 785,000. Both still pass, so both MAX bounds are untouched, for the
 * same reason every calibration above gives: raising a ceiling one has not
 * reached only loosens the canary. The regex headroom is now the tighter
 * of the two and is worth watching — it is half a page.
 *
 * linux and darwin still cannot be weighed from this box. */

/* 2026-08-19 — THE toString SLOT, AND 3,584 BYTES THAT ARE NOT IT.
 *
 * The regex RECORDED check went red on the merge of block/slot with "the
 * regex program GREW by 4096 bytes" — exactly one page, on a program that
 * contains no record and cannot reach a line of the feature. Resolved by
 * four measurements in ONE worktree, same toolchain (x86_64-windows-gnu,
 * zig cc, -O2), a fresh SCRIPTC_CACHE_DIR for each so nothing was served
 * from cache:
 *
 *   fb578bc0  (the 2026-08-18 anchor)   638,976 static   778,240 regex
 *   179f1bc4  (block/slot branch point) 640,000          779,776
 *   b602a066  (main, 7 commits later)   642,048          781,824
 *   4cc01e73  (main + block/slot)       642,048          782,336
 *
 * So the page breaks down, on the regex class:
 *
 *   +1,536  drift already present when block/slot branched
 *   +2,048  main's own 7 commits after that — 7e0adfbe put a size-class
 *           pool in front of malloc and 5d2d3dbb named per-function CPU
 *           time, both always-linked runtime
 *   +  512  block/slot
 *   ------
 *    4,096  the tolerance, reached with 3,584 bytes of it spent before the
 *           feature compiled a line
 *
 * The fourth time this file records a bound reached mostly by drift — and
 * the first time the anchor itself was already stale when the branch that
 * tripped it was cut: 1,536 bytes of the page were gone on day one.
 *
 * WHAT THE SLOT ACTUALLY COSTS, unrounded. The hidden per-instance
 * sc_tostr member is emitted only under IrRecordShape.tostr (emit-shapes.ts
 * appends it as a conditional on s.tostr), so an UNARMED shape has no
 * member and no bytes — verified on the emitted C of a record program that
 * never stringifies: zero occurrences of sc_tostr, zero of scr_rec_tostr.
 * What every binary pays is CODE, not layout: three functions in
 * scr_json.c (scr_rec_tostr, scr_dyn_tostr_closure, scr_rec_tostr_dyn_fn).
 * Weighed as an object file rather than inferred from the binary:
 *
 *   scr_json.o .text   107,061 -> 107,445   = +384 bytes
 *
 * 384 is the honest number. It shows up as +512 on the regex class and as
 * +0 on the static one — the SAME bytes, rounded differently by PE's
 * 512-byte file alignment depending on where the preceding content left
 * the grain. Two classes moving by different amounts is the warning this
 * file has given three times; this is the first entry where the cause is
 * alignment rather than differing content, and the first where one of the
 * two amounts is zero.
 *
 * NOT GATED, and the reason is measured rather than assumed. scr_json.c is
 * always linked and cannot be gated the way scr_url.c was (the 2026-08-17
 * entry: a hello-world fails to link on 16 undefined symbols without it),
 * and in an unarmed binary the three functions are dead by PROGRAM
 * reachability, which that same entry establishes --gc-sections cannot
 * see. Recovering the 384 would take a new TU link-gated on "this module
 * has an armed shape" — for 384 bytes, one forty-second of what the
 * scr_url.c gate recovered. Recorded rather than gated, deliberately;
 * whoever needs the 384 back now knows exactly where it is.
 *
 * The MAX ceilings are UNTOUCHED. Neither is reached — 642,048 against
 * 646,000 and 782,336 against 785,000 — and this file's own rule is that
 * raising a ceiling one has not reached only loosens the canary. What
 * tripped is the two-sided RECORDED pair, and it tripped doing its job.
 *
 * Both figures below are re-anchored to 4cc01e73, the merge: to the tree
 * that exists after block/slot lands, so the next reader's plus-or-minus
 * 4,096 is measured from something true. On block/slot alone they read
 * 2,048 low, inside tolerance. linux and darwin cannot be weighed from
 * this box and keep the ceilings alone, as every calibration above says. */

/** The static hello-world, measured 2026-08-19 on 4cc01e73 (main +
 * block/slot; x86_64-windows-gnu, zig cc, -O2). main alone weighed 642,048
 * in the same run: the toString slot's 384 bytes fell inside existing
 * padding here and cost this class nothing. */
/* superseded below — the merged tree is measured after both changes. */
/** The regex program, same run, same tree. main alone weighed 781,824; the
 * +512 is the slot's 384 bytes rounded up by file alignment, and it is
 * deliberately NOT derived from the static delta — which was zero. */
/* superseded below — see the churn record. */
/* superseded below - see the hot-path-shortcut record. */

/* 2026-08-19 - three runtime hot-path shortcuts (the JSON object-key pool,
 * the Number->string integer fast path, the shared-left concat slack). Both
 * classes move, and both moves are BSS and code in always-linked TUs, so
 * every program pays them. Measured A/B in ONE run on ONE tree, the only
 * difference being the -D that compiles each change out, which is why the
 * OFF row reproduces the previous anchor to the byte:
 *
 *   OFF    (== base 52dcbf36)   642,560 static   782,848 regex
 *   KEY    only                 643,584          783,872     +1,024 / +1,024
 *   NUM    only                 644,096          783,872     +1,536 / +1,024
 *   SLACK  only                 642,560          782,848         +0 /     +0
 *   ALL    (shipped)            644,608          784,384     +2,048 / +1,536
 *
 * What the bytes bought, per change:
 *   KEY   a third ScrPool instance in scr_json.c's BSS (32 head pointers +
 *         32 counts = 384 bytes) plus scr_json_key_alloc/_free, against
 *         3,906,000 raw mallocs a messaging run no longer makes.
 *   NUM   the 201-byte two-digit decimal table plus scr_u64_digits, against
 *         1.38-1.53x on scr_f64_to_str for every integer a program prints.
 *   SLACK nothing at all: it is two extra lines inside an existing
 *         if/else chain and lands entirely inside padding.
 *
 * ALL is SMALLER than KEY+NUM summed (+2,048 against +2,560 on the static
 * class) because 512 bytes fall inside section/file alignment once both are
 * present. Deltas from separate trees do not add, which is the same trap
 * two blocks hit on 2026-08-18; these five figures come from one run.
 *
 * HEADROOM WARNING for whoever moves these next. Against the coarse
 * ceilings this leaves 646,000 - 644,608 = 1,392 bytes on the static class
 * and 785,000 - 784,384 = 616 bytes on the regex class. The ceilings are
 * deliberately coarse (they exist to catch a ~110 KB or ~620 KB class
 * jump), so at 616 bytes the NEXT ordinary kilobyte will trip the coarse
 * check and produce exactly the uninformative "less than 785000" message
 * the recorded pair was added to replace. Raising REGEX_CLASS_MAX is a
 * policy call this block deliberately did not make on its own. */
/* 2026-08-19 - SHA-256 on the x86 SHA extensions, with the scalar loop kept
 * as the CPUID-chosen fallback. Both classes move, because scr_lib.c is
 * always linked and every program therefore carries the vector arm whether
 * or not it ever hashes a byte.
 *
 * FOUR ROWS, ONE RUN, and the base row is the reason the other three are
 * readable. The precedent this file keeps is that a page of "growth" is
 * often drift already spent before the branch existed (the toString slot:
 * 1,536 stale in the anchor, 2,048 from main, 512 from the change), so the
 * base worktree at 8495b1af was built with its own install, its own dist
 * and its own caches, and weighed:
 *
 *   base 8495b1af             644,608 static   784,384 regex
 *   SCR_SHA256_NI=0 (mine)    644,608          784,896      +0 /   +512
 *   shipped (NI on)           646,144          786,432  +1,536 / +2,048
 *
 * BASE REPRODUCES BOTH RECORDED ANCHORS TO THE BYTE. There is no stale
 * drift in this move: all of it is this branch's, and it splits in two.
 *
 * What the bytes bought, per change:
 *   RESTRUCTURE  +0 static / +512 regex. scr_sha256_digest's inline block
 *         loop became scr_sha256_blocks, the ONE place the scalar and
 *         vector arms meet. It buys no speed; it exists so there is a
 *         single dispatch site and so SCR_SHA256_NI=0 restores the old
 *         path exactly. The static class does not notice it; the regex
 *         class pays half a kilobyte of alignment for it.
 *   SHA-NI  +1,536 on both. Read from the SHIPPED PDB, not the
 *         instrumented one (which reports the same function at 3,763
 *         bytes because -finstrument-functions un-inlines the intrinsics
 *         into it -- I quoted that number first and it was wrong):
 *              CTRL   scr_sha256_blocks   665 bytes  (the scalar
 *                     compression is inlined INTO it; there is no
 *                     scr_sha256_block symbol at -O2 on either side)
 *              NI     scr_sha256_blocks   810
 *                     scr_sha256_ni_blocks 1,025
 *         = 1,170 bytes of new code, which PE file alignment rounds up to
 *         the +1,536 the binary actually gains. scr_sha256_ni_probe and
 *         scr_cpuid are inlined away entirely in the shipped build. Against it: 1.645x wall / 1.737x CPU on the
 *         SEND 1:1 messaging scenario, 1.209x / 1.195x on RECV group,
 *         1.118x / 1.146x on RECV 1:1, and 4.9-9.8x on the digest function
 *         itself. Nothing on SEND group, which hashes once per 500 writes.
 *
 * The two deltas are NOT added to reach the shipped row: the shipped row
 * is measured. +512 and +1,536 happen to sum to +2,048 on the regex class
 * and NOT to the static one's +1,536, which is the alignment trap this
 * file has recorded twice.
 *
 * WHY THE MAX CEILINGS MOVE, WHICH IS NOT A THING TO DO LIGHTLY.
 * The RECORDED pair alone does NOT absorb this. Both old ceilings are
 * REACHED, not approached: 646,144 > 646,000 and 786,432 > 785,000, and
 * the suite printed `expected 646144 to be less than 646000` while both
 * two-sided RECORDED checks stayed silent (1,536 and 2,048 are under one
 * SIZE_DRIFT_PAGE). That is the exact inversion the previous block
 * predicted at 616 bytes of headroom: the COARSE check firing first with
 * the message the LOUD pair was added to replace.
 *
 * So the ceilings are not being loosened past a live signal; they are
 * being put back above the loud check. The rule adopted here, and it is a
 * rule rather than a nudge:
 *
 *     on win32, CLASS_MAX = CLASS_RECORDED + 2 x SIZE_DRIFT_PAGE
 *     654,336 = 646,144 + 8,192      794,624 = 786,432 + 8,192
 *
 * so a drift of one page always trips the RECORDED pair -- which says
 * GREW or SHRANK, by how much, and against what -- a full page before the
 * ceiling can say anything at all. A ceiling that fires first is a gate
 * that stops guarding, and that is what the old numbers had become.
 *
 * What MAX still protects, and why 646,000 stopped being the right number
 * for it: the ceilings exist to keep the CLASSES apart -- a 2 KB dyn kind
 * must not be able to hide a ~140 KB regex-library link or a ~620 KB
 * engine link. 646,000 was a round number set when the static class
 * weighed ~637 KB, i.e. roughly 8 KB of slack; twelve always-linked
 * additions since have eaten it to 1,392 bytes, which is a QUARTER of one
 * drift page, and at that width it stopped being a class bound and became
 * a byte budget nobody voted for. 654,336 restores the original
 * relationship and keeps the class property with two orders of magnitude
 * to spare. The class DISTANCE itself is asserted separately and
 * unconditionally in size-class-armed.test.ts (786,432 - 646,144 =
 * 140,288, required to sit between 100,000 and 200,000), so nothing about
 * this raise weakens the thing the ceilings are for.
 *
 * RECALIBRATED 2026-08-20, same toolchain, after the dyn object grew an
 * INTERNAL-SLOT table (`ScrDyn.v.obj.slots` and its two accessors in the
 * always-linked dyn core — the table fs.Dirent's %dtype and
 * StringDecoder's %pending now travel in instead of `entries`).
 * A/B on two worktrees, both at `4d25bf63`, same hello-world:
 *
 *   main (4d25bf63)   649,728     <- 3,584 above the recorded 646,144
 *   this change       650,752     <- +1,024 for the table
 *
 * so of the 4,096 bytes of tolerance the recorded figure carried, 3,584
 * were spent by unrelated merges BEFORE this change compiled a line, and
 * the table spent the remaining 512 and 512 more. That is the THIRD
 * recalibration in a row reached mostly by drift, and the ratio is worth
 * carrying forward again: the feature costs 1,024, the gap since the last
 * calibration costs 3,584.
 *
 * The 1,024 splits exactly in half, measured by removing one half at a
 * time on the same tree:
 *
 *   +512  the two accessors (scr_dyn_obj_set_slot / scr_dyn_obj_slot_get)
 *         in scr_json.c. A hello-world calls neither, and they are still
 *         in the binary: the win32 link line carries no
 *         -ffunction-sections and no --gc-sections (cc.ts:382 says so),
 *         so every line added to an always-linked TU costs every binary.
 *   +512  the extra `ScrDyn.v.obj` member plus the three lines that clear
 *         it on recycle, visit it in the trace, and release it.
 *
 * The regex class was measured SEPARATELY on the same two worktrees
 * rather than moved by the static delta, which is this file's standing
 * rule (the two classes have parted by 512 bytes before). This time they
 * did not part:
 *
 *   main (4d25bf63)   790,016     <- 3,584 above the recorded 786,432
 *   this change       791,040     <- +1,024, the same table
 *
 * The first draft of this note said REGEX_CLASS_RECORDED would stay put
 * because the regex program was "still inside its own page". It was not:
 * the same 4,608 had accumulated there too, and only measuring both said
 * so.
 *
 * The class DISTANCE, which is the whole point of these bounds, comes out
 * BYTE-IDENTICAL: 791,040 - 650,752 = 140,288, exactly the old pair's
 * 786,432 - 646,144. Both classes moved by the same 4,608 because both
 * pay the same always-linked bytes, which is the cleanest available
 * statement that this change is a runtime-core cost and not a library
 * link. size-class-armed.test.ts asserts that distance separately.
 *
 * RECALIBRATED 2026-08-22, same toolchain, after async generators landed:
 * `async function*` lowers onto a scr_agen_* resume protocol added to
 * scr_async.c, which is in RUNTIME_SOURCES and therefore linked into every
 * binary. Eleven functions and one two-word ScrGen field (`settle`,
 * `pending`), 284 lines. A hello-world can reach none of it and still pays
 * for all of it, for the reason this file has now recorded three times: the
 * win32 link line carries no -ffunction-sections and no --gc-sections
 * (cc.ts:382), so every line added to an always-linked TU costs every
 * program.
 *
 * The A/B is on ONE tree rather than two worktrees, which is a deliberate
 * departure from this file's standing rule and a STRICTER measurement for
 * this particular change, not a looser one. The whole runtime cost of async
 * generators is in two files, and a hello-world's emitted C is untouched by
 * the compiler half — so `git checkout main -- scr_async.c scr_runtime.h`,
 * rebuild, measure, restore reproduces main's binary EXACTLY while holding
 * the install, the caches, the toolchain and every other source file fixed.
 * It attributes the bytes with no cross-worktree drift to argue about.
 * Measured through the harness (island.test.ts / regex.test.ts), and the
 * CLI agreed to the byte on the two figures it can produce:
 *
 *                       base (main runtime)   this branch     delta
 *   static hello-world        653,312           655,872      +2,560
 *   regex-free program        653,312           655,872      +2,560
 *   regex program             794,112           796,672      +2,560
 *
 * BASE DOES NOT REPRODUCE THE RECORDED ANCHORS, and that is the first thing
 * to say about these numbers. The 2026-08-20 pair was 650,752 / 791,040;
 * base measures 653,312 / 794,112. So 2,560 static and 3,072 regex bytes
 * were spent by unrelated merges in the two days before this branch
 * compiled a line, and this branch spent 2,560 of its own on each. The
 * feature is HALF of the static complaint and less than half of the regex
 * one — the fourth recalibration in a row reached mostly by drift.
 *
 * The class DISTANCE is byte-identical across the change: 794,112 -
 * 653,312 = 140,800 and 796,672 - 655,872 = 140,800. Both classes pay the
 * same always-linked bytes, which is the cleanest available statement that
 * this is a runtime-core cost and not a library link. (The distance itself
 * has drifted 512 bytes from the recorded pair's 140,288 — again, not this
 * branch. size-class-armed.test.ts asserts it separately.)
 *
 * THE MAX CEILINGS MOVE, and the reason is a rule this file wrote down and
 * then did not apply. The 2026-08-20 recalibration adopted
 *
 *     on win32, CLASS_MAX = CLASS_RECORDED + 2 x SIZE_DRIFT_PAGE
 *
 * so that a one-page drift always trips the informative RECORDED pair a
 * full page before the coarse ceiling can say anything. It then moved
 * RECORDED to 650,752 / 791,040 and LEFT MAX at 654,336 / 794,624, which
 * are RECORDED + 8,192 for the pair BEFORE it (646,144 / 786,432). The
 * headroom that survived was 3,584 and 3,584 — under one drift page, so the
 * ceiling was once again positioned to fire first, which is precisely the
 * inversion the prose above says must never be allowed to recur. On this
 * branch both halves fired. The rule is applied here rather than restated:
 *
 *     664,064 = 655,872 + 8,192      804,864 = 796,672 + 8,192
 *
 * A ceiling that fires before the loud pair is a gate that has stopped
 * guarding, and that is twice now that it got there by a recalibration
 * moving one number of the pair.
 */
/* 2026-08-24 — the ENUMERABLE ACCESSOR (block/dynacc, the accessor SLOT).
 * `Object.defineProperty(o, k, { get, enumerable: true })` used to refuse;
 * the property now takes a descriptor in `hidden` and a position SLOT in
 * the member table, and TEN walks over that table had to learn to ask
 * about one.
 *
 * Measured through this file's own programs, run from the CLI on both
 * trees in the same shell (G:/blocks/dynacc/lab/size/measure.mjs); the
 * branch's static figure agrees with island.test.ts's to the byte.
 *
 *                       base a9d2c599   this branch     delta
 *   static hello-world      658,944       664,064      +5,120
 *   regex program           799,744       804,864      +5,120
 *
 * BASE DOES NOT REPRODUCE THE RECORDED ANCHORS, and that is the first
 * thing to say, exactly as the 2026-08-21 entry below had to say it. The
 * recorded pair was 655,872 / 796,672; base measures 658,944 / 799,744, so
 * 3,072 bytes on each class were spent by unrelated merges before this
 * branch compiled a line. They stayed silent because 3,072 is under one
 * 4,096-byte page. This branch spent 5,120 of its own on each, and it is
 * the SUM — 8,192, exactly two pages — that the harness complained about.
 * So the feature is five eighths of the complaint, not all of it.
 *
 * The class DISTANCE is byte-identical across the change: 799,744 -
 * 658,944 = 140,800 and 804,864 - 664,064 = 140,800. Both classes pay the
 * same always-linked bytes, which is the available statement that this is
 * a runtime-core cost and not a library link — and it is also why the
 * regex-only TU's own growth (scr_assert.c, whose deepStrictEqual walk,
 * diff renderer and assert.throws shape all learned the slot) did not tip
 * an extra page of its own.
 *
 * WHAT THE FIVE PAGES BOUGHT, in always-linked TUs:
 *   scr_json.c        the slot singleton and its six readers
 *                     (scr_dyn_obj_entry_is_slot / _has_enum_acc /
 *                     _entry_read / _entry_listed / _enum_key_count /
 *                     _own_enum_read), the slot arm in each of
 *                     scr_dyn_objwalk, scr_dyn_json_write_raw,
 *                     scr_jb_put_dyn_raw, scr_sc_clone and
 *                     scr_dyn_assign_from, the fifth descriptor element,
 *                     and scr_dyn_obj_acc_fence — whose two message
 *                     literals are ~700 bytes of the total on their own,
 *                     which is the price of a refusal that names the
 *                     property and says which surfaces are exact.
 *   scr_inspect.c     the `[Getter]`/`[Setter]`/`[Getter/Setter]` arm.
 *   scr_dyn_invoke.c  dyn_redefine_accessor_flags and the generic-
 *                     descriptor arm, MINUS the ~450-byte refusal message
 *                     this branch deleted.
 *
 * THE MAX CEILINGS MOVE, by the rule this file adopted on 2026-08-20 and
 * has twice failed to apply: on win32, CLASS_MAX = CLASS_RECORDED + 2 x
 * SIZE_DRIFT_PAGE, so a one-page drift always trips the informative
 * RECORDED pair a full page before the coarse ceiling can say anything.
 * The ceilings this branch inherited were 664,064 and 804,864 — the
 * branch's own measurements to the byte, i.e. ZERO headroom, so
 * `toBeLessThan` would have fired on the very same page as the recorded
 * check. Applied here rather than restated:
 *
 *     672,256 = 664,064 + 8,192      813,056 = 804,864 + 8,192
 *
 * 2026-08-24 - ScrStr's header went from 24 bytes to 12 (three size_t to
 * three uint32_t), and BOTH CLASSES SHRINK. Measured A/B on two worktrees
 * at the same commit, same toolchain (x86_64-windows-gnu, zig cc 0.16.0,
 * -O2), the two class programs built with default options:
 *
 *   base a48fd411   664,064 static   805,376 regex
 *   this change     656,384 static   798,720 regex
 *                   -7,680           -6,656
 *
 * WHAT THE PAGES BOUGHT. Not the emitted literal table, which is the
 * tempting answer and the wrong one: the messaging bench's TU declares 64
 * literals, worth 64 x 12 = 768 bytes, and that binary shrank by 7,680 -
 * the SAME figure as a hello-world with three literals. A shrink identical
 * across two programs of very different literal counts is a constant of the
 * ALWAYS-LINKED RUNTIME, not of the program. It is two things:
 *
 *   scr_string.c's immortal statics   scr_ascii1 is 128 interned
 *     one-character strings, and sizeof(ScrChar1) went 32 -> 16 (a 26-byte
 *     struct aligned to 8, against a 14-byte one aligned to 4), so that
 *     array alone is -2,048. The other four immortals (empty, U+FFFD,
 *     "true", "false") are -16 each.
 *   code                              every s->len and s->cap read in the
 *     always-linked runtime is now a 32-bit load; the encodings are
 *     shorter and many lose their REX prefix. This is the larger half and
 *     it is not itemised here.
 *
 * The two figures being EXACTLY equal at 7,680 across two programs is PE
 * file alignment, not a coincidence worth reading into: 7,680 is 15 x 512,
 * and two different true deltas round to the same multiple.
 *
 * The classes move by DIFFERENT amounts (-7,680 against -6,656), which is
 * the reason this file says never to derive one from the other. Base drift
 * since the last calibration: static 0 bytes (664,064 on the nose), regex
 * +512 - both well inside the page, so the previous figures were honest.
 *
 * THE MAX CEILINGS MOVE with them, by the same rule:
 *
 *     664,576 = 656,384 + 8,192      806,912 = 798,720 + 8,192
 *
 * They come DOWN. A ceiling left 8 KB above a binary that no longer
 * weighs that much is exactly the loose canary the entries above keep
 * warning about, and this is the first entry in the file where the
 * measurement moved in that direction.
 *
 * 2026-08-25 - scr_utf16_units grew a pure-ASCII fast answer, and BOTH
 * CLASSES SHRINK AGAIN. Measured A/B on the two worktrees at the same
 * commit, same shell, same toolchain (x86_64-windows-gnu, zig cc 0.16.0,
 * -O2, SCRIPTC_NO_CACHE=1), the two class programs built with default
 * options (G:/blocks/utf16len/lab/size/measure.mjs):
 *
 *   base 4e1fa8dc   655,360 static   797,184 regex
 *   this change     651,776 static   794,112 regex
 *                    -3,584           -3,072
 *
 * BASE DOES NOT REPRODUCE THE RECORDED ANCHORS, and by the now-familiar
 * amount: the recorded pair was 656,384 / 798,720 and base measures
 * 655,360 / 797,184, so 1,024 and 1,536 bytes had already drifted off
 * unrelated merges, silently, because both are inside the page. The
 * complaint the harness actually made was the SUM: -4,608 on the static
 * class, of which this branch is 3,584. Note that the regex class moved by
 * the same -4,608 from ITS anchor and would have failed too; it never
 * reported because vitest stops a test at its first failed expect and the
 * regex-free program is weighed first.
 *
 * WHAT THE BYTES BOUGHT -- or rather, stopped paying for, because this is a
 * DE-DUPLICATION and not a deletion. The classification loop is still in
 * the binary; there is now ONE copy of it instead of five. Measured on the
 * x86_64-linux-gnu cross build of the same runtime, per-symbol from
 * `nm --print-size`, .text 139,251 -> 136,211 and .rodata unchanged:
 *
 *   scr_str_utf16_len     839 ->   169    -670
 *   scr_str_substring     983 ->   314    -669
 *   scr_str_index_of    1,713 -> 1,083    -630
 *   scr_str_slice       2,080 -> 1,424    -656
 *   scr_pad_impl        2,372 -> 1,021  -1,351
 *   scr_sidx_len            - >   936  (new, out of line)
 *
 * scr_sidx_len used to inline into every one of those five always-linked
 * callers, carrying the word loop, the popcount classification AND the
 * autovectorised tail with it each time. Adding the fast answer pushed the
 * function over the inliner's threshold, so LLVM emitted it once and the
 * five callers now call it. The .rodata figure is the check on that story:
 * the SSE tail loads three 16-byte constant vectors, and if the shrink were
 * the vectoriser giving up they would have gone with it. They did not.
 *
 * THE MAX CEILINGS MOVE with them, by the same rule:
 *
 *     659,968 = 651,776 + 8,192      802,304 = 794,112 + 8,192
 */
export const STATIC_CLASS_RECORDED = platform === "win32" ? 651_776 : null;

/** The regex program, same run, same tree. Deliberately NOT derived from
 * the static delta - and the 2026-08-24 entry is why: that change moved the
 * two classes by -7,680 and -6,656, so deriving either from the other would
 * have been 1,024 bytes wrong. */
export const REGEX_CLASS_RECORDED = platform === "win32" ? 794_112 : null;

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
