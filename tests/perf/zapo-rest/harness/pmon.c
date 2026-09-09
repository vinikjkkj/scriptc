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
 * Six columns, and the header is written first:
 *
 *   ms             epoch milliseconds, the same clock Date.now() gives the
 *                  rig, so a sample can be joined to a phase marker
 *   workingSet     WorkingSetSize      — resident pages, TOTAL (== WorkingSet64)
 *   privateCommit  PrivateUsage        — commit charge (== PrivateMemorySize64)
 *   pageFaults     PageFaultCount
 *   cpuMs          kernel + user CPU, milliseconds, one decimal
 *   privateWS      resident PRIVATE pages only, -1 if it could not be read
 *
 * THE SIXTH COLUMN IS APPENDED, NEVER INSERTED. memrig-report.mjs and this
 * project's other readers take these positionally, so putting privateWS in
 * its logical place beside workingSet would silently shift privateCommit
 * and every figure derived from it. Same discipline as HCFREE and
 * DYNCEN-BOX: new data gets a new column at the end.
 *
 * WHY IT WAS ADDED. workingSet is the TOTAL and includes file-backed shared
 * pages; a statically linked 30.6 MiB executable's image is file-backed.
 * Task Manager's Processes tab shows the PRIVATE working set, so a
 * complaint phrased as "idle 10 MB, 70-100 MB after a sync" is denominated
 * in privateWS and not in workingSet. Reporting only the total overstates
 * an idle service by roughly the size of its binary.
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

/* PRIVATE working set, which is the column Task Manager's Processes tab
 * shows as "Memory" and is therefore the column the user's complaint is
 * denominated in. It is NOT WorkingSetSize: that total includes file-backed
 * shared pages, and a statically linked 30.6 MiB executable's image is
 * file-backed. Reporting only the total conflates two quantities that
 * differ by the size of the binary -- a 2x error on an idle service.
 *
 * QueryWorkingSet returns one entry per resident page; bit 8 of each is
 * Shared. Private pages are the ones with it clear. The buffer is grown and
 * kept, not reallocated per sample, and a failure returns 0 rather than a
 * guess -- the caller prints -1 so "could not read" is distinguishable from
 * "no private pages", which is the distinction every instrument on this
 * project has had to learn once. */
static SIZE_T private_ws(HANDLE h)
{
    static PSAPI_WORKING_SET_INFORMATION *buf = NULL;
    static SIZE_T cap = 0; /* bytes */
    SIZE_T need;
    if (cap == 0) {
        cap = sizeof(PSAPI_WORKING_SET_INFORMATION) + 65536 * sizeof(ULONG_PTR);
        buf = (PSAPI_WORKING_SET_INFORMATION *)malloc(cap);
        if (!buf) { cap = 0; return 0; }
    }
    for (;;) {
        if (QueryWorkingSet(h, buf, (DWORD)cap)) break;
        if (GetLastError() != ERROR_BAD_LENGTH) return 0;
        /* NumberOfEntries is set even on the short call: grow to it, with
         * headroom, because the set can grow between the two calls. */
        need = sizeof(PSAPI_WORKING_SET_INFORMATION) +
               (buf->NumberOfEntries + 4096) * sizeof(ULONG_PTR);
        if (need <= cap) return 0; /* not a length problem; do not spin */
        free(buf);
        buf = (PSAPI_WORKING_SET_INFORMATION *)malloc(need);
        if (!buf) { cap = 0; return 0; }
        cap = need;
    }
    {
        SIZE_T i, n = (SIZE_T)buf->NumberOfEntries, priv = 0;
        for (i = 0; i < n; i++)
            if (!(buf->WorkingSetInfo[i].Flags & 0x100)) priv++;
        return priv * 4096u;
    }
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
    /* QueryWorkingSet needs QUERY_INFORMATION + VM_READ, which the comment
     * above declined to ask for because nothing needed them. The private
     * working set does. Opened SEPARATELY so a refusal costs only that
     * column: h keeps the limited rights every other counter uses, and a
     * NULL hpriv prints -1 rather than a zero that reads as a measurement. */
    HANDLE hpriv = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, FALSE, pid);
    if (!hpriv)
        fprintf(stderr, "pmon: no privateWS column (OpenProcess VM_READ failed %lu)\n", GetLastError());
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
    fprintf(f, "ms,workingSet,privateCommit,pageFaults,cpuMs,privateWS\n");
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

        fprintf(f, "%lld,%llu,%llu,%lu,%.1f,%lld\n",
                now_ms(),
                (unsigned long long)pmc.WorkingSetSize,
                (unsigned long long)pmc.PrivateUsage,
                (unsigned long)pmc.PageFaultCount,
                cpu_ms,
                (long long)(hpriv ? (long long)private_ws(hpriv) : -1));
        fflush(f);
        Sleep(interval);
    }

    fclose(f);
    CloseHandle(h);
    return 0;
}
