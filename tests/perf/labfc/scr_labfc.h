/* scr_labfc.h -- LAB ONLY. Counts the typed reads and writes of ONE class's fields. The compiler (SCRIPTC_LABFC=<ClassName>, a lab emitter patch) emits
 * `#ifdef SCR_LABFC` SCR_LABFC_R(i) / SCR_LABFC_W(i) in front of every typed fieldGet / fieldSet of a class whose name ends in `.<ClassName>`, and prints the
 * index -> field table of that class to its stderr (the build log). Build with SCRIPTC_PROF_CFLAGS='-include <this> -DSCR_LABFC_ARM=1'; the report is
 * written at exit (also on _Exit, which process.exit lowers to) to $SCR_LABFC_OUT: one line per index "R i n" / "W i n".
 * POSITIVE CONTROL: -DSCR_LABFC_ARM=1 plants one read and one write of slot 63 at start-up; the report must show "R 63 1" and "W 63 1". */
#ifndef SCR_LABFC_H
#define SCR_LABFC_H
#define SCR_LABFC 1
#include <stdio.h>
#include <stdlib.h>
__attribute__((weak)) unsigned long long scr_labfc_cnt[2][64];
__attribute__((weak)) int scr_labfc_planted;
#define SCR_LABFC_R(i) (scr_labfc_cnt[0][(i)]++)
#define SCR_LABFC_W(i) (scr_labfc_cnt[1][(i)]++)
static void __attribute__((unused)) scr_labfc_report(void) {
  static int done = 0;
  if (done) return;
  done = 1;
  const char *p = getenv("SCR_LABFC_OUT");
  FILE *f = p != NULL ? fopen(p, "w") : stderr;
  if (f == NULL) return;
  for (int k = 0; k < 2; k++)
    for (int i = 0; i < 64; i++)
      if (scr_labfc_cnt[k][i] != 0) fprintf(f, "%c %d %llu\n", k == 0 ? 'R' : 'W', i, scr_labfc_cnt[k][i]);
  if (f != stderr) fclose(f);
}
__attribute__((constructor)) static void scr_labfc_install(void) {
#ifdef SCR_LABFC_ARM
  if (!scr_labfc_planted) { scr_labfc_planted = 1; SCR_LABFC_R(63); SCR_LABFC_W(63); }
#endif
  atexit(scr_labfc_report);
}
#ifdef _Exit
#undef _Exit
#endif
#define _Exit(c) (scr_labfc_report(), _Exit(c))
#endif
