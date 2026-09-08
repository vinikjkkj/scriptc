#!/bin/bash
# queue.sh -- the whole survey, in the order it was run, so the numbers in
# README.md can be reproduced rather than believed.
#
#   bash queue.sh <stage>
#
# Stages are separate because the machine has six physical cores and other
# blocks run on it: never more than three of these node processes at once.
# Each stage names its lane in the entry it uses, and the lane is the larger
# half of every number here:
#
#   CONSUMER lane   drivers/_x-<pkg>-plus-zapo.ts  -- the store package AND
#                   zapo-js, which is what a real consumer imports (the plugin
#                   exists to be handed to a WaClient). provenance walks bare
#                   imports in driver-import order, so naming zapo-js registers
#                   1.8.2 before the store package is reached.
#   BARE lane       drivers/<pkg>.ts               -- the store package alone.
#
# 41 alias keys are spelled by more than one mapped package with different
# targets; tsconfig "paths" is one table per program, so which zapo-js the
# store package compiles against is decided by the DRIVER. That collision moved
# four packages' numbers by 5->32, 86->15, 6->58 and 46->39 in earlier surveys.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/env.sh" || exit 1
A="bash $HERE/analyse1.sh"
B="bash $HERE/build1.sh"
case "$1" in
  arm)       bash "$HERE/arm-engine-scan.sh"; bash "$HERE/ladder.sh" ;;
  consumer1) $A drivers/_x-redis-plus-zapo.ts    c-store-redis    --provenance-sources ;;
  consumer2) $A drivers/_x-mysql-plus-zapo.ts    c-store-mysql    --provenance-sources ;;
  consumer3) $A drivers/_x-postgres-plus-zapo.ts c-store-postgres --provenance-sources ;;
  consumer4) $A drivers/_x-mongo-plus-zapo.ts    c-store-mongo    --provenance-sources ;;
  bare1)     $A drivers/store-redis.ts    b-store-redis    --provenance-sources ;;
  bare2)     $A drivers/store-mysql.ts    b-store-mysql    --provenance-sources ;;
  bare3)     $A drivers/store-postgres.ts b-store-postgres --provenance-sources ;;
  bare4)     $A drivers/store-sqlite.ts   b-store-sqlite   --provenance-sources ;;
  # The route out, measured rather than guessed: --npm-static takes the driver
  # package OUT of the island (its shipped JS compiled statically). It answers
  # "if this package stopped islanding, would the store package compile?"
  static1)   $A drivers/_x-redis-plus-zapo.ts    s-store-redis    --provenance-sources --npm-static ioredis ;;
  static2)   $A drivers/_x-mysql-plus-zapo.ts    s-store-mysql    --provenance-sources --npm-static mysql2 ;;
  static3)   $A drivers/_x-postgres-plus-zapo.ts s-store-postgres --provenance-sources --npm-static pg ;;
  # Build level. analyse() stops before ir/validate.ts and both emitters, so a
  # zero above is NOT a binary and is never reported as one.
  build1)    $B drivers/_x-sqlite-plus-zapo.ts c-store-sqlite --provenance-sources --backend c ;;
  build2)    $B drivers/store-memory.ts        c-store-memory --provenance-sources --backend c ;;
  build3)    $B drivers/_x-redis-plus-zapo.ts  bx-store-redis --provenance-sources --backend c ;;
  build4)    $B drivers/_x-mysql-plus-zapo.ts  bx-store-mysql --provenance-sources --backend c ;;
  build5)    $B drivers/_x-postgres-plus-zapo.ts bx-store-postgres --provenance-sources --backend c ;;
  build6)    $B drivers/_x-mongo-plus-zapo.ts  bx-store-mongo --provenance-sources --backend c ;;
  *) echo "usage: queue.sh <arm|consumer1..4|bare1..4|static1..3|build1..6>"; exit 2 ;;
esac
