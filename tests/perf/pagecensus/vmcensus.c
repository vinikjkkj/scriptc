/* vmcensus -- decompose another process's PRIVATE COMMIT into terms that SUM,
 * from OUTSIDE it, over VirtualQueryEx.
 *
 *   vmcensus pid    <pid>       <interval_ms> <out.txt>
 *   vmcensus attach <exe-path>  <interval_ms> <out.txt>   (match by IMAGE PATH)
 *
 * PROVENANCE. This is tests/perf/corostate/fibwalk.c extended. That file
 * already walks VirtualQueryEx in another process and already carries the two
 * hard-won rules it needs:
 *   - a STACK is a committed MEM_PRIVATE region whose ALLOCATION BASE owns a
 *     PAGE_GUARD region (docs/estado-vmwalk.md sec.2), counted by BASE and not
 *     by region, and
 *   - regions come back in ascending address order with every region of one
 *     AllocationBase contiguous, so the base being filled is the LAST one --
 *     the O(regions x bases) fallback made the walker never finish, which read
 *     exactly like "no fibers found".
 * What is new here is only the CLASSIFICATION (fibwalk reports the STACK term
 * alone) and the TRIGGER (fibwalk closes on peak stack count, which is useless
 * on a lane with 14 fibers; this closes on peak resolved private commit).
 *
 * WHY EXTERNAL. The subject is an UNMODIFIED shipped binary. An in-process
 * header is inside every peak it quotes -- tests/perf/memmap measured its own
 * INSTRUMENT class at 3.5-6.6 MiB and does not subtract it. This process
 * touches nothing in the subject: no header, no rebuild, no cache key.
 *
 * WHAT CLOSES, AND WHAT DOES NOT. Every committed page lies in exactly one
 * VirtualQueryEx region and every region has exactly one Type and one
 * AllocationBase, so the walk's own classes are disjoint and exhaustive OVER
 * REGIONS by construction. They are NOT automatically equal to the kernel's
 * PrivateUsage: page tables and kernel-side per-process charge are not
 * regions. So the report prints RESOLVED against the kernel's own figure and
 * calls the difference RESIDUE. A term is never asserted into the residue.
 *
 * THE COW RULE. A MEM_IMAGE / MEM_MAPPED page counts against private commit
 * only once its copy-on-write has been taken. From outside, the discriminator
 * is the protection: PAGE_*WRITECOPY means NOT yet taken (still shared);
 * PAGE_READWRITE / PAGE_EXECUTE_READWRITE on an image region means the copy
 * HAS been taken and the page is now private. Both are reported separately so
 * the reader can see the size of the term the rule decides.
 *
 * SAMPLING IS NOT A HIGH-WATER MARK. A walk sees an instant. The kernel's
 * PeakPagefileUsage is a true high-water mark. The report prints BOTH and
 * their ratio, so a decomposition taken off a trough cannot be read as a
 * decomposition of the peak. It also prints each walk's duration and the
 * kernel PrivateUsage read immediately BEFORE and AFTER the same walk, so a
 * walk that straddled a large allocation is visible rather than silent.
 *
 *   zig cc -O2 -o vmcensus.exe vmcensus.c -lpsapi
 *
 * ARMED, 2026-10-11, zig 0.16.0 from G:\tools\zig, x86_64-windows-gnu.
 * Each line is a RUN against tests/perf/pagecensus/vmtgt.c, not an assertion.
 *
 *  - POSITIVE, to the page. 256 MiB committed and NOT touched reads
 *    PRIVATE non-stack 256.172 MiB with a 0.773 MiB residue -- while the
 *    working set stays at 4.1 MiB. It measures commit, not residency, and the
 *    deleted vmwalk2 recorded 256.14 / 0.75 for the same arm (sec.10).
 *  - NEGATIVE. Zero fibers reports 2 stacks, not 0 and not 2,000.
 *  - SPECIFICITY. 2,000 fibers at 128 KiB read 2,002 stacks and
 *    23.461 MiB of guard = 12,288 B per stack, the constant sec.7 names.
 *    At 256 KiB the usable term doubles 250.023 -> 500.023 MiB and the guard
 *    term does NOT move. The walk sees stack size; it is not blind to it.
 *  - SHAPE, which is what lets a base be NAMED rather than labelled. On this
 *    CRT, plain malloc of mixed sizes builds a segment ladder
 *    0.996 / 1.996 / 3.996 / ~8 / ~15.8 MiB (the last is the segment ceiling)
 *    with many regions per base; mallocs above the forwarding threshold make
 *    one-region bases of ~1 MiB with small odd reservations. The subject's
 *    private bases have exactly these two shapes and no third.
 *
 * MEASURED, app182 history sync, CHUNKS=8 CONVS=400 MSGS=6 TEXTLEN=300
 * ROUNDS=1 IDLE_S=60, binaries built at 3c462de14. Peak private commit:
 *
 *   term                     fiber lane   stackless lane (the default)
 *   kernel PrivateUsage       446.164          56.652
 *   STACK committed           324.320 (72.7%)   0.352 (0.62%)
 *     of which PAGE_GUARD     236.801 (53.1%)   0.199 (0.35%)
 *   CRT HEAP                   79.828 (17.9%)  53.438 (94.3%)
 *   IMAGE/MAPPED cow-taken      0.871 ( 0.2%)   0.871 (1.53%)
 *   private small bases+tail    0.277 ( 0.1%)   0.550 (0.97%)
 *   RESIDUE (page tables)      40.867 ( 9.2%)   1.441 (2.54%)
 *
 * Both columns sum to their own denominator to within 0.001 MiB, and the
 * denominator is printed on every line because a ratio is two numbers.
 * The fiber residue of 40.867 MiB reproduces sec.7's 40.75 MiB page-table
 * term from a different instrument, seven days and one deleted walker later.
 */
#include <windows.h>
#include <psapi.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define MAXBASE 262144
#define TOPN 24

typedef struct {
  ULONG_PTR base;
  unsigned char hasGuard;
  SIZE_T priv;        /* committed MEM_PRIVATE bytes under this base */
  SIZE_T guard;       /* of which PAGE_GUARD */
  int nreg;           /* committed private regions under this base */
  SIZE_T reserve;     /* reserved-but-not-committed MEM_PRIVATE under this base */
} Base;

static Base bs[MAXBASE];
static int nbase;
static long dropped;   /* bases lost to MAXBASE. A clip must be LOUD. */

/* one walk's class totals */
typedef struct {
  SIZE_T privCommit, privGuard, privReserve;
  SIZE_T imgCommit, imgPrivate, imgShared;
  SIZE_T mapCommit, mapPrivate, mapShared;
  SIZE_T stackCommit, stackGuard;
  SIZE_T heapPrivate;          /* privCommit - stackCommit */
  long   stacks;
  long   regions, privRegions, bases, dropped;
  double walkMs;
  SIZE_T kBefore, kAfter, kPeak, kWS, kPeakWS;
} Snap;

static Base topb[TOPN];
static int ntop;

static int findBase(ULONG_PTR b) {
  if (nbase > 0 && bs[nbase - 1].base == b) return nbase - 1;
  if (nbase >= MAXBASE) { dropped++; return -1; }
  memset(&bs[nbase], 0, sizeof bs[0]);
  bs[nbase].base = b;
  return nbase++;
}

static int isWriteCopy(DWORD p) {
  DWORD q = p & 0xFF;
  return q == PAGE_WRITECOPY || q == PAGE_EXECUTE_WRITECOPY;
}
static int isWritablePrivate(DWORD p) {
  DWORD q = p & 0xFF;
  return q == PAGE_READWRITE || q == PAGE_EXECUTE_READWRITE;
}

/* Select the TOPN non-stack private bases by bytes. O(nbase*TOPN), run only
 * when a walk becomes the best one, which is rare. */
static void selectTop(void) {
  ntop = 0;
  for (int i = 0; i < nbase; i++) {
    if (bs[i].hasGuard) continue;
    if (bs[i].priv == 0) continue;
    if (ntop < TOPN) {
      topb[ntop++] = bs[i];
    } else {
      int worst = 0;
      for (int j = 1; j < ntop; j++) if (topb[j].priv < topb[worst].priv) worst = j;
      if (bs[i].priv > topb[worst].priv) topb[worst] = bs[i];
    }
  }
  for (int i = 0; i < ntop; i++)
    for (int j = i + 1; j < ntop; j++)
      if (topb[j].priv > topb[i].priv) { Base t = topb[i]; topb[i] = topb[j]; topb[j] = t; }
}

static SIZE_T readPriv(HANDLE h, SIZE_T *ws, SIZE_T *peak, SIZE_T *peakWs) {
  PROCESS_MEMORY_COUNTERS_EX pmc; memset(&pmc, 0, sizeof pmc); pmc.cb = sizeof pmc;
  if (!GetProcessMemoryInfo(h, (PROCESS_MEMORY_COUNTERS *)&pmc, sizeof pmc)) return 0;
  if (ws) *ws = pmc.WorkingSetSize;
  if (peak) *peak = pmc.PeakPagefileUsage;
  if (peakWs) *peakWs = pmc.PeakWorkingSetSize;
  return pmc.PrivateUsage;
}

/* Match a running process by its IMAGE PATH, never by its name and never by
 * its command line -- a matcher on the command line counts its own shell. */
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

static void emit(FILE *f, const Snap *s, const char *tag) {
#define MB(x) ((double)(x) / 1048576.0)
  SIZE_T resolved = s->privCommit + s->imgPrivate + s->mapPrivate;
  double residue = (double)s->kBefore - (double)resolved;
  fprintf(f, "== VMCENSUS %s ==\n", tag);
  fprintf(f, "walkMs                  %.3f\n", s->walkMs);
  fprintf(f, "regions                 %ld   (privateCommitted=%ld, bases=%ld)\n",
          s->regions, s->privRegions, s->bases);
  fprintf(f, "BASES DROPPED (clip)    %ld   %s\n", s->dropped,
          s->dropped ? "*** SATURATED -- THIS DECOMPOSITION IS INVALID ***"
                     : "(none: the array held)");
  fprintf(f, "kernel PrivateUsage     before=%.3f after=%.3f MiB  (drift %.3f)\n",
          MB(s->kBefore), MB(s->kAfter), MB(s->kAfter) - MB(s->kBefore));
  fprintf(f, "kernel PeakPagefile     %.3f MiB\n", MB(s->kPeak));
  fprintf(f, "kernel WorkingSet       %.3f MiB   PeakWorkingSet %.3f MiB\n",
          MB(s->kWS), MB(s->kPeakWS));
  fprintf(f, "--- terms, denominator = kernel PrivateUsage at walk start (%.3f MiB) ---\n",
          MB(s->kBefore));
  fprintf(f, "STACK committed         %12.3f MiB  %6.2f%%   (%ld stacks)\n",
          MB(s->stackCommit), 100.0 * s->stackCommit / (double)s->kBefore, s->stacks);
  fprintf(f, "  of which PAGE_GUARD   %12.3f MiB  %6.2f%%\n",
          MB(s->stackGuard), 100.0 * s->stackGuard / (double)s->kBefore);
  fprintf(f, "  usable stack commit   %12.3f MiB  %6.2f%%\n",
          MB(s->stackCommit - s->stackGuard),
          100.0 * (s->stackCommit - s->stackGuard) / (double)s->kBefore);
  fprintf(f, "PRIVATE non-stack       %12.3f MiB  %6.2f%%   (heap, arenas, sqlite, TEB/PEB)\n",
          MB(s->heapPrivate), 100.0 * s->heapPrivate / (double)s->kBefore);
  fprintf(f, "IMAGE cow-taken         %12.3f MiB  %6.2f%%\n",
          MB(s->imgPrivate), 100.0 * s->imgPrivate / (double)s->kBefore);
  fprintf(f, "MAPPED cow-taken        %12.3f MiB  %6.2f%%\n",
          MB(s->mapPrivate), 100.0 * s->mapPrivate / (double)s->kBefore);
  fprintf(f, "RESOLVED by walk        %12.3f MiB  %6.2f%%\n",
          MB(resolved), 100.0 * resolved / (double)s->kBefore);
  fprintf(f, "RESIDUE (kernel-walk)   %12.3f MiB  %6.2f%%   NOT attributed\n",
          residue / 1048576.0, 100.0 * residue / (double)s->kBefore);
  fprintf(f, "--- not in private commit, printed so it cannot be confused with it ---\n");
  fprintf(f, "IMAGE still shared      %12.3f MiB   (WRITECOPY untaken + R/X)\n", MB(s->imgShared));
  fprintf(f, "MAPPED still shared     %12.3f MiB\n", MB(s->mapShared));
  fprintf(f, "PRIVATE reserved only   %12.3f MiB   (MEM_RESERVE, no commit charge)\n",
          MB(s->privReserve));
  fprintf(f, "--- largest non-stack private allocation bases ---\n");
  for (int i = 0; i < ntop; i++)
    fprintf(f, "  base %016llx  %12.3f MiB  regions=%d  reserved=%.3f MiB\n",
            (unsigned long long)topb[i].base, MB(topb[i].priv), topb[i].nreg,
            MB(topb[i].reserve));
  fprintf(f, "== END %s ==\n", tag);
#undef MB
}

int main(int argc, char **argv) {
  if (argc < 5) {
    fprintf(stderr, "usage: vmcensus pid <pid> <interval_ms> <out.txt>\n");
    fprintf(stderr, "       vmcensus attach <exe-path> <interval_ms> <out.txt>\n");
    return 2;
  }
  const char *mode = argv[1];
  DWORD iv = (DWORD)strtoul(argv[3], NULL, 10);
  const char *outPath = argv[4];
  DWORD pid = 0;

  if (strcmp(mode, "pid") == 0) {
    pid = (DWORD)strtoul(argv[2], NULL, 10);
  } else if (strcmp(mode, "attach") == 0) {
    char want[MAX_PATH * 2];
    strncpy(want, argv[2], sizeof want - 1); want[sizeof want - 1] = 0;
    for (size_t k = 0; want[k]; k++) if (want[k] == '/') want[k] = '\\';
    /* Bounded wait: a watcher that can spin forever reports nothing, and
     * nothing is indistinguishable from zero. */
    for (int t = 0; t < 600000 / 20 && pid == 0; t++) { pid = findByImage(want); if (!pid) Sleep(20); }
    if (!pid) { fprintf(stderr, "vmcensus: no process with image %s appeared\n", want); return 3; }
    fprintf(stderr, "vmcensus: attached pid=%lu image=%s\n", pid, want);
  } else { fprintf(stderr, "vmcensus: unknown mode %s\n", mode); return 2; }

  HANDLE h = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ | SYNCHRONIZE,
                         FALSE, pid);
  if (!h) { fprintf(stderr, "vmcensus: OpenProcess(%lu) failed %lu\n", pid, GetLastError()); return 3; }

  Snap best; memset(&best, 0, sizeof best);
  SIZE_T bestResolved = 0, peakSeen = 0, peakWsSeen = 0;
  int walks = 0, bestWalk = -1;
  const int MAXWALKS = 1000000;

  for (;;) {
    DWORD w = WaitForSingleObject(h, iv);
    if (w == WAIT_OBJECT_0 || w == WAIT_FAILED) break;
    if (walks >= MAXWALKS) break;

    Snap s; memset(&s, 0, sizeof s);
    SIZE_T pk = 0, pkws = 0, ws = 0;
    s.kBefore = readPriv(h, &ws, &pk, &pkws);
    if (pk > peakSeen) peakSeen = pk;
    if (pkws > peakWsSeen) peakWsSeen = pkws;
    if (s.kBefore == 0) { walks++; continue; }
    s.kWS = ws; s.kPeak = pk; s.kPeakWS = pkws;

    LARGE_INTEGER qf, q0, q1;
    QueryPerformanceFrequency(&qf); QueryPerformanceCounter(&q0);
    nbase = 0; dropped = 0;
    MEMORY_BASIC_INFORMATION mbi;
    unsigned char *addr = 0;
    while (VirtualQueryEx(h, addr, &mbi, sizeof mbi) == sizeof mbi) {
      s.regions++;
      if (mbi.State == MEM_COMMIT) {
        if (mbi.Type == MEM_PRIVATE) {
          s.privCommit += mbi.RegionSize;
          s.privRegions++;
          int i = findBase((ULONG_PTR)mbi.AllocationBase);
          if (i >= 0) {
            bs[i].priv += mbi.RegionSize;
            bs[i].nreg++;
            if (mbi.Protect & PAGE_GUARD) {
              bs[i].hasGuard = 1; bs[i].guard += mbi.RegionSize;
              s.privGuard += mbi.RegionSize;
            }
          }
        } else if (mbi.Type == MEM_IMAGE) {
          s.imgCommit += mbi.RegionSize;
          if (isWritablePrivate(mbi.Protect)) s.imgPrivate += mbi.RegionSize;
          else s.imgShared += mbi.RegionSize;
          (void)isWriteCopy;
        } else if (mbi.Type == MEM_MAPPED) {
          s.mapCommit += mbi.RegionSize;
          if (isWritablePrivate(mbi.Protect)) s.mapPrivate += mbi.RegionSize;
          else s.mapShared += mbi.RegionSize;
        }
      } else if (mbi.State == MEM_RESERVE && mbi.Type == MEM_PRIVATE) {
        s.privReserve += mbi.RegionSize;
        int i = findBase((ULONG_PTR)mbi.AllocationBase);
        if (i >= 0) bs[i].reserve += mbi.RegionSize;
      }
      unsigned char *next = (unsigned char *)mbi.BaseAddress + mbi.RegionSize;
      if (next <= addr) break;
      addr = next;
    }
    QueryPerformanceCounter(&q1);
    s.walkMs = 1000.0 * (double)(q1.QuadPart - q0.QuadPart) / (double)qf.QuadPart;
    s.bases = nbase; s.dropped = dropped;
    for (int i = 0; i < nbase; i++)
      if (bs[i].hasGuard) { s.stacks++; s.stackCommit += bs[i].priv; s.stackGuard += bs[i].guard; }
    s.heapPrivate = s.privCommit - s.stackCommit;
    s.kAfter = readPriv(h, NULL, NULL, NULL);
    walks++;

    SIZE_T resolved = s.privCommit + s.imgPrivate + s.mapPrivate;
    if (resolved > bestResolved) {
      bestResolved = resolved; best = s; bestWalk = walks;
      selectTop();
    }
  }

  /* The handle keeps the process object alive after exit, so the kernel's own
   * high-water marks are still readable here. If they are not, the per-walk
   * maxima stand in -- they are monotonic, so the last one read is a floor. */
  SIZE_T pk = 0, pkws = 0;
  readPriv(h, NULL, &pk, &pkws);
  if (pk > peakSeen) peakSeen = pk;
  if (pkws > peakWsSeen) peakWsSeen = pkws;

  FILE *f = fopen(outPath, "w");
  if (!f) { fprintf(stderr, "vmcensus: cannot write %s\n", outPath); return 4; }
  fprintf(f, "pid=%lu walks=%d bestWalk=%d interval_ms=%lu\n", pid, walks, bestWalk, (unsigned long)iv);
  fprintf(f, "KERNEL PeakPagefileUsage  %.3f MiB   <- true high-water mark\n", peakSeen / 1048576.0);
  fprintf(f, "KERNEL PeakWorkingSet     %.3f MiB\n", peakWsSeen / 1048576.0);
  if (bestWalk < 0) {
    fprintf(f, "NO WALK RESOLVED ANYTHING -- this is a failure, not a zero.\n");
    fclose(f);
    fprintf(stderr, "vmcensus: no walk resolved anything (walks=%d)\n", walks);
    return 5;
  }
  fprintf(f, "COVERAGE of the peak      %.2f%%  (best walk's PrivateUsage %.3f / peak %.3f)\n",
          100.0 * (double)best.kBefore / (double)peakSeen,
          best.kBefore / 1048576.0, peakSeen / 1048576.0);
  emit(f, &best, "BEST");
  fclose(f);

  printf("pid=%lu walks=%d bestWalk=%d peakPagefile=%.3f bestPrivate=%.3f coverage=%.2f%%\n",
         pid, walks, bestWalk, peakSeen / 1048576.0, best.kBefore / 1048576.0,
         100.0 * (double)best.kBefore / (double)peakSeen);
  emit(stdout, &best, "BEST");
  return 0;
}
