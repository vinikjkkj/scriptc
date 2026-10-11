"""Pick the vmrest DUMP blocks that fall inside a named phase window and
summarise them. The window is read from the run's own phases.csv, never
typed in: SETTLED-r<n> .. IDLE-<IDLE_S>s is the rest window memrig defines
(memrig.mts:467-470).

Usage: python f2b-pick.py <rundir> <tag> [startPhase] [endPhase]
"""
import sys, os, re, csv

rundir, tag = sys.argv[1], sys.argv[2]
if rundir in ('.','here'): rundir = os.path.dirname(os.path.abspath(__file__))
p0 = sys.argv[3] if len(sys.argv) > 3 else 'SETTLED-r1'
p1 = sys.argv[4] if len(sys.argv) > 4 else 'IDLE-60s'

ph = {}
with open(os.path.join(rundir, tag + '.phases.csv'), newline='') as fh:
    for r in csv.DictReader(fh):
        ph.setdefault(r['phase'], int(r['ms']))
s, e = ph[p0], ph[p1]

txt = open(os.path.join(rundir, tag + '.vm.txt'), 'r', errors='replace').read()

# the pmon column, same window, as an independent reading of the denominator
pm = []
with open(os.path.join(rundir, tag + '.rss.csv'), newline='') as fh:
    for r in csv.DictReader(fh):
        if s <= int(r['ms']) <= e:
            pm.append(int(r['privateCommit']))

blocks = re.findall(r'== VMCENSUS (DUMP w=(\d+) t=(\d+)) ==\n(.*?)== END \1 ==', txt, re.S)
MB = 1048576.0

def term(body, label):
    m = re.search(r'^' + re.escape(label) + r'\s+([-\d.]+) MiB', body, re.M)
    return float(m.group(1)) if m else None

def heap_terms(body):
    """CRT HEAP = non-stack private bases >= 0.9 MiB, exactly the rule
    evidence-fr2/DECOMP.txt used. 'small bases' = the rest of the top-24.
    'tail' = PRIVATE non-stack minus the whole top-24."""
    bases = re.findall(r'base ([0-9a-f]{16})\s+([\d.]+) MiB  regions=(\d+)  reserved=([\d.]+) MiB', body)
    big = [b for b in bases if float(b[1]) >= 0.9]
    small = [b for b in bases if float(b[1]) < 0.9]
    crt = sum(float(b[1]) for b in big)
    sm = sum(float(b[1]) for b in small)
    top = crt + sm
    nonstack = term(body, 'PRIVATE non-stack')
    return crt, len(big), sm, nonstack - top, bases

print(f'{tag}: window {p0}..{p1} = {(e-s)/1000:.1f} s')
if pm:
    print(f'  pmon privateCommit in window: n={len(pm)} min={min(pm)} max={max(pm)} '
          f'= {min(pm)/MB:.3f} .. {max(pm)/MB:.3f} MiB  flat={min(pm)==max(pm)}')
print(f'  vmrest DUMP blocks in window: ', end='')
sel = [b for b in blocks if s <= int(b[2]) <= e]
print(len(sel))
print()
hdr = ('  walk  kPrivate   STACK   CRTheap  nbases   small    tail   IMAGE   MAPPED'
       '  RESID   RESOLV%  drop')
print(hdr)
rows = []
for tagfull, w, t, body in sel:
    k = float(re.search(r'denominator = kernel PrivateUsage at walk start \(([\d.]+) MiB\)', body).group(1))
    st = term(body, 'STACK committed')
    img = term(body, 'IMAGE cow-taken')
    mp = term(body, 'MAPPED cow-taken')
    res = term(body, 'RESIDUE (kernel-walk)')
    crt, nb, sm, tail, bases = heap_terms(body)
    resolv = float(re.search(r'RESOLVED by walk\s+[\d.]+ MiB\s+([\d.]+)%', body).group(1))
    drop = int(re.search(r'BASES DROPPED \(clip\)\s+(\d+)', body).group(1))
    rows.append((int(w), k, st, crt, nb, sm, tail, img, mp, res, resolv, drop, bases))
    print(f'  {w:>4}  {k:8.3f} {st:7.3f} {crt:9.3f} {nb:7d} {sm:7.3f} {tail:7.3f}'
          f' {img:7.3f} {mp:8.3f} {res:6.3f} {resolv:8.2f} {drop:5d}')
if rows:
    n = len(rows)
    avg = lambda i: sum(r[i] for r in rows) / n
    print()
    print(f'  MEAN of {n} walks in the window, denominator = each walk own kPrivate')
    print(f'    kernel PrivateUsage        {avg(1):8.3f} MiB   100.00%')
    for lbl, i in (('STACK committed', 2), ('CRT HEAP (>=0.9 MiB bases)', 3),
                   ('private small bases', 5), ('private tail below top-24', 6),
                   ('IMAGE cow-taken', 7), ('MAPPED cow-taken', 8),
                   ('RESIDUE (kernel-walk)', 9)):
        print(f'    {lbl:<26}{avg(i):8.3f} MiB   {100*avg(i)/avg(1):6.2f}%')
    tot = avg(2) + avg(3) + avg(5) + avg(6) + avg(7) + avg(8) + avg(9)
    print(f'    {"SUM OF TERMS":<26}{tot:8.3f} MiB   {100*tot/avg(1):6.2f}%')
    print(f'    {"closes to within":<26}{abs(tot-avg(1)):8.3f} MiB')
    print()
    print('  LARGEST NON-STACK PRIVATE BASES in the LAST window walk')
    for b in rows[-1][12][:14]:
        print(f'    base {b[0]}  {float(b[1]):9.3f} MiB  regions={b[2]:<4} reserved={b[3]} MiB')
