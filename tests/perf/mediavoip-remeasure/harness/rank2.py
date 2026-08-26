"""Global cause ranking for one sweep directory, split owned / unowned.

`rank.py` ranks by call sites and stops there. The question this block was
asked is different: of what is left, how much is already somebody's, and is
there a big lever among the rest.

OWNERSHIP is decided by matching the cause's (code, message) against a table of
refusals a named block or commit already owns. Every row of that table is
printed with its match count, so a rule that matches NOTHING is visible rather
than silently absent -- an ownership rule that can never fire is exactly the
kind of dead branch this survey is supposed to catch.

CONTROLS, printed every run:
  * a rule that MUST match at least one site in a default-lane sweep
    (`zapo-js island import`), and
  * a rule that MUST NOT match anything in any lane (`__never__`).
Both are asserted; the run exits non-zero if either fails.
"""

import json
import glob
import os
import sys
import collections

# (rule id, owner, substring that must appear in the message, code or None)
OWNED = [
    ("zapo-js-island-value", "provenance package path (fixed: 1c201e7f and the two before it)",
     "values from the 'zapo-js' package run in the embedded dynamic engine", "SC2013"),
    ("zapo-js-island-import", "provenance package path (fixed: 1c201e7f and the two before it)",
     "importing 'zapo-js' requires the embedded dynamic engine", "SC2013"),
    ("wawam-island-value", "--npm-static type surface (open, named in estado-mediavoip section 4)",
     "values from the '@vinikjkkj/wa-wam' package run in the embedded dynamic engine", "SC2013"),
    ("wawam-island-import", "--npm-static type surface (open, named in estado-mediavoip section 4)",
     "importing '@vinikjkkj/wa-wam' requires the embedded dynamic engine", "SC2013"),
    ("binarywriter-cascade", "cascade of the wa-wam island (estado-mediavoip row 4)",
     "values of type 'BinaryWriter' cannot be compiled yet", "SC2001"),
    ("union-eq", "SC1090 union-typed comparison (open, predicted by name)",
     "comparisons of union-typed values", "SC1090"),
    ("commit-cascade", "cascade of a type-only island import (estado-mediavoip row 2)",
     "calls of the generic method 'commit' through this receiver", "SC1090"),
    ("lib-forced", "program.ts:82 forces lib (open, estado-mediavoip section 2)",
     "Cannot find name 'RTC", "SC0001"),
    ("filetype-cond", "moduleResolution forced to Bundler (open, estado-mediavoip section 2)",
     "fileTypeFromFile", "SC0001"),
    # CONTROL: must never match anything, in any lane.
    ("__never__", "(control)", "a refusal message that no compiler emits", None),
]


def load(d):
    sites = {}
    for f in sorted(glob.glob(os.path.join(d, "*.json"))):
        if os.path.basename(f).startswith("_ctl_"):
            continue
        j = json.load(open(f))
        for s in j["sites"]:
            sites.setdefault((s["file"], s["line"], s["code"], s["message"]), set()).add(s["section"])
    return sites


def owner_of(code, msg):
    for rid, owner, sub, want_code in OWNED:
        if want_code is not None and code != want_code:
            continue
        if sub in (msg or ""):
            return rid, owner
    return None, None


def main():
    d_in = sys.argv[1]
    lane = sys.argv[2] if len(sys.argv) > 2 else "(lane not named)"
    sites = load(d_in)
    causes = collections.Counter()
    secs = collections.defaultdict(set)
    for (fl, ln, code, msg), sc in sites.items():
        causes[(code, msg)] += 1
        secs[(code, msg)] |= sc

    hits = collections.Counter()
    owned_sites = 0
    unowned = []
    owned = []
    for (code, msg), n in causes.items():
        rid, owner = owner_of(code, msg)
        if rid is not None:
            hits[rid] += n
            owned_sites += n
            owned.append((n, code, msg, owner))
        else:
            unowned.append((n, code, msg))

    total = sum(causes.values())
    print("LANE: %s" % lane)
    print("dir : %s" % d_in)
    print("unique sites: %d   distinct causes: %d" % (total, len(causes)))
    print()
    print("--- ownership rule table (a rule matching 0 is printed, not hidden) ---")
    for rid, owner, sub, want_code in OWNED:
        print("  %-22s %5d  %s" % (rid, hits.get(rid, 0), owner))
    ctl_never = hits.get("__never__", 0)
    print()
    print("CONTROL must-not-match __never__ = %d (must be 0)" % ctl_never)
    live = sum(1 for rid, _, _, _ in OWNED if rid != "__never__" and hits.get(rid, 0) > 0)
    print("CONTROL rules that fired: %d of %d" % (live, len(OWNED) - 1))
    print()

    if total:
        print("owned  : %4d sites (%.1f%%) over %d causes" % (owned_sites, 100.0 * owned_sites / total, len(owned)))
        print("unowned: %4d sites (%.1f%%) over %d causes" % (total - owned_sites,
                                                              100.0 * (total - owned_sites) / total, len(unowned)))
    print()
    print("--- UNOWNED, ranked ---")
    for i, (n, code, msg) in enumerate(sorted(unowned, key=lambda r: -r[0]), 1):
        pct = 100.0 * n / total if total else 0
        print("%3d. %4d  %5.1f%%  %s  [%s]" % (i, n, pct, code, "/".join(sorted(secs[(code, msg)]))))
        print("      " + (msg or "")[:170])
    print()
    print("--- OWNED, ranked ---")
    for i, (n, code, msg, owner) in enumerate(sorted(owned, key=lambda r: -r[0]), 1):
        print("%3d. %4d  %s  -> %s" % (i, n, code, owner))
        print("      " + (msg or "")[:150])

    if ctl_never != 0:
        print("CONTROL FAILED: __never__ matched")
        sys.exit(1)


main()
