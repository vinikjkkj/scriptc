#!/usr/bin/env python3
"""readshape.py <cycen-report> <binary> [substr...]: CYCEN-SHAPE rows grouped by emitting function (first non-scr_ frame) with the whole frame chain, kind, len/cap, first-item kinds, keys."""
import subprocess, sys, re, bisect
rep, binp = sys.argv[1], sys.argv[2]; want = sys.argv[3:]
nm = subprocess.run(['nm', '-n', binp], capture_output=True, text=True).stdout.split('\n')
syms, addr = [], []
for l in nm:
    p = l.split()
    if len(p) == 3 and p[1] in 'tTwW': syms.append(p[2]); addr.append(int(p[0], 16))
lines = open(rep).read().split('\n')
anc = None
for l in lines:
    if l.startswith('CYCEN-KIND'): anc = int(re.search(r'anchor=([0-9a-f]+)', l).group(1), 16)
off = anc - addr[syms.index('scr_collect_cycles')]
def sym(a):
    if a == 0: return None
    t = a - off - 1
    if t < addr[0] or t > addr[-1] + 0x100000: return None
    i = bisect.bisect_right(addr, t) - 1
    return syms[i] if i >= 0 else None
KN = {4: 'ARR', 5: 'OBJ'}
rows = []
for l in lines:
    if not l.startswith('CYCEN-SHAPE'): continue
    m = re.match(r'CYCEN-SHAPE kind=(\d+) len=(\d+) cap=(\d+) eks=([0-9a-f]+) n=(\d+) ext=(\d+) rcsum=(\d+) e0shared=(\d+) keys=(\S+)((?: [0-9a-f]+)+)', l)
    if not m: continue
    kind, ln, cap, eks, n, ext, rc, sh, keys = int(m.group(1)), int(m.group(2)), int(m.group(3)), m.group(4), int(m.group(5)), int(m.group(6)), int(m.group(7)), int(m.group(8)), m.group(9)
    fr = [sym(int(a, 16)) for a in m.group(10).split()]
    emit = next((s for s in fr if s and not s.startswith('scr_')), None)
    chain = '<-'.join((s or '?') for s in fr[:3])
    rows.append((emit or '(runtime)', chain, kind, ln, cap, eks, n, ext, rc, sh, keys))
rows.sort(key=lambda r: (r[0], -(r[6]*56 + r[7])))
for r in rows:
    if want and not any(w in r[0] or w in r[1] for w in want): continue
    ek = [int(r[5][i:i+2], 16) for i in (6, 4, 2, 0)]
    print(f"{r[0][:62]:62s} {KN.get(r[2], r[2])} len={r[3]:<3d} cap={r[4]:<3d} n={r[6]:6d} side={r[7]:8d} B rc/node={r[8]/max(r[6],1):.2f} items={[k for k in ek if k != 255]} e0strShared={r[9]} keys={r[10]}")
