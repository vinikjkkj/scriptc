"""Site-for-site diff of two sweep directories.

Paths are normalised at `/app/` so a sweep run from a different block root is
comparable with the committed `sites-default/`, which was recorded under
`G:/blocks/mediavoip/lab/app/`. Nothing else about a site is normalised: the
key stays (file, line, code, message), exactly as `rank.py` dedupes it.

Usage:  compare.py BEFORE_DIR AFTER_DIR [--causes]

CONTROL ROWS, printed every run so a "no difference" result can be trusted:
  * a key that MUST match     -- one site taken from BEFORE that is also in
    AFTER (or, if the sets are disjoint, that is stated explicitly)
  * a key that MUST NOT match -- a synthetic site that is in neither corpus
  If the must-not key is ever reported as present, the comparison is wrong.
"""

import json
import glob
import os
import sys
import collections

SYNTH = ("__nonexistent__/never.ts", 999999, "SCZZZZ", "a synthetic site that is in no corpus")


import re

_COMMIT = re.compile(r"/[0-9a-f]{40}/")


def norm(p):
    """Block-root-independent site path.

    Two things vary between blocks and must not make identical sites look
    different: the lab-app root (`.../<block>/lab/app/`) and the provenance
    cache root (`.../<block>/prov/<40-hex commit>/`). Both are folded away;
    the provenance path keeps a `prov:` tag so a zapo-js source site is never
    confused with a corpus site of the same relative name.
    """
    if p is None:
        return None
    p = p.replace(chr(92), "/")
    m = _COMMIT.search(p)
    if m is not None:
        return "prov:" + p[m.end():]
    i = p.find("/app/")
    return p[i + 5:] if i >= 0 else p


def load(d):
    sites = {}
    stats = {}
    for f in sorted(glob.glob(os.path.join(d, "*.json"))):
        b = os.path.basename(f)[:-5]
        if b.startswith("_ctl_"):
            continue
        j = json.load(open(f))
        stats[b] = {
            "preflightFailed": j.get("preflightFailed"),
            "stats": j.get("stats"),
            "n": len(j["sites"]),
            "prov": j.get("provenanceNotes"),
        }
        for s in j["sites"]:
            key = (norm(s["file"]), s["line"], s["code"], s["message"])
            sites.setdefault(key, set()).add(s["section"])
    return sites, stats


def causes(sites):
    c = collections.Counter()
    for (fl, ln, code, msg) in sites:
        c[(code, msg)] += 1
    return c


def main():
    a_dir, b_dir = sys.argv[1], sys.argv[2]
    A, As = load(a_dir)
    B, Bs = load(b_dir)

    print("BEFORE %s: %d unique sites, %d causes, %d modules" % (a_dir, len(A), len(causes(A)), len(As)))
    print("AFTER  %s: %d unique sites, %d causes, %d modules" % (b_dir, len(B), len(causes(B)), len(Bs)))
    print()

    # ---- control rows ----
    both = sorted(set(A) & set(B))
    if both:
        k = both[0]
        print("CONTROL must-match : PRESENT in both -> %s:%s %s" % (k[0], k[1], k[2]))
    else:
        print("CONTROL must-match : the two site sets are DISJOINT -- no shared site exists")
    print("CONTROL must-not    : synthetic key in A=%s B=%s (both must be False)"
          % (SYNTH in A, SYNTH in B))
    print()

    only_a = set(A) - set(B)
    only_b = set(B) - set(A)
    print("sites only in BEFORE (fixed): %d" % len(only_a))
    print("sites only in AFTER  (new):   %d" % len(only_b))
    print()

    ca, cb = causes(A), causes(B)
    rows = sorted(set(ca) | set(cb), key=lambda k: (-(cb.get(k, 0) - ca.get(k, 0)), -ca.get(k, 0)))
    print("%-8s %6s %6s %7s  %s" % ("code", "before", "after", "delta", "message"))
    for (code, msg) in rows:
        na, nb = ca.get((code, msg), 0), cb.get((code, msg), 0)
        if na == nb:
            continue
        print("%-8s %6d %6d %+7d  %s" % (code, na, nb, nb - na, (msg or "")[:120]))
    print()
    print("unchanged causes: %d" % sum(1 for k in set(ca) | set(cb) if ca.get(k, 0) == cb.get(k, 0)))

    print()
    print("--- per-module ---")
    print("%-40s %10s %10s %10s" % ("module", "before", "after", "preflight"))
    for m in sorted(set(As) | set(Bs)):
        a = As.get(m)
        b = Bs.get(m)
        an = a["n"] if a else "-"
        bn = b["n"] if b else "-"
        pf = "%s->%s" % (a["preflightFailed"] if a else "-", b["preflightFailed"] if b else "-")
        sa = (a or {}).get("stats") or {}
        sb = (b or {}).get("stats") or {}
        mark = "" if an == bn and (a or {}).get("preflightFailed") == (b or {}).get("preflightFailed") else "  <<<"
        print("%-40s %10s %10s %10s  st %s/%s -> %s/%s%s" % (
            m, an, bn, pf,
            sa.get("statementsFailed"), sa.get("statementsTotal"),
            sb.get("statementsFailed"), sb.get("statementsTotal"), mark))


main()
