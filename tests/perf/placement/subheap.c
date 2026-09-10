/* DOES A PRIVATE HEAP PER CONCURRENT CHUNK REACH THE DECOMMIT CONDITION?
 *
 * The mechanism is confirmed from three directions: identical live data with
 * the garbage scattered leaves 217,359 free blocks and returns 3.67 MB, while
 * the same garbage contiguous leaves 1,026 and returns 75.59 MB; and holding
 * the payload fixed while varying ONLY concurrency moves free space 45.37 ->
 * 3.60 MiB. Interleaving is the cause.
 *
 * The proposal is to remove the interleaving structurally: allocations made
 * while chunk N is running go into chunk N's own heap, so chunk 1's blocks
 * cannot sit between chunk 2's. It needs nothing to move, which matters
 * because this runtime has no handle indirection and cannot relocate anything
 * user code can hold.
 *
 * THE CLAIM THIS PROBE TESTS, and only this one: that N disjoint RETAINED
 * heaps reach the CRT heap's decommit condition where one shared heap does
 * not. `HeapDestroy` is deliberately never called -- 1.22% of the burst
 * survives, so the heaps must be kept and merely kept separate. The win on
 * offer is non-interleaving, not wholesale release, and a probe that
 * destroyed its heaps would measure the wrong thing and flatter the idea.
 *
 * THE TWO ARMS DIFFER IN ONE THING. Both allocate the same count, the same
 * sizes, in the same interleaved order across C simulated concurrent chunks,
 * and both keep the same survivors. `shared` puts them all in the process
 * heap; `split` puts chunk i's in heap i. Nothing else changes, and the
 * survivors are read back at the end of both so an arm that quietly lost its
 * live set cannot look like a win.
 *
 * READ `uncommitted`, NOT `free`. Free-in-heap bytes falling means the heap
 * coalesced; only uncommitted means it gave the pages back. The two move
 * independently and this whole objective is about the second.
 *
 * -------------------------------------------------------------------------
 * MEASURED, and the proposal is REFUTED. 8 chunks, 120,000 blocks of 700 B,
 * one arm per process. Survivors spread through the run as they really are.
 *
 *   keep = 1.22% (the measured survivor fraction)
 *   arm      busyMiB  busyBlks   freeMiB  freeBlks  uncommMiB   wsMiB  commitMiB
 *   shared      2.00      1744     81.93    117238       8.66   87.44      87.03
 *   split       2.00      1755     82.50    115783      34.71   88.59      88.40
 *   serial      2.00      1755     10.72     15020       4.54   16.13      13.44
 *
 *   keep = 0 (every heap entirely dead)
 *   shared      0.99       282      6.31       103      87.71    4.71       1.66
 *   split       0.99       293     23.55       175      95.35   11.64       8.89
 *   serial      0.99       293      6.59        97       9.59    5.03       1.98
 *
 * SUB-HEAPS DO NOT REACH THE DECOMMIT CONDITION. split against shared moves
 * free blocks by 1.2% (117,238 -> 115,783), free bytes the WRONG way, and
 * working set and commit both slightly WORSE (87.44 -> 88.59, 87.03 -> 88.40).
 * At zero survivors it is worse still (4.71 -> 11.64), because every
 * HeapCreate carries its own reserved region.
 *
 * AND `uncommitted` IS A TRAP HERE, which is why this file says to read
 * working set instead. It rises 8.66 -> 34.71 in the split arm and that is
 * not a return of anything: a freshly created heap reserves a region most of
 * which is uncommitted from birth, so MORE HEAPS MECHANICALLY MEANS MORE
 * UNCOMMITTED-RANGE BYTES. Read alone it looks like a 4x win. Working set and
 * private commit, which cannot be inflated that way, say it got worse.
 *
 * THE MECHANISM IS NOT ADDRESS SEPARATION -- IT IS CONCURRENT FOOTPRINT AND
 * REUSE. The serial arm reproduces gap4000 (free bytes -86.9%, free blocks
 * -87.2%, working set -81.6%, commit -84.5%; memcensus measured -92.1% on
 * free space) and it differs from the other two in one thing: chunk c's dead
 * blocks are freed BEFORE chunk c+1 allocates, so chunk c+1 REUSES that space
 * and the heap never grows to hold eight chunks at once. The split arm keeps
 * all eight alive concurrently and merely puts them in different address
 * ranges, which preserves the footprint and therefore preserves the problem.
 *
 * AND THE SURVIVORS ARE THE WHOLE PROBLEM. At 0% survivors even the shared
 * interleaved arm returns everything (4.71 MiB working set). At 1.22% it is
 * 87.44 -- an 18.6x difference made by 1.22% of the blocks. That is
 * consistent with the hcctl control rather than in tension with it: given a
 * fixed concurrent footprint, WHERE the survivors sit decides what can be
 * returned; reducing the footprint removes the question. Sub-heaps do
 * neither.
 *
 *   zig cc -O2 -o subheap.exe subheap.c -lpsapi
 *   subheap.exe <chunks> -arm 0|1|2 [-pairs N] [-hole N] [-keepppm N]
 *     arm 0 shared (gap0)   1 split, one heap per chunk   2 serialised (gap4000)
 *   One arm per process; it refuses to run two, because the second walk
 *   would include the first arm residue.
 */
#include <windows.h>
#include <psapi.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define MB(x) ((double)(x) / (1024.0 * 1024.0))
#define MAXC 64u

typedef struct {
  unsigned long long busy_n, busy_b, free_n, free_b, uncommitted_b;
} Walk;

/* Serialised with HeapLock: an unlocked walk has been seen to stop partway
 * and leave a plausible partial total, which is a silent undercount of
 * exactly the quantity being measured. */
static void walk_all(Walk *w) {
  HANDLE heaps[256];
  DWORD n = GetProcessHeaps(256, heaps), i;
  memset(w, 0, sizeof *w);
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

int main(int argc, char **argv) {
  unsigned C = 8, pairs = 120000, hole = 700, keepppm = 12200;
  int split, i, armlo = 0, armhi = 1;
  for (i = 1; i < argc; i++) {
    if (!strcmp(argv[i], "-pairs") && i + 1 < argc) pairs = (unsigned)atoi(argv[++i]);
    else if (!strcmp(argv[i], "-hole") && i + 1 < argc) hole = (unsigned)atoi(argv[++i]);
    else if (!strcmp(argv[i], "-keepppm") && i + 1 < argc) keepppm = (unsigned)atoi(argv[++i]);
    else if (!strcmp(argv[i], "-arm") && i + 1 < argc) { armlo = armhi = atoi(argv[++i]); }
    else if (argv[i][0] != '-') C = (unsigned)atoi(argv[i]);
  }
  if (C < 1) C = 1;
  if (C > MAXC) C = MAXC;
  printf("chunks=%u pairs=%u hole=%uB keep=%uppm  (heaps are RETAINED; HeapDestroy is never called)\n",
         C, pairs, hole, keepppm);
  if (armlo == 0 && armhi == 1) {
    printf("REFUSING to run both arms in one process: the second walk would\n"
           "include the first arm residue. Run -arm 0 and -arm 1 as separate\n"
           "processes.\n");
    return 2;
  }
  printf("%-7s %10s %10s %10s %10s %12s %10s %10s\n", "arm", "busyMiB", "busyBlks",
         "freeMiB", "freeBlks", "uncommMiB", "wsMiB", "commitMiB");

  /* ONE ARM PER PROCESS. Running both in one process was the first version and
   * it was wrong: the second arm's walk includes the first arm's residue --
   * the shared arm left 81.92 MiB of free-in-heap behind and the split arm
   * then reported 164.41 as if it were its own. placement.c's sweep already
   * had this rule; it was not carried over here. */
  for (split = armlo; split <= armhi; split++) {
    HANDLE h[MAXC];
    void **blk = (void **)malloc((size_t)pairs * sizeof *blk);
    unsigned nkeep = (unsigned)(((unsigned long long)pairs * keepppm) / 1000000ull);
    unsigned every = nkeep ? pairs / nkeep : 0, nk = 0, j;
    void **kept = (void **)malloc((size_t)(nkeep + 1) * sizeof *kept);
    Walk w;
    SIZE_T ws, pc;
    if (blk == NULL || kept == NULL) return 2;
    for (j = 0; j < C; j++) {
      h[j] = split ? HeapCreate(0, 0, 0) : GetProcessHeap();
      if (h[j] == NULL) return 2;
    }
    /* INTERLEAVED across the C chunks, which is the gap0 condition: chunk i
     * and chunk i+1 are allocating at the same time. In the `split` arm that
     * interleaving still happens in TIME; what changes is that it no longer
     * happens in ADDRESS SPACE. */
    if (split == 2) {
      /* ARM 2 -- SERIALISED, which is what memcensus's gap4000 actually did.
       * Chunk c allocates, then frees its own dead, and only then does chunk
       * c+1 begin. This is the control that tells address-space SEPARATION
       * apart from concurrent FOOTPRINT: the split arm keeps 8 chunks alive
       * at once and merely puts them in different heaps, while this one never
       * holds more than one chunk's worth at a time and reuses the space. */
      unsigned per = pairs / C, c, t = 0;
      for (c = 0; c < C; c++) {
        unsigned lo = t, k;
        for (k = 0; k < per && t < pairs; k++, t++) {
          blk[t] = HeapAlloc(h[0], 0, hole);
          if (blk[t] == NULL) return 2;
          memset(blk[t], 1, hole);
        }
        for (k = lo; k < t; k++) {
          if (every && (k % every) == 0 && nk < nkeep) {
            kept[nk++] = blk[k];
            continue;
          }
          HeapFree(h[0], 0, blk[k]);
          blk[k] = NULL;
        }
      }
    } else {
    for (j = 0; j < pairs; j++) {
      unsigned c = j % C;
      blk[j] = HeapAlloc(h[c], 0, hole);
      if (blk[j] == NULL) return 2;
      memset(blk[j], 1, hole);
    }
    }
    /* The burst ends: 1.22% survive, spread through the run as they really
     * are, and the rest go. */
    if (split != 2) {
      for (j = 0; j < pairs; j++) {
        if (every && (j % every) == 0 && nk < nkeep) {
          kept[nk++] = blk[j];
          continue;
        }
        HeapFree(h[j % C], 0, blk[j]);
      }
    }
    walk_all(&w);
    mem(&ws, &pc);
    printf("%-7s %10.2f %10llu %10.2f %10llu %12.2f %10.2f %10.2f\n",
           split == 2 ? "serial" : split ? "split" : "shared", MB(w.busy_b), w.busy_n, MB(w.free_b),
           w.free_n, MB(w.uncommitted_b), MB(ws), MB(pc));
    {
      unsigned long long s = 0;
      for (j = 0; j < nk; j++) s += *(unsigned char *)kept[j];
      if (nk && s != (unsigned long long)nk) {
        printf("  LIVE DATA CORRUPT in %s arm\n", split ? "split" : "shared");
        return 2;
      }
    }
    printf("        (live kept %u blocks, read back ok)\n", nk);
    /* The heaps stay. Freeing the bookkeeping only. */
    free(blk);
    free(kept);
  }
  return 0;
}
