#!/usr/bin/env python3
"""readhold.py <cycen-report> <binary> [substr...]: who holds the dyn STR nodes (built with -DSCR_CYCEN_HOLD_KIND=3).

For each target site (the emitting function of the STR node's allocation: first non-scr_ frame): how many target nodes, node rc per node, holders found per node,
unexplained = rc minus holders found (a stack temp, a global, a pending-exception cell, a promise reaction), nodes with no heap holder; then the holders
(holder kind = the free function of the holding cyc object, holder site = where the holder was created, via = payload or side buffer); then the ~200 sampled
targets with their node rc, string rc, length, first holder and first 40 bytes."""
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
if anc is None: sys.exit('no CYCEN-KIND anchor: the report is not a census report')
off = anc - addr[syms.index('scr_collect_cycles')]
def sym(a):
    if a == 0: return None
    t = a - off - 1
    if t < addr[0] or t > addr[-1] + 0x100000: return None
    i = bisect.bisect_right(addr, t) - 1
    return syms[i] if i >= 0 else None
def kindname(a):
    t = a - off
    i = bisect.bisect_right(addr, t) - 1
    return syms[i] if i >= 0 and abs(addr[i] - t) < 4 else hex(a)
def emit_of(frs):
    fr = [sym(int(a, 16)) for a in frs]
    return (next((x for x in fr if x and not x.startswith('scr_')), None) or '(runtime)'), '<-'.join((x or '?') for x in fr[:3])
for l in lines:
    if l.startswith('CYCEN-ARMED') or l.startswith('CYCEN-ARM'): print(l[:160])
print('--- TARGET SITES (dyn STR nodes at the best seam)')
tg = {}
for l in lines:
    if not l.startswith('CYCEN-HOLDT'): continue
    m = re.match(r'CYCEN-HOLDT ntargets=(\d+) rcsum=(\d+) found=(\d+) unexplained=(\d+) norefs=(\d+)((?: [0-9a-f]+)+)', l)
    nt, rcs, fd, un, nr = (int(m.group(i)) for i in range(1, 6))
    e, ch = emit_of(m.group(6).split())
    tg.setdefault((e, ch), []).append((nt, rcs, fd, un, nr))
total = sum(x[0] for v in tg.values() for x in v)
print(f"targets total {total}")
for (e, ch), v in sorted(tg.items(), key=lambda kv: -sum(x[0] for x in kv[1])):
    if want and not any(w in e or w in ch for w in want): continue
    nt = sum(x[0] for x in v); rcs = sum(x[1] for x in v); fd = sum(x[2] for x in v); un = sum(x[3] for x in v); nr = sum(x[4] for x in v)
    print(f"STR TARGETS {e[:58]:58s} n={nt:7d} node-rc/node={rcs/max(nt,1):.2f} found/node={fd/max(nt,1):.2f} unexplained={un} ({un/max(nt,1):.2f}/node) noHeapHolder={nr}")
    hs = {}
    for l2 in lines:
        if not l2.startswith('CYCEN-HOLD '): continue
        m2 = re.match(r'CYCEN-HOLD n=(\d+) via=(\d) hkind=([0-9a-f]+) tsite((?: [0-9a-f]+){5}) hsite((?: [0-9a-f]+){5})', l2)
        if not m2 or emit_of(m2.group(4).split()) != (e, ch): continue
        he, hch = emit_of(m2.group(5).split())
        key = (kindname(int(m2.group(3), 16)), he, m2.group(2))
        hs[key] = hs.get(key, 0) + int(m2.group(1))
    for (hk, he, via), n in sorted(hs.items(), key=lambda kv: -kv[1])[:8]:
        print(f"      held by {n:7d}x  holder kind {hk[:34]:34s} created in {he[:48]:48s} via {'side-buffer' if via == '1' else 'payload'}")
print('--- SAMPLES (every 2500th target)')
for l in lines:
    if not l.startswith('CYCEN-SN '): continue
    m = re.match(r'CYCEN-SN noderc=(\d+) strrc=(\d+) len=(\d+) found=(\d+) via=(\d) hkind=([0-9a-f]+) tsite((?: [0-9a-f]+){5}) hsite((?: [0-9a-f]+){5}) \|(.*)\|$', l)
    if not m: continue
    te, _ = emit_of(m.group(7).split()); he, _ = emit_of(m.group(8).split())
    hk = kindname(int(m.group(6), 16)) if int(m.group(6), 16) else '-'
    if want and not any(w in te or w in he for w in want): continue
    imm = ' IMMORTAL' if int(m.group(2)) > 1 << 40 else ''
    print(f"node-rc={m.group(1):>2s} str-rc={m.group(2) if not imm else 'imm':>5s} len={int(m.group(3)):3d} found={m.group(4)} {te[:34]:34s} <- held by {hk[:30]:30s} @ {he[:34]:34s} |{m.group(9)}|")
