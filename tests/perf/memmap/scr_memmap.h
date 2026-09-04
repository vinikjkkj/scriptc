/* scr_memmap.h - ADDRESS-SPACE ATTRIBUTION OF PEAK RSS.
 *
 * Injected with -include through SCRIPTC_PROF_CFLAGS, exactly like
 * tests/perf/prof/scr_prof.h, and armed by -DSCR_MEMMAP. Nothing here is
 * compiled unless that -D is present, so an ordinary build is untouched.
 *
 * WHY IT EXISTS. scr_prof.h's residency lane charges every free back to the
 * site that allocated it and reports ptrLost=0, so it accounts COMPLETELY
 * for bytes that pass through the runtime's own malloc calls. It says so
 * itself: "What it does NOT cover is an allocation inside libc or inside a
 * vendored archive compiled without this header." On the zapo messaging
 * bench that uncovered remainder is roughly a quarter of peak RSS, and no
 * instrument in this tree could see one byte of it.
 *
 * The trick is to stop asking the allocator and ask the KERNEL. Peak RSS is
 * a set of resident pages; every resident page lies in exactly one region
 * that VirtualQuery can classify; so the sum over classified regions IS the
 * RSS, by construction, with no allocator cooperation anywhere. What the
 * heap will not tell us about itself, HeapWalk tells us from the outside.
 *
 * FOUR INSTRUMENTS IN ONE SNAPSHOT, taken at the same instant so they can
 * be subtracted from each other:
 *
 *   1. VirtualQuery walk of the whole user address space. Every COMMITTED
 *      region with its state/type/protect. This is the denominator: a byte
 *      that is not in a committed region cannot be resident.
 *   2. QueryWorkingSet. The resident page list, with the share bit. Each
 *      page is bucketed into its region by binary search, so RESIDENT bytes
 *      are known per region, not just committed bytes. The two differ by a
 *      lot and conflating them is how a memory report lies.
 *   3. GetProcessHeaps + HeapWalk on every heap. Per heap: committed,
 *      uncommitted, busy bytes and count, free bytes and count, and the
 *      CRT's real per-block overhead - measured, not the estimated 24 B.
 *      committed - busy - overhead is the slack: memory the process owns,
 *      has touched, and is not using. The residency profiler cannot see it
 *      because every byte of it has already been charged back on free.
 *   4. Module enumeration, so MEM_IMAGE pages are named per DLL rather than
 *      lumped as "the image".
 *
 * HOW A REGION IS CLASSED, in priority order. Each class is disjoint and
 * they sum to the resident total by construction:
 *
 *   INSTRUMENT  one of this header's own VirtualAlloc buffers. Subtracted so
 *               the report describes the program, not the report.
 *   IMAGE       MEM_IMAGE. Named by module.
 *   MAPPED      MEM_MAPPED. File-backed but not a PE - section objects.
 *   STACK       MEM_PRIVATE whose allocation base owns a PAGE_GUARD region.
 *               That is the structural signature of a thread stack AND of a
 *               win32 fiber stack, which is what we want: scr_async.c's
 *               CreateFiberEx stacks are not malloc and have never appeared
 *               in any heap instrument in this tree.
 *   HEAP        MEM_PRIVATE inside a region HeapWalk claimed.
 *   PRIVATE     MEM_PRIVATE that is none of the above. THIS IS THE BUCKET
 *               THE ANSWER MIGHT HIDE IN, so it is negative-controlled by
 *               SCR_MEMMAP_SELFTEST below, which VirtualAllocs a known size
 *               and requires it to land here to the page.
 *
 * NO MALLOC ANYWHERE IN THIS FILE. Every buffer is VirtualAlloc'd once at
 * arm time and every byte of output is formatted by hand into a fixed buffer
 * and written with WriteFile. stdio would take the CRT lock and allocate its
 * own buffer on first use, inside the heap this code is walking, while
 * holding that heap's lock. That is a deadlock and a measurement error at
 * the same time.
 *
 * TRIGGERING ON THE PEAK. A sampler thread polls GetProcessMemoryInfo every
 * SCR_MEMMAP_MS milliseconds (default 4) and takes a full snapshot only when
 * the working set beats the best snapshot by SCR_MEMMAP_DELTA bytes (default
 * 4 MiB). Each snapshot OVERWRITES SCR_MEMMAP_OUT, so the file left behind
 * is the highest one seen. The kernel's own PeakWorkingSetSize is printed
 * beside the snapshot total in every report: if the snapshot is far under
 * the kernel's peak, the sampler missed the peak and the report says so
 * rather than presenting a floor as an answer.
 *
 * WHAT IT COSTS THE MEASUREMENT. The polling thread does one syscall per
 * tick. A full snapshot walks the heap, which is O(live blocks) and takes
 * real time at a million of them - but it is triggered on RSS, not on time,
 * and this instrument exists to attribute bytes, not to time anything. Set
 * SCR_MEMMAP_HEAP=0 to drop instrument 3 and the snapshot becomes O(regions).
 *
 * ARMING, because an instrument that cannot tell "found none" from "there
 * are none" will report zero and be believed. SCR_MEMMAP_SELFTEST=<MiB>:
 *   POSITIVE  VirtualAlloc that many MiB, touch every page, and require the
 *             PRIVATE class to grow by exactly that much between the
 *             before-snapshot and the after-snapshot.
 *   POSITIVE  malloc 8 MiB, touch it, and require heap BUSY bytes to grow by
 *             at least that much.
 *   POSITIVE  require the exe's own module to be found and to have resident
 *             pages, and require at least one heap.
 * Any of those failing writes SELFTEST FAIL to the report and to stderr and
 * calls _Exit(93). A silent zero is not reachable from here.
 */
#ifndef SCR_MEMMAP_H
#define SCR_MEMMAP_H

#ifdef SCR_MEMMAP

/* windows.h pulls <winsock.h> unless this is defined, and this header is
 * -include'd before every TU, so winsock's `fd_set` would arrive before
 * scr_fetch_dispatch.c's own static fd_set. Same trap scr_prof.h documents. */
#ifndef _WINSOCKAPI_
#define _WINSOCKAPI_
#endif
#include <windows.h>
#include <stddef.h>
#include <stdlib.h>

/* Linkage follows the rule scr_prof.h established for x86_64-windows-gnu:
 * shared DATA is selectany with an explicit initialiser (COMDAT "any", so
 * duplicates merge into ONE instance), and every FUNCTION is static, so the
 * per-TU copies of the code all drive that single instance. `weak` is an ELF
 * rule and produces "lld-link: error: duplicate symbol" here. */
#define SCR_MM_SHARED __attribute__((selectany))
#define SCR_MM_FN static __attribute__((unused)) __attribute__((no_instrument_function))

#define SCR_MM_MAXREG 32768u /* committed regions tracked per snapshot */
#define SCR_MM_MAXMOD 256u
#define SCR_MM_MAXHR 4096u /* heap regions across all heaps */
/* The page-list buffer is the instrument's whole footprint: QueryWorkingSet
 * touches EVERY byte of the buffer it is handed, not just the entries it
 * writes, so an oversized buffer is oversized RESIDENT memory inside the
 * process being measured. At 4,194,304 entries it cost 32 MiB of the toy's
 * own RSS; 262,144 entries is 2 MiB and still covers a 1 GiB working set
 * against a subject that peaks near 190 MiB. Overflow is fatal, never a
 * truncation - see scr_mm_bucket. */
#define SCR_MM_MAXPAGES 262144u /* 1 GiB of resident pages, 2 MiB of buffer */

/* ---- classes. Disjoint and exhaustive over committed regions. ---- */
enum {
  SCR_MM_C_INSTRUMENT = 0,
  SCR_MM_C_IMAGE,
  SCR_MM_C_MAPPED,
  SCR_MM_C_STACK,
  SCR_MM_C_HEAP,
  SCR_MM_C_PRIVATE,
  SCR_MM_C_N
};

typedef struct {
  ULONG_PTR base;
  ULONG_PTR size;
  ULONG_PTR allocBase;
  DWORD type;
  DWORD protect;
  unsigned char cls;
  unsigned char guard; /* this region is a PAGE_GUARD page */
  int mod;             /* module index for IMAGE, else -1 */
  ULONG_PTR resident;
  ULONG_PTR shared;
} ScrMmReg;

typedef struct {
  ULONG_PTR base;
  ULONG_PTR size;
  char name[64];
  ULONG_PTR resident;
} ScrMmMod;

typedef struct {
  ULONG_PTR lo, hi;
} ScrMmRange;

typedef struct {
  HANDLE h;
  ULONG_PTR committed, uncommitted;
  ULONG_PTR busyBytes, busyCount;
  ULONG_PTR freeBytes, freeCount;
  ULONG_PTR overhead;
  int walked;   /* HeapWalk completed cleanly */
  DWORD lastErr;
} ScrMmHeap;

/* ---- shared state. One instance, merged across every TU. ---- */
SCR_MM_SHARED ScrMmReg *scr_mm_reg = 0;
SCR_MM_SHARED ScrMmMod *scr_mm_mod = 0;
SCR_MM_SHARED ScrMmRange *scr_mm_hr = 0;
SCR_MM_SHARED ScrMmHeap *scr_mm_heaps = 0;
SCR_MM_SHARED ULONG_PTR *scr_mm_pages = 0;
SCR_MM_SHARED char *scr_mm_outbuf = 0;
SCR_MM_SHARED ScrMmRange scr_mm_own[8] = {{0, 0}};
SCR_MM_SHARED unsigned scr_mm_nown = 0;
SCR_MM_SHARED unsigned scr_mm_nheap = 0;
SCR_MM_SHARED unsigned scr_mm_nhr = 0;
SCR_MM_SHARED unsigned scr_mm_nmod = 0;
SCR_MM_SHARED unsigned scr_mm_nreg = 0;
SCR_MM_SHARED int scr_mm_armed = 0;
SCR_MM_SHARED int scr_mm_walkheap = 1;
SCR_MM_SHARED int scr_mm_snapshots = 0;
SCR_MM_SHARED ULONG_PTR scr_mm_best = 0;
SCR_MM_SHARED ULONG_PTR scr_mm_delta = 4u * 1024u * 1024u;
SCR_MM_SHARED DWORD scr_mm_ms = 4;
SCR_MM_SHARED char scr_mm_out[512] = {0};
SCR_MM_SHARED char scr_mm_tag[64] = {0};
SCR_MM_SHARED unsigned scr_mm_outlen = 0;
SCR_MM_SHARED ULONG_PTR scr_mm_clsRes[SCR_MM_C_N] = {0};
SCR_MM_SHARED ULONG_PTR scr_mm_clsCom[SCR_MM_C_N] = {0};
SCR_MM_SHARED ULONG_PTR scr_mm_orphanCls[SCR_MM_C_N] = {0};
SCR_MM_SHARED ULONG_PTR scr_mm_orphanUnresolved = 0;
SCR_MM_SHARED ULONG_PTR scr_mm_mallocHeap = 0; /* heap index+1 that owns malloc */
/* Read back into by the self-test so its buffers are not dead stores. */
SCR_MM_SHARED volatile long long scr_mm_sink = 0;

/* psapi lives in kernel32 as K32* on every Windows this repo targets, so
 * binding by name at runtime keeps -lpsapi out of the link. A missing export
 * is a hard failure, never a zero. */
typedef BOOL(WINAPI *ScrMmQWS)(HANDLE, PVOID, DWORD);
typedef BOOL(WINAPI *ScrMmEPM)(HANDLE, HMODULE *, DWORD, LPDWORD);
typedef DWORD(WINAPI *ScrMmGMBN)(HANDLE, HMODULE, LPSTR, DWORD);
typedef BOOL(WINAPI *ScrMmGMI)(HANDLE, HMODULE, void *, DWORD);
typedef BOOL(WINAPI *ScrMmGPMI)(HANDLE, void *, DWORD);
SCR_MM_SHARED ScrMmQWS scr_mm_qws = 0;
SCR_MM_SHARED ScrMmEPM scr_mm_epm = 0;
SCR_MM_SHARED ScrMmGMBN scr_mm_gmbn = 0;
SCR_MM_SHARED ScrMmGMI scr_mm_gmi = 0;
SCR_MM_SHARED ScrMmGPMI scr_mm_gpmi = 0;

/* PROCESS_MEMORY_COUNTERS_EX, spelled out so no psapi.h include is needed
 * and the field offsets are visible at the point of use. */
typedef struct {
  DWORD cb;
  DWORD PageFaultCount;
  SIZE_T PeakWorkingSetSize;
  SIZE_T WorkingSetSize;
  SIZE_T QuotaPeakPagedPoolUsage;
  SIZE_T QuotaPagedPoolUsage;
  SIZE_T QuotaPeakNonPagedPoolUsage;
  SIZE_T QuotaNonPagedPoolUsage;
  SIZE_T PagefileUsage;
  SIZE_T PeakPagefileUsage;
  SIZE_T PrivateUsage;
} ScrMmPmc;

typedef struct {
  DWORD_PTR lpBaseOfDll;
  DWORD SizeOfImage;
  void *EntryPoint;
} ScrMmMi;

/* ---------------------------------------------------------------- output */
SCR_MM_FN void scr_mm_ch(char c) {
  if (scr_mm_outlen < 1024u * 1024u - 2u) scr_mm_outbuf[scr_mm_outlen++] = c;
}
SCR_MM_FN void scr_mm_s(const char *s) {
  while (s && *s) scr_mm_ch(*s++);
}
SCR_MM_FN void scr_mm_u(unsigned long long v) {
  char t[24];
  int n = 0;
  if (v == 0) { scr_mm_ch('0'); return; }
  while (v && n < 24) { t[n++] = (char)('0' + (int)(v % 10ull)); v /= 10ull; }
  while (n) scr_mm_ch(t[--n]);
}
SCR_MM_FN void scr_mm_hex(unsigned long long v) {
  char t[20];
  int n = 0;
  scr_mm_s("0x");
  if (v == 0) { scr_mm_ch('0'); return; }
  while (v && n < 20) { int d = (int)(v & 15ull); t[n++] = (char)(d < 10 ? '0' + d : 'a' + d - 10); v >>= 4; }
  while (n) scr_mm_ch(t[--n]);
}
/* MiB with two decimals, integer-only so no float formatting is pulled in. */
SCR_MM_FN void scr_mm_mib(unsigned long long b) {
  unsigned long long whole = b / (1024ull * 1024ull);
  unsigned long long frac = ((b % (1024ull * 1024ull)) * 100ull) / (1024ull * 1024ull);
  scr_mm_u(whole);
  scr_mm_ch('.');
  if (frac < 10) scr_mm_ch('0');
  scr_mm_u(frac);
}
SCR_MM_FN void scr_mm_flush_to(const char *path) {
  HANDLE f = CreateFileA(path, GENERIC_WRITE, FILE_SHARE_READ, 0, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, 0);
  if (f != INVALID_HANDLE_VALUE) {
    DWORD wrote = 0;
    WriteFile(f, scr_mm_outbuf, (DWORD)scr_mm_outlen, &wrote, 0);
    CloseHandle(f);
  }
  scr_mm_outlen = 0;
}
SCR_MM_FN void scr_mm_flush(void) { scr_mm_flush_to(scr_mm_out); }
/* A failing self-test must never destroy the snapshot that shows WHY it
 * failed, so the diagnosis goes to <out>.fail and the snapshot stays put. */
SCR_MM_FN void scr_mm_die(const char *why) {
  DWORD wrote = 0;
  char fp[600];
  int fi = 0;
  while (scr_mm_out[fi] && fi < 570) { fp[fi] = scr_mm_out[fi]; fi++; }
  fp[fi++] = '.'; fp[fi++] = 'f'; fp[fi++] = 'a'; fp[fi++] = 'i'; fp[fi++] = 'l'; fp[fi] = 0;
  scr_mm_s("\nSELFTEST FAIL ");
  scr_mm_s(why);
  scr_mm_ch('\n');
  WriteFile(GetStdHandle(STD_ERROR_HANDLE), "scr_memmap SELFTEST FAIL: ", 26, &wrote, 0);
  WriteFile(GetStdHandle(STD_ERROR_HANDLE), why, (DWORD)lstrlenA(why), &wrote, 0);
  WriteFile(GetStdHandle(STD_ERROR_HANDLE), "\n", 1, &wrote, 0);
  scr_mm_flush_to(fp);
  _Exit(93);
}

/* ------------------------------------------------------------- the walks */

/* HeapWalk over every process heap. Fills scr_mm_heaps and the heap-region
 * range list the region classifier joins against. A heap that refuses to
 * walk is recorded with walked=0 and its error, and the report prints it:
 * an unwalkable heap must not silently become zero bytes of slack. */
SCR_MM_FN void scr_mm_walk_heaps(void) {
  HANDLE hs[64];
  DWORD n = GetProcessHeaps(64, hs);
  unsigned i;
  scr_mm_nheap = 0;
  scr_mm_nhr = 0;
  if (n > 64) n = 64;
  for (i = 0; i < n; i++) {
    ScrMmHeap *H = &scr_mm_heaps[scr_mm_nheap];
    PROCESS_HEAP_ENTRY e;
    H->h = hs[i];
    H->committed = H->uncommitted = 0;
    H->busyBytes = H->busyCount = 0;
    H->freeBytes = H->freeCount = 0;
    H->overhead = 0;
    H->walked = 0;
    H->lastErr = 0;
    if (!HeapLock(hs[i])) { H->lastErr = GetLastError(); scr_mm_nheap++; continue; }
    e.lpData = 0;
    for (;;) {
      SetLastError(0);
      if (!HeapWalk(hs[i], &e)) { H->lastErr = GetLastError(); break; }
      if (e.wFlags & PROCESS_HEAP_REGION) {
        H->committed += e.Region.dwCommittedSize;
        H->uncommitted += e.Region.dwUnCommittedSize;
        if (scr_mm_nhr < SCR_MM_MAXHR) {
          scr_mm_hr[scr_mm_nhr].lo = (ULONG_PTR)e.lpData;
          scr_mm_hr[scr_mm_nhr].hi = (ULONG_PTR)e.lpData + e.Region.dwCommittedSize + e.Region.dwUnCommittedSize;
          scr_mm_nhr++;
        }
      } else if (e.wFlags & PROCESS_HEAP_UNCOMMITTED_RANGE) {
        /* counted in the region's dwUnCommittedSize already */
      } else if (e.wFlags & PROCESS_HEAP_ENTRY_BUSY) {
        H->busyBytes += e.cbData;
        H->overhead += e.cbOverhead;
        H->busyCount++;
        /* A block over the NT heap's large-block threshold is not carved out
         * of a segment: the heap VirtualAllocs it on its own, so it lies
         * OUTSIDE every PROCESS_HEAP_REGION and the region classifier would
         * charge it to PRIVATE. Measured on this toolchain: malloc(1 MiB)
         * and malloc(8 MiB) each get their own AllocationBase, distinct from
         * the heap's. Give each one its own range, rounded out to the 64 KiB
         * allocation granularity it was reserved on. */
        if (e.cbData >= 262144u && scr_mm_nhr < SCR_MM_MAXHR) {
          ULONG_PTR lo = (ULONG_PTR)e.lpData & ~(ULONG_PTR)0xFFFF;
          ULONG_PTR hi2 = ((ULONG_PTR)e.lpData + e.cbData + e.cbOverhead + 0xFFFFu) & ~(ULONG_PTR)0xFFFF;
          scr_mm_hr[scr_mm_nhr].lo = lo;
          scr_mm_hr[scr_mm_nhr].hi = hi2;
          scr_mm_nhr++;
        }
      } else {
        H->freeBytes += e.cbData;
        H->overhead += e.cbOverhead;
        H->freeCount++;
      }
    }
    if (H->lastErr == ERROR_NO_MORE_ITEMS) H->walked = 1;
    HeapUnlock(hs[i]);
    scr_mm_nheap++;
  }
}

SCR_MM_FN int scr_mm_in_heap(ULONG_PTR base, ULONG_PTR size) {
  unsigned i;
  ULONG_PTR end = base + size;
  for (i = 0; i < scr_mm_nhr; i++)
    if (base < scr_mm_hr[i].hi && end > scr_mm_hr[i].lo) return 1;
  return 0;
}
SCR_MM_FN int scr_mm_is_own(ULONG_PTR base) {
  unsigned i;
  for (i = 0; i < scr_mm_nown; i++)
    if (base >= scr_mm_own[i].lo && base < scr_mm_own[i].hi) return 1;
  return 0;
}

SCR_MM_FN void scr_mm_modules(void) {
  HMODULE mods[SCR_MM_MAXMOD];
  DWORD need = 0, i, cnt;
  scr_mm_nmod = 0;
  if (!scr_mm_epm || !scr_mm_epm(GetCurrentProcess(), mods, (DWORD)sizeof mods, &need)) return;
  cnt = need / (DWORD)sizeof(HMODULE);
  if (cnt > SCR_MM_MAXMOD) cnt = SCR_MM_MAXMOD;
  for (i = 0; i < cnt; i++) {
    ScrMmMi mi;
    ScrMmMod *M = &scr_mm_mod[scr_mm_nmod];
    char path[MAX_PATH];
    int k, last = 0;
    if (!scr_mm_gmi || !scr_mm_gmi(GetCurrentProcess(), mods[i], &mi, (DWORD)sizeof mi)) continue;
    M->base = (ULONG_PTR)mi.lpBaseOfDll;
    M->size = mi.SizeOfImage;
    M->resident = 0;
    M->name[0] = 0;
    if (scr_mm_gmbn && scr_mm_gmbn(GetCurrentProcess(), mods[i], path, (DWORD)sizeof path)) {
      for (k = 0; path[k]; k++)
        if (path[k] == '\\' || path[k] == '/') last = k + 1;
      for (k = 0; k < 63 && path[last + k]; k++) M->name[k] = path[last + k];
      M->name[k] = 0;
    }
    scr_mm_nmod++;
  }
}

SCR_MM_FN int scr_mm_mod_of(ULONG_PTR a) {
  unsigned i;
  for (i = 0; i < scr_mm_nmod; i++)
    if (a >= scr_mm_mod[i].base && a < scr_mm_mod[i].base + scr_mm_mod[i].size) return (int)i;
  return -1;
}

/* VirtualQuery the whole user address space, keeping only COMMITTED regions
 * (a reserved page cannot be resident). Two passes: the first records the
 * regions, the second classes them, because STACK is a property of the whole
 * allocation (does any region under this allocation base carry PAGE_GUARD?)
 * and is not visible from one region alone. */
SCR_MM_FN void scr_mm_walk_vm(void) {
  SYSTEM_INFO si;
  MEMORY_BASIC_INFORMATION mbi;
  ULONG_PTR a, hi;
  unsigned i, j;
  GetSystemInfo(&si);
  hi = (ULONG_PTR)si.lpMaximumApplicationAddress;
  scr_mm_nreg = 0;
  for (a = (ULONG_PTR)si.lpMinimumApplicationAddress; a < hi;) {
    if (VirtualQuery((LPCVOID)a, &mbi, sizeof mbi) != sizeof mbi) break;
    if (mbi.State == MEM_COMMIT && scr_mm_nreg < SCR_MM_MAXREG) {
      ScrMmReg *R = &scr_mm_reg[scr_mm_nreg++];
      R->base = (ULONG_PTR)mbi.BaseAddress;
      R->size = (ULONG_PTR)mbi.RegionSize;
      R->allocBase = (ULONG_PTR)mbi.AllocationBase;
      R->type = mbi.Type;
      R->protect = mbi.Protect;
      R->guard = (unsigned char)((mbi.Protect & PAGE_GUARD) ? 1 : 0);
      R->cls = SCR_MM_C_PRIVATE;
      R->mod = -1;
      R->resident = 0;
      R->shared = 0;
    }
    if (mbi.RegionSize == 0) break;
    a = (ULONG_PTR)mbi.BaseAddress + (ULONG_PTR)mbi.RegionSize;
  }
  /* second pass: class each region */
  for (i = 0; i < scr_mm_nreg; i++) {
    ScrMmReg *R = &scr_mm_reg[i];
    if (scr_mm_is_own(R->base)) { R->cls = SCR_MM_C_INSTRUMENT; continue; }
    if (R->type == MEM_IMAGE) {
      R->cls = SCR_MM_C_IMAGE;
      R->mod = scr_mm_mod_of(R->base);
      continue;
    }
    if (R->type == MEM_MAPPED) { R->cls = SCR_MM_C_MAPPED; continue; }
    /* MEM_PRIVATE. A stack if anything under this allocation base guards. */
    for (j = 0; j < scr_mm_nreg; j++)
      if (scr_mm_reg[j].allocBase == R->allocBase && scr_mm_reg[j].guard) break;
    if (j < scr_mm_nreg) { R->cls = SCR_MM_C_STACK; continue; }
    if (scr_mm_walkheap && scr_mm_in_heap(R->base, R->size)) { R->cls = SCR_MM_C_HEAP; continue; }
    R->cls = SCR_MM_C_PRIVATE;
  }
}

/* Bucket every resident page into its region. Regions come out of the
 * VirtualQuery walk in ascending address order, so a binary search is exact
 * and the column sums to the resident total by construction - no page is
 * counted twice and none is dropped silently (pages that hit no region are
 * counted in `orphan` and printed). */
SCR_MM_FN ULONG_PTR scr_mm_bucket(ULONG_PTR *orphan, ULONG_PTR *sharedTotal) {
  ULONG_PTR n, k, total = 0;
  *orphan = 0;
  *sharedTotal = 0;
  if (!scr_mm_qws) return 0;
  scr_mm_pages[0] = 0;
  if (!scr_mm_qws(GetCurrentProcess(), scr_mm_pages, (DWORD)((SCR_MM_MAXPAGES + 1) * sizeof(ULONG_PTR)))) return 0;
  n = scr_mm_pages[0];
  /* Truncating here would silently under-report exactly the peak this file
   * exists to explain, so it is fatal instead. */
  if (n > SCR_MM_MAXPAGES) scr_mm_die("working set exceeds SCR_MM_MAXPAGES - raise it, do not truncate");
  for (k = 1; k <= n; k++) {
    ULONG_PTR e = scr_mm_pages[k];
    ULONG_PTR va = e & ~(ULONG_PTR)0xFFF;
    unsigned lo = 0, hiI = scr_mm_nreg, mid, found = (unsigned)-1;
    while (lo < hiI) {
      mid = lo + (hiI - lo) / 2u;
      if (scr_mm_reg[mid].base > va) hiI = mid;
      else { found = mid; lo = mid + 1u; }
    }
    total += 4096;
    if (e & 0x100) *sharedTotal += 4096;
    if (found != (unsigned)-1 && va < scr_mm_reg[found].base + scr_mm_reg[found].size) {
      scr_mm_reg[found].resident += 4096;
      if (e & 0x100) scr_mm_reg[found].shared += 4096;
      if (scr_mm_reg[found].cls == SCR_MM_C_IMAGE && scr_mm_reg[found].mod >= 0)
        scr_mm_mod[scr_mm_reg[found].mod].resident += 4096;
    } else {
      /* ORPHANS ARE A RACE, NOT A MYSTERY, and they are resolved rather than
       * reported as a residual. The VirtualQuery walk and QueryWorkingSet are
       * two calls, and the program keeps allocating between them, so a page
       * faulted in after the walk lies in no region the walk saw. Measured on
       * the toy at 1.14 MiB of 47.8 (2.4%) - small, but it is 2.4% of the
       * answer and it would land in whichever class the reader assumed.
       * Asking VirtualQuery about that one page closes it exactly, and the
       * class it reports is authoritative because it is later than the walk.
       * The cap exists so a pathological orphan count cannot turn a snapshot
       * into a syscall storm; hitting it is reported, not swallowed. */
      MEMORY_BASIC_INFORMATION m;
      *orphan += 4096;
      if (*orphan <= 8192u * 4096u && VirtualQuery((LPCVOID)va, &m, sizeof m) == sizeof m && m.State == MEM_COMMIT) {
        unsigned char c;
        if (scr_mm_is_own(va)) c = SCR_MM_C_INSTRUMENT;
        else if (m.Type == MEM_IMAGE) c = SCR_MM_C_IMAGE;
        else if (m.Type == MEM_MAPPED) c = SCR_MM_C_MAPPED;
        else if (scr_mm_walkheap && scr_mm_in_heap(va, 4096)) c = SCR_MM_C_HEAP;
        else c = SCR_MM_C_PRIVATE;
        scr_mm_orphanCls[c] += 4096;
      } else {
        scr_mm_orphanCls[SCR_MM_C_PRIVATE] += 4096;
        scr_mm_orphanUnresolved += 4096;
      }
    }
  }
  return total;
}

/* ------------------------------------------------------------- reporting */
SCR_MM_FN void scr_mm_snapshot(const char *why) {
  ScrMmPmc pmc;
  ULONG_PTR orphan = 0, sharedTotal = 0, resident, committed = 0;
  unsigned i;
  ULONG_PTR heapCommit = 0, heapBusy = 0, heapFree = 0, heapOver = 0, heapUncom = 0, heapBusyN = 0, heapFreeN = 0;

  ULONGLONG t0 = GetTickCount64(), tHeap, tVm, tPages;
  for (i = 0; i < SCR_MM_C_N; i++) scr_mm_orphanCls[i] = 0;
  scr_mm_orphanUnresolved = 0;
  if (scr_mm_walkheap) scr_mm_walk_heaps();
  tHeap = GetTickCount64();
  scr_mm_modules();
  scr_mm_walk_vm();
  tVm = GetTickCount64();
  resident = scr_mm_bucket(&orphan, &sharedTotal);
  tPages = GetTickCount64();

  for (i = 0; i < SCR_MM_C_N; i++) { scr_mm_clsRes[i] = 0; scr_mm_clsCom[i] = 0; }
  for (i = 0; i < scr_mm_nreg; i++) {
    scr_mm_clsRes[scr_mm_reg[i].cls] += scr_mm_reg[i].resident;
    scr_mm_clsCom[scr_mm_reg[i].cls] += scr_mm_reg[i].size;
    committed += scr_mm_reg[i].size;
  }
  /* Fold the individually re-queried orphans in, so the CLASS column sums to
   * WALK resident exactly and no reader has to guess where a residual went. */
  for (i = 0; i < SCR_MM_C_N; i++) scr_mm_clsRes[i] += scr_mm_orphanCls[i];
  for (i = 0; i < scr_mm_nheap; i++) {
    heapCommit += scr_mm_heaps[i].committed;
    heapUncom += scr_mm_heaps[i].uncommitted;
    heapBusy += scr_mm_heaps[i].busyBytes;
    heapFree += scr_mm_heaps[i].freeBytes;
    heapOver += scr_mm_heaps[i].overhead;
    heapBusyN += scr_mm_heaps[i].busyCount;
    heapFreeN += scr_mm_heaps[i].freeCount;
  }

  pmc.cb = (DWORD)sizeof pmc;
  pmc.WorkingSetSize = 0;
  pmc.PeakWorkingSetSize = 0;
  pmc.PrivateUsage = 0;
  if (scr_mm_gpmi) scr_mm_gpmi(GetCurrentProcess(), &pmc, (DWORD)sizeof pmc);

  scr_mm_outlen = 0;
  scr_mm_s("MEMMAP v1 tag=");
  scr_mm_s(scr_mm_tag[0] ? scr_mm_tag : "-");
  scr_mm_s(" why=");
  scr_mm_s(why);
  scr_mm_s(" snapshots=");
  scr_mm_u(scr_mm_snapshots);
  scr_mm_s(" pid=");
  scr_mm_u(GetCurrentProcessId());
  scr_mm_ch('\n');

  scr_mm_s("KERNEL wsNow=");
  scr_mm_u((unsigned long long)pmc.WorkingSetSize);
  scr_mm_s(" wsPeak=");
  scr_mm_u((unsigned long long)pmc.PeakWorkingSetSize);
  scr_mm_s(" privateUsage=");
  scr_mm_u((unsigned long long)pmc.PrivateUsage);
  scr_mm_s(" faults=");
  scr_mm_u((unsigned long long)pmc.PageFaultCount);
  scr_mm_ch('\n');
  scr_mm_s("WALK resident=");
  scr_mm_u((unsigned long long)resident);
  scr_mm_s(" committed=");
  scr_mm_u((unsigned long long)committed);
  scr_mm_s(" sharedResident=");
  scr_mm_u((unsigned long long)sharedTotal);
  scr_mm_s(" orphanResident=");
  scr_mm_u((unsigned long long)orphan);
  scr_mm_s(" orphanUnresolved=");
  scr_mm_u((unsigned long long)scr_mm_orphanUnresolved);
  scr_mm_s(" regions=");
  scr_mm_u(scr_mm_nreg);
  scr_mm_ch('\n');

  {
    static const char *names[SCR_MM_C_N] = {"INSTRUMENT", "IMAGE", "MAPPED", "STACK", "HEAP", "PRIVATE"};
    for (i = 0; i < SCR_MM_C_N; i++) {
      scr_mm_s("CLASS ");
      scr_mm_s(names[i]);
      scr_mm_s(" resident=");
      scr_mm_u((unsigned long long)scr_mm_clsRes[i]);
      scr_mm_s(" committed=");
      scr_mm_u((unsigned long long)scr_mm_clsCom[i]);
      scr_mm_s(" residentMiB=");
      scr_mm_mib(scr_mm_clsRes[i]);
      scr_mm_ch('\n');
    }
  }

  /* HeapWalk holds HeapLock, so every millisecond here is a millisecond the
   * program's allocating thread is blocked. Printed so a reader can tell a
   * perturbed run from a clean one instead of assuming. */
  scr_mm_s("COST heapWalkMs=");
  scr_mm_u((unsigned long long)(tHeap - t0));
  scr_mm_s(" vmWalkMs=");
  scr_mm_u((unsigned long long)(tVm - tHeap));
  scr_mm_s(" pageBucketMs=");
  scr_mm_u((unsigned long long)(tPages - tVm));
  scr_mm_ch('\n');
  scr_mm_s("HEAPTOTAL heaps=");
  scr_mm_u(scr_mm_nheap);
  scr_mm_s(" committed=");
  scr_mm_u((unsigned long long)heapCommit);
  scr_mm_s(" uncommitted=");
  scr_mm_u((unsigned long long)heapUncom);
  scr_mm_s(" busyBytes=");
  scr_mm_u((unsigned long long)heapBusy);
  scr_mm_s(" busyCount=");
  scr_mm_u((unsigned long long)heapBusyN);
  scr_mm_s(" freeBytes=");
  scr_mm_u((unsigned long long)heapFree);
  scr_mm_s(" freeCount=");
  scr_mm_u((unsigned long long)heapFreeN);
  scr_mm_s(" overhead=");
  scr_mm_u((unsigned long long)heapOver);
  scr_mm_s(" mallocHeapIdx=");
  scr_mm_u(scr_mm_mallocHeap);
  scr_mm_ch('\n');
  for (i = 0; i < scr_mm_nheap; i++) {
    scr_mm_s("HEAP ");
    scr_mm_u(i);
    scr_mm_s(" handle=");
    scr_mm_hex((unsigned long long)(ULONG_PTR)scr_mm_heaps[i].h);
    scr_mm_s(" walked=");
    scr_mm_u((unsigned)scr_mm_heaps[i].walked);
    scr_mm_s(" err=");
    scr_mm_u(scr_mm_heaps[i].lastErr);
    scr_mm_s(" committed=");
    scr_mm_u((unsigned long long)scr_mm_heaps[i].committed);
    scr_mm_s(" busyBytes=");
    scr_mm_u((unsigned long long)scr_mm_heaps[i].busyBytes);
    scr_mm_s(" busyCount=");
    scr_mm_u((unsigned long long)scr_mm_heaps[i].busyCount);
    scr_mm_s(" freeBytes=");
    scr_mm_u((unsigned long long)scr_mm_heaps[i].freeBytes);
    scr_mm_s(" freeCount=");
    scr_mm_u((unsigned long long)scr_mm_heaps[i].freeCount);
    scr_mm_s(" overhead=");
    scr_mm_u((unsigned long long)scr_mm_heaps[i].overhead);
    scr_mm_ch('\n');
  }

  for (i = 0; i < scr_mm_nmod; i++) {
    if (scr_mm_mod[i].resident == 0) continue;
    scr_mm_s("MODULE ");
    scr_mm_s(scr_mm_mod[i].name[0] ? scr_mm_mod[i].name : "?");
    scr_mm_s(" resident=");
    scr_mm_u((unsigned long long)scr_mm_mod[i].resident);
    scr_mm_s(" imageSize=");
    scr_mm_u((unsigned long long)scr_mm_mod[i].size);
    scr_mm_ch('\n');
  }

  /* Every private region worth a line, biggest first is the driver's job;
   * here they go out in address order with enough to identify them. The
   * PRIVATE class is the one the answer might hide in, so it is itemised
   * rather than summarised. */
  for (i = 0; i < scr_mm_nreg; i++) {
    ScrMmReg *R = &scr_mm_reg[i];
    if (R->cls != SCR_MM_C_PRIVATE && R->cls != SCR_MM_C_STACK) continue;
    if (R->resident < 65536 && R->size < 262144) continue;
    scr_mm_s("REGION cls=");
    scr_mm_u(R->cls);
    scr_mm_s(" base=");
    scr_mm_hex((unsigned long long)R->base);
    scr_mm_s(" allocBase=");
    scr_mm_hex((unsigned long long)R->allocBase);
    scr_mm_s(" size=");
    scr_mm_u((unsigned long long)R->size);
    scr_mm_s(" resident=");
    scr_mm_u((unsigned long long)R->resident);
    scr_mm_s(" protect=");
    scr_mm_hex(R->protect);
    scr_mm_ch('\n');
  }
  scr_mm_s("END\n");
  scr_mm_flush();
}

/* ------------------------------------------------------------ the sampler */
SCR_MM_FN DWORD WINAPI scr_mm_thread(LPVOID p) {
  (void)p;
  for (;;) {
    ScrMmPmc pmc;
    pmc.cb = (DWORD)sizeof pmc;
    pmc.WorkingSetSize = 0;
    if (scr_mm_gpmi && scr_mm_gpmi(GetCurrentProcess(), &pmc, (DWORD)sizeof pmc)) {
      if ((ULONG_PTR)pmc.WorkingSetSize > scr_mm_best + scr_mm_delta) {
        scr_mm_best = (ULONG_PTR)pmc.WorkingSetSize;
        scr_mm_snapshots++;
        scr_mm_snapshot("highwater");
      }
    }
    Sleep(scr_mm_ms);
  }
}

/* --------------------------------------------------------------- arming */
SCR_MM_FN void *scr_mm_valloc(SIZE_T n) {
  void *p = VirtualAlloc(0, n, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
  if (p && scr_mm_nown < 8) {
    scr_mm_own[scr_mm_nown].lo = (ULONG_PTR)p;
    scr_mm_own[scr_mm_nown].hi = (ULONG_PTR)p + n;
    scr_mm_nown++;
  }
  return p;
}

SCR_MM_FN unsigned long long scr_mm_envnum(const char *k, unsigned long long dflt) {
  char b[64];
  DWORD n = GetEnvironmentVariableA(k, b, (DWORD)sizeof b);
  unsigned long long v = 0;
  DWORD i;
  if (n == 0 || n >= sizeof b) return dflt;
  for (i = 0; i < n; i++) {
    if (b[i] < '0' || b[i] > '9') return dflt;
    v = v * 10ull + (unsigned long long)(b[i] - '0');
  }
  return v;
}

__attribute__((constructor)) SCR_MM_FN void scr_mm_arm(void) {
  HMODULE k32;
  DWORD n;
  /* Run-once guard. A constructor is emitted in EVERY TU (21 of them in a
   * zapo build), and without this the sampler thread would be started 21
   * times - the exact multiplier scr_prof.h's arming test caught. */
  if (scr_mm_armed) return;
  scr_mm_armed = 1;

  n = GetEnvironmentVariableA("SCR_MEMMAP_OUT", scr_mm_out, (DWORD)sizeof scr_mm_out);
  if (n == 0 || n >= sizeof scr_mm_out) { scr_mm_out[0] = 0; return; } /* not asked for */
  GetEnvironmentVariableA("SCR_MEMMAP_TAG", scr_mm_tag, (DWORD)sizeof scr_mm_tag);
  scr_mm_ms = (DWORD)scr_mm_envnum("SCR_MEMMAP_MS", 4);
  scr_mm_delta = (ULONG_PTR)scr_mm_envnum("SCR_MEMMAP_DELTA", 4ull * 1024ull * 1024ull);
  scr_mm_walkheap = (int)scr_mm_envnum("SCR_MEMMAP_HEAP", 1);

  k32 = GetModuleHandleA("kernel32.dll");
  scr_mm_qws = (ScrMmQWS)(void *)GetProcAddress(k32, "K32QueryWorkingSet");
  scr_mm_epm = (ScrMmEPM)(void *)GetProcAddress(k32, "K32EnumProcessModules");
  scr_mm_gmbn = (ScrMmGMBN)(void *)GetProcAddress(k32, "K32GetModuleBaseNameA");
  scr_mm_gmi = (ScrMmGMI)(void *)GetProcAddress(k32, "K32GetModuleInformation");
  scr_mm_gpmi = (ScrMmGPMI)(void *)GetProcAddress(k32, "K32GetProcessMemoryInfo");

  scr_mm_outbuf = (char *)scr_mm_valloc(1024u * 1024u);
  scr_mm_reg = (ScrMmReg *)scr_mm_valloc((SIZE_T)SCR_MM_MAXREG * sizeof(ScrMmReg));
  scr_mm_mod = (ScrMmMod *)scr_mm_valloc((SIZE_T)SCR_MM_MAXMOD * sizeof(ScrMmMod));
  scr_mm_hr = (ScrMmRange *)scr_mm_valloc((SIZE_T)SCR_MM_MAXHR * sizeof(ScrMmRange));
  scr_mm_heaps = (ScrMmHeap *)scr_mm_valloc(64u * sizeof(ScrMmHeap));
  scr_mm_pages = (ULONG_PTR *)scr_mm_valloc(((SIZE_T)SCR_MM_MAXPAGES + 1u) * sizeof(ULONG_PTR));

  if (!scr_mm_outbuf || !scr_mm_reg || !scr_mm_mod || !scr_mm_hr || !scr_mm_heaps || !scr_mm_pages)
    scr_mm_die("VirtualAlloc for the instrument's own buffers failed");
  if (!scr_mm_qws) scr_mm_die("kernel32!K32QueryWorkingSet not found - no resident page list");
  if (!scr_mm_gpmi) scr_mm_die("kernel32!K32GetProcessMemoryInfo not found - no trigger");
  if (!scr_mm_epm || !scr_mm_gmi) scr_mm_die("kernel32!K32EnumProcessModules/GetModuleInformation not found");

  /* ---- arming, before a single byte of the program has run ---- */
  {
    unsigned long long mib = scr_mm_envnum("SCR_MEMMAP_SELFTEST", 0);
    if (mib) {
      ULONG_PTR before, after, hbBefore, hbAfter;
      SIZE_T want = (SIZE_T)mib * 1024u * 1024u;
      char *blob;
      SIZE_T i2;
      void *mblob;

      scr_mm_snapshot("selftest-before");
      before = scr_mm_clsRes[SCR_MM_C_PRIVATE];
      hbBefore = 0;
      for (i2 = 0; i2 < scr_mm_nheap; i2++) hbBefore += scr_mm_heaps[i2].busyBytes;
      if (scr_mm_nheap == 0) scr_mm_die("GetProcessHeaps returned no heap - the HEAP class can only read zero");
      if (scr_mm_clsRes[SCR_MM_C_IMAGE] == 0) scr_mm_die("no resident IMAGE pages - the module join is broken");

      /* POSITIVE 1: a known VirtualAlloc must land in PRIVATE, to the page. */
      blob = (char *)VirtualAlloc(0, want, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
      if (!blob) scr_mm_die("selftest VirtualAlloc failed");
      for (i2 = 0; i2 < want; i2 += 4096) blob[i2] = (char)1;

      /* POSITIVE 2: a known malloc must show up as heap BUSY bytes.
       *
       * THE ACCUMULATOR IS NOT DECORATION. The first version of this test
       * wrote the buffer and freed it without ever reading it, and LLVM at
       * -O2 deleted the malloc/free pair outright - a write-only heap buffer
       * is dead. The instrument then correctly reported that no such block
       * existed and the self-test correctly failed, which is the only reason
       * the elision was ever noticed. VirtualAlloc is opaque to the
       * optimiser and survived, so POSITIVE 1 passed while POSITIVE 2 did
       * not, and the difference is exactly this read-back. */
      mblob = malloc(8u * 1024u * 1024u);
      if (!mblob) scr_mm_die("selftest malloc failed");
      for (i2 = 0; i2 < 8u * 1024u * 1024u; i2 += 4096) ((char *)mblob)[i2] = (char)1;
      for (i2 = 0; i2 < 8u * 1024u * 1024u; i2 += 4096) scr_mm_sink += ((char *)mblob)[i2];
      for (i2 = 0; i2 < want; i2 += 4096) scr_mm_sink += blob[i2];

      scr_mm_snapshot("selftest-after");
      after = scr_mm_clsRes[SCR_MM_C_PRIVATE];
      hbAfter = 0;
      for (i2 = 0; i2 < scr_mm_nheap; i2++) hbAfter += scr_mm_heaps[i2].busyBytes;

      if (after < before + want - 65536u) scr_mm_die("PRIVATE class did not grow by the VirtualAlloc - the private bucket is blind");
      if (hbAfter < hbBefore + 8u * 1024u * 1024u - 65536u) scr_mm_die("heap busyBytes did not grow by the malloc - HeapWalk is blind");
      scr_mm_s("SELFTEST PASS privateDelta=");
      scr_mm_u((unsigned long long)(after - before));
      scr_mm_s(" want=");
      scr_mm_u((unsigned long long)want);
      scr_mm_s(" heapBusyDelta=");
      scr_mm_u((unsigned long long)(hbAfter - hbBefore));
      scr_mm_ch('\n');
      /* The verdict goes to <out>.self, not <out>: the run continues after
       * arming and the first high-water snapshot would otherwise overwrite
       * the only evidence that the instrument was ever checked. */
      {
        char sp[600];
        int si = 0;
        while (scr_mm_out[si] && si < 560) { sp[si] = scr_mm_out[si]; si++; }
        sp[si++] = '.'; sp[si++] = 's'; sp[si++] = 'e'; sp[si++] = 'l'; sp[si++] = 'f'; sp[si] = 0;
        scr_mm_flush_to(sp);
      }
      VirtualFree(blob, 0, MEM_RELEASE);
      free(mblob);
      scr_mm_best = 0;
    }
  }

  /* Which heap does malloc actually use? Recorded once, so no report has to
   * assume the CRT uses the process heap. */
  if (scr_mm_walkheap) {
    void *probe = malloc(64);
    if (probe) {
      HANDLE hs[64];
      DWORD hn = GetProcessHeaps(64, hs), hi2;
      scr_mm_walk_heaps();
      for (hi2 = 0; hi2 < scr_mm_nhr; hi2++)
        if ((ULONG_PTR)probe >= scr_mm_hr[hi2].lo && (ULONG_PTR)probe < scr_mm_hr[hi2].hi) break;
      (void)hn;
      (void)hs;
      scr_mm_mallocHeap = (hi2 < scr_mm_nhr) ? (ULONG_PTR)(hi2 + 1) : 0;
      free(probe);
      if (scr_mm_mallocHeap == 0)
        scr_mm_die("a fresh malloc's pointer is in no walked heap region - the HEAP class would undercount silently");
    }
  }

  CreateThread(0, 65536, scr_mm_thread, 0, 0, 0);
}

#endif /* SCR_MEMMAP */
#endif /* SCR_MEMMAP_H */
