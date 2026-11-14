#!/usr/bin/env python3
"""smapspeak.py <out.json> -- cmd args...   (env passed through)
Runs the lane, polls /proc/<pid>/status every 10 ms; every time VmRSS sets a new maximum it snapshots /proc/<pid>/smaps and keeps the
snapshot taken at the highest VmRSS (the 'peak'). Classifies each mapping: file-backed r-x (code), file-backed r-- (rodata/relro),
file-backed rw (data), [heap] (brk), [stack], anon (mmap: malloc arenas, string/cycle arenas, fiber stacks), [vvar]/[vdso].
Reports per class: Rss, Pss, Private_Dirty, Anonymous (kB). Also records the VmHWM at exit and the Rss timeline summary.
Stdout of the lane goes to <out>.stdout. This is an OUTSIDE measurement with the same instrument for every lane."""
import sys, os, time, json, subprocess, re
out = sys.argv[1]; cmd = sys.argv[sys.argv.index('--') + 1:]
so = open(out + '.stdout', 'wb')
p = subprocess.Popen(cmd, stdout=so, stderr=subprocess.STDOUT)
best = (0, None); samples = 0; hwm = 0; t0 = time.time(); tl = []
def rss_kb(pid):
    try:
        with open(f'/proc/{pid}/status') as f:
            for l in f:
                if l.startswith('VmRSS:'): return int(l.split()[1])
    except Exception: return None
def snap(pid):
    try:
        with open(f'/proc/{pid}/smaps') as f: return f.read()
    except Exception: return None
while p.poll() is None:
    r = rss_kb(p.pid)
    if r is not None:
        samples += 1
        if samples % 50 == 0: tl.append((round(time.time() - t0, 2), r))
        if r > best[0]:
            s = snap(p.pid)
            if s: best = (r, s)
    time.sleep(0.01)
def parse(s):
    cls = {}; cur = None; perms = ''; name = ''
    for l in s.split('\n'):
        m = re.match(r'^[0-9a-f]+-[0-9a-f]+ (\S+) \S+ \S+ \S+\s*(.*)$', l)
        if m:
            perms, name = m.group(1), m.group(2).strip()
            if name == '[heap]': c = 'heap(brk)'
            elif name.startswith('[stack'): c = 'stack'
            elif name.startswith('[v'): c = 'vdso/vvar'
            elif name == '': c = 'anon-mmap'
            elif name.startswith('/'):
                base = os.path.basename(name)
                kind = 'main-binary' if base == os.path.basename(cmd[0]) else 'shared-libs'
                c = f'{kind}:' + ('code(r-x)' if 'x' in perms else 'rw-data' if 'w' in perms else 'rodata(r--)')
            else: c = 'other:' + name
            cur = cls.setdefault(c, {'Rss': 0, 'Pss': 0, 'Private_Dirty': 0, 'Anonymous': 0, 'maps': 0}); cur['maps'] += 1
            continue
        m = re.match(r'^(Rss|Pss|Private_Dirty|Anonymous):\s+(\d+) kB', l)
        if m and cur is not None: cur[m.group(1)] += int(m.group(2))
    return cls
res = {'cmd': cmd, 'exit': p.returncode, 'peak_vmrss_kb': best[0], 'samples': samples, 'timeline': tl[::max(1, len(tl) // 40)]}
if best[1]: res['classes'] = parse(best[1]); res['sum_rss_kb'] = sum(v['Rss'] for v in res['classes'].values())
json.dump(res, open(out, 'w'), indent=1)
print(out, 'exit', p.returncode, 'peak', best[0], 'kB')
