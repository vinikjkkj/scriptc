/* bsstgt -- an arm for the claim that a big .bss is CHARGED to PrivateUsage
 * while its pages are still untaken copy-on-write, and therefore lands in
 * vmcensus's RESIDUE and not in any of its attributed terms.
 *
 *   bsstgt <touchMiB> <holdSeconds>
 *
 * The array is 40 MiB of uninitialised file-scope storage -- the same shape
 * as tests/perf/prof/scr_prof.h's tables (scr_prof_hist 20 MiB,
 * scr_prof_stk 12 MiB, scr_prof_tbl 5.5 MiB) and
 * tests/perf/heapcensus/scr_heap_census.h's (0.75 MiB).
 *
 * touchMiB = 0 is the interesting arm: nothing in the array is ever
 * written, so no page's copy-on-write is taken, so an external walk must
 * classify every one of them as IMAGE STILL SHARED -- and yet the kernel
 * charges the commit. If PrivateUsage rises by ~40 MiB with touchMiB=0,
 * the charge is taken at map time and the "cow-taken" discriminator cannot
 * see it. That is not a defect in the discriminator: it is the difference
 * between what is PRIVATE and what is CHARGED, and this file is where the
 * difference is made visible instead of argued.
 *
 *   zig cc -O1 -o bsstgt.exe bsstgt.c -lpsapi
 */
#include <windows.h>
#include <psapi.h>
#include <stdio.h>
#include <stdlib.h>

#define N (40u * 1024u * 1024u)
static volatile unsigned char big[N];
static volatile unsigned long long sink;

int main(int argc, char **argv) {
  size_t touchMiB = argc > 1 ? (size_t)strtoull(argv[1], NULL, 10) : 0;
  int hold = argc > 2 ? atoi(argv[2]) : 15;
  PROCESS_MEMORY_COUNTERS_EX pm; pm.cb = sizeof pm;
  GetProcessMemoryInfo(GetCurrentProcess(), (PROCESS_MEMORY_COUNTERS *)&pm, sizeof pm);
  printf("bss=%u B (%.3f MiB)  PrivateUsage at start %.3f MiB  WS %.3f MiB\n",
         N, N / 1048576.0, pm.PrivateUsage / 1048576.0, pm.WorkingSetSize / 1048576.0);
  for (size_t i = 0; i < touchMiB * 1048576u && i < N; i += 4096) big[i] = 7;
  /* read it back so no optimiser can decide the writes were dead */
  for (size_t i = 0; i < N; i += 1048576u) sink += big[i];
  GetProcessMemoryInfo(GetCurrentProcess(), (PROCESS_MEMORY_COUNTERS *)&pm, sizeof pm);
  printf("touched %llu MiB   PrivateUsage %.3f MiB  WS %.3f MiB  sink=%llu\n",
         (unsigned long long)touchMiB, pm.PrivateUsage / 1048576.0,
         pm.WorkingSetSize / 1048576.0, sink);
  fflush(stdout);
  Sleep(hold * 1000);
  return 0;
}
