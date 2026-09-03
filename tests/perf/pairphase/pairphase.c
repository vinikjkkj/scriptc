/*
 * pairphase.c - cpuphase, plus the FAKE SERVER's own per-phase cost.
 *
 * cpuphase.exe samples the direct child only (no job object), so on this
 * bench its cycle and RSS columns are CLIENT-ONLY while wall is real
 * end-to-end. That is exactly what makes `send_1to1` unreadable: the phase
 * sits at 1.28x node's wall on 0.84x node's cycles, and the missing time
 * is either in the server child or in the socket between them -- neither
 * of which cpuphase can see.
 *
 * This tool is cpuphase.c with one addition: a discovery thread walks the
 * process table for children of the bench process (the fake server is
 * spawned as BENCH_NODE -> node.exe) and opens a handle to each. At every
 * [phase-begin] / [phase-end] marker on the CLIENT's stdout, BOTH the
 * client and every discovered server child are sampled. The server's
 * per-phase cycles, user/kernel split and IO operation counts then line up
 * with the client's on the same phase boundaries.
 *
 * IO counters are the read/write pattern instrument. ReadOperationCount /
 * WriteOperationCount / OtherOperationCount are per-OPERATION, so a client
 * that issues two writes per WebSocket frame where node issues one shows
 * as 2x ioWrite for the same bytes.
 *
 *   pairphase.exe -- <cmd> [args...]
 *
 * Output: [cpuphase]/[cpumem] exactly as cpuphase (same column order, so
 * the existing parsers read it unchanged), then [srvphase] per server pid.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <windows.h>
#include <tlhelp32.h>

typedef BOOL(WINAPI *QPCT)(HANDLE, PULONG64);
static QPCT pQPCT;

#define MAXKID 8
typedef struct { DWORD pid; HANDLE h; char name[64]; } Kid;
static Kid kid[MAXKID];
static volatile LONG nkid;
static DWORD parentPid;
static volatile LONG scanStop;

#define MAXPH 64
typedef struct {
  ULONG64 cyc0, cyc1;
  double usr0, usr1, ker0, ker1;
  ULONG64 rd0, rd1, wr0, wr1, ot0, ot1;
  ULONG64 pf0, pf1;
  int have0, have1;
} Ctr;
typedef struct {
  char name[64];
  Ctr c;                 /* client (direct child) */
  Ctr s[MAXKID];         /* server children, by kid index */
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
  return (double)u.QuadPart / 10000.0;
}
typedef BOOL(WINAPI *GPMI)(HANDLE, void *, DWORD);
static GPMI pGPMI;
typedef struct {
  DWORD cb; DWORD PageFaultCount; SIZE_T PeakWorkingSetSize; SIZE_T WorkingSetSize; SIZE_T rest[6];
} PMC_FULL;

static int sample_into(HANDLE h, ULONG64 *cyc, double *usr, double *ker,
                       ULONG64 *rd, ULONG64 *wr, ULONG64 *ot, ULONG64 *pf) {
  if (h == NULL) return 0;
  ULONG64 c = 0;
  if (pQPCT != NULL && !pQPCT(h, &c)) c = 0;
  *cyc = c;
  FILETIME cr, ex, kf, uf;
  if (GetProcessTimes(h, &cr, &ex, &kf, &uf)) { *ker = ft_ms(kf); *usr = ft_ms(uf); }
  else { *ker = 0; *usr = 0; }
  IO_COUNTERS io;
  if (GetProcessIoCounters(h, &io)) { *rd = io.ReadOperationCount; *wr = io.WriteOperationCount; *ot = io.OtherOperationCount; }
  else { *rd = 0; *wr = 0; *ot = 0; }
  *pf = 0;
  if (pGPMI != NULL) {
    unsigned char blob[128]; PMC_FULL *m = (PMC_FULL *)blob;
    memset(blob, 0, sizeof blob); m->cb = (DWORD)sizeof blob;
    if (pGPMI(h, blob, (DWORD)sizeof blob)) *pf = m->PageFaultCount;
  }
  return 1;
}
static void snap(Ctr *t, HANDLE h, int end) {
  ULONG64 cyc, rd, wr, ot, pf; double usr, ker;
  if (!sample_into(h, &cyc, &usr, &ker, &rd, &wr, &ot, &pf)) return;
  if (end) { t->cyc1=cyc; t->usr1=usr; t->ker1=ker; t->rd1=rd; t->wr1=wr; t->ot1=ot; t->pf1=pf; t->have1=1; }
  else     { t->cyc0=cyc; t->usr0=usr; t->ker0=ker; t->rd0=rd; t->wr0=wr; t->ot0=ot; t->pf0=pf; t->have0=1; }
}

/* Walk the process table for children of the bench process. Runs in its
 * own thread because the server child appears only after the bench starts
 * and may be re-spawned; a one-shot scan at t0 would find nothing. */
static DWORD WINAPI scanner(LPVOID unused) {
  (void)unused;
  while (!scanStop) {
    HANDLE snapsh = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snapsh != INVALID_HANDLE_VALUE) {
      PROCESSENTRY32 pe; pe.dwSize = sizeof pe;
      if (Process32First(snapsh, &pe)) {
        do {
          if (pe.th32ParentProcessID != parentPid) continue;
          int known = 0;
          for (LONG i = 0; i < nkid; i++) if (kid[i].pid == pe.th32ProcessID) { known = 1; break; }
          if (known) continue;
          if (nkid >= MAXKID) continue;
          HANDLE h = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, FALSE, pe.th32ProcessID);
          if (h == NULL) h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pe.th32ProcessID);
          if (h == NULL) continue;
          LONG i = nkid;
          kid[i].pid = pe.th32ProcessID;
          strncpy(kid[i].name, pe.szExeFile, sizeof kid[i].name - 1);
          kid[i].h = h;
          nkid = i + 1;
          /* A child discovered while a phase is already open gets its
           * baseline HERE, not at the phase marker it missed: without
           * this the phase reads n/a for that child forever. The phase
           * then under-counts by whatever the child did before discovery
           * (bounded by the 25 ms scan interval). */
          for (int q = 0; q < nph; q++) if (ph[q].open) snap(&ph[q].s[i], h, 0);
          fprintf(stderr, "[srvphase] discovered child pid=%lu %s\n",
                  (unsigned long)pe.th32ProcessID, pe.szExeFile);
        } while (Process32Next(snapsh, &pe));
      }
      CloseHandle(snapsh);
    }
    Sleep(25);
  }
  return 0;
}

static HANDLE clientH;
static void mark(const char *name, int begin) {
  for (int i = 0; i < nph; i++) {
    if (strcmp(ph[i].name, name) == 0 && ph[i].open && !begin) {
      snap(&ph[i].c, clientH, 1);
      for (LONG j = 0; j < nkid; j++) snap(&ph[i].s[j], kid[j].h, 1);
      ph[i].wall1 = now_ms(); ph[i].open = 0; ph[i].done = 1; return;
    }
  }
  if (!begin || nph >= MAXPH) return;
  Phase *p = &ph[nph++];
  memset(p, 0, sizeof *p);
  strncpy(p->name, name, sizeof p->name - 1);
  snap(&p->c, clientH, 0);
  for (LONG j = 0; j < nkid; j++) snap(&p->s[j], kid[j].h, 0);
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
    unsigned char blob[128]; PMC_FULL *m = (PMC_FULL *)blob;
    memset(blob, 0, sizeof blob); m->cb = (DWORD)sizeof blob;
    if (pGPMI != NULL && pGPMI(pollTarget, blob, (DWORD)sizeof blob)) {
      LONG i = nsamp;
      if (i < MAXSAMP) { samp[i].t = now_ms(); samp[i].ws = (ULONG64)m->WorkingSetSize;
        samp[i].peak = (ULONG64)m->PeakWorkingSetSize; samp[i].pf = m->PageFaultCount; nsamp = i + 1; }
    }
    Sleep(2);
  }
  return 0;
}

int main(int argc, char **argv) {
  HMODULE k = GetModuleHandleW(L"kernel32.dll");
  pQPCT = (QPCT)(void *)GetProcAddress(k, "QueryProcessCycleTime");
  { HMODULE ps = LoadLibraryW(L"psapi.dll");
    if (ps != NULL) pGPMI = (GPMI)(void *)GetProcAddress(ps, "GetProcessMemoryInfo");
    if (pGPMI == NULL) pGPMI = (GPMI)(void *)GetProcAddress(k, "K32GetProcessMemoryInfo"); }
  if (pQPCT == NULL) { fprintf(stderr, "pairphase: no QueryProcessCycleTime\n"); return 2; }

  int i = 1;
  if (i < argc && strcmp(argv[i], "--") == 0) i++;
  if (i >= argc) { fprintf(stderr, "usage: pairphase.exe -- <cmd> [args...]\n"); return 2; }
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
  if (!CreatePipe(&rd, &wr, &sa, 1 << 20)) { fprintf(stderr, "pairphase: pipe failed\n"); return 2; }
  SetHandleInformation(rd, HANDLE_FLAG_INHERIT, 0);
  STARTUPINFOA si; memset(&si, 0, sizeof si); si.cb = sizeof si;
  si.dwFlags = STARTF_USESTDHANDLES;
  si.hStdOutput = wr; si.hStdError = GetStdHandle(STD_ERROR_HANDLE); si.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
  PROCESS_INFORMATION pi;
  if (!CreateProcessA(NULL, cmd, NULL, NULL, TRUE, 0, NULL, NULL, &si, &pi)) {
    fprintf(stderr, "pairphase: CreateProcess failed (%lu)\n", (unsigned long)GetLastError()); return 2; }
  CloseHandle(wr);
  clientH = pi.hProcess; pollTarget = pi.hProcess; parentPid = pi.dwProcessId;
  HANDLE pollThread = CreateThread(NULL, 0, poller, NULL, 0, NULL);
  HANDLE scanThread = CreateThread(NULL, 0, scanner, NULL, 0, NULL);

  char buf[8192], line[4096];
  size_t ll = 0; DWORD got;
  while (ReadFile(rd, buf, sizeof buf, &got, NULL) && got > 0) {
    fwrite(buf, 1, got, stdout);
    for (DWORD b = 0; b < got; b++) {
      char ch = buf[b];
      if (ch == '\n' || ll == sizeof line - 1) {
        line[ll] = 0; char *m;
        if ((m = strstr(line, "[phase-begin] ")) != NULL) mark(m + 14, 1);
        else if ((m = strstr(line, "[phase-end] ")) != NULL) mark(m + 12, 0);
        ll = 0;
      } else if (ch != '\r') line[ll++] = ch;
    }
    fflush(stdout);
  }
  WaitForSingleObject(pi.hProcess, INFINITE);
  pollStop = 1; scanStop = 1;
  if (pollThread != NULL) { WaitForSingleObject(pollThread, 2000); CloseHandle(pollThread); }
  if (scanThread != NULL) { WaitForSingleObject(scanThread, 2000); CloseHandle(scanThread); }
  DWORD code = 0; GetExitCodeProcess(pi.hProcess, &code);

  fprintf(stderr, "\n[cpuphase] %-14s %10s %10s %9s %9s %9s %7s %9s %9s %10s %11s\n",
          "phase", "wall_ms", "Mcycles", "user_ms", "kern_ms", "cpu_ms", "cpu%", "ioRead", "ioWrite", "ioOther", "pageFaults");
  for (int j = 0; j < nph; j++) {
    if (!ph[j].done) continue;
    Ctr *c = &ph[j].c;
    double wall = ph[j].wall1 - ph[j].wall0;
    double usr = c->usr1 - c->usr0, ker = c->ker1 - c->ker0, cpu = usr + ker;
    double mc = (double)(c->cyc1 - c->cyc0) / 1e6;
    fprintf(stderr, "[cpuphase] %-14s %10.0f %10.1f %9.1f %9.1f %9.1f %6.1f%% %9llu %9llu %10llu %11llu\n",
            ph[j].name, wall, mc, usr, ker, cpu, wall > 0 ? cpu / wall * 100.0 : 0.0,
            (unsigned long long)(c->rd1 - c->rd0), (unsigned long long)(c->wr1 - c->wr0),
            (unsigned long long)(c->ot1 - c->ot0), (unsigned long long)(c->pf1 - c->pf0));
  }
  fprintf(stderr, "\n[srvphase] server children discovered: %ld\n", (long)nkid);
  for (LONG kx = 0; kx < nkid; kx++) {
    fprintf(stderr, "[srvphase] pid=%lu %s\n", (unsigned long)kid[kx].pid, kid[kx].name);
    fprintf(stderr, "[srvphase] %-14s %10s %10s %9s %9s %9s %7s %9s %9s %10s %11s\n",
            "phase", "wall_ms", "Mcycles", "user_ms", "kern_ms", "cpu_ms", "cpu%", "ioRead", "ioWrite", "ioOther", "pageFaults");
    for (int j = 0; j < nph; j++) {
      if (!ph[j].done) continue;
      Ctr *s = &ph[j].s[kx];
      if (!s->have0 || !s->have1) { fprintf(stderr, "[srvphase] %-14s %10s\n", ph[j].name, "n/a"); continue; }
      double wall = ph[j].wall1 - ph[j].wall0;
      double usr = s->usr1 - s->usr0, ker = s->ker1 - s->ker0, cpu = usr + ker;
      double mc = (double)(s->cyc1 - s->cyc0) / 1e6;
      fprintf(stderr, "[srvphase] %-14s %10.0f %10.1f %9.1f %9.1f %9.1f %6.1f%% %9llu %9llu %10llu %11llu\n",
              ph[j].name, wall, mc, usr, ker, cpu, wall > 0 ? cpu / wall * 100.0 : 0.0,
              (unsigned long long)(s->rd1 - s->rd0), (unsigned long long)(s->wr1 - s->wr0),
              (unsigned long long)(s->ot1 - s->ot0), (unsigned long long)(s->pf1 - s->pf0));
    }
  }
  /* memory: same shape as cpuphase, client only */
  if (nsamp > 0) {
    ULONG64 first = samp[0].ws, peak = 0, last = samp[nsamp-1].ws, peakOs = 0, pfTot = samp[nsamp-1].pf;
    for (LONG j = 0; j < nsamp; j++) { if (samp[j].ws > peak) peak = samp[j].ws; if (samp[j].peak > peakOs) peakOs = samp[j].peak; }
    const double MB = 1024.0 * 1024.0;
    fprintf(stderr, "\n[cpumem] samples=%ld  firstRSS=%.2f MiB  peakRSS=%.2f MiB  finalRSS=%.2f MiB  peakWS(os)=%.2f MiB  totalFaults=%llu\n",
            (long)nsamp, first/MB, peak/MB, last/MB, peakOs/MB, (unsigned long long)pfTot);
    fprintf(stderr, "[cpumem] %-14s %10s %10s %10s %12s\n", "phase", "beginRSS", "maxRSS", "endRSS", "faults");
    for (int j = 0; j < nph; j++) {
      if (!ph[j].done) continue;
      ULONG64 b = 0, mx = 0, e = 0; int seen = 0;
      for (LONG q = 0; q < nsamp; q++) {
        if (samp[q].t < ph[j].wall0 || samp[q].t > ph[j].wall1) continue;
        if (!seen) { b = samp[q].ws; seen = 1; }
        if (samp[q].ws > mx) mx = samp[q].ws;
        e = samp[q].ws;
      }
      if (!seen) continue;
      fprintf(stderr, "[cpumem] %-14s %10.2f %10.2f %10.2f %12llu\n", ph[j].name, b/MB, mx/MB, e/MB,
              (unsigned long long)(ph[j].c.pf1 - ph[j].c.pf0));
    }
  }
  fprintf(stderr, "[pairphase] child exit=%lu\n", (unsigned long)code);
  return (int)code;
}
