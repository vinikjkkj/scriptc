import json, glob, sys, collections, os, re

d_in = sys.argv[1] if len(sys.argv) > 1 else 'sites-default'
code = sys.argv[2] if len(sys.argv) > 2 else 'SC1090'
sites = {}
for f in sorted(glob.glob(os.path.join(d_in, '*.json'))):
    d = json.load(open(f))
    for s in d['sites']:
        if s['code'] != code:
            continue
        key = (s['file'], s['line'], s['message'])
        sites.setdefault(key, set()).add(s['section'])

def short(fl):
    p = (fl or '?').replace(chr(92), '/')
    return p.split('/pkgs/')[1] if '/pkgs/' in p else p

by_variant = collections.defaultdict(list)
for (fl, ln, msg), secs in sites.items():
    by_variant[msg].append((short(fl), ln, '/'.join(sorted(secs))))

src_cache = {}
def line_text(fl, ln):
    if fl not in src_cache:
        try:
            src_cache[fl] = open(fl, encoding='utf-8').read().split('\n')
        except Exception:
            src_cache[fl] = None
    lines = src_cache[fl]
    if not lines or ln is None or ln > len(lines):
        return ''
    return lines[ln - 1].strip()

full = {}
for (fl, ln, msg), secs in sites.items():
    full[(short(fl), ln, msg)] = line_text(fl, ln)

print('%s variants in %s' % (code, d_in))
print()
for msg, lst in sorted(by_variant.items(), key=lambda kv: -len(kv[1])):
    print('=== %d site(s) === %s' % (len(lst), msg))
    for fl, ln, secs in sorted(lst):
        print('    %-46s :%-5s [%s]  %s' % (fl, ln, secs, full[(fl, ln, msg)][:110]))
    print()
print('distinct %s variants: %d   total sites: %d' % (code, len(by_variant), sum(len(v) for v in by_variant.values())))
