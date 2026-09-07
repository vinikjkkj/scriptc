/* pmon — the kernel-side sampler behind memrig.ts.
 *
 *   pmon <pid> <interval_ms> <out.csv>
 *
 * Samples another process's memory counters from OUTSIDE it, every
 * interval_ms, and appends one CSV row per sample. It exists because the
 * numbers that matter here are the kernel's, not the runtime's: a process
 * that has freed memory to its own allocator but not to the OS still owns
 * the pages, and only the OS can say so.
 *
 * Five columns, and the header is written first:
 *
 *   ms             epoch milliseconds, the same clock Date.now() gives the
 *                  rig, so a sample can be joined to a phase marker
 *   workingSet     WorkingSetSize      — resident pages (== WorkingSet64)
 *   privateCommit  PrivateUsage        — commit charge (== PrivateMemorySize64)
 *   pageFaults     PageFaultCount
 *   cpuMs          kernel + user CPU, milliseconds, one decimal
 *
 * Working set and private commit are BOTH recorded because they answer
 * different questions and a history sync moves them by different factors:
 * the sync that costs 211 MiB resident costs 582 MiB of commit. A sampler
 * that reported only one of them would have made the arena's chunk giveback
 * — which is visible mostly in the gap between them — unreadable.
 *
 * Every row is flushed. The rig kills the sampler rather than asking it to
 * stop, so an unflushed tail is a lost tail, and the tail is where "settled"
 * is read.
 *
 * A predecessor of this program was a PowerShell one-liner that could report
 * only the first two columns; the reader (memrig-report.mjs) was written
 * against THAT shape and silently filtered out every row once the shape
 * changed. Both ends now agree on five columns with a header, and the reader
 * accepts three or more so it can never again drop a whole run in silence.
 *
 * Build (this host has no clang; zig cc is the C compiler):
 *   zig cc -O2 -o pmon.exe pmon.c -lpsapi
 */
#include <windows.h>
#include <psapi.h>
#include <stdio.h>
#include <stdlib.h>

static long long now_ms(void)
{
    FILETIME ft;
    ULARGE_INTEGER u;
    GetSystemTimeAsFileTime(&ft);
    u.LowPart = ft.dwLowDateTime;
    u.HighPart = ft.dwHighDateTime;
    /* FILETIME is 100ns ticks since 1601-01-01; 11644473600 s to the epoch. */
    return (long long)(u.QuadPart / 10000ULL) - 11644473600000LL;
}

static double filetime_ms(FILETIME ft)
{
    ULARGE_INTEGER u;
    u.LowPart = ft.dwLowDateTime;
    u.HighPart = ft.dwHighDateTime;
    return (double)u.QuadPart / 10000.0;
}

int main(int argc, char **argv)
{
    if (argc < 4) {
        fprintf(stderr, "usage: pmon <pid> <interval_ms> <out.csv>\n");
        return 2;
    }
    DWORD pid = (DWORD)strtoul(argv[1], NULL, 10);
    DWORD interval = (DWORD)strtoul(argv[2], NULL, 10);
    if (interval == 0) interval = 250;

    /* QUERY_LIMITED_INFORMATION is enough for both calls and does not need
     * the child to be ours; VM_READ would be refused across an elevation
     * boundary and there is no reason to ask for it. */
    HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
    if (!h) {
        fprintf(stderr, "pmon: OpenProcess(%lu) failed %lu\n", pid, GetLastError());
        return 3;
    }

    FILE *f = fopen(argv[3], "w");
    if (!f) {
        fprintf(stderr, "pmon: cannot write %s\n", argv[3]);
        CloseHandle(h);
        return 4;
    }
    fprintf(f, "ms,workingSet,privateCommit,pageFaults,cpuMs\n");
    fflush(f);

    for (;;) {
        PROCESS_MEMORY_COUNTERS_EX pmc;
        ZeroMemory(&pmc, sizeof(pmc));
        pmc.cb = sizeof(pmc);
        if (!GetProcessMemoryInfo(h, (PROCESS_MEMORY_COUNTERS *)&pmc, sizeof(pmc)))
            break; /* the child is gone: stop, do not write a zero row */

        double cpu_ms = 0.0;
        FILETIME cr, ex, kern, user;
        if (GetProcessTimes(h, &cr, &ex, &kern, &user))
            cpu_ms = filetime_ms(kern) + filetime_ms(user);

        /* An exited process still answers GetProcessMemoryInfo through an
         * open handle, with its last counters frozen. Sampling that forever
         * would pad the series with a flat tail that reads as "settled".
         * The exit code check is what ends the run. */
        DWORD code = STILL_ACTIVE;
        if (GetExitCodeProcess(h, &code) && code != STILL_ACTIVE)
            break;

        fprintf(f, "%lld,%llu,%llu,%lu,%.1f\n",
                now_ms(),
                (unsigned long long)pmc.WorkingSetSize,
                (unsigned long long)pmc.PrivateUsage,
                (unsigned long)pmc.PageFaultCount,
                cpu_ms);
        fflush(f);
        Sleep(interval);
    }

    fclose(f);
    CloseHandle(h);
    return 0;
}
