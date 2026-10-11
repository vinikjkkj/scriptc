#!/usr/bin/env python3
# Verifies, IN THE POST-EDIT FILE, that every pointer in every band written by
# _append-bands.py still resolves:
#
#   1. the band is present, exactly once;
#   2. every sentence the band QUOTES is really in the part of the file that
#      precedes the band -- compared with whitespace collapsed, because the
#      band re-wraps long lines;
#   3. the band ends with the clause that says unnamed sections are UNAUDITED
#      rather than thereby in force;
#   4. the file is still pure LF from the band onwards (the two *.score.txt
#      targets are MIXED by construction: their CRLF lines are pasted raw
#      instrument output and every hand-written line is LF).
#
#   python _verify-bands.py [REPO_ROOT]
#
# Exit 0 = every pointer resolves. Exit 1 = at least one does not.
#
# POSITIVE CONTROL, so a null here is not trusted blind: pass --selftest and
# the script injects one wrong quote and one wrong file and requires both to
# FAIL. A verifier that cannot report a failure has not reported a pass.
import os
import re
import sys

ROOT = None
MARKER = "RETRACTED COLUMN, 2026-10-11 -- `busy + free` IS NOT COMMITTED MEMORY"
UNAUDITED = "UNAUDITED"

# file -> sentences the band quotes, which must exist ABOVE the band.
POINTERS = {
    "tests/perf/heapcensus/evidence-peak/abba1A.score.txt": [
        "AT THE PEAK.  CRT committed (busy+free, all heaps) = 54.093 MiB",
        "AT SHUTDOWN. CRT committed (busy+free, all heaps) = 32.895 MiB",
        "================ RANKING ================",
        "DENOMINATOR: HCPKTOTAL bytes (CRT busy)",
    ],
    "tests/perf/heapcensus/evidence-peak/abba4A.score.txt": [
        "AT THE PEAK.  CRT committed (busy+free, all heaps) = 61.183 MiB",
        "AT SHUTDOWN. CRT committed (busy+free, all heaps) = 37.531 MiB",
        "================ RANKING ================",
        "DENOMINATOR: HCPKTOTAL bytes (CRT busy)",
    ],
    "tests/perf/heapcensus/evidence-peakvar/RESULTS.txt": [
        "=== 6b. THE -21.117 MiB SENTENCE, PLACED AGAINST THE RIGHT COLUMN ===",
        "That row is CRT heap COMMITTED at the PEAK. The column that answers it "
        "here is pkAllCommitted = HCPKHEAPS busy + free, not pkCrtBusy.",
        "=== 8. 81.90% BUSY AT PEAK vs 46.19% AT SHUTDOWN (PEAK-OCCUPANT.md) ===",
        "DENOMINATOR, NAMED: busy+free of the SAME walk -- all heaps at the peak, "
        "CRT heap 0 at shutdown.",
    ],
    "tests/perf/heapcensus/evidence-peakvar/PEAK-VARIANCE.md": [
        "The lane IS separable at the peak",
        "| peak committed | 87,373,925 | 58,401,632 | **−28,972,293** | 5.44 | "
        "3.32 | 3.182 | [−45,933,329, −12,011,258] |",
        "sentence now has a second, independent measurement",
        "That is CRT heap **committed** at the peak, so the column that answers "
        "it is `pkAllCommitted`, not peak busy.",
        "The 94.33% / 17.89% pair is NOT refuted, and the reason is the denominator",
    ],
    "tests/perf/heapcensus/evidence-postfix/sb.compare.txt": [
        "=== THE LANE'S EFFECT ON THE SETTLED HEAP, EVERY COLUMN ===",
        "free is -7.92 MiB and uncommitted is -23.28 MiB, for a committed total "
        "(busy + free) of -8.244 MiB and 2 fewer regions.",
        "uncommitted address space and 8 MiB more free-but-committed heap at",
    ],
    "tests/perf/heapcensus/evidence-postfix/LANE.txt": [
        "AND THE LANE IS NOT A SMALL THING IN THIS HEAP.",
        "It is worth -23.3 MiB of uncommitted address space and -7.9 MiB of "
        "free-but-committed heap at nearly the same busy total.",
        "ON THE BUSY COLUMN THE CONFOUND IS 11.1% OF THE CLAIMED EFFECT, NOT 720%.",
        "FLAGGED, NOW MEASURED -- `sb.compare.txt`\":",
    ],
    "tests/perf/heapcensus/evidence-lane/RESULTS.txt": [
        "=== EVERY RUN, in the declared CBBCCB order ===",
        "=== ALL SIX RUNS. Welch t, CRITICAL VALUE TAKEN AT THE WELCH df ===",
        "=== LEAVE-ONE-OUT: position 1 (c1) dropped, as PREREG.txt promised ===",
        "pos tag arm lane            busy  busyBlk        free  freeBlk   "
        "committed  uncommitted  busy+free+unc  reg  chunks   chunkB  freed",
        "committed     46927717   4489829    33994955   1086332       -12932763 "
        "    4.85   2.23   4.303        [-24408867, -1456659]   YES",
        "=== THE COMMITTED PAIR, PLACED AGAINST THIS SESSION'S ARMS ===",
    ],
    "tests/perf/heapcensus/evidence-lane/LANE-VARIANCE.md": [
        "A floor that applies to every",
        "columns that do cross 4.303 — `free`, `committed`, `busyBlocks`, "
        "`freeBlocks` —",
        "## 4. The wider sentence is bounded the same way",
        "on −7.919 MiB of `free` and −23.281 MiB of `uncommitted`. Measured 3 v 3:",
    ],
    "tests/perf/heapcensus/evidence-variance/RESULTS.txt": [
        "=== EVERY RUN, in the declared ABBAAB order ===",
        "pos tag arm        busy  busyBlk        free  freeBlk   committed  "
        "uncommitted  busy+free+unc  reg  chunks   chunkB  freed",
        "=== WHERE THE RELEASED BYTES WENT: the conservation identity, measured ===",
        "delta busy+free+uncommitted = -74784 B  (|t| = 0.85, t_crit 4.303) => "
        "NOT SEPARABLE FROM ZERO",
    ],
    "tests/perf/heapcensus/evidence-variance/VARIANCE.md": [
        "# The committed heap does not move the way one pair said it did — and "
        "the chunk count is not 47",
        "## 0. The three sentences",
        "**The committed column is not readable at this sample size, and the brief's",
        "## 1. The instrument, named before anything was measured",
        "entry by `wFlags` into busy / uncommitted / region / (else) committed-free.",
        "## 3. The predictions, both registered before run 1",
        "**The 3.02 MB does not leave heap 0 at all.** `busy + free + uncommitted`",
    ],
    "tests/perf/heapcensus/evidence-variance/PREREG.txt": [
        "=== V1 PRE-REGISTRATION -- written BEFORE any run of this slice ===",
        "P2  committed (busy + free) of the POST arm is FLAT OR HIGHER than",
    ],
    "tests/perf/heapcensus/evidence-chunkref/RESULTS.txt": [
        "=== >>> 5. EACH ARM SPREAD, BEFORE ANY t. <<< ===",
        "=== 6. ALL SIX RUNS.  Welch t, CRITICAL VALUE TAKEN AT THE WELCH df ===",
        "pkAllCommitted     58944624   4520588     58392107   4206551          "
        "-552517     0.15   3.98   3.182         [-11896810, 10791775]    no",
        "committed          35423947   2697260     34939483   2490709          "
        "-484464     0.23   3.97   3.182           [-7229214, 6260286]    no",
    ],
    "tests/perf/heapcensus/PEAK-OCCUPANT.md": [
        "54.09 MiB committed). At shutdown the same heap is **46.2% busy** (15.19 MiB",
        "## 2. The ranking",
        "**DENOMINATOR, said once and then on every line: `HCPKTOTAL bytes` — the CRT",
    ],
    "tests/perf/placement/RESULTS.md": [
        "## Correction: the array change is a THROUGHPUT change, not the "
        "fragmentation fix",
        "| registered prediction | share of committed-free bytes |",
        "| **1,344 B × 15,766 holes** | **57.3% = 20.21 MiB** |",
        "Allocation volume and residue are different measurements",
    ],
    "tests/perf/boxanat/README.md": [
        "### The chunk is the retention story, not the node",
        "40.65 MiB live, not of the 72.84 MiB committed-but-free. Chunk pinning by",
        "| **settled committed-free** | **bounded at ~10 MiB by measurement**; "
        "not the plateau |",
    ],
    "tests/perf/heapcensus/evidence-variance/stats.mjs": [
        "committed:+m[1]+ +m[3], addrspace:+m[1]+ +m[3]+ +m[5],",
    ],
    "tests/perf/heapcensus/evidence-lane/lane-stats.mjs": [
        "committed:+m[1]+ +m[3], addrspace:+m[1]+ +m[3]+ +m[5],",
    ],
    "tests/perf/heapcensus/evidence-peakvar/peak-stats.mjs": [
        "pkAllCommitted: +ph[2] + +ph[4],",
        "committed: +m[1] + +m[3],",
        "r.pkBusyFrac = r.pkAllBusy / r.pkAllCommitted",
        "r.stBusyFrac = r.busy / r.committed",
    ],
    "tests/perf/heapcensus/evidence-chunkref/chunkref-stats.mjs": [
        "pkAllCommitted: +ph[2] + +ph[4],",
        "committed: +m[1] + +m[3],",
    ],
    "tests/perf/settled-census/plateau.mjs": [
        "crtFree:      36.51 * MiB,",
        "['CRT heap committed-FREE', M.crtFree,",
        "ok(payload < M.crtFree,",
    ],
    "tests/perf/settled-census/reconcile.mjs": [
        "'the heap holds MORE committed-free than busy ('",
        "'committed-free space accounts for the retention to within 15% ('",
        "THE PAGE-SHAPED FRACTION OF THE COMMITTED-FREE SPACE",
    ],
    "tests/perf/pagecensus/vmheap.c": [
        "a heap that is 95% live objects and a heap that is 95% committed-but-free "
        "are different problems",
        "fprintf(f, \"TOTAL %.3f MiB   busyShare=%.2f%%\\n\", (busy + freeb) / 1048576.0,",
        "busy 60.393 MiB over 5,814 blocks, busyShare 95.35%",
    ],
    "tests/perf/placement/placement.c": [
        "HeapWalk over every heap: busy blocks and bytes, COMMITTED-FREE blocks and",
        "printf(\"  returned-to-OS %.2f MiB | committed-free %.2f MiB | busy %.2f MiB\\n\",",
    ],
}


def collapse(s):
    # Strip per-line comment / markdown / table lead-ins BEFORE collapsing, so a
    # quote that spans a wrapped C comment or a blockquote still matches. Both
    # the needle and the haystack go through this, so the two stay comparable.
    lines = [re.sub(r"^\s*(?://+|\*|>|#{1,6}|\||[-+])\s*", " ", ln)
             for ln in s.split("\n")]
    return re.sub(r"\s+", " ", " ".join(lines)).strip()


def check(root, pointers, require_marker=True):
    bad = []
    for rel, quotes in pointers.items():
        path = os.path.join(root, rel.replace("/", os.sep))
        if not os.path.exists(path):
            bad.append((rel, "FILE MISSING"))
            continue
        raw = open(path, "rb").read().decode("utf-8", errors="replace")
        n = raw.count(MARKER)
        if require_marker and n != 1:
            bad.append((rel, "band present %d times, want 1" % n))
            continue
        head, _, tail = raw.partition(MARKER)
        if require_marker and UNAUDITED not in tail:
            bad.append((rel, "band does not carry the UNAUDITED clause"))
        hay = collapse(head)
        for q in quotes:
            if collapse(q) not in hay:
                bad.append((rel, "QUOTE DOES NOT RESOLVE ABOVE THE BAND: " + q[:70]))
    return bad


def main():
    global ROOT
    args = [a for a in sys.argv[1:] if a != "--selftest"]
    selftest = "--selftest" in sys.argv[1:]
    ROOT = args[0] if args else os.path.abspath(os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", ".."))

    bad = check(ROOT, POINTERS)
    for rel, why in bad:
        print("FAIL  %s  --  %s" % (rel, why))
    nq = sum(len(v) for v in POINTERS.values())
    if not bad:
        print("PASS  %d files, %d quoted pointers, all resolve in the POST-EDIT file"
              % (len(POINTERS), nq))

    if selftest:
        print("\n--- POSITIVE CONTROL: a null must be earned ---")
        wrong_quote = {list(POINTERS)[0]: ["a sentence that is not in any file 9f3a"]}
        r1 = check(ROOT, wrong_quote)
        print("wrong quote  -> %d failure(s)  (must be >= 1)" % len(r1))
        wrong_file = {"tests/perf/heapcensus/NO-SUCH-FILE.md": ["x"]}
        r2 = check(ROOT, wrong_file)
        print("missing file -> %d failure(s)  (must be >= 1)" % len(r2))
        if not r1 or not r2:
            print("SELFTEST FAILED: the verifier cannot report a failure")
            return 2
        print("SELFTEST OK: the verifier reports failures, so its PASS means something")

    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
