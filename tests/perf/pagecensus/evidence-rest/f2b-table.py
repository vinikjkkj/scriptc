"""One table over every f2b run: the REST instant and the PEAK instant,
both out of the SAME run, both from vmrest (out-of-process VirtualQueryEx).

REST  = the mean of the vmrest DUMP walks whose epoch ms lies inside
        SETTLED-r1 .. IDLE-60s, the window memrig.mts:467-470 defines and
        the window fr1-run/a1..a6 were read in.
PEAK  = the BEST walk of the same run (vmcensus's own criterion: the walk
        with the largest resolved private commit).

CRT HEAP follows evidence-fr2/DECOMP.txt exactly: non-stack private
allocation bases of >= 0.9 MiB. 'small' is the rest of the top-24, 'tail'
is PRIVATE non-stack minus the whole top-24.
"""
import sys, os, re, csv

RUN = r'G:\blocks\f2b\run'
MB = 1048576.0

def terms(body):
    g = lambda lbl: float(re.search(r'^' + re.escape(lbl) + r'\s+([-\d.]+) MiB', body, re.M).group(1))
    k = float(re.search(r'denominator = kernel PrivateUsage at walk start \(([\d.]+) MiB\)', body).group(1))
    bases = re.findall(r'base ([0-9a-f]{16})\s+([\d.]+) MiB  regions=(\d+)  reserved=([\d.]+) MiB', body)
    crt = sum(float(b[1]) for b in bases if float(b[1]) >= 0.9)
    nb = sum(1 for b in bases if float(b[1]) >= 0.9)
    sm = sum(float(b[1]) for b in bases if float(b[1]) < 0.9)
    ns = g('PRIVATE non-stack')
    drop = int(re.search(r'BASES DROPPED \(clip\)\s+(\d+)', body).group(1))
    return dict(k=k, stack=g('STACK committed'), crt=crt, nb=nb, small=sm,
                tail=ns - crt - sm, img=g('IMAGE cow-taken'), mapp=g('MAPPED cow-taken'),
                resid=g('RESIDUE (kernel-walk)'), imgshared=g('IMAGE still shared'),
                nonstack=ns, drop=drop, bases=bases)

def run(tag):
    ph = {}
    for r in csv.DictReader(open(os.path.join(RUN, tag + '.phases.csv'), newline='')):
        ph.setdefault(r['phase'], int(r['ms']))
    s, e = ph['SETTLED-r1'], ph['IDLE-60s']
    txt = open(os.path.join(RUN, tag + '.vm.txt'), errors='replace').read()
    dumps = re.findall(r'== VMCENSUS (DUMP w=(\d+) t=(\d+)) ==\n(.*?)== END \1 ==', txt, re.S)
    sel = [terms(b[3]) for b in dumps if s <= int(b[2]) <= e]
    best = re.search(r'== VMCENSUS BEST ==\n(.*?)== END BEST ==', txt, re.S)
    peak = terms(best.group(1))
    kpk = float(re.search(r'KERNEL PeakPagefileUsage\s+([\d.]+) MiB', txt).group(1))
    cov = float(re.search(r'COVERAGE of the peak\s+([\d.]+)%', txt).group(1))
    pm = [int(r['privateCommit']) for r in csv.DictReader(open(os.path.join(RUN, tag + '.rss.csv'), newline=''))
          if s <= int(r['ms']) <= e]
    man = dict(l.split(None, 1) for l in open(os.path.join(RUN, tag + '.manifest.txt')) if len(l.split(None, 1)) == 2)
    rest = {k: sum(d[k] for d in sel) / len(sel) for k in
            ('k', 'stack', 'crt', 'small', 'tail', 'img', 'mapp', 'resid', 'imgshared', 'nonstack')}
    rest['nb'] = sel[-1]['nb']; rest['ndump'] = len(sel)
    rest['drop'] = max(d['drop'] for d in sel)
    rest['pmon'] = (min(pm) / MB, max(pm) / MB, len(pm))
    return man['arm'].strip(), man['knobset'].strip(), rest, peak, kpk, cov, sel[-1]['bases']

tags = sys.argv[1:] or ['r1', 'r6', 'r2', 'r5', 'r3', 'r4']
print('REST INSTANT  (SETTLED-r1 .. IDLE-60s), terms in MiB, denominator = that walk own kernel PrivateUsage')
print(f'{"tag":<4}{"arm":<7}{"kn":<4}{"kPriv":>8}{"pmonMin":>9}{"STACK":>7}{"CRTheap":>9}{"nb":>4}'
      f'{"small":>7}{"tail":>7}{"IMGcow":>8}{"MAPcow":>8}{"RESID":>8}{"SUM":>8}{"d":>3}{"IMGshared":>11}')
rows = {}
for t in tags:
    arm, kn, rest, peak, kpk, cov, bases = run(t)
    rows[t] = (arm, kn, rest, peak, kpk, cov, bases)
    tot = rest['stack'] + rest['crt'] + rest['small'] + rest['tail'] + rest['img'] + rest['mapp'] + rest['resid']
    print(f'{t:<4}{arm:<7}{kn:<4}{rest["k"]:8.3f}{rest["pmon"][0]:9.3f}{rest["stack"]:7.3f}{rest["crt"]:9.3f}'
          f'{rest["nb"]:4d}{rest["small"]:7.3f}{rest["tail"]:7.3f}{rest["img"]:8.3f}{rest["mapp"]:8.3f}'
          f'{rest["resid"]:8.3f}{tot:8.3f}{rest["drop"]:3d}{rest["imgshared"]:11.3f}')

print()
print('PEAK INSTANT of the SAME runs (vmrest BEST walk), same terms')
print(f'{"tag":<4}{"arm":<7}{"kn":<4}{"kPriv":>8}{"kPeak":>8}{"cov%":>7}{"STACK":>7}{"CRTheap":>9}{"nb":>4}'
      f'{"small":>7}{"tail":>7}{"IMGcow":>8}{"MAPcow":>8}{"RESID":>8}{"SUM":>8}')
for t in tags:
    arm, kn, rest, p, kpk, cov, bases = rows[t]
    tot = p['stack'] + p['crt'] + p['small'] + p['tail'] + p['img'] + p['mapp'] + p['resid']
    print(f'{t:<4}{arm:<7}{kn:<4}{p["k"]:8.3f}{kpk:8.3f}{cov:7.2f}{p["stack"]:7.3f}{p["crt"]:9.3f}'
          f'{p["nb"]:4d}{p["small"]:7.3f}{p["tail"]:7.3f}{p["img"]:8.3f}{p["mapp"]:8.3f}{p["resid"]:8.3f}{tot:8.3f}')
