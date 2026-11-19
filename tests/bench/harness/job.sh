#!/bin/bash
# job.sh <program>: everything one bench job does after the zapo tree is fetched (the workflow calls it; so can a box).
# Env in: WT_DIR (candidate tree, built), WT_BASE_DIR (optional base tree, built), BACKEND, VARIANTS (plain/census), REPS, NODE_REF, IR (callgrind messages, 0 = off),
#         MASSIF (massif messages, 0 = off), LAYOUT (none | order: instrumented build -> run once with SIGUSR1 where the work starts -> order.txt -> ordered build, A/B'd against plain),
#         EXTRA_ENV ("K=V;K=V", exported for the build AND the run; @LAB@ = the candidate tree, @OUT@ = the artifacts dir, @BENCHSRC@ = the repo root of the dispatched ref).
# Everything a run writes goes under $BENCH_WORK: out/<side>/ (logs, binaries), result/ (pmon, smaps, stdout/stderr, summary.md), artifacts/ (layout files and anything extra_env points at).
set -u
. "$(dirname "${BASH_SOURCE[0]}")/env.sh"
program=${1:?program}
ART=$BENCH_WORK/artifacts; mkdir -p "$ART" "$BENCH_WORK/out" "$BENCH_WORK/result"
LAB=${WT_DIR:?}
BACKEND=${BACKEND:-c}; VARIANTS=${VARIANTS:-plain}; VARIANTS=${VARIANTS//,/ }; REPS=${REPS:-3}; LAYOUT=${LAYOUT:-none}
# extra_env: K=V pairs separated by ';', never evaluated; the key must be a plain identifier
IFS=';' read -ra _kv <<< "${EXTRA_ENV:-}"
for _p in "${_kv[@]}"; do
  [ -z "$_p" ] && continue
  _k=${_p%%=*}; _v=${_p#*=}
  [[ "$_k" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || { echo "extra_env: bad key '$_k'"; exit 2; }
  _v=${_v//@LAB@/$LAB}; _v=${_v//@OUT@/$ART}; _v=${_v//@BENCHSRC@/$BENCH_ROOT}
  export "$_k=$_v"; echo "extra_env: $_k=$_v"
done
[ -n "${SCR_RRT_OUT:-}" ] && export RRT_KEEP="$ART/rrt-c"
cli_of() { if [ "$1" = cand ]; then echo "$WT_DIR/packages/cli/dist/main.js"; else echo "$WT_BASE_DIR/packages/cli/dist/main.js"; fi; }
sides=(base cand); [ -z "${WT_BASE_DIR:-}" ] && sides=(cand)
summary() { # <result-dir>
  { echo "### $program ($BACKEND, layout=$LAYOUT)"; echo "candidate \`$(cat "$GITHUB_WORKSPACE/wt.sha" 2>/dev/null)\`$( [ -f "$GITHUB_WORKSPACE/wt-base.sha" ] && echo " base \`$(cat "$GITHUB_WORKSPACE/wt-base.sha")\`")"; echo; cat "$1/summary.md"; echo; echo '```'; cat "$BENCH_WORK"/out/*/build-summary.txt 2>/dev/null; echo '```'; } >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
}
arms=()
if [ "$program" = rest ]; then
  for side in "${sides[@]}"; do
    o=$BENCH_WORK/out/$side
    SCC_CLI=$(cli_of $side) bash "$BENCH_DIR/harness/rest-build.sh" "$BACKEND" "$o" || echo "REST build of $side failed"
    [ -f "$o/zapo-rest-mysql-$BACKEND.bin" ] && arms+=("$side:$o/zapo-rest-mysql-$BACKEND.bin")
    if [ "$LAYOUT" = order ] && [ -f "$o/zapo-rest-mysql-$BACKEND.bin" ]; then
      SCC_CLI=$(cli_of $side) EXTRA_ARGS="--layout-profile" bash "$BENCH_DIR/harness/rest-build.sh" "$BACKEND" "$o" -prof || { echo "instrumented build of $side failed"; continue; }
      mkdir -p "$ART/layout/$side"
      $BENCH_NODE "$BENCH_DIR/harness/rest-run.mjs" --out "$ART/layout/$side" --profile "$o/zapo-rest-mysql-$BACKEND-prof.bin" "$ART/layout/$side/profile.txt" || { echo "profile run of $side failed"; continue; }
      $BENCH_NODE "$(cli_of $side)" layout-order "$o/zapo-rest-mysql-$BACKEND-prof.bin" "$ART/layout/$side/profile.txt" -o "$ART/layout/$side/order.txt" || continue
      SCC_CLI=$(cli_of $side) EXTRA_ARGS="--layout-order $ART/layout/$side/order.txt" bash "$BENCH_DIR/harness/rest-build.sh" "$BACKEND" "$o" -ordered || { echo "ordered build of $side failed"; continue; }
      arms+=("$side-ordered:$o/zapo-rest-mysql-$BACKEND-ordered.bin")
    fi
  done
  [ ${#arms[@]} -gt 0 ] || { echo "no REST binary was built"; exit 1; }
  $BENCH_NODE "$BENCH_DIR/harness/rest-run.mjs" --out "$BENCH_WORK/result" --reps "$REPS" --smaps "${arms[@]}" | tee "$BENCH_WORK/result-summary.txt"
  summary "$BENCH_WORK/result"; exit 0
fi
store=${program#messaging-}
bash "$BENCH_DIR/harness/mkbench.sh" "$store" messaging
for side in "${sides[@]}"; do
  o=$BENCH_WORK/out/$side
  for v in $VARIANTS; do
    SCC_CLI=$(cli_of $side) bash "$BENCH_DIR/harness/build.sh" "$store" "$BACKEND" "$o" "$v" || echo "build of $side/$v failed"
    suffix=""; [ "$v" = census ] && suffix="-census"
    f=$o/messaging-$store-$BACKEND$suffix.bin; [ -f "$f" ] && { chmod +x "$f"; arms+=("$side$suffix:$f"); }
  done
  plain=$o/messaging-$store-$BACKEND.bin
  if [ "$LAYOUT" = order ] && [ -f "$plain" ]; then
    SCC_CLI=$(cli_of $side) EXTRA_ARGS="--layout-profile" bash "$BENCH_DIR/harness/build.sh" "$store" "$BACKEND" "$o" plain -prof || { echo "instrumented build of $side failed"; continue; }
    mkdir -p "$ART/layout/$side"
    $BENCH_NODE "$BENCH_DIR/harness/profile-run.mjs" "$store" "$o/messaging-$store-$BACKEND-prof.bin" "$ART/layout/$side/profile.txt" "$ART/layout/$side" || { echo "profile run of $side failed"; continue; }
    $BENCH_NODE "$(cli_of $side)" layout-order "$o/messaging-$store-$BACKEND-prof.bin" "$ART/layout/$side/profile.txt" -o "$ART/layout/$side/order.txt" || continue
    SCC_CLI=$(cli_of $side) EXTRA_ARGS="--layout-order $ART/layout/$side/order.txt" bash "$BENCH_DIR/harness/build.sh" "$store" "$BACKEND" "$o" plain -ordered || { echo "ordered build of $side failed"; continue; }
    f=$o/messaging-$store-$BACKEND-ordered.bin; [ -f "$f" ] && { chmod +x "$f"; arms+=("$side-ordered:$f"); }
  fi
done
[ ${#arms[@]} -gt 0 ] || { echo "no binary was built"; exit 1; }
flags=(--store "$store" --out "$BENCH_WORK/result" --reps "$REPS" --smaps)
[ "${NODE_REF:-true}" = true ] && flags+=(--node)
[ "${IR:-0}" != 0 ] && flags+=(--ir "$IR")
[ "${MASSIF:-0}" != 0 ] && flags+=(--massif "$MASSIF")
$BENCH_NODE "$BENCH_DIR/harness/run.mjs" "${flags[@]}" "${arms[@]}" | tee "$BENCH_WORK/result-summary.txt"
summary "$BENCH_WORK/result"
if [ -n "${SCR_RRT_OUT:-}" ]; then
  python3 "$BENCH_DIR/harness/rrtjoin.py" "$SCR_RRT_OUT".* -- "$ART"/rrt-c/*.c > "$ART/rrt-summary.txt" 2>&1 || echo "rrtjoin failed"
  { ls -la "$ART" "$ART/rrt-c" | head -30; head -40 "$ART/rrt-summary.txt"; } || true
  rm -f "$ART"/rrt-c/*.c
fi
