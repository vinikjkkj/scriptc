#!/bin/bash
# NEGATIVE CONTROL for the new fixture: measure tests/fixtures/node-types/
# child-stdio.ts with the three lowering changes STASHED, so the test being
# added has a recorded before-number taken on the very file it pins -- not
# only on the probes. Restores and rebuilds unconditionally.
. <blocks>/mediautils-work/env.sh
cd <blocks>/mediautils || exit 1
L=<blocks>/mediautils-work
{
  echo "ORACLE-NODE $(node --version)"
  echo "--- stashing packages/compiler/src ---"
  git stash push -m mediautils-negctl -- packages/compiler/src 2>&1
  pwsh -NoProfile -File "$L/build.ps1"; tail -1 "$L/build1.log"
  echo "--- BEFORE (changes stashed) ---"
  WT=<blocks>/mediautils node "$L/sites.mjs" tests/fixtures/node-types/child-stdio.ts "$L/sites/fixture-child-stdio-before.json" 2>&1
  echo "--- restoring ---"
  git stash pop 2>&1
  pwsh -NoProfile -File "$L/build.ps1"; tail -1 "$L/build1.log"
  echo "--- AFTER (changes restored) ---"
  WT=<blocks>/mediautils node "$L/sites.mjs" tests/fixtures/node-types/child-stdio.ts "$L/sites/fixture-child-stdio-after.json" 2>&1
  echo "--- git status ---"
  git status --short
} > "$L/logs/negctl.log" 2>&1
echo "=== GATE-EXIT rc=$? ===" >> "$L/logs/negctl.log"
