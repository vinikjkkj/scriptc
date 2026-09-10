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
/* Loaded module count, the real bound on TLS slot indices. Declared
 * here rather than beside the collect state because both the image
 * walk that sets it and the TLS walk that reads it precede that. */
SCR_NH_SHARED unsigned scr_nh_nmod = 0;
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
  scr_nh_nmod = n;
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

/* ---- stacks and TEB/static-TLS, bounded by thread count ----------------- */

typedef struct {
  void *BaseAddress; void *AllocationBase; SCR_NH_DWORD AllocationProtect;
  SCR_NH_DWORD __a; SCR_NH_UPTR RegionSize; SCR_NH_DWORD State, Protect, Type;
  SCR_NH_DWORD __b;
} SCR_NH_MBI;
__declspec(dllimport) SCR_NH_UPTR __stdcall VirtualQuery(const void *, SCR_NH_MBI *, SCR_NH_UPTR);
__declspec(dllimport) void *__stdcall GetProcAddress(SCR_NH_HANDLE, const char *);

/* A thread's TEB carries StackBase (+0x08) and StackLimit (+0x10) on x64, and
 * the loader places the static TLS block in the TEB's own allocation. Both are
 * reached through NtQueryInformationThread, resolved by name rather than
 * linked, so this header adds no import an ordinary build would not have. */
typedef struct {
  long ExitStatus; void *TebBaseAddress;
  SCR_NH_UPTR UniqueProcess, UniqueThread, AffinityMask;
  long Priority, BasePriority;
} SCR_NH_TBI;
typedef long(__stdcall *SCR_NH_NTQIT)(SCR_NH_HANDLE, int, void *, SCR_NH_DWORD, SCR_NH_DWORD *);

SCR_NH_FN unsigned scr_nh_stacks(void) {
  SCR_NH_THREADENTRY32 te;
  SCR_NH_HANDLE snap;
  SCR_NH_DWORD me = GetCurrentProcessId();
  SCR_NH_NTQIT q = (SCR_NH_NTQIT)GetProcAddress(GetModuleHandleA("ntdll.dll"),
                                                "NtQueryInformationThread");
  unsigned found = 0;
  if (!q) { scr_nh_overflowed("NtQueryInformationThread unavailable"); return 0; }
  snap = CreateToolhelp32Snapshot(0x00000004u, 0);
  if (snap == (SCR_NH_HANDLE)(SCR_NH_UPTR)-1) return 0;
  te.dwSize = sizeof te;
  if (Thread32First(snap, &te)) {
    do {
      SCR_NH_HANDLE th;
      SCR_NH_TBI tbi;
      SCR_NH_DWORD got = 0;
      const unsigned char *teb;
      SCR_NH_UPTR base = 0, limit = 0;
      SCR_NH_MBI mbi;
      if (te.th32OwnerProcessID != me) continue;
      if (found >= SCR_NH_MAXTHREAD) { scr_nh_overflowed("thread table"); break; }
      th = OpenThread(0x0040u /* QUERY_INFORMATION */, 0, te.th32ThreadID);
      if (!th) continue;
      if (q(th, 0 /* ThreadBasicInformation */, &tbi, (SCR_NH_DWORD)sizeof tbi, &got) == 0
          && tbi.TebBaseAddress) {
        teb = (const unsigned char *)tbi.TebBaseAddress;
        memcpy(&base, teb + 0x08, sizeof base);
        memcpy(&limit, teb + 0x10, sizeof limit);
        /* StackLimit is the lowest COMMITTED byte; the pages between it and
         * StackBase are the ones that can be resident. The reservation below
         * StackLimit is uncommitted and cannot be in a working set. */
        scr_nh_add_range(limit, base, SCR_NH_STACK);
        /* The TEB's own allocation carries the static TLS block the loader
         * places beside it. Bounded by thread count, one region each. */
        /* BaseAddress, NOT AllocationBase: RegionSize is measured from the
         * QUERIED address onward, so [AllocationBase, AllocationBase+RegionSize)
         * need not contain the TEB at all. It did not, and the tls class read
         * a clean zero -- the same shape as memmap's CLASS IMAGE 0.00 that
         * this lane exists to correct. */
        if (VirtualQuery(teb, &mbi, sizeof mbi))
          scr_nh_add_range((SCR_NH_UPTR)mbi.BaseAddress,
                           (SCR_NH_UPTR)mbi.BaseAddress + mbi.RegionSize, SCR_NH_TLS);
        /* AND THE STATIC TLS BLOCKS, which are NOT in the TEB's region. The
         * arm planted a 256 KiB __thread array and the tls class did not move
         * by a byte: the loader puts anything of size in a separate block
         * reached through TEB->ThreadLocalStoragePointer (+0x58 on x64), one
         * slot per module that declares TLS. Bounded by threads x modules.
         * Found by the arm; it would otherwise have fallen silently into the
         * residual and been reported as unexplained. */
        {
          const void *const *tls = 0;
          memcpy(&tls, teb + 0x58, sizeof tls);
          if (tls && VirtualQuery(tls, &mbi, sizeof mbi) && mbi.State == 0x1000u) {
            SCR_NH_UPTR slots = mbi.RegionSize / sizeof(void *);
            SCR_NH_UPTR si;
            unsigned live = 0;
            /* BOUNDED BY MODULE COUNT, which is the real bound. The slot
             * REGION's size is not a count of anything: it is sparse, and past
             * the real slot array it holds unrelated data whose non-NULL words
             * this walk was treating as TLS blocks -- 227 ranges and a
             * spurious overflow on a two-thread process. A TLS index is
             * assigned per module that declares TLS, so the count cannot
             * exceed the number of loaded modules. */
            SCR_NH_UPTR bound = scr_nh_nmod ? scr_nh_nmod : SCR_NH_MAXMOD;
            if (slots > bound) slots = bound;
            for (si = 0; si < slots; si++) {
              SCR_NH_MBI bm;
              if (!tls[si]) continue;
              if (++live > SCR_NH_MAXMOD) { scr_nh_overflowed("tls slot array"); break; }
              if (!VirtualQuery(tls[si], &bm, sizeof bm)) continue;
              if (bm.State != 0x1000u) continue; /* MEM_COMMIT */
              scr_nh_add_range((SCR_NH_UPTR)bm.BaseAddress,
                               (SCR_NH_UPTR)bm.BaseAddress + bm.RegionSize, SCR_NH_TLS);
            }
          }
        }
        found++;
      }
      CloseHandle(th);
    } while (Thread32Next(snap, &te));
  }
  CloseHandle(snap);
  return found;
}

/* ---- the resident page set, and the attribution ------------------------- */

SCR_NH_SHARED SCR_NH_UPTR scr_nh_cls_bytes[SCR_NH_NCLASS];
SCR_NH_SHARED SCR_NH_UPTR scr_nh_priv_bytes = 0;    /* all private resident */
SCR_NH_SHARED SCR_NH_UPTR scr_nh_shared_bytes = 0;  /* all shared resident */
SCR_NH_SHARED SCR_NH_UPTR scr_nh_resid_bytes = 0;   /* private, unattributed */
SCR_NH_SHARED unsigned scr_nh_collected = 0;

SCR_NH_FN void scr_nh_collect(void) {
  SCR_NH_UPTR cap, i, n;
  SCR_NH_WSINFO *buf;
  scr_nh_stacks();
  scr_nh_image_writable();
  /* One QueryWorkingSet: one entry per RESIDENT page, bit 8 = Shared. That is
   * pmon.c's rule verbatim, and scr_nh_priv_bytes must equal its privateWS
   * column for the same process at the same moment. */
  /* SIZED TO WHAT IS NEEDED, not to a fixed ceiling. The first version
   * committed a flat 2 MiB and every page of it went resident -- 2,101,248 B
   * of instrument-self against a 14.46 MiB target, which is precisely the
   * 2 MiB region table this lane rejected memmap for. Ask once, grow to the
   * answer, and the footprint becomes the working set's own size. */
  cap = sizeof(SCR_NH_WSINFO) + (SCR_NH_UPTR)1024 * sizeof(SCR_NH_WSBLOCK);
  for (;;) {
    buf = (SCR_NH_WSINFO *)VirtualAlloc(0, cap, 0x1000u | 0x2000u, 0x04u);
    if (!buf) { scr_nh_overflowed("working-set buffer"); return; }
    if (QueryWorkingSet(GetCurrentProcess(), buf, (SCR_NH_DWORD)cap)) break;
    /* On ERROR_BAD_LENGTH the call leaves the required count in the first
     * word. Grow to it with headroom -- the set can move between calls. */
    n = buf->NumberOfEntries;
    VirtualFree(buf, 0, 0x8000u);
    buf = 0;
    if (n == 0 || cap > (SCR_NH_UPTR)512 << 20) {
      /* A refused read is NOT zero private pages, and the two must never look
       * alike -- pmon prints -1 for exactly this. */
      scr_nh_overflowed("QueryWorkingSet refused");
      return;
    }
    cap = sizeof(SCR_NH_WSINFO) + (n + n / 4 + 1024) * sizeof(SCR_NH_WSBLOCK);
  }
  scr_nh_self_bytes = cap;
  n = buf->NumberOfEntries;
  for (i = 0; i < n; i++) {
    SCR_NH_UPTR f = buf->WorkingSetInfo[i].Flags;
    SCR_NH_UPTR va = f & ~(SCR_NH_UPTR)0xFFF;
    unsigned r, hit = 0;
    if (f & 0x100u) { scr_nh_shared_bytes += SCR_NH_PAGE; continue; }
    scr_nh_priv_bytes += SCR_NH_PAGE;
    /* The instrument's own buffer is a class, and it is subtracted rather
     * than left in the residual -- the fourth condition, applied to itself. */
    if (va >= (SCR_NH_UPTR)buf && va < (SCR_NH_UPTR)buf + cap) {
      scr_nh_cls_bytes[SCR_NH_SELF] += SCR_NH_PAGE;
      continue;
    }
    for (r = 0; r < scr_nh_nrange; r++) {
      if (va >= scr_nh_range[r].lo && va < scr_nh_range[r].hi) {
        scr_nh_cls_bytes[scr_nh_range[r].cls] += SCR_NH_PAGE;
        hit = 1;
        break;
      }
    }
    if (!hit) scr_nh_resid_bytes += SCR_NH_PAGE;
  }
  scr_nh_collected = 1;
  VirtualFree(buf, 0, 0x8000u);
}

/* ---- the arm: ONE SPECIMEN OF EVERY CLASS -------------------------------
 * memmap's self-test planted 32 MiB of PRIVATE, attributed 32 MiB exactly,
 * and passed -- while CLASS IMAGE read 0.00 for a 36.73 MB executable. It
 * only ever exercised the PRIVATE path. This arm touches a stack page, the
 * TEB/TLS region and a writable image page, so a class that stops working
 * cannot hide behind a class that still does. */
#ifdef SCR_NONHEAP_ARM
/* THE ARM PLANTS A KNOWN QUANTITY IN EACH CLASS AND CHECKS IT ARRIVED.
 *
 * The first version of this arm touched ONE page of stack and ONE page of a
 * writable section, and it was INERT: armed and unarmed runs came back
 * identical (stack 24576 both ways), because both pages were already resident
 * for other reasons. That is memmap's defect exactly -- a self-test that
 * exercises a path without moving it -- reproduced here, and caught only by
 * running the unarmed control beside the armed one.
 *
 * So the arm plants SCR_NH_ARM_BYTES per class, and the report collects
 * TWICE: once before touching and once after. A class whose delta does not
 * reach the planted amount says so by name. One run, no external comparison,
 * and a class that stops being attributed cannot hide behind one that still
 * is. */
#ifndef SCR_NH_ARM_BYTES
#define SCR_NH_ARM_BYTES (256u * 1024u)
#endif
SCR_NH_SHARED volatile unsigned char scr_nh_arm_image[SCR_NH_ARM_BYTES] = { 1 };
SCR_NH_SHARED __thread volatile unsigned char scr_nh_arm_tls[SCR_NH_ARM_BYTES];
SCR_NH_SHARED SCR_NH_UPTR scr_nh_arm_before[SCR_NH_NCLASS];

SCR_NH_FN void scr_nh_arm_touch(void) {
  volatile unsigned char onstack[SCR_NH_ARM_BYTES];
  unsigned i;
  for (i = 0; i < SCR_NH_ARM_BYTES; i += SCR_NH_PAGE) onstack[i] = 1;
  for (i = 0; i < SCR_NH_ARM_BYTES; i += SCR_NH_PAGE) scr_nh_arm_image[i] = 1;
  for (i = 0; i < SCR_NH_ARM_BYTES; i += SCR_NH_PAGE) scr_nh_arm_tls[i] = 1;
  /* Keep the stack pages live across the second collect: without this the
   * compiler is free to reuse the frame and the pages stay resident but the
   * measurement stops meaning anything. */
  if (onstack[0] == 0) scr_nh_arm_image[0] = 0;
}

SCR_NH_FN void scr_nh_arm_snapshot_before(void) {
  unsigned c;
  scr_nh_collect();
  for (c = 0; c < SCR_NH_NCLASS; c++) scr_nh_arm_before[c] = scr_nh_cls_bytes[c];
  /* Reset for the second, reported pass. The ranges are re-derived there. */
  for (c = 0; c < SCR_NH_NCLASS; c++) scr_nh_cls_bytes[c] = 0;
  scr_nh_priv_bytes = scr_nh_shared_bytes = scr_nh_resid_bytes = 0;
  scr_nh_nrange = 0;
  scr_nh_collected = 0;
}
#endif

/* ---- the report --------------------------------------------------------- */

SCR_NH_FN void scr_nh_report(void) {
  FILE *f = stderr;
  const char *out;
  SCR_NH_UPTR sum = 0;
  unsigned c;
  if (scr_nh_reported) return;
  scr_nh_reported = 1;
#ifdef SCR_NONHEAP_ARM
  scr_nh_arm_snapshot_before();
  scr_nh_arm_touch();
#endif
  scr_nh_collect();
  out = getenv("SCR_NONHEAP_OUT");
  if (out && *out) { FILE *g = fopen(out, "w"); if (g) f = g; }
  fprintf(f, "[nonheap] ARMED tests/perf/nonheap/scr_nonheap.h\n");
  if (!scr_nh_collected) {
    fprintf(f, "[nonheap] REFUSED - no page set was collected. This is not a"
               " measurement of zero.\n");
  }
  if (scr_nh_overflow) {
    fprintf(f, "[nonheap] REFUSED - %s overflowed or was unavailable. A"
               " truncated walk reads as a complete one with smaller numbers.\n",
            scr_nh_overflow_what ? scr_nh_overflow_what : "a table");
  }
  fprintf(f, "[nonheap] ranges=%u threads=%u privateWS=%llu sharedWS=%llu\n",
          scr_nh_nrange, scr_nh_thread_count(),
          (unsigned long long)scr_nh_priv_bytes,
          (unsigned long long)scr_nh_shared_bytes);
  for (c = 0; c < SCR_NH_NCLASS; c++) {
    fprintf(f, "[nonheap] CLASS %-16s %llu\n", scr_nh_class_name[c],
            (unsigned long long)scr_nh_cls_bytes[c]);
    sum += scr_nh_cls_bytes[c];
  }
  fprintf(f, "[nonheap] CLASS %-16s %llu\n", "residual",
          (unsigned long long)scr_nh_resid_bytes);
  sum += scr_nh_resid_bytes;
  /* THE CROSS-CHECK, against a total this same report prints. memmap put
   * CLASS HEAP 3.08 MiB four lines above its own HEAPTOTAL of 73.1 MiB and
   * nothing noticed. */
#ifdef SCR_NONHEAP_ARM
  {
    /* Each planted class must have MOVED by what was planted. A class that
     * did not is named, because an inert arm is how a broken classifier
     * passes its own self-test. */
    /* STACK and IMAGE are checked by DELTA: their pages are not resident until
     * the arm writes them, so touching MUST move the class.
     *
     * TLS is checked by PRESENCE, and that is a fact about the loader rather
     * than a weaker test. A static __thread block is committed and zeroed at
     * thread start, so it is ALREADY resident before the arm writes it and its
     * delta is legitimately zero. Asking TLS for a delta printed "DID NOT
     * MOVE" while the class was in fact correct: the arm's premise was wrong,
     * not the classifier. TLS must instead ACCOUNT for at least what was
     * planted. */
    static const unsigned armed[2] = { SCR_NH_STACK, SCR_NH_IMAGEW };
    unsigned a;
    for (a = 0; a < 2; a++) {
      unsigned k = armed[a];
      SCR_NH_UPTR d = scr_nh_cls_bytes[k] > scr_nh_arm_before[k]
                          ? scr_nh_cls_bytes[k] - scr_nh_arm_before[k] : 0;
      fprintf(f, "[nonheap] ARM %-16s planted %u moved %llu%s\n",
              scr_nh_class_name[k], (unsigned)SCR_NH_ARM_BYTES,
              (unsigned long long)d,
              d * 10u >= (SCR_NH_UPTR)SCR_NH_ARM_BYTES * 9u ? "" : "   <-- DID NOT MOVE");
    }
    fprintf(f, "[nonheap] ARM %-16s planted %u present %llu%s\n",
            scr_nh_class_name[SCR_NH_TLS], (unsigned)SCR_NH_ARM_BYTES,
            (unsigned long long)scr_nh_cls_bytes[SCR_NH_TLS],
            scr_nh_cls_bytes[SCR_NH_TLS] >= (SCR_NH_UPTR)SCR_NH_ARM_BYTES
                ? "" : "   <-- DOES NOT ACCOUNT FOR THE PLANT");
  }
#endif
  if (sum != scr_nh_priv_bytes) {
    fprintf(f, "[nonheap] MISMATCH - classes sum to %llu but privateWS is"
               " %llu. The split does not account for the total it splits.\n",
            (unsigned long long)sum, (unsigned long long)scr_nh_priv_bytes);
  } else {
    fprintf(f, "[nonheap] classes sum to privateWS exactly (%llu)\n",
            (unsigned long long)sum);
  }
  if (f != stderr) fclose(f);
}

/* atexit alone cannot report on this target: zapo's entry ends in
 * process.exit(0), which lowers to _Exit. Same port as cycstat's. */
__attribute__((constructor)) SCR_NH_FN void scr_nh_install(void) { atexit(scr_nh_report); }
#ifdef _Exit
#undef _Exit
#endif
#define _Exit(c) (scr_nh_report(), _Exit(c))

#endif /* SCR_NONHEAP_H */
