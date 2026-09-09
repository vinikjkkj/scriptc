/* WHAT PART OF A FREE RUN IS GENUINELY INERT, AND DOES DISCARDING IT SURVIVE?
 *
 * DiscardVirtualMemory leaves page contents UNDEFINED. The Windows heap keeps
 * bookkeeping INSIDE free blocks -- a free entry's payload begins with list
 * links or a balanced-tree node, and the block header sits immediately before
 * lpData. If a discarded page holds any of it, the heap reads zeroes on some
 * later allocation and the process dies THEN, somewhere else. A discard that
 * works ninety-nine times and corrupts the hundredth is worse than no discard,
 * because it reaches the user as a mysterious fault in a live service.
 *
 * So this probe does two things, in order, and the first can kill the idea on
 * its own:
 *
 *   ARM 0  COUNT. Build a realistically fragmented heap, walk it, and count
 *          the inert pages under three successively weaker assumptions, so
 *          the cost of each safety margin is visible rather than argued:
 *
 *            run      whole pages inside a RUN of adjacent free blocks.
 *                     This is the optimistic geometry and it is UNSAFE: a
 *                     page inside a run can still straddle the boundary
 *                     between two free blocks, where the next block's header
 *                     and links live.
 *            block    whole pages strictly inside ONE free block's payload.
 *                     Safe against inter-block metadata but not against
 *                     whatever the heap keeps at the payload's own start.
 *            inert    the same, with SCR_DS_RESERVE bytes excluded at the
 *                     head of every free block (default 64: enough for a
 *                     LIST_ENTRY, an RTL_BALANCED_NODE, or a size prefix)
 *                     and the tail truncated before the following header.
 *
 *          The gap between `run` and `inert` is the honest cost of not
 *          knowing exactly what the heap stores where.
 *
 *   ARM 1  DISCARD AND HAMMER. Discard the `inert` set, then drive the heap
 *          hard -- tens of thousands of allocations and frees across sizes
 *          that force splitting, coalescing and LFH activation -- with
 *          HeapValidate over the whole heap at intervals. Anything the
 *          discard broke shows up as a validation failure or a fault. Then
 *          report working set before and after, because a discard that
 *          survives but returns nothing is also a refutation.
 *
 * ARM 2 is the NULL ARM: identical hammer, no discard. Without it a survival
 * in arm 1 says nothing -- the hammer has to be shown not to fail on its own.
 *
 * ARM 3 is the POISON CONTROL, and it is what makes arm 1 believable: it
 * discards the head of every free block DELIBERATELY -- the bytes arm 1
 * excludes. If arm 3 does NOT break, then this probe cannot detect heap
 * corruption at all and arm 1's clean run is worthless. Run it before
 * trusting arm 1.
 *
 * -------------------------------------------------------------------------
 * MEASURED, and the discard route is REFUTED ON THIS HEAP SHAPE. 120,000
 * blocks of 700 B, 1.22% surviving, 117,255 free blocks totalling 81.92 MiB:
 *
 *   run    18,916 pages = 73.89 MiB   optimistic run geometry, UNSAFE
 *   block     354 pages =  1.38 MiB   strictly inside one payload
 *   inert     353 pages =  1.38 MiB   same, 64 B head reserved
 *
 *   arm 2 null      no discard              hammer survived, HeapValidate clean
 *   arm 1 discard   355 pages discarded     hammer survived, HeapValidate clean
 *                   working set 87.42 -> 87.36 MiB   commit unchanged
 *   arm 3 poison    head pages discarded    STALLED -- killed after minutes,
 *                   where the null arm completes in seconds
 *
 * THE SAFE SET IS 1.9% OF THE OPTIMISTIC ONE. A 53x gap, and the cause is
 * arithmetic rather than caution: 117,255 free blocks averaging ~732 bytes,
 * and a 732-byte block CONTAINS NO WHOLE INTERIOR PAGE AT ALL. Only the rare
 * large free block contributes anything. Run geometry counts pages that lie
 * inside a RUN of adjacent free blocks, and such a page routinely straddles
 * the boundary between two of them -- where the next block's header and its
 * payload links live.
 *
 * AND DISCARDING THE SAFE SET RETURNS 0.06 MiB. Not because it is unsafe --
 * it is safe, the hammer is clean and the live set intact -- but because
 * pages that were never touched were never resident either. A route that is
 * sound and returns 0.06 MiB is refuted just as firmly as one that crashes.
 *
 * THE POISON CONTROL IS WHY ARM 1's CLEAN RUN MEANS ANYTHING. Discarding the
 * page each payload STARTS on, which arm 1 excludes, does not produce a tidy
 * error: the process stalls inside the allocator, presumably walking a free
 * list whose links now read as zeroes. That is a detection -- the null arm
 * finishes the identical hammer in seconds -- and it says the probe can see
 * corruption when corruption is there.
 *
 * WHAT THIS DOES NOT SETTLE. The ratio depends on the free-block SIZE
 * DISTRIBUTION, and this probe models it with one hole size. A settled heap
 * whose free space sits in a few large runs rather than 117,255 small blocks
 * would score far better. The number to quote for the real process must be
 * computed on the real process's own walk, under the `inert` rule and not the
 * `run` rule -- that is the correction this file exists to force.
 *
 *   zig cc -O2 -o discardsafe.exe discardsafe.c -lpsapi
 *   discardsafe.exe -arm 0|1|2|3 [-pairs N] [-hole N] [-keepppm N] [-reserve N]
 */
#include <windows.h>
#include <psapi.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define MB(x) ((double)(x) / (1024.0 * 1024.0))

typedef DWORD(WINAPI *DiscardFn)(PVOID, SIZE_T);

static DiscardFn Discard;
static size_t PAGE = 4096;

static void mem(SIZE_T *ws, SIZE_T *pc) {
  PROCESS_MEMORY_COUNTERS_EX c;
  memset(&c, 0, sizeof c);
  c.cb = sizeof c;
  GetProcessMemoryInfo(GetCurrentProcess(), (PROCESS_MEMORY_COUNTERS *)&c, sizeof c);
  *ws = c.WorkingSetSize;
  *pc = c.PrivateUsage;
}

/* One free block's inert interior, under the `inert` rule. Returns the page
 * range [lo, hi) or an empty range. */
static void inert_range(const unsigned char *data, size_t len, size_t reserve,
                        uintptr_t *lo, uintptr_t *hi) {
  uintptr_t a = (uintptr_t)(const void *)data + reserve;
  uintptr_t z = (uintptr_t)(const void *)data + len;
  *lo = (a + (PAGE - 1)) & ~(uintptr_t)(PAGE - 1);
  *hi = z & ~(uintptr_t)(PAGE - 1);
  if (*hi < *lo) *hi = *lo;
}

int main(int argc, char **argv) {
  unsigned pairs = 120000, hole = 700, keepppm = 12200, reserve = 64;
  int arm = 0, i;
  HANDLE ph = GetProcessHeap();
  void **blk;
  unsigned nkeep, every, nk = 0, j;
  SIZE_T ws0, pc0, ws1, pc1;
  unsigned long long pg_run = 0, pg_block = 0, pg_inert = 0;
  unsigned long long free_blocks = 0, free_bytes = 0, discarded = 0;
  SYSTEM_INFO si;

  GetSystemInfo(&si);
  PAGE = si.dwPageSize ? si.dwPageSize : 4096;
  Discard = (DiscardFn)(void *)GetProcAddress(GetModuleHandleA("kernel32.dll"),
                                              "DiscardVirtualMemory");

  for (i = 1; i < argc; i++) {
    if (!strcmp(argv[i], "-arm") && i + 1 < argc) arm = atoi(argv[++i]);
    else if (!strcmp(argv[i], "-pairs") && i + 1 < argc) pairs = (unsigned)atoi(argv[++i]);
    else if (!strcmp(argv[i], "-hole") && i + 1 < argc) hole = (unsigned)atoi(argv[++i]);
    else if (!strcmp(argv[i], "-keepppm") && i + 1 < argc) keepppm = (unsigned)atoi(argv[++i]);
    else if (!strcmp(argv[i], "-reserve") && i + 1 < argc) reserve = (unsigned)atoi(argv[++i]);
  }
  printf("arm=%d pairs=%u hole=%uB keep=%uppm reserve=%uB page=%u discard=%s\n",
         arm, pairs, hole, keepppm, reserve, (unsigned)PAGE,
         Discard ? "present" : "ABSENT");
  if (Discard == NULL && (arm == 1 || arm == 3)) {
    printf("REFUSING: DiscardVirtualMemory is absent; arm %d would measure nothing.\n", arm);
    return 2;
  }

  blk = (void **)malloc((size_t)pairs * sizeof *blk);
  nkeep = (unsigned)(((unsigned long long)pairs * keepppm) / 1000000ull);
  every = nkeep ? pairs / nkeep : 0;
  {
    void **kept = (void **)malloc((size_t)(nkeep + 1) * sizeof *kept);
    if (blk == NULL || kept == NULL) return 2;
    for (j = 0; j < pairs; j++) {
      blk[j] = HeapAlloc(ph, 0, hole);
      if (blk[j] == NULL) return 2;
      memset(blk[j], 1, hole);
    }
    for (j = 0; j < pairs; j++) {
      if (every && (j % every) == 0 && nk < nkeep) { kept[nk++] = blk[j]; continue; }
      HeapFree(ph, 0, blk[j]);
    }
    mem(&ws0, &pc0);

    /* ---- the walk, and the three counts ---- */
    {
      PROCESS_HEAP_ENTRY e;
      const unsigned char *run_start = NULL;
      const unsigned char *run_end = NULL;
      memset(&e, 0, sizeof e);
      if (!HeapLock(ph)) return 2;
      while (HeapWalk(ph, &e)) {
        int is_free = !(e.wFlags & PROCESS_HEAP_ENTRY_BUSY) &&
                      !(e.wFlags & PROCESS_HEAP_UNCOMMITTED_RANGE) &&
                      !(e.wFlags & PROCESS_HEAP_REGION);
        if (is_free) {
          const unsigned char *d = (const unsigned char *)e.lpData;
          uintptr_t lo, hi;
          free_blocks++;
          free_bytes += e.cbData + e.cbOverhead;
          /* `block`: whole pages strictly inside this payload. */
          inert_range(d, e.cbData, 0, &lo, &hi);
          pg_block += (hi - lo) / PAGE;
          /* `inert`: same, with the head reserved. */
          inert_range(d, e.cbData, reserve, &lo, &hi);
          pg_inert += (hi - lo) / PAGE;
          /* `run`: adjacency measured across the HEADER of the next block --
           * cbOverhead precedes lpData, so the step is lpData + cbData +
           * next cbOverhead. Approximated by contiguity of payload ends. */
          if (run_start == NULL) { run_start = d; run_end = d + e.cbData; }
          else if (d <= run_end + 64) { run_end = d + e.cbData; }
          else {
            uintptr_t a = ((uintptr_t)run_start + PAGE - 1) & ~(uintptr_t)(PAGE - 1);
            uintptr_t z = (uintptr_t)run_end & ~(uintptr_t)(PAGE - 1);
            if (z > a) pg_run += (z - a) / PAGE;
            run_start = d; run_end = d + e.cbData;
          }
        }
      }
      if (run_start != NULL) {
        uintptr_t a = ((uintptr_t)run_start + PAGE - 1) & ~(uintptr_t)(PAGE - 1);
        uintptr_t z = (uintptr_t)run_end & ~(uintptr_t)(PAGE - 1);
        if (z > a) pg_run += (z - a) / PAGE;
      }
      HeapUnlock(ph);
    }
    printf("free blocks=%llu bytes=%.2f MiB\n", free_blocks, MB(free_bytes));
    printf("  run   pages=%llu = %.2f MiB   (OPTIMISTIC, unsafe: a page inside a run can straddle two blocks)\n",
           pg_run, MB((double)pg_run * PAGE));
    printf("  block pages=%llu = %.2f MiB   (strictly inside one payload)\n",
           pg_block, MB((double)pg_block * PAGE));
    printf("  inert pages=%llu = %.2f MiB   (same, head %u B reserved)\n",
           pg_inert, MB((double)pg_inert * PAGE), reserve);
    if (arm == 0) return 0;

    /* ---- arm 1/3: discard, then hammer. ARM 2 SKIPS THIS: it is the null
     * arm and must run the hammer on an UNTOUCHED heap, or a survival in arm
     * 1 says nothing. The first version of this file ran the discard for
     * every arm above 0, so "arm 2" reported `discarded pages=355` and was
     * not a null arm at all. ---- */
    if (arm != 2) {
      PROCESS_HEAP_ENTRY e;
      memset(&e, 0, sizeof e);
      if (!HeapLock(ph)) return 2;
      while (HeapWalk(ph, &e)) {
        int is_free = !(e.wFlags & PROCESS_HEAP_ENTRY_BUSY) &&
                      !(e.wFlags & PROCESS_HEAP_UNCOMMITTED_RANGE) &&
                      !(e.wFlags & PROCESS_HEAP_REGION);
        if (is_free) {
          const unsigned char *d = (const unsigned char *)e.lpData;
          uintptr_t lo, hi;
          if (arm == 3) {
            /* THE POISON CONTROL: discard the page the payload STARTS on,
             * which is where the heap keeps its links. If this does not
             * break, the probe cannot detect corruption and arm 1 proves
             * nothing. */
            uintptr_t p = (uintptr_t)(const void *)d & ~(uintptr_t)(PAGE - 1);
            if (e.cbData >= PAGE && Discard((PVOID)p, PAGE) == ERROR_SUCCESS) discarded++;
            continue;
          }
          inert_range(d, e.cbData, reserve, &lo, &hi);
          if (hi > lo && Discard((PVOID)lo, (SIZE_T)(hi - lo)) == ERROR_SUCCESS) {
            discarded += (hi - lo) / PAGE;
          }
        }
      }
      HeapUnlock(ph);
    }
    mem(&ws1, &pc1);
    if (arm == 2) printf("NULL ARM: no discard performed\n");

    else printf("discarded pages=%llu  ws %.2f -> %.2f MiB  commit %.2f -> %.2f MiB\n",
           discarded, MB(ws0), MB(ws1), MB(pc0), MB(pc1));

    /* ---- the hammer, run by arms 1, 2 and 3 alike ---- */
    {
      unsigned rounds = 40000, r;
      void *live[512];
      unsigned nlive = 0;
      unsigned bad = 0;
      memset(live, 0, sizeof live);
      for (r = 0; r < rounds; r++) {
        unsigned sz = 8 + (r * 2654435761u) % 8192u; /* forces split/coalesce/LFH */
        void *p = HeapAlloc(ph, 0, sz);
        if (p == NULL) { printf("  HeapAlloc FAILED at round %u\n", r); return 3; }
        memset(p, (int)(r & 0xff), sz);
        if (nlive < 512) live[nlive++] = p;
        else {
          unsigned k = r % 512;
          HeapFree(ph, 0, live[k]);
          live[k] = p;
        }
        if ((r % 4000) == 0) {
          if (!HeapValidate(ph, 0, NULL)) {
            printf("  HeapValidate FAILED at round %u\n", r);
            bad = 1;
            break;
          }
        }
      }
      for (j = 0; j < nlive; j++) if (live[j]) HeapFree(ph, 0, live[j]);
      if (!bad && !HeapValidate(ph, 0, NULL)) { printf("  HeapValidate FAILED at end\n"); bad = 1; }
      printf("hammer: %s\n", bad ? "HEAP CORRUPT" : "survived, HeapValidate clean");
      /* The survivors must still read back, or the arm lost its live set. */
      {
        unsigned long long s = 0;
        for (j = 0; j < nk; j++) s += *(unsigned char *)kept[j];
        printf("live set: %s (%u blocks)\n",
               (nk == 0 || s == (unsigned long long)nk) ? "intact" : "CORRUPT", nk);
      }
      if (arm == 3 && !bad) {
        printf("POISON CONTROL DID NOT BREAK - this probe cannot detect heap\n"
               "corruption, so arm 1's clean run proves nothing.\n");
      }
    }
  }
  return 0;
}
