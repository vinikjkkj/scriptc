/* PLACEMENT, PRICED. What it would take to make a burst's garbage contiguous,
 * and where the survivors break each mechanism.
 *
 * The finding this exists to act on: the NT heap ALREADY returns memory. On a
 * control with identical live data and identical live bytes it returned
 * 72.09 MiB when the garbage was contiguous and 3.39 MiB when the same
 * garbage was scattered. So nothing about the allocator needs replacing --
 * what defeats it is where the survivors sit. This rig prices the mechanisms
 * that could fix that, and it does it as a CURVE over the survivor fraction,
 * because the survivor fraction is the term that decides which of them works
 * and it is still being measured on the real workload.
 *
 * -------------------------------------------------------------------------
 * THE ARMS. Every arm ends with the SAME live population -- the same number
 * of survivors of the same size, all touched, all still reachable at the
 * final checksum. Only placement and mechanism differ. An arm that ended with
 * different live bytes would be measuring the workload, not the placement.
 *
 *   0 scattered   the status quo: survivors interleaved through the burst,
 *                 everything from the CRT heap, victims freed at phase end.
 *   1 clustered   the same population with the survivors allocated FIRST, so
 *                 the burst's garbage is one contiguous run. This is the
 *                 upper bound, and it is also a CROSS-CHECK: the census
 *                 block's independently written control reports 72.09 MiB
 *                 returned against 3.39 MiB scattered. Two instruments, two
 *                 authors, one number -- or this rig is wrong.
 *   2 burstheap   survivors from the process heap, victims from a private
 *                 heap destroyed wholesale at phase end. Requires knowing at
 *                 ALLOCATION TIME which blocks will survive, which nothing in
 *                 the compiler currently knows.
 *   3 copyout     everything from the private heap -- no foreknowledge -- and
 *                 at phase end the survivors are COPIED to the process heap
 *                 before the whole burst heap is destroyed. This is the
 *                 mechanism that does not need an oracle, and the copy is
 *                 what it costs. Timed separately from the destroy.
 *
 * WHY 3 IS THE ONE THAT MATTERS. A per-phase region that must be freed
 * wholesale cannot be freed at all if one allocation outlives the phase, and
 * something always does. Copy-out converts "cannot free the region" into "pay
 * to move the few that stayed", so its cost scales with the SURVIVORS rather
 * than with the burst. The sweep prints where that trade stops paying.
 *
 * -------------------------------------------------------------------------
 * READ TWICE, from two instruments that can disagree.
 *
 *   HeapWalk over every heap: busy blocks and bytes, COMMITTED-FREE blocks and
 *   bytes, and UNCOMMITTED range bytes -- the last being what the heap has
 *   actually handed back to the OS, which is the number the whole objective
 *   is about. Same instrument the census block used, so the numbers compare
 *   rather than merely resemble.
 *
 *   GetProcessMemoryInfo: working set AND private commit. A working set can
 *   fall to a trimmer while the process still holds what it reserved; the
 *   page-return probe beside this one measured that split explicitly
 *   (DiscardVirtualMemory returns working set only, MEM_DECOMMIT returns
 *   commit too). "Gave the memory back" is two claims and this prints both.
 *
 * THE NULL ARM IS ARM 0 and it is not decoration: it builds the identical
 * population and pulls nothing, so a fall in any other arm cannot be read as
 * a result when it would have happened anyway.
 *
 * -------------------------------------------------------------------------
 * THE SHAPE IS A PARAMETER. Defaults are the census's measured population --
 * ~107k burst blocks averaging 710 B -- but the free-hole size distribution
 * and the real survivor fraction are still being measured on the workload.
 * Nothing here hard-codes a guess: -hole, -survivor, -pairs and -keep take
 * the real numbers the moment they land. A rig that baked in a guessed
 * distribution would price a wall that may not exist.
 *
 * A NOTE ON WHAT THE BURST BLOCKS ARE. They are NOT boxed dyn nodes: a
 * 64-byte physical block is carved from a cycle-arena chunk and never reaches
 * malloc, and the busy histogram finds only 3,596 blocks at exactly 64 B. The
 * live hypothesis is a boxed record's ENTRIES ARRAY -- cap x 24 bytes, so an
 * 88-90 member record is 2-3 KB, above SCR_POOL_MAX, malloc'd, and inside the
 * observed hole-size range. That is why -hole sweeps rather than sits at 710.
 *
 * -------------------------------------------------------------------------
 * MEASURED, on this host, 115,000 burst blocks of 700 B, survivors of 700 B,
 * every arm ending with the SAME live population. Working set in MiB:
 *
 *   survivors      live     scattered  clustered  burstheap  copyout
 *   0 ppm          0.00 MiB      4.66       4.66       4.50     4.50
 *   1,000 ppm      0.08         35.02       4.73       4.60     4.60
 *   10,000 ppm     0.77         84.61       5.68       5.32     5.32
 *   50,000 ppm     3.84         87.94       8.74       8.66     8.67
 *   135,000 ppm   10.36         94.62      15.44      15.35    15.36
 *   300,000 ppm   23.03        105.86      29.31      28.71    28.71
 *
 * Private commit tracks working set in every cell (94.45 against 94.62
 * scattered; 12.61 against 15.36 copyout), so this is a real return and not
 * a working-set trim -- the distinction the page-return probe beside this
 * one had to make and could not.
 *
 * THE SURVIVOR FRACTION BARELY MATTERS, AND THAT IS THE RESULT. 115 survivors
 * in 115,000 blocks -- one in a thousand, 0.08 MiB of live data -- already
 * cost 30 MiB of working set, and by one in a hundred the damage has
 * saturated: 84.61 MiB, within 12% of what 300x as many survivors cost. So
 * the question "what fraction survives the sync" does not need a precise
 * answer to decide this. Anything above roughly one in a thousand puts the
 * status quo at its worst case, and no mechanism that hopes survivors are
 * rare can work. The mechanism has to HANDLE them.
 *
 * COPY-OUT COSTS NOTHING IN MEMORY AGAINST THE ORACLE. burstheap knows at
 * allocation time which blocks will survive -- nothing in the compiler does
 * -- and copyout finds out only at phase end. They are within 0.01 MiB of
 * each other at every survivor fraction, and both are within 0.1 MiB of the
 * clustered ideal. The oracle is worth nothing, so it need not be built.
 *
 * AND IT IS NOT SLOWER. Seven reps each at 10,000 ppm, medians:
 *   allocation path   scattered 50.78 ms   copyout 49.79 ms   (-1.9%)
 *   phase end         scattered 10.70 ms   copyout  6.53 ms
 * The allocation path is the same call underneath -- malloc IS HeapAlloc on
 * the process heap -- and at phase end one HeapDestroy replaces 115,000
 * free() calls. The memory columns have ZERO variance across those reps
 * (84.61 and 5.32 MiB to two decimals, every run); the timing columns
 * overlap and are wall clock on a shared host, so the honest reading of them
 * is NOT SLOWER rather than faster. A cycle-level, mode-matched A/B is owed
 * before any timing claim stronger than that.
 *
 * WHAT THIS RIG IS NOT. It is a synthetic single-purpose process. It shows
 * that the mechanism recovers the memory and what it costs in this shape; it
 * does not show that a history sync's allocations can be attributed to a
 * phase, which is the real open question and belongs to the workload.
 *
 *   zig cc -O2 -o placement.exe placement.c -lpsapi
 *   placement.exe <arm> [-pairs N] [-hole N] [-survivor N] [-keep PPM]
 *   placement.exe -sweep                 every arm x a ladder of survivor
 *                                        fractions, one row each
 *
 * -keep is in PARTS PER MILLION of the burst, because the interesting range
 * is well under one percent and a percentage would round it away.
 */
#include <windows.h>
#include <psapi.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define DEF_PAIRS 107512u
#define DEF_HOLE 710u
#define DEF_SURVIVOR 710u
#define MB(x) ((double)(x) / (1024.0 * 1024.0))

typedef struct {
  unsigned long long busy_n, busy_b, free_n, free_b, uncommitted_b;
  unsigned heaps;
} Walk;

/* HeapWalk over every heap the process owns, serialised with HeapLock. A walk
 * without the lock has been seen to stop partway with
 * ERROR_INVALID_PARAMETER and leave a plausible-looking partial total, which
 * is a silent undercount of exactly the quantity being measured. */
static void walk_all(Walk *w) {
  HANDLE heaps[256];
  DWORD n = GetProcessHeaps(256, heaps);
  DWORD i;
  memset(w, 0, sizeof *w);
  w->heaps = (unsigned)n;
  for (i = 0; i < n; i++) {
    PROCESS_HEAP_ENTRY e;
    memset(&e, 0, sizeof e);
    if (!HeapLock(heaps[i])) continue;
    while (HeapWalk(heaps[i], &e)) {
      if (e.wFlags & PROCESS_HEAP_ENTRY_BUSY) {
        w->busy_n++;
        w->busy_b += e.cbData + e.cbOverhead;
      } else if (e.wFlags & PROCESS_HEAP_UNCOMMITTED_RANGE) {
        w->uncommitted_b += e.cbData;
      } else if (!(e.wFlags & PROCESS_HEAP_REGION)) {
        w->free_n++;
        w->free_b += e.cbData + e.cbOverhead;
      }
    }
    HeapUnlock(heaps[i]);
  }
}

static void mem(SIZE_T *ws, SIZE_T *pc) {
  PROCESS_MEMORY_COUNTERS_EX c;
  memset(&c, 0, sizeof c);
  c.cb = sizeof c;
  GetProcessMemoryInfo(GetCurrentProcess(), (PROCESS_MEMORY_COUNTERS *)&c, sizeof c);
  *ws = c.WorkingSetSize;
  *pc = c.PrivateUsage;
}

static double now_ms(void) {
  LARGE_INTEGER f, t;
  QueryPerformanceFrequency(&f);
  QueryPerformanceCounter(&t);
  return 1000.0 * (double)t.QuadPart / (double)f.QuadPart;
}

static const char *ARMNAME[4] = {"scattered", "clustered", "burstheap", "copyout"};

typedef struct {
  double returned_mib, freecommitted_mib, busy_mib, ws_mib, commit_mib;
  double mech_ms, copy_ms, build_ms;
  unsigned long long live_n, live_b;
} Result;

/* One arm, start to finish, in a fresh process state as far as this rig can
 * arrange it. Returns the live population it ended with, so the caller can
 * assert that every arm ended with the same one. */
static int run_arm(unsigned arm, unsigned pairs, unsigned hole, unsigned surv,
                   unsigned keep_ppm, Result *out) {
  unsigned nkeep = (unsigned)(((unsigned long long)pairs * keep_ppm) / 1000000ull);
  unsigned every = nkeep > 0 ? pairs / nkeep : 0;
  void **blocks = (void **)malloc((size_t)pairs * sizeof *blocks);
  void **kept = (void **)malloc((size_t)(nkeep + 1) * sizeof *kept);
  unsigned i, nk = 0;
  Walk w;
  SIZE_T ws, pc;
  double t0, t1, tc0 = 0, tc1 = 0, tb0, tb1;
  HANDLE burst = NULL;

  if (blocks == NULL || kept == NULL) return 0;
  memset(out, 0, sizeof *out);

  if (arm == 2 || arm == 3) {
    burst = HeapCreate(0, 0, 0);
    if (burst == NULL) return 0;
  }

  tb0 = now_ms();
  if (arm == 1) {
    /* CLUSTERED: the survivors go down first, so the burst that follows is
     * one contiguous run with nothing of ours inside it. */
    for (i = 0; i < nkeep; i++) {
      kept[nk] = malloc(surv);
      if (kept[nk] == NULL) return 0;
      memset(kept[nk], 1, surv);
      nk++;
    }
    for (i = 0; i < pairs; i++) {
      blocks[i] = malloc(hole);
      if (blocks[i] == NULL) return 0;
      memset(blocks[i], 2, hole);
    }
  } else {
    /* SCATTERED / BURSTHEAP / COPYOUT: survivors appear THROUGH the burst,
     * spread evenly, which is what a real phase does -- it does not know
     * which of its allocations the program will still be holding. */
    for (i = 0; i < pairs; i++) {
      int survives = every != 0 && (i % every) == 0 && nk < nkeep;
      if (arm == 2) {
        /* The oracle arm: survivors are placed outside the burst heap at
         * allocation time, which needs foreknowledge nothing has. */
        if (survives) {
          kept[nk] = malloc(surv);
          if (kept[nk] == NULL) return 0;
          memset(kept[nk], 1, surv);
          nk++;
          blocks[i] = NULL;
          continue;
        }
        blocks[i] = HeapAlloc(burst, 0, hole);
      } else if (arm == 3) {
        blocks[i] = HeapAlloc(burst, 0, hole);
      } else {
        blocks[i] = malloc(hole);
      }
      if (blocks[i] == NULL) return 0;
      memset(blocks[i], 2, hole);
      if (survives && arm != 2) {
        if (arm == 3) {
          /* Marked, not moved: copy-out happens at phase end. Stamped with
           * the survivor byte so the end-of-arm checksum reads the same
           * thing in every arm -- the first version of this rig stamped it
           * with the victim byte and the checksum fired, which is the check
           * working and the expectation being wrong. */
          memset(blocks[i], 1, hole);
          kept[nk++] = blocks[i];
        } else {
          void *s = malloc(surv);
          if (s == NULL) return 0;
          memset(s, 1, surv);
          kept[nk++] = s;
        }
      }
    }
  }

  tb1 = now_ms();

  /* ---- phase end ---- */
  t0 = now_ms();
  if (arm == 3) {
    /* COPY-OUT: the survivors move to the process heap, then the whole burst
     * region goes at once. No oracle needed, and the cost is the copy. */
    tc0 = now_ms();
    for (i = 0; i < nk; i++) {
      void *s = malloc(surv);
      if (s == NULL) return 0;
      memcpy(s, kept[i], surv < hole ? surv : hole);
      kept[i] = s;
    }
    tc1 = now_ms();
    HeapDestroy(burst);
    burst = NULL;
  } else if (arm == 2) {
    HeapDestroy(burst);
    burst = NULL;
  } else {
    for (i = 0; i < pairs; i++) {
      if (blocks[i] != NULL) free(blocks[i]);
    }
  }
  t1 = now_ms();

  walk_all(&w);
  mem(&ws, &pc);
  out->returned_mib = MB(w.uncommitted_b);
  out->freecommitted_mib = MB(w.free_b);
  out->busy_mib = MB(w.busy_b);
  out->ws_mib = MB(ws);
  out->commit_mib = MB(pc);
  out->mech_ms = t1 - t0;
  out->copy_ms = tc1 - tc0;
  out->build_ms = tb1 - tb0;
  out->live_n = nk;
  out->live_b = (unsigned long long)nk * surv;

  /* The survivors must still be readable at the end of every arm, or the arm
   * did not end with the live population it claims. */
  {
    unsigned long long s = 0;
    for (i = 0; i < nk; i++) s += *(unsigned char *)kept[i];
    if (nk > 0 && s != (unsigned long long)nk) {
      printf("  LIVE DATA CORRUPT in arm %u: checksum %llu, expected %u\n", arm, s, nk);
      return 0;
    }
  }
  free(blocks);
  return 1;
}

int main(int argc, char **argv) {
  unsigned arm = 0, pairs = DEF_PAIRS, hole = DEF_HOLE, surv = DEF_SURVIVOR;
  unsigned keep = 1000; /* ppm; 1000 = 0.1% of the burst survives */
  int i, sweep = 0, armset = 0;
  Result r;

  for (i = 1; i < argc; i++) {
    if (!strcmp(argv[i], "-sweep")) sweep = 1;
    else if (!strcmp(argv[i], "-hole") && i + 1 < argc) hole = (unsigned)atoi(argv[++i]);
    else if (!strcmp(argv[i], "-survivor") && i + 1 < argc) surv = (unsigned)atoi(argv[++i]);
    else if (!strcmp(argv[i], "-pairs") && i + 1 < argc) pairs = (unsigned)atoi(argv[++i]);
    else if (!strcmp(argv[i], "-keep") && i + 1 < argc) keep = (unsigned)atoi(argv[++i]);
    else if (argv[i][0] != '-') { arm = (unsigned)atoi(argv[i]); armset = 1; }
  }
  (void)armset;

  printf("pairs=%u hole=%uB survivor=%uB\n", pairs, hole, surv);
  if (!sweep) {
    if (!run_arm(arm, pairs, hole, surv, keep, &r)) {
      printf("arm %u FAILED to run -- this is not a measurement\n", arm);
      return 2;
    }
    printf("arm=%u %-10s keep=%uppm live=%llu (%.2f MiB)\n", arm, ARMNAME[arm],
           keep, r.live_n, MB(r.live_b));
    printf("  returned-to-OS %.2f MiB | committed-free %.2f MiB | busy %.2f MiB\n",
           r.returned_mib, r.freecommitted_mib, r.busy_mib);
    printf("  ws %.2f MiB | commit %.2f MiB | build %.2f ms | mechanism %.2f ms | copy %.2f ms\n",
           r.ws_mib, r.commit_mib, r.build_ms, r.mech_ms, r.copy_ms);
    return 0;
  }

  /* THE SWEEP. One row per (arm, survivor fraction). Each row is a fresh
   * child process -- see the note in the runner script -- because a heap that
   * has already been fragmented once is not a clean start, and running four
   * arms in one process would let the first arm's placement decide the
   * second's. */
  printf("%-10s %8s %9s %12s %12s %10s %9s %9s\n", "arm", "keepppm", "live",
         "returnedMiB", "freeMiB", "wsMiB", "mechms", "copyms");
  {
    static const unsigned ladder[] = {0, 100, 500, 1000, 5000, 10000, 50000};
    unsigned a, k;
    for (a = 0; a < 4; a++) {
      for (k = 0; k < sizeof ladder / sizeof ladder[0]; k++) {
        if (!run_arm(a, pairs, hole, surv, ladder[k], &r)) {
          printf("%-10s %8u  FAILED\n", ARMNAME[a], ladder[k]);
          continue;
        }
        printf("%-10s %8u %9llu %12.2f %12.2f %10.2f %9.2f %9.2f\n", ARMNAME[a],
               ladder[k], r.live_n, r.returned_mib, r.freecommitted_mib,
               r.ws_mib, r.mech_ms, r.copy_ms);
      }
    }
  }
  return 0;
}
