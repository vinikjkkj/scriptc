#!/usr/bin/env python3
"""Per-module and per-package tables from a sweep directory.

Three states that a naive "statements analysed" column conflates:

  PREFLIGHT-FAIL  the analysis never ran; every number is absent, not zero.
  ISLANDED        preflight crossed but nothing was analysable: every import
                  the module needs is fenced, so statementsTotal is 0 because
                  there was no code to look at -- NOT because the code is clean.
  ANALYSED        statementsTotal > 0; the numbers mean what they say.

A zero and an islanded must never look alike.
"""
import json, os, re, sys, glob, collections

LAB = "G:/blocks/pkgrecheck-lab"

# Fold block-specific roots so two blocks' messages compare. Both appear in
# site `file` fields AND inside diagnostic text (SC0001 quotes a node_modules
# path; SC1016 spells a whole import cycle).
ROOTS = [
    (re.compile(r"[A-Za-z]:[\\/]blocks[\\/][A-Za-z0-9_-]+(-lab)?[\\/](app[\\/])?", re.I), "<LAB>/"),
    (re.compile(r"[0-9a-f]{40}", re.I), "<COMMIT>"),
    (re.compile(r"[A-Za-z]:[\\/]zapo-work[\\/]caches[\\/]provenance[\\/]", re.I), "<PROV>/"),
]

def norm(s):
    s = s.replace("\\", "/")
    for rx, rep in ROOTS:
        s = rx.sub(rep, s)
    return s

def load(d):
    out = {}
    for p in sorted(glob.glob(os.path.join(d, "*.json"))):
        b = os.path.basename(p)[:-5]
        if b.startswith("_ctl_"):
            continue
        with open(p, encoding="utf-8") as f:
            out[b] = json.load(f)
    return out

IMPORT_FENCE = re.compile(r"^importing '")

def state(j):
    if j.get("crashed"):
        return "CRASH"
    if j.get("preflightFailed"):
        return "PREFLIGHT-FAIL"
    st = j.get("stats") or {}
    if (st.get("statementsTotal") or 0) == 0:
        blockers = [s for s in j["sites"] if s["section"] == "blocker"]
        if any(IMPORT_FENCE.match(s["message"]) for s in blockers):
            return "ISLANDED"
        return "EMPTY"
    return "ANALYSED"

def blockers(j):
    return [s for s in j["sites"] if s["section"] == "blocker"]

def main():
    d = sys.argv[1]
    js = load(d)
    rows = []
    for tag, j in js.items():
        pkg, _, mod = tag.partition("__")
        mod = mod.replace("__", "/")
        st = j.get("stats") or {}
        bl = blockers(j)
        msgs = collections.Counter(norm(s["message"]) for s in bl)
        rows.append({
            "pkg": pkg, "mod": mod, "state": state(j),
            "total": st.get("statementsTotal"), "failed": st.get("statementsFailed"),
            "island": st.get("statementsIsland"),
            "blockers": len(bl), "distinct": len(msgs),
            "msgs": msgs, "ms": j.get("elapsedMs"),
            "sites": bl,
        })
    rows.sort(key=lambda r: (r["pkg"], r["mod"]))

    print(f"# per-module, sweep {d}")
    print()
    print("| package | module | state | stmts | failed | blocker sites | distinct msgs |")
    print("|---|---|---|---|---|---|---|")
    for r in rows:
        t = "-" if r["state"] in ("PREFLIGHT-FAIL", "CRASH") else r["total"]
        f = "-" if r["state"] in ("PREFLIGHT-FAIL", "CRASH") else r["failed"]
        if r["state"] == "ISLANDED":
            t, f = "ISLANDED", "ISLANDED"
        print(f"| {r['pkg']} | {r['mod']} | {r['state']} | {t} | {f} | {r['blockers']} | {r['distinct']} |")

    print()
    print("# per-package")
    print()
    print("| package | modules | preflight-fail | islanded | analysed | stmts | failed | distinct msgs (blockers) |")
    print("|---|---|---|---|---|---|---|---|")
    bypkg = collections.defaultdict(list)
    for r in rows:
        bypkg[r["pkg"]].append(r)
    for pkg, rs in sorted(bypkg.items()):
        pf = sum(1 for r in rs if r["state"] in ("PREFLIGHT-FAIL", "CRASH"))
        isl = sum(1 for r in rs if r["state"] == "ISLANDED")
        an = sum(1 for r in rs if r["state"] in ("ANALYSED", "EMPTY"))
        tot = sum(r["total"] or 0 for r in rs if r["state"] == "ANALYSED")
        fail = sum(r["failed"] or 0 for r in rs if r["state"] == "ANALYSED")
        m = collections.Counter()
        for r in rs:
            m.update(r["msgs"])
        print(f"| {pkg} | {len(rs)} | {pf} | {isl} | {an} | {tot} | {fail} | {len(m)} |")

    print()
    print("# distinct blocker MESSAGES, global, by site count")
    print()
    allm = collections.Counter()
    where = collections.defaultdict(set)
    for r in rows:
        for k, v in r["msgs"].items():
            allm[k] += v
            where[k].add(r["pkg"])
    for msg, n in allm.most_common():
        code = ""
        for r in rows:
            for s in r["sites"]:
                if norm(s["message"]) == msg:
                    code = s["code"]; break
            if code: break
        print(f"{n:4d}  {code}  [{','.join(sorted(where[msg]))}]  {msg[:150]}")

if __name__ == "__main__":
    main()
