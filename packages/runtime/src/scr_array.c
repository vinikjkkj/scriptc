#include "scr_runtime.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* Live heap-array count for the RC audit lane (-DSCR_RC_AUDIT); same
 * contract as scr_str_live_count in scr_string.c. */
#ifdef SCR_RC_AUDIT
static long scr_live_arrays = 0;
long scr_arr_live_count(void) { return scr_live_arrays; }
#endif

/* `cold` keeps a refusal path out of the hot path's stack frame; clang and
 * gcc both take it, and a compiler that knows neither attribute still
 * compiles this file (the spelling degrades to nothing). */
#if defined(__GNUC__) || defined(__clang__)
#define SCR_ARR_COLD __attribute__((noinline, cold))
#else
#define SCR_ARR_COLD
#endif
#define SCR_ARR_COLD_TRAP SCR_ARR_COLD _Noreturn

SCR_ARR_COLD_TRAP static void scr_arr_oom(void) {
  scr_trap("scriptc: out of memory\n");
}

/* JS would return undefined for an OOB read and create holes for a far OOB
 * write; both are unrepresentable here (see SEMANTICS.md), so any invalid
 * index — negative, fractional, NaN, or past the allowed end — traps. */
SCR_ARR_COLD_TRAP static void scr_arr_trap_oob(double i, size_t len) {
  char buf[32];
  scr_f64_to_str(i, buf);
  scr_trap_fmt("scriptc: RangeError: array index %s out of bounds (length %zu)\n",
               buf, len);
}

/* An ABSENT reference slot read as a value. A ref-element slot holds NULL
 * when nothing has been written to it (arrayNewLen / `Array.from({length:
 * n})` / the growth half of `a.length = n`) or when the tombstone store
 * cleared it (`a[i] = null as unknown as T` — the GC-drop idiom). JS reads
 * undefined from a hole; scriptc arrays are dense, so the read REFUSES,
 * the same stance and the same shape as the out-of-bounds trap above.
 *
 * Before this fence the three readers that reach a NULL slot — the indexed
 * read, for-of, and the console.log/JSON walkers — handed the NULL on and
 * the program died on a field load, with no index, no length and no line;
 * `pop()` handed it to a typed local where `=== null` folds to the
 * constant false, which is a silent wrong answer rather than a crash. */
SCR_ARR_COLD_TRAP static void scr_arr_trap_absent(size_t i, size_t len) {
  scr_trap_fmt("scriptc: TypeError: array element %zu is absent (length %zu) "
               "-- the slot was never assigned, or was cleared with null; "
               "JS reads undefined from a hole\n",
               i, len);
}

/* Validate i as an element index. limit is a->len for reads, a->len + 1 for
 * writes (i == len appends). NaN fails the >= 0 test; fractional indices
 * fail the integrality test.
 *
 * TWO ARMS, AND THE SECOND ONE IS THE FIRST ONE'S SPELLING UNCHANGED.
 * callgrind priced scr_arr_get_f64 at 39 self instructions per read plus a
 * 3-Ir `call trunc@plt` into libm -- 32.49% of the numeric-add bench
 * scenario, 22.03% of record-field, 22.59% of array-churn -- and isa.mjs
 * accounted for all 39, of which exactly ONE is the load:
 *
 *    9  the stack frame, which exists only because the body CALLS
 *    2  `call trunc@plt` (+3 more inside libm), because `i != trunc(i)`
 *       is a LIBRARY CALL on a baseline x86-64 target with no SSE4.1
 *    2  spilling `i` and `a` across that call
 *    6  u64 -> double for `limit` (punpckldq/subpd/movapd/unpckhpd/addsd
 *       and the compare), because the comparison is done in DOUBLES
 *    7  double -> u64 for `i` (cvttsd2si twice, sar/subsd/and/or) -- an
 *       UNSIGNED conversion is not one instruction here
 *   11  the remaining compares, branches and the two header loads
 *    1  movsd (%rax,%rsi,8)
 *
 * For 0 <= i < 2^53 none of that is needed: (int64_t)i truncates exactly
 * and is defined (the window sits far inside int64), one cvtsi2sd comes
 * back, equality with i IS integrality, and the bound then compares as
 * INTEGERS so `limit` never becomes a double. Nothing else changes: every
 * value the fast window does not accept -- NaN, negatives, fractions, both
 * infinities, |i| >= 2^53, and every out-of-range index -- falls into
 * scr_arr_check_index_slow, whose test is this function's ORIGINAL
 * EXPRESSION character for character. The fast arm accepts a strict subset
 * of what that expression accepts and returns the same (size_t)i for it, so
 * the answer is unchanged for every double on both arms.
 *
 * The slow arm is `cold` and `noinline` for the same measurement: while it
 * was inline, its `char buf[32]` and its two calls put a 48-byte frame and
 * three callee-saved pushes on the HOT path. Out of line, the fast arm
 * calls nothing. 39 self + 3 libm becomes 25 self and no libm.
 *
 * WHAT DID NOT WORK, so nobody pays for it twice: making only the traps
 * `noinline cold` and leaving trunc() in place shrank the frame from 48
 * bytes to 16 and moved the instruction count by ZERO. The frame is the
 * call's, not the buffer's. */
#define SCR_ARR_FAST_MAX 9007199254740992.0 /* 2^53 */

SCR_ARR_COLD static size_t scr_arr_check_index_slow(const ScrArr *a, double i, size_t limit) {
  if (!(i >= 0) || i != trunc(i) || i >= (double)limit) {
    scr_arr_trap_oob(i, a->len);
  }
  return (size_t)i;
}

static size_t scr_arr_check_index(const ScrArr *a, double i, bool allow_append) {
  size_t limit = a->len + (allow_append ? 1 : 0);
  if (i >= 0.0 && i < SCR_ARR_FAST_MAX) {
    int64_t n = (int64_t)i;
    if ((double)n == i && (uint64_t)n < (uint64_t)limit) return (size_t)n;
  }
  return scr_arr_check_index_slow(a, i, limit);
}

/* ── slot packing: 8-byte slots hold doubles, bools, or pointers ───────── */

static uint64_t scr_slot_from_f64(double v) {
  uint64_t s;
  memcpy(&s, &v, sizeof s);
  return s;
}

static double scr_slot_to_f64(uint64_t s) {
  double v;
  memcpy(&v, &s, sizeof v);
  return v;
}

static uint64_t scr_slot_from_ptr(void *p) { return (uint64_t)(uintptr_t)p; }

static void *scr_slot_to_ptr(uint64_t s) { return (void *)(uintptr_t)s; }

static bool scr_elem_is_ref(ScrElemKind k) {
  return k == SCR_ELEM_STR || k == SCR_ELEM_ARR || k == SCR_ELEM_BYTES ||
         k == SCR_ELEM_REF;
}

static void scr_elem_release(const ScrArr *a, uint64_t slot) {
  void *p = scr_slot_to_ptr(slot);
  if (p == NULL) return; /* an ABSENT slot owns nothing */
  if (a->elem == SCR_ELEM_STR) scr_str_release((ScrStr *)p);
  else if (a->elem == SCR_ELEM_ARR) scr_arr_release((ScrArr *)p);
  else if (a->elem == SCR_ELEM_BYTES) scr_bytes_release((ScrBytes *)p);
  else if (a->elem == SCR_ELEM_REF) a->elem_release(p);
}

/* The retain half, and the ONE spelling of it: every element copy in this
 * file (get, the spread copy, slice, fill, copyWithin) went through its own
 * inline ladder, and only two of the five had the NULL guard an ABSENT slot
 * needs. Copies PROPAGATE absence — a hole survives a slice or a spread in
 * JS too; only a READ refuses it. */
static void *scr_elem_retain_p(const ScrArr *a, void *p) {
  if (p == NULL) return NULL; /* an ABSENT slot copies as absent */
  if (a->elem == SCR_ELEM_STR) return scr_str_retain((ScrStr *)p);
  if (a->elem == SCR_ELEM_ARR) return scr_arr_retain((ScrArr *)p);
  if (a->elem == SCR_ELEM_BYTES) return scr_bytes_retain((ScrBytes *)p);
  if (a->elem == SCR_ELEM_REF) return a->elem_retain(p);
  return p;
}

/* ── large array data: a reservation, not the CRT heap ──────────────────
 *
 * THE MECHANISM THIS REMOVES. scr_arr_grow doubles, and `realloc` on a heap
 * whose neighbours are busy cannot extend in place, so every step allocates a
 * new block, copies, and frees the old one. An array that reaches octave 15
 * also allocated at 7, 8, 9 ... 14 and abandoned every one. By the geometric
 * series those droppings sum to about the final size -- so roughly half the
 * bytes this line ever asks for are allocated only to be thrown away one step
 * later. And each dropping is exactly one size class SMALLER than the request
 * that follows it, so nothing that comes after can ever fit the hole it left.
 * That is the heap-shredder, measured: 217,359 free blocks in the scattered
 * arm against 1,026 in the contiguous one, with identical live data.
 *
 * MEASURED SHAPE, from tests/perf/placement/RESULTS.md pass 2 (artifact
 * out/zapo-rest-prof2.exe, arm app/ 1.6.2). Octave histogram of this line's
 * 1,449,126 grows, and `cap` is always a power of two so a grow lands exactly
 * on its octave floor and count x 2^b is exact -- it reconciles with the
 * site's own byte total to 1582.6 MiB both ways:
 *
 *   oct  5    32 B   376,272 grows    11.5 MiB     87.0% of GROWS
 *   oct  6    64 B   885,408          54.0 MiB     are these two
 *   oct  7   128 B    26,004           3.2 MiB
 *   oct  8   256 B    22,611           5.5 MiB     the flat tail: 15k-26k
 *   oct  9   512 B    22,208          10.8 MiB     grows in EVERY octave,
 *   oct 10  1024 B    21,464          21.0 MiB     which is tens of
 *   oct 11  2048 B    20,122          39.3 MiB     thousands of arrays each
 *   oct 12  4096 B    18,859          73.7 MiB     climbing the WHOLE
 *   oct 13  8192 B    17,664         138.0 MiB     ladder, not a few big
 *   oct 14 16384 B    15,535         242.7 MiB     ones
 *   oct 15 32768 B    14,506         453.3 MiB
 *   oct 16 65536 B     8,473         529.6 MiB
 *
 * THE THRESHOLD IS READ OFF THAT TABLE, not rounded to taste. 8,192 bytes --
 * octave 13 -- because:
 *
 *   it captures 1,363.6 MiB of the 1,582.6, or 86.2%, leaving the 87.0% of
 *   grows that are 64 B or under exactly where they are, which is where they
 *   belong: the size-class heap serves them well and a reservation would not;
 *
 *   VirtualAlloc reserves on a 64 KiB granularity, so the address-space waste
 *   is 8x the promotion size here. At octave 10 it would be 64x, and that is
 *   the reason this cannot simply replace malloc for all arrays;
 *
 *   commit is page-granular, so the first commit at 8,192 bytes is exactly
 *   two pages with nothing wasted. Below one page it would round up and the
 *   saving would go backwards.
 *
 * HOW MUCH ADDRESS SPACE. The whole-run count (38,512 grows in octaves 14-16)
 * is NOT the live-at-once count and must not be used for this. The residency
 * lane answers it directly: this site's PROFLIVE `snap` -- its live bytes
 * sampled when process-wide live was at its high-water -- is 924,416 bytes in
 * the burst arm against 82,688 in the control. Under one megabyte of array
 * data live at peak, so with the largest arrays at 64 KiB the peak concurrent
 * promoted array count is of the order of ten, not thousands. At 16 MiB
 * reserved each that is ~160 MiB of ADDRESS SPACE (not memory) against a
 * 128 TiB user half. `snap` is sampled at the process-wide peak rather than
 * at this site's own, so treat it as an order of magnitude and not a bound --
 * which is why the fallback below exists and is counted rather than assumed
 * unreachable.
 *
 * `a->data` STAYS A PLAIN `uint64_t *`. Every other site in the runtime
 * indexes it directly and none of them learn anything about this. There is no
 * tagging and no offset: the reservation base IS the data pointer, because
 * commit starts at the base. The only bookkeeping is one byte, and it rides
 * the existing padding beside `weakkey`, so sizeof(ScrArr) is still 64 and
 * the header stays in the size class it already occupied.
 *
 * SCR_ARRAY_VM=0 is an ENV knob, not a build flag, so the A/B is one binary
 * and carries no code-layout confound.
 */
#ifndef SCR_ARR_VM
#define SCR_ARR_VM 1
#endif
#ifndef SCR_ARR_VM_MIN
#define SCR_ARR_VM_MIN 8192u
#endif
#ifndef SCR_ARR_VM_RESERVE
#define SCR_ARR_VM_RESERVE ((size_t)16 << 20)
#endif

#if SCR_ARR_VM && !defined(SCR_RC_AUDIT)

#ifdef _WIN32
#ifndef _WINSOCKAPI_
#define _WINSOCKAPI_
#endif
#include <windows.h>
#else
#include <sys/mman.h>
#include <unistd.h>
#endif

/* Counted, not assumed: a fallback that fires often would mean the
 * reservation is sized wrong, and a silent one would hide that. */
static long long scr_arr_vm_promoted = 0;
static long long scr_arr_vm_overflow = 0;
static long long scr_arr_vm_refused = 0;

long long scr_arr_vm_stat(int which) {
  return which == 0   ? scr_arr_vm_promoted
         : which == 1 ? scr_arr_vm_overflow
                      : scr_arr_vm_refused;
}

#ifndef SCR_ARR_VM_STAT
/* The counters are always kept; their REPORT does not ship.
 *
 * atexit() is an AMBIENT SYMBOL. library-mode builds audit for exactly that
 * and this call site failed the audit -- "undefined reference to atexit" --
 * on the first full gate after it landed, in both the C and the LLVM arm. A
 * diagnostic that nothing in a shipping build will ever ask for must not
 * drag a CRT registration into every link, and the same reasoning gates the
 * page-return report in scr_cycle.c. Build with -DSCR_ARR_VM_STAT=1 and the
 * env knob works; scr_arr_vm_stat() is always available for a harness that
 * would rather read numbers than parse text. */
#define SCR_ARR_VM_STAT 0
#endif
#if SCR_ARR_VM_STAT
/* SCR_ARRAY_VM_STAT=1 prints the three counters at exit. It exists because
 * "both arms printed the same thing" is NOT evidence that the reservation
 * path ran -- a promotion that never happened also prints the same thing.
 * The test that asserts correctness has to be able to assert that the code
 * it is checking was reached, and a zero here is the only thing that can say
 * it was not. */
static void scr_arr_vm_report(void) {
  fprintf(stderr, "[arrvm] promoted=%lld overflow=%lld refused=%lld min=%u reserve=%llu\n",
          scr_arr_vm_promoted, scr_arr_vm_overflow, scr_arr_vm_refused,
          (unsigned)SCR_ARR_VM_MIN, (unsigned long long)SCR_ARR_VM_RESERVE);
  if (scr_arr_vm_promoted == 0) {
    fprintf(stderr, "[arrvm] NOTHING PROMOTED - no array reached %u bytes, or"
                    " SCR_ARRAY_VM=0. This is not a measurement of the"
                    " reservation path.\n", (unsigned)SCR_ARR_VM_MIN);
  }
}

static void scr_arr_vm_arm(void) {
  static int armed = 0;
  const char *e;
  if (armed) return;
  e = getenv("SCR_ARRAY_VM_STAT");
  if (e == NULL || strtol(e, NULL, 10) == 0) {
    armed = 1;
    return;
  }
  armed = 1;
  atexit(scr_arr_vm_report);
}

#else
#define scr_arr_vm_arm() ((void)0)
#endif

static int scr_arr_vm_on(void) {
  static int cached = -1;
  if (cached < 0) {
    const char *e = getenv("SCR_ARRAY_VM");
    cached = e != NULL ? (strtol(e, NULL, 10) != 0) : 1;
  }
  return cached;
}

static size_t scr_arr_vm_page(void) {
  static size_t p = 0;
  if (p == 0) {
#ifdef _WIN32
    SYSTEM_INFO si;
    GetSystemInfo(&si);
    p = (size_t)si.dwPageSize;
#else
    long v = sysconf(_SC_PAGESIZE);
    p = v > 0 ? (size_t)v : 4096u;
#endif
    if (p == 0) p = 4096u;
  }
  return p;
}

/* Reserve without committing. NULL is a refusal, never a trap: every caller
 * falls back to realloc, so a failure here is a slower array and not a
 * broken one. */
static void *scr_arr_vm_reserve(void) {
#ifdef _WIN32
  return VirtualAlloc(NULL, SCR_ARR_VM_RESERVE, MEM_RESERVE, PAGE_READWRITE);
#else
  void *p = mmap(NULL, SCR_ARR_VM_RESERVE, PROT_NONE,
                 MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
  return p == MAP_FAILED ? NULL : p;
#endif
}

/* Commit [0, want) of an existing reservation. Idempotent on already-committed
 * pages on both platforms, which is what lets the caller compute the range
 * from `cap` alone and keep no second field. */
static int scr_arr_vm_commit(void *base, size_t want) {
  size_t pg = scr_arr_vm_page();
  size_t n = (want + pg - 1u) & ~(pg - 1u);
  if (n > SCR_ARR_VM_RESERVE) return 0;
#ifdef _WIN32
  return VirtualAlloc(base, n, MEM_COMMIT, PAGE_READWRITE) != NULL;
#else
  return mprotect(base, n, PROT_READ | PROT_WRITE) == 0;
#endif
}

static void scr_arr_vm_release(void *base) {
#ifdef _WIN32
  VirtualFree(base, 0, MEM_RELEASE);
#else
  munmap(base, SCR_ARR_VM_RESERVE);
#endif
}

#define SCR_ARR_VM_ON() scr_arr_vm_on()
#define SCR_ARR_VM_RELEASE(a)                     \
  do {                                            \
    if ((a)->vmbacked) scr_arr_vm_release((a)->data); \
    else free((a)->data);                         \
  } while (0)

#else /* the arena is compiled out: every array is a heap array */

#define SCR_ARR_VM_ON() 0
#define SCR_ARR_VM_RELEASE(a) free((a)->data)

#endif

/* ── lifecycle ─────────────────────────────────────────────────────────── */

static void scr_arr_grow(ScrArr *a, size_t need) {
  if (need <= a->cap) return;
  size_t cap = a->cap ? a->cap : 4;
  while (cap < need) {
    if (cap > SIZE_MAX / 2 / sizeof(uint64_t)) scr_arr_oom();
    cap *= 2;
  }
  {
    size_t want = cap * sizeof(uint64_t);
#if SCR_ARR_VM && !defined(SCR_RC_AUDIT)
    if (a->vmbacked) {
      /* Already reserved: commit the next step. No copy, no free, and the
       * heap never hears about it. This is the step that used to shred. */
      if (want <= SCR_ARR_VM_RESERVE && scr_arr_vm_commit(a->data, want)) {
        a->cap = cap;
        return;
      }
      /* Past the reservation: fall back to the heap, once, by copying out.
       * Counted -- a fallback that fires often means the reservation is
       * sized wrong, and a silent one would hide that. */
      {
        uint64_t *heap = (uint64_t *)malloc(want);
        if (!heap) scr_arr_oom();
        memcpy(heap, a->data, a->len * sizeof(uint64_t));
        scr_arr_vm_release(a->data);
        a->vmbacked = 0;
        a->data = heap;
        a->cap = cap;
        scr_arr_vm_overflow++;
        return;
      }
    }
    if (want >= SCR_ARR_VM_MIN) {
      void *base;
      scr_arr_vm_arm();
      if (!SCR_ARR_VM_ON()) goto heap;
      base = scr_arr_vm_reserve();
      if (base != NULL && scr_arr_vm_commit(base, want)) {
        memcpy(base, a->data, a->len * sizeof(uint64_t));
        free(a->data);
        a->data = (uint64_t *)base;
        a->vmbacked = 1;
        a->cap = cap;
        scr_arr_vm_promoted++;
        return;
      }
      if (base != NULL) scr_arr_vm_release(base);
      /* A refusal is a slower array, never a broken one. */
      scr_arr_vm_refused++;
    }
  heap:;
#endif
    {
      uint64_t *data = (uint64_t *)realloc(a->data, want);
      if (!data) scr_arr_oom();
      a->data = data;
      a->cap = cap;
    }
  }
}

ScrArr *scr_arr_new(ScrElemKind elem, size_t initial_cap) {
  ScrArr *a = malloc(sizeof(ScrArr));
  if (!a) scr_arr_oom();
  a->rc = 1;
  a->len = 0;
  a->cap = 0;
  a->elem = elem;
  a->elem_retain = NULL;
  a->elem_release = NULL;
  a->elem_trace = NULL;
  a->data = NULL;
  a->vmbacked = 0;
  if (initial_cap > 0) scr_arr_grow(a, initial_cap);
#ifdef SCR_RC_AUDIT
  scr_live_arrays++;
#endif
  return a;
}

/* Collector trace of a cycle-capable array: every element is a headered
 * child (elem_trace non-NULL means the element TYPE carries a header, and
 * arrays are monomorphic), so trace visits all of them and the teardown
 * below releases none — the complement contract in scr_runtime.h. */
void scr_arr_trace_v(void *a0, ScrTraceVisit visit, void *ctx) {
  ScrArr *a = (ScrArr *)a0;
  for (size_t i = 0; i < a->len; i++) {
    void *p = scr_slot_to_ptr(a->data[i]);
    if (p != NULL) visit(p, ctx); /* an ABSENT slot is not an edge */
  }
}

static void scr_arr_gc_free(void *a0) {
  ScrArr *a = (ScrArr *)a0;
  SCR_ARR_VM_RELEASE(a);
#ifdef SCR_RC_AUDIT
  scr_live_arrays--;
#endif
  scr_cyc_free(a);
}

ScrArr *scr_arr_new_ref(void *(*elem_retain)(void *),
                         void (*elem_release)(void *),
                         ScrTraceFn elem_trace, size_t initial_cap) {
  ScrArr *a;
  if (elem_trace) {
    a = scr_cyc_alloc(sizeof(ScrArr), &scr_arr_trace_v, &scr_arr_gc_free);
  } else {
    a = malloc(sizeof(ScrArr));
    if (!a) scr_arr_oom();
  }
  a->rc = 1;
  a->len = 0;
  a->cap = 0;
  a->elem = SCR_ELEM_REF;
  a->elem_retain = elem_retain;
  a->elem_release = elem_release;
  a->elem_trace = elem_trace;
  a->data = NULL;
  a->vmbacked = 0;
  if (initial_cap > 0) scr_arr_grow(a, initial_cap);
#ifdef SCR_RC_AUDIT
  scr_live_arrays++;
#endif
  return a;
}

/* ScrArr's weak-key stamp. UNTRACED arrays only: a traced one carries a
 * cycle header and takes scr_cyc_weak_mark instead, because its death can
 * arrive from the collector without scr_arr_release running at all. See
 * the note on ScrArr::weakkey and the one in scr_arr_release below. */
void scr_arr_weak_mark(void *key) {
  if (key != NULL) ((ScrArr *)key)->weakkey = 1;
}

void scr_arr_release(ScrArr *a) {
  if (!a || a->rc == SIZE_MAX) return; /* NULL: an uninitialized `let` local */
  if (--a->rc == 0) {
    /* BEFORE anything is handed back, so no WeakMap can still hold this
     * address once it stops naming this array. An UNTRACED array is a plain
     * malloc/free that never reaches scr_cyc_free, so this is its only
     * death chokepoint.
     *
     * A TRACED array is a weak key too now, and it does NOT come through
     * here. Its stamp goes in the CYCLE HEADER (scr_cyc_weak_mark) and the
     * hook that reads it is the first line of scr_cyc_free, because the
     * collector can free a traced array through scr_arr_gc_free without
     * this release ever running. So ScrArr::weakkey stays 0 on a traced
     * array and exactly one of the two hooks fires for any given array —
     * the compiler picks the stamp from the real trace fixpoint. */
    if (a->weakkey && scr_weak_died_hook != NULL) scr_weak_died_hook(a);
    if (a->elem_trace) scr_cyc_on_dead(a);
    if (scr_elem_is_ref(a->elem)) {
      for (size_t i = 0; i < a->len; i++) scr_elem_release(a, a->data[i]);
    }
    if (a->elem_trace) {
      scr_arr_gc_free(a);
    } else {
      SCR_ARR_VM_RELEASE(a);
#ifdef SCR_RC_AUDIT
      scr_live_arrays--;
#endif
      free(a);
    }
  } else if (a->elem_trace) {
    scr_cyc_on_release(a); /* possible cycle root; may collect */
  }
}

double scr_arr_len(ScrArr *a) { return (double)a->len; }

/* ── Math.max/min over one spread number[] ─────────────────────────────
 * The JS fold exactly (ECMA Math.max/min applied to the elements): any
 * NaN poisons the result, +0 beats -0 for max (the reverse for min), and
 * the empty array yields the zero-argument constants. Borrows the array. */
double scr_math_max_arr(ScrArr *a) {
  double best = -INFINITY;
  for (size_t i = 0; i < a->len; i++) {
    double v = scr_slot_to_f64(a->data[i]);
    if (isnan(v)) return v;
    if (v > best || (v == 0.0 && best == 0.0 && !signbit(v))) best = v;
  }
  return best;
}

double scr_math_min_arr(ScrArr *a) {
  double best = INFINITY;
  for (size_t i = 0; i < a->len; i++) {
    double v = scr_slot_to_f64(a->data[i]);
    if (isnan(v)) return v;
    if (v < best || (v == 0.0 && best == 0.0 && signbit(v))) best = v;
  }
  return best;
}

/* ── reads ─────────────────────────────────────────────────────────────── */

double scr_arr_get_f64(ScrArr *a, double i) {
  return scr_slot_to_f64(a->data[scr_arr_check_index(a, i, false)]);
}

bool scr_arr_get_bool(ScrArr *a, double i) {
  return a->data[scr_arr_check_index(a, i, false)] != 0;
}

void *scr_arr_get_ref(ScrArr *a, double i) {
  size_t idx = scr_arr_check_index(a, i, false);
  void *p = scr_slot_to_ptr(a->data[idx]);
  if (p == NULL) scr_arr_trap_absent(idx, a->len);
  return scr_elem_retain_p(a, p);
}

/* The COPY read: same +1, but an ABSENT slot copies through as absent
 * instead of refusing. Used by the spread and pushSpread loops the
 * emitters build, which are element-for-element copies — `[...a]` and
 * `b.push(...a)` over a holey array answer holes in JS, exactly like
 * `a.slice()`, and it would be incoherent for slice to survive a hole
 * while the spread beside it trapped. Bounds are still checked. */
void *scr_arr_copy_ref(ScrArr *a, double i) {
  void *p = scr_slot_to_ptr(a->data[scr_arr_check_index(a, i, false)]);
  return scr_elem_retain_p(a, p);
}

/* ── writes: i == len appends ──────────────────────────────────────────── */

static void scr_arr_set_slot(ScrArr *a, double i, uint64_t slot) {
  size_t idx = scr_arr_check_index(a, i, true);
  if (idx == a->len) {
    scr_arr_grow(a, a->len + 1);
    a->len++;
    a->data[idx] = slot;
    return;
  }
  /* Unlink-then-release: a release can trigger a cycle collection, which
   * must never see a heap edge whose count was already given up. */
  uint64_t old = a->data[idx];
  a->data[idx] = slot;
  if (scr_elem_is_ref(a->elem)) scr_elem_release(a, old);
}

void scr_arr_set_f64(ScrArr *a, double i, double v) {
  scr_arr_set_slot(a, i, scr_slot_from_f64(v));
}

void scr_arr_set_bool(ScrArr *a, double i, bool v) {
  scr_arr_set_slot(a, i, (uint64_t)(v ? 1 : 0));
}

void scr_arr_set_ref(ScrArr *a, double i, void *v) {
  scr_arr_set_slot(a, i, scr_slot_from_ptr(v));
}

/* ── push / pop ────────────────────────────────────────────────────────── */

static double scr_arr_push_slot(ScrArr *a, uint64_t slot) {
  scr_arr_grow(a, a->len + 1);
  a->data[a->len++] = slot;
  return (double)a->len;
}

double scr_arr_push_f64(ScrArr *a, double v) {
  return scr_arr_push_slot(a, scr_slot_from_f64(v));
}

double scr_arr_push_bool(ScrArr *a, bool v) {
  return scr_arr_push_slot(a, (uint64_t)(v ? 1 : 0));
}

double scr_arr_push_ref(ScrArr *a, void *v) {
  return scr_arr_push_slot(a, scr_slot_from_ptr(v));
}

/* ── unshift ───────────────────────────────────────────────────────────
 * push's mirror at the FRONT: the tail slides up one and the new element
 * takes index 0, answering the new length. Ownership of a refcounted
 * argument moves IN, exactly like push — the emitter's moveTemp gives up
 * the caller's reference. The variadic form is the emitter's: it
 * evaluates every argument left to right (JS order) and then unshifts
 * them RIGHT to left, which lands them in declaration order at the head.
 * One memmove per argument, and argument counts are single digits. */
static double scr_arr_unshift_slot(ScrArr *a, uint64_t slot) {
  scr_arr_grow(a, a->len + 1);
  memmove(a->data + 1, a->data, a->len * sizeof(uint64_t));
  a->data[0] = slot;
  a->len++;
  return (double)a->len;
}

double scr_arr_unshift_f64(ScrArr *a, double v) {
  return scr_arr_unshift_slot(a, scr_slot_from_f64(v));
}

double scr_arr_unshift_bool(ScrArr *a, bool v) {
  return scr_arr_unshift_slot(a, (uint64_t)(v ? 1 : 0));
}

double scr_arr_unshift_ref(ScrArr *a, void *v) {
  return scr_arr_unshift_slot(a, scr_slot_from_ptr(v));
}

/* ── reverse ───────────────────────────────────────────────────────────
 * In place, then the RECEIVER back (+1) for chaining — fill's contract,
 * and the reason `a.reverse()` and `a` stay the same array in JS. Slots
 * only swap positions, so no element's reference count changes. */
ScrArr *scr_arr_reverse(ScrArr *a) {
  if (a->len > 1) {
    for (size_t i = 0, j = a->len - 1; i < j; i++, j--) {
      uint64_t t = a->data[i];
      a->data[i] = a->data[j];
      a->data[j] = t;
    }
  }
  return scr_arr_retain(a);
}

/* ── copyWithin(target, start[, end]) ──────────────────────────────────
 * Copies the [start, end) run over the slots at target, IN PLACE and
 * without changing the length, then answers the receiver (+1). Every
 * index goes through ToIntegerOrInfinity with negative-from-the-end
 * resolution and clamping to [0, len] — splice's ladder — and the count
 * is min(end - start, len - target), so nothing ever runs off the end.
 * An omitted `end` arrives as +Infinity (the slice convention).
 *
 * Reference elements are the only interesting part: a copied value gains
 * a reference and an overwritten slot gives one up. Source and
 * destination OVERLAP in general (the ring-buffer compaction shape,
 * copyWithin(0, head), overlaps whenever head*2 < len), so the whole
 * source run is retained into scratch FIRST — a release during the write
 * can then never free a slot the copy still has to read. The writes
 * themselves are unlink-then-release, scr_arr_set_slot's discipline. */
ScrArr *scr_arr_copy_within(ScrArr *a, double target, double start,
                            double end) {
  double len = (double)a->len;
  double t0 = isnan(target) ? 0 : trunc(target);
  if (t0 < 0) t0 += len;
  size_t to = t0 <= 0 ? 0 : (t0 >= len ? a->len : (size_t)t0);
  double s0 = isnan(start) ? 0 : trunc(start);
  if (s0 < 0) s0 += len;
  size_t from = s0 <= 0 ? 0 : (s0 >= len ? a->len : (size_t)s0);
  double e0 = isnan(end) ? 0 : trunc(end);
  if (e0 < 0) e0 += len;
  size_t fin = e0 <= 0 ? 0 : (e0 >= len ? a->len : (size_t)e0);
  size_t count = fin > from ? fin - from : 0;
  if (count > a->len - to) count = a->len - to;
  if (count == 0) return scr_arr_retain(a);
  if (!scr_elem_is_ref(a->elem)) {
    memmove(a->data + to, a->data + from, count * sizeof(uint64_t));
    return scr_arr_retain(a);
  }
  uint64_t *tmp = malloc(count * sizeof(uint64_t));
  if (!tmp) scr_arr_oom();
  for (size_t i = 0; i < count; i++) {
    tmp[i] = scr_slot_from_ptr(
        scr_elem_retain_p(a, scr_slot_to_ptr(a->data[from + i])));
  }
  for (size_t i = 0; i < count; i++) {
    uint64_t old = a->data[to + i];
    a->data[to + i] = tmp[i];
    scr_elem_release(a, old);
  }
  free(tmp);
  return scr_arr_retain(a);
}

static uint64_t scr_arr_pop_slot(ScrArr *a) {
  if (a->len == 0) {
    scr_trap("scriptc: RangeError: pop() on an empty array\n");
  }
  return a->data[--a->len];
}

double scr_arr_pop_f64(ScrArr *a) { return scr_slot_to_f64(scr_arr_pop_slot(a)); }

bool scr_arr_pop_bool(ScrArr *a) { return scr_arr_pop_slot(a) != 0; }

/* pop/shift hand the element OUT to a typed slot, so an ABSENT one refuses
 * here for the same reason the indexed read does — and for one more: the
 * receiving slot's type has no null, so `p === null` on the result folds to
 * the constant false and the hole reads as a live object. */
void *scr_arr_pop_ref(ScrArr *a) {
  size_t idx = a->len ? a->len - 1 : 0;
  void *p = scr_slot_to_ptr(scr_arr_pop_slot(a));
  if (p == NULL) scr_arr_trap_absent(idx, a->len + 1);
  return p;
}

/* ── shift ─────────────────────────────────────────────────────────────
 * The first element out, tail sliding down. The EMITTER guards the empty
 * array (JS answers undefined there — the `elem | undefined` union), so
 * an empty receiver here is an internal error, pop's discipline. Ref
 * ownership moves out to the caller (no retain). */
static uint64_t scr_arr_shift_slot(ScrArr *a) {
  if (a->len == 0) {
    scr_trap("scriptc: internal error: shift() on an empty array\n");
  }
  uint64_t s = a->data[0];
  a->len--;
  memmove(a->data, a->data + 1, a->len * sizeof(uint64_t));
  return s;
}

double scr_arr_shift_f64(ScrArr *a) { return scr_slot_to_f64(scr_arr_shift_slot(a)); }

bool scr_arr_shift_bool(ScrArr *a) { return scr_arr_shift_slot(a) != 0; }

void *scr_arr_shift_ref(ScrArr *a) {
  void *p = scr_slot_to_ptr(scr_arr_shift_slot(a));
  if (p == NULL) scr_arr_trap_absent(0, a->len + 1);
  return p;
}

/* ── splice (the removal forms) ────────────────────────────────────────
 * a.splice(start, deleteCount) with Node's exact index handling: start
 * goes through ToIntegerOrInfinity with negative-from-the-end resolution
 * and clamps to [0, len]; deleteCount clamps to [0, len - start] (the
 * omitted-count form passes +Infinity — remove to the end). The removed
 * elements come back as a fresh +1 array IN ORDER, their ownership MOVED
 * out of the receiver (no retain/release churn); the tail slides down.
 * Borrows a. */
ScrArr *scr_arr_splice(ScrArr *a, double start, double deleteCount) {
  double len = (double)a->len;
  double s0 = isnan(start) ? 0 : trunc(start);
  if (s0 < 0) s0 += len;
  size_t from = s0 <= 0 ? 0 : s0 >= len ? a->len : (size_t)s0;
  double avail = len - (double)from;
  double d0 = isnan(deleteCount) ? 0 : trunc(deleteCount);
  size_t n = d0 <= 0 ? 0 : d0 >= avail ? (size_t)avail : (size_t)d0;
  ScrArr *out =
      a->elem == SCR_ELEM_REF
          ? scr_arr_new_ref(a->elem_retain, a->elem_release, a->elem_trace, n ? n : 1)
          : scr_arr_new(a->elem, n ? n : 1);
  if (n > 0) {
    memcpy(out->data, a->data + from, n * sizeof(uint64_t));
    out->len = n;
    memmove(a->data + from, a->data + from + n, (a->len - from - n) * sizeof(uint64_t));
    a->len -= n;
  }
  return out;
}

/* ── indexOf / includes ────────────────────────────────────────────────
 * indexOf uses JS strict equality (===): NaN never matches (NaN !== NaN),
 * -0 matches 0 (C == agrees on both). includes uses SameValueZero: the one
 * difference is that NaN DOES match NaN. Reference elements: strings by
 * content (JS strings are primitive values), arrays by pointer identity.
 * All needles are borrowed. */

static bool scr_arr_ref_eq(const ScrArr *a, uint64_t slot, void *v) {
  void *p = scr_slot_to_ptr(slot);
  /* An ABSENT slot matches only an absent needle: scr_str_eq dereferences
   * both sides, so the STR arm cannot be handed a hole. */
  if (p == NULL || v == NULL) return p == v;
  if (a->elem == SCR_ELEM_STR) return scr_str_eq((ScrStr *)p, (ScrStr *)v);
  return p == v;
}

double scr_arr_index_of_f64(ScrArr *a, double v) {
  for (size_t i = 0; i < a->len; i++) {
    if (scr_slot_to_f64(a->data[i]) == v) return (double)i; /* NaN: never */
  }
  return -1;
}

double scr_arr_index_of_bool(ScrArr *a, bool v) {
  for (size_t i = 0; i < a->len; i++) {
    if ((a->data[i] != 0) == v) return (double)i;
  }
  return -1;
}

double scr_arr_index_of_ref(ScrArr *a, void *v) {
  for (size_t i = 0; i < a->len; i++) {
    if (scr_arr_ref_eq(a, a->data[i], v)) return (double)i;
  }
  return -1;
}

bool scr_arr_includes_f64(ScrArr *a, double v) {
  for (size_t i = 0; i < a->len; i++) {
    double x = scr_slot_to_f64(a->data[i]);
    if (x == v || (x != x && v != v)) return true; /* SameValueZero: NaN hits */
  }
  return false;
}

bool scr_arr_includes_bool(ScrArr *a, bool v) {
  return scr_arr_index_of_bool(a, v) >= 0;
}

bool scr_arr_includes_ref(ScrArr *a, void *v) {
  return scr_arr_index_of_ref(a, v) >= 0;
}

/* ── join ──────────────────────────────────────────────────────────────── */

#ifdef SCR_ARRCEN_ON
/* Reset by scr_arr_join at entry and read at its exit. Single-threaded by
 * construction here: the compiled programs this census runs against have
 * one JS thread, and scr_str_raw -- the only other caller of
 * scr_join_append -- is never nested inside a join. */
static long long scr_join_grows, scr_join_moved;
#endif

static void scr_join_append(char **buf, size_t *len, size_t *cap,
                             const char *bytes, size_t n) {
  if (*len + n > *cap) {
#ifdef SCR_ARRCEN_ON
    scr_join_grows++;
    scr_join_moved += (long long)*len;   /* bytes live when realloc is asked */
#endif
    size_t cap2 = *cap;
    while (*len + n > cap2) {
      if (cap2 > SIZE_MAX / 2) scr_arr_oom();
      cap2 *= 2;
    }
    char *grown = realloc(*buf, cap2);
    if (!grown) scr_arr_oom();
    *buf = grown;
    *cap = cap2;
  }
  memcpy(*buf + *len, bytes, n);
  *len += n;
}

/* `a.slice(start?, end?)` — a fresh shallow copy of the index range,
 * JS-exact: indices go through ToIntegerOrInfinity (the emitter fills the
 * omitted defaults 0 / +Infinity), negatives count from the end, both
 * clamp to [0, len]. Ref elements RETAIN into the copy — the same
 * references, exactly JS's shallow copy. Borrows a; returns +1. */
ScrArr *scr_arr_slice(ScrArr *a, double start, double end) {
  /* ToIntegerOrInfinity + relative-index resolution over the LENGTH. */
  double len = (double)a->len;
  double s0 = isnan(start) ? 0 : trunc(start);
  double e0 = isnan(end) ? 0 : trunc(end);
  if (s0 < 0) s0 += len;
  if (e0 < 0) e0 += len;
  size_t from = s0 <= 0 ? 0 : s0 >= len ? a->len : (size_t)s0;
  size_t to = e0 <= 0 ? 0 : e0 >= len ? a->len : (size_t)e0;
  size_t n = to > from ? to - from : 0;
#ifdef SCR_ARRCEN_ON
  /* tests/perf/arrcensus/scr_arr_census.h. Inert -- the switch is undefined --
   * unless that header is -include'd, which is the only way to tell a
   * quadratic here from a million small copies. */
  scr_arrcen_note_slice((long long)a->len, (long long)n, (int)a->elem);
#endif
  ScrArr *out =
      a->elem == SCR_ELEM_REF
          ? scr_arr_new_ref(a->elem_retain, a->elem_release, a->elem_trace, n ? n : 1)
          : scr_arr_new(a->elem, n ? n : 1);
  if (n != 0) {
    /* The slots move in one memcpy, and the retain decision is made ONCE.
     *
     * The element-at-a-time loop this replaces read `a->elem` and ran
     * scr_elem_retain_p's four-way kind test on EVERY element, and it could
     * not be hoisted by the compiler: the runtime is built
     * -fno-strict-aliasing (the emitted object model type-puns), so a store
     * into `out->data` may alias `a->elem` for all clang can prove, and the
     * kind is reloaded and re-branched per element. On the f64 and bool
     * arms that made a pure memcpy into a branchy per-slot copy for no
     * work at all.
     *
     * Semantics are unchanged, element for element:
     *   - an ABSENT slot is a NULL pointer and is copied through as absent,
     *     retaining nothing, exactly as scr_elem_retain_p's NULL arm does;
     *   - scr_str_retain / scr_arr_retain / scr_bytes_retain all RETURN
     *     their argument, so the memcpy has already written the right slot
     *     and only the count needs bumping. scr_arr_retain's
     *     scr_cyc_mark_live arm rides along inside it;
     *   - SCR_ELEM_REF goes through the array's own retain function
     *     pointer, whose return value is NOT ours to assume, so that arm
     *     stores it back. */
    uint64_t *dst = out->data;
    memcpy(dst, a->data + from, n * sizeof *dst);
    out->len = n;
    switch (a->elem) {
      case SCR_ELEM_STR:
        for (size_t i = 0; i < n; i++) {
          ScrStr *p = (ScrStr *)scr_slot_to_ptr(dst[i]);
          if (p != NULL) (void)scr_str_retain(p);
        }
        break;
      case SCR_ELEM_ARR:
        for (size_t i = 0; i < n; i++) {
          ScrArr *p = (ScrArr *)scr_slot_to_ptr(dst[i]);
          if (p != NULL) (void)scr_arr_retain(p);
        }
        break;
      case SCR_ELEM_BYTES:
        for (size_t i = 0; i < n; i++) {
          ScrBytes *p = (ScrBytes *)scr_slot_to_ptr(dst[i]);
          if (p != NULL) (void)scr_bytes_retain(p);
        }
        break;
      case SCR_ELEM_REF: {
        void *(*retain)(void *) = a->elem_retain;
        for (size_t i = 0; i < n; i++) {
          void *p = scr_slot_to_ptr(dst[i]);
          if (p != NULL) dst[i] = scr_slot_from_ptr(retain(p));
        }
        break;
      }
      case SCR_ELEM_F64:
      case SCR_ELEM_BOOL:
        break; /* the memcpy IS the copy */
    }
  }
  return out;
}

ScrStr *scr_arr_join(ScrArr *a, ScrStr *sep) {
#ifdef SCR_ARRCEN_ON
  scr_join_grows = 0;
  scr_join_moved = 0;
#endif
  size_t cap = 64, len = 0;
  char *buf = malloc(cap);
  if (!buf) scr_arr_oom();
  for (size_t i = 0; i < a->len; i++) {
    if (i > 0) scr_join_append(&buf, &len, &cap, sep->data, sep->len);
    switch (a->elem) {
      case SCR_ELEM_F64: {
        char nb[32];
        size_t n = scr_f64_to_str(scr_slot_to_f64(a->data[i]), nb);
        scr_join_append(&buf, &len, &cap, nb, n);
        break;
      }
      case SCR_ELEM_BOOL:
        if (a->data[i] != 0) scr_join_append(&buf, &len, &cap, "true", 4);
        else scr_join_append(&buf, &len, &cap, "false", 5);
        break;
      case SCR_ELEM_STR: {
        const ScrStr *s = (const ScrStr *)scr_slot_to_ptr(a->data[i]);
        scr_join_append(&buf, &len, &cap, s->data, s->len);
        break;
      }
      case SCR_ELEM_ARR:
      case SCR_ELEM_BYTES:
      case SCR_ELEM_REF:
        /* The compiler rejects join on ref-element arrays (SC1090). */
        scr_trap("scriptc: internal error: join on a ref-element array\n");
    }
  }
#ifdef SCR_ARRCEN_ON
#ifdef SCR_ARRCEN_HAS_JOIN
  scr_arrcen_note_join((long long)a->len, (long long)len, (int)a->elem,
                       scr_join_grows, scr_join_moved);
#else
  scr_arrcen_note(SCR_ARRCEN_JOIN_SRC, (long long)a->len);
  scr_arrcen_note(SCR_ARRCEN_JOIN_OUT, (long long)len);
#endif
#endif
  ScrStr *out = scr_str_new(buf, len);
  free(buf);
  return out;
}

/* String.raw over the template's raw literals and PRE-STRINGIFIED
 * substitutions (the frontend applies the static ToString per value):
 * raw[0] sub[0] raw[1] sub[1] ... — substitutions beyond raw.len-1 drop,
 * missing ones skip, exactly the spec's loop. Both arrays are
 * SCR_ELEM_STR; borrows both; +1 result. Never throws. */
ScrStr *scr_str_raw(ScrArr *raw, ScrArr *subs) {
  size_t cap = 64, len = 0;
  char *buf = malloc(cap);
  if (!buf) scr_arr_oom();
  for (size_t i = 0; i < raw->len; i++) {
    const ScrStr *s = (const ScrStr *)scr_slot_to_ptr(raw->data[i]);
    scr_join_append(&buf, &len, &cap, s->data, s->len);
    if (i + 1 < raw->len && i < subs->len) {
      const ScrStr *v = (const ScrStr *)scr_slot_to_ptr(subs->data[i]);
      scr_join_append(&buf, &len, &cap, v->data, v->len);
    }
  }
  ScrStr *out = scr_str_new(buf, len);
  free(buf);
  return out;
}

/* ── fill(value[, start[, end]]) ──────────────────────────────────────────
 * Writes `v` into every slot of [start, end), then answers the RECEIVER
 * (+1 — the caller owns a reference, like every other returning method).
 * Index handling is the slice family's: relative from the end when
 * negative, clamped to [0, len]; an end at or before start writes
 * nothing. Writes go through scr_arr_set_*, so each one releases the slot
 * it replaces — which is what makes fill safe over an array of ABSENT
 * slots (the new Array(n) shape) and over one already holding values.
 *
 * The ref form BORROWS `v` and takes its own +1 per slot: the array owns
 * every element it holds, and one incoming reference cannot cover n of
 * them. */
ScrArr *scr_arr_fill_f64(ScrArr *a, double v, double start, double end) {
  double len = (double)a->len;
  double s = start < 0 ? start + len : start;
  double e = end < 0 ? end + len : end;
  if (!(s >= 0)) s = 0; /* NaN and negatives past the start clamp */
  if (s > len) s = len;
  if (!(e >= 0)) e = 0;
  if (e > len) e = len;
  for (double i = s; i < e; i += 1) scr_arr_set_f64(a, i, v);
  return scr_arr_retain(a);
}

ScrArr *scr_arr_fill_bool(ScrArr *a, bool v, double start, double end) {
  double len = (double)a->len;
  double s = start < 0 ? start + len : start;
  double e = end < 0 ? end + len : end;
  if (!(s >= 0)) s = 0;
  if (s > len) s = len;
  if (!(e >= 0)) e = 0;
  if (e > len) e = len;
  for (double i = s; i < e; i += 1) scr_arr_set_bool(a, i, v);
  return scr_arr_retain(a);
}

ScrArr *scr_arr_fill_ref(ScrArr *a, void *v, double start, double end) {
  double len = (double)a->len;
  double s = start < 0 ? start + len : start;
  double e = end < 0 ? end + len : end;
  if (!(s >= 0)) s = 0;
  if (s > len) s = len;
  if (!(e >= 0)) e = 0;
  if (e > len) e = len;
  for (double i = s; i < e; i += 1) scr_arr_set_ref(a, i, scr_elem_retain_p(a, v));
  return scr_arr_retain(a);
}

/* `a.length = n` — the VALIDITY gate the spec puts in front of the store.
 * ArraySetLength runs ToUint32(v) and compares it back against ToNumber(v);
 * a mismatch is a RangeError("Invalid array length") thrown BEFORE any
 * element moves. That rejects negatives, fractions, NaN and anything at or
 * past 2^32 — Node's exact message and exact timing (`a.length = -1` leaves
 * the array untouched). Catchable, so the emitter's pending check follows
 * the call, and the truncate/grow pair below only runs on a valid length. */
void scr_arr_length_gate(double n) {
  if (!(n >= 0) || n > 4294967295.0 || n != trunc(n)) {
    static const char msg[] = "Invalid array length";
    scr_throw_error_msg(SCR_ERR_RANGE, msg, sizeof msg - 1);
  }
}

/* ── length = n, the SHRINK half ──────────────────────────────────────────
 * Drops every element from index n on, releasing refcounted ones (the
 * unlink-then-release discipline scr_arr_set_slot uses: the slot is gone
 * from the array before its count is given up, so a cycle collection
 * triggered by the release can never see a heap edge whose count was
 * already surrendered). n at or past the current length is a no-op --
 * GROWING is the emitter's half, since only it knows the element kind's
 * absent value. Index coercion is ToLength's: a fraction truncates, a
 * negative or NaN empties the array. */
void scr_arr_truncate(ScrArr *a, double n) {
  double want = n;
  if (!(want >= 0)) want = 0; /* NaN and negatives empty it */
  size_t target = want >= (double)a->len ? a->len : (size_t)want;
  while (a->len > target) {
    uint64_t slot = a->data[--a->len];
    if (scr_elem_is_ref(a->elem)) scr_elem_release(a, slot);
  }
}
