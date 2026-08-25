"""Self-test for a sweep directory.

A sweep that exits 0 having written nothing is indistinguishable from a
module with no diagnostics, which is how a false green gets shipped. This
refuses to call a directory usable unless every one of the expected
modules has BOTH a log that reports and a JSON that parses.

Usage:  python validate.py <sweep-dir> [expected-count]
Exit 0 = usable, exit 1 = not.
"""

import glob
import json
import os
import sys

d_in = sys.argv[1]
expected = int(sys.argv[2]) if len(sys.argv) > 2 else 40

tags = sorted(
    os.path.basename(p)[:-4] for p in glob.glob(os.path.join(d_in, "*.txt"))
)
bad = []
ok = 0
for tag in tags:
    txt_path = os.path.join(d_in, tag + ".txt")
    json_path = os.path.join(d_in, tag + ".json")
    txt = open(txt_path, encoding="utf-8", errors="replace").read()
    if "EXIT=" not in txt:
        bad.append((tag, "log has no EXIT marker"))
        continue
    exit_code = txt.rsplit("EXIT=", 1)[1].strip().split()[0]
    if exit_code != "0":
        bad.append((tag, "sites.mjs exited " + exit_code))
        continue
    if "sites=" not in txt:
        bad.append((tag, "log never reported a site count"))
        continue
    if not os.path.exists(json_path):
        bad.append((tag, "no JSON written"))
        continue
    try:
        d = json.load(open(json_path, encoding="utf-8"))
    except Exception as e:  # noqa: BLE001
        bad.append((tag, "JSON does not parse: %s" % e))
        continue
    if not isinstance(d.get("sites"), list):
        bad.append((tag, "JSON has no sites array"))
        continue
    if d.get("stats") is None and d.get("preflightFailed") is not True:
        bad.append((tag, "neither stats nor preflightFailed — did not analyze"))
        continue
    ok += 1

print("VALIDATE %s" % d_in)
print("  modules with a usable result: %d" % ok)
print("  logs present:                 %d (expected %d)" % (len(tags), expected))
for tag, why in bad:
    print("  INVALID: %-44s %s" % (tag, why))
missing = expected - len(tags)
if missing > 0:
    print("  INVALID: %d module log(s) never written" % missing)
usable = ok == expected and not bad
print("  VERDICT: %s" % ("USABLE" if usable else "NOT USABLE"))
sys.exit(0 if usable else 1)
