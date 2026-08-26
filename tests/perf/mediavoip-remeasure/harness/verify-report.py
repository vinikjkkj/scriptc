"""Re-derive every headline number in estado-remeasure.md from the sweeps.

A report is a claim about files. This checks the claim against the files, and
it carries a CONTROL row that MUST fail -- one assertion deliberately given the
wrong expected value -- so a run printing "ALL VERIFIED" cannot be a loop that
never executed a comparison.

Usage:  verify-report.py RECORDED_DIR DEFAULT_DIR PROV_DIR
"""

import json
import glob
import os
import re
import sys
import collections

REC_DIR, DFL_DIR, PRV_DIR = sys.argv[1], sys.argv[2], sys.argv[3]

_COMMIT = re.compile(r"/[0-9a-f]{40}/")
_PATH = re.compile(r"[A-Za-z]:[\\/][^\s'\"()]*")


def norm(p):
    if p is None:
        return None
    p = p.replace(chr(92), "/")
    m = _COMMIT.search(p)
    if m:
        return "prov:" + p[m.end():]
    i = p.find("/app/")
    return p[i + 5:] if i >= 0 else p


def nmsg(m):
    return None if m is None else _PATH.sub(lambda x: norm(x.group(0)), m)


def load(d):
    sites, st = set(), {}
    for f in sorted(glob.glob(os.path.join(d, "*.json"))):
        b = os.path.basename(f)[:-5]
        if b.startswith("_ctl_"):
            continue
        j = json.load(open(f))
        st[b] = j
        for s in j["sites"]:
            sites.add((norm(s["file"]), s["line"], s["code"], nmsg(s["message"])))
    return sites, st


rec, _ = load(REC_DIR)
dfl, dst = load(DFL_DIR)
prv, pst = load(PRV_DIR)

cd = collections.Counter((c, m) for _, _, c, m in dfl)
cp = collections.Counter((c, m) for _, _, c, m in prv)


def n(cnt, pat, code=None):
    return sum(v for (c, m), v in cnt.items() if pat in (m or "") and (code is None or c == code))


checks = [
    ("recorded sites == 234", len(rec), 234),
    ("default sites == 234", len(dfl), 234),
    ("default causes == 33", len(cd), 33),
    ("recorded == default, fixed", len(rec - dfl), 0),
    ("recorded == default, new", len(dfl - rec), 0),
    ("prov sites == 105", len(prv), 105),
    ("prov causes == 62", len(cp), 62),
    ("sites fixed by prov == 192", len(dfl - prv), 192),
    ("sites new in prov == 63", len(prv - dfl), 63),
    ("default modules == 40", len(dst), 40),
    ("prov modules == 40", len(pst), 40),
    ("default statements == 586", sum(v["stats"]["statementsTotal"] for v in dst.values()), 586),
    ("prov statements == 321687", sum(v["stats"]["statementsTotal"] for v in pst.values()), 321687),
    ("default failed == 236", sum(v["stats"]["statementsFailed"] for v in dst.values()), 236),
    ("prov failed == 56", sum(v["stats"]["statementsFailed"] for v in pst.values()), 56),
    ("default preflight fails == 8", sum(1 for v in dst.values() if v["preflightFailed"]), 8),
    ("prov preflight fails == 13", sum(1 for v in pst.values() if v["preflightFailed"]), 13),
    ("default raw sites == 659", sum(len(v["sites"]) for v in dst.values()), 659),
    ("prov raw sites == 348", sum(len(v["sites"]) for v in pst.values()), 348),
    ("prov zapo-js value island == 0", n(cp, "values from the 'zapo-js' package"), 0),
    ("prov zapo-js import island == 0", n(cp, "importing 'zapo-js' requires"), 0),
    ("prov commit cascade == 0", n(cp, "generic method 'commit' through"), 0),
    ("prov 'on' cascade == 12", n(cp, "generic method 'on' with no defining object literal"), 12),
    ("prov SC1016 sites == 1", n(cp, "circular imports", "SC1016"), 1),
    ("prov wa-wam value island == 10", n(cp, "values from the '@vinikjkkj/wa-wam' package"), 10),
    ("default wa-wam value island == 7", n(cd, "values from the '@vinikjkkj/wa-wam' package"), 7),
    ("prov BinaryWriter cascade == 7", n(cp, "values of type 'BinaryWriter'"), 7),
    ("AmbientFab survives prov == 1", n(cp, "'AmbientFab[]'"), 1),
    ("default zapo-js family sums to 189",
     n(cd, "values from the 'zapo-js' package") + n(cd, "importing 'zapo-js' requires")
     + n(cd, "generic method 'commit' through") + n(cd, "uses of 'bytes' inherit")
     + n(cd, "uses of 'length' inherit") + n(cd, "member 'logger' has type 'Logger'"), 189),
]

bad = 0
for name, got, want in checks:
    ok = got == want
    if not ok:
        bad += 1
    print("  %-4s %-46s got=%s want=%s" % ("PASS" if ok else "FAIL", name, got, want))

# CONTROL: this comparison MUST come out false.
ctl_ok = len(dfl) != 999
print("  %-4s %-46s got=%s want=%s"
      % ("CTL" if ctl_ok else "BROKEN", "CONTROL, must not match: default == 999", len(dfl), 999))
if not ctl_ok:
    bad += 1

print()
print("REPORT_NUMBERS=%s" % ("ALL VERIFIED" if bad == 0 else "%d WRONG" % bad))
sys.exit(1 if bad else 0)
