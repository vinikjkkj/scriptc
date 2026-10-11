/* heapsplit -- does HeapWalk's FREE column mean COMMITTED?
 *
 * The question this arm exists for. In one run of the instrumented app182
 * binary, measured at the same instant by two instruments:
 *
 *   in-process HeapWalk (tests/perf/heapcensus)  heap0 busy 16.33 MiB
 *                                                     free 22.69 MiB
 *                                                     uncommitted 25.72 MiB
 *   out-of-process VirtualQueryEx (vmrest)       ALL private non-stack
 *                                                     committed 18.84 MiB
 *   kernel PrivateUsage                                59.52 MiB total,
 *                                                     of which ~37.8 is the
 *                                                     instrument's image BSS
 *
 * busy+free = 39.0 MiB cannot be committed inside a process whose entire
 * private commit is 59.5 MiB with 37.8 of it spoken for. One column is
 * wrong. This arm asks the NT heap directly, in ONE process, with no
 * subject and no inference:
 *
 *   for every FREE block HeapWalk reports, VirtualQuery its own address and
 *   report whether those pages are MEM_COMMIT or MEM_RESERVE.
 *
 * If free blocks sit on MEM_RESERVE pages, HeapWalk's free column counts
 * address space the process has already given back, and every "committed
 * hole" figure derived from it is an overcount.
 *
 * The shape is made on purpose: many blocks above the heap's forwarding
 * threshold, allocated, touched, then freed, which is what leaves large
 * free runs the heap may decommit.
 *
 *   zig cc -O1 -o heapsplit.exe heapsplit.c -lpsapi
 */
#include <windows.h>
#include <psapi.h>
#include <stdio.h>
#include <stdlib.h>

#define MB(x) ((double)(x) / 1048576.0)

typedef struct { SIZE_T commit, reserve, freeState; int n; } Cls;

static void classify(void *p, SIZE_T len, Cls *c) {
  unsigned char *a = (unsigned char *)p, *end = a + len;
  MEMORY_BASIC_INFORMATION mbi;
  while (a < end) {
    if (VirtualQuery(a, &mbi, sizeof mbi) != sizeof mbi) return;
    unsigned char *rend = (unsigned char *)mbi.BaseAddress + mbi.RegionSize;
    SIZE_T take = (SIZE_T)((rend < end ? rend : end) - a);
    if (mbi.State == MEM_COMMIT) c->commit += take;
    else if (mbi.State == MEM_RESERVE) c->reserve += take;
    else c->freeState += take;
    a += take;
  }
  c->n++;
}

int main(int argc, char **argv) {
  int nblk = argc > 1 ? atoi(argv[1]) : 64;
  size_t blk = argc > 2 ? (size_t)strtoull(argv[2], NULL, 10) : 1000000;
  int freeEvery = argc > 3 ? atoi(argv[3]) : 1;   /* 1 = free all */

  void **v = (void **)malloc(sizeof(void *) * (size_t)nblk);
  for (int i = 0; i < nblk; i++) {
    v[i] = malloc(blk);
    if (v[i]) memset(v[i], 1 + (i & 31), blk);      /* touch: force commit */
  }
  PROCESS_MEMORY_COUNTERS_EX pm; pm.cb = sizeof pm;
  GetProcessMemoryInfo(GetCurrentProcess(), (PROCESS_MEMORY_COUNTERS *)&pm, sizeof pm);
  printf("AFTER ALLOC   PrivateUsage %.3f MiB  (%d blocks x %llu B = %.3f MiB)\n",
         MB(pm.PrivateUsage), nblk, (unsigned long long)blk, MB((SIZE_T)nblk * blk));

  for (int i = 0; i < nblk; i++) if (i % freeEvery == 0) { free(v[i]); v[i] = NULL; }

  GetProcessMemoryInfo(GetCurrentProcess(), (PROCESS_MEMORY_COUNTERS *)&pm, sizeof pm);
  printf("AFTER FREE    PrivateUsage %.3f MiB\n", MB(pm.PrivateUsage));

  HANDLE hs[64];
  DWORD nh = GetProcessHeaps(64, hs);
  SIZE_T busy = 0, freeb = 0, unc = 0;
  SIZE_T nbusy = 0, nfree = 0;
  SIZE_T bigFree = 0; SIZE_T nBigFree = 0;
  Cls big = {0, 0, 0, 0}, small = {0, 0, 0, 0};
  for (DWORD h = 0; h < nh; h++) {
    PROCESS_HEAP_ENTRY e; e.lpData = NULL;
    if (!HeapLock(hs[h])) continue;
    while (HeapWalk(hs[h], &e)) {
      if (e.wFlags & PROCESS_HEAP_REGION) continue;
      if (e.wFlags & PROCESS_HEAP_UNCOMMITTED_RANGE) { unc += e.cbData; continue; }
      if (e.wFlags & PROCESS_HEAP_ENTRY_BUSY) { busy += e.cbData + e.cbOverhead; nbusy++; }
      else {
        freeb += e.cbData + e.cbOverhead; nfree++;
        if (e.cbData >= 65536) { bigFree += e.cbData; nBigFree++; classify(e.lpData, e.cbData, &big); }
        else classify(e.lpData, e.cbData, &small);
      }
    }
    HeapUnlock(hs[h]);
  }
  printf("\nHEAPWALK, %lu heaps\n", nh);
  printf("  busy        %12.3f MiB  blocks %llu\n", MB(busy), (unsigned long long)nbusy);
  printf("  free        %12.3f MiB  blocks %llu\n", MB(freeb), (unsigned long long)nfree);
  printf("  uncommitted %12.3f MiB\n", MB(unc));
  printf("  busy+free   %12.3f MiB   <- what a census calls 'what the process pays'\n",
         MB(busy + freeb));
  printf("  free >=64K  %12.3f MiB  blocks %llu\n", MB(bigFree), (unsigned long long)nBigFree);

  printf("\nTHE SAME FREE BLOCKS, ASKED OF THE MEMORY MANAGER (VirtualQuery, in-process)\n");
  printf("  free >=64 KiB : MEM_COMMIT %.3f MiB   MEM_RESERVE %.3f MiB   MEM_FREE %.3f MiB  (%d blocks)\n",
         MB(big.commit), MB(big.reserve), MB(big.freeState), big.n);
  printf("  free < 64 KiB : MEM_COMMIT %.3f MiB   MEM_RESERVE %.3f MiB   MEM_FREE %.3f MiB  (%d blocks)\n",
         MB(small.commit), MB(small.reserve), MB(small.freeState), small.n);

  GetProcessMemoryInfo(GetCurrentProcess(), (PROCESS_MEMORY_COUNTERS *)&pm, sizeof pm);
  printf("\nKERNEL PrivateUsage now %.3f MiB. busy+free = %.3f MiB.\n",
         MB(pm.PrivateUsage), MB(busy + freeb));
  printf("VERDICT: busy+free %s PrivateUsage by %.3f MiB\n",
         (busy + freeb) > pm.PrivateUsage ? "EXCEEDS" : "is within",
         MB((busy + freeb) > pm.PrivateUsage ? (busy + freeb) - pm.PrivateUsage
                                             : pm.PrivateUsage - (busy + freeb)));
  return 0;
}
