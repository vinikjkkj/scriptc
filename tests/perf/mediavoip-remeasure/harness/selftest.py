"""Self-test for a remeasure sweep directory.

The committed `revalidate.sh` globs `$OUT/*.log`; `sweep2.sh` writes `*.txt`.
On a sweep2 output directory the glob matches nothing, the loop body runs once
on the literal pattern, and the script prints a number that has no relation to
the sweep. It cannot say "nothing changed" and it cannot fail for the right
reason. This replaces it.

Checks, all of which must pass before any number from the directory is quoted:

  A. every one of the 40 corpus modules produced a parseable JSON
  B. every module's log ends EXIT=0 and names a `sites=` count
  C. the `sites=` count in the log equals len(sites) in the JSON
  D. POSITIVE CONTROL  `_ctl_typesprobe`      : 0 SC0001 sites AND at least one
     diagnostic whose message names "@types/node" -- only real @types/node can
     say that, the fallback .d.ts cannot
  E. NEGATIVE CONTROL  `_ctl_typesprobe-neg`  : at least one SC0001 site -- if
     this is empty the query is broken and every "clean" module above is void

Exit 0 only if all five hold.
"""

import json
import glob
import os
import re
import sys

d_in = sys.argv[1]
expect_modules = int(sys.argv[2]) if len(sys.argv) > 2 else 40

fail = []
ok = []


def load(p):
    with open(p) as f:
        return json.load(f)


mods = sorted(
    p for p in glob.glob(os.path.join(d_in, "*.json"))
    if not os.path.basename(p).startswith("_ctl_")
)

if len(mods) != expect_modules:
    fail.append("A: %d module JSONs, expected %d" % (len(mods), expect_modules))
else:
    ok.append("A: %d module JSONs present" % len(mods))

bad_exit, bad_count, unparseable = [], [], []
for p in mods:
    tag = os.path.basename(p)[:-5]
    try:
        d = load(p)
    except Exception as e:
        unparseable.append("%s (%s)" % (tag, e))
        continue
    log = p[:-5] + ".txt"
    txt = open(log).read() if os.path.exists(log) else ""
    if "EXIT=0" not in txt:
        bad_exit.append(tag)
    m = re.search(r"sites=(\d+)", txt)
    if m is None or int(m.group(1)) != len(d["sites"]):
        bad_count.append("%s log=%s json=%d" % (tag, m.group(1) if m else "NONE", len(d["sites"])))

if unparseable:
    fail.append("A: unparseable: " + ", ".join(unparseable))
if bad_exit:
    fail.append("B: no EXIT=0: " + ", ".join(bad_exit))
else:
    ok.append("B: all %d logs EXIT=0" % len(mods))
if bad_count:
    fail.append("C: log/json site-count mismatch: " + ", ".join(bad_count))
else:
    ok.append("C: log site= matches json for all %d" % len(mods))

pos = os.path.join(d_in, "_ctl_typesprobe.json")
if not os.path.exists(pos):
    fail.append("D: positive control MISSING -- sweep did not run its controls")
else:
    d = load(pos)
    sc0001 = [s for s in d["sites"] if s["code"] == "SC0001"]
    typed = [s for s in d["sites"] if "@types/node" in (s["message"] or "")]
    if sc0001:
        fail.append("D: positive control has %d SC0001 -- running against the "
                    "fallback .d.ts, not real @types/node: %s"
                    % (len(sc0001), sc0001[0]["message"][:90]))
    elif not typed:
        fail.append("D: positive control names no '@types/node' diagnostic -- "
                    "cannot prove which type surface this lane used")
    else:
        ok.append("D: positive control clean and names @types/node: "
                  + typed[0]["message"][:70])

neg = os.path.join(d_in, "_ctl_typesprobe-neg.json")
if not os.path.exists(neg):
    fail.append("E: negative control MISSING -- sweep did not run its controls")
else:
    d = load(neg)
    sc0001 = [s for s in d["sites"] if s["code"] == "SC0001"]
    if not sc0001:
        fail.append("E: negative control reports NO SC0001 -- the query cannot "
                    "see errors; every clean module in this sweep is void")
    else:
        ok.append("E: negative control reports SC0001: " + sc0001[0]["message"][:60])

print("SELFTEST %s" % d_in)
for line in ok:
    print("  PASS " + line)
for line in fail:
    print("  FAIL " + line)
print("SELFTEST_RESULT=%s" % ("PASS" if not fail else "FAIL"))
sys.exit(0 if not fail else 1)
