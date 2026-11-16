#!/usr/bin/env python3
"""symfile.py <out.tsv> <c files...>: symbol<TAB>source path for every `sc_*` function definition whose opening line carries the emitter's `/* path:line */`
source comment (CEmitter.srcComment). The input is the kept program TU (--keep-c); ramap.py reads the TSV to give each resident function an origin."""
import re, sys
rx = re.compile(r'\b(sc_[A-Za-z0-9_]+)\s*\([^;{]*\)\s*\{\s*/\*\s*(\S+?):\d+\s*\*/')
out = sys.argv[1]; n = 0; seen = set()
with open(out, 'w') as o:
    for f in sys.argv[2:]:
        with open(f, encoding='utf8', errors='replace') as fh:
            for line in fh:
                if '/*' not in line or '{' not in line: continue
                m = rx.search(line)
                if m and m.group(1) not in seen:
                    seen.add(m.group(1)); o.write(f'{m.group(1)}\t{m.group(2)}\n'); n += 1
print(f'symfile: {n} functions with a source -> {out}')
