#!/usr/bin/env python3
"""read26c.py <cycen-report> <binary> : arena overhead table + dyn-node sites/shapes at the probe instant (CYCEN-ARENA*, CYCEN-X, CYCEN-DYNSITE, CYCEN-DYNSHAPE)."""
import subprocess, sys, re, bisect
rep, binp = sys.argv[1], sys.argv[2]
nm = subprocess.run(['nm', '-n', binp], capture_output=True, text=True).stdout.split('\n')
syms, addr = [], []
for l in nm:
    p = l.split()
    if len(p) == 3 and p[1] in 'tTwW': syms.append(p[2]); addr.append(int(p[0], 16))
anc = None
lines = open(rep).read().split('\n')
for l in lines:
    if l.startswith('CYCEN-KIND'): anc = int(re.search(r'anchor=([0-9a-f]+)', l).group(1), 16)
off = anc - addr[syms.index('scr_collect_cycles')]
def sym(a):
    if a == 0: return None
    t = a - off - 1
    if t < addr[0] or t > addr[-1] + 0x100000: return None
    i = bisect.bisect_right(addr, t) - 1
    return syms[i] if i >= 0 else None
def kv(l): return {k: int(v) for k, v in re.findall(r'(\w+)=(-?\d+)', l)}
# ---- arena
cls = [kv(l) for l in lines if l.startswith('CYCEN-ARENA class')]
held = [kv(l) for l in lines if l.startswith('CYCEN-ARENA-HELD')]
x = [kv(l) for l in lines if l.startswith('CYCEN-X')]
if cls:
    T = {k: sum(c[k] for c in cls) for k in ['chunks','chunkB','liveB','freeB','goneB','uncarvedB','partialChunks','partialB','liveBlocks','freeBlocks','hdrB']}
    other = T['chunkB'] - T['liveB'] - T['freeB'] - T['uncarvedB'] - T['hdrB']
    print("ARENA at the probe instant (best probe), held counter =", held[0]['held'] if held else '?')
    print(f"{'class':>5} {'stride':>6} {'chunks':>6} {'chunkB':>10} {'liveB':>10} {'freeB':>10} {'goneB':>9} {'uncarvB':>9} {'free%chunk':>10} {'partial':>7}")
    for c in sorted(cls, key=lambda c: -c['freeB']):
        print(f"{c['class']:5d} {c['stride']:6d} {c['chunks']:6d} {c['chunkB']:10d} {c['liveB']:10d} {c['freeB']:10d} {c['goneB']:9d} {c['uncarvedB']:9d} {100*c['freeB']/c['chunkB']:9.1f}% {c['partialChunks']:7d}")
    print("TOTAL", T, "residual(chunk-live-free-uncarved-hdr)=", other)
    print(f"  live {100*T['liveB']/T['chunkB']:.1f}%  free-list {100*T['freeB']/T['chunkB']:.1f}%  uncarved {100*T['uncarvedB']/T['chunkB']:.1f}%  hdr {100*T['hdrB']/T['chunkB']:.2f}%  resid {100*other/T['chunkB']:.2f}%  | page-returned (inside free-list+residual, not resident) {T['goneB']}")
    if x:
        X = x[0]; print(f"  CROSS-CHECK blocks<=256B: arena sum(used)={T['liveBlocks']} vs census ptbl entries={X['smallN']} (diff {100*(T['liveBlocks']-X['smallN'])/max(1,X['smallN']):+.2f}%); arena liveB(stride)={T['liveB']} vs census phys={X['smallPhys']} (stride rounding {T['liveB']-X['smallPhys']} B)")
        print(f"  parked dyn nodes at the instant: n={X['parkN']} phys={X['parkPhys']} side={X['parkSide']}  dyn freelist={X['dynFreeList']}  sitesLost={X['sitesLost']}")
# ---- dyn sites
KN = ['NULL','BOOL','NUM','STR','ARR','OBJ','BYTES','ARRBUF','FUNC','HANDLE','PROMISE','JSVAL','OBJINST','BIG','MAP']
agg = {}
tot_n = tot_b = 0
for l in lines:
    if l.startswith('CYCEN-DYNSITE'):
        m = re.match(r'CYCEN-DYNSITE kind=(\d+) n=(\d+) bytes=(\d+)((?: [0-9a-f]+)+)', l)
        kind, n, b = int(m.group(1)), int(m.group(2)), int(m.group(3)); fr = [int(a, 16) for a in m.group(4).split()]
        name = None; rt = []
        for a in fr:
            s = sym(a)
            if s is None: continue
            if s.startswith('scr_') : rt.append(s); continue
            name = s; break
        key = (name or ('(runtime only: ' + (rt[0] if rt else '?') + ')'), KN[kind] if kind < len(KN) else str(kind))
        d = agg.setdefault(key, [0, 0]); d[0] += n; d[1] += b; tot_n += n; tot_b += b
if agg:
    print(f"\nDYN NODES by emitting function x kind (total {tot_n} nodes, {tot_b} B; first non-scr_ frame of a 6-deep frame-pointer chain)")
    for (name, kd), (n, b) in sorted(agg.items(), key=lambda kv: -kv[1][1])[:15]:
        print(f"  {n:8d} {b:9d} B {100*b/tot_b:5.1f}%  {kd:8s} {name[:90]}")
    sh = {}
    for l in lines:
        if l.startswith('CYCEN-DYNSHAPE'):
            d = kv(l); sh[(d['kind'], d['lenrow'])] = (d['n'], d['bytes'])
    def lab(r): return str(r) if r < 16 else f"~2^{4+(r-16)//2}{'+' if (r-16)%2 else ''}"
    print("DYN NODES by shape (kind, entries/len), top 15")
    for (k, r), (n, b) in sorted(sh.items(), key=lambda kv: -kv[1][1])[:15]:
        print(f"  {n:8d} {b:9d} B  {KN[k] if k < len(KN) else k:8s} len {lab(r)}")
