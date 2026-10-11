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
 * route a service has. The macro below closes that, and it CHAINS.
 *
 * ***CORRECTED 2026-10-11. The sentence that stood here said cycstat
 * 'registers an atexit handler only'. IT DOES NOT: scr_cyc_stat.h:274-281
 * interposes _Exit exactly as this file does. So the composition this
 * header's own HOW TO USE IT block prescribes -- cycstat then
 * heapcensus -- did not COMPOSE, it was a COMPILE ERROR: _Exit was
 * already a macro, SCR_CYCEN_ON and SCR_PROF_H were both absent, and the
 * #else below fired with 'another header already interposes _Exit'. It
 * fails on the first mbedtls vendor unit of app182 and on the stock tree
 * at 5fa7a24f8, so the documented arm had never been built; every census
 * committed on this program carries scr_prof.h, and now it is clear that
 * was not a choice.
 *
 * THIS IS THE SECOND TIME THIS EXACT SHAPE HAS BEEN FOUND HERE.
 * WHICH-BUFFER.md ss.0 records the first: census-arms.sh:21 documented
 * the order 'prof -> heapcensus', and that was a compile error too. The
 * repair at 21facf366 added a branch for SCR_PROF_H and for
 * SCR_CYCEN_ON -- and not for SCR_CYCSTAT_ON, which is the one this
 * file's own usage block names. A chain with a branch per KNOWN partner
 * and an #error for everything else makes every new partner a build
 * failure found at the END of a sixteen-minute build; the branch for
 * cycstat is added below, and the #error is kept because an UNKNOWN
 * interposer silently dropping a report is worse.
 *
 * scr_hc_report already calls scr_cs_report under #ifdef SCR_CYCSTAT_ON,
 * so the cycstat branch has nothing extra to chain: it only has to
 * REPLACE cycstat's own interposition rather than collide with it.***
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

/* -- THE FREE SIDE, which is where the retention actually is -------------
 *
 * This census was written to identify the BUSY blocks, and it did. But on
 * the settled zapo process the busy side is 40.65 MiB and the free side is
 * 72.84 MiB: the heap holds nearly twice as much committed-but-free space
 * as it holds live data, and retention above the presync baseline (75.4
 * MiB) is almost exactly that free space. Until now this file reported the
 * free side as two scalars -- `free=` and `freeBlocks=` -- which is enough
 * to know the number and not enough to know anything about it.
 *
 * Two questions, and they need different instruments:
 *
 * 1. WHAT SIZE ARE THE HOLES. A second exact-size table, identical to the
 *    busy one. 107,512 holes averaging 710 B could be one population or
 *    twenty, and the mean cannot tell them apart. There is a specific
 *    hypothesis to test: a ScrDyn node is exactly 64 bytes (ScrCycHdr 16 +
 *    sizeof(ScrDyn) 48) and boxing a record allocates one per scalar in the
 *    whole reachable tree, so a sync that boxes app-state records churns
 *    hundreds of thousands of 64-byte blocks and frees them again. If the
 *    hole distribution has a hard peak at or just above 64 B, boxing is not
 *    merely a consumer of memory but the CAUSE of the fragmentation. If the
 *    holes are broad with no 64 B structure, it is something else. The
 *    table answers it either way, which is the point.
 *
 * 2. HOW MUCH OF IT COULD EVER BE GIVEN BACK. A free block is not a
 *    returnable page. The OS reclaims at 4 KiB granularity, so what matters
 *    is CONTIGUOUS free runs and the whole aligned pages inside them --
 *    exactly the arithmetic tests/perf/chunkcensus does inside a 64 KiB
 *    arena chunk, applied to the heap. HeapWalk yields entries in address
 *    order within a region, so a run is extended while the next entry
 *    begins exactly where the previous one ended and is also free; anything
 *    else closes it. UNCOMMITTED entries close a run rather than extending
 *    it: those bytes are not committed, so returning them is not a thing
 *    that can happen.
 *
 * This is the number that decides the objective. scr_async.c already
 * measured that HeapCompact releases 0.00 MiB on every fragmented arm and
 * HeapOptimizeResources 1.5-1.8%, and attributed it to live blocks pinning
 * their subsegments -- but that was a differential over two API calls, not
 * a measurement of how much free space is page-shaped. If the whole-page
 * total is a small fraction of the free total, then no reclaimer on any OS
 * can have those bytes, and the only route left is not to create the holes.
 *
 * NEW LINE PREFIXES, never new columns on the existing ones. HCSIZE and the
 * [heapcen] header lines are parsed positionally by readers already written
 * against them; widening either would break every report in the tree. Same
 * discipline as DYNCEN-*-BOX. */
SCR_HC_SHARED ScrHcRow scr_hc_ftbl[SCR_HEAPCEN_SLOTS] = {{0, 0, 0}};
SCR_HC_SHARED size_t scr_hc_frows = 0;
SCR_HC_SHARED size_t scr_hc_flost = 0;

SCR_HC_FN void scr_hc_fnote(size_t size) {
  unsigned long long x = (unsigned long long)size;
  x ^= x >> 33;
  x *= 0xff51afd7ed558ccdULL;
  x ^= x >> 29;
  x *= 0xc4ceb9fe1a85ec53ULL;
  x ^= x >> 32;
  unsigned h = (unsigned)(x & (SCR_HEAPCEN_SLOTS - 1u));
  for (unsigned i = 0; i < SCR_HEAPCEN_SLOTS; i++) {
    unsigned j = (h + i) & (SCR_HEAPCEN_SLOTS - 1u);
    if (scr_hc_ftbl[j].n != 0 && scr_hc_ftbl[j].size != size) continue;
    if (scr_hc_ftbl[j].n == 0) {
      scr_hc_ftbl[j].size = size;
      scr_hc_frows++;
    }
    scr_hc_ftbl[j].n++;
    scr_hc_ftbl[j].bytes += size;
    return;
  }
  scr_hc_flost++;
}

/* Contiguous-run accumulator. Bucket b holds runs of [2^b, 2^(b+1)) bytes;
 * bucket 12 is therefore the first that can contain a whole 4 KiB page and
 * is where the reader looks first. */
#define SCR_HC_RUNB 40
SCR_HC_SHARED size_t scr_hc_runhist[SCR_HC_RUNB] = {0};
SCR_HC_SHARED size_t scr_hc_runpg[SCR_HC_RUNB] = {0};
SCR_HC_SHARED size_t scr_hc_runs = 0;
SCR_HC_SHARED size_t scr_hc_runbytes = 0;
SCR_HC_SHARED size_t scr_hc_runmax = 0;
SCR_HC_SHARED size_t scr_hc_pages = 0;
SCR_HC_SHARED size_t scr_hc_pagebytes = 0;

/* Closes one run: [lo, hi) of contiguous committed free bytes. The pages
 * counted are the WHOLE 4 KiB pages wholly inside it, which is the only
 * unit a decommit could act on. */
SCR_HC_FN void scr_hc_run_close(size_t lo, size_t hi) {
  if (hi <= lo) return;
  size_t len = hi - lo;
  unsigned b = 0;
  while (b + 1 < SCR_HC_RUNB && ((size_t)1 << (b + 1)) <= len) b++;
  scr_hc_runs++;
  scr_hc_runbytes += len;
  if (len > scr_hc_runmax) scr_hc_runmax = len;
  size_t plo = (lo + 4095u) & ~(size_t)4095u;
  size_t phi = hi & ~(size_t)4095u;
  size_t npg = phi > plo ? (phi - plo) / 4096u : 0;
  scr_hc_runhist[b]++;
  scr_hc_runpg[b] += npg;
  scr_hc_pages += npg;
  scr_hc_pagebytes += npg * 4096u;
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

/* THE WALK, factored out so the PEAK snapshot and the SHUTDOWN report run
 * the SAME code rather than two transcriptions of it. The only difference
 * between the two callers is `f`: NULL means fill the tables and write
 * nothing. Everything this function touches is static storage or the
 * caller's locals -- it allocates not one byte, which is what makes a walk
 * at the peak affordable at all. */
SCR_HC_FN void scr_hc_walk(FILE *f, void **heaps, unsigned long nh, void *crt,
                           size_t *gbusyp, size_t *gfreep, size_t *gnbusyp,
                           size_t *gnfreep, size_t *guncp) {
  size_t gbusy = 0, gfree = 0, gnbusy = 0, gnfree = 0, guncommitted = 0;
  for (unsigned long k = 0; k < nh && heaps != NULL; k++) {
    ScrHcEntry e;
    size_t busy = 0, freeb = 0, nbusy = 0, nfree = 0, unc = 0, nregion = 0;
    memset(&e, 0, sizeof e);
    scr_hc_HeapLock(heaps[k]);
    /* The open contiguous free run, in address space. Zero means none.
     * HeapWalk yields entries in address order within a region; a run is
     * extended only while the next entry begins EXACTLY where the previous
     * ended and is itself committed-free. Anything else -- a busy block, an
     * uncommitted span, a new region -- closes it. */
    size_t runlo = 0, runhi = 0;
    while (scr_hc_HeapWalk(heaps[k], &e)) {
      if (e.wFlags & SCR_HC_BUSY) {
        busy += (size_t)e.cbData + e.cbOverhead;
        nbusy++;
        if (heaps[k] == crt) scr_hc_note((size_t)e.cbData, (size_t)e.cbOverhead);
        scr_hc_run_close(runlo, runhi); runlo = runhi = 0;
      } else if (e.wFlags & SCR_HC_UNCOMMITTED) {
        unc += (size_t)e.cbData;
        scr_hc_run_close(runlo, runhi); runlo = runhi = 0;
      } else if (e.wFlags & SCR_HC_REGION) {
        scr_hc_run_close(runlo, runhi); runlo = runhi = 0;
        nregion++;
      } else {
        freeb += (size_t)e.cbData + e.cbOverhead;
        nfree++;
        if (heaps[k] == crt) {
          size_t lo = (size_t)(uintptr_t)e.lpData;
          size_t hi = lo + (size_t)e.cbData;
          /* cbData, NOT cbData + cbOverhead.
           *
           * ***CORRECTED 2026-10-10 -- see heapcensus/HOLEMAP.md. The
           * sentence below is why the 1,344 went unnamed for a month, so
           * it is kept and marked rather than deleted. HeapWalk reports
           * cbData for a BUSY block as the REQUEST but for a FREE block
           * as the BLOCK's data extent: once free, no request remains to
           * report. The two tables are therefore 16 bytes apart ON THE
           * SAME BLOCK, plus the tail padding to the bucket -- measured,
           * every request in [1296,1352] leaves a 1,344-byte hole. So an
           * HCFREE row is NOT comparable with a request, and reading it
           * as one is what filed a 1,328 busy population and a 1,344 free
           * population as two separate mysteries. The ladder argument
           * below is still the right reason to exclude cbOverhead; it is
           * the word "comparable" that was wrong.***
           *
           * The size table has to be
           * comparable with a REQUEST an allocation site made -- the
           * predicted ladders (cap*8, cap*24, and scr_str_alloc's
           * 8*ceil((cap+13)/8)) are all request sizes -- and folding the
           * heap's own per-block header into the key would shift every
           * one of them by an amount that varies with the heap's bucket. */
          scr_hc_fnote((size_t)e.cbData);
          /* ADJACENCY HAS TO STEP OVER THE NEXT BLOCK'S HEADER. lpData
           * points at the DATA and cbOverhead is the header preceding it,
           * so two blocks that touch satisfy
           *     next.lpData - next.cbOverhead == prev.lpData + prev.cbData
           * and NOT next.lpData == prev end. Testing exact equality of the
           * data extents splits every genuinely contiguous run at every
           * block boundary, which would report ~0 whole pages on any heap
           * whose blocks carry a header -- a floor wearing a ceiling's
           * clothes, and it would have looked like a finding.
           *
           * The run's PAGE count is still taken over the data extent only
           * (scr_hc_run_close), so the headers inside a run are not
           * counted as returnable. That errs low by less than one page per
           * run, which is the safe direction for an upper bound. */
          size_t back = (size_t)e.cbOverhead;
          if (runhi != 0 && lo >= back && lo - back == runhi) runhi = hi;
          else { scr_hc_run_close(runlo, runhi); runlo = lo; runhi = hi; }
        }
      }
    }
    scr_hc_run_close(runlo, runhi); runlo = runhi = 0;
    scr_hc_HeapUnlock(heaps[k]);
    /* f is NULL on a PEAK snapshot: the tables are filled and nothing is
     * formatted or written, so the snapshot touches no FILE buffer and no
     * heap. The shutdown report passes a real f and prints as before. */
    if (f != NULL)
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
  *gbusyp = gbusy; *gfreep = gfree; *gnbusyp = gnbusy;
  *gnfreep = gnfree; *guncp = guncommitted;
}

/* -- THE PEAK, WHICH IS A DIFFERENT HEAP FROM THE SETTLED ONE ------------
 *
 * Everything above reports ONCE, at _Exit. On the zapo history-sync load
 * that instant is ~110 s after the high-water: the process climbs during
 * chunk decode and then settles. A ranking taken at shutdown is a ranking
 * of the SETTLED heap, and nothing entitles anyone to carry it to the
 * peak -- that is the same independence assumption the lane decomposition
 * refuted one level up, where the CRT heap FELL 79.828 -> 53.438 MiB when
 * the stacks left. "The heap" is not one number that survives a change of
 * arm or a change of instant.
 *
 * THE INSTRUMENT LANDS INSIDE THE SYSTEM IT MEASURES. That is not
 * avoidable here and it is not hidden; it is bounded, and every term is
 * PRINTED BY THE REPORT rather than argued in this comment. What makes it
 * affordable is a property of this file and not a claim about care:
 * THE CENSUS DOES NOT INSTRUMENT THE ALLOCATION PATH. No malloc
 * interposition, no per-allocation table, no site key, no constructor work
 * beyond atexit. So a walk taken AT the peak can allocate exactly nothing:
 *
 *   - the heap-handle array is static (scr_hc_pkheaps), never malloc'd;
 *   - the ARM is NOT planted on a peak walk. It is a shutdown-only cost;
 *     planting 137 blocks on every trigger would cut fresh holes into the
 *     very free-side distribution the walk is there to measure;
 *   - nothing is formatted or written at trigger time. The tables are
 *     printed at exit from the SAME storage, before the settled walk zeroes
 *     them, so one set of tables serves both readings and the peak costs no
 *     second 786 KiB of .data;
 *   - the walk is scr_hc_walk, the same function the shutdown report calls,
 *     so the two readings cannot diverge by a transcription.
 *
 * What it DOES cost:
 *   - one thread, created with a 64 KiB reserved stack. vmcensus counts
 *     stacks in a term of their own, so this lands in STACK and not in the
 *     heap number being ranked -- but it is a stack that would not exist,
 *     and HCPKCOST names it.
 *   - one GetProcessMemoryInfo call per poll; HCPKCOST prints the count.
 *   - the walks: count, total ms and max ms, all printed. A walk holds
 *     HeapLock, so a reader is entitled to know how long the mutator was
 *     stopped and how many times.
 *
 * WHY PrivateUsage AND NOT THE HEAP'S OWN SIZE. Sizing the heap means
 * walking it, and polling by walking is the thing being avoided.
 * PrivateUsage is one syscall; it is the column the whole decomposition is
 * already written in; and on the stackless arm the CRT heap is 94.33% of
 * it. It is a PROXY, and the report refuses to let that pass unnoticed:
 * HCPKCOVER prints the snapshot's own PrivateUsage against the kernel's
 * PeakPagefileUsage. A snapshot whose coverage is low is a reading of a
 * trough near the peak, not of the peak. That is vmcensus's standard
 * (99.85-99.96% on the committed runs) and it is the only thing that makes
 * a number taken here citable as a number about the peak.
 *
 * NEW LINE PREFIXES, NEVER NEW COLUMNS, the discipline the free side was
 * added under: HCPKSIZE / HCPKFREE / HCPKRUN mirror HCSIZE / HCFREE / HCRUN
 * exactly, so one reader serves all six, and no existing line moves.
 */
#ifdef SCR_HEAPCEN_PEAK

/* PROCESS_MEMORY_COUNTERS_EX, spelled out for the same reason
 * PROCESS_HEAP_ENTRY is: no <windows.h> in a header force-included ahead of
 * every TU. A drifted layout would read PrivateUsage out of the wrong eight
 * bytes and trigger on a plausible, wrong number. */
typedef struct ScrHcPmc {
  unsigned long cb;
  unsigned long PageFaultCount;
  size_t PeakWorkingSetSize;
  size_t WorkingSetSize;
  size_t QuotaPeakPagedPoolUsage;
  size_t QuotaPagedPoolUsage;
  size_t QuotaPeakNonPagedPoolUsage;
  size_t QuotaNonPagedPoolUsage;
  size_t PagefileUsage;
  size_t PeakPagefileUsage;
  size_t PrivateUsage;
} ScrHcPmc;
_Static_assert(offsetof(ScrHcPmc, PagefileUsage) == 56, "PMCEX.PagefileUsage");
_Static_assert(offsetof(ScrHcPmc, PeakPagefileUsage) == 64, "PMCEX.PeakPagefile");
_Static_assert(offsetof(ScrHcPmc, PrivateUsage) == 72, "PMCEX.PrivateUsage");
_Static_assert(sizeof(ScrHcPmc) == 80, "PROCESS_MEMORY_COUNTERS_EX is 80 on x64");

/* Assembler names again, for the reason given above HeapWalk: <windows.h>
 * and <psapi.h> may be included after this header in the same TU and must
 * stay free to declare their own. K32GetProcessMemoryInfo lives in
 * kernel32, so nothing has to be linked that is not already there. */
int __stdcall scr_hc_GetPMI(void *, ScrHcPmc *, unsigned long)
    __asm__("K32GetProcessMemoryInfo");
void *__stdcall scr_hc_CurProc(void) __asm__("GetCurrentProcess");
void __stdcall scr_hc_Sleep(unsigned long) __asm__("Sleep");
void *__stdcall scr_hc_CreateThread(void *, size_t,
                                    unsigned long(__stdcall *)(void *), void *,
                                    unsigned long, unsigned long *)
    __asm__("CreateThread");
int __stdcall scr_hc_QPC(long long *) __asm__("QueryPerformanceCounter");
int __stdcall scr_hc_QPF(long long *) __asm__("QueryPerformanceFrequency");

#define SCR_HC_STACK_IS_RESERVATION 0x00010000u
#define SCR_HC_PKHEAPS 64

SCR_HC_SHARED void *scr_hc_pkheaps[SCR_HC_PKHEAPS] = {0};
SCR_HC_SHARED volatile int scr_hc_pkstop = 0;
SCR_HC_SHARED volatile int scr_hc_pkinwalk = 0;
SCR_HC_SHARED int scr_hc_pkarmed = 0;    /* the thread was actually started */
SCR_HC_SHARED size_t scr_hc_pkwalks = 0; /* snapshots TAKEN */
SCR_HC_SHARED size_t scr_hc_pkpolls = 0;
SCR_HC_SHARED double scr_hc_pkms = 0.0, scr_hc_pkmaxms = 0.0;
SCR_HC_SHARED size_t scr_hc_pkpu = 0;   /* PrivateUsage AT the kept snapshot */
SCR_HC_SHARED size_t scr_hc_pkhwm = 0;  /* highest PrivateUsage ever polled */
SCR_HC_SHARED size_t scr_hc_pkpeak = 0; /* kernel PeakPagefileUsage at exit */
SCR_HC_SHARED size_t scr_hc_pkbusy = 0, scr_hc_pkfreeb = 0;
SCR_HC_SHARED size_t scr_hc_pknbusy = 0, scr_hc_pknfree = 0, scr_hc_pkunc = 0;
SCR_HC_SHARED unsigned long scr_hc_pknh = 0;
SCR_HC_SHARED unsigned long scr_hc_pkint = 5;
SCR_HC_SHARED size_t scr_hc_pkstep = 1048576;
SCR_HC_SHARED size_t scr_hc_pkmin = 0;

/* One set of tables serves both readings, so a snapshot starts from zero
 * and the LAST snapshot is the one that survives to be printed. */
SCR_HC_FN void scr_hc_zero_tables(void) {
  memset(scr_hc_tbl, 0, sizeof scr_hc_tbl);
  memset(scr_hc_ftbl, 0, sizeof scr_hc_ftbl);
  memset(scr_hc_runhist, 0, sizeof scr_hc_runhist);
  memset(scr_hc_runpg, 0, sizeof scr_hc_runpg);
  scr_hc_rows = 0;
  scr_hc_lost = 0;
  scr_hc_frows = 0;
  scr_hc_flost = 0;
  scr_hc_runs = 0;
  scr_hc_runbytes = 0;
  scr_hc_runmax = 0;
  scr_hc_pages = 0;
  scr_hc_pagebytes = 0;
}

SCR_HC_FN double scr_hc_now_ms(void) {
  long long c = 0, fq = 0;
  scr_hc_QPC(&c);
  scr_hc_QPF(&fq);
  return fq ? (double)c * 1000.0 / (double)fq : 0.0;
}

SCR_HC_FN unsigned long __stdcall scr_hc_pkthread(void *unused) {
  (void)unused;
  void *crt = (void *)(intptr_t)_get_heap_handle();
  size_t trigger = scr_hc_pkmin;
  for (;;) {
    if (scr_hc_pkstop) break;
    ScrHcPmc m;
    memset(&m, 0, sizeof m);
    m.cb = (unsigned long)sizeof m;
    scr_hc_pkpolls++;
    if (scr_hc_GetPMI(scr_hc_CurProc(), &m, (unsigned long)sizeof m)) {
      if (m.PrivateUsage > scr_hc_pkhwm) scr_hc_pkhwm = m.PrivateUsage;
      if (m.PrivateUsage >= trigger && m.PrivateUsage >= scr_hc_pkmin) {
        /* Re-check the stop flag under the in-walk flag so the shutdown
         * report can never print a half-filled table. */
        scr_hc_pkinwalk = 1;
        if (scr_hc_pkstop) {
          scr_hc_pkinwalk = 0;
          break;
        }
        unsigned long nh =
            scr_hc_GetProcessHeaps(SCR_HC_PKHEAPS, scr_hc_pkheaps);
        if (nh > SCR_HC_PKHEAPS) nh = SCR_HC_PKHEAPS;
        double t0 = scr_hc_now_ms();
        scr_hc_zero_tables();
        size_t b = 0, fr = 0, nb = 0, nf = 0, un = 0;
        scr_hc_walk(NULL, scr_hc_pkheaps, nh, crt, &b, &fr, &nb, &nf, &un);
        double dt = scr_hc_now_ms() - t0;
        scr_hc_pkbusy = b;
        scr_hc_pkfreeb = fr;
        scr_hc_pknbusy = nb;
        scr_hc_pknfree = nf;
        scr_hc_pkunc = un;
        scr_hc_pknh = nh;
        scr_hc_pkpu = m.PrivateUsage;
        scr_hc_pkwalks++;
        scr_hc_pkms += dt;
        if (dt > scr_hc_pkmaxms) scr_hc_pkmaxms = dt;
        trigger = m.PrivateUsage + scr_hc_pkstep;
        scr_hc_pkinwalk = 0;
      }
    }
    scr_hc_Sleep(scr_hc_pkint);
  }
  return 0;
}

SCR_HC_FN size_t scr_hc_env_sz(const char *name, size_t dflt) {
  const char *v = getenv(name);
  if (v == NULL || *v == 0) return dflt;
  size_t n = 0;
  for (const char *p = v; *p >= '0' && *p <= '9'; p++)
    n = n * 10 + (size_t)(*p - '0');
  return n;
}

SCR_HC_FN void scr_hc_peak_start(void) {
  /* SCR_HEAPCEN_PEAK_OFF=1 is the NULL ARM, and it is inside the SAME
   * binary: no thread, no poll, no snapshot, and the report says
   * "NO PEAK SNAPSHOT (trigger disabled)" by name. A peak block that could
   * only ever print numbers could not tell a dead trigger from a flat
   * heap. */
  const char *off = getenv("SCR_HEAPCEN_PEAK_OFF");
  if (off != NULL && *off == '1') return;
  scr_hc_pkint = (unsigned long)scr_hc_env_sz("SCR_HEAPCEN_PEAK_MS", 5);
  scr_hc_pkstep = scr_hc_env_sz("SCR_HEAPCEN_PEAK_STEP_KB", 1024) * 1024;
  scr_hc_pkmin = scr_hc_env_sz("SCR_HEAPCEN_PEAK_MIN_KB", 0) * 1024;
  if (scr_hc_pkstep == 0) scr_hc_pkstep = 1;
  void *h = scr_hc_CreateThread(NULL, 65536, scr_hc_pkthread, NULL,
                                SCR_HC_STACK_IS_RESERVATION, NULL);
  if (h != NULL) scr_hc_pkarmed = 1;
}

SCR_HC_FN void scr_hc_peak_emit(FILE *f) {
  /* Stop the poller and wait for any walk in flight: a table printed while
   * it is being refilled is a plausible, wrong reading. */
  scr_hc_pkstop = 1;
  for (int spin = 0; scr_hc_pkinwalk && spin < 20000; spin++) scr_hc_Sleep(1);

  ScrHcPmc m;
  memset(&m, 0, sizeof m);
  m.cb = (unsigned long)sizeof m;
  if (scr_hc_GetPMI(scr_hc_CurProc(), &m, (unsigned long)sizeof m))
    scr_hc_pkpeak = m.PeakPagefileUsage;

  if (!scr_hc_pkarmed) {
    fprintf(f, "[heapcen] NO PEAK SNAPSHOT (trigger disabled)\n");
    return;
  }
  if (scr_hc_pkwalks == 0) {
    fprintf(f, "[heapcen] NO PEAK SNAPSHOT (armed, polls=%zu, never fired)\n",
            scr_hc_pkpolls);
    return;
  }
  fprintf(f,
          "[heapcen] HCPKCOVER snapPrivate=%zu kernelPeakPagefile=%zu"
          " polledHigh=%zu\n",
          scr_hc_pkpu, scr_hc_pkpeak, scr_hc_pkhwm);
  fprintf(f,
          "[heapcen] HCPKCOST walks=%zu polls=%zu walkMsTotal=%.3f"
          " walkMsMax=%.3f pollMs=%lu stepBytes=%zu minBytes=%zu threads=1"
          " threadStackReserve=65536\n",
          scr_hc_pkwalks, scr_hc_pkpolls, scr_hc_pkms, scr_hc_pkmaxms,
          scr_hc_pkint, scr_hc_pkstep, scr_hc_pkmin);
  fprintf(f,
          "[heapcen] HCPKHEAPS heaps=%lu busy=%zu busyBlocks=%zu free=%zu"
          " freeBlocks=%zu uncommitted=%zu\n",
          scr_hc_pknh, scr_hc_pkbusy, scr_hc_pknbusy, scr_hc_pkfreeb,
          scr_hc_pknfree, scr_hc_pkunc);
  for (size_t i = 0; i < SCR_HEAPCEN_SLOTS; i++)
    if (scr_hc_ftbl[i].n)
      fprintf(f, "HCPKFREE %zu %zu %zu\n", scr_hc_ftbl[i].size,
              scr_hc_ftbl[i].n, scr_hc_ftbl[i].bytes);
  for (unsigned b = 0; b < SCR_HC_RUNB; b++)
    if (scr_hc_runhist[b])
      fprintf(f, "HCPKRUN %zu %zu %zu\n", (size_t)1 << b, scr_hc_runhist[b],
              scr_hc_runpg[b]);
  size_t tn = 0, tb = 0;
  for (size_t i = 0; i < SCR_HEAPCEN_SLOTS; i++) {
    if (scr_hc_tbl[i].n == 0) continue;
    fprintf(f, "HCPKSIZE %zu %zu %zu\n", scr_hc_tbl[i].size, scr_hc_tbl[i].n,
            scr_hc_tbl[i].bytes);
    tn += scr_hc_tbl[i].n;
    tb += scr_hc_tbl[i].bytes;
  }
  fprintf(f,
          "[heapcen] HCPKTOTAL distinctSizes=%zu blocks=%zu bytes=%zu lost=%zu"
          " freeRows=%zu freeLost=%zu wholePages=%zu pageBytes=%zu runs=%zu"
          " runBytes=%zu\n",
          scr_hc_rows, tn, tb, scr_hc_lost, scr_hc_frows, scr_hc_flost,
          scr_hc_pages, scr_hc_pagebytes, scr_hc_runs, scr_hc_runbytes);
  /* The settled walk starts from zero: the peak reading has been emitted
   * and must not be added to. */
  scr_hc_zero_tables();
}

#else /* !SCR_HEAPCEN_PEAK */
SCR_HC_FN void scr_hc_peak_start(void) {}
SCR_HC_FN void scr_hc_peak_emit(FILE *f) { (void)f; }
#endif /* SCR_HEAPCEN_PEAK */

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

  /* THE PEAK READING COMES FIRST, out of the same tables, before the arm is
   * planted and before the settled walk overwrites them. A reader that
   * stops at the first HCSIZE still gets a complete, labelled peak block
   * above it, and HCPK* never shares a line with HCSIZE*. */
  scr_hc_peak_emit(f);

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
  scr_hc_walk(f, heaps, nh, crt, &gbusy, &gfree, &gnbusy, &gnfree,
              &guncommitted);
  fprintf(f,
          "[heapcen] ALLHEAPS busy=%zu busyBlocks=%zu free=%zu freeBlocks=%zu"
          " uncommitted=%zu\n",
          gbusy, gnbusy, gfree, gnfree, guncommitted);

  /* one line per DISTINCT BUSY SIZE on the CRT heap, unsorted and
   * unaggregated - the reader ranks and folds, this only counts. */
  /* The free side. HCFREE mirrors HCSIZE exactly so one reader serves
   * both; HCRUN is the contiguous-run histogram, and HCPAGE is the number
   * the objective turns on. `pageBytes` is a CEILING and not a forecast:
   * it is the whole 4 KiB pages lying inside contiguous committed-free
   * runs, computed from where the live blocks actually are, and no
   * reclaimer on any OS can return more than it. Read it against `free=`
   * -- the ratio is what says whether the retained free space is
   * page-shaped at all, or whether the only route left is not to create
   * the holes. */
  for (size_t i = 0; i < SCR_HEAPCEN_SLOTS; i++)
    if (scr_hc_ftbl[i].n)
      fprintf(f, "HCFREE %zu %zu %zu\n", scr_hc_ftbl[i].size,
              scr_hc_ftbl[i].n, scr_hc_ftbl[i].bytes);
  for (unsigned b = 0; b < SCR_HC_RUNB; b++)
    if (scr_hc_runhist[b])
      fprintf(f, "HCRUN %zu %zu %zu\n", (size_t)1 << b, scr_hc_runhist[b],
              scr_hc_runpg[b]);
  fprintf(f,
          "[heapcen] HCPAGE runs=%zu runBytes=%zu runMax=%zu wholePages=%zu"
          " pageBytes=%zu freeRows=%zu freeLost=%zu\n",
          scr_hc_runs, scr_hc_runbytes, scr_hc_runmax, scr_hc_pages,
          scr_hc_pagebytes, scr_hc_frows, scr_hc_flost);

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
#ifdef SCR_CYC_ARENAVM_ON
  /* Same reason, same arrangement: scr_cycle.c's reservation counters are
   * registered with atexit and _Exit skips them. They are the half of this
   * census that says whether the arena's 64 KiB chunks were DECOMMITTED or
   * merely freed -- without them a busy/free split cannot be attributed. */
  {
    extern void scr_cyc_arenavm_report(void);
    scr_cyc_arenavm_report();
  }
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
  scr_hc_peak_start();
}

#if defined(_Exit) && defined(SCR_CYCEN_ON)
#undef _Exit
#define _Exit(c) (scr_hc_report(), scr_cycen_report(), _Exit(c))
/* prof chains here for the same reason cycensus does, and it was NOT
 * chainable before: scr_prof.h defines `_Exit` unconditionally with no
 * hook of its own, so census-arms.sh's documented order
 * "prof -> heapcensus" was a compile ERROR rather than a composition --
 * the #else below fired. The free-side table and the allocation-side
 * table could therefore only be taken in TWO RUNS, which is exactly how
 * a 19,091-call site table from one run came to be read against a
 * 15,766-hole population from another (heapcensus/HOLEMAP.md ss.4).
 * The census runs FIRST so prof's own fopen does not land in the heap
 * it is walking. */
#elif defined(_Exit) && defined(SCR_PROF_H)
#undef _Exit
#define _Exit(c) (scr_hc_report(), scr_prof_report(), _Exit(c))
#elif defined(_Exit) && defined(SCR_CYCSTAT_ON)
/* cycstat got here first and made _Exit its own. Replace it: this
 * file's report already ends by calling scr_cs_report() under the same
 * #ifdef, so cycstat is not lost -- it is reached through here, which
 * is also the order the two want (the census must run before anything
 * else opens a file in the heap it is walking). */
#undef _Exit
#define _Exit(c) (scr_hc_report(), _Exit(c))
#elif !defined(_Exit)
#define _Exit(c) (scr_hc_report(), _Exit(c))
#else
#error "another header already interposes _Exit; chain it here explicitly"
#endif

#endif /* _WIN32 */
#endif /* SCR_HEAP_CENSUS_H */
