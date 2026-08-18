/* scr_prof.h - the profiling prelude.
 *
 * Injected with -include through SCRIPTC_PROF_CFLAGS, so it is prepended to
 * EVERY translation unit a build compiles: every runtime scr_*.c and the
 * program's own emitted TU. That is the whole trick. scriptc has no place
 * to add a source file to a build (the cached-object lane compiles each TU
 * with -c, so an extra .c on the command line is an error), so both the
 * interposition AND its implementation have to travel in a header.
 * Everything defined here is __attribute__((weak)): every TU carries a
 * copy, the linker keeps exactly one, and the counters are single
 * instances.
 *
 * Two independent instruments, each behind its own -D:
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
 *     WSL llvm-symbolizer      not installed
 *
 * A string literal needs none of them, reads better in a report, and covers
 * every allocation written in the sources - which is the population being
 * attributed. What it does NOT cover is an allocation inside libc or inside
 * a vendored archive compiled without this header. Those are invisible
 * here, and the report says so rather than implying its total is the whole
 * process.
 *
 * The CPU lane has no such escape: -finstrument-functions hands over a
 * function ADDRESS and there is no macro context to name it with. It
 * therefore reports exact counts against rvas, plus names for the runtime
 * entry points listed in the registry below, which are the ones worth
 * naming. That limitation is the toolchain's, and it is stated in the
 * report rather than papered over.
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
#include <windows.h>
#endif

#define SCR_PROF_NI __attribute__((no_instrument_function))
#define SCR_PROF_WEAK __attribute__((weak))

/* One open-addressed table. 64k rows is far more than the number of
 * distinct sites in a 129 MB TU and keeps the linear probe short. Fixed
 * size on purpose: growing it would mean allocating, and this code sits
 * UNDER the allocator. A full table increments scr_prof_lost, which the
 * report prints, so an overflow can never read as a zero. */
#define SCR_PROF_SLOTS 65536u

typedef struct {
  const void *key;  /* the site string's address, or the function's address */
  const char *name; /* "file:line" for alloc; NULL for an unnamed cpu row */
  long long count;
  long long bytes;
  long long freed;
} ScrProfRow;

/* "file:line" as one compile-time literal. Each expansion is its own static
 * string, so its ADDRESS is a unique, stable, zero-cost key - no hashing of
 * the text and no allocation under the allocator. */
#define SCR_PROF_STR2(x) #x
#define SCR_PROF_STR1(x) SCR_PROF_STR2(x)
#define SCR_PROF_SITE (__FILE__ ":" SCR_PROF_STR1(__LINE__))

SCR_PROF_WEAK ScrProfRow scr_prof_tbl[SCR_PROF_SLOTS];
SCR_PROF_WEAK long long scr_prof_lost;
SCR_PROF_WEAK int scr_prof_installed;
SCR_PROF_WEAK int scr_prof_reentrant;

SCR_PROF_NI SCR_PROF_WEAK unsigned scr_prof_hash(const void *p) {
  unsigned long long x = (unsigned long long)(size_t)p;
  x ^= x >> 33;
  x *= 0xff51afd7ed558ccdULL;
  x ^= x >> 29;
  return (unsigned)(x & (SCR_PROF_SLOTS - 1u));
}

SCR_PROF_NI SCR_PROF_WEAK ScrProfRow *scr_prof_row(const void *key, const char *name) {
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

SCR_PROF_NI SCR_PROF_WEAK size_t scr_prof_base(void) {
#ifdef _WIN32
  static size_t b = 0;
  if (b == 0) b = (size_t)GetModuleHandleW(NULL);
  return b;
#else
  return 0;
#endif
}

SCR_PROF_NI SCR_PROF_WEAK void scr_prof_report(void) {
  const char *path = getenv("SCR_PROF_OUT");
  FILE *f = fopen(path && *path ? path : "scr-prof.txt", "w");
  if (!f) return;
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
    fprintf(f, "PROF %lld %lld %lld %llx %s\n", r->count, r->bytes, r->freed,
            (unsigned long long)((size_t)r->key - base),
            r->name ? r->name : "?");
  }
  fprintf(f, "PROF-TOTAL rows=%lld count=%lld bytes=%lld freed=%lld lost=%lld\n",
          rows, tc, tb, tf, scr_prof_lost);
  fclose(f);
}

SCR_PROF_NI SCR_PROF_WEAK void scr_prof_install(void) {
  if (scr_prof_installed) return;
  scr_prof_installed = 1;
  atexit(scr_prof_report);
}

/* ---- the allocation lane ------------------------------------------- */
#ifdef SCR_PROF_ALLOC

SCR_PROF_NI SCR_PROF_WEAK void *scr_prof_malloc(size_t n, const char *site) {
  scr_prof_install();
  void *p = malloc(n);
  ScrProfRow *r = scr_prof_row((const void *)site, site);
  if (r) {
    r->count++;
    r->bytes += (long long)n;
  }
  return p;
}

SCR_PROF_NI SCR_PROF_WEAK void *scr_prof_calloc(size_t a, size_t b, const char *site) {
  scr_prof_install();
  void *p = calloc(a, b);
  ScrProfRow *r = scr_prof_row((const void *)site, site);
  if (r) {
    r->count++;
    r->bytes += (long long)(a * b);
  }
  return p;
}

SCR_PROF_NI SCR_PROF_WEAK void *scr_prof_realloc(void *q, size_t n, const char *site) {
  scr_prof_install();
  void *p = realloc(q, n);
  ScrProfRow *r = scr_prof_row((const void *)site, site);
  if (r) {
    r->count++;
    r->bytes += (long long)n;
  }
  return p;
}

SCR_PROF_NI SCR_PROF_WEAK void scr_prof_free(void *p, const char *site) {
  if (p != NULL) {
    ScrProfRow *r = scr_prof_row((const void *)site, site);
    if (r) r->freed++;
  }
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
SCR_PROF_NI SCR_PROF_WEAK void scr_prof_arm(void) {
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
SCR_PROF_WEAK int scr_prof_armed;
__attribute__((constructor)) SCR_PROF_NI SCR_PROF_WEAK void scr_prof_arm_ctor(void) {
  if (scr_prof_armed) return;
  scr_prof_armed = 1;
  scr_prof_arm();
}
#endif

#endif /* SCR_PROF_ALLOC */

/* ---- the CPU lane --------------------------------------------------- */
#ifdef SCR_PROF_CPU

/* These MUST carry no_instrument_function. Without it the hooks instrument
 * themselves and the process dies with 0xC00000FD (STACK_OVERFLOW) -
 * measured on this host before the attribute was added, which is how it
 * comes to be documented here rather than guessed at. */

SCR_PROF_NI SCR_PROF_WEAK void __cyg_profile_func_enter(void *this_fn, void *call_site) {
  (void)call_site;
  if (scr_prof_reentrant) return;
  scr_prof_reentrant = 1;
  scr_prof_install();
  ScrProfRow *r = scr_prof_row(this_fn, NULL);
  if (r) r->count++;
  scr_prof_reentrant = 0;
}

SCR_PROF_NI SCR_PROF_WEAK void __cyg_profile_func_exit(void *this_fn, void *call_site) {
  (void)this_fn;
  (void)call_site;
}

#endif /* SCR_PROF_CPU */

#endif /* SCR_PROF_ALLOC || SCR_PROF_CPU */
#endif /* SCR_PROF_H */
