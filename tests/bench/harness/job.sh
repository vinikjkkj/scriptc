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
      # HOTCOLD=1: the instrumented build also counts blocks (--layout-block-profile) and the one profiling run writes the .profraw files beside profile.txt
      SCC_CLI=$(cli_of $side) EXTRA_ARGS="--layout-profile${HOTCOLD:+ --layout-block-profile}" bash "$BENCH_DIR/harness/rest-build.sh" "$BACKEND" "$o" -prof || { echo "instrumented build of $side failed"; continue; }
      mkdir -p "$ART/layout/$side"
      LLVM_PROFILE_FILE="$ART/layout/$side/block-%p.profraw" $BENCH_NODE "$BENCH_DIR/harness/rest-run.mjs" --out "$ART/layout/$side" --profile "$o/zapo-rest-mysql-$BACKEND-prof.bin" "$ART/layout/$side/profile.txt" || { echo "profile run of $side failed"; continue; }
      $BENCH_NODE "$(cli_of $side)" layout-order "$o/zapo-rest-mysql-$BACKEND-prof.bin" "$ART/layout/$side/profile.txt" -o "$ART/layout/$side/order.txt" || continue
      SCC_CLI=$(cli_of $side) EXTRA_ARGS="--layout-order $ART/layout/$side/order.txt" bash "$BENCH_DIR/harness/rest-build.sh" "$BACKEND" "$o" -ordered || { echo "ordered build of $side failed"; continue; }
      arms+=("$side-ordered:$o/zapo-rest-mysql-$BACKEND-ordered.bin")
      if [ -n "${HOTCOLD:-}" ]; then
        $BENCH_NODE "$(cli_of $side)" layout-profdata "$ART"/layout/$side/block-*.profraw -o "$ART/layout/$side/block.profdata" && ls -la "$ART/layout/$side/block.profdata" | tee -a "$ART/sysinfo.txt"
        s0=$(date +%s)
        SCC_CLI=$(cli_of $side) EXTRA_ARGS="--layout-order $ART/layout/$side/order.txt --layout-block-use $ART/layout/$side/block.profdata" bash "$BENCH_DIR/harness/rest-build.sh" "$BACKEND" "$o" -hotcold || { echo "hotcold build of $side failed"; continue; }
        echo "hotcold build wall $(( $(date +%s) - s0 )) s (ordered build wall is in its build log)" | tee -a "$ART/sysinfo.txt"
        arms+=("$side-hotcold:$o/zapo-rest-mysql-$BACKEND-hotcold.bin")
        # A/A control: the SAME ordered binary under a second label
        cp "$o/zapo-rest-mysql-$BACKEND-ordered.bin" "$o/zapo-rest-mysql-$BACKEND-ordered-aa.bin"; arms+=("$side-ordered-aa:$o/zapo-rest-mysql-$BACKEND-ordered-aa.bin")
      fi
    fi
  done
  [ ${#arms[@]} -gt 0 ] || { echo "no REST binary was built"; exit 1; }
  # RAMAP_MATRIX=1: one wrapper arm per (built arm, knob set) so a SINGLE binary is A/B'd by environment alone (the lab runtime's SCR_TEXT_DROP_AFTER_MS / SCR_TEXT_MADV).
  # The wrapper execs the binary, so pmon and the sampler see the app's own pid.
  if [ -n "${RAMAP_MATRIX:-}" ]; then
    base_arms=("${arms[@]}")
    for a in "${base_arms[@]}"; do
      lab=${a%%:*}; bin=${a#*:}
      for cfg in "after0:SCR_TEXT_DROP_AFTER_MS=0" "after30:SCR_TEXT_DROP_AFTER_MS=30" "rand:SCR_TEXT_MADV=random" "rand-after0:SCR_TEXT_MADV=random SCR_TEXT_DROP_AFTER_MS=0" "nohuge:SCR_TEXT_MADV=nohuge"; do
        cn=${cfg%%:*}; kv=${cfg#*:}
        w="$(dirname "$bin")/wrap-$lab-$cn.sh"
        printf '#!/bin/sh\nexec env %s "%s" "$@"\n' "$kv" "$bin" > "$w"; chmod +x "$w"
        arms+=("$lab-$cn:$w")
      done
    done
  fi
  $BENCH_NODE "$BENCH_DIR/harness/rest-run.mjs" --out "$BENCH_WORK/result" --reps "$REPS" --smaps "${arms[@]}" | tee "$BENCH_WORK/result-summary.txt"
  # RAMAP_FA_SWEEP="4096": the same binaries again with the kernel's fault-around window set to each value (bytes), system-wide for the job; at 4096 the
  # resident text of a snapshot is the pages that were actually TOUCHED, so (64 KiB run) - (4 KiB run) is the fault-around neighbours. The default is restored after.
  if [ -n "${RAMAP_FA_SWEEP:-}" ]; then
    fa_def=$(sudo cat /sys/kernel/debug/fault_around_bytes 2>/dev/null || echo 65536)
    for fa in ${RAMAP_FA_SWEEP//,/ }; do
      echo "$fa" | sudo tee /sys/kernel/debug/fault_around_bytes >/dev/null
      echo "fault_around_bytes now $(sudo cat /sys/kernel/debug/fault_around_bytes)" | tee -a "$ART/sysinfo.txt"
      mkdir -p "$ART/fa-$fa"
      $BENCH_NODE "$BENCH_DIR/harness/rest-run.mjs" --out "$ART/fa-$fa" --reps "$REPS" --smaps "${arms[@]}" > "$ART/fa-$fa/result-summary.txt" 2>&1 || echo "fault-around $fa run failed"
    done
    echo "$fa_def" | sudo tee /sys/kernel/debug/fault_around_bytes >/dev/null
  fi
  # RAMAP_CG=1: every built arm once more under callgrind with per-instruction counts (the executed-instruction set of the whole run; the arm is the binary
  # itself, so its addresses are the ones the residency bitmaps use). The output is compressed into the artifacts.
  if [ -n "${RAMAP_CG:-}" ]; then
    cg_arms=()
    for a in "${arms[@]}"; do
      lab=${a%%:*}; bin=${a#*:}
      case "$lab" in *-after*|*-rand*|*-nohuge*|*-aa) continue;; esac
      w="$(dirname "$bin")/cg-$lab.sh"
      printf '#!/bin/sh\nexec valgrind --tool=callgrind --dump-instr=yes --callgrind-out-file="%s/cg-%s.out" "%s" "$@"\n' "$ART" "$lab" "$bin" > "$w"; chmod +x "$w"
      cg_arms+=("cg-$lab:$w")
    done
    mkdir -p "$ART/cg"
    $BENCH_NODE "$BENCH_DIR/harness/rest-run.mjs" --out "$ART/cg" --reps 1 --smaps "${cg_arms[@]}" > "$ART/cg/result-summary.txt" 2>&1 || echo "callgrind run failed"
    gzip -f "$ART"/cg-*.out 2>/dev/null || true
  fi
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
    SCC_CLI=$(cli_of $side) EXTRA_ARGS="--layout-profile${HOTCOLD:+ --layout-block-profile}" bash "$BENCH_DIR/harness/build.sh" "$store" "$BACKEND" "$o" plain -prof || { echo "instrumented build of $side failed"; continue; }
    mkdir -p "$ART/layout/$side"
    LLVM_PROFILE_FILE="$ART/layout/$side/block-%p.profraw" $BENCH_NODE "$BENCH_DIR/harness/profile-run.mjs" "$store" "$o/messaging-$store-$BACKEND-prof.bin" "$ART/layout/$side/profile.txt" "$ART/layout/$side" || { echo "profile run of $side failed"; continue; }
    $BENCH_NODE "$(cli_of $side)" layout-order "$o/messaging-$store-$BACKEND-prof.bin" "$ART/layout/$side/profile.txt" -o "$ART/layout/$side/order.txt" || continue
    SCC_CLI=$(cli_of $side) EXTRA_ARGS="--layout-order $ART/layout/$side/order.txt" bash "$BENCH_DIR/harness/build.sh" "$store" "$BACKEND" "$o" plain -ordered || { echo "ordered build of $side failed"; continue; }
    f=$o/messaging-$store-$BACKEND-ordered.bin; [ -f "$f" ] && { chmod +x "$f"; arms+=("$side-ordered:$f"); }
    if [ -n "${HOTCOLD:-}" ] && [ -f "$f" ]; then
      $BENCH_NODE "$(cli_of $side)" layout-profdata "$ART"/layout/$side/block-*.profraw -o "$ART/layout/$side/block.profdata" && ls -la "$ART/layout/$side/block.profdata" | tee -a "$ART/sysinfo.txt"
      s0=$(date +%s)
      SCC_CLI=$(cli_of $side) EXTRA_ARGS="--layout-order $ART/layout/$side/order.txt --layout-block-use $ART/layout/$side/block.profdata" bash "$BENCH_DIR/harness/build.sh" "$store" "$BACKEND" "$o" plain -hotcold || { echo "hotcold build of $side failed"; continue; }
      echo "hotcold build wall $(( $(date +%s) - s0 )) s" | tee -a "$ART/sysinfo.txt"
      f2=$o/messaging-$store-$BACKEND-hotcold.bin; [ -f "$f2" ] && { chmod +x "$f2"; arms+=("$side-hotcold:$f2"); }
      cp "$f" "$o/messaging-$store-$BACKEND-ordered-aa.bin"; chmod +x "$o/messaging-$store-$BACKEND-ordered-aa.bin"; arms+=("$side-ordered-aa:$o/messaging-$store-$BACKEND-ordered-aa.bin")
    fi
  fi
done
[ ${#arms[@]} -gt 0 ] || { echo "no binary was built"; exit 1; }
flags=(--store "$store" --out "$BENCH_WORK/result" --reps "$REPS" --smaps)
[ "${NODE_REF:-true}" = true ] && flags+=(--node)
[ "${IR:-0}" != 0 ] && flags+=(--ir "$IR")
[ "${MASSIF:-0}" != 0 ] && flags+=(--massif "$MASSIF")
$BENCH_NODE "$BENCH_DIR/harness/run.mjs" "${flags[@]}" "${arms[@]}" | tee "$BENCH_WORK/result-summary.txt"
summary "$BENCH_WORK/result"
