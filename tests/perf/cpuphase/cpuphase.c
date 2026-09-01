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
static void sample(HANDLE h, ULONG64 *cyc, double *usr, double *ker) {
  ULONG64 c = 0;
  if (pQPCT != NULL) pQPCT(h, &c);
  *cyc = c;
  FILETIME cr, ex, kf, uf;
  if (GetProcessTimes(h, &cr, &ex, &kf, &uf)) { *ker = ft_ms(kf); *usr = ft_ms(uf); }
  else { *ker = 0; *usr = 0; }
}

static void mark(HANDLE h, const char *name, int begin) {
  for (int i = 0; i < nph; i++) {
    if (strcmp(ph[i].name, name) == 0 && ph[i].open && !begin) {
      sample(h, &ph[i].cyc1, &ph[i].usr1, &ph[i].ker1);
      ph[i].wall1 = now_ms(); ph[i].open = 0; ph[i].done = 1; return;
    }
  }
  if (!begin || nph >= MAXPH) return;
  Phase *p = &ph[nph++];
  memset(p, 0, sizeof *p);
  strncpy(p->name, name, sizeof p->name - 1);
  sample(h, &p->cyc0, &p->usr0, &p->ker0);
  p->wall0 = now_ms(); p->open = 1;
}

int main(int argc, char **argv) {
  HMODULE k = GetModuleHandleW(L"kernel32.dll");
  pQPCT = (QPCT)(void *)GetProcAddress(k, "QueryProcessCycleTime");
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
  DWORD code = 0; GetExitCodeProcess(pi.hProcess, &code);

  fprintf(stderr, "\n[cpuphase] %-14s %10s %10s %9s %9s %9s %7s\n",
          "phase", "wall_ms", "Mcycles", "user_ms", "kern_ms", "cpu_ms", "cpu%");
  for (int j = 0; j < nph; j++) {
    if (!ph[j].done) continue;
    double wall = ph[j].wall1 - ph[j].wall0;
    double usr = ph[j].usr1 - ph[j].usr0, ker = ph[j].ker1 - ph[j].ker0;
    double cpu = usr + ker;
    double mc = (double)(ph[j].cyc1 - ph[j].cyc0) / 1e6;
    fprintf(stderr, "[cpuphase] %-14s %10.0f %10.1f %9.1f %9.1f %9.1f %6.1f%%\n",
            ph[j].name, wall, mc, usr, ker, cpu, wall > 0 ? cpu / wall * 100.0 : 0.0);
  }
  CloseHandle(pi.hProcess); CloseHandle(pi.hThread);
  return (int)code;
}
