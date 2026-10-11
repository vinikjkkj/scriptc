/* vmheap -- split another process's CRT heap into BUSY and FREE, from OUTSIDE.
 *
 *   vmheap <pid|attach> <arg> <budget_ms> <out.txt>
 *
 * WHY. vmcensus closes the budget and says the CRT heap is ~95% of the
 * stackless peak. "95% is heap" is not yet a target: a heap that is 95% live
 * objects and a heap that is 95% committed-but-free are different problems
 * with different fixes, and the committed figure cannot tell them apart.
 * ToolHelp's Heap32First/Heap32Next reports every block with LF32_FREE set or
 * clear, in another process, with no instrument inside it.
 *
 * WHAT IT CANNOT DO, said before it is run. This walk is NOT atomic and is
 * far slower than a VirtualQueryEx walk -- one ReadProcessMemory per block.
 * On a live process at its peak it returns a SMEARED picture, not an instant.
 * So it carries a BUDGET: it stops at budget_ms and reports how far it got
 * and whether it finished. A partial walk is reported as partial. A truncated
 * result is not an empty result and must never be read as one.
 *
 *   zig cc -O2 -o vmheap.exe vmheap.c
 *
 * RESULT, 2026-10-11: THE CONTROL PASSES AND THE SUBJECT FAILS. Kept because
 * a route that was tried and did not work is worth more than the same route
 * proposed again next week.
 *
 *  - CONTROL. Against vmtgt holding 60 MiB of live malloc it reads
 *    busy 60.393 MiB over 5,814 blocks, busyShare 95.35%, in 3.2 s
 *    (0.55 ms/block). It can see a full heap and it finishes.
 *  - SUBJECT (app182, stackless lane). Heap32Next slows to 4.6 ms/block --
 *    8x the control -- and in 74.9 s it enumerated 16,382 blocks of ONE of
 *    the three heaps before the budget stopped it, reporting BUSY 3.137 MiB
 *    against the 61 MiB of committed heap vmcensus sees in the same run.
 *  - IT PERTURBS THE SUBJECT, and that is how the failure was caught: in the
 *    same run vmcensus reported a RESIDUE of -2.473 MiB. A negative residue
 *    is impossible in a sound decomposition -- the walk resolved more than
 *    the kernel admitted owning -- so the run is void, and the field exists
 *    precisely so such a run announces itself instead of being averaged in.
 *  - THE IDLE WALK'S "FINISHED yes" IS A FALSE GREEN. It ends with heaps=3
 *    and a last heap reading busy=0/0, having seen 12,309 blocks where the
 *    in-process census counts 47,719. It finished because there was nothing
 *    more it could read, not because it had read everything.
 *
 * So the committed CRT heap can be SIZED from outside (vmcensus does it) but
 * its contents cannot be named from outside by this API on this subject.
 * Naming the largest occupant AT THE PEAK needs a phase trigger inside
 * tests/perf/heapcensus, which today reports once, at shutdown.
 */
#include <windows.h>
#include <tlhelp32.h>
#include <psapi.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static DWORD findByImage(const char *want) {
  DWORD pids[4096], cb = 0;
  if (!EnumProcesses(pids, sizeof pids, &cb)) return 0;
  int n = (int)(cb / sizeof(DWORD));
  char buf[MAX_PATH * 2];
  for (int i = 0; i < n; i++) {
    if (pids[i] == 0 || pids[i] == GetCurrentProcessId()) continue;
    HANDLE p = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pids[i]);
    if (!p) continue;
    DWORD sz = sizeof buf;
    if (QueryFullProcessImageNameA(p, 0, buf, &sz)) {
      for (DWORD k = 0; k < sz; k++) if (buf[k] == '/') buf[k] = '\\';
      if (_stricmp(buf, want) == 0) { CloseHandle(p); return pids[i]; }
    }
    CloseHandle(p);
  }
  return 0;
}

int main(int argc, char **argv) {
  if (argc < 5) {
    fprintf(stderr, "usage: vmheap pid <pid> <budget_ms> <out.txt>\n");
    fprintf(stderr, "       vmheap attach <exe-path> <budget_ms> <out.txt>\n");
    return 2;
  }
  DWORD budget = (DWORD)strtoul(argv[3], NULL, 10);
  const char *outPath = argv[4];
  DWORD pid = 0;
  if (strcmp(argv[1], "pid") == 0) pid = (DWORD)strtoul(argv[2], NULL, 10);
  else {
    char want[MAX_PATH * 2];
    strncpy(want, argv[2], sizeof want - 1); want[sizeof want - 1] = 0;
    for (size_t k = 0; want[k]; k++) if (want[k] == '/') want[k] = '\\';
    for (int t = 0; t < 600000 / 20 && pid == 0; t++) { pid = findByImage(want); if (!pid) Sleep(20); }
    if (!pid) { fprintf(stderr, "vmheap: no process with image %s\n", want); return 3; }
    fprintf(stderr, "vmheap: attached pid=%lu\n", pid);
    /* The peak is mid-load, not at start. Wait before walking so the walk is
     * not a picture of the boot. */
    Sleep((DWORD)(argc > 5 ? strtoul(argv[5], NULL, 10) : 0));
  }

  DWORD t0 = GetTickCount();
  HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPHEAPLIST, pid);
  if (snap == INVALID_HANDLE_VALUE) {
    fprintf(stderr, "vmheap: snapshot failed %lu\n", GetLastError()); return 4;
  }
  HEAPLIST32 hl; hl.dwSize = sizeof hl;
  unsigned long long busy = 0, freeb = 0;
  long nbusy = 0, nfree = 0, nheaps = 0;
  int finished = 1;

  FILE *f = fopen(outPath, "w");
  if (!f) { fprintf(stderr, "vmheap: cannot write %s\n", outPath); return 5; }

  if (Heap32ListFirst(snap, &hl)) {
    do {
      nheaps++;
      unsigned long long hb = 0, hf = 0; long nb = 0, nf = 0;
      HEAPENTRY32 he; memset(&he, 0, sizeof he); he.dwSize = sizeof he;
      if (Heap32First(&he, pid, hl.th32HeapID)) {
        do {
          if (he.dwFlags & LF32_FREE) { hf += he.dwBlockSize; nf++; }
          else { hb += he.dwBlockSize; nb++; }
          if (((nb + nf) & 0x3FFF) == 0 && GetTickCount() - t0 > budget) { finished = 0; break; }
          he.dwSize = sizeof he;
        } while (Heap32Next(&he));
      }
      fprintf(f, "HEAP %016llx busy=%llu/%ld free=%llu/%ld\n",
              (unsigned long long)hl.th32HeapID, hb, nb, hf, nf);
      busy += hb; freeb += hf; nbusy += nb; nfree += nf;
      if (!finished) break;
      hl.dwSize = sizeof hl;
    } while (Heap32ListNext(snap, &hl));
  }
  CloseHandle(snap);
  DWORD ms = GetTickCount() - t0;

  HANDLE h = OpenProcess(PROCESS_QUERY_INFORMATION, FALSE, pid);
  unsigned long long priv = 0;
  if (h) {
    PROCESS_MEMORY_COUNTERS_EX pmc; memset(&pmc, 0, sizeof pmc); pmc.cb = sizeof pmc;
    if (GetProcessMemoryInfo(h, (PROCESS_MEMORY_COUNTERS *)&pmc, sizeof pmc)) priv = pmc.PrivateUsage;
    CloseHandle(h);
  }
  fprintf(f, "FINISHED %s   walkMs=%lu heaps=%ld\n",
          finished ? "yes" : "NO -- PARTIAL, the totals below are a FLOOR", ms, nheaps);
  fprintf(f, "BUSY  %.3f MiB over %ld blocks\n", busy / 1048576.0, nbusy);
  fprintf(f, "FREE  %.3f MiB over %ld blocks\n", freeb / 1048576.0, nfree);
  fprintf(f, "TOTAL %.3f MiB   busyShare=%.2f%%\n", (busy + freeb) / 1048576.0,
          (busy + freeb) ? 100.0 * busy / (double)(busy + freeb) : 0.0);
  fprintf(f, "kernel PrivateUsage at end of walk %.3f MiB\n", priv / 1048576.0);
  fclose(f);
  printf("finished=%s walkMs=%lu heaps=%ld busy=%.3f/%ld free=%.3f/%ld busyShare=%.2f%% priv=%.3f\n",
         finished ? "yes" : "NO", ms, nheaps, busy / 1048576.0, nbusy,
         freeb / 1048576.0, nfree,
         (busy + freeb) ? 100.0 * busy / (double)(busy + freeb) : 0.0, priv / 1048576.0);
  return finished ? 0 : 6;
}
