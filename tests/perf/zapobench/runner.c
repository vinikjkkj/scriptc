/* runner.c — the ONE memory/CPU instrument for both lanes.
 *
 *   runner.exe <outfile.json> <child.exe> [args...]
 *
 * Starts the child with INHERITED stdio (so a parent driver's pipes reach it
 * untouched), waits for it, then reads the kernel's own counters for that
 * child from OUTSIDE the process:
 *
 *   PeakWorkingSetSize   -- K32GetProcessMemoryInfo. This is the TOTAL working
 *                           set high-water mark, private + file-backed.
 *                           Task Manager's default "Memory" column shows the
 *                           PRIVATE working set and reads LOWER.
 *   user+kernel CPU      -- GetProcessTimes, 100ns units.
 *   wall                 -- QueryPerformanceCounter around the whole wait.
 *
 * The point of running BOTH lanes through this one binary is that node.exe and
 * a scriptc-compiled exe are then measured by the same counter, read the same
 * way, by the same code. runner exits with the child's exit code.
 */
#include <windows.h>
#include <psapi.h>
#include <stdio.h>
#include <string.h>

static void quote_arg(char *dst, size_t cap, const char *a) {
  /* Always quote; escape embedded quotes and trailing backslashes. */
  size_t n = 0;
  if (n < cap) dst[n++] = '"';
  for (const char *p = a; *p; p++) {
    if (*p == '"') { if (n < cap) dst[n++] = '\\'; }
    if (n < cap) dst[n++] = *p;
  }
  if (n < cap) dst[n++] = '"';
  if (n < cap) dst[n] = 0; else dst[cap - 1] = 0;
}

int main(int argc, char **argv) {
  if (argc < 3) {
    fprintf(stderr, "usage: runner <out.json> <child.exe> [args...]\n");
    return 2;
  }
  const char *out = argv[1];

  static char cmd[32768];
  size_t cl = 0;
  for (int i = 2; i < argc; i++) {
    static char q[8192];
    quote_arg(q, sizeof q, argv[i]);
    size_t ql = strlen(q);
    if (cl + ql + 2 >= sizeof cmd) { fprintf(stderr, "runner: command line too long\n"); return 2; }
    if (i > 2) cmd[cl++] = ' ';
    memcpy(cmd + cl, q, ql); cl += ql;
  }
  cmd[cl] = 0;

  STARTUPINFOA si; PROCESS_INFORMATION pi;
  ZeroMemory(&si, sizeof si); si.cb = sizeof si;
  si.dwFlags = STARTF_USESTDHANDLES;
  si.hStdInput  = GetStdHandle(STD_INPUT_HANDLE);
  si.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
  si.hStdError  = GetStdHandle(STD_ERROR_HANDLE);
  ZeroMemory(&pi, sizeof pi);

  LARGE_INTEGER freq, t0, t1;
  QueryPerformanceFrequency(&freq);
  QueryPerformanceCounter(&t0);

  if (!CreateProcessA(NULL, cmd, NULL, NULL, TRUE, 0, NULL, NULL, &si, &pi)) {
    fprintf(stderr, "runner: CreateProcess failed err=%lu cmd=%s\n", GetLastError(), cmd);
    return 2;
  }
  WaitForSingleObject(pi.hProcess, INFINITE);
  QueryPerformanceCounter(&t1);

  DWORD code = 0; GetExitCodeProcess(pi.hProcess, &code);

  PROCESS_MEMORY_COUNTERS pmc; ZeroMemory(&pmc, sizeof pmc); pmc.cb = sizeof pmc;
  BOOL memOk = K32GetProcessMemoryInfo(pi.hProcess, &pmc, sizeof pmc);

  FILETIME ftC, ftE, ftK, ftU;
  BOOL timeOk = GetProcessTimes(pi.hProcess, &ftC, &ftE, &ftK, &ftU);
  unsigned long long k100 = 0, u100 = 0;
  if (timeOk) {
    k100 = ((unsigned long long)ftK.dwHighDateTime << 32) | ftK.dwLowDateTime;
    u100 = ((unsigned long long)ftU.dwHighDateTime << 32) | ftU.dwLowDateTime;
  }
  double wallMs = (double)(t1.QuadPart - t0.QuadPart) * 1000.0 / (double)freq.QuadPart;

  FILE *f = fopen(out, "w");
  if (f) {
    fprintf(f,
      "{\"pid\":%lu,\"exit\":%lu,\"memOk\":%d,\"timeOk\":%d,"
      "\"peakWorkingSetBytes\":%llu,\"workingSetAtExitBytes\":%llu,"
      "\"peakPagefileBytes\":%llu,\"pagefileAtExitBytes\":%llu,"
      "\"pageFaults\":%lu,"
      "\"cpuUserMs\":%.4f,\"cpuKernelMs\":%.4f,\"cpuTotalMs\":%.4f,"
      "\"wallMs\":%.3f,\"cmd\":\"runner\"}\n",
      (unsigned long)pi.dwProcessId, (unsigned long)code, memOk ? 1 : 0, timeOk ? 1 : 0,
      (unsigned long long)pmc.PeakWorkingSetSize, (unsigned long long)pmc.WorkingSetSize,
      (unsigned long long)pmc.PeakPagefileUsage, (unsigned long long)pmc.PagefileUsage,
      (unsigned long)pmc.PageFaultCount,
      (double)u100 / 10000.0, (double)k100 / 10000.0, (double)(u100 + k100) / 10000.0,
      wallMs);
    fclose(f);
  } else {
    fprintf(stderr, "runner: cannot write %s\n", out);
  }
  CloseHandle(pi.hThread); CloseHandle(pi.hProcess);
  return (int)code;
}
