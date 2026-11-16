/* LAB (never in a shipped build): -include this AFTER tests/perf/cycensus/scr_cyc_census.h and next to -DSCR_HDR_COUNT, so the header report also survives process.exit(), which lowers to _Exit and skips atexit. */
#ifndef SCR_HC_EXIT_H
#define SCR_HC_EXIT_H
#include <stdlib.h>
void scr_hc_dump(void) __attribute__((weak));
#ifdef _Exit
#undef _Exit
#endif
#ifdef SCR_CYC_CENSUS_H
#define _Exit(c) (scr_cycen_report(), (scr_hc_dump ? scr_hc_dump() : (void)0), _Exit(c))
#else
#define _Exit(c) ((scr_hc_dump ? scr_hc_dump() : (void)0), _Exit(c))
#endif
#endif
