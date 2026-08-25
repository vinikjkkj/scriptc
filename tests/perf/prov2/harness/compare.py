"""A/B two sweep directories by unique diagnostic SITE.

Sites are keyed (file, line, code, message) after normalizing the lab and
source-cache roots out of the path, so two sweeps run from different
compiler trees compare on equal terms.

Prints, and can say "no difference" out loud:
  sites only in A  (a refusal the B compiler no longer produces)
  sites only in B  (a refusal the B compiler introduced)
  sites in both

Usage:  python compare.py <dir-A> <dir-B> [--causes]
"""

import collections
import glob
import json
import os
import re
import sys

A, B = sys.argv[1], sys.argv[2]
show_causes = "--causes" in sys.argv


def norm(p):
    if p is None:
        return "(no file)"
    p = p.replace(chr(92), "/")
    p = re.sub(r"^.*?/lab/app/pkgs/", "pkgs/", p)
    p = re.sub(r"^.*?/lab/app/node_modules/", "node_modules/", p)
    p = re.sub(r"^.*?/provenance/[0-9a-f]{40}/", "SRC/", p)
    p = re.sub(r"^.*?/blocks/[^/]+/(?:wt|base)/", "TREE/", p)
    p = re.sub(r"^.*?/blocks/[^/]+/", "TREE/", p)
    return p


def load(d):
    sites = {}
    files = sorted(glob.glob(os.path.join(d, "*.json")))
    for f in files:
        try:
            data = json.load(open(f, encoding="utf-8"))
        except Exception:
            continue
        for s in data["sites"]:
            key = (norm(s["file"]), s["line"], s["code"], s["message"])
            sites.setdefault(key, set()).add(s["section"])
    return sites, len(files)


sa, na = load(A)
sb, nb = load(B)
only_a = sorted(set(sa) - set(sb))
only_b = sorted(set(sb) - set(sa))
both = set(sa) & set(sb)

print("A = %s   (%d module results, %d unique sites)" % (A, na, len(sa)))
print("B = %s   (%d module results, %d unique sites)" % (B, nb, len(sb)))
print()
print("  in both:      %d" % len(both))
print("  only in A:    %d   (refusals B no longer produces)" % len(only_a))
print("  only in B:    %d   (refusals B introduced)" % len(only_b))
if not only_a and not only_b:
    print()
    print("  NO DIFFERENCE: the two sweeps report the identical site set.")

for label, lst in (("ONLY IN A", only_a), ("ONLY IN B", only_b)):
    if not lst:
        continue
    print()
    print("== %s (%d) ==" % (label, len(lst)))
    by_cause = collections.Counter((c, m) for _, _, c, m in lst)
    for (code, msg), n in by_cause.most_common():
        print("  %4d  %s  %s" % (n, code, msg[:150]))
    if show_causes:
        for f, ln, code, msg in lst:
            print("      %-52s :%-5s %s" % (f, ln, code))
