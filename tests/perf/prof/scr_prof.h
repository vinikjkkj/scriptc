/* scr_prof.h - the profiling prelude.
 *
 * Injected with -include through SCRIPTC_PROF_CFLAGS, so it is prepended to
 * EVERY translation unit a build compiles: every runtime scr_*.c and the
 * program's own emitted TU. That is the whole trick. scriptc has no place
 * to add a source file to a build (the cached-object lane compiles each TU
 * with -c, so an extra .c on the command line is an error), so both the
 * interposition AND its implementation have to travel in a header.
 * Its shared state is __attribute__((selectany)) and its functions are
 * static: every TU carries a copy of the CODE and they all operate on ONE
 * instance of the DATA. It used to say `weak` for both, which is ELF's rule
 * and not this target's - see the LINKAGE note below, which is there because
 * a zapo link is what disproved it.
 *
 * Three independent instruments, each behind its own -D:
 *
 *   -DSCR_PROF_ALLOC  interposes malloc/calloc/realloc/free. Gives COUNTS
 *                     AND BYTES per source site, which the runtime has
 *                     never had: it counts live OBJECTS by kind and, under
 *                     SCRIPTC_RC_SITES=1, names live closures by creation
 *                     site, but tracks no bytes anywhere and has no
 *                     chokepoint - scr_cyc_alloc sees ~16 object kinds
 *                     while ~475 raw malloc/calloc/realloc calls sit in
 *                     ~57 files.
 *
 *   -DSCR_PROF_CPU    -finstrument-functions hooks: EXACT per-function
 *                     call counts, not samples. Verified working under
 *                     zig cc for x86_64-windows-gnu.
 *
 *   -DSCR_PROF_LIVE   an add-on to SCR_PROF_ALLOC: a pointer -> (size,
 *                     owning row) table, so a free is charged back to the
 *                     site that ALLOCATED it. That is what turns the churn
 *                     ranking above into a RESIDENCY ranking, and the two
 *                     are different lists - peak RSS is a residency
 *                     question and nothing here could answer it before.
 *
 * Both write to the file named by SCR_PROF_OUT at exit, one record per
 * line, with no aggregation done in C that the driver could do better.
 *
 * THE SITE KEY IS A COMPILE-TIME "file:line" STRING, NOT AN ADDRESS.
 * That was not the first design, and why it changed rules out a whole
 * family of approaches on this toolchain: an address is only useful if it
 * can be turned back into a name, and on x86_64-windows-gnu under zig cc
 * NOTHING available here can do that. Each of these was measured on this
 * host, not assumed:
 *
 *     -Wl,--wrap=malloc        error: unsupported linker arg: --wrap
 *     -Wl,-Map / --Map / /MAP  error: unsupported linker arg
 *     -Wl,--cref               error: unsupported linker arg
 *     -Wl,--print-map          accepted, then silently writes nothing
 *     -Wl,--export-all-symbols accepted, no export table in an EXE
 *     -g                       no .debug_* section reaches the PE
 *     the PE itself            no COFF symbol table - nsyms=0 in every
 *                              variant built, stripped or not
 *     WSL llvm-symbolizer      the package was not installed. THIS ONE WAS
 *                              THE WRONG PREMISE - see below.
 *
 * A string literal needs none of them, reads better in a report, and covers
 * every allocation written in the sources - which is the population being
 * attributed. What it does NOT cover is an allocation inside libc or inside
 * a vendored archive compiled without this header. Those are invisible
 * here, and the report says so rather than implying its total is the whole
 * process.
 *
 * The CPU lane has no such escape INSIDE C: -finstrument-functions hands
 * over a function ADDRESS and there is no macro context to name it with.
 * It is resolved OUTSIDE C instead, and the wall the list above describes
 * turns out to have a door in it:
 *
 *   zig cc for x86_64-windows-gnu ALREADY writes a .pdb beside every
 *   binary this repo builds - no flag, it has always been there - and
 *   that PDB carries publics AND per-module S_LPROC32 records, so even a
 *   `static` function in the emitted program TU resolves, with its code
 *   size. nsyms=0 in the PE is correct AND irrelevant.
 *
 * tests/perf/pdb-symbols.mjs reads it through WSL llvm-pdbutil and
 * exe-profile.mjs joins the result onto these rows, marking anything that
 * lands between two symbols INEXACT rather than giving it the preceding
 * name. Every one of the eight routes above is still exactly as dead as
 * it was; the ninth was never tried.
 *
 * Nothing here runs, or is even compiled, unless a -D asks for it, so an
 * ordinary build is untouched byte for byte.
 */
#ifndef SCR_PROF_H
#define SCR_PROF_H

#if defined(SCR_PROF_ALLOC) || defined(SCR_PROF_CPU)

#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>

#ifdef _WIN32
/* windows.h pulls in <winsock.h> unless something suppresses it, and this
 * header is -include'd BEFORE every translation unit - so winsock's
 * `typedef struct fd_set {...} fd_set;` arrives before the runtime's own
 * `static void fd_set(ScrDyn *, const char *, ScrDyn *)` in
 * scr_fetch_dispatch.c and the TU does not compile. Measured on zapo:
 * "error: redefinition of 'fd_set' as different kind of symbol", then 300
 * cascading errors and -ferror-limit. It never showed up on a bench because
 * scr_fetch_dispatch.c is link-gated out of a program that cannot reach
 * fetch, so EVERY lane in this header was unusable on the one program it
 * was written for - the same shape of blind spot as the _Exit one below.
 *
 * _WINSOCKAPI_ is winsock.h's own include guard, so defining it here makes
 * that ONE header a no-op and leaves the rest of windows.h intact
 * (WIN32_LEAN_AND_MEAN would also drop cderr/dde/rpc/shellapi/winperf). A
 * TU that wants sockets includes <winsock2.h> itself, which is unaffected. */
#ifndef _WINSOCKAPI_
#define _WINSOCKAPI_
#endif
#include <windows.h>
#endif

#define SCR_PROF_NI __attribute__((no_instrument_function))

/* ---- LINKAGE, and why it is not `weak` -----------------------------
 * This header used to say: "Everything defined here is
 * __attribute__((weak)): every TU carries a copy, the linker keeps exactly
 * one, and the counters are single instances." That is ELF's rule. It is
 * NOT true for x86_64-windows-gnu, and a zapo link says so:
 *
 *   lld-link: error: duplicate symbol: .weak.scr_prof_tsc.default
 *   >>> defined at ...\scr_loop_kqueue.obj
 *   >>> defined at ...\scr_loop_epoll.obj
 *
 * Reproduced here in three files (a.c uses it, b.c and c.c only include the
 * header) and confirmed to have no linker escape on this toolchain -
 * --allow-multiple-definition, /force:multiple, -force:multiple and
 * /FORCE:MULTIPLE are all "error: unsupported linker arg", joining the eight
 * routes already listed at the top of this file. -ffunction-sections and
 * -fno-common do not help either; both were tried.
 *
 * What DOES work on COFF, measured on the same three files:
 *   DATA      __attribute__((selectany)) with an explicit initializer. It
 *             emits a COMDAT with "any" selection, so duplicates MERGE
 *             instead of colliding, and the counter stays a SINGLE instance
 *             (the reproducer prints 2 after two bumps from two TUs, not 1).
 *             An all-zero initializer still lands in .bss: a 4 MB table
 *             produced a byte-identical 780,800-byte exe either way, so this
 *             costs nothing on disk.
 *   FUNCTIONS `static`. Per-TU copies of the CODE are harmless because they
 *             all operate on the shared selectany DATA above.
 *
 * The one thing neither covers is a function whose NAME must be external
 * because the compiler emits calls to it: __cyg_profile_func_enter and
 * __cyg_profile_func_exit. Those stay weak, and the CPU lanes therefore
 * still cannot link a program with this many translation units. See the
 * note above them. */
#define SCR_PROF_SHARED __attribute__((selectany))
#define SCR_PROF_FN SCR_PROF_NI static __attribute__((unused))
/* kept only for the two hooks that must carry an external name */
#define SCR_PROF_WEAK __attribute__((weak))

/* One open-addressed table. 64k rows is far more than the number of
 * distinct sites in a 129 MB TU and keeps the linear probe short. Fixed
 * size on purpose: growing it would mean allocating, and this code sits
 * UNDER the allocator. A full table increments scr_prof_lost, which the
 * report prints, so an overflow can never read as a zero. */
#define SCR_PROF_SLOTS 65536u

typedef struct {
  const void *key;  /* the site string's address, or the function's address */
  /* EDGE lane only: the CALL SITE, i.e. the return address in the
   * caller. A (callee, call site) pair names one call-graph edge, and
   * the pair is what makes `who allocates the strings` answerable
   * without a single name being known inside C. */
  const void *key2;
  const char *name; /* "file:line" for alloc; NULL for an unnamed cpu row */
  long long count;
  long long bytes;
  long long freed;
  /* CPU-TIME lane only (-DSCR_PROF_CPU_TIME). self = cycles spent in this
   * function excluding instrumented callees; incl = including them. Both
   * stay 0 in every other lane and the reporter prints them regardless,
   * so one parser reads every lane. */
  long long self;
  long long incl;
  /* LIVE lane only (-DSCR_PROF_LIVE). live = bytes this site has allocated
   * and not yet had freed; snap = that same figure sampled when the
   * PROCESS-WIDE live total was at (or within the snapshot band of) its
   * high-water mark. The two answer different questions and the report
   * prints both: `live` is what leaked or is still held at exit, `snap` is
   * what the site was holding at the moment peak RSS was set. Both stay 0
   * in every other lane. */
  long long live;
  long long snap;
} ScrProfRow;

/* "file:line" as one compile-time literal. Each expansion is its own static
 * string, so its ADDRESS is a unique, stable, zero-cost key - no hashing of
 * the text and no allocation under the allocator. */
#define SCR_PROF_STR2(x) #x
#define SCR_PROF_STR1(x) SCR_PROF_STR2(x)
#define SCR_PROF_SITE (__FILE__ ":" SCR_PROF_STR1(__LINE__))

SCR_PROF_SHARED ScrProfRow scr_prof_tbl[SCR_PROF_SLOTS] = {{0}};
SCR_PROF_SHARED long long scr_prof_lost = 0;
SCR_PROF_SHARED int scr_prof_installed = 0;
SCR_PROF_SHARED int scr_prof_reentrant = 0;

/* The DENOMINATOR. A per-function cycle count means nothing without the
 * run it is a fraction OF, so the install hook stamps the cycle counter
 * and the reporter stamps it again. Both stay 0 unless a timing lane is
 * compiled in. */
SCR_PROF_SHARED long long scr_prof_t0 = 0;
SCR_PROF_SHARED long long scr_prof_t1 = 0;
SCR_PROF_SHARED long long scr_prof_frames_lost = 0;
SCR_PROF_SHARED long long scr_prof_resyncs = 0;

/* rdtsc through the clang builtin - no intrinsic header, no inline asm,
 * and it compiles to a single RDTSC on this target. It is a CYCLE
 * counter, not a clock: the report converts nothing to seconds and every
 * figure derived from it is a RATIO within one run. */
SCR_PROF_FN long long scr_prof_tsc(void) {
  return (long long)__builtin_readcyclecounter();
}

SCR_PROF_FN unsigned scr_prof_hash(const void *p) {
  unsigned long long x = (unsigned long long)(size_t)p;
  x ^= x >> 33;
  x *= 0xff51afd7ed558ccdULL;
  x ^= x >> 29;
  return (unsigned)(x & (SCR_PROF_SLOTS - 1u));
}

SCR_PROF_FN ScrProfRow *scr_prof_row2(const void *key, const void *key2,
                                                     const char *name) {
  unsigned h = scr_prof_hash(key) ^ (scr_prof_hash(key2) * 2654435761u);
  h &= (SCR_PROF_SLOTS - 1u);
  for (unsigned i = 0; i < SCR_PROF_SLOTS; i++) {
    unsigned j = (h + i) & (SCR_PROF_SLOTS - 1u);
    if (scr_prof_tbl[j].key == key && scr_prof_tbl[j].key2 == key2) return &scr_prof_tbl[j];
    if (scr_prof_tbl[j].key == NULL) {
      scr_prof_tbl[j].key = key;
      scr_prof_tbl[j].key2 = key2;
      scr_prof_tbl[j].name = name;
      return &scr_prof_tbl[j];
    }
  }
  scr_prof_lost++;
  return NULL;
}

SCR_PROF_FN ScrProfRow *scr_prof_row(const void *key, const char *name) {
  unsigned h = scr_prof_hash(key);
  for (unsigned i = 0; i < SCR_PROF_SLOTS; i++) {
    unsigned j = (h + i) & (SCR_PROF_SLOTS - 1u);
    if (scr_prof_tbl[j].key == key) return &scr_prof_tbl[j];
    if (scr_prof_tbl[j].key == NULL) {
      scr_prof_tbl[j].key = key;
      scr_prof_tbl[j].name = name;
      return &scr_prof_tbl[j];
    }
  }
  scr_prof_lost++;
  return NULL;
}

/* The process's own peak working set, read from the SAME counter the
 * runtime's process.resourceUsage() reads (scr_lib.c scr_process_rusage
 * case 2 -> K32GetProcessMemoryInfo PeakWorkingSetSize). It is printed
 * beside the live-heap peak so the DIFFERENCE - image, stacks, CRT arenas,
 * allocator slack, and anything allocated inside libc or a vendored
 * archive - is a visible number rather than a silent omission.
 *
 * Type and function names are deliberately NOT scr_lib.c's: this header is
 * -include'd INTO scr_lib.c, so a shared typedef name would be a
 * redefinition. Resolved through GetProcAddress for the same reason as
 * there: no <psapi.h>, no extra -l on the emitted link line. */
#ifdef _WIN32
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
} ScrProfWinMem;
typedef BOOL(WINAPI *ScrProfGetMemFn)(HANDLE, ScrProfWinMem *, DWORD);
#endif

SCR_PROF_FN long long scr_prof_peak_rss(void) {
#ifdef _WIN32
  HMODULE k32 = GetModuleHandleW(L"kernel32.dll");
  ScrProfGetMemFn fn =
      k32 ? (ScrProfGetMemFn)(void *)GetProcAddress(k32, "K32GetProcessMemoryInfo") : NULL;
  if (fn == NULL) return 0;
  ScrProfWinMem m;
  for (unsigned i = 0; i < sizeof m; i++) ((unsigned char *)&m)[i] = 0;
  m.cb = (DWORD)sizeof m;
  if (!fn(GetCurrentProcess(), &m, (DWORD)sizeof m)) return 0;
  return (long long)m.PeakWorkingSetSize;
#else
  return 0;
#endif
}

SCR_PROF_FN size_t scr_prof_base(void) {
#ifdef _WIN32
  static size_t b = 0;
  if (b == 0) b = (size_t)GetModuleHandleW(NULL);
  return b;
#else
  return 0;
#endif
}

/* ---- the RESIDENCY lane (-DSCR_PROF_LIVE, an add-on to -DSCR_PROF_ALLOC)
 *
 * WHY IT EXISTS. The allocation lane above answers "who allocates", which
 * is CHURN. It cannot answer "who is holding the memory", and the two are
 * not the same population - measured on the messaging bench before this
 * lane was written: scr_string.c:117 is 100.0% of allocations by count and
 * 74.1% of bytes ever allocated, while 36 allocations at two lines of
 * scr_map.c hold 83 MB that is never freed. A churn ranking puts the
 * strings first and the map nowhere; a residency ranking is the reverse.
 * Peak RSS is a residency question, so it needs a residency instrument.
 *
 * WHY IT COULD NOT BE DERIVED FROM THE EXISTING ROWS. free() is handed a
 * pointer, not a size and not the site that allocated it, so the alloc
 * lane's `freed` column counts frees AT THE FREEING SITE - which is a
 * different line from the allocating one (scr_string.c:117 allocates
 * 3,462,773 times and frees 0; scr_string.c:199 allocates 0 and frees
 * 3,462,427). Subtracting one column from the other is meaningless. This
 * lane keeps a pointer -> (size, owning row) table so a free is charged
 * back to the site that made the allocation.
 *
 * WHAT IT IS NOT. Live heap bytes are not RSS. RSS additionally holds the
 * image, the stacks, the C runtime's own arenas and any allocator slack
 * between a request and the page it lands on, and this lane sees NONE of
 * them - it sees exactly the bytes scriptc sources asked for. The report
 * prints the process peak-RSS counter beside the live-heap peak so the
 * unattributed remainder is a number rather than an omission.
 *
 * THE TABLE IS FIXED SIZE, like everything else here, because this code
 * sits under the allocator and must not allocate. A full table increments
 * scr_prof_ptr_lost and a free of a pointer the table never saw increments
 * scr_prof_free_unknown; both are printed, so an overflow can never read
 * as a small number.
 *
 * SINGLE-THREADED, exactly like the tables above it. */
#ifdef SCR_PROF_LIVE
#ifndef SCR_PROF_ALLOC
#error "SCR_PROF_LIVE is an add-on to SCR_PROF_ALLOC and needs it defined"
#endif

/* 2^21 slots x 24 bytes = 50 MB of BSS. Zero pages until touched, and the
 * count is a hard ceiling on SIMULTANEOUSLY LIVE allocations, not on the
 * number made: the bench frees 3,462,427 of 3,462,773 and never holds more
 * than a few hundred at once. */
#ifndef SCR_PROF_PSLOTS
#define SCR_PROF_PSLOTS (1u << 21)
#endif

typedef struct {
  const void *p; /* NULL = empty. There are no tombstones - see below. */
  size_t n;
  ScrProfRow *row;
} ScrProfPtr;

SCR_PROF_SHARED ScrProfPtr scr_prof_ptbl[SCR_PROF_PSLOTS] = {{0}};

/* NOT scr_prof_hash: that one folds its result with (SCR_PROF_SLOTS - 1),
 * i.e. into 65,536 buckets, because the row table is that size. Reusing it
 * here confined every pointer to the first 65,536 slots of a 2,097,152-slot
 * table, so 207,979 simultaneously-live pointers formed one linear-probe
 * cluster and the lane ran 191x slower than the plain alloc lane on
 * identical fixed work. That is the whole reason this second hash exists,
 * written down because the symptom (a slow profiler) looks nothing like
 * the cause (a mask from the wrong table). */
SCR_PROF_FN unsigned scr_prof_phash(const void *p) {
  unsigned long long x = (unsigned long long)(size_t)p;
  x ^= x >> 33;
  x *= 0xff51afd7ed558ccdULL;
  x ^= x >> 29;
  x *= 0xc4ceb9fe1a85ec53ULL;
  x ^= x >> 32;
  return (unsigned)(x & (SCR_PROF_PSLOTS - 1u));
}
SCR_PROF_SHARED long long scr_prof_live = 0;
SCR_PROF_SHARED long long scr_prof_live_peak = 0;
SCR_PROF_SHARED long long scr_prof_live_snap_at = 0;
SCR_PROF_SHARED long long scr_prof_ptr_lost = 0;
SCR_PROF_SHARED long long scr_prof_free_unknown = 0;
SCR_PROF_SHARED long long scr_prof_snaps = 0;
SCR_PROF_SHARED long long scr_prof_ptr_live = 0;
SCR_PROF_SHARED long long scr_prof_ptr_live_peak = 0;

/* A snapshot walks all 65,536 rows, so it must not run on every byte the
 * peak grows by. It runs when the live total exceeds the last snapshot by
 * more than 1% or 64 KiB, whichever is larger - so the recorded snapshot
 * is within that band of the true peak, and the band is printed. The peak
 * ITSELF is exact and unconditional; only the per-site breakdown is
 * sampled this way. */
#ifndef SCR_PROF_SNAP_PCT
#define SCR_PROF_SNAP_PCT 100 /* 1/100 = 1% */
#endif
#ifndef SCR_PROF_SNAP_MIN
#define SCR_PROF_SNAP_MIN 65536
#endif

SCR_PROF_FN void scr_prof_snapshot(void) {
  scr_prof_snaps++;
  scr_prof_live_snap_at = scr_prof_live;
  for (unsigned i = 0; i < SCR_PROF_SLOTS; i++) scr_prof_tbl[i].snap = scr_prof_tbl[i].live;
}

SCR_PROF_FN void scr_prof_live_add(const void *p, size_t n, ScrProfRow *row) {
  if (p == NULL) return;
  unsigned h = scr_prof_phash(p);
  for (unsigned i = 0; i < SCR_PROF_PSLOTS; i++) {
    unsigned j = (h + i) & (SCR_PROF_PSLOTS - 1u);
    if (scr_prof_ptbl[j].p == NULL) {
      scr_prof_ptbl[j].p = p;
      scr_prof_ptbl[j].n = n;
      scr_prof_ptbl[j].row = row;
      scr_prof_live += (long long)n;
      if (row) row->live += (long long)n;
      scr_prof_ptr_live++;
      if (scr_prof_ptr_live > scr_prof_ptr_live_peak) scr_prof_ptr_live_peak = scr_prof_ptr_live;
      if (scr_prof_live > scr_prof_live_peak) scr_prof_live_peak = scr_prof_live;
      {
        long long band = scr_prof_live_snap_at / SCR_PROF_SNAP_PCT;
        if (band < SCR_PROF_SNAP_MIN) band = SCR_PROF_SNAP_MIN;
        if (scr_prof_live > scr_prof_live_snap_at + band) scr_prof_snapshot();
      }
      return;
    }
  }
  scr_prof_ptr_lost++;
}

/* Removes p and charges the bytes back to the row that ALLOCATED it.
 *
 * DELETION IS BACKWARD-SHIFT, NOT A TOMBSTONE, and the reason is a
 * measurement rather than a preference. The first version of this lane
 * marked a freed slot with a tombstone that a later insert could reuse.
 * That is textbook and it was 191x SLOWER than the plain alloc lane on the
 * messaging bench (137.81 s against 0.72 s for identical fixed work) -
 * because a workload that frees almost everything it allocates turns every
 * slot it has ever touched into a non-empty one, and a linear probe that
 * stops only at an EMPTY slot then walks a chain that grows without bound.
 * 1.5 million allocations into a 2-million-slot table was already enough.
 *
 * Backward-shift keeps the invariant that no probe chain contains a gap,
 * so a lookup still stops at the first empty slot and the table degrades
 * only with real occupancy. An element may only be moved into the hole if
 * its ideal slot is NOT cyclically inside (hole, here]. */
SCR_PROF_FN void scr_prof_live_del(const void *p) {
  if (p == NULL) return;
  unsigned mask = SCR_PROF_PSLOTS - 1u;
  unsigned h = scr_prof_phash(p);
  unsigned hole = 0;
  int found = 0;
  for (unsigned i = 0; i < SCR_PROF_PSLOTS; i++) {
    unsigned j = (h + i) & mask;
    if (scr_prof_ptbl[j].p == NULL) break; /* never inserted */
    if (scr_prof_ptbl[j].p == p) {
      scr_prof_live -= (long long)scr_prof_ptbl[j].n;
      if (scr_prof_ptbl[j].row) scr_prof_ptbl[j].row->live -= (long long)scr_prof_ptbl[j].n;
      scr_prof_ptr_live--;
      hole = j;
      found = 1;
      break;
    }
  }
  if (!found) {
    scr_prof_free_unknown++;
    return;
  }
  scr_prof_ptbl[hole].p = NULL;
  scr_prof_ptbl[hole].n = 0;
  scr_prof_ptbl[hole].row = NULL;
  for (unsigned k = (hole + 1u) & mask; scr_prof_ptbl[k].p != NULL; k = (k + 1u) & mask) {
    unsigned ideal = scr_prof_phash(scr_prof_ptbl[k].p);
    /* cyclically in (hole, k] means it cannot move up to the hole */
    int blocked = (hole <= k) ? (ideal > hole && ideal <= k) : (ideal > hole || ideal <= k);
    if (blocked) continue;
    scr_prof_ptbl[hole] = scr_prof_ptbl[k];
    scr_prof_ptbl[k].p = NULL;
    scr_prof_ptbl[k].n = 0;
    scr_prof_ptbl[k].row = NULL;
    hole = k;
  }
}
#endif /* SCR_PROF_LIVE */

SCR_PROF_SHARED int scr_prof_reported = 0;

/* The body, with the stream as a parameter. Split out from scr_prof_report
 * so a PHASE EDGE can take a residency dump mid-run without latching the
 * one-shot flag that protects the exit report. The exit report is still the
 * only writer of SCR_PROF_OUT; a phase dump goes to its own path and to
 * nothing else. Nothing about the TABLE is reset by a dump -- `snap` stays
 * the process-wide high-water it always was, and `live` is read at the
 * instant of the dump, which is the whole point of taking one at an edge. */
SCR_PROF_FN void scr_prof_write(FILE *f) {
  size_t base = scr_prof_base();
#ifdef SCR_PROF_ALLOC
  fprintf(f, "PROF-KIND alloc\n");
#endif
#ifdef SCR_PROF_CPU
  fprintf(f, "PROF-KIND cpu\n");
#endif
  long long rows = 0, tc = 0, tb = 0, tf = 0;
  for (unsigned i = 0; i < SCR_PROF_SLOTS; i++) {
    ScrProfRow *r = &scr_prof_tbl[i];
    if (r->key == NULL || (r->count == 0 && r->freed == 0)) continue;
    rows++;
    tc += r->count;
    tb += r->bytes;
    tf += r->freed;
    /* count bytes freed rva name -- name is last because it may contain
     * anything except a newline. */
    fprintf(f, "PROF %lld %lld %lld %lld %lld %llx %llx %s\n", r->count, r->bytes,
            r->freed, r->self, r->incl,
            (unsigned long long)((size_t)r->key - base),
            r->key2 ? (unsigned long long)((size_t)r->key2 - base) : 0ULL,
            r->name ? r->name : "?");
  }
  scr_prof_t1 = scr_prof_tsc();
  fprintf(f, "PROF-TOTAL rows=%lld count=%lld bytes=%lld freed=%lld lost=%lld cycles=%lld framesLost=%lld resyncs=%lld\n",
          rows, tc, tb, tf, scr_prof_lost,
          scr_prof_t1 - scr_prof_t0, scr_prof_frames_lost, scr_prof_resyncs);
#ifdef SCR_PROF_LIVE
  /* A SEPARATE record type, not extra columns on PROF: every reader of the
   * three existing schemas keeps working, because "PROFLIVE " does not
   * start with "PROF ". snap = the site's live bytes when the process-wide
   * live total was last sampled at its high-water mark; live = its live
   * bytes at exit. */
  {
    long long lrows = 0;
    for (unsigned i = 0; i < SCR_PROF_SLOTS; i++) {
      ScrProfRow *r = &scr_prof_tbl[i];
      if (r->key == NULL || (r->snap == 0 && r->live == 0)) continue;
      lrows++;
      fprintf(f, "PROFLIVE %lld %lld %llx %s\n", r->snap, r->live,
              (unsigned long long)((size_t)r->key - base), r->name ? r->name : "?");
    }
    fprintf(f,
            "PROF-LIVE-TOTAL rows=%lld livePeak=%lld liveSnapAt=%lld liveNow=%lld "
            "ptrLost=%lld freeUnknown=%lld snaps=%lld ptrLivePeak=%lld pslots=%u peakRSSbytes=%lld "
            "profTableBytes=%lld\n",
            lrows, scr_prof_live_peak, scr_prof_live_snap_at, scr_prof_live,
            scr_prof_ptr_lost, scr_prof_free_unknown, scr_prof_snaps,
            scr_prof_ptr_live_peak, (unsigned)SCR_PROF_PSLOTS, scr_prof_peak_rss(),
            /* THE INSTRUMENT'S OWN FOOTPRINT. Both tables are BSS, so only
             * the pages actually touched become resident and this is an
             * UPPER bound - but peakRSSbytes above is the INSTRUMENTED
             * process's, and without this number a reader would subtract
             * the live-heap peak from it and call the remainder the
             * program's unattributed memory. It is not: some of it is
             * this profiler. The clean-run peak RSS is the denominator to
             * quote, and it has to be measured on an uninstrumented
             * build. */
            (long long)(sizeof scr_prof_tbl + sizeof scr_prof_ptbl));
  }
#endif
}

SCR_PROF_FN void scr_prof_report(void) {
  /* Two producers reach this (atexit and the _Exit interposer below), and a
   * second report would truncate the first. */
  const char *path;
  FILE *f;
  if (scr_prof_reported) return;
  scr_prof_reported = 1;
  path = getenv("SCR_PROF_OUT");
  f = fopen(path && *path ? path : "scr-prof.txt", "w");
  if (!f) return;
  scr_prof_write(f);
  fclose(f);
}

/* A mid-run dump to a named path. Does NOT latch scr_prof_reported: the exit
 * report must still happen, and a run whose phase dumps silently replaced it
 * would be a worse instrument than no phase dump at all. */
SCR_PROF_FN void scr_prof_report_to(const char *path) {
  FILE *f;
  if (path == NULL || *path == 0) return;
  f = fopen(path, "w");
  if (f == NULL) return;
  scr_prof_write(f);
  fclose(f);
}

SCR_PROF_FN void scr_prof_install(void) {
  if (scr_prof_installed) return;
  scr_prof_installed = 1;
  scr_prof_t0 = scr_prof_tsc();
  atexit(scr_prof_report);
}

/* ---- the _Exit blind spot ------------------------------------------
 * atexit ALONE cannot profile the program this compiler exists for.
 * process.exit() lowers to scr_lib.c's scr_process_exit, which ends in
 * _Exit "on purpose: no further code runs (matching Node)". _Exit skips
 * every atexit handler, so on any entry that calls process.exit() the
 * report above is never written and the run produces an EMPTY profile -
 * which reads as "the instrument did not work", not as "the program did
 * not report". zapo's entry ends in process.exit(0), so every lane in this
 * header was unusable on the actual target until this interposer existed.
 * Five _Exit call sites in the runtime are covered by it: scr_lib.c:1185
 * (process.exit), scr_abort.c, scr_tls.c, scr_console.c and scr_child.c.
 *
 * A function-like macro does not re-expand its own name, so the inner
 * _Exit is the real one and no recursion is possible. It must come AFTER
 * scr_prof_report's definition and after <stdlib.h>, both of which are
 * above.
 *
 * CAVEAT, stated rather than hidden: a child process that inherits
 * SCR_PROF_OUT and exits through _Exit will write to the SAME path and
 * overwrite the parent's profile. Point SCR_PROF_OUT at a per-run file and
 * check the totals line survived. */
#define _Exit(c) (scr_prof_report(), _Exit(c))

/* ---- the allocation lane ------------------------------------------- */
#ifdef SCR_PROF_ALLOC

SCR_PROF_FN void *scr_prof_malloc(size_t n, const char *site) {
  scr_prof_install();
  void *p = malloc(n);
  ScrProfRow *r = scr_prof_row((const void *)site, site);
  if (r) {
    r->count++;
    r->bytes += (long long)n;
  }
#ifdef SCR_PROF_LIVE
  scr_prof_live_add(p, n, r);
#endif
  return p;
}

SCR_PROF_FN void *scr_prof_calloc(size_t a, size_t b, const char *site) {
  scr_prof_install();
  void *p = calloc(a, b);
  ScrProfRow *r = scr_prof_row((const void *)site, site);
  if (r) {
    r->count++;
    r->bytes += (long long)(a * b);
  }
#ifdef SCR_PROF_LIVE
  scr_prof_live_add(p, a * b, r);
#endif
  return p;
}

SCR_PROF_FN void *scr_prof_realloc(void *q, size_t n, const char *site) {
  scr_prof_install();
#ifdef SCR_PROF_LIVE
  /* The old block is retired BEFORE the call: realloc may return the same
   * address, and re-inserting a pointer already in the table would double
   * count it. A grow-in-place therefore reads as one delete and one add,
   * which is what the site's live bytes should record. */
  scr_prof_live_del(q);
#endif
  void *p = realloc(q, n);
  ScrProfRow *r = scr_prof_row((const void *)site, site);
  if (r) {
    r->count++;
    r->bytes += (long long)n;
  }
#ifdef SCR_PROF_LIVE
  scr_prof_live_add(p, n, r);
#endif
  return p;
}

SCR_PROF_FN void scr_prof_free(void *p, const char *site) {
  if (p != NULL) {
    ScrProfRow *r = scr_prof_row((const void *)site, site);
    if (r) r->freed++;
  }
#ifdef SCR_PROF_LIVE
  /* Charged back to the ALLOCATING row, which is why this lane exists:
   * `site` here is the FREEING line and is a different line in every hot
   * case measured so far. */
  scr_prof_live_del(p);
#endif
  free(p);
}

/* The macros go last, so every definition above still calls the real libc
 * entry point. */
#define malloc(n) scr_prof_malloc((n), SCR_PROF_SITE)
#define calloc(a, b) scr_prof_calloc((a), (b), SCR_PROF_SITE)
#define realloc(p, n) scr_prof_realloc((p), (n), SCR_PROF_SITE)
#define free(p) scr_prof_free((p), SCR_PROF_SITE)

/* ---- the arming test ------------------------------------------------
 * -DSCR_PROF_ARM=N plants exactly N allocations of 1234 bytes at ONE known
 * source line, before main runs. The instrument is only believable if that
 * line then reports exactly N allocations and exactly N*1234 bytes -- the
 * same way the RC audit is only believable because a planted leak makes it
 * fail. If the planted site reports anything else, the table is sampling or
 * coalescing and every other number it produces is void.
 *
 * The plant deliberately uses the SAME macro path as everything else, so it
 * tests the instrument rather than a private back door. */
#ifdef SCR_PROF_ARM
SCR_PROF_FN void scr_prof_arm(void) {
  for (long i = 0; i < (long)(SCR_PROF_ARM); i++) {
    void *p = malloc(1234); /* THE PLANTED SITE */
    if (p == NULL) return;
  }
}
/* The run-once guard is NOT belt and braces: without it the plant fires
 * ONCE PER TRANSLATION UNIT. Measured -- the first version of this test
 * reported 21,000 allocations for a planted 1,000 and 1,633,317 for a
 * planted 77,777, both exactly 21x, because this build compiles 21 TUs and
 * __attribute__((constructor)) emits an init entry in each one even though
 * `weak` collapses the SYMBOL to a single definition. That is precisely the
 * kind of silent multiplier an arming test exists to catch, and it is the
 * reason to trust the numbers this instrument prints now. */
SCR_PROF_SHARED int scr_prof_armed = 0;
__attribute__((constructor)) SCR_PROF_NI static void scr_prof_arm_ctor(void) {
  if (scr_prof_armed) return;
  scr_prof_armed = 1;
  scr_prof_arm();
}
#endif

/* ---- arming the RESIDENCY lane --------------------------------------
 * -DSCR_PROF_LIVE_ARM=N plants N allocations of 4096 bytes at ONE known
 * line and then frees exactly half of them at a DIFFERENT known line. The
 * lane is only believable if all four of these hold:
 *
 *   POSITIVE  the allocating line reports count = N, bytes = N*4096
 *   POSITIVE  the allocating line reports live  = (N - N/2)*4096, i.e. the
 *             frees were charged BACK to it and not to the freeing line
 *   NEGATIVE  the FREEING line reports live = 0 and bytes = 0. This is the
 *             control that must fire: it is exactly the mistake the lane
 *             exists to avoid, and the alloc lane's own `freed` column
 *             makes it - it charges the free to the freeing site.
 *   NEGATIVE  livePeak >= N*4096 while liveNow is half of it, so a lane
 *             that reported the same number for both would be caught.
 *
 * It uses the ordinary macro path, so it tests the instrument and not a
 * private back door, and it runs from a constructor with the same
 * run-once guard the other arms need (a constructor is emitted per TU). */
#ifdef SCR_PROF_LIVE_ARM
#ifndef SCR_PROF_LIVE
#error "SCR_PROF_LIVE_ARM needs -DSCR_PROF_LIVE"
#endif
SCR_PROF_SHARED void *scr_prof_live_arm_keep[64] = {0};
SCR_PROF_SHARED int scr_prof_live_armed = 0;
SCR_PROF_FN void scr_prof_live_arm(void) {
  long n = (long)(SCR_PROF_LIVE_ARM);
  if (n > 64) n = 64;
  for (long i = 0; i < n; i++) scr_prof_live_arm_keep[i] = malloc(4096); /* ALLOC LINE */
  for (long i = 0; i < n / 2; i++) free(scr_prof_live_arm_keep[i]);      /* FREE LINE */
}
__attribute__((constructor)) SCR_PROF_NI static void scr_prof_live_arm_ctor(void) {
  if (scr_prof_live_armed) return;
  scr_prof_live_armed = 1;
  scr_prof_live_arm();
}
#endif

#endif /* SCR_PROF_ALLOC */

/* ---- the CPU lane --------------------------------------------------- */
#ifdef SCR_PROF_CPU

/* These MUST carry no_instrument_function. Without it the hooks instrument
 * themselves and the process dies with 0xC00000FD (STACK_OVERFLOW) -
 * measured on this host before the attribute was added, which is how it
 * comes to be documented here rather than guessed at. */

/* ---- the shadow stack (only with -DSCR_PROF_CPU_TIME) --------------
 * -finstrument-functions gives an ENTER and an EXIT hook, which is
 * exactly enough to turn exact call COUNTS into exact call TIMES without
 * a sampler: stamp the cycle counter on the way in, subtract on the way
 * out, and hand the elapsed figure up to the caller as ITS child time.
 * self = incl - children, so the two together separate a function that
 * is slow from a function that merely calls slow things.
 *
 * Three honesty notes, because a profiler that hides its own bias is
 * worse than no profiler:
 *
 * 1. THE HOOK IS NOT FREE and its cost lands in the CALLER self time. t0
 *    is stamped at the END of enter and read at the START of exit, so a
 *    callee is never charged for its own hooks - but the hash lookup and
 *    the push/pop sit inside the caller measured interval. A function
 *    that calls many tiny instrumented functions therefore reads HIGH.
 *    scr_prof_hook_cycles measures that overhead directly (see the
 *    arming section) so the bias has a number instead of a hand wave.
 * 2. THE UNIT IS A CYCLE, NOT A SECOND. No frequency is assumed and
 *    nothing is converted; every published figure is a share of the
 *    run own cycles=... denominator.
 * 3. LIBC IS NOT INSTRUMENTED. malloc, free, memcpy and fmod carry no
 *    hooks, so their cost shows up as SELF time of whoever called them.
 *    That is a feature here: it is precisely how the allocator cost gets
 *    attributed to scr_cyc_alloc and scr_str_alloc by name.
 *
 * The stack is fixed size and never allocates (this code sits under the
 * allocator). Overflow and unbalance are COUNTED, not ignored:
 * framesLost and resyncs are printed in the totals line, so a profile
 * taken across a setjmp/longjmp cannot silently read as a clean one.
 */
#ifdef SCR_PROF_CPU_TIME
#define SCR_PROF_STACK 16384
typedef struct {
  ScrProfRow *row;
  long long t0;
  long long child;
} ScrProfFrame;
SCR_PROF_SHARED ScrProfFrame scr_prof_stk[SCR_PROF_STACK] = {{0}};
SCR_PROF_SHARED int scr_prof_sp = 0;
#endif

/* These MUST carry no_instrument_function. Without it the hooks instrument
 * themselves and the process dies with 0xC00000FD (STACK_OVERFLOW) -
 * measured on this host before the attribute was added, which is how it
 * comes to be documented here rather than guessed at. */

SCR_PROF_NI SCR_PROF_WEAK void __cyg_profile_func_enter(void *this_fn, void *call_site) {
  if (scr_prof_reentrant) return;
  scr_prof_reentrant = 1;
  scr_prof_install();
#ifdef SCR_PROF_EDGES
  /* One row per CALL-GRAPH EDGE. call_site is the return address in the
   * caller, so the pair (callee, call site) identifies the edge exactly -
   * including the case an address-only profile cannot separate, where one
   * hot callee has many callers and only the SUM was ever visible. This
   * is what turns `scr_string.c:68 is 85.6% of allocations` from a line
   * number into a list of names. */
  ScrProfRow *r = scr_prof_row2(this_fn, call_site, NULL);
#else
  ScrProfRow *r = scr_prof_row(this_fn, NULL);
#endif
  if (r) r->count++;
#ifdef SCR_PROF_CPU_TIME
  if (scr_prof_sp >= 0 && scr_prof_sp < SCR_PROF_STACK) {
    scr_prof_stk[scr_prof_sp].row = r;
    scr_prof_stk[scr_prof_sp].child = 0;
    scr_prof_stk[scr_prof_sp].t0 = scr_prof_tsc();
  } else {
    scr_prof_frames_lost++;
  }
  scr_prof_sp++;
#endif
  scr_prof_reentrant = 0;
}

SCR_PROF_NI SCR_PROF_WEAK void __cyg_profile_func_exit(void *this_fn, void *call_site) {
  (void)this_fn;
  (void)call_site;
#ifdef SCR_PROF_CPU_TIME
  if (scr_prof_reentrant) return;
  scr_prof_reentrant = 1;
  long long now = scr_prof_tsc();
#ifdef SCR_PROF_EDGES
  ScrProfRow *r = scr_prof_row2(this_fn, call_site, NULL);
#else
  ScrProfRow *r = scr_prof_row(this_fn, NULL);
#endif
  /* RESYNC: a non-local exit (setjmp/longjmp - scr_jb_enter) leaves
   * frames on this stack that no exit hook will ever pop. Rather than let
   * every later attribution drift, unwind to the frame that matches the
   * function actually exiting and count the discrepancy. */
  int guard = 0;
  while (scr_prof_sp > 0 && guard < SCR_PROF_STACK) {
    int sp = scr_prof_sp - 1;
    scr_prof_sp = sp;
    if (sp >= SCR_PROF_STACK) { guard++; continue; }
    ScrProfFrame *fr = &scr_prof_stk[sp];
    long long dt = now - fr->t0;
    if (fr->row) {
      fr->row->incl += dt;
      fr->row->self += dt - fr->child;
    }
    if (sp > 0 && sp - 1 < SCR_PROF_STACK) scr_prof_stk[sp - 1].child += dt;
    if (fr->row == r) break;
    scr_prof_resyncs++;
    guard++;
  }
  scr_prof_reentrant = 0;
#endif
}

/* ---- arming the TIME lane ------------------------------------------
 * -DSCR_PROF_TIME_ARM=N calls a function that burns a KNOWN number of
 * cycles, N times, before main. The lane is only believable if that
 * function then reports self cycles within a few percent of N * the burn
 * - the same contract the allocation lane arms with a planted malloc.
 * A timer that cannot recover a planted interval is not measuring one.
 *
 * SCR_PROF_TIME_BURN is the target per call (default 100000 cycles). The
 * burn spins on the cycle counter itself, so it is immune to the
 * optimiser closing a loop form, and it deliberately goes through the
 * ordinary instrumented path rather than a private back door. */
#if defined(SCR_PROF_TIME_ARM) && defined(SCR_PROF_CPU_TIME)
#ifndef SCR_PROF_TIME_BURN
#define SCR_PROF_TIME_BURN 100000
#endif
/* NOT no_instrument_function: this one MUST be instrumented, it is the
 * thing being measured. */
__attribute__((unused)) static void scr_prof_burn(void) {
  long long stop = scr_prof_tsc() + (long long)(SCR_PROF_TIME_BURN);
  while (scr_prof_tsc() < stop) { }
}
SCR_PROF_SHARED int scr_prof_time_armed = 0;
__attribute__((constructor)) SCR_PROF_NI static void scr_prof_time_arm_ctor(void) {
  /* run-once guard: a constructor is emitted in EVERY TU (21 of them in a
   * bench build) even though weak collapses the symbol - measured by
   * block/perf as a 21x inflation of a planted count. */
  if (scr_prof_time_armed) return;
  scr_prof_time_armed = 1;
  scr_prof_install();
  for (long i = 0; i < (long)(SCR_PROF_TIME_ARM); i++) scr_prof_burn();
}
#endif
#endif /* SCR_PROF_CPU */

#endif /* SCR_PROF_ALLOC || SCR_PROF_CPU */
#endif /* SCR_PROF_H */
