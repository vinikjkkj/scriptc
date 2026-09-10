/* DOES A WIDER SIZE-CLASSED RECYCLER STOP THE BURST REACHING THE HEAP?
 *
 * The mechanism behind every measurement on this objective is FAILED REUSE,
 * and ~732 bytes is the size that fails. `SCR_POOL_MAX` is 256, so every one
 * of those blocks is above the runtime's size-classed recycler entirely and
 * goes straight to the CRT heap. The proposal is to raise the ceiling.
 *
 * Sweeping it for real costs a zapo-rest build per arm. This models it in
 * seconds first, the same way the sub-heap and discard routes were killed for
 * an afternoon each, and it tests the two things that decide it:
 *
 *   THE CLAIM. A size-classed freelist does not care about adjacency -- it
 *   hands back a dead block of the right size whatever sits between. So reuse
 *   should succeed even while chunks interleave, which is the serialised
 *   condition without serialising anything.
 *
 *   THE OBJECTION. A pooled block is retained memory. If the pool merely
 *   holds what the holes held, the number has moved rather than reduced. The
 *   difference is supposed to be that a pooled block is REUSABLE and a hole
 *   is not, so the pool's high-water is bounded by peak concurrent live while
 *   fragmentation is bounded by nothing -- and that is measured here, not
 *   asserted: `poolHeldMiB` is printed beside the heap numbers and the two
 *   must be added before any arm is called a win.
 *
 * THE WORKLOAD IS CONTINUOUS CHURN, not allocate-everything-then-free. A live
 * window of W blocks is held; each new allocation retires the oldest. That is
 * the shape the burst actually has -- 0.00% of the array data survives and
 * blocks die as the sync proceeds -- and it is the only shape in which a
 * recycler can help at all. An allocate-all-then-free-all model would show a
 * pool doing nothing, and would be measuring the wrong program.
 *
 * The 1.22% survivors are held out of the window permanently, as they are.
 *
 * -------------------------------------------------------------------------
 * MEASURED, and the route is a THROUGHPUT change, not a retention fix.
 * 400,000 allocations, live window 60,000, 1.22% surviving, pool budget 1 MiB:
 *
 *   sizes            retained-not-live          churn
 *   hole  spread   max=256   max=2048   red.   256 -> 2048
 *   1344       8     79.50      77.80   2.1%   172 -> 148 ms  -14%
 *   1344      64     82.89      81.41   1.8%   197 -> 163 ms  -17%
 *   1344     256     89.23      87.70   1.7%   199 -> 180 ms  -10%
 *   1344    1400    130.65     127.94   2.1%   297 -> 261 ms  -12%
 *
 * MEMORY 1.7-2.1%, FLAT ACROSS EVERY SIZE DISTRIBUTION. THROUGHPUT 10-17%.
 *
 * AND THE OBJECTION IS REAL, which the budget arm is what exposes. At
 * hole=700 spread=1400 window=60,000 with NO budget, heap free falls 92.72 ->
 * 74.27 MiB and it looks like an 18.45 MiB win -- but the pool now holds
 * 14.19 MiB of it, so retained-not-live goes 92.72 -> 88.46, and 77% of the
 * apparent win is the number moving between two columns. With a 1 MiB budget
 * the pool holds 1.00 MiB and retained-not-live is 88.05: the same answer with
 * a fourteenth of the occupancy, which is what says the small win is genuine
 * and the large one was accounting.
 *
 * WHY IT CANNOT DO BETTER, and this corrects the premise the route was
 * proposed on. `SCR_POOL_MAX` 256 does not mean these blocks have no
 * size-classed reuse -- it means they have none BY US. The Windows Low
 * Fragmentation Heap already buckets allocations up to 16 KB and activates
 * per size class after enough traffic, so a 700-byte or 1,344-byte class is
 * already being recycled by the allocator underneath. Our pool duplicates
 * work the heap is doing: it is FASTER, because a freelist pop skips the heap
 * call entirely, and it does not reduce residency, because the residency was
 * never caused by the absence of a recycler.
 *
 * The tell is the spread=8 row -- nearly a single size, the case a pool should
 * dominate -- where the memory win is still 2.1%.
 *
 * WHAT THIS MODEL IS NOT. Synthetic, one dominant size plus a spread, and a
 * live window standing in for the sync's concurrency. It has been wrong once
 * already in a way worth recording: the first version used ONE size, the CRT
 * heap recycled it perfectly, and the baseline came out at 8.79 MiB free
 * against the 81.92 MiB the real shape shows -- a model that could not
 * fragment could not have measured a defragmenter either. Mixed sizes fixed
 * that. The real sweep on zapo-rest is still the authority; this says only
 * whether it is worth four builds.
 *
 *   zig cc -O2 -o poolsim.exe poolsim.c -lpsapi
 *   poolsim.exe -max 256|512|1024|2048 [-depth N] [-budget BYTES]
 *               [-pairs N] [-hole N] [-window N] [-keepppm N]
 *   -max 256 is the CONTROL: the runtime's current ceiling, where a 700-byte
 *   block is never pooled and every one reaches the heap.
 */
#include <windows.h>
#include <psapi.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define MB(x) ((double)(x) / (1024.0 * 1024.0))
#define GRAIN 8u
#define MAXCLASS 512u /* 4096 / GRAIN */

static void *g_free[MAXCLASS];
static unsigned g_n[MAXCLASS];
static unsigned long long g_held = 0, g_held_peak = 0;
static unsigned long long g_hits = 0, g_miss = 0, g_gives = 0, g_rejects = 0;
static unsigned POOL_MAX = 256, POOL_DEPTH = 64;
static unsigned long long POOL_BUDGET = 0;

static size_t roundup(size_t n) { return (n + (GRAIN - 1)) & ~(size_t)(GRAIN - 1); }

static void *pool_take(size_t n) {
  size_t r = roundup(n);
  if (r != 0 && r <= POOL_MAX) {
    unsigned c = (unsigned)(r / GRAIN) - 1u;
    if (g_free[c] != NULL) {
      void *p = g_free[c];
      memcpy(&g_free[c], p, sizeof(void *));
      g_n[c]--;
      g_held -= r;
      g_hits++;
      return p;
    }
  }
  g_miss++;
  return malloc(r ? r : GRAIN);
}

static void pool_give(void *p, size_t n) {
  size_t r = roundup(n);
  if (r != 0 && r <= POOL_MAX && g_n[(r / GRAIN) - 1u] < POOL_DEPTH &&
      (POOL_BUDGET == 0 || g_held + r <= POOL_BUDGET)) {
    unsigned c = (unsigned)(r / GRAIN) - 1u;
    memcpy(p, &g_free[c], sizeof(void *));
    g_free[c] = p;
    g_n[c]++;
    g_held += r;
    if (g_held > g_held_peak) g_held_peak = g_held;
    g_gives++;
    return;
  }
  g_rejects++;
  free(p);
}

typedef struct {
  unsigned long long busy_n, busy_b, free_n, free_b, uncommitted_b;
} Walk;

static void walk_all(Walk *w) {
  HANDLE heaps[256];
  DWORD n = GetProcessHeaps(256, heaps), i;
  memset(w, 0, sizeof *w);
  for (i = 0; i < n; i++) {
    PROCESS_HEAP_ENTRY e;
    memset(&e, 0, sizeof e);
    if (!HeapLock(heaps[i])) continue;
    while (HeapWalk(heaps[i], &e)) {
      if (e.wFlags & PROCESS_HEAP_ENTRY_BUSY) { w->busy_n++; w->busy_b += e.cbData + e.cbOverhead; }
      else if (e.wFlags & PROCESS_HEAP_UNCOMMITTED_RANGE) w->uncommitted_b += e.cbData;
      else if (!(e.wFlags & PROCESS_HEAP_REGION)) { w->free_n++; w->free_b += e.cbData + e.cbOverhead; }
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
  unsigned pairs = 400000, hole = 700, window = 12000, keepppm = 12200, spread = 0;
  int i;
  void **win, **kept;
  unsigned *wsz;
  unsigned nkeep, every, nk = 0, j, wn = 0;
  Walk w;
  SIZE_T ws, pc;
  LARGE_INTEGER f, t0, t1;

  for (i = 1; i < argc; i++) {
    if (!strcmp(argv[i], "-max") && i + 1 < argc) POOL_MAX = (unsigned)atoi(argv[++i]);
    else if (!strcmp(argv[i], "-depth") && i + 1 < argc) POOL_DEPTH = (unsigned)atoi(argv[++i]);
    else if (!strcmp(argv[i], "-budget") && i + 1 < argc) POOL_BUDGET = strtoull(argv[++i], NULL, 10);
    else if (!strcmp(argv[i], "-pairs") && i + 1 < argc) pairs = (unsigned)atoi(argv[++i]);
    else if (!strcmp(argv[i], "-hole") && i + 1 < argc) hole = (unsigned)atoi(argv[++i]);
    else if (!strcmp(argv[i], "-window") && i + 1 < argc) window = (unsigned)atoi(argv[++i]);
    else if (!strcmp(argv[i], "-keepppm") && i + 1 < argc) keepppm = (unsigned)atoi(argv[++i]);
    else if (!strcmp(argv[i], "-spread") && i + 1 < argc) spread = (unsigned)atoi(argv[++i]);
  }
  if (POOL_MAX > MAXCLASS * GRAIN) POOL_MAX = MAXCLASS * GRAIN;

  win = (void **)malloc((size_t)window * sizeof *win);
  wsz = (unsigned *)malloc((size_t)window * sizeof *wsz);
  nkeep = (unsigned)(((unsigned long long)pairs * keepppm) / 1000000ull);
  every = nkeep ? pairs / nkeep : 0;
  kept = (void **)malloc((size_t)(nkeep + 1) * sizeof *kept);
  if (win == NULL || kept == NULL || wsz == NULL) return 2;

  QueryPerformanceFrequency(&f);
  QueryPerformanceCounter(&t0);
  /* MIXED SIZES ARE WHAT DEFEAT REUSE. With one size the CRT heap's own
   * free list is perfect and nothing fragments -- an earlier version of this
   * probe used one size and its baseline came out at 8.79 MiB free against
   * the 81.92 MiB the real shape shows, which meant it could not have
   * measured a recycler either way. `-spread` varies the request so a freed
   * block often cannot serve the next one. */
  for (j = 0; j < pairs; j++) {
    unsigned sz = spread ? hole + (unsigned)((j * 2654435761u) % spread) : hole;
    void *p = pool_take(sz);
    if (p == NULL) return 2;
    memset(p, 1, sz);
    if (every && (j % every) == 0 && nk < nkeep) { kept[nk++] = p; continue; }
    if (wn < window) { win[wn++] = p; wsz[wn - 1] = sz; }
    else {
      unsigned k = j % window;
      pool_give(win[k], wsz[k]);
      win[k] = p;
      wsz[k] = sz;
    }
  }
  QueryPerformanceCounter(&t1);
  /* The window drains at the end of the burst, as the sync's does. */
  for (j = 0; j < wn; j++) if (win[j]) pool_give(win[j], wsz[j]);

  walk_all(&w);
  mem(&ws, &pc);
  printf("max=%-5u depth=%-3u budget=%-10llu hole=%uB window=%u pairs=%u\n",
         POOL_MAX, POOL_DEPTH, POOL_BUDGET, hole, window, pairs);
  printf("  spread=%u (request = hole..hole+spread)\n", spread);
  printf("  heap  busy %.2f MiB / %llu blks   free %.2f MiB / %llu blks\n",
         MB(w.busy_b), w.busy_n, MB(w.free_b), w.free_n);
  printf("  pool  held %.2f MiB  peak %.2f MiB  hits %llu  miss %llu  gives %llu  rejects %llu\n",
         MB(g_held), MB(g_held_peak), g_hits, g_miss, g_gives, g_rejects);
  printf("  TOTAL ws %.2f MiB  commit %.2f MiB   (heap free %.2f + pool held %.2f = %.2f MiB retained-not-live)\n",
         MB(ws), MB(pc), MB(w.free_b), MB(g_held), MB(w.free_b) + MB(g_held));
  printf("  churn %.0f ms\n", 1000.0 * (double)(t1.QuadPart - t0.QuadPart) / (double)f.QuadPart);
  {
    unsigned long long s = 0;
    for (j = 0; j < nk; j++) s += *(unsigned char *)kept[j];
    printf("  live set %s (%u blocks)\n",
           (nk == 0 || s == (unsigned long long)nk) ? "intact" : "CORRUPT", nk);
  }
  if (g_hits == 0 && POOL_MAX >= roundup(hole)) {
    printf("  POOL NEVER HIT despite covering the size -- the churn never reused,"
           " so this arm measures nothing about recycling.\n");
  }
  return 0;
}
