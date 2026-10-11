/* peakcheck.c - does the PEAK snapshot read a DIFFERENT heap from the
 * settled one, and can it say so when it has not?
 *
 * The census above this file reports once, at _Exit. The peak block added
 * beside it reports a walk taken when the process set a new private-commit
 * high-water. A peak block that could only ever print numbers cannot be
 * believed: a snapshot that silently aliased the exit walk would print a
 * plausible table and be read as the peak. So this program builds a heap
 * whose peak population is NOT PRESENT AT EXIT, and the controls are:
 *
 *   POSITIVE  HCPKSIZE carries the planted size with the planted count,
 *             and the planted bytes dominate the peak busy total.
 *   NULL      HCSIZE (settled) does NOT carry it -- it was freed. If the
 *             two tables agreed, the snapshot would be the exit walk under
 *             another prefix, which is the whole failure being guarded.
 *   DEAD      SCR_HEAPCEN_PEAK_OFF=1, same binary, must print
 *             "NO PEAK SNAPSHOT (trigger disabled)" and no numbers.
 *   FLAT      PK_N=0: nothing is planted, the heap never climbs, and the
 *             peak and settled readings must AGREE. A trigger that fired
 *             on noise would show a difference here.
 *
 * It also pins the cost the real subject has to pay: HCPKCOST prints
 * walkMsMax, which is how long the mutator was stopped by the longest walk.
 *
 *   zig cc -O2 -target x86_64-windows-gnu -DSCR_HEAPCEN_PEAK \
 *     -include tests/perf/heapcensus/scr_heap_census.h \
 *     tests/perf/heapcensus/peakcheck.c -o <tmp>/peakcheck.exe
 *
 * Env: PK_N (blocks planted, default 20000), PK_SZ (default 7919, a prime
 * nothing else on this heap allocates), PK_HOLD_MS (how long the peak is
 * held so the poller can see it, default 400), PK_EXIT (0 = return from
 * main and reach the report through atexit; 1 = call exit()).
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static size_t envn(const char *k, size_t d) {
  const char *v = getenv(k);
  if (v == NULL || *v == 0) return d;
  size_t n = 0;
  for (const char *p = v; *p >= '0' && *p <= '9'; p++)
    n = n * 10 + (size_t)(*p - '0');
  return n;
}

/* The header declares Sleep for its poller; this file is compiled with the
 * header force-included, so the declaration is already in scope under its
 * private name. Using it here rather than declaring a second one keeps the
 * no-<windows.h> rule intact. */
extern void __stdcall scr_hc_Sleep(unsigned long);

int main(void) {
  size_t n = envn("PK_N", 20000);
  size_t sz = envn("PK_SZ", 7919);
  unsigned long hold = (unsigned long)envn("PK_HOLD_MS", 400);
  size_t doexit = envn("PK_EXIT", 0);

  void **v = NULL;
  if (n > 0) {
    v = (void **)malloc(n * sizeof(void *));
    if (v == NULL) return 2;
    for (size_t i = 0; i < n; i++) {
      v[i] = malloc(sz);
      if (v[i] != NULL) memset(v[i], 0x3c, 32);
    }
  }
  /* Hold the peak long enough for at least one poll to land on it. The
   * poller's default interval is 5 ms, so 400 ms is ~80 chances; the run
   * prints polls= and walks= so "it never fired" cannot read as "there was
   * nothing there". */
  scr_hc_Sleep(hold);

  if (v != NULL) {
    for (size_t i = 0; i < n; i++) free(v[i]);
    free(v);
  }
  /* Settle: give the poller time to run again AFTER the drop. It must not
   * re-snapshot (the trigger only moves up), which is what keeps the peak
   * table from being overwritten by the trough. */
  scr_hc_Sleep(hold);

  fprintf(stderr, "[peakcheck] planted=%zu size=%zu holdMs=%lu exitPath=%s\n",
          n, sz, hold, doexit ? "exit()" : "return");
  if (doexit) exit(0);
  return 0;
}
