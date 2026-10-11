#!/bin/sh
# f2-six.sh -- the six runs, in the order declared in PREREG.txt before run 1
# existed: PRE POS POS PRE PRE POS.  Sequential, one process at a time.
set -u
START=$(date -u +%Y-%m-%dT%H:%M:%SZ)
echo "SIX-START $START"
sh /g/blocks/f2-run.sh PRE q1
sh /g/blocks/f2-run.sh POS q2
sh /g/blocks/f2-run.sh POS q3
sh /g/blocks/f2-run.sh PRE q4
sh /g/blocks/f2-run.sh PRE q5
sh /g/blocks/f2-run.sh POS q6
echo "SIX-END   $(date -u +%Y-%m-%dT%H:%M:%SZ)  (started $START)"
