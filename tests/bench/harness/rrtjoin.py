#!/usr/bin/env python3
"""rrtjoin.py <rr-file>... -- <c-file>... : join the retain/release call-site census with a static pairing of the emitted C.
A pair = `T = scr_K_retain(SRC);` in a function and a later `scr_K_release(T);` of that temp in the same function.
Classes of SRC: stablelocal (sc_l_* never assigned / address-taken between the two lines), local (assigned in between), global (sc_g_*), other.
Weights: retain executions at the retain line (flag 4)."""
import sys, re, collections, glob
a = sys.argv[1:]
i = a.index('--')
rrfiles, cfiles = a[:i], a[i+1:]
KN = {1:'str',2:'arr',3:'dyn',4:'union',5:'bytes',6:'box',7:'closure',8:'map',9:'promise'}
KR = {v:k for k,v in KN.items()}
# pick the largest rr file (the main process)
rrfiles = [f for g in rrfiles for f in glob.glob(g)] or rrfiles
rr = max(rrfiles, key=lambda f: __import__('os').path.getsize(f))
ret = collections.defaultdict(int); rel = {}
tot = collections.defaultdict(lambda: [0]*5)
for l in open(rr):
    if l.startswith('#'):
        print(l.strip()); continue
    k, fn, line, *c = l.split(); k=int(k); line=int(line); c=[int(x) for x in c]
    for j in range(5): tot[k][j] += c[j]
    ret[(k, fn, line)] += c[4]
    rel[(k, fn, line)] = c[:4]
print("rr file", rr)
print("TOTALS by kind: null immortal nonfinal final retain")
for k in sorted(tot): print(" ", KN.get(k,k), tot[k])
fnre = re.compile(r'^[A-Za-z_][^;]*?\b(\w+)\([^;]*\)\s*\{\s*(/\*.*\*/)?\s*$')
retre = re.compile(r'^\s*(?:[A-Za-z_][\w \*]*?\s+)?\**(sc_t\d+)\s*=\s*scr_(\w+?)_retain\((.+)\);')
pairs = []   # (kind, fn, rline, relline, src, cls, weight)
fnlines = {}
for cf in cfiles:
    L = open(cf, errors='replace').read().split('\n')
    start = None; name = None
    funcs = []
    for n, l in enumerate(L, 1):
        if start is None:
            m = fnre.match(l)
            if m and not l.startswith(' ') and not l.startswith('#'):
                start, name = n, m.group(1)
        elif l == '}':
            funcs.append((name, start, n)); start = None
    for name, s, e in funcs:
        body = L[s-1:e]
        for off, l in enumerate(body):
            m = retre.match(l)
            if not m: continue
            tmp, kind, src = m.group(1), m.group(2), m.group(3).strip()
            if kind not in KR: continue
            rline = s + off
            relre = re.compile(r'\bscr_%s_release\(%s\)' % (kind, tmp))
            rels = [s + o for o, x in enumerate(body) if o > off and relre.search(x)]
            if not rels: continue
            # class of src
            cls = 'other'
            mm = re.fullmatch(r'(?:\(\w+ \*\))?(sc_[lg]_\w+)', src)
            if mm:
                v = mm.group(1)
                if v.startswith('sc_g_'): cls = 'global'
                else:
                    last = max(rels)
                    mid = body[off+1:last-s+1]
                    asg = re.compile(r'(?<![\w>])%s\s*(=(?!=)|\+\+|--)|&\s*%s\b|_release\(%s\)' % (re.escape(v), re.escape(v), re.escape(v)))
                    cls = 'local' if any(asg.search(x) for x in mid) else 'stablelocal'
            w = ret.get((KR[kind], name, rline), 0)
            pairs.append((kind, name, rline, rels[0], src, cls, w))
print("static pairs found:", len(pairs))
agg = collections.defaultdict(int)
for p in pairs: agg[(p[0], p[5])] += p[6]
print("DYNAMIC retain executions in pairs, by kind/class:")
for k in sorted(agg): print("  %-8s %-12s %d" % (k[0], k[1], agg[k]))
print("SUMMARY stablelocal executions:", sum(p[6] for p in pairs if p[5]=='stablelocal'), " global:", sum(p[6] for p in pairs if p[5]=='global'), " local:", sum(p[6] for p in pairs if p[5]=='local'), " other:", sum(p[6] for p in pairs if p[5]=='other'))
print("TOP PAIRS (weight, kind, class, fn, retain line, src)")
for p in sorted(pairs, key=lambda p: -p[6])[:60]: print("  %d %s %s %s %d %s" % (p[6], p[0], p[5], p[1], p[2], p[4]))
# per-function totals of all retains (any pair status) and releases
print("TOP SITES by nonfinal release count (kind fn line nonfinal final)")
for k, v in sorted(rel.items(), key=lambda kv: -kv[1][2])[:40]: print("  %s %s %d %d %d" % (KN.get(k[0],k[0]), k[1], k[2], v[2], v[3]))
