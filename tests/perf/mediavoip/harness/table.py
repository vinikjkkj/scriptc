import glob, os, re, sys

d = sys.argv[1] if len(sys.argv) > 1 else 'covtxt'
print('%-38s %6s %8s %6s  %s' % ('MODULE', 'STMTS', 'STATIC', 'PCT', 'NOTE'))
for f in sorted(glob.glob(os.path.join(d, '*.log'))):
    n = os.path.basename(f)[:-4].replace('__', '/')
    t = open(f, encoding='utf-8', errors='replace').read()
    m = re.search(r'not analyzable: (\d+) TypeScript error', t)
    if m:
        print('%-38s %6s %8s %6s  PREFLIGHT-FAIL (%s tsc errors)' % (n, '-', '-', '-', m.group(1)))
        continue
    a = re.search(r'statements analyzed\s+(\d+)', t)
    s = re.search(r'compile statically\s+(\d+)\s+\((\d+)%\)', t)
    sig = re.search(r'\+(\d+) functions not analyzed', t)
    print('%-38s %6s %8s %5s%%  %s' % (
        n, a.group(1) if a else '-', s.group(1) if s else '-', s.group(2) if s else '-',
        ('%s signature-blocked fns' % sig.group(1)) if sig else ''))
