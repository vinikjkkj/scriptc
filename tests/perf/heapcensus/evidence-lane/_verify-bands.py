# _verify-bands.py -- checks every pointer in every appended band AFTER the
# edit, against the POST-EDIT file. A pointer that names a section and quotes a
# sentence is only a pointer if that section and that sentence are still there,
# ABOVE the band. Exits non-zero on any miss; prints one line per check.
import os, sys

ROOT = r'G:\blocks\v2-wt\tests\perf\heapcensus'

# (file, marker that starts the band, [(what the band claims is above it)...])
CHECKS = [
    ('POSTFIX-CENSUS.md', '## AUDITED, 2026-10-11 (later the same day)', [
        ('section', 'RESOLVED, 2026-10-11'),
        ('quote', 'The confound was 11.1% of the claimed effect, not 720%'),
        ('quote', 'Settled CRT'),
        ('quote', '16,243,072 B fiber against 15,902,592 B stackless'),
        ('quote', 'The effect reproduced to the byte on the other lane.'),
        ('quote', '47 chunks,'),
    ]),
    ('evidence-postfix/sb.compare.txt', 'APPENDED BY HAND 2026-10-11', [
        ('section', "=== THE LANE'S EFFECT ON THE SETTLED HEAP (sb STACKLESS - sa FIBER) ==="),
        ('section', "=== THE LANE'S EFFECT ON THE SETTLED HEAP, EVERY COLUMN ==="),
        ('section', '=== WHAT THIS PAIR CANNOT SAY ==='),
        ('quote', 'delta            = -340480 B (-0.325 MiB, -2.10% of the fiber arm)'),
        ('quote', 'THE HEADLINE. On the BUSY column the lane is worth -340,480 B'),
        ('quote', 'A -340,480 B delta from'),
        ('quote', 'is not worth 21 MiB on the settled busy heap'),
    ]),
    ('evidence-postfix/LANE.txt', 'AUDITED 2026-10-11 -- THE SETTLED-HEAP LANE FIGURE', [
        ('section', 'THE CONFOUND THIS FILE FLAGGED, NOW MEASURED'),
        ('section', 'WHAT THE PAIR CANNOT SAY'),
        ('section', 'WHAT IS STILL NOT CLOSED'),
        ('quote', 'busy             16,243,072     15,902,592      -340,480 B  (-0.325 MiB)'),
        ('quote', 'ON THE BUSY COLUMN THE CONFOUND IS 11.1% OF THE CLAIMED EFFECT, NOT 720%.'),
        ('quote', 'AND THE LANE IS NOT A SMALL THING IN THIS HEAP.'),
        ('quote', 'It is not a point estimate of -340,480.'),
        ('quote', 'licenses applying -340,480 B'),
    ]),
    ('evidence-variance/VARIANCE.md', '## 10. ANSWERED, 2026-10-11', [
        ('section', '## 8.'),
        ('quote', 'Did not re-measure the FIBER arm'),
        ('quote', 'is **untouched by this slice**'),
        ('quote', 'the same question applies to it and is still open'),
        ('quote', 'Did not explain why `sb` ran heavy.'),
    ]),
]

# Cross-file pointers the bands make: file must exist and hold the anchor.
FILES = [
    ('evidence-lane/PREREG.txt', 'THE ORDER, DECLARED NOW: C B B C C B'),
    ('evidence-lane/RESULTS.txt', 'THE VERDICT ON THE -340,480 B SENTENCE'),
    ('evidence-lane/lane-stats.mjs', 'lane-stats.mjs'),
    ('evidence-lane/RESULTS.txt', '[-702009, 504291]'),
    ('evidence-lane/RESULTS.txt', 'Welch df = 2.10'),
]

fails = 0
for rel, marker, items in CHECKS:
    path = os.path.join(ROOT, rel.replace('/', os.sep))
    text = open(path, 'rb').read().decode('utf-8')
    if marker not in text:
        print('FAIL  %-34s band marker missing: %r' % (rel, marker))
        fails += 1
        continue
    above = text[:text.index(marker)]
    for kind, needle in items:
        ok = needle in above
        print('%-5s %-34s %-8s %r' % ('ok' if ok else 'FAIL', rel, kind, needle[:62]))
        if not ok:
            fails += 1

for rel, needle in FILES:
    path = os.path.join(ROOT, rel.replace('/', os.sep))
    ok = os.path.exists(path) and needle in open(path, 'rb').read().decode('utf-8', 'replace')
    print('%-5s %-34s %-8s %r' % ('ok' if ok else 'FAIL', rel, 'target', needle[:62]))
    if not ok:
        fails += 1

# Every band must carry the scope clause.
for rel, marker, _ in CHECKS:
    path = os.path.join(ROOT, rel.replace('/', os.sep))
    text = open(path, 'rb').read().decode('utf-8')
    band = text[text.index(marker):]
    ok = 'NOT NAMED ABOVE ARE NOT THEREBY IN FORCE' in band.upper().replace('—', '--')
    print('%-5s %-34s %-8s scope clause present in band' % ('ok' if ok else 'FAIL', rel, 'scope'))
    if not ok:
        fails += 1

print()
print('CHECKS FAILED: %d' % fails)
sys.exit(1 if fails else 0)
