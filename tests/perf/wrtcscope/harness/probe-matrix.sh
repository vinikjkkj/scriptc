#!/bin/sh
# probe-matrix.sh — block/wrtcscope.
#
# Builds each WebRTC probe in each RESOLUTION LANE, strict (never
# --best-effort), scores it against the node oracle, and reports one row per
# (probe, lane). Committed so the numbers can be reproduced without me.
#
#   lane noPkg   — @roamhq/wrtc is NOT installed; the shipped ambient
#                  declarations in packages/compiler/ambient/scriptc-wrtc.d.ts
#                  apply. This is the lane every earlier block measured.
#   lane withPkg — the package IS installed, which is how zapo declares it
#                  (peerDependency >=0.10.0 AND devDependency ^0.10.0) and how
#                  any project that also runs under node installs it.
#                  THIS IS THE LANE A REAL CONSUMER GETS.
#
# Per row it records: build rc, the backend the build actually used (a
# demotion is not a backend, so the demotion line is quoted verbatim), run rc,
# binary size, the oracle verdict, the engine scan, and the fence count.
#
# Usage:  . tests/perf/wrtcscope/harness/env.sh
#         sh tests/perf/wrtcscope/harness/probe-matrix.sh [probe ...]
#
# Never edit this file while sh is running it: sh re-reads by byte offset and
# the running process will execute fragments.

set -u

WT="${WRTCSCOPE_WT:?source tests/perf/wrtcscope/harness/env.sh first}"
LAB="${WRTCSCOPE_LAB:-${BLOCKS_ROOT:-<blocks>}/wrtcscope/lab}"
OUT="${WRTCSCOPE_OUT:-$LAB/out}"
CLI="$WT/packages/cli/dist/main.js"
ORACLE="$LAB/oracle"

node "$WT/tests/perf/wrtcscope/harness/guard.mjs" || exit 2

PROBES="${*:-rtc-dc rtc-signal rtc-events}"
mkdir -p "$OUT"

# ---- the oracle -------------------------------------------------------------
# Run the SAME source under node with the real @roamhq/wrtc addon. The probe is
# copied into the oracle project so node resolves the real package; scriptc
# compiles it from the lane directory. Same bytes, two engines: that is what
# makes this a differential and not two unrelated programs.
oracle_run() {
  _p="$1"; _dst="$ORACLE/$_p.ts"
  cp "$LAB/noPkg/src/$_p.ts" "$_dst" 2>/dev/null || return 1
  # node v25 strips types from a .ts file, but `as` casts and `declare` need
  # --experimental-transform-types. Copied as .ts, NOT .mjs: as .mjs node
  # parses it as plain JavaScript and every annotation is a SyntaxError, which
  # reads exactly like "the oracle cannot run this probe" and is really "the
  # harness handed node the wrong extension". That mistake cost one run here.
  ( cd "$ORACLE" && node --experimental-transform-types --no-warnings "$_dst" )     2>"$OUT/$_p.oracle.err"
}

# ---- the engine scan --------------------------------------------------------
# A binary that carries quickjs, ScrDyn or JS_NewRuntime is not the pure-C
# binary the objective asks for. The scan needs a POSITIVE CONTROL or an empty
# result is indistinguishable from a scanner that cannot see strings at all:
# 'RTCDataChannel' must be found, and if it is not the zeros mean nothing.
engine_scan() {
  _exe="$1"; _runout="$2"
  # The control string is DERIVED FROM THIS PROBE, not hardcoded: the first
  # line the program printed, truncated at the first '=' , is a string literal
  # the binary must contain. A hardcoded 'RTCDataChannel' is the wrong control
  # for a dgram binary and reported SCAN-UNTRUSTWORTHY on a perfectly good
  # scan -- which is the guard doing its job, but the guard should not have to.
  _ctlstr=$(head -1 "$_runout" 2>/dev/null | cut -d= -f1)
  _q=$(strings -a "$_exe" 2>/dev/null | grep -c 'quickjs')
  _s=$(strings -a "$_exe" 2>/dev/null | grep -c 'ScrDyn')
  _j=$(strings -a "$_exe" 2>/dev/null | grep -c 'JS_NewRuntime')
  _ctl=0
  [ -n "$_ctlstr" ] && _ctl=$(strings -a "$_exe" 2>/dev/null | grep -cF "$_ctlstr")
  if [ "$_ctl" -eq 0 ]; then
    echo "quickjs=$_q ScrDyn=$_s JS_NewRuntime=$_j control=0 SCAN-UNTRUSTWORTHY"
  else
    echo "quickjs=$_q ScrDyn=$_s JS_NewRuntime=$_j control=$_ctl"
  fi
}

# ---- the fence count --------------------------------------------------------
# An SC census lies in both directions. SC9002/9003/9004 are assertions emitted
# for CORRECT code (3,782 of one strict build's 3,786 SC occurrences were
# these), so they are excluded. And one real refusal carries no code at all,
# so the uncoded refusal strings are searched for separately. n/a, not 0,
# where there is no artifact to count.
fence_count() {
  _dir="$1"
  _c=$(ls "$_dir"/*.c "$_dir"/*.scrh "$_dir"/*.ll 2>/dev/null)
  [ -z "$_c" ] && { echo "n/a (no emitted TU)"; return; }
  _coded=$(cat $_c 2>/dev/null | grep -oE 'SC[0-9]{4}' | grep -vE 'SC900[234]' | sort | uniq -c | tr '\n' ' ')
  _uncoded=$(cat $_c 2>/dev/null | grep -cE "dynamic import\(\)|has no scriptc lowering")
  [ -z "$_coded" ] && _coded="none"
  echo "coded=[$_coded] uncoded-refusal-strings=$_uncoded"
}

printf '%s\n' "== probe-matrix  $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
printf '%s\n' "   main       $(cd "$WT" && git rev-parse --short HEAD)"
printf '%s\n' "   node       $(node -v)   zig $(zig version)"
printf '%s\n' "   target     ${SCRIPTC_TARGET:-unset}   cc ${SCRIPTC_CC:-unset}"
echo

for p in $PROBES; do
  echo "############ $p"
  # The oracle is scored once per probe, not once per lane: it is the same
  # source under node either way.
  oracle_run "$p" >"$OUT/$p.oracle.out"
  orc=$?
  if [ $orc -ne 0 ]; then
    echo "  oracle rc=$orc  DID-NOT-RUN  ($(head -c 200 "$OUT/$p.oracle.err" | tr '\n' ' '))"
  else
    echo "  oracle rc=0  $(wc -l <"$OUT/$p.oracle.out" | tr -d ' ') lines"
  fi

  for lane in noPkg withPkg; do
    src="$LAB/$lane/src/$p.ts"
    [ -f "$src" ] || { echo "  [$lane] no source"; continue; }
    # Each lane gets its OWN output directory. Two builds of the same entry
    # into one directory collide on the emitted .ll/.c path and the CLI
    # deletes it mid-link. -o names a FILE, not a directory.
    od="$OUT/$p.$lane"; rm -rf "$od"; mkdir -p "$od"
    ( cd "$LAB/$lane" && node "$CLI" build "src/$p.ts" -o "$od/$p.exe" --keep-c ) \
      >"$od/build.out" 2>&1
    brc=$?
    # "scriptc: backend c (llvm refused: ...)" is a DEMOTION, not a backend.
    backend=$(grep -oE 'backend [a-z]+ \(llvm refused: [^)]*\)|backend [a-z]+' "$od/build.out" | head -1)
    [ -z "$backend" ] && backend="(not stated)"
    if [ $brc -ne 0 ]; then
      echo "  [$lane] build rc=$brc  ERRORS:"
      tr -d '' <"$od/build.out" | grep -oE 'SC[0-9]{4}.*' | grep -vE '^SC900[234]' \
        | sed 's/^/      /' | head -30
      # An uncoded refusal carries no SC number and is invisible to the line
      # above -- e.g. "Cannot load module 'argo-codec': dynamic import() ...".
      # Searched for separately, by string, because an SC census lies both ways.
      tr -d '' <"$od/build.out" | grep -E "dynamic import|Cannot load module" \
        | sed 's/^/      UNCODED: /' | head -5
      continue
    fi
    ( cd "$LAB/$lane" && "$od/$p.exe" ) >"$od/run.out" 2>"$od/run.err"
    rrc=$?
    size=$(stat -c %s "$od/$p.exe" 2>/dev/null || echo '?')
    if [ $orc -ne 0 ]; then
      verdict="DID-NOT-RUN (no oracle)"
    elif diff -q "$OUT/$p.oracle.out" "$od/run.out" >/dev/null 2>&1; then
      verdict="MATCH byte-identical"
    else
      verdict="WRONG ($(diff "$OUT/$p.oracle.out" "$od/run.out" | grep -c '^[<>]') differing lines)"
    fi
    echo "  [$lane] build rc=0  $backend"
    echo "          run rc=$rrc  size=$size B  $verdict"
    echo "          engine  $(engine_scan "$od/$p.exe" "$od/run.out")  [control='$(head -1 "$od/run.out" 2>/dev/null | cut -d= -f1)']"
    echo "          fences  $(fence_count "$od")"
    # The TIER is read off the artifact, not off the log: a demoted build
    # leaves a .c, an LLVM build leaves a .ll. The absence of a "llvm refused"
    # line is not evidence; the file on disk is.
    _ll=$(ls "$od"/*.ll 2>/dev/null | wc -l | tr -d ' ')
    _cc=$(ls "$od"/*.c  2>/dev/null | wc -l | tr -d ' ')
    echo "          tier    .ll=$_ll .c=$_cc  $( [ "$_ll" -gt 0 ] && echo 'LLVM tier' || echo 'C tier (demoted or refused)' )"
  done
  echo
done
