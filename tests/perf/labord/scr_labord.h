/* scr_labord.h -- LAB ONLY. Counts the instances of every class that owns a per-instance order record. The compiler (SCRIPTC_ORDSCOPE=1, a lab emitter patch)
 * prints one `ORDSCOPE class=<name> k=<i> ...` line per such class to its stderr (the build log) and emits `#ifdef SCR_LABORD` SCR_LABORD(i) in the class's
 * `new` function, i being the record ROOT's index (a subclass instance counts for its root). Build with SCRIPTC_PROF_CFLAGS='-include <this>
 * -DSCR_LABORD_ARM=1'; the report is written at exit (also on _Exit) to $SCR_LABORD_OUT: one line "N i count" per index.
 * POSITIVE CONTROL: -DSCR_LABORD_ARM=1 plants 7 instances of slot 255 at start-up; the report must show "N 255 7". */
#ifndef SCR_LABORD_H
#define SCR_LABORD_H
#define SCR_LABORD 1
#include <stdio.h>
#include <stdlib.h>
__attribute__((weak)) unsigned long long scr_labord_cnt[256];
__attribute__((weak)) int scr_labord_planted;
#define SCR_LABORD_COUNT(i) (scr_labord_cnt[(i) & 255]++)
static void __attribute__((unused)) scr_labord_report(void) {
  static int done = 0;
  if (done) return;
  done = 1;
  const char *p = getenv("SCR_LABORD_OUT");
  FILE *f = p != NULL ? fopen(p, "w") : stderr;
  if (f == NULL) return;
  for (int i = 0; i < 256; i++) if (scr_labord_cnt[i] != 0) fprintf(f, "N %d %llu\n", i, scr_labord_cnt[i]);
  if (f != stderr) fclose(f);
}
__attribute__((constructor)) static void scr_labord_install(void) {
#ifdef SCR_LABORD_ARM
  if (!scr_labord_planted) { scr_labord_planted = 1; for (int j = 0; j < 7; j++) SCR_LABORD_COUNT(255); }
#endif
  atexit(scr_labord_report);
}
#ifdef _Exit
#undef _Exit
#endif
#define _Exit(c) (scr_labord_report(), _Exit(c))
#endif
