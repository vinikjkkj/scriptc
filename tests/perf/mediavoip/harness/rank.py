import json, glob, sys, collections, os

d_in = sys.argv[1] if len(sys.argv) > 1 else 'sites-default'
sites = {}
for f in sorted(glob.glob(os.path.join(d_in, '*.json'))):
    d = json.load(open(f))
    for s in d['sites']:
        key = (s['file'], s['line'], s['code'], s['message'])
        sites.setdefault(key, set()).add(s['section'])

def pkg_of(fl):
    if fl is None:
        return '(no file)'
    p = fl.replace(chr(92), '/')
    if '/pkgs/' in p:
        return p.split('/pkgs/')[1].split('/')[0]
    if 'node_modules' in p:
        return 'node_modules'
    if '/provenance/' in p:
        return 'zapo-js(src)'
    return 'other'

def short(fl, ln):
    p = fl.replace(chr(92), '/')
    if '/pkgs/' in p:
        p = p.split('/pkgs/')[1]
    else:
        p = '/'.join(p.split('/')[-2:])
    return p + ':' + str(ln)

det = collections.defaultdict(lambda: {'n': 0, 'files': [], 'secs': set(), 'pkgs': collections.Counter()})
for (fl, ln, code, msg), secs in sites.items():
    k = (code, msg)
    e = det[k]
    e['n'] += 1
    e['secs'] |= secs
    e['pkgs'][pkg_of(fl)] += 1
    if fl:
        e['files'].append(short(fl, ln))

rows = sorted(det.items(), key=lambda kv: -kv[1]['n'])
print('unique diagnostic sites:', len(sites))
print()
for i, ((code, msg), v) in enumerate(rows, 1):
    pk = ', '.join('%s:%d' % (k, c) for k, c in v['pkgs'].most_common())
    print('%3d. %4d  %s  [%s]  {%s}' % (i, v['n'], code, '/'.join(sorted(v['secs'])), pk))
    print('      ' + msg[:190])
    print('      eg: ' + '  '.join(sorted(v['files'])[:3]))
print()
print('distinct causes:', len(rows), ' unique sites:', sum(v['n'] for _, v in rows))
