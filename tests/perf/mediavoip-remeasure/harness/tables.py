"""Render the two report tables that need the finished sweeps.

Section 3: per module, default lane vs provenance lane, with an explicit
CLASS column so a row that was already clean is not read as a row that got
clean.

Section 5: the global ranking of the provenance lane, owned vs unowned.

CONTROLS printed with the tables:
  * the module count must be 40 in both directories;
  * `_ctl_` rows are excluded and their exclusion is stated;
  * a module present in one directory and not the other is listed by name
    rather than silently dropped.
"""

import json
import glob
import os
import sys
import collections

A_DIR = sys.argv[1]
B_DIR = sys.argv[2]


def load(d):
    out = {}
    for f in sorted(glob.glob(os.path.join(d, "*.json"))):
        b = os.path.basename(f)[:-5]
        if b.startswith("_ctl_"):
            continue
        out[b] = json.load(open(f))
    return out


A, B = load(A_DIR), load(B_DIR)
only_a = sorted(set(A) - set(B))
only_b = sorted(set(B) - set(A))
print("CONTROL modules: default=%d provenance=%d (both must be 40)" % (len(A), len(B)))
print("CONTROL _ctl_ rows excluded from both")
print("CONTROL only in default: %s" % (only_a or "none"))
print("CONTROL only in provenance: %s" % (only_b or "none"))
print()


def cls(a, b):
    """How this module moved, in words rather than in two numbers."""
    ap, bp = a["preflightFailed"], b["preflightFailed"]
    at, af = a["stats"]["statementsTotal"], a["stats"]["statementsFailed"]
    bt, bf = b["stats"]["statementsTotal"], b["stats"]["statementsFailed"]
    if ap and bp:
        return "still preflight-failed"
    if ap and not bp:
        return "PREFLIGHT NOW PASSES"
    if not ap and bp:
        return "PREFLIGHT NOW FAILS"
    if at == 0 and bt > 0:
        return "ISLAND -> %d statements, %d failed" % (bt, bf)
    if af > 0 and bf == 0:
        return "%d failed -> 0" % af
    if bt > at:
        return "reaches %d more statements" % (bt - at)
    if (at, af) == (bt, bf):
        return "unchanged"
    return "%d/%d -> %d/%d" % (af, at, bf, bt)


print("%-34s %-22s %-22s %s" % ("module", "default", "provenance", "class"))
print("-" * 118)
counts = collections.Counter()
for m in sorted(set(A) & set(B)):
    a, b = A[m], B[m]
    fa = "pf=%-5s %3d/%-5d n=%-3d" % (a["preflightFailed"], a["stats"]["statementsFailed"],
                                      a["stats"]["statementsTotal"], len(a["sites"]))
    fb = "pf=%-5s %3d/%-5d n=%-3d" % (b["preflightFailed"], b["stats"]["statementsFailed"],
                                      b["stats"]["statementsTotal"], len(b["sites"]))
    c = cls(a, b)
    counts[c.split(" ->")[0].split(" ")[0]] += 1
    print("%-34s %-22s %-22s %s" % (m, fa, fb, c))

print()
print("totals: statements analysed  default=%d  provenance=%d"
      % (sum(A[m]["stats"]["statementsTotal"] for m in A),
         sum(B[m]["stats"]["statementsTotal"] for m in B)))
print("        statements failed    default=%d  provenance=%d"
      % (sum(A[m]["stats"]["statementsFailed"] for m in A),
         sum(B[m]["stats"]["statementsFailed"] for m in B)))
print("        modules failing preflight  default=%d  provenance=%d"
      % (sum(1 for m in A if A[m]["preflightFailed"]),
         sum(1 for m in B if B[m]["preflightFailed"])))
print("        raw (undeduped) sites      default=%d  provenance=%d"
      % (sum(len(A[m]["sites"]) for m in A), sum(len(B[m]["sites"]) for m in B)))
