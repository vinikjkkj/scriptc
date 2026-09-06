/* scr_heap_census.h - WHAT the settled heap's blocks ARE, by exact size.
 *
 * WHY THIS EXISTS. Two blocks narrowed a WhatsApp history sync's retention
 * to one number and then could go no further:
 *
 *   pairfail   presync 32 MiB -> peak 267 -> settled 133, flat at +60 s.
 *   heaptrim   at settled, of 122.9 MiB of committed CRT heap, 95.70 MiB is
 *              BUSY across 175,041 blocks. HeapCompact releases 0.00 MiB.
 *              So it is not reclaimable garbage and a trim cannot have it.
 *
 * Neither could say what the 175,041 blocks WERE, and the two instruments
 * that could are both blind here:
 *
 *   tests/perf/cycensus attributes scr_cyc_alloc EXACTLY, by object kind -
 *   and on this workload it reports 4.12 MiB live at settled out of a
 *   96.0 MB peak. The cycle graph is nearly EMPTY when the heap is full, so
 *   the population this file has to explain is the one cycensus does not
 *   see: strings, byte buffers, map tables, array stores, and - the reason
 *   the two arenas matter - the 64 KiB CHUNKS those arenas malloc and never
 *   give back.
 *
 *   tests/perf/prof keys on a "file:line" site, which is the right key, and
 *   pairfail reports its -DSCR_PROF_ALLOC -DSCR_PROF_LIVE build hanging in
 *   the type-check phase, twice, ~50 min each.
 *
 * An exact-size histogram of the BUSY blocks needs neither. It is read from
 * the allocator itself at exit, it cannot miss an allocation (no
 * interposition, no site key, no per-allocation table to overflow), and on
 * a heap whose occupants are one arena chunk size, a handful of struct
 * sizes and a string-length distribution, the size IS most of the
 * identification.
 *
 * NO <windows.h>, for tests/perf/cycensus's reason: scr_prof.h needs it and
 * paid with scr_fetch_dispatch.c's fd_set collision, because a header like
 * this is force-included before EVERY translation unit. The five calls and
 * the one struct are declared here instead, and the struct's layout is
 * checked with _Static_assert rather than trusted.
 *
 * EVERY HEAP, not just the CRT's. heaptrim's census walked
 * _get_heap_handle() alone; GetProcessHeaps says how many there are, and a
 * census that reports one of five heaps as "the heap" is a floor wearing a
 * total's clothes.
 *
 * HOW TO USE IT
 *   SCRIPTC_PROF_CFLAGS="-include <repo>/tests/perf/cycstat/scr_cyc_stat.h
 *                        -DSCR_CYCSTAT_ON
 *                        -include <repo>/tests/perf/heapcensus/scr_heap_census.h"
 *   SCR_HEAPCEN_OUT=<file>   where the report is written (default stderr)
 *
 * IT REPORTS AT _Exit, NOT ONLY AT atexit. A compiled program's
 * process.exit() lowers to scr_process_exit(), which ends in _Exit and
 * skips every atexit handler - so the two instruments this header travels
 * with (cycstat, and this one) would both write nothing on the one exit
 * route a service has. The macro below closes that, and it CHAINS: cycstat
 * registers an atexit handler only, so this header calls its report
 * directly when it is armed.
 */
#ifndef SCR_HEAP_CENSUS_H
#define SCR_HEAP_CENSUS_H

#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <malloc.h>

#define SCR_HC_SHARED __attribute__((selectany))
#define SCR_HC_FN static __attribute__((unused)) __attribute__((no_instrument_function))

#ifdef _WIN32

/* The SDK's PROCESS_HEAP_ENTRY, spelled out. Offsets and size are asserted
 * below: a layout that drifted would read cbData out of the wrong bytes and
 * report a plausible, wrong histogram. */
typedef struct ScrHcEntry {
  void *lpData;
  unsigned long cbData;
  unsigned char cbOverhead;
  unsigned char iRegionIndex;
  unsigned short wFlags;
  union {
    struct { void *hMem; unsigned long dwReserved[3]; } Block;
    struct {
      unsigned long dwCommittedSize;
      unsigned long dwUnCommittedSize;
      void *lpFirstBlock;
      void *lpLastBlock;
    } Region;
  } u;
} ScrHcEntry;
_Static_assert(offsetof(ScrHcEntry, cbData) == 8, "PROCESS_HEAP_ENTRY.cbData");
_Static_assert(offsetof(ScrHcEntry, wFlags) == 14, "PROCESS_HEAP_ENTRY.wFlags");
_Static_assert(offsetof(ScrHcEntry, u) == 16, "PROCESS_HEAP_ENTRY union");
_Static_assert(sizeof(ScrHcEntry) == 40, "PROCESS_HEAP_ENTRY is 40 bytes on x64");

#define SCR_HC_REGION 0x0001u
#define SCR_HC_UNCOMMITTED 0x0002u
#define SCR_HC_BUSY 0x0004u

/* NOT declared under their own names. This header is force-included ahead
 * of every translation unit, and several of them include <windows.h>
 * afterwards - which declares HeapWalk taking LPPROCESS_HEAP_ENTRY. A
 * second declaration of the same name taking ScrHcEntry * is a conflicting
 * type and the TU does not compile. The assembler name binds to the import
 * without the C name ever existing here, so <windows.h> stays free to
 * declare its own. */
int __stdcall scr_hc_HeapWalk(void *, ScrHcEntry *) __asm__("HeapWalk");
int __stdcall scr_hc_HeapLock(void *) __asm__("HeapLock");
int __stdcall scr_hc_HeapUnlock(void *) __asm__("HeapUnlock");
unsigned long __stdcall scr_hc_GetProcessHeaps(unsigned long, void **) __asm__("GetProcessHeaps");

/* Exact sizes, open-addressed. 16k rows is far more distinct block sizes
 * than any heap here carries; an overflow bumps scr_hc_lost, which the
 * report prints and the reader refuses on, so it can never read as a zero. */
#ifndef SCR_HEAPCEN_SLOTS
#define SCR_HEAPCEN_SLOTS 16384u
#endif

typedef struct { size_t size; size_t n; size_t bytes; } ScrHcRow;
SCR_HC_SHARED ScrHcRow scr_hc_tbl[SCR_HEAPCEN_SLOTS] = {{0, 0, 0}};
SCR_HC_SHARED size_t scr_hc_rows = 0;
SCR_HC_SHARED size_t scr_hc_lost = 0;
SCR_HC_SHARED int scr_hc_reported = 0;

SCR_HC_FN void scr_hc_note(size_t size, size_t overhead) {
  unsigned long long x = (unsigned long long)size;
  x ^= x >> 33;
  x *= 0xff51afd7ed558ccdULL;
  x ^= x >> 29;
  x *= 0xc4ceb9fe1a85ec53ULL;
  x ^= x >> 32;
  unsigned h = (unsigned)(x & (SCR_HEAPCEN_SLOTS - 1u));
  for (unsigned i = 0; i < SCR_HEAPCEN_SLOTS; i++) {
    unsigned j = (h + i) & (SCR_HEAPCEN_SLOTS - 1u);
    if (scr_hc_tbl[j].n != 0 && scr_hc_tbl[j].size != size) continue;
    if (scr_hc_tbl[j].n == 0) {
      scr_hc_tbl[j].size = size;
      scr_hc_rows++;
    }
    scr_hc_tbl[j].n++;
    scr_hc_tbl[j].bytes += size + overhead;
    return;
  }
  scr_hc_lost++;
}

/* THE ARM. A census that cannot tell "found none" from "could not look"
 * reports zero and is believed, so a known population is planted before the
 * walk: SCR_HEAPCEN_ARM blocks of an unusual size that nothing else in this
 * process allocates. The reader refuses every number when the arm row is
 * absent or its count is wrong. The blocks are freed straight after the
 * walk, so the arm costs the measured heap nothing but its own bytes, which
 * the report names. */
#ifndef SCR_HEAPCEN_ARM
#define SCR_HEAPCEN_ARM 137u
#endif
#ifndef SCR_HEAPCEN_ARM_SIZE
#define SCR_HEAPCEN_ARM_SIZE 5113u
#endif

SCR_HC_FN void scr_hc_report(void) {
  if (scr_hc_reported) return;
  scr_hc_reported = 1;
  FILE *f = stderr;
  {
    const char *out = getenv("SCR_HEAPCEN_OUT");
    if (out != NULL && *out != 0) {
      FILE *g = fopen(out, "w");
      if (g != NULL) f = g;
    }
  }
  fprintf(f, "[heapcen] ARMED tests/perf/heapcensus/scr_heap_census.h\n");

  void **heaps = NULL;
  unsigned long nh = scr_hc_GetProcessHeaps(0, NULL);
  if (nh > 0) {
    heaps = (void **)malloc((size_t)nh * sizeof(void *));
    if (heaps != NULL) nh = scr_hc_GetProcessHeaps(nh, heaps);
  }
  void *crt = (void *)(intptr_t)_get_heap_handle();
  fprintf(f, "[heapcen] processHeaps=%lu crtHeap=%p\n", nh, crt);

  void **arm = (void **)malloc(SCR_HEAPCEN_ARM * sizeof(void *));
  size_t armed = 0;
  if (arm != NULL) {
    for (size_t i = 0; i < SCR_HEAPCEN_ARM; i++) {
      arm[i] = malloc(SCR_HEAPCEN_ARM_SIZE);
      if (arm[i] != NULL) {
        memset(arm[i], 0x5a, 16);
        armed++;
      }
    }
  }

  size_t gbusy = 0, gfree = 0, gnbusy = 0, gnfree = 0, guncommitted = 0;
  for (unsigned long k = 0; k < nh && heaps != NULL; k++) {
    ScrHcEntry e;
    size_t busy = 0, freeb = 0, nbusy = 0, nfree = 0, unc = 0, nregion = 0;
    memset(&e, 0, sizeof e);
    scr_hc_HeapLock(heaps[k]);
    while (scr_hc_HeapWalk(heaps[k], &e)) {
      if (e.wFlags & SCR_HC_BUSY) {
        busy += (size_t)e.cbData + e.cbOverhead;
        nbusy++;
        if (heaps[k] == crt) scr_hc_note((size_t)e.cbData, (size_t)e.cbOverhead);
      } else if (e.wFlags & SCR_HC_UNCOMMITTED) {
        unc += (size_t)e.cbData;
      } else if (e.wFlags & SCR_HC_REGION) {
        nregion++;
      } else {
        freeb += (size_t)e.cbData + e.cbOverhead;
        nfree++;
      }
    }
    scr_hc_HeapUnlock(heaps[k]);
    fprintf(f,
            "[heapcen] heap %lu %p%s busy=%zu busyBlocks=%zu free=%zu"
            " freeBlocks=%zu uncommitted=%zu regions=%zu\n",
            k, heaps[k], heaps[k] == crt ? " CRT" : "", busy, nbusy, freeb,
            nfree, unc, nregion);
    gbusy += busy;
    gfree += freeb;
    gnbusy += nbusy;
    gnfree += nfree;
    guncommitted += unc;
  }
  fprintf(f,
          "[heapcen] ALLHEAPS busy=%zu busyBlocks=%zu free=%zu freeBlocks=%zu"
          " uncommitted=%zu\n",
          gbusy, gnbusy, gfree, gnfree, guncommitted);

  /* one line per DISTINCT BUSY SIZE on the CRT heap, unsorted and
   * unaggregated - the reader ranks and folds, this only counts. */
  size_t tn = 0, tb = 0;
  for (size_t i = 0; i < SCR_HEAPCEN_SLOTS; i++) {
    if (scr_hc_tbl[i].n == 0) continue;
    fprintf(f, "HCSIZE %zu %zu %zu\n", scr_hc_tbl[i].size, scr_hc_tbl[i].n,
            scr_hc_tbl[i].bytes);
    tn += scr_hc_tbl[i].n;
    tb += scr_hc_tbl[i].bytes;
  }
  fprintf(f,
          "[heapcen] HCTOTAL distinctSizes=%zu blocks=%zu bytes=%zu lost=%zu"
          " armCount=%zu armSize=%u\n",
          scr_hc_rows, tn, tb, scr_hc_lost, armed,
          (unsigned)SCR_HEAPCEN_ARM_SIZE);

  if (arm != NULL) {
    for (size_t i = 0; i < SCR_HEAPCEN_ARM; i++) free(arm[i]);
    free(arm);
  }
  free(heaps);

#ifdef SCR_CYCSTAT_ON
  /* cycstat registers an atexit handler only, and _Exit skips those. Its
   * two arena chunk counters are half of what this census exists to pair
   * with, so its report is called here rather than being silently absent. */
  scr_cs_report();
#endif
  if (f != stderr) fclose(f);
}

/* SHARED, not a function-local static: the constructor is emitted in every
 * translation unit and a per-TU flag would register ~70 atexit handlers. */
SCR_HC_SHARED int scr_hc_installed = 0;
__attribute__((constructor)) SCR_HC_FN void scr_hc_install(void) {
  if (scr_hc_installed) return;
  scr_hc_installed = 1;
  atexit(scr_hc_report);
}

#if defined(_Exit) && defined(SCR_CYCEN_ON)
#undef _Exit
#define _Exit(c) (scr_hc_report(), scr_cycen_report(), _Exit(c))
#elif !defined(_Exit)
#define _Exit(c) (scr_hc_report(), _Exit(c))
#else
#error "another header already interposes _Exit; chain it here explicitly"
#endif

#endif /* _WIN32 */
#endif /* SCR_HEAP_CENSUS_H */
