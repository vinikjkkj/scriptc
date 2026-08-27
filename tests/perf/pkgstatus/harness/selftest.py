#!/usr/bin/env python3
"""Five checks over a sweep directory. Two of them are ARMED CONTROLS that ran
in the same lane as the corpus. A harness that cannot report "nothing changed"
cannot be trusted when it does."""
import json, os, sys, glob

out = sys.argv[1]
expect = int(sys.argv[2])
fails = []

def load(p):
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        return {"__err__": str(e)}

mods = sorted(p for p in glob.glob(os.path.join(out, "*.json"))
              if not os.path.basename(p).startswith("_ctl_"))

# A: every corpus module produced a parseable JSON
if len(mods) != expect:
    fails.append(f"A: {len(mods)} module JSONs, expected {expect}")
bad = [p for p in mods if "__err__" in load(p)]
if bad:
    fails.append(f"A: unparseable: {bad}")

# B: every module's log ends EXIT=0
for p in mods:
    t = p[:-5] + ".txt"
    if not os.path.exists(t):
        fails.append(f"B: no log for {os.path.basename(p)}"); continue
    tail = open(t, encoding="utf-8", errors="replace").read().strip().splitlines()[-1:]
    if tail != ["EXIT=0"]:
        fails.append(f"B: {os.path.basename(t)} ends {tail}")

# C: the sites= count in each log equals len(sites) in its JSON
for p in mods:
    t = p[:-5] + ".txt"
    if not os.path.exists(t):
        continue
    head = open(t, encoding="utf-8", errors="replace").read()
    j = load(p)
    if "__err__" in j:
        continue
    n = len(j.get("sites", []))
    if f"sites={n} " not in head:
        fails.append(f"C: {os.path.basename(p)} json has {n} sites, log disagrees")

# D: POSITIVE control — real @types/node accepts a 4-argument execFile.
pos = load(os.path.join(out, "_ctl_typesprobe.json"))
if "__err__" in pos:
    fails.append("D: positive control missing")
else:
    sc0001 = [s for s in pos["sites"] if s["code"] == "SC0001"]
    if sc0001:
        fails.append(f"D: positive control reports SC0001 (fallback .d.ts in the program): {sc0001[0]['message'][:90]}")
    names_types_node = any("@types/node" in s["message"] for s in pos["sites"])
    if not names_types_node:
        fails.append("D: positive control never names @types/node — cannot prove the real types are adopted")

# E: NEGATIVE control — a genuine type error must be reported.
neg = load(os.path.join(out, "_ctl_typesprobe-neg.json"))
if "__err__" in neg:
    fails.append("E: negative control missing")
elif not [s for s in neg["sites"] if s["code"] == "SC0001"]:
    fails.append("E: negative control reports no SC0001 — the query cannot see errors")

if fails:
    print("SELFTEST FAIL")
    for f in fails:
        print("  " + f)
    sys.exit(1)
print(f"SELFTEST PASS  ({len(mods)} modules, both controls armed)")
