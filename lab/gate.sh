#!/bin/bash
# The full suite under node v25.9.0. PATH is pinned INSIDE the launcher and
# `node --version` is the first line of the log, because Start-Process /
# nohup inherit v22 and a v22 gate reads as a phantom failure set.
# pnpm is never used here: v25's pnpm purges v22's node_modules on `exec`.
. /g/blocks/twobyte/lab/env.sh
export PATH="$NODE25:$PATH"
cd /g/blocks/twobyte || exit 1
LOG=/g/blocks/twobyte-lab/runs/gate-full.log
{
  echo "node $("$NODE25/node.exe" --version)"
  date
} > "$LOG"
"$NODE25/node.exe" ./node_modules/vitest/vitest.mjs run >> "$LOG" 2>&1
echo "VITEST_EXIT=$?" >> "$LOG"
date >> "$LOG"
