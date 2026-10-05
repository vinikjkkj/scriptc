/* fibwalk -- count live fiber stacks in another process, from OUTSIDE it.
 *
 *   fibwalk <pid> <interval_ms> <out.txt>
 *
 * WHY EXTERNAL. The in-process gauges (tests/perf/fiberstat/scr_fiber_stat.h)
 * answer the same question, but putting a header inside the binary changes
 * the binary: this project measured an in-process instrument's own class at
 * 3.5-6.6 MiB and does not subtract it. Since the point here is to compare
 * MEMORY between two arms, the fiber count has to come from a tool that is
 * not in either of them.
 *
 * THE CLASSIFICATION RULE is the one docs/estado-vmwalk.md established and
 * closed its budget with: a STACK is a committed MEM_PRIVATE region whose
 * ALLOCATION BASE owns a PAGE_GUARD region. Counting allocation bases rather
 * than regions is what makes the answer "how many stacks", not "how many
 * pieces of stack" -- each fiber stack is several regions (guard, committed,
 * reserved) sharing one base.
 *
 * PEAK, NOT LAST. The walk repeats and keeps the walk that PROVED the most
 * stacks, which is the trigger discipline the same document insists on: close
 * a high-water mark against a walk, never against a sample that might have
 * missed it.
 */
#include <windows.h>
#include <psapi.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define MAXBASE 262144
static ULONG_PTR bases[MAXBASE];
static unsigned char hasGuard[MAXBASE];
static SIZE_T commit[MAXBASE];
static int nbase;

/* Regions come back in ASCENDING address order and every region sharing an
 * AllocationBase is contiguous, so the base being filled is always the LAST
 * one. A first version scanned all bases as a fallback, which made each walk
 * O(regions x bases); at ~9,000 stacks that is hundreds of millions of
 * comparisons per walk and the walker simply never finished -- it printed
 * nothing, which reads exactly like "no fibers found". */
static int findBase(ULONG_PTR b) {
  if (nbase > 0 && bases[nbase - 1] == b) return nbase - 1;
  if (nbase >= MAXBASE) return -1;
  bases[nbase] = b; hasGuard[nbase] = 0; commit[nbase] = 0;
  return nbase++;
}

int main(int argc, char **argv) {
  if (argc < 4) { fprintf(stderr, "usage: fibwalk <pid> <interval_ms> <out.txt>\n"); return 2; }
  DWORD pid = (DWORD)strtoul(argv[1], NULL, 10);
  DWORD iv = (DWORD)strtoul(argv[2], NULL, 10);
  const char *outPath = argv[3];
  /* SYNCHRONIZE is load-bearing: WaitForSingleObject on a process handle
   * needs it, and without it the wait returns WAIT_FAILED rather than
   * WAIT_OBJECT_0 -- so the "has the child exited?" test is never true and
   * the walker spins forever, writing nothing. Which looks exactly like a
   * process with no fibers in it. */
  HANDLE h = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ | SYNCHRONIZE,
                         FALSE, pid);
  if (!h) { fprintf(stderr, "fibwalk: OpenProcess(%lu) failed %lu\n", pid, GetLastError()); return 3; }

  long bestStacks = -1; SIZE_T bestStackCommit = 0, bestGuard = 0, bestPriv = 0;
  int walks = 0;
  /* Bounded regardless: a walker that cannot end is a walker that reports
   * nothing, and nothing is indistinguishable from zero. */
  const int MAXWALKS = 100000;
  for (;;) {
    DWORD w = WaitForSingleObject(h, iv);
    if (w == WAIT_OBJECT_0 || w == WAIT_FAILED) break; /* exited, or no access */
    if (walks >= MAXWALKS) break;
    nbase = 0;
    MEMORY_BASIC_INFORMATION mbi;
    unsigned char *addr = 0;
    SIZE_T guardBytes = 0;
    while (VirtualQueryEx(h, addr, &mbi, sizeof mbi) == sizeof mbi) {
      if (mbi.State == MEM_COMMIT && mbi.Type == MEM_PRIVATE) {
        int i = findBase((ULONG_PTR)mbi.AllocationBase);
        if (i >= 0) {
          commit[i] += mbi.RegionSize;
          if (mbi.Protect & PAGE_GUARD) { hasGuard[i] = 1; guardBytes += mbi.RegionSize; }
        }
      }
      unsigned char *next = (unsigned char *)mbi.BaseAddress + mbi.RegionSize;
      if (next <= addr) break;
      addr = next;
    }
    long stacks = 0; SIZE_T sc = 0;
    for (int i = 0; i < nbase; i++) if (hasGuard[i]) { stacks++; sc += commit[i]; }
    walks++;
    if (stacks > bestStacks) {
      bestStacks = stacks; bestStackCommit = sc; bestGuard = guardBytes;
      PROCESS_MEMORY_COUNTERS_EX pmc; memset(&pmc, 0, sizeof pmc); pmc.cb = sizeof pmc;
      if (GetProcessMemoryInfo(h, (PROCESS_MEMORY_COUNTERS *)&pmc, sizeof pmc))
        bestPriv = pmc.PrivateUsage;
    }
  }
  FILE *f = fopen(outPath, "w");
  if (!f) { fprintf(stderr, "fibwalk: cannot write %s\n", outPath); return 4; }
  fprintf(f, "walks=%d peakStacks=%ld stackCommit=%llu guardBytes=%llu privateUsageAtPeak=%llu\n",
          walks, bestStacks, (unsigned long long)bestStackCommit,
          (unsigned long long)bestGuard, (unsigned long long)bestPriv);
  fclose(f);
  printf("walks=%d peakStacks=%ld stackCommit=%llu guardBytes=%llu privateUsageAtPeak=%llu\n",
         walks, bestStacks, (unsigned long long)bestStackCommit,
         (unsigned long long)bestGuard, (unsigned long long)bestPriv);
  return 0;
}
