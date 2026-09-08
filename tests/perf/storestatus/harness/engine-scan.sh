#!/bin/bash
# engine-scan.sh -- does this binary embed the JS engine?
#
# ARMED, not assumed. Of five candidate markers only two discriminate on this
# host: `hello.ts --dynamic` (a binary that certainly DOES embed the engine)
# reads JS_NewRuntime=0, JS_Eval=0, __island_eval=0. A zero from those three
# means nothing at all. Only `quickjs` and `ScrDyn` separate the two builds.
# harness/arm-engine-scan.sh reproduces that arming on the current compiler and
# must be run before any "engine-free" claim in a report.
#
# Usage: bash engine-scan.sh <exe> ...
for e in "$@"; do
  [ -f "$e" ] || { echo "engine scan: $e ABSENT -- verdict n/a, not clean"; continue; }
  printf 'ENGINE-SCAN %-28s bytes=%-11s quickjs=%s ScrDyn=%s | (non-discriminating: JS_NewRuntime=%s JS_Eval=%s __island_eval=%s)\n' \
    "$(basename "$e")" "$(stat -c%s "$e")" \
    "$(strings -a "$e" | grep -c quickjs)" \
    "$(strings -a "$e" | grep -c ScrDyn)" \
    "$(strings -a "$e" | grep -c JS_NewRuntime)" \
    "$(strings -a "$e" | grep -c JS_Eval)" \
    "$(strings -a "$e" | grep -c __island_eval)"
done
