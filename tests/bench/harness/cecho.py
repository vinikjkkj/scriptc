#!/usr/bin/env python3 -I
# cecho.py <outdir> <cfile or dir of *.c>  name[,name...] : writes <outdir>/cecho-<name>.txt with the body (capped) of up to 2 emitted C functions whose identifier contains <name>
import re, sys, os
out, cfile, names = sys.argv[1], sys.argv[2], [n for n in sys.argv[3].replace(' ', ',').split(',') if n]
import glob
files = sorted(glob.glob(os.path.join(cfile, '*.c'))) if os.path.isdir(cfile) else [cfile]
src = [(f, l) for f in files for l in open(f, errors='replace').read().split('\n')]
lines = [l for _, l in src]
owner = [f for f, _ in src]
CAP = 200
for name in names:
    pat = re.compile(r'^[A-Za-z_].*\b[A-Za-z0-9_]*' + re.escape(name) + r'[A-Za-z0-9_]*\(.*\)\s*\{\s*(/\*.*\*/)?\s*$')
    hits = [i for i, l in enumerate(lines) if pat.match(l) and not l.startswith('//')]
    res = [f'# {cfile} ({len(files)} files): {len(hits)} definition(s) of *{name}*; first 2 shown, each capped at {CAP} lines']
    for i in hits[:2]:
        j = i
        while j < len(lines) and lines[j] != '}':
            j += 1
        body = lines[i:j + 1]
        res.append(f'## {os.path.basename(owner[i])} line {i + 1}, {len(body)} lines')
        res += body[:CAP]
        if len(body) > CAP: res.append(f'... ({len(body) - CAP} more lines)')
    open(os.path.join(out, f'cecho-{name}.txt'), 'w').write('\n'.join(res) + '\n')
