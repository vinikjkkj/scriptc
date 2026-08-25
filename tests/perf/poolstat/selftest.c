/* scr_pool_stat.h's self-test, run WITHOUT building zapo.
 *
 * It drives the real scr_pool_give / scr_pool_take out of scr_runtime.h
 * through the real hooks, over two pools with known populations, and the
 * reader checks the report against arithmetic. Two things it must show, and
 * the second is the one that matters:
 *
 *   1. the counters move when blocks move;
 *   2. the counters read DIFFERENTLY under the two policies. A lane that
 *      cannot tell a depth bound from a byte budget cannot adjudicate the
 *      question the budget is on trial for.
 *
 * It also has to be able to say NOTHING HAPPENED: the "idle" pool below is
 * registered and never used, and its row must come back all zeroes rather
 * than being absent or inheriting another pool's traffic.
 *
 * Build (see run.sh):
 *   zig cc -target x86_64-windows-gnu -O2 -g0 selftest.c -o selftest.exe \
 *     -I<repo>/packages/runtime/src -include <this dir>/scr_pool_stat.h
 */
#include "scr_runtime.h"

#include <stdio.h>
#include <stdlib.h>

static ScrPool st_busy;
static ScrPool st_idle;

#ifndef SCR_POOLSTAT_N
#define SCR_POOLSTAT_N 1000
#endif

__attribute__((constructor)) static void st_register(void) {
  scr_poolstat_cfg(SCR_POOL_GRAIN, SCR_POOL_MAX, SCR_POOL_DEPTH, SCR_POOL_BUDGET);
  scr_poolstat_name(&st_busy, "busy");
  scr_poolstat_name(&st_idle, "idle");
}

int main(void) {
  const size_t sz = SCR_POOL_GRAIN * 2u;
  long i;
  /* N gives of one class, then take them all back. */
  for (i = 0; i < SCR_POOLSTAT_N; i++) {
    void *b = malloc(sz);
    if (!b) return 2;
    if (!scr_pool_give(&st_busy, b, sz)) free(b);
  }
  for (i = 0; i < SCR_POOLSTAT_N; i++) {
    void *b = scr_pool_take(&st_busy, sz);
    if (!b) break;
    free(b);
  }
  /* One out-of-range give and one out-of-range take, so the OOR columns are
   * not zero for a reason nobody checked. */
  {
    void *b = malloc(SCR_POOL_MAX * 4u);
    if (b && !scr_pool_give(&st_busy, b, SCR_POOL_MAX * 4u)) free(b);
    (void)scr_pool_take(&st_busy, SCR_POOL_MAX * 4u);
  }
  /* st_idle is touched by nothing at all. */
  scr_poolstat_report();
  return 0;
}
