#!/usr/bin/env python3
"""symfile.py <out.tsv> <ir.json>: symbol<TAB>source file for every IR function, written from `--emit-ir`'s module dump (functions[].name, .loc.file).
The C emitter's own `/* file:line */` comment names the ENTRY file for every function (it prints mod.sourceFile), so it cannot say where a function came
from; the IR's per-function loc can. Names are mangled exactly as backend/mangle.ts does (sc_f_ / sc_w_ / sc_fc_ + sanitize); ramap.py reads the TSV."""
import json, re, sys
out, irp = sys.argv[1], sys.argv[2]
def sanitize(n): return re.sub(r'[^A-Za-z0-9_]', lambda m: '_' if m.group(0) == '.' else '_x%x_' % ord(m.group(0)), n)
d = json.load(open(irp))
n = 0
with open(out, 'w') as o:
    for f in d['functions']:
        loc = f.get('loc') or {}
        file = loc.get('file')
        if not file: continue
        s = sanitize(f['name'])
        for pre in ('sc_f_', 'sc_w_', 'sc_fc_'):
            o.write(f'{pre}{s}\t{file}\n'); n += 1
print(f'symfile: {len(d["functions"])} IR functions, {n} symbols -> {out}')
