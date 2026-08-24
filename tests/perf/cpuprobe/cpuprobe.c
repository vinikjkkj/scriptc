/*
 * cpuprobe.c - an EXTERNAL CPU instrument for one child process.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every CPU number this repo has ever printed came from process.cpuUsage(),
 * which is GetProcessTimes() on both lanes (packages/runtime/src/scr_lib.c
 * and libuv's uv_getrusage). GetProcessTimes does not measure CPU time. It
 * reports a COUNT OF SCHEDULER TICKS CHARGED, and a tick is charged in full
 * to whichever thread the timer interrupt happened to catch. Measured on
 * this host, one time-boxed messaging run:
 *
 *     cpuTimeMs = 1828.125  1937.5  2171.875  1984.375
 *
 * which is 117, 124, 139 and 127 times 15.625 ms, integers with no
 * remainder. Two things follow and both matter:
 *
 *   1. QUANTIZATION. The counter cannot express anything finer than
 *      15.625 ms, so a 2000 ms scenario carries +-0.4% of granularity
 *      before any real variance.
 *   2. SAMPLING NOISE, which is the larger term and the less obvious one.
 *      Ticks charged is a BINOMIAL SAMPLE, not a measurement: over n ticks
 *      of wall time with the process on-CPU a fraction p of the time, the
 *      charged count has variance n*p*(1-p). On a contended host p falls
 *      and the estimator gets noisier exactly when you need it most.
 *
 * QueryProcessCycleTime has neither property. It reads the per-thread cycle
 * accumulator the kernel maintains from the invariant TSC, summed over the
 * process's threads, and it is exact to the context switch rather than to
 * the tick. That is the whole idea here.
 *
 * WHAT IT MEASURES AND WHAT IT DOES NOT
 * -------------------------------------
 * cycles      QueryProcessCycleTime. Because Windows derives it from the
 *             INVARIANT TSC, it is proportional to TIME SPENT ON A CORE and
 *             NOT to instructions retired. A core running at a lower clock
 *             therefore reports MORE cycles for identical work. This is a
 *             high-resolution CPU-TIME counter, not a hardware performance
 *             counter, and calling it "cycles" the way the API does should
 *             not be read as a claim about the work done. Frequency
 *             scaling is a real noise term in it, as it is in
 *             GetProcessTimes, and the driver's min-of-N estimator exists
 *             partly to bound it.
 * userUs      GetProcessTimes, kept ONLY so the new counter can be checked
 * kernelUs    against the old one. Tick-quantized, as above.
 * peakWSkb    PeakWorkingSetSize read from OUTSIDE the process, so it does
 *             not depend on the child reporting honestly.
 * wallNs      QueryPerformanceCounter around CreateProcess/exit.
 *
 * FAIRNESS KNOBS, applied identically to every arm or not at all:
 *   --affinity 0xMASK   SetProcessAffinityMask before the child runs a
 *                       single instruction (it is created SUSPENDED).
 *   --priority N        0 normal, 1 above-normal, 2 high. Preemption by
 *                       the rest of the box is the dominant noise term on
 *                       a loaded host; raising the class does not make the
 *                       code faster, it makes the MEASUREMENT quieter.
 *   --poll-us N         how often to sample the cycle counter while the
 *                       child runs. 0 disables polling entirely and relies
 *                       on the post-exit read.
 *
 * THE POST-EXIT READ, and why it is checked rather than assumed:
 * a handle to an exited process still names a live kernel object, and both
 * GetProcessTimes and QueryProcessCycleTime may or may not answer for one.
 * GetProcessTimes documents that it does. QueryProcessCycleTime does not
 * say. So this program reads it BOTH ways - polled while running, and once
 * after WaitForSingleObject returns - and prints both, letting the driver
 * see whether they agree instead of trusting either. If the post-exit read
 * works, the polling loop is unnecessary and its (small) cost goes away.
 *
 * Output goes to STDERR, one line, so the child's stdout protocol reaches
 * the driver untouched; the child inherits our stdout handle directly, so
 * there is no pipe between it and the driver and nothing to buffer.
 *
 * Build:  node tests/perf/cpuprobe/build.mjs
 * Runner: tests/perf/ab-cpu.mjs   (nothing else uses it)
 */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <psapi.h>
#include <mmsystem.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>

typedef BOOL(WINAPI *QPCT)(HANDLE, PULONG64);

static QPCT g_qpct = NULL;

/* Resolved at run time rather than link time: QueryProcessCycleTime lives
 * in kernel32 on every Windows this project targets, but a mingw import
 * library that lacks the stub would fail the LINK, and a link failure in a
 * measurement tool is indistinguishable from "the tool is not built yet"
 * three commands later. A missing symbol here is reported as data. */
static void resolve_qpct(void) {
  HMODULE k = GetModuleHandleW(L"kernel32.dll");
  if (k) g_qpct = (QPCT)(void *)GetProcAddress(k, "QueryProcessCycleTime");
}

static ULONG64 filetime_to_100ns(FILETIME ft) {
  ULARGE_INTEGER u;
  u.LowPart = ft.dwLowDateTime;
  u.HighPart = ft.dwHighDateTime;
  return u.QuadPart;
}

static void usage(void) {
  fprintf(stderr,
          "cpuprobe [--affinity 0xMASK] [--priority 0|1|2] [--poll-us N] -- child.exe [args]\n");
}

int main(int argc, char **argv) {
  DWORD_PTR affinity = 0;
  int priority = 0;
  long pollUs = 500;
  int i = 1;

  for (; i < argc; i++) {
    if (strcmp(argv[i], "--") == 0) { i++; break; }
    if (strcmp(argv[i], "--affinity") == 0 && i + 1 < argc) {
      affinity = (DWORD_PTR)strtoull(argv[++i], NULL, 0);
    } else if (strcmp(argv[i], "--priority") == 0 && i + 1 < argc) {
      priority = atoi(argv[++i]);
    } else if (strcmp(argv[i], "--poll-us") == 0 && i + 1 < argc) {
      pollUs = atol(argv[++i]);
    } else {
      usage();
      return 64;
    }
  }
  if (i >= argc) { usage(); return 64; }

  resolve_qpct();

  /* Rebuild a command line for CreateProcess. Quoting is deliberately
   * minimal: this tool launches ONE bench binary with no arguments and a
   * clever quoter that is wrong once is worse than a simple one that
   * refuses. Anything with a space or a quote in it is rejected. */
  size_t need = 1;
  for (int j = i; j < argc; j++) need += strlen(argv[j]) + 3;
  char *cmd = (char *)malloc(need);
  if (!cmd) return 70;
  cmd[0] = 0;
  for (int j = i; j < argc; j++) {
    if (strchr(argv[j], ' ') || strchr(argv[j], '"')) {
      fprintf(stderr, "cpuprobe: argument %d contains a space or a quote; refusing rather than guessing at quoting\n", j - i);
      return 64;
    }
    if (j > i) strcat(cmd, " ");
    strcat(cmd, argv[j]);
  }

  STARTUPINFOA si;
  PROCESS_INFORMATION pi;
  memset(&si, 0, sizeof(si));
  si.cb = sizeof(si);
  memset(&pi, 0, sizeof(pi));

  DWORD flags = CREATE_SUSPENDED;
  if (priority == 2) flags |= HIGH_PRIORITY_CLASS;
  else if (priority == 1) flags |= ABOVE_NORMAL_PRIORITY_CLASS;

  LARGE_INTEGER freq, t0, t1;
  QueryPerformanceFrequency(&freq);
  QueryPerformanceCounter(&t0);

  if (!CreateProcessA(NULL, cmd, NULL, NULL, TRUE, flags, NULL, NULL, &si, &pi)) {
    fprintf(stderr, "cpuprobe: CreateProcess failed, GetLastError=%lu, cmd=%s\n",
            (unsigned long)GetLastError(), cmd);
    return 71;
  }

  int affinityOk = 1;
  if (affinity) {
    if (!SetProcessAffinityMask(pi.hProcess, affinity)) affinityOk = 0;
  }

  /* A 1 ms wait is a 15.6 ms wait unless the timer period is raised, which
   * would make --poll-us a lie. Raised for the launcher only; the child's
   * own timing does not depend on it (its clock is QPC). */
  int periodRaised = (timeBeginPeriod(1) == TIMERR_NOERROR);

  ResumeThread(pi.hThread);

  ULONG64 polledCycles = 0;
  long polls = 0;
  DWORD waitMs = pollUs > 0 ? (DWORD)((pollUs + 999) / 1000) : INFINITE;
  if (waitMs == 0) waitMs = 1;
  for (;;) {
    DWORD w = WaitForSingleObject(pi.hProcess, waitMs);
    if (w != WAIT_TIMEOUT) break;
    if (g_qpct) {
      ULONG64 c = 0;
      if (g_qpct(pi.hProcess, &c)) { polledCycles = c; polls++; }
    }
  }

  ULONG64 postExitCycles = 0;
  int postExitOk = 0;
  if (g_qpct) {
    ULONG64 c = 0;
    if (g_qpct(pi.hProcess, &c)) { postExitCycles = c; postExitOk = 1; }
  }

  QueryPerformanceCounter(&t1);
  if (periodRaised) timeEndPeriod(1);

  DWORD code = 0;
  GetExitCodeProcess(pi.hProcess, &code);

  FILETIME ct, et, kt, ut;
  ULONG64 user100 = 0, kern100 = 0;
  int timesOk = 0;
  if (GetProcessTimes(pi.hProcess, &ct, &et, &kt, &ut)) {
    user100 = filetime_to_100ns(ut);
    kern100 = filetime_to_100ns(kt);
    timesOk = 1;
  }

  PROCESS_MEMORY_COUNTERS pmc;
  memset(&pmc, 0, sizeof(pmc));
  pmc.cb = sizeof(pmc);
  int memOk = GetProcessMemoryInfo(pi.hProcess, &pmc, sizeof(pmc)) ? 1 : 0;

  double wallNs = (double)(t1.QuadPart - t0.QuadPart) * 1e9 / (double)freq.QuadPart;

  fprintf(stderr,
          "CPUPROBE {\"exit\":%lu,\"wallNs\":%.0f,"
          "\"cyclesPolled\":%llu,\"cyclesPostExit\":%llu,\"postExitOk\":%s,"
          "\"polls\":%ld,\"pollUs\":%ld,\"qpctAvailable\":%s,"
          "\"userUs\":%llu,\"kernelUs\":%llu,\"timesOk\":%s,"
          "\"peakWSkb\":%llu,\"memOk\":%s,"
          "\"affinity\":%llu,\"affinityOk\":%s,\"priority\":%d,\"timerPeriod1ms\":%s}\n",
          (unsigned long)code, wallNs,
          (unsigned long long)polledCycles, (unsigned long long)postExitCycles,
          postExitOk ? "true" : "false",
          polls, pollUs, g_qpct ? "true" : "false",
          (unsigned long long)(user100 / 10), (unsigned long long)(kern100 / 10),
          timesOk ? "true" : "false",
          (unsigned long long)(pmc.PeakWorkingSetSize / 1024), memOk ? "true" : "false",
          (unsigned long long)affinity, affinityOk ? "true" : "false", priority,
          periodRaised ? "true" : "false");

  CloseHandle(pi.hThread);
  CloseHandle(pi.hProcess);
  return (int)code;
}
