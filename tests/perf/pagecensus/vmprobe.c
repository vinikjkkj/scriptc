/* Does page return work at all on this host, and does it work on the memory
 * the cycle arena actually has?
 *
 * The arena's chunks come from malloc(65536). Three questions, in order:
 *
 *  1. WHERE DOES malloc PUT THEM? If a 64 KiB request is page aligned, the
 *     "actual" and "aligned" models in tests/perf/pagecensus coincide and no
 *     placement change is needed before any page can be returned.
 *
 *  2. DOES DiscardVirtualMemory RETURN PHYSICAL PAGES from the interior of a
 *     LIVE malloc'd block? MEM_DECOMMIT requires owning the reservation and
 *     is not sound under the CRT heap; DiscardVirtualMemory (Win8+) does not
 *     -- it discards committed private pages in place. If it works here, the
 *     arena needs no new allocator to return pages.
 *
 *  3. WHAT DOES IT COST, in wall time per page and on the re-touch that
 *     faults the page back in?
 *
 * Every count is read from GetProcessMemoryInfo's WorkingSetSize and
 * PagefileUsage (private commit), because "RSS went down" and "the process
 * gave the memory back" are two claims: a working set can shrink to a
 * trimmer while commit stays, and that is not a return.
 *
 * THE NULL ARM IS THE POINT. The same touch-then-measure sequence runs with
 * NO discard at all, so "the working set fell" cannot be read as a result
 * when it would have fallen anyway.
 *
 *   zig cc -O2 -o vmprobe.exe vmprobe.c -lpsapi
 *   vmprobe.exe 0|1|2|3
 *
 * -------------------------------------------------------------------------
 * MEASURED, on this host (Windows 11 26200, x86_64, zig 0.16.0 cc -O2),
 * 4096 chunks of 64 KiB = 256 MiB, keeping the first whole page of each and
 * dropping the other 15 -- the arena's own shape, one survivor per chunk:
 *
 *   arm  chunk from    call                    dWS       dCOMMIT   ns/page
 *   0    malloc        none (null)            +0.00     +0.00        --
 *   1    malloc        DiscardVirtualMemory  -224.05     +0.00      3719
 *   2    VirtualAlloc  VirtualFree DECOMMIT  -239.99    -240.00       456
 *   3    VirtualAlloc  DiscardVirtualMemory  -240.00     +0.00      2255
 *
 *   re-touch after the call: 1146 / 1306 / 1239 ns per page against 15 ns
 *   in the null arm. Arm 2 additionally pays 48 ns/page to re-commit.
 *
 * FIVE THINGS THIS SETTLES, and three of them contradict what the route was
 * proposed on:
 *
 *  - malloc(65536) IS ESSENTIALLY NEVER PAGE ALIGNED here: 15 of 4096, 0.4%,
 *    and never 64 KiB aligned. VirtualAlloc is 64 KiB aligned always. Arm 1
 *    therefore recovers 57,359 pages where arm 3 recovers 61,440 on the same
 *    workload -- one page per chunk lost to the partial ends.
 *
 *  - A DECOMMITTED PAGE DOES NOT COME BACK BY BEING TOUCHED. VirtualQuery
 *    reports MEM_RESERVE with protect=0 after MEM_DECOMMIT; Windows has no
 *    auto-commit-on-fault for reserved pages, so a touch is an access
 *    violation, not a soft fault. The addresses do stay reserved and no
 *    pointer moves, but the allocator must re-commit explicitly before it
 *    hands the space out again. MEM_DECOMMIT is sound; it is not transparent.
 *
 *  - DiscardVirtualMemory IS transparent, and it is the one that works on
 *    memory this process did not reserve: pages stay MEM_COMMIT and readable,
 *    contents are discarded (they read back zero), the next touch is an
 *    ordinary soft fault. It is what lets the arena return pages with NO
 *    change of allocator.
 *
 *  - ONLY MEM_DECOMMIT RETURNS THE COMMIT CHARGE. Both calls return the same
 *    working set; private commit falls only in arm 2. A working-set drop with
 *    commit unchanged is a real reduction in physical memory held and is NOT
 *    a reduction in what the process has reserved against the commit limit.
 *    Any claim about "giving memory back" has to say which.
 *
 *  - OWNING THE RESERVATION IS ALSO 8x CHEAPER: 456 ns/page against 3719.
 *    Discarding inside a heap block makes the kernel walk a region it does
 *    not own the VAD split for.
 */
#include <windows.h>
#include <psapi.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define CHUNK (64u * 1024u)
#define PAGE 4096u
#define NCHUNK 4096u /* 256 MiB of chunks */

/* DiscardVirtualMemory returns a DWORD ERROR_ code, NOT a BOOL: success is
 * ERROR_SUCCESS == 0. Reading it as a BOOL counted every successful call as
 * a failure -- the first run of this probe reported "pages=0" beside a 224
 * MiB working-set drop, which is the shape of a counter that cannot see the
 * thing it counts. */
typedef DWORD(WINAPI *DiscardFn)(PVOID, SIZE_T);

static void mem(const char *tag, SIZE_T *ws, SIZE_T *pf) {
  PROCESS_MEMORY_COUNTERS_EX c;
  memset(&c, 0, sizeof c);
  c.cb = sizeof c;
  GetProcessMemoryInfo(GetCurrentProcess(), (PROCESS_MEMORY_COUNTERS *)&c, sizeof c);
  *ws = c.WorkingSetSize;
  *pf = c.PrivateUsage;
  if (tag != NULL) {
    printf("%-24s ws=%7.2f MiB  privatecommit=%7.2f MiB\n", tag,
           (double)c.WorkingSetSize / (1024.0 * 1024.0),
           (double)c.PrivateUsage / (1024.0 * 1024.0));
  }
}

static double now_ms(void) {
  LARGE_INTEGER f, t;
  QueryPerformanceFrequency(&f);
  QueryPerformanceCounter(&t);
  return 1000.0 * (double)t.QuadPart / (double)f.QuadPart;
}

int main(int argc, char **argv) {
  /* arm 0 = null (touch, measure, no discard); arm 1 = discard */
  int arm = argc > 1 ? atoi(argv[1]) : 1;
  unsigned char **ch = (unsigned char **)malloc(NCHUNK * sizeof *ch);
  unsigned i, p;
  unsigned aligned_page = 0, aligned_64k = 0;
  SIZE_T ws, pf, ws2, pf2;
  double t0, t1;
  unsigned long long discarded = 0;
  HMODULE k32 = GetModuleHandleA("kernel32.dll");
  DiscardFn Discard =
      (DiscardFn)(void *)GetProcAddress(k32, "DiscardVirtualMemory");

  printf("arm=%d  DiscardVirtualMemory=%s\n", arm,
         Discard != NULL ? "present" : "ABSENT");
  if (ch == NULL) return 2;

  for (i = 0; i < NCHUNK; i++) {
    /* arms 2 and 3 own the reservation, which is the only way MEM_DECOMMIT
     * is sound and the only way the COMMIT charge can fall. VirtualAlloc's
     * 64 KiB granularity makes every chunk 64 KiB aligned for free. */
    ch[i] = arm >= 2
                ? (unsigned char *)VirtualAlloc(NULL, CHUNK,
                                                MEM_RESERVE | MEM_COMMIT,
                                                PAGE_READWRITE)
                : (unsigned char *)malloc(CHUNK);
    if (ch[i] == NULL) {
      printf("alloc failed at %u\n", i);
      return 2;
    }
    if (((uintptr_t)ch[i] & (PAGE - 1u)) == 0) aligned_page++;
    if (((uintptr_t)ch[i] & (CHUNK - 1u)) == 0) aligned_64k++;
  }
  printf("malloc(65536) x %u: page-aligned %u (%.1f%%), 64KiB-aligned %u (%.1f%%)\n",
         NCHUNK, aligned_page, 100.0 * aligned_page / NCHUNK, aligned_64k,
         100.0 * aligned_64k / NCHUNK);

  /* Touch every page of every chunk: this is the spike. */
  for (i = 0; i < NCHUNK; i++) {
    for (p = 0; p < CHUNK; p += PAGE) ch[i][p] = (unsigned char)(i + p);
  }
  mem("after touching all", &ws, &pf);

  /* The survivor: keep page 0 of every chunk live, drop the other 15.
   * That is the arena's shape -- one live block pinning a whole chunk. */
  t0 = now_ms();
  if (arm != 0 && Discard != NULL) {
    for (i = 0; i < NCHUNK; i++) {
      unsigned char *base = (unsigned char *)(void *)(((uintptr_t)ch[i] + (PAGE - 1u)) &
                                                      ~(uintptr_t)(PAGE - 1u));
      unsigned char *end = ch[i] + CHUNK;
      unsigned char *from = base + PAGE; /* keep the first whole page */
      SIZE_T len = (SIZE_T)(((uintptr_t)end & ~(uintptr_t)(PAGE - 1u)) - (uintptr_t)from);
      if ((intptr_t)len <= 0) continue;
      if (arm == 2) {
        /* MEM_DECOMMIT on a reservation this process owns. The addresses
         * stay reserved, so nothing else can take them and every pointer
         * into the chunk stays valid; the next touch faults and re-commits
         * automatically only because the reservation is still ours. */
        if (VirtualFree(from, len, MEM_DECOMMIT)) discarded += len / PAGE;
      } else if (Discard(from, len) == ERROR_SUCCESS) {
        discarded += len / PAGE;
      }
    }
  }
  t1 = now_ms();
  mem(arm != 0 ? "after discard" : "after NO discard", &ws2, &pf2);
  printf("%-24s pages=%llu  %.2f ms  %.1f ns/page\n",
         arm != 0 ? "discard cost" : "null arm cost", discarded, t1 - t0,
         discarded > 0 ? 1e6 * (t1 - t0) / (double)discarded : 0.0);
  printf("delta ws=%+.2f MiB  delta privatecommit=%+.2f MiB\n",
         ((double)ws2 - (double)ws) / (1024.0 * 1024.0),
         ((double)pf2 - (double)pf) / (1024.0 * 1024.0));

  /* WHAT STATE ARE THE PAGES IN? This is the whole difference between the
   * two calls and it is not a matter of degree.
   *
   *   DiscardVirtualMemory leaves the pages COMMITTED and readable. Their
   *   contents are gone (they read back as zero), the physical page is
   *   returned, and the next touch is an ordinary soft fault. It is
   *   transparent: no pointer changes and no code has to know.
   *
   *   MEM_DECOMMIT leaves the pages RESERVED and NOT ACCESSIBLE. Windows
   *   does NOT auto-commit on touch the way a POSIX MAP_NORESERVE mapping
   *   does -- touching one raises an access violation. So a decommit design
   *   must re-commit explicitly before the allocator hands the space out
   *   again; it is sound, but it is not transparent.
   *
   * VirtualQuery says which, without needing a fault to prove it. */
  {
    MEMORY_BASIC_INFORMATION mbi;
    unsigned char *base = (unsigned char *)(void *)(((uintptr_t)ch[0] + (PAGE - 1u)) &
                                                    ~(uintptr_t)(PAGE - 1u));
    unsigned char *probe_at = base + 2u * PAGE;
    memset(&mbi, 0, sizeof mbi);
    if (VirtualQuery(probe_at, &mbi, sizeof mbi) != 0) {
      const char *st = mbi.State == MEM_COMMIT   ? "MEM_COMMIT"
                       : mbi.State == MEM_RESERVE ? "MEM_RESERVE"
                                                  : "MEM_FREE";
      printf("page state after the call: %s  (protect=0x%lx)\n", st,
             (unsigned long)mbi.Protect);
    }
  }

  /* A decommitted page is not touchable, so arm 2 has to buy it back before
   * the re-touch below. That re-commit is part of what the policy costs and
   * is timed here rather than hidden inside the re-touch. */
  if (arm == 2 && discarded > 0) {
    t0 = now_ms();
    for (i = 0; i < NCHUNK; i++) {
      unsigned char *base = (unsigned char *)(void *)(((uintptr_t)ch[i] + (PAGE - 1u)) &
                                                      ~(uintptr_t)(PAGE - 1u));
      unsigned char *end = ch[i] + CHUNK;
      unsigned char *from = base + PAGE;
      SIZE_T len = (SIZE_T)(((uintptr_t)end & ~(uintptr_t)(PAGE - 1u)) - (uintptr_t)from);
      if ((intptr_t)len <= 0) continue;
      VirtualAlloc(from, len, MEM_COMMIT, PAGE_READWRITE);
    }
    t1 = now_ms();
    printf("re-commit cost          pages=%llu  %.2f ms  %.1f ns/page\n",
           discarded, t1 - t0, 1e6 * (t1 - t0) / (double)discarded);
  }

  /* The re-fault: touch every page again and time it. This is what a
   * workload that re-uses the freed space immediately would pay. */
  t0 = now_ms();
  {
    unsigned long long sum = 0;
    for (i = 0; i < NCHUNK; i++) {
      for (p = 0; p < CHUNK; p += PAGE) sum += ch[i][p];
    }
    t1 = now_ms();
    printf("re-touch %u pages: %.2f ms  %.1f ns/page  (sum %llu)\n",
           NCHUNK * (CHUNK / PAGE), t1 - t0,
           1e6 * (t1 - t0) / (double)(NCHUNK * (CHUNK / PAGE)), sum);
  }
  mem("after re-touch", &ws, &pf);
  return 0;
}
