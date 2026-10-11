#!/bin/sh
# v3-six.sh -- the six runs, in the order declared in PREREG.txt before run 1
# existed: SL FB FB SL SL FB.  Sequential, one process at a time.
set -u
START=$(date -u +%Y-%m-%dT%H:%M:%SZ)
echo "SIX-START $START"
sh /g/blocks/v3-run.sh SL p1
sh /g/blocks/v3-run.sh FB p2
sh /g/blocks/v3-run.sh FB p3
sh /g/blocks/v3-run.sh SL p4
sh /g/blocks/v3-run.sh SL p5
sh /g/blocks/v3-run.sh FB p6
echo "SIX-END   $(date -u +%Y-%m-%dT%H:%M:%SZ)  (started $START)"
