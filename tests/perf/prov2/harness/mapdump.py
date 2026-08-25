import collections
import json
import sys

d = json.load(open(sys.argv[1], encoding="utf-8"))
m = collections.defaultdict(set)
for entry, rec in d["modules"].items():
    for p in rec.get("packages", []):
        for spec, info in p["entries"].items():
            m[spec].add(info["file"].replace(chr(92), "/"))
print("specifier -> source file(s) it resolved to")
for spec in sorted(m):
    for f in sorted(m[spec]):
        print("  %-26s -> %s" % (spec, f))
print()
print("distinct specifiers: %d" % len(m))
multi = {s: v for s, v in m.items() if len(v) > 1}
print("specifiers that resolved to MORE THAN ONE file: %d %s" % (len(multi), sorted(multi)))
