/* scr_layout_prof.c -- the profiler behind `scriptc build --layout-profile`.
 *
 * An instrumented build compiles every unit (the program, the runtime, the vendored libraries) with
 * -fsanitize-coverage=func,trace-pc-guard, which makes clang call __sanitizer_cov_trace_pc_guard on every function entry and
 * hand each module's guard array to __sanitizer_cov_trace_pc_guard_init once at start. THIS unit defines those two callbacks, so
 * the build never links clang's own sanitizer runtime (the flag is compile-only; see cc.ts layoutProfile). Nothing here is part of
 * an ordinary build: the unit is linked only under --layout-profile.
 *
 * WHAT IT RECORDS. Each function's FIRST entry in the current epoch: the callback clears the function's guard (so later entries cost a
 * load and a branch) and appends the caller's return address (an address INSIDE the function, which nm resolves to its symbol; the
 * image base is subtracted so the log is position-independent). Epochs are separated by SIGUSR1: it re-arms every guard, so a function
 * that is hot in the steady state is logged again in the epoch after the signal, and one that only ever ran during startup is not.
 * Send the signal when the program has finished starting up and is about to do its real work. Without a signal there is one epoch.
 *
 * WHERE IT GOES. At exit (a destructor) to $SCR_LAYOUT_PROFILE_OUT, default ./scr-layout-profile.txt:
 *     # scr-layout-profile 1 base=<hex> guards=<n> epochs=<n>
 *     <epoch> <offset-hex>          one line per (epoch, first entry)
 * `scriptc layout-order <exe> <profile>` turns it into the order file --layout-order reads.
 *
 * Every function here carries no_sanitize("coverage") so the callback is never instrumented (it would recurse). */
#define _GNU_SOURCE
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define NOCOV __attribute__((no_sanitize("coverage")))

#define SCR_LP_MAX_MODULES 4096

typedef struct {
  uint32_t *start, *stop;
} ScrLpRange;

static ScrLpRange scr_lp_ranges[SCR_LP_MAX_MODULES];
static unsigned scr_lp_nranges;
static uint64_t scr_lp_guards;
#define SCR_LP_CAP ((uint64_t)1 << 21) /* entries: every guard can fire once per epoch; zero pages cost nothing until written */
static uintptr_t scr_lp_log[SCR_LP_CAP]; /* return addresses, in order */
static uint32_t scr_lp_epoch_of[SCR_LP_CAP]; /* epoch of each log entry */
static volatile uint64_t scr_lp_n;
static volatile uint32_t scr_lp_epoch;

NOCOV void __sanitizer_cov_trace_pc_guard_init(uint32_t *start, uint32_t *stop) {
  if (start == stop || *start != 0) return; /* the compiler calls it once per module; a module may be re-announced */
  for (uint32_t *g = start; g < stop; g++) *g = 1; /* armed */
  if (scr_lp_nranges < SCR_LP_MAX_MODULES) {
    scr_lp_ranges[scr_lp_nranges].start = start;
    scr_lp_ranges[scr_lp_nranges].stop = stop;
    scr_lp_nranges++;
  }
  scr_lp_guards += (uint64_t)(stop - start);
}

NOCOV void __sanitizer_cov_trace_pc_guard(uint32_t *guard) {
  if (*guard == 0) return;
  *guard = 0;
  uint64_t i = __atomic_fetch_add(&scr_lp_n, 1, __ATOMIC_RELAXED);
  if (i < SCR_LP_CAP) {
    scr_lp_log[i] = (uintptr_t)__builtin_return_address(0);
    scr_lp_epoch_of[i] = scr_lp_epoch;
  }
}

NOCOV static void scr_lp_rearm(int sig) {
  (void)sig;
  for (unsigned m = 0; m < scr_lp_nranges; m++)
    for (uint32_t *g = scr_lp_ranges[m].start; g < scr_lp_ranges[m].stop; g++) *g = 1;
  __atomic_fetch_add(&scr_lp_epoch, 1, __ATOMIC_RELAXED);
}

NOCOV static void scr_lp_dump(void) {
  const char *path = getenv("SCR_LAYOUT_PROFILE_OUT");
  if (path == NULL || path[0] == '\0') path = "scr-layout-profile.txt";
  FILE *f = fopen(path, "w");
  if (f == NULL) return;
  extern char __ehdr_start;
  uint64_t n = scr_lp_n < SCR_LP_CAP ? scr_lp_n : SCR_LP_CAP;
  fprintf(f, "# scr-layout-profile 1 base=%lx guards=%llu epochs=%u\n", (unsigned long)(uintptr_t)&__ehdr_start,
          (unsigned long long)scr_lp_guards, (unsigned)scr_lp_epoch + 1u);
  for (uint64_t i = 0; i < n; i++)
    fprintf(f, "%u %lx\n", (unsigned)scr_lp_epoch_of[i], (unsigned long)(scr_lp_log[i] - (uintptr_t)&__ehdr_start));
  fclose(f);
}

/* The program is about to leave through _Exit (process.exit(), or process.exitCode set), which runs no destructor: scr_lib.c calls the
 * function pointer the constructor below stores in scr_layout_prof_exit. Dumping twice is harmless: the file is simply rewritten. */
extern void (*scr_layout_prof_exit)(void);
NOCOV static void scr_lp_dump_at_exit(void) { scr_lp_dump(); }

__attribute__((constructor(101))) NOCOV static void scr_lp_start(void) {
  struct sigaction sa;
  memset(&sa, 0, sizeof sa);
  sa.sa_handler = scr_lp_rearm;
  sa.sa_flags = SA_RESTART;
  sigemptyset(&sa.sa_mask);
  sigaction(SIGUSR1, &sa, NULL);
  scr_layout_prof_exit = scr_lp_dump_at_exit;
}

__attribute__((destructor)) NOCOV static void scr_lp_finish(void) { scr_lp_dump(); }


