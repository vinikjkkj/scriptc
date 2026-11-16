/* scr_labns.h -- LAB ONLY. For EVERY number-slot put site of the program (any class), classifies the dyn value being stored: [0] a number that fits the
 * 16-bit lane (an integer 0..65535: stays out of the heap), [1] a number that does NOT fit (fraction, negative, -0, NaN, > 65535: the lane form keeps a
 * heap node, the raw-double form of numslot1 did not), [2] another kind (a node either way). The compiler (SCRIPTC_LABNS=1, lab emitter patch) emits
 * SCR_LABNS_P(site, v) before each scr_numslot_put_l and prints "LABNS site <n> = <Class.field>" to its stderr (the build log). Build with
 * SCRIPTC_PROF_CFLAGS='-include <this> -DSCR_LABNS_ARM=1'; report at exit (also _Exit) to $SCR_LABNS_OUT: one line per site "S n lane=.. outnum=.. other=..".
 * POSITIVE CONTROL: -DSCR_LABNS_ARM=1 plants site 255 once per class [0] and [1] ("S 255 lane=1 outnum=1 other=0"). */
#ifndef SCR_LABNS_H
#define SCR_LABNS_H
#define SCR_LABNS 1
#include <stdio.h>
#include <stdlib.h>
__attribute__((weak)) unsigned long long scr_labns_cnt[256][3];
__attribute__((weak)) int scr_labns_planted;
#define SCR_LABNS_P(site, d) do { const ScrDyn *_d = (d); int _c = 2; if (_d != NULL && _d->kind == SCR_DYN_NUM) _c = scr_numslot_fits(_d->v.num) ? 0 : 1; scr_labns_cnt[(site)][_c]++; } while (0)
static void __attribute__((unused)) scr_labns_report(void) {
  static int done = 0;
  if (done) return;
  done = 1;
  const char *p = getenv("SCR_LABNS_OUT");
  FILE *f = p != NULL ? fopen(p, "w") : stderr;
  if (f == NULL) return;
  for (int i = 0; i < 256; i++)
    if (scr_labns_cnt[i][0] + scr_labns_cnt[i][1] + scr_labns_cnt[i][2] != 0) fprintf(f, "S %d lane=%llu outnum=%llu other=%llu\n", i, scr_labns_cnt[i][0], scr_labns_cnt[i][1], scr_labns_cnt[i][2]);
  if (f != stderr) fclose(f);
}
__attribute__((constructor)) static void scr_labns_install(void) {
#ifdef SCR_LABNS_ARM
  if (!scr_labns_planted) { scr_labns_planted = 1; scr_labns_cnt[255][0]++; scr_labns_cnt[255][1]++; }
#endif
  atexit(scr_labns_report);
}
#ifdef _Exit
#undef _Exit
#endif
#define _Exit(c) (scr_labns_report(), _Exit(c))
#endif
