"""An independent model of scr_arr_join's growth policy.

Written from the DESCRIPTION, not from the C:

  A join starts with a 64-byte buffer and a length of 0. Each piece appended
  is a separator (between elements) or an element's bytes. If length + piece
  would exceed the capacity, the capacity DOUBLES -- repeatedly, until the
  piece fits -- and that counts as one growth event. The bytes live in the
  buffer at the moment growth is requested are what a relocating realloc
  would have to copy.

If this disagrees with the C, my model of the policy is wrong and the
report that rests on it does not get written.
"""
import subprocess, sys


def model(nelem, elen, slen):
    cap, ln, grows, moved = 64, 0, 0, 0
    pieces = []
    for i in range(nelem):
        if i > 0:
            pieces.append(slen)
        pieces.append(elen)
    for n in pieces:
        if ln + n > cap:
            grows += 1
            moved += ln
            while ln + n > cap:
                cap *= 2
        ln += n
    return ln, grows, moved, cap


CASES = [(1, 10, 1), (500, 10, 1), (500, 30, 1), (256, 29, 1),
         (1000, 2, 1), (4, 5000, 2), (0, 10, 1), (1, 100, 1)]

exe = sys.argv[1]
out = subprocess.run([exe], capture_output=True, text=True).stdout.strip().splitlines()
assert len(out) == len(CASES), 'expected %d lines, got %d' % (len(CASES), len(out))

bad = 0
for line, case in zip(out, CASES):
    lhs, rhs = line.split('->')
    got = dict(kv.split('=') for kv in rhs.split())
    ln, grows, moved, cap = model(*case)
    ok = (int(got['out']) == ln and int(got['grows']) == grows
          and int(got['moved']) == moved and int(got['cap']) == cap)
    if not ok:
        bad += 1
    print('%-16s C: out=%-8s grows=%-3s moved=%-8s cap=%-7s | model: %-8d %-3d %-8d %-7d  %s'
          % (lhs.strip(), got['out'], got['grows'], got['moved'], got['cap'],
             ln, grows, moved, cap, 'ok' if ok else 'MISMATCH'))

print()
if bad:
    print('SELF-TEST FAILED: %d of %d cases disagree' % (bad, len(CASES)))
    sys.exit(1)
print('SELF-TEST PASSED: %d of %d cases, two independent implementations agree' % (len(CASES), len(CASES)))
print()
print('What the model says about the MEASURED run (mean out 7,514 bytes):')
for n, e, s in [(500, 15, 0), (256, 29, 1), (500, 30, 1)]:
    ln, g, m, c = model(n, e, s)
    print('  %3d elems x %5d B -> out %7d  grows %2d  moved %8d  (moved/out %.2fx)'
          % (n, e, ln, g, m, m / ln if ln else 0))
