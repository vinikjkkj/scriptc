/* scr_arena.h - a private, non-decommitting allocator, injected the same way
 * scr_prof.h is.
 *
 * WHY IT EXISTS, in one measured sentence: the mingw CRT heap gives pages
 * back to the OS when a large region goes free at once, and the zapo
 * messaging bench releases in exactly that shape, so it pays 482,807 page
 * faults for allocations that cost 25,973 against an allocator that never
 * decommits (dynimp-lab/arena/churn.c, both arms 15,091,036 allocations and
 * a 77.11 MiB live peak replayed from live-3phase.txt).
 *
 * WHAT WAS REFUTED ON THE WAY, because it was the standing explanation:
 * churn ALONE does not cause this. The same 15.09 M allocations and 1.65 GiB
 * through the CRT, evicting one block per allocation instead of in waves,
 * cost 26,887 faults -- which is 104.64 MiB / 4 KiB, one fault per resident
 * page and no re-faulting whatsoever. The trigger is the RELEASE PATTERN.
 *
 * Injected through SCRIPTC_PROF_CFLAGS with -include, so it reaches every
 * runtime scr_*.c and the program's own emitted TU. It follows the linkage
 * rules scr_prof.h established for this target and for this many TUs:
 * shared DATA is __attribute__((selectany)) with an explicit initialiser
 * (a COMDAT with "any" selection, so duplicates merge into one instance),
 * and every FUNCTION is static. Nothing here needs an external name, so
 * none of the three walls that close -finstrument-functions apply.
 *
 * THREE DESIGN POINTS THAT ARE LOAD-BEARING FOR THE BYTES:
 *
 * 1. NO PER-OBJECT HEADER. Chunks are 64 KiB and 64 KiB-aligned, because
 *    VirtualAlloc's allocation granularity IS 64 KiB and every block is
 *    carved to stay inside one chunk, so a block's chunk base is exactly
 *    p & ~0xFFFF and the chunk header carries the size class. A 16-byte
 *    header would have cost 30% on the 52-byte objects that are 35.6% of
 *    this workload's allocations (scr_bigint.c:39, 5,365,508 of them).
 *
 * 2. FOREIGN POINTERS ARE DISCRIMINATED BY A RANGE CHECK on the single
 *    reservation, not by a magic number. libc and the vendored archives
 *    (monocypher, the regex engine) are compiled without this header and
 *    keep calling the CRT, so their pointers must reach the CRT's free()
 *    and ours must never. An address range is exact; a magic word in a
 *    header we do not control would be a guess.
 *
 * 3. ANYTHING OVER 4096 BYTES PASSES THROUGH TO THE CRT. 52 of the
 *    15,091,036 measured allocations are larger. Sizing a class ladder for
 *    them would add slack for no traffic.
 *
 * WHAT IT COSTS. It never returns pages. Peak RSS measured 2.8% BETTER than
 * the CRT (100.86 vs 103.80 MiB, because the CRT's own slack is larger than
 * the class ladder's 12.2%), but end-of-run RSS is 2.5x worse: 100.86 MiB
 * against 39.92. Peak is what the target names; steady-state footprint after
 * a burst is strictly worse and this header does not pretend otherwise.
 *
 * SCR_ARENA_OUT names a file to write the arena's own counters to at exit.
 */
#ifndef SCR_ARENA_H
#define SCR_ARENA_H

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* NOT <windows.h>. This header is force-included into EVERY translation
 * unit, and windows.h drags in winsock's `fd_set`, which collides with
 * scr_fetch_dispatch.c:104's own static helper of that name -- 20 errors
 * across four call sites, measured, not predicted. Only two Win32 entry
 * points are needed, so they are declared here with mingw-w64's exact
 * signatures (WINBASEAPI = __declspec(dllimport), WINAPI = __stdcall,
 * SIZE_T = unsigned long long, DWORD = unsigned long) and a TU that
 * includes windows.h itself sees an identical redeclaration. */
__declspec(dllimport) void *__stdcall VirtualAlloc(void *, unsigned long long,
                                                   unsigned long, unsigned long);
#define SCR_AR_MEM_COMMIT   0x00001000UL
#define SCR_AR_MEM_RESERVE  0x00002000UL
#define SCR_AR_PAGE_RW      0x00000004UL

#define SCR_AR_SHARED __attribute__((selectany))
#define SCR_AR_FN static __attribute__((unused))

#define SCR_AR_CHUNK_BITS 16
#define SCR_AR_CHUNK ((size_t)1 << SCR_AR_CHUNK_BITS)   /* 64 KiB */
#define SCR_AR_MAX_SMALL 4096
/* 16-byte granularity to 1024, then 128 to 4096: 64 + 24 classes. Every
 * class size is a multiple of 16 and the header is 32, so every block is
 * 16-byte aligned, which is malloc's contract on this target. */
#define SCR_AR_NCLASS (64 + 24)
/* Address space only. 768 MiB of RESERVE costs no commit and no working
 * set; the measured peak commit for the full workload is 86.50 MiB. */
#define SCR_AR_RESERVE ((size_t)768 << 20)

typedef struct { unsigned cls; unsigned pad[7]; } ScrArChunkHdr; /* 32 B */

SCR_AR_SHARED unsigned char *scr_ar_base = 0;
SCR_AR_SHARED unsigned char *scr_ar_end = 0;
SCR_AR_SHARED unsigned char *scr_ar_bump = 0;
SCR_AR_SHARED void *scr_ar_free[SCR_AR_NCLASS] = {0};
SCR_AR_SHARED unsigned scr_ar_csize[SCR_AR_NCLASS] = {0};
SCR_AR_SHARED unsigned char scr_ar_cof[SCR_AR_MAX_SMALL / 16 + 1] = {0};
SCR_AR_SHARED long long scr_ar_committed = 0;
SCR_AR_SHARED long long scr_ar_chunks = 0;
SCR_AR_SHARED long long scr_ar_small = 0;
SCR_AR_SHARED long long scr_ar_large = 0;
SCR_AR_SHARED long long scr_ar_freed = 0;
SCR_AR_SHARED long long scr_ar_foreign = 0;
SCR_AR_SHARED long long scr_ar_live = 0;
SCR_AR_SHARED long long scr_ar_live_peak = 0;
/* 0 none, 1 in progress, 2 ready. */
SCR_AR_SHARED volatile int scr_ar_state = 0;
/* A spin lock rather than a CRITICAL_SECTION, because a CRITICAL_SECTION
 * is a windows.h type and this header cannot include windows.h (see the
 * fd_set note above). The critical region is a few loads and stores, so a
 * spin with a pause hint is the right shape for it anyway -- the CRT's own
 * malloc takes a lock of the same span. */
SCR_AR_SHARED volatile int scr_ar_lock = 0;
SCR_AR_SHARED int scr_ar_reported = 0;

SCR_AR_FN void scr_ar_report(void);

SCR_AR_FN void scr_ar_setup(void) {
  int i, c;
  for (i = 0; i < 64; i++) scr_ar_csize[i] = (unsigned)(i + 1) * 16u;
  for (i = 0; i < 24; i++) scr_ar_csize[64 + i] = 1024u + (unsigned)(i + 1) * 128u;
  c = 0;
  for (i = 0; i <= SCR_AR_MAX_SMALL / 16; i++) {
    unsigned want = (unsigned)i * 16u; if (want == 0) want = 16u;
    while (scr_ar_csize[c] < want) c++;
    scr_ar_cof[i] = (unsigned char)c;
  }
  scr_ar_base = (unsigned char *)VirtualAlloc(NULL, SCR_AR_RESERVE,
                                              SCR_AR_MEM_RESERVE, SCR_AR_PAGE_RW);
  /* A failed reservation is not fatal: every path below falls back to the
   * CRT, so the program runs exactly as it does today. */
  scr_ar_end = scr_ar_base ? scr_ar_base + SCR_AR_RESERVE : 0;
  scr_ar_bump = scr_ar_base;
  atexit(scr_ar_report);
}

SCR_AR_FN void scr_ar_enter(void) {
  int expect;
  for (;;) {
    expect = 0;
    if (__atomic_compare_exchange_n(&scr_ar_lock, &expect, 1, 0,
                                    __ATOMIC_ACQUIRE, __ATOMIC_RELAXED)) return;
    __builtin_ia32_pause();
  }
}

SCR_AR_FN void scr_ar_leave(void) {
  __atomic_store_n(&scr_ar_lock, 0, __ATOMIC_RELEASE);
}

SCR_AR_FN void scr_ar_init(void) {
  int expect = 0;
  if (__atomic_load_n(&scr_ar_state, __ATOMIC_ACQUIRE) == 2) return;
  if (__atomic_compare_exchange_n(&scr_ar_state, &expect, 1, 0,
                                  __ATOMIC_ACQ_REL, __ATOMIC_RELAXED)) {
    scr_ar_setup();
    __atomic_store_n(&scr_ar_state, 2, __ATOMIC_RELEASE);
  } else {
    while (__atomic_load_n(&scr_ar_state, __ATOMIC_ACQUIRE) != 2)
      __builtin_ia32_pause();
  }
}

/* Caller holds the lock. */
SCR_AR_FN int scr_ar_chunk(unsigned cls) {
  unsigned char *p, *q, *lim;
  unsigned sz;
  if (!scr_ar_base || scr_ar_bump + SCR_AR_CHUNK > scr_ar_end) return 0;
  p = (unsigned char *)VirtualAlloc(scr_ar_bump, SCR_AR_CHUNK,
                                    SCR_AR_MEM_COMMIT, SCR_AR_PAGE_RW);
  if (!p) return 0;
  scr_ar_bump += SCR_AR_CHUNK;
  scr_ar_committed += (long long)SCR_AR_CHUNK;
  scr_ar_chunks++;
  ((ScrArChunkHdr *)p)->cls = cls;
  sz = scr_ar_csize[cls];
  q = p + sizeof(ScrArChunkHdr);
  lim = p + SCR_AR_CHUNK - sz;
  while (q <= lim) { *(void **)q = scr_ar_free[cls]; scr_ar_free[cls] = q; q += sz; }
  return 1;
}

SCR_AR_FN int scr_ar_owns(void *p) {
  return scr_ar_base && (unsigned char *)p >= scr_ar_base
                     && (unsigned char *)p < scr_ar_end;
}

SCR_AR_FN unsigned scr_ar_clsof(void *p) {
  return ((ScrArChunkHdr *)((uintptr_t)p & ~(uintptr_t)(SCR_AR_CHUNK - 1)))->cls;
}

SCR_AR_FN void *scr_ar_malloc(size_t n) {
  unsigned cls; void *p;
  if (__atomic_load_n(&scr_ar_state, __ATOMIC_ACQUIRE) != 2) scr_ar_init();
  if (n == 0) n = 1;
  if (n > SCR_AR_MAX_SMALL) { scr_ar_large++; return malloc(n); }
  cls = scr_ar_cof[(n + 15) >> 4];
  scr_ar_enter();
  p = scr_ar_free[cls];
  if (!p) {
    if (!scr_ar_chunk(cls)) {
      scr_ar_leave();
      scr_ar_large++;
      return malloc(n);
    }
    p = scr_ar_free[cls];
  }
  scr_ar_free[cls] = *(void **)p;
  scr_ar_small++;
  scr_ar_live += scr_ar_csize[cls];
  if (scr_ar_live > scr_ar_live_peak) scr_ar_live_peak = scr_ar_live;
  scr_ar_leave();
  return p;
}

SCR_AR_FN void scr_ar_free_(void *p) {
  unsigned cls;
  if (!p) return;
  if (!scr_ar_owns(p)) { scr_ar_foreign++; free(p); return; }
  cls = scr_ar_clsof(p);
  scr_ar_enter();
  *(void **)p = scr_ar_free[cls];
  scr_ar_free[cls] = p;
  scr_ar_live -= scr_ar_csize[cls];
  scr_ar_freed++;
  scr_ar_leave();
}

SCR_AR_FN void *scr_ar_calloc(size_t a, size_t b) {
  size_t n = a * b; void *p;
  if (a != 0 && n / a != b) return NULL;            /* overflow */
  if (n > SCR_AR_MAX_SMALL) { scr_ar_large++; return calloc(a, b); }
  p = scr_ar_malloc(n);
  if (p) memset(p, 0, n);
  return p;
}

SCR_AR_FN void *scr_ar_realloc(void *p, size_t n) {
  unsigned cls; size_t old; void *q;
  if (!p) return scr_ar_malloc(n);
  if (!scr_ar_owns(p)) {
    /* A CRT block stays a CRT block: realloc may keep it in place, and
     * moving it into the arena would only add a copy. */
    scr_ar_foreign++;
    return realloc(p, n);
  }
  cls = scr_ar_clsof(p);
  old = scr_ar_csize[cls];
  if (n == 0) n = 1;
  /* Same class in, same block out -- no copy, and no shrink either, because
   * a shrink that changed class would have to move the block anyway. */
  if (n <= SCR_AR_MAX_SMALL && scr_ar_cof[(n + 15) >> 4] == cls) return p;
  q = scr_ar_malloc(n);
  if (!q) return NULL;
  memcpy(q, p, n < old ? n : old);
  scr_ar_free_(p);
  return q;
}

SCR_AR_FN char *scr_ar_strdup(const char *s) {
  size_t n; char *p;
  if (!s) return NULL;
  n = strlen(s) + 1;
  p = (char *)scr_ar_malloc(n);
  if (p) memcpy(p, s, n);
  return p;
}

SCR_AR_FN void scr_ar_report(void) {
  const char *path; FILE *f;
  if (scr_ar_reported) return;
  scr_ar_reported = 1;
  path = getenv("SCR_ARENA_OUT");
  if (!path || !*path) return;
  f = fopen(path, "w");
  if (!f) return;
  fprintf(f, "ARENA chunks=%lld committedBytes=%lld small=%lld large=%lld "
             "freed=%lld foreign=%lld livePeakBytes=%lld liveNowBytes=%lld\n",
          scr_ar_chunks, scr_ar_committed, scr_ar_small, scr_ar_large,
          scr_ar_freed, scr_ar_foreign, scr_ar_live_peak, scr_ar_live);
  fclose(f);
}

#define malloc(n)     scr_ar_malloc((n))
#define calloc(a, b)  scr_ar_calloc((a), (b))
#define realloc(p, n) scr_ar_realloc((p), (n))
#define free(p)       scr_ar_free_((p))
#define strdup(s)     scr_ar_strdup((s))
#define _strdup(s)    scr_ar_strdup((s))

#endif /* SCR_ARENA_H */
