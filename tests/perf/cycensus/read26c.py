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

# ---- STR dyn nodes per emitting site: literals (immortal), heap strings, sharing, distinct contents
strs = []
tot = [l for l in lines if l.startswith('CYCEN-STRTOTAL')]
for l in lines:
    if l.startswith('CYCEN-STR '):
        m = re.match(r'CYCEN-STR n=(\d+) nimm=(\d+) sumlen=(\d+) sumphys=(\d+) nshared=(\d+) ndistinct=(\d+)((?: [0-9a-f]+)+)', l)
        n, nimm, sl, sp, nsh, nd = (int(m.group(i)) for i in range(1, 7)); fr = [int(a, 16) for a in m.group(7).split()]
        name = None; rt = []
        for a in fr:
            sy = sym(a)
            if sy is None: continue
            if sy.startswith('scr_'): rt.append(sy); continue
            name = sy; break
        strs.append((name or ('(runtime only: ' + (rt[0] if rt else '?') + ')'), n, nimm, sl, sp, nsh, nd))
if strs:
    agg2 = {}
    for name, n, nimm, sl, sp, nsh, nd in strs:
        d = agg2.setdefault(name, [0, 0, 0, 0, 0, 0]); 
        for i, v in enumerate((n, nimm, sl, sp, nsh, nd)): d[i] += v
    N = sum(v[0] for v in agg2.values())
    print(f"\nSTR DYN NODES by emitting function (total {N} nodes = {N*40/1048576:.2f} MiB of 40-B nodes; {tot[0] if tot else ''})")
    print("  nodes   literal  heapstr  strBytes(phys)  shared  distinct   site")
    for name, (n, nimm, sl, sp, nsh, nd) in sorted(agg2.items(), key=lambda kv: -kv[1][0])[:14]:
        print(f"  {n:6d}  {nimm:7d}  {n-nimm:7d}  {sp:13d}  {nsh:6d}  {nd:8d}   {name[:70]}")

# ---- per-site length histogram and distinct-content samples (lines follow their CYCEN-STR line)
cur = None; sites = []
for l in lines:
    if l.startswith('CYCEN-STR '):
        m = re.match(r'CYCEN-STR n=(\d+).*?((?: [0-9a-f]+)+)$', l)
        fr = [int(a, 16) for a in m.group(2).split()]
        name = None
        for a in fr:
            sy = sym(a)
            if sy is None or sy.startswith('scr_'): continue
            name = sy; break
        cur = {'name': name or '(runtime only)', 'n': int(m.group(1)), 'len': {}, 'samp': []}; sites.append(cur)
    elif l.startswith('CYCEN-STRLEN') and cur is not None:
        for kv_ in l.split()[2:]:
            a, b = kv_.split(':'); cur['len'][int(a)] = int(b)
    elif l.startswith('CYCEN-STRSAMP') and cur is not None:
        m = re.match(r'CYCEN-STRSAMP q=\d+ len=(\d+) \|(.*)\|$', l)
        if m: cur['samp'].append((int(m.group(1)), m.group(2)))
for s_ in sorted(sites, key=lambda x: -x['n'])[:3]:
    top = sorted(s_['len'].items(), key=lambda kv: -kv[1])[:8]
    print(f"\nSITE {s_['name'][:70]}: {s_['n']} nodes; node count by string length (len:count) {top}")
    for ln, tx in s_['samp'][:24]: print(f"   len {ln:3d} |{tx}|")

# ---- ALL cyc objects by (allocation site, kind): the per-Command byte budget
def symk(a):
    if a == 0: return None
    t = a - off
    if t < addr[0] or t > addr[-1] + 0x100000: return None
    i = bisect.bisect_right(addr, t) - 1
    return syms[i] if i >= 0 else None
allrows = []
alltot = 0
for l in lines:
    if l.startswith('CYCEN-ALLTOTAL'): alltot = int(re.search(r'phys=(\d+)', l).group(1))
    if l.startswith('CYCEN-ALL '):
        m = re.match(r'CYCEN-ALL n=(\d+) phys=(\d+) ext=(\d+) kind=([0-9a-f]+)((?: [0-9a-f]+)+)', l)
        n, ph, ex, kd = int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4), 16)
        fr = [int(a, 16) for a in m.group(5).split()]
        site = None; rt = []
        for a in fr:
            sy = sym(a)
            if sy is None: continue
            if sy.startswith('scr_'): rt.append(sy); continue
            site = sy; break
        allrows.append((n, ph, ex, symk(kd) or '?', site or ('(rt:' + (rt[0] if rt else '?') + ')')))
if allrows:
    cmd_kinds = [r for r in allrows if 'Command' in r[3] and 'gcfree' in r[3] and 'Pipeline' not in r[3]]
    N = sum(r[0] for r in cmd_kinds)
    ext_total = sum(r[2] for r in allrows)
    print(f"\nALL CYC OBJECTS at the probe: {sum(r[0] for r in allrows)} objects, {alltot/1048576:.2f} MiB phys (+{ext_total/1048576:.2f} MiB dyn ARR/OBJ side buffers); Command objects N={N}")
    print(f"census total / N = {(alltot+ext_total)/max(N,1):.0f} B per Command (everything live, workload included)")
    agg3 = {}
    for n, ph, ex, kd, st in allrows:
        d = agg3.setdefault((kd, st), [0, 0, 0]); d[0] += n; d[1] += ph; d[2] += ex
    rows = sorted(agg3.items(), key=lambda kv: -(kv[1][1] + kv[1][2]))
    print(f"{'kind':34s} {'site (first non-runtime frame)':44s} {'count':>7} {'n/N':>6} {'B each':>7} {'+side':>6} {'MiB':>6}")
    for (kd, st), (n, ph, ex) in rows[:36]:
        print(f"{kd[:34]:34s} {st[:44]:44s} {n:7d} {n/max(N,1):6.2f} {ph/max(n,1):7.0f} {ex/max(n,1):6.0f} {(ph+ex)/1048576:6.2f}")
    per = []
    for (kd, st), (n, ph, ex) in rows:
        r_ = n / max(N, 1)
        k = round(r_)
        if k >= 1 and abs(r_ - k) <= 0.04 * max(k, 1) and k <= 12: per.append((kd, st, n, k, ph, ex))
    S = sum(p[4] + p[5] for p in per)
    print(f"\nPER-COMMAND rows (count within 4% of an integer multiple k of N, k<=12): {len(per)} rows, {S/1048576:.2f} MiB => {S/max(N,1):.0f} B per Command ({100*S/max(alltot+ext_total,1):.1f}% of the census total)")
    for kd, st, n, k, ph, ex in sorted(per, key=lambda p: -(p[4] + p[5]))[:24]:
        print(f"  x{k:<2d} {(ph+ex)/max(N,1):6.0f} B/Cmd  {kd[:34]:34s} {st[:50]}")
