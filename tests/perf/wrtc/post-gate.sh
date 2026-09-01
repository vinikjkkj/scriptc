#!/bin/sh
# Everything that must wait for the gate to stop holding the CPU.
# Run from G:/blocks/wrtc.  . G:/blocks/wrtc-lab/env.sh first.
set -u
W=G:/blocks/wrtc
T=G:/blocks/wrtc-tmp
LAB=G:/blocks/wrtc-lab

echo "=== 1. stage 2: connected-mode node:dgram, the FNA relay path's real prerequisite ==="
cd "$W"
node_modules/.bin/tsx packages/cli/src/main.ts build "$LAB/probe/dgram-connected.ts" \
  -o "$T/dgram.exe" > "$T/dgram-build.log" 2>&1
echo "build rc=$?"
grep -c "error" "$T/dgram-build.log" || true
echo "--- run (compiled) ---"
"$T/dgram.exe" > "$T/dgram-c.out" 2>&1; echo "run rc=$?"; cat "$T/dgram-c.out"
echo "--- oracle node v25.9.0 ---"
"$NODE25" --experimental-strip-types "$LAB/probe/dgram-connected.ts" > "$T/dgram-node.out" 2>&1
echo "oracle rc=$?"; cat "$T/dgram-node.out"
echo "--- verdict ---"
if cmp -s "$T/dgram-c.out" "$T/dgram-node.out"; then echo "MATCH (byte-identical)"; else echo "DIFFERS:"; diff "$T/dgram-node.out" "$T/dgram-c.out"; fi
echo "--- engine scan (must be 0/0/0) ---"
for s in quickjs ScrDyn JS_NewRuntime; do
  printf '%-14s %s\n' "$s" "$(grep -c -a "$s" "$T/dgram.exe" 2>/dev/null || echo 0)"
done

echo
echo "=== 2. does the ambient file cost measurable time PER PROGRAM? ==="
# A/B in this same worktree, back to back, same host state. Comparing to
# voipfix's 578 s from another revision on another day would not be a control.
cd "$W"
node "$LAB/ambient-cost.mjs" with-ambient 60

echo "--- removing the ambient root and rebuilding ---"
python - <<'PY'
p = 'G:/blocks/wrtc/packages/compiler/src/frontend/program.ts'
b = open(p, 'rb').read()
o = b'    wrtcDtsPath(),'
assert b.count(o) == 1, b.count(o)
open(p, 'wb').write(b.replace(o, b'    // A/B: ambient root temporarily removed\n'))
print('root removed')
PY
pnpm build > "$T/ab-build.log" 2>&1; echo "rebuild rc=$?"
node "$LAB/ambient-cost.mjs" without-ambient 60

echo "--- restoring ---"
cd "$W" && git checkout -- packages/compiler/src/frontend/program.ts
pnpm build > "$T/ab-restore.log" 2>&1; echo "restore rebuild rc=$?"
git diff --stat packages/compiler/src/frontend/program.ts

echo
echo "=== 3. the timing-out test, ALONE and uncontended ==="
echo "(filtered runs skip the suite lock; this is the attribution run)"
cd "$W"
/c/Users/vinicius/AppData/Local/nvm/v25.9.0/node node_modules/vitest/vitest.mjs run \
  tests/harness/coverage.test.ts -t "every corpus program is 100% static" \
  > "$T/corpus-solo.log" 2>&1
echo "solo rc=$?"
sed 's/\x1b\[[0-9;]*m//g' "$T/corpus-solo.log" | grep -E "100% static|Tests  |Duration" | tail -5
