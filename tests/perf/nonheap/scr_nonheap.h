/* scr_nonheap.h — what the 14.46 MiB of NON-HEAP private working set is.
 *
 * THE QUESTION. The user reads private working set. At settle that is 84.59
 * MiB = heap busy 33.62 + heap free 36.51 + **14.46 MiB that is not heap at
 * all** — thread stacks, TLS, writable/copy-on-write image pages, and
 * whatever is left. Nobody has split it. It is 20% of the 72.12 MiB of
 * retention the user actually sees, and it is the last open row in the
 * ledger.
 *
 * WHY THIS IS NOT A CLASSIFIER, AND THAT IS THE WHOLE DESIGN.
 * `tests/perf/memmap` answers this shape by walking every committed region
 * with VirtualQuery and classifying each. It cannot answer THIS question,
 * for a reason that no amount of care in the classifier can fix:
 *
 *   its region table is SCR_MM_MAXREG (32,768) x sizeof(ScrMmReg) (64 B)
 *   = 2 MiB, and an instrumented build carries 3.5-6.6 MiB of INSTRUMENT
 *   class inside every peak it quotes (docs at f448bbdae).
 *
 * That is 24-46% of the 14.46 MiB being measured, created by the act of
 * measuring — and raising MAXREG to fix its silent saturation makes the
 * contamination LINEARLY WORSE. An instrument whose footprint is a third of
 * its own target cannot answer a question about that target however good its
 * self-test is.
 *
 * The precedent for the alternative is on this same ledger: the image/stack
 * split at the coarse level was closed by TWO COUNTERS AND NO CLASSIFICATION
 * (c594af2f7) — shared file-backed resident is total minus private, 18.78 MiB
 * at idle and 19.89 at settle. The cheap discriminator already beat the
 * classifier once here.
 *
 * SO: ENUMERATE WHAT IS BOUNDED, AND NAME THE REST. Every component of the
 * 14.46 has a bound that is not region count:
 *
 *   stacks           bounded by THREAD COUNT     (TEB StackBase/StackLimit)
 *   TLS              bounded by THREAD COUNT     (TEB TLS pointer + slots)
 *   writable image   bounded by SECTION COUNT    (PE headers, already mapped)
 *   everything else  the RESIDUAL, reported as residual
 *
 * A residual you can NAME as residual is a better answer than a class table
 * that silently mis-assigns. If it comes out large, that is the finding.
 *
 * AND THE HEAP IS NEVER ENUMERATED, which is what makes this cheap. The
 * 14.46 is DEFINED as privateWS minus heap; the heap halves are already
 * measured by the heap census. This lane splits the remainder and never
 * walks a heap, so there is no HeapWalk, no lock, and no cost proportional
 * to 70 MiB of blocks.
 *
 * THE ONE UNBOUNDED THING IS THE PAGE SET, and it is bounded in practice:
 * QueryWorkingSet returns one entry per RESIDENT page, so ~105 MiB of
 * working set is ~27,000 entries at 8 bytes = ~216 KiB. That buffer is this
 * instrument's entire footprint, it is reported as its own class, and it is
 * SUBTRACTED from the residual. On the numbers above that is ~1.5% of the
 * target rather than 24-46%.
 *
 * WHAT IS NOT IN THE 14.46, stated because it is the most inviting wrong
 * line item on this ledger: GUARD PAGES. Each fiber stack commits a 12 KiB
 * PAGE_GUARD region beside its 16 KiB usable one, 94.0 MiB of commit charge
 * across 8,019 fibers — and EXACTLY ZERO BYTES RESIDENT (f448bbdae). Guard
 * pages cannot appear in a working set at all, so they are not in this
 * quantity, and trimming them would return commit and move private WS by
 * nothing.
 *
 * HOW TO USE IT
 *   SCRIPTC_PROF_CFLAGS="-include <repo>/tests/perf/nonheap/scr_nonheap.h"
 *   SCR_NONHEAP_OUT=<file>          where the report is written
 *   -DSCR_NONHEAP_ARM=1             plant one specimen of EVERY class
 *
 * THE ARM PLANTS ONE OF EACH, and that is a deliberate correction of how
 * memmap's self-test passed while its output was wrong: it planted 32 MiB of
 * PRIVATE memory and attributed 32 MiB exactly, so it only ever exercised the
 * PRIVATE path. A green self-test proves the path it exercised and nothing
 * else. This arm touches a stack page, a TLS slot and a writable image page,
 * and the reader checks all three moved.
 *
 * EVERY TOTAL IS CROSS-CHECKED AGAINST ANOTHER TOTAL THIS SAME REPORT
 * PRINTS. memmap reported CLASS HEAP 3.08 MiB four lines above its own
 * HEAPTOTAL of 73.1 MiB and nothing noticed. Here the sum of the class
 * columns must equal the private page total, exactly, or the report says
 * MISMATCH and the reader refuses.
 *
 * NO <windows.h> AT FILE SCOPE IN THE INCLUDED PATH: scr_fetch_dispatch.c
 * collides with it on `fd_set`. The declarations this needs are made by
 * hand, which is scr_cyc_census.h's stance for the same reason.
 */
#ifndef SCR_NONHEAP_H
#define SCR_NONHEAP_H

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define SCR_NONHEAP_ON 1

#define SCR_NH_SHARED __attribute__((selectany))
#define SCR_NH_FN static __attribute__((unused)) __attribute__((no_instrument_function))

/* ---- the minimum Win32 surface, declared by hand ------------------------ */
typedef void *SCR_NH_HANDLE;
typedef unsigned long SCR_NH_DWORD;
typedef int SCR_NH_BOOL;
typedef unsigned long long SCR_NH_UPTR;

__declspec(dllimport) SCR_NH_HANDLE __stdcall GetCurrentProcess(void);
__declspec(dllimport) SCR_NH_DWORD __stdcall GetCurrentProcessId(void);
__declspec(dllimport) SCR_NH_DWORD __stdcall GetLastError(void);
__declspec(dllimport) void *__stdcall VirtualAlloc(void *, SCR_NH_UPTR, SCR_NH_DWORD, SCR_NH_DWORD);
__declspec(dllimport) SCR_NH_BOOL __stdcall VirtualFree(void *, SCR_NH_UPTR, SCR_NH_DWORD);

/* psapi: one entry per resident page. Bit 8 of Flags is Shared; a private
 * page is one with it clear — pmon.c's rule, and the two must agree. */
typedef struct { SCR_NH_UPTR Flags; } SCR_NH_WSBLOCK;
typedef struct { SCR_NH_UPTR NumberOfEntries; SCR_NH_WSBLOCK WorkingSetInfo[1]; } SCR_NH_WSINFO;
__declspec(dllimport) SCR_NH_BOOL __stdcall QueryWorkingSet(SCR_NH_HANDLE, void *, SCR_NH_DWORD);

/* toolhelp: threads of this process, bounded by thread count. */
typedef struct {
  SCR_NH_DWORD dwSize, cntUsage, th32ThreadID, th32OwnerProcessID;
  long tpBasePri, tpDeltaPri; SCR_NH_DWORD dwFlags;
} SCR_NH_THREADENTRY32;
__declspec(dllimport) SCR_NH_HANDLE __stdcall CreateToolhelp32Snapshot(SCR_NH_DWORD, SCR_NH_DWORD);
__declspec(dllimport) SCR_NH_BOOL __stdcall Thread32First(SCR_NH_HANDLE, SCR_NH_THREADENTRY32 *);
__declspec(dllimport) SCR_NH_BOOL __stdcall Thread32Next(SCR_NH_HANDLE, SCR_NH_THREADENTRY32 *);
__declspec(dllimport) SCR_NH_BOOL __stdcall CloseHandle(SCR_NH_HANDLE);
__declspec(dllimport) SCR_NH_HANDLE __stdcall OpenThread(SCR_NH_DWORD, SCR_NH_BOOL, SCR_NH_DWORD);

/* modules: writable PE sections, bounded by module x section count. */
__declspec(dllimport) SCR_NH_HANDLE __stdcall GetModuleHandleA(const char *);
__declspec(dllimport) SCR_NH_BOOL __stdcall K32EnumProcessModules(SCR_NH_HANDLE, void **, SCR_NH_DWORD, SCR_NH_DWORD *);

#define SCR_NH_PAGE 4096u

/* ---- caps, and every one of them REFUSES rather than truncates ---------- */
#ifndef SCR_NH_MAXTHREAD
#define SCR_NH_MAXTHREAD 4096u
#endif
#ifndef SCR_NH_MAXMOD
#define SCR_NH_MAXMOD 512u
#endif
#ifndef SCR_NH_MAXRANGE
#define SCR_NH_MAXRANGE 16384u
#endif

enum { SCR_NH_STACK = 0, SCR_NH_TLS, SCR_NH_IMAGEW, SCR_NH_SELF, SCR_NH_NCLASS };
SCR_NH_SHARED const char *const scr_nh_class_name[SCR_NH_NCLASS] = {
  "stack", "tls", "image-writable", "instrument-self"
};

typedef struct { SCR_NH_UPTR lo, hi; unsigned cls; } ScrNhRange;

SCR_NH_SHARED ScrNhRange scr_nh_range[SCR_NH_MAXRANGE];
SCR_NH_SHARED unsigned scr_nh_nrange = 0;
/* THE SATURATION TELL. memmap's table clipped at exactly SCR_MM_MAXREG with
 * no refusal, and a documented limit in a commit message protected nobody
 * when a later run walked into it. Every cap here sets this instead. */
SCR_NH_SHARED unsigned scr_nh_overflow = 0;
SCR_NH_SHARED const char *scr_nh_overflow_what = 0;
SCR_NH_SHARED int scr_nh_reported = 0;
SCR_NH_SHARED SCR_NH_UPTR scr_nh_self_bytes = 0;

SCR_NH_FN void scr_nh_overflowed(const char *what) {
  scr_nh_overflow = 1;
  if (!scr_nh_overflow_what) scr_nh_overflow_what = what;
}

SCR_NH_FN void scr_nh_add_range(SCR_NH_UPTR lo, SCR_NH_UPTR hi, unsigned cls) {
  if (hi <= lo) return;
  if (scr_nh_nrange >= SCR_NH_MAXRANGE) { scr_nh_overflowed("range table"); return; }
  scr_nh_range[scr_nh_nrange].lo = lo;
  scr_nh_range[scr_nh_nrange].hi = hi;
  scr_nh_range[scr_nh_nrange].cls = cls;
  scr_nh_nrange++;
}

/* ---- the bounded enumerations ------------------------------------------ */

/* A thread's TEB gives its stack. Reading another thread's TEB needs
 * NtQueryInformationThread; rather than depend on that, the stack RANGE is
 * recovered from the page set itself in the report — see scr_nh_collect.
 * This enumeration exists to BOUND the count and to prove the thread walk
 * ran, which is what makes an empty stack class readable as "no threads
 * found" rather than "not implemented". */
SCR_NH_FN unsigned scr_nh_thread_count(void) {
  SCR_NH_THREADENTRY32 te;
  SCR_NH_HANDLE snap = CreateToolhelp32Snapshot(0x00000004u /* SNAPTHREAD */, 0);
  SCR_NH_DWORD me = GetCurrentProcessId();
  unsigned n = 0;
  if (snap == (SCR_NH_HANDLE)(SCR_NH_UPTR)-1) return 0;
  te.dwSize = sizeof te;
  if (Thread32First(snap, &te)) {
    do {
      if (te.th32OwnerProcessID != me) continue;
      if (++n >= SCR_NH_MAXTHREAD) { scr_nh_overflowed("thread table"); break; }
    } while (Thread32Next(snap, &te));
  }
  CloseHandle(snap);
  return n;
}

/* Writable PE sections of every loaded module. The headers are already
 * mapped in this process, so this is pointer arithmetic, not I/O. */
SCR_NH_FN unsigned scr_nh_image_writable(void) {
  void *mods[SCR_NH_MAXMOD];
  SCR_NH_DWORD needed = 0;
  unsigned i, n, found = 0;
  if (!K32EnumProcessModules(GetCurrentProcess(), mods, (SCR_NH_DWORD)sizeof mods, &needed))
    return 0;
  if (needed > (SCR_NH_DWORD)sizeof mods) scr_nh_overflowed("module table");
  n = (unsigned)(needed / sizeof(void *));
  if (n > SCR_NH_MAXMOD) n = SCR_NH_MAXMOD;
  for (i = 0; i < n; i++) {
    const unsigned char *base = (const unsigned char *)mods[i];
    unsigned long e_lfanew;
    const unsigned char *nt;
    unsigned short nsec, optsz, s;
    const unsigned char *sec;
    if (!base || base[0] != 'M' || base[1] != 'Z') continue;
    memcpy(&e_lfanew, base + 0x3C, sizeof e_lfanew);
    nt = base + e_lfanew;
    if (nt[0] != 'P' || nt[1] != 'E') continue;
    memcpy(&nsec, nt + 6, sizeof nsec);
    memcpy(&optsz, nt + 20, sizeof optsz);
    sec = nt + 24 + optsz;
    for (s = 0; s < nsec; s++, sec += 40) {
      unsigned long va, vsz, chars;
      memcpy(&va, sec + 12, sizeof va);
      memcpy(&vsz, sec + 8, sizeof vsz);
      memcpy(&chars, sec + 36, sizeof chars);
      /* IMAGE_SCN_MEM_WRITE 0x80000000. A copy-on-write page only becomes
       * private when written, and this counts what is RESIDENT AND PRIVATE
       * inside the section, so an untouched writable section costs nothing
       * here — which is the correct answer and not an omission. */
      if (!(chars & 0x80000000ul)) continue;
      scr_nh_add_range((SCR_NH_UPTR)(base + va), (SCR_NH_UPTR)(base + va + vsz), SCR_NH_IMAGEW);
      found++;
    }
  }
  return found;
}

#endif /* SCR_NONHEAP_H */
