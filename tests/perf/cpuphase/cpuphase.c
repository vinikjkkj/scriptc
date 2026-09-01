/*
 * cpuphase.c - PER-PHASE external CPU instrument for one child process.
 *
 * cpuprobe.c measures a whole run. This measures each PHASE of a run, for
 * the case the bench columns exposed: process.cpuUsage() is refused in a
 * compiled binary, so the bench printed "CPU time 0.00 ms" and "heap delta
 * 0.00 MiB" for every scenario on both lanes. A column that prints a
 * number it cannot know is worse than one that says n/a, and the fix is
 * not to delete the column -- it is to measure from OUTSIDE the process,
 * where the numbers exist for any child regardless of what its runtime
 * exposes.
 *
 * HOW
 *   The child's stdout is piped, echoed through byte-for-byte, and
 *   scanned for two markers the bench prints:
 *       [phase-begin] NAME
 *       [phase-end] NAME
 *   On each marker the child's kernel counters are sampled. Everything
 *   else on stdout passes through untouched, so the bench's own output is
 *   unaffected and the two lanes can be diffed as before.
 *
 * WHAT IS SAMPLED, AND WHY BOTH
 *   cycles   QueryProcessCycleTime. Per-thread cycle accumulators from the
 *            invariant TSC, summed over the process, exact to the context
 *            switch rather than to the scheduler tick. This is the
 *            headline number.
 *   user     GetProcessTimes. TICK-QUANTIZED at 15.625 ms and a binomial
 *   kernel   sample, not a measurement -- unusable for small deltas, which
 *            is why cpuprobe refuses to headline it. It is kept here for
 *            one reason the cycle counter cannot serve: QueryProcessCycleTime
 *            gives no USER/KERNEL SPLIT, and on a workload that is 99%
 *            socket wait the split is the finding -- it is what separates
 *            "spinning" from "blocked". Over phases of SECONDS the 15.625 ms
 *            quantum is 0.03-0.4%, so the split is reportable at this
 *            granularity even though a per-call delta would not be.
 *            Both are printed so a reader can see the disagreement.
 *
 * The child inherits stderr, so its diagnostics are not reordered into the
 * piped stream. Our own table goes to stderr after the child exits.
 *
 *   cpuphase.exe -- <cmd> [args...]
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <windows.h>

typedef BOOL(WINAPI *QPCT)(HANDLE, PULONG64);
static QPCT pQPCT;

#define MAXPH 64
typedef struct {
  char name[64];
  ULONG64 cyc0, cyc1;
  double usr0, usr1, ker0, ker1;
  double wall0, wall1;
  /* What crosses into the kernel, counted rather than theorised about.
   * A compute-bound phase spending seconds in kernel mode is doing
   * SOMETHING hundreds of thousands of times; these three counters say
   * which class it is before anyone argues about why. */
  ULONG64 rd0, rd1, wr0, wr1, ot0, ot1;   /* GetProcessIoCounters */
  ULONG64 pf0, pf1;                        /* page faults */
  int open, done;
} Phase;
static Phase ph[MAXPH];
static int nph;

static double now_ms(void) {
  LARGE_INTEGER f, c;
  QueryPerformanceFrequency(&f); QueryPerformanceCounter(&c);
  return (double)c.QuadPart * 1000.0 / (double)f.QuadPart;
}
static double ft_ms(FILETIME ft) {
  ULARGE_INTEGER u; u.LowPart = ft.dwLowDateTime; u.HighPart = ft.dwHighDateTime;
  return (double)u.QuadPart / 10000.0; /* 100ns -> ms */
}
typedef BOOL(WINAPI *GPMI)(HANDLE, void *, DWORD);
static GPMI pGPMI;
/* PROCESS_MEMORY_COUNTERS' first two fields; declared locally so this TU
 * needs no psapi header or import library. */
typedef struct {
  DWORD cb;
  DWORD PageFaultCount;
  SIZE_T PeakWorkingSetSize;
  SIZE_T WorkingSetSize;
  SIZE_T rest[6];
} PMC_FULL;

static void sample(HANDLE h, ULONG64 *cyc, double *usr, double *ker,
                   ULONG64 *rd, ULONG64 *wr, ULONG64 *ot, ULONG64 *pf) {
  ULONG64 c = 0;
  if (pQPCT != NULL) pQPCT(h, &c);
  *cyc = c;
  FILETIME cr, ex, kf, uf;
  if (GetProcessTimes(h, &cr, &ex, &kf, &uf)) { *ker = ft_ms(kf); *usr = ft_ms(uf); }
  else { *ker = 0; *usr = 0; }
  IO_COUNTERS io;
  if (GetProcessIoCounters(h, &io)) {
    *rd = io.ReadOperationCount; *wr = io.WriteOperationCount; *ot = io.OtherOperationCount;
  } else { *rd = 0; *wr = 0; *ot = 0; }
  *pf = 0;
  if (pGPMI != NULL) {
    unsigned char blob[128];
    PMC_FULL *m = (PMC_FULL *)blob;
    memset(blob, 0, sizeof blob);
    m->cb = (DWORD)sizeof blob;
    if (pGPMI(h, blob, (DWORD)sizeof blob)) *pf = m->PageFaultCount;
  }
}

static void mark(HANDLE h, const char *name, int begin) {
  for (int i = 0; i < nph; i++) {
    if (strcmp(ph[i].name, name) == 0 && ph[i].open && !begin) {
      sample(h, &ph[i].cyc1, &ph[i].usr1, &ph[i].ker1,
             &ph[i].rd1, &ph[i].wr1, &ph[i].ot1, &ph[i].pf1);
      ph[i].wall1 = now_ms(); ph[i].open = 0; ph[i].done = 1; return;
    }
  }
  if (!begin || nph >= MAXPH) return;
  Phase *p = &ph[nph++];
  memset(p, 0, sizeof *p);
  strncpy(p->name, name, sizeof p->name - 1);
  sample(h, &p->cyc0, &p->usr0, &p->ker0, &p->rd0, &p->wr0, &p->ot0, &p->pf0);
  p->wall0 = now_ms(); p->open = 1;
}

#define MAXSAMP 400000
typedef struct { double t; ULONG64 ws, peak, pf; } Samp;
static Samp samp[MAXSAMP];
static volatile LONG nsamp;
static volatile LONG pollStop;
static HANDLE pollTarget;

static DWORD WINAPI poller(LPVOID unused) {
  (void)unused;
  while (!pollStop) {
    unsigned char blob[128];
    PMC_FULL *m = (PMC_FULL *)blob;
    memset(blob, 0, sizeof blob);
    m->cb = (DWORD)sizeof blob;
    if (pGPMI != NULL && pGPMI(pollTarget, blob, (DWORD)sizeof blob)) {
      LONG i = nsamp;
      if (i < MAXSAMP) {
        samp[i].t = now_ms();
        samp[i].ws = (ULONG64)m->WorkingSetSize;
        samp[i].peak = (ULONG64)m->PeakWorkingSetSize;
        samp[i].pf = m->PageFaultCount;
        nsamp = i + 1;
      }
    }
    Sleep(2);
  }
  return 0;
}

int main(int argc, char **argv) {
  HMODULE k = GetModuleHandleW(L"kernel32.dll");
  pQPCT = (QPCT)(void *)GetProcAddress(k, "QueryProcessCycleTime");
  {
    HMODULE ps = LoadLibraryW(L"psapi.dll");
    if (ps != NULL) pGPMI = (GPMI)(void *)GetProcAddress(ps, "GetProcessMemoryInfo");
    if (pGPMI == NULL) pGPMI = (GPMI)(void *)GetProcAddress(k, "K32GetProcessMemoryInfo");
  }
  if (pQPCT == NULL) { fprintf(stderr, "cpuphase: no QueryProcessCycleTime\n"); return 2; }

  int i = 1;
  if (i < argc && strcmp(argv[i], "--") == 0) i++;
  if (i >= argc) { fprintf(stderr, "usage: cpuphase.exe -- <cmd> [args...]\n"); return 2; }

  size_t need = 1;
  for (int j = i; j < argc; j++) need += strlen(argv[j]) + 3;
  char *cmd = (char *)calloc(need, 1);
  for (int j = i; j < argc; j++) {
    if (j > i) strcat(cmd, " ");
    int q = (strchr(argv[j], ' ') != NULL);
    if (q) strcat(cmd, "\"");
    strcat(cmd, argv[j]);
    if (q) strcat(cmd, "\"");
  }

  SECURITY_ATTRIBUTES sa = {sizeof sa, NULL, TRUE};
  HANDLE rd, wr;
  if (!CreatePipe(&rd, &wr, &sa, 1 << 20)) { fprintf(stderr, "cpuphase: pipe failed\n"); return 2; }
  SetHandleInformation(rd, HANDLE_FLAG_INHERIT, 0);

  STARTUPINFOA si; memset(&si, 0, sizeof si); si.cb = sizeof si;
  si.dwFlags = STARTF_USESTDHANDLES;
  si.hStdOutput = wr;
  si.hStdError = GetStdHandle(STD_ERROR_HANDLE);
  si.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
  PROCESS_INFORMATION pi;
  if (!CreateProcessA(NULL, cmd, NULL, NULL, TRUE, 0, NULL, NULL, &si, &pi)) {
    fprintf(stderr, "cpuphase: CreateProcess failed (%lu)\n", (unsigned long)GetLastError());
    return 2;
  }
  CloseHandle(wr);
  pollTarget = pi.hProcess;
  HANDLE pollThread = CreateThread(NULL, 0, poller, NULL, 0, NULL);

  char buf[8192], line[4096];
  size_t ll = 0;
  DWORD got;
  while (ReadFile(rd, buf, sizeof buf, &got, NULL) && got > 0) {
    fwrite(buf, 1, got, stdout);
    for (DWORD b = 0; b < got; b++) {
      char ch = buf[b];
      if (ch == '\n' || ll == sizeof line - 1) {
        line[ll] = 0;
        char *m;
        if ((m = strstr(line, "[phase-begin] ")) != NULL) mark(pi.hProcess, m + 14, 1);
        else if ((m = strstr(line, "[phase-end] ")) != NULL) mark(pi.hProcess, m + 12, 0);
        ll = 0;
      } else if (ch != '\r') line[ll++] = ch;
    }
    fflush(stdout);
  }
  WaitForSingleObject(pi.hProcess, INFINITE);
  pollStop = 1;
  if (pollThread != NULL) { WaitForSingleObject(pollThread, 2000); CloseHandle(pollThread); }
  DWORD code = 0; GetExitCodeProcess(pi.hProcess, &code);

  fprintf(stderr, "\n[cpuphase] %-14s %10s %10s %9s %9s %9s %7s %9s %9s %10s %11s\n",
          "phase", "wall_ms", "Mcycles", "user_ms", "kern_ms", "cpu_ms", "cpu%", "ioRead", "ioWrite", "ioOther", "pageFaults");
  for (int j = 0; j < nph; j++) {
    if (!ph[j].done) continue;
    double wall = ph[j].wall1 - ph[j].wall0;
    double usr = ph[j].usr1 - ph[j].usr0, ker = ph[j].ker1 - ph[j].ker0;
    double cpu = usr + ker;
    double mc = (double)(ph[j].cyc1 - ph[j].cyc0) / 1e6;
    fprintf(stderr,
            "[cpuphase] %-14s %10.0f %10.1f %9.1f %9.1f %9.1f %6.1f%% %9llu %9llu %10llu %11llu\n",
            ph[j].name, wall, mc, usr, ker, cpu, wall > 0 ? cpu / wall * 100.0 : 0.0,
            (unsigned long long)(ph[j].rd1 - ph[j].rd0),
            (unsigned long long)(ph[j].wr1 - ph[j].wr0),
            (unsigned long long)(ph[j].ot1 - ph[j].ot0),
            (unsigned long long)(ph[j].pf1 - ph[j].pf0));
  }
  /* ---- memory, from the polled samples ------------------------------
   * Sampling at the phase markers alone would miss both halves of the
   * story: what is resident BEFORE the first marker (the floor), and the
   * spike-and-release inside a phase. */
  {
    LONG n = nsamp;
    if (n > 0) {
      ULONG64 peak = 0, first = samp[0].ws, last = samp[n - 1].ws;
      for (LONG i = 0; i < n; i++) if (samp[i].ws > peak) peak = samp[i].ws;
      double MB = 1048576.0;
      fprintf(stderr, "\n[cpumem] samples=%ld  firstRSS=%.2f MiB  peakRSS=%.2f MiB  "
              "finalRSS=%.2f MiB  peakWS(os)=%.2f MiB  totalFaults=%llu\n",
              (long)n, first / MB, peak / MB, last / MB,
              samp[n - 1].peak / MB, (unsigned long long)(samp[n - 1].pf - samp[0].pf));
      /* SCR_CPUPHASE_TRACE=<ms>: the WHOLE run at that resolution, not just
       * the first 1.5 s. The startup window below was enough while the
       * question was the floor; it is not enough for "where are the faults
       * taken", which needs to see whether RSS oscillates (trim and refault)
       * or grows once and drops once. */
      {
        const char *tr = getenv("SCR_CPUPHASE_TRACE");
        if (tr != NULL && *tr != 0) {
          double step = atof(tr); double at = 0; double b0 = samp[0].t;
          ULONG64 pf0 = samp[0].pf, prevpf = samp[0].pf;
          if (step <= 0) step = 100;
          fprintf(stderr, "[cputrace] %8s %9s %12s %13s %14s\n",
                  "ms", "rssMiB", "faultsTot", "faultsStep", "rssDeltaKiB");
          for (LONG i = 0; i < n; i++) {
            double dt = samp[i].t - b0;
            if (dt < at && i != n - 1) continue;
            fprintf(stderr, "[cputrace] %8.0f %9.2f %12llu %13lld %14.0f\n", dt,
                    samp[i].ws / MB, (unsigned long long)(samp[i].pf - pf0),
                    (long long)(samp[i].pf - prevpf),
                    ((double)samp[i].ws - (double)(i ? samp[i - 1].ws : samp[i].ws)) / 1024.0);
            prevpf = samp[i].pf; at = dt + step;
          }
        }
      }
      fprintf(stderr, "[cpumem] startup trajectory (ms -> RSS MiB, faults):\n");
      double t0 = samp[0].t;
      double nextAt = 0;
      for (LONG i = 0; i < n; i++) {
        double dt = samp[i].t - t0;
        if (dt < nextAt) continue;
        if (dt > 1500) break;
        fprintf(stderr, "[cpumem]   %6.0f  %8.2f  %10llu\n", dt, samp[i].ws / MB,
                (unsigned long long)(samp[i].pf - samp[0].pf));
        nextAt = dt + 50;
      }
      fprintf(stderr, "[cpumem] %-14s %10s %10s %10s %12s\n",
              "phase", "rssBegin", "rssMax", "rssEnd", "faults");
      for (int j = 0; j < nph; j++) {
        if (!ph[j].done) continue;
        ULONG64 mx = 0, b = 0, e = 0; int seen = 0;
        for (LONG i = 0; i < n; i++) {
          if (samp[i].t < ph[j].wall0 || samp[i].t > ph[j].wall1) continue;
          if (!seen) { b = samp[i].ws; seen = 1; }
          if (samp[i].ws > mx) mx = samp[i].ws;
          e = samp[i].ws;
        }
        fprintf(stderr, "[cpumem] %-14s %10.2f %10.2f %10.2f %12llu\n",
                ph[j].name, b / MB, mx / MB, e / MB,
                (unsigned long long)(ph[j].pf1 - ph[j].pf0));
      }
    }
  }
  CloseHandle(pi.hProcess); CloseHandle(pi.hThread);
  return (int)code;
}
