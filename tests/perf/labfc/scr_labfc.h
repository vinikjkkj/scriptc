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
/* value classes of the dyn values STORED into the class's fields, per field: [0] integer 0..1023 (the immortal small range: no node), [1] integer 1024..65534
 * (fits a 16-bit lane of value+1), [2] integer 65535..4294967295 (fits only a 32-bit lane), [3] integer above 2^32-1 or negative, [4] a fraction, NaN or -0,
 * [5] not a number (a string, undefined, null, an object ...). */
__attribute__((weak)) unsigned long long scr_labfc_val[64][6];
#define SCR_LABFC_V(i, d) do { const ScrDyn *_d = (d); int _c = 5; if (_d != NULL && _d->kind == SCR_DYN_NUM) { double _n = _d->v.num; if (_n != _n || (_n == 0 && __builtin_signbit(_n)) || _n != (double)(long long)_n) _c = 4; else if (_n < 0 || _n > 4294967295.0) _c = 3; else if (_n <= 1023) _c = 0; else if (_n <= 65534) _c = 1; else _c = 2; } scr_labfc_val[(i)][_c]++; } while (0)
/* PER-INSTANCE: SCR_LABFC_WO(i, obj) records "field i was written on this instance" in a hash keyed by the object pointer. A write of field 0 (the first
 * constructor write) starts a new instance: the old entry (a freed object whose address is reused) is tallied into scr_labfc_dist and cleared, so every
 * instance is counted once; entries still present at exit are tallied then. SCR_LABFC_PE counts EVERY scr_cls_props_ensure call (any class: an upper bound
 * for the counted class's %props). */
#define SCR_LABFC_HN (1u << 21)
__attribute__((weak)) struct { const void *p; unsigned long long m; } scr_labfc_tab[SCR_LABFC_HN];
__attribute__((weak)) unsigned long long scr_labfc_inst, scr_labfc_dist[64], scr_labfc_props, scr_labfc_lost;
static inline void scr_labfc_tally(unsigned long long m) { scr_labfc_inst++; for (int i = 0; i < 64; i++) if ((m >> i) & 1) scr_labfc_dist[i]++; }
static inline void scr_labfc_wo(int i, const void *o) {
  unsigned h = (unsigned)(((unsigned long long)(size_t)o >> 4) * 0x9E3779B97F4A7C15ull >> 40) & (SCR_LABFC_HN - 1);
  for (unsigned n = 0; n < SCR_LABFC_HN; n++, h = (h + 1) & (SCR_LABFC_HN - 1)) {
    if (scr_labfc_tab[h].p == o) { if (i == 0) { scr_labfc_tally(scr_labfc_tab[h].m); scr_labfc_tab[h].m = 0; } scr_labfc_tab[h].m |= 1ull << i; return; }
    if (scr_labfc_tab[h].p == NULL) { scr_labfc_tab[h].p = o; scr_labfc_tab[h].m = 1ull << i; return; }
  }
  scr_labfc_lost++;
}
#define SCR_LABFC_WO(i, o) scr_labfc_wo((i), (o))
#define SCR_LABFC_PE() (scr_labfc_props++)
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
  for (int i = 0; i < 64; i++) { unsigned long long t = 0; for (int c = 0; c < 6; c++) t += scr_labfc_val[i][c]; if (t != 0) fprintf(f, "V %d u10=%llu u16=%llu u32=%llu big=%llu frac=%llu other=%llu\n", i, scr_labfc_val[i][0], scr_labfc_val[i][1], scr_labfc_val[i][2], scr_labfc_val[i][3], scr_labfc_val[i][4], scr_labfc_val[i][5]); }
  for (unsigned h = 0; h < SCR_LABFC_HN; h++) if (scr_labfc_tab[h].p != NULL) { scr_labfc_tally(scr_labfc_tab[h].m); scr_labfc_tab[h].p = NULL; }
  fprintf(f, "I %llu\nPE %llu\nLOST %llu\n", scr_labfc_inst, scr_labfc_props, scr_labfc_lost);
  for (int i = 0; i < 64; i++) if (scr_labfc_dist[i] != 0) fprintf(f, "D %d %llu\n", i, scr_labfc_dist[i]);
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
