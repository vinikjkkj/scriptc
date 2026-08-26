r"""Self-test for the two path normalisers, and for the regexes inside them.

This exists because the first version of rank2.py's `_PATHISH` shipped as
`[A-Za-z]:[\\/]...` in the source I wrote and arrived on disk as
`[A-Za-z]:[\/]...` -- one backslash eaten by the shell heredoc. `[\/]` is a
regex that matches a forward slash only, so every Windows-spelled path would
have gone un-normalised, silently, and every cause quoting one would have
counted as its own distinct cause per block root. A normaliser is a classifier;
it needs the same control a classifier needs.

MUST-FOLD  : four spellings that must all collapse to the same key.
MUST-NOT   : two strings that must come through untouched.
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import compare  # noqa: E402
import rank2  # noqa: E402

FAIL = []


def check(name, got, want):
    if got != want:
        FAIL.append("%s\n     got:  %r\n     want: %r" % (name, got, want))
    else:
        print("  PASS %-52s -> %r" % (name, got))


# ---- MUST-FOLD: every spelling of the same site collapses -----------------
fwd = "G:/blocks/remeasure/lab/app/pkgs/wam/wire/encoder.ts"
bck = "G:\\blocks\\mediavoip\\lab\\app\\pkgs\\wam\\wire\\encoder.ts"
check("forward-slash lab path", compare.norm(fwd), "pkgs/wam/wire/encoder.ts")
check("backslash lab path", compare.norm(bck), "pkgs/wam/wire/encoder.ts")

pf = "G:/blocks/remeasure/prov/250f9af5229a545eec28ddbd3e8774a397cdb0bb/src/util/bytes.ts"
pb = "G:\\blocks\\other\\prov\\250f9af5229a545eec28ddbd3e8774a397cdb0bb\\src\\util\\bytes.ts"
check("forward-slash provenance path", compare.norm(pf), "prov:src/util/bytes.ts")
check("backslash provenance path", compare.norm(pb), "prov:src/util/bytes.ts")

# ---- MUST-FOLD inside a message, both normalisers, both slash spellings ----
m_f = "circular imports (%s -> %s) are not supported yet" % (pf, pf)
m_b = "circular imports (%s -> %s) are not supported yet" % (pb, pb)
want = "circular imports (prov:src/util/bytes.ts -> prov:src/util/bytes.ts) are not supported yet"
check("compare.nmsg forward", compare.nmsg(m_f), want)
check("compare.nmsg backslash", compare.nmsg(m_b), want)
check("rank2.nmsg forward", rank2.nmsg(m_f), want)
check("rank2.nmsg backslash", rank2.nmsg(m_b), want)

# ---- MUST-NOT: text with no absolute path is returned unchanged ------------
plain = "comparisons of union-typed values (narrow first) are not supported yet"
check("no path, compare", compare.nmsg(plain), plain)
check("no path, rank2", rank2.nmsg(plain), plain)

print()
if FAIL:
    for f in FAIL:
        print("  FAIL " + f)
    print("NORM_SELFTEST=FAIL")
    sys.exit(1)
print("NORM_SELFTEST=PASS")
