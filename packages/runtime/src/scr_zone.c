#include "scr_zone.h"
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define DAYMS 86400000.0

/* ── zoneinfo64 ──────────────────────────────────────────────────────────────────────────────────────────── */
typedef struct {
  int startMonth, startDay, startDow, startMode, startTimeMode;
  int endMonth, endDay, endDow, endMode, endTimeMode;
  int32_t startTime, endTime, dstSavings; /* ms */
  int32_t rawOffset;
} SimpleTz;

struct ZiZone {
  int idx;
  int npre, n32, npost;
  int64_t *trans; /* seconds, all transitions in order */
  int ntrans;
  uint8_t *tmap;
  int ntypes;
  int32_t *toff; /* seconds, pairs */
  int hasFinal;
  SimpleTz fin;
  int finalYear;
  double finStartMs;
};

static struct {
  int ready;
  int n;
  ScrRes names, zones, regions, rules;
  char **name;     /* Names copied out */
  ScrRes *zoneRes; /* Zones[i] */
  ZiZone **cache;
} G;

static void zi_init(void) {
  if (G.ready) return;
  G.ready = 1;
  ScrRes r;
  if (!scr_ures_misc("zoneinfo64", "Names", &G.names)) return;
  scr_ures_misc("zoneinfo64", "Zones", &G.zones);
  scr_ures_misc("zoneinfo64", "Regions", &G.regions);
  scr_ures_misc("zoneinfo64", "Rules", &G.rules);
  (void)r;
  G.n = scr_res_array_len(G.names);
  G.name = (char **)calloc((size_t)G.n, sizeof(char *));
  G.zoneRes = (ScrRes *)calloc((size_t)G.n, sizeof(ScrRes));
  G.cache = (ZiZone **)calloc((size_t)G.n, sizeof(ZiZone *));
  /* walk the arrays once */
  for (int i = 0; i < G.n; i++) {
    size_t l;
    const char *s = scr_res_str(scr_res_array_at(G.names, i), &l);
    G.name[i] = (char *)malloc(s ? l + 1 : 1);
    if (s) memcpy(G.name[i], s, l);
    G.name[i][s ? l : 0] = 0;
    G.zoneRes[i] = scr_res_array_at(G.zones, i);
  }
}
static int name_index(const char *id) {
  zi_init();
  int lo = 0, hi = G.n - 1;
  while (lo <= hi) {
    int mid = (lo + hi) / 2;
    int c = strcmp(G.name[mid], id);
    if (c == 0) return mid;
    if (c < 0) lo = mid + 1; else hi = mid - 1;
  }
  /* not strictly sorted by strcmp (ICU sorts case-insensitively in places): fall back to a scan */
  for (int i = 0; i < G.n; i++) if (!strcmp(G.name[i], id)) return i;
  return -1;
}

static void simple_decode(SimpleTz *s, const int32_t *v, int32_t rawMs) {
  s->rawOffset = rawMs;
  s->startMonth = v[0]; s->startDay = v[1]; s->startDow = v[2]; s->startTime = v[3] * 1000; s->startTimeMode = v[4];
  s->endMonth = v[5]; s->endDay = v[6]; s->endDow = v[7]; s->endTime = v[8] * 1000; s->endTimeMode = v[9];
  s->dstSavings = v[10] * 1000;
  if (s->dstSavings == 0) s->dstSavings = 3600000;
  int dow = s->startDow, day = s->startDay, mode;
  if (dow == 0) mode = 0; else if (dow > 0) mode = 1; else { dow = -dow; if (day > 0) mode = 2; else { day = -day; mode = 3; } }
  s->startDow = dow; s->startDay = day; s->startMode = mode;
  dow = s->endDow; day = s->endDay;
  if (dow == 0) mode = 0; else if (dow > 0) mode = 1; else { dow = -dow; if (day > 0) mode = 2; else { day = -day; mode = 3; } }
  s->endDow = dow; s->endDay = day; s->endMode = mode;
}

static int grego_leap(int y) { return (y % 4 == 0) && (y % 100 != 0 || y % 400 == 0); }
static const int kML[12] = {31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
static int monthLen(int y, int m) { return m == 1 && grego_leap(y) ? 29 : kML[m]; }
static int64_t days_from_civil(int64_t y, int m, int d) { /* m 1..12 */
  y -= m <= 2;
  int64_t era = (y >= 0 ? y : y - 399) / 400;
  int64_t yoe = y - era * 400;
  int64_t doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
  int64_t doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  return era * 146097 + doe - 719468;
}
typedef struct { int year, month, dom, dow; } Fields;
static Fields day_to_fields(int64_t day) {
  int64_t z = day + 719468;
  int64_t era = (z >= 0 ? z : z - 146096) / 146097;
  int64_t doe = z - era * 146097;
  int64_t yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
  int64_t y = yoe + era * 400;
  int64_t doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  int64_t mp = (5 * doy + 2) / 153;
  Fields f;
  f.dom = (int)(doy - (153 * mp + 2) / 5 + 1);
  int m = (int)(mp < 10 ? mp + 3 : mp - 9);
  f.year = (int)(y + (m <= 2));
  f.month = m - 1;
  f.dow = (int)(((day + 4) % 7 + 7) % 7) + 1;
  return f;
}

static int compare_to_rule(int month, int monthLen_, int prevMonthLen, int dom, int dow, int32_t millis, int32_t millisDelta,
                           int mode, int ruleMonth, int ruleDow, int ruleDay, int32_t ruleMillis) {
  millis += millisDelta;
  while (millis >= 86400000) { millis -= 86400000; ++dom; dow = 1 + (dow % 7); if (dom > monthLen_) { dom = 1; ++month; } }
  while (millis < 0) { millis += 86400000; --dom; dow = 1 + ((dow + 5) % 7); if (dom < 1) { dom = prevMonthLen; --month; } }
  if (month < ruleMonth) return -1;
  if (month > ruleMonth) return 1;
  int rdom = 0;
  if (ruleDay > monthLen_) ruleDay = monthLen_;
  switch (mode) {
    case 0: rdom = ruleDay; break;
    case 1:
      if (ruleDay > 0) rdom = 1 + (ruleDay - 1) * 7 + (7 + ruleDow - (dow - dom + 1)) % 7;
      else rdom = monthLen_ + (ruleDay + 1) * 7 - (7 + (dow + monthLen_ - dom) - ruleDow) % 7;
      break;
    case 2: rdom = ruleDay + (49 + ruleDow - ruleDay - dow + dom) % 7; break;
    case 3: rdom = ruleDay - (49 - ruleDow + ruleDay + dow - dom) % 7; break;
  }
  if (dom < rdom) return -1;
  if (dom > rdom) return 1;
  if (millis < ruleMillis) return -1;
  if (millis > ruleMillis) return 1;
  return 0;
}

/* SimpleTimeZone::getOffset via TimeZone::getOffset(date, false): the dst savings at a UTC instant */
static int32_t simple_dst_local(const SimpleTz *s, double d) {
  double dayD = floor(d / DAYMS);
  int32_t millis = (int32_t)(d - dayD * DAYMS);
  Fields f = day_to_fields((int64_t)dayD);
  int ml = monthLen(f.year, f.month), pml = monthLen(f.month == 0 ? f.year - 1 : f.year, (f.month + 11) % 12);
  int southern = s->startMonth > s->endMonth;
  int startCompare = compare_to_rule(f.month, ml, pml, f.dom, f.dow, millis, s->startTimeMode == 2 ? -s->rawOffset : 0, s->startMode, s->startMonth, s->startDow, s->startDay, s->startTime);
  int endCompare = 0;
  if (southern != (startCompare >= 0))
    endCompare = compare_to_rule(f.month, ml, pml, f.dom, f.dow, millis, s->endTimeMode == 0 ? s->dstSavings : (s->endTimeMode == 2 ? -s->rawOffset : 0), s->endMode, s->endMonth, s->endDow, s->endDay, s->endTime);
  if ((!southern && (startCompare >= 0 && endCompare < 0)) || (southern && (startCompare >= 0 || endCompare < 0))) return s->dstSavings;
  return 0;
}

static int64_t trans_sec(const ZiZone *z, int i) { return z->trans[i]; }

static ZiZone *zi_load(int idx) {
  zi_init();
  if (G.cache[idx]) return G.cache[idx];
  ScrRes r = G.zoneRes[idx];
  int guard = 0;
  while (scr_res_kind(r) == SCR_RES_INT && guard++ < 8) {
    int ok;
    int target = scr_res_int(r, &ok);
    if (!ok || target < 0 || target >= G.n) return NULL;
    r = G.zoneRes[target];
    idx = target;
  }
  if (G.cache[idx]) return G.cache[idx];
  if (scr_res_kind(r) != SCR_RES_TABLE) return NULL;
  ZiZone *z = (ZiZone *)calloc(1, sizeof *z);
  z->idx = idx;
  int32_t buf[4096];
  int32_t *pre = NULL, *t32 = NULL, *post = NULL;
  int npre = 0, n32 = 0, npost = 0;
  int32_t *tmapv = NULL; int ntm = 0;
  int32_t finalRaw = 0; char ruleName[32] = "";
  for (int i = 0; i < scr_res_table_len(r); i++) {
    const char *k; size_t kn;
    ScrRes v = scr_res_table_at(r, i, &k, &kn);
    char key[24];
    snprintf(key, sizeof key, "%.*s", (int)(kn < 23 ? kn : 23), k);
    if (!strcmp(key, "trans") || !strcmp(key, "transPre32") || !strcmp(key, "transPost32") || !strcmp(key, "typeOffsets") || !strcmp(key, "typeMap")) {
      int n = scr_res_intvec(v, buf, 4096);
      int32_t *c = (int32_t *)malloc(sizeof(int32_t) * (size_t)(n ? n : 1));
      memcpy(c, buf, sizeof(int32_t) * (size_t)n);
      if (!strcmp(key, "trans")) { t32 = c; n32 = n; }
      else if (!strcmp(key, "transPre32")) { pre = c; npre = n / 2; }
      else if (!strcmp(key, "transPost32")) { post = c; npost = n / 2; }
      else if (!strcmp(key, "typeOffsets")) { z->toff = c; z->ntypes = n / 2; }
      else { tmapv = c; ntm = n; }
    } else if (!strcmp(key, "finalRule")) { size_t l; const char *s = scr_res_str(v, &l); snprintf(ruleName, sizeof ruleName, "%.*s", (int)(l < 31 ? l : 31), s ? s : ""); }
    else if (!strcmp(key, "finalRaw")) { int ok; finalRaw = scr_res_int(v, &ok); }
    else if (!strcmp(key, "finalYear")) { int ok; z->finalYear = scr_res_int(v, &ok); }
  }
  z->ntrans = npre + n32 + npost;
  z->trans = (int64_t *)malloc(sizeof(int64_t) * (size_t)(z->ntrans ? z->ntrans : 1));
  int o = 0;
  for (int i = 0; i < npre; i++) z->trans[o++] = ((int64_t)pre[2 * i] << 32) | (uint32_t)pre[2 * i + 1];
  for (int i = 0; i < n32; i++) z->trans[o++] = t32[i];
  for (int i = 0; i < npost; i++) z->trans[o++] = ((int64_t)post[2 * i] << 32) | (uint32_t)post[2 * i + 1];
  z->tmap = (uint8_t *)malloc((size_t)(ntm ? ntm : 1));
  for (int i = 0; i < ntm; i++) z->tmap[i] = (uint8_t)tmapv[i];
  free(pre); free(t32); free(post); free(tmapv);
  if (ruleName[0]) {
    ScrRes rr;
    int32_t rv[11];
    if (scr_res_table_len(G.rules) > 0) {
      /* the rule by name */
      int found = 0;
      for (int i = 0; i < scr_res_table_len(G.rules) && !found; i++) {
        const char *k; size_t kn;
        rr = scr_res_table_at(G.rules, i, &k, &kn);
        if (kn == strlen(ruleName) && !memcmp(k, ruleName, kn) && scr_res_intvec(rr, rv, 11) == 11) { found = 1; }
      }
      if (found) {
        simple_decode(&z->fin, rv, finalRaw * 1000);
        z->hasFinal = 1;
        z->finStartMs = (double)days_from_civil(z->finalYear, 1, 1) * DAYMS;
      }
    }
  }
  G.cache[idx] = z;
  return z;
}

const ZiZone *zi_find(const char *id) {
  int idx = name_index(id);
  if (idx < 0) return NULL;
  return zi_load(idx);
}

static void hist_offset(const ZiZone *z, double ms, int32_t *raw, int32_t *dst) {
  if (z->ntrans == 0) { *raw = z->toff[0] * 1000; *dst = z->toff[1] * 1000; return; }
  int64_t sec = (int64_t)floor(ms / 1000.0);
  if (sec < trans_sec(z, 0)) { *raw = z->toff[0] * 1000; *dst = z->toff[1] * 1000; return; }
  int i;
  for (i = z->ntrans - 1; i >= 0; i--) if (sec >= trans_sec(z, i)) break;
  int ty = z->tmap[i];
  *raw = z->toff[ty * 2] * 1000;
  *dst = z->toff[ty * 2 + 1] * 1000;
}

void zi_offset(const ZiZone *z, double ms, int32_t *raw, int32_t *dst) {
  if (z->hasFinal && ms >= z->finStartMs) { *raw = z->fin.rawOffset; *dst = simple_dst_local(&z->fin, ms + z->fin.rawOffset); return; }
  hist_offset(z, ms, raw, dst);
}

/* getOffset(date, local = true) with the default non-existing (former) and duplicated (latter) time options */
static void hist_offset_local(const ZiZone *z, double date, int32_t *rawo, int32_t *dsto) {
  if (z->ntrans == 0) { *rawo = z->toff[0] * 1000; *dsto = z->toff[1] * 1000; return; }
  double sec = floor(date / 1000.0);
  int idx;
  for (idx = z->ntrans - 1; idx >= 0; idx--) {
    int64_t tr = trans_sec(z, idx);
    if (sec >= (double)(tr - 86400)) {
      int tb = idx > 0 ? z->tmap[idx - 1] : 0, ta = z->tmap[idx];
      int32_t offB = (z->toff[tb * 2] + z->toff[tb * 2 + 1]), offA = (z->toff[ta * 2] + z->toff[ta * 2 + 1]);
      int dstB = z->toff[tb * 2 + 1] != 0, dstA = z->toff[ta * 2 + 1] != 0;
      (void)dstB; (void)dstA;
      if (offA - offB >= 0) tr += offA; /* non-existing range: the rule before the transition (kFormer) */
      else tr += offA;                  /* duplicated range: the rule after the transition (kLatter) */
    }
    if (sec >= (double)tr) break;
  }
  if (idx < 0) { *rawo = z->toff[0] * 1000; *dsto = z->toff[1] * 1000; return; }
  int ty = z->tmap[idx];
  *rawo = z->toff[ty * 2] * 1000;
  *dsto = z->toff[ty * 2 + 1] * 1000;
}
void zi_offset_local(const ZiZone *z, double local, int32_t *raw, int32_t *dst) {
  if (z->hasFinal && local >= z->finStartMs) { *raw = z->fin.rawOffset; *dst = simple_dst_local(&z->fin, local); return; }
  hist_offset_local(z, local, raw, dst);
}

/* ── transitions ─────────────────────────────────────────────────────────────────────────────────────────── */
static int uses_daylight(const SimpleTz *s) { (void)s; return 1; } /* final rules always carry both rules */

/* the day (days since 1970) a rule falls on in `year` */
static int64_t rule_day(int year, int month, int day, int dow, int mode) {
  int64_t base;
  switch (mode) {
    case 0: return days_from_civil(year, month + 1, day);
    case 1:
      if (day > 0) {
        base = days_from_civil(year, month + 1, 1) + 7 * (day - 1);
        Fields f = day_to_fields(base);
        return base + (dow - f.dow + 7) % 7;
      } else {
        base = days_from_civil(year, month + 1, monthLen(year, month)) + 7 * (day + 1);
        Fields f = day_to_fields(base);
        return base - (f.dow - dow + 7) % 7;
      }
    case 2: { base = days_from_civil(year, month + 1, day); Fields f = day_to_fields(base); return base + (dow - f.dow + 7) % 7; }
    default: { base = days_from_civil(year, month + 1, day); Fields f = day_to_fields(base); return base - (f.dow - dow + 7) % 7; }
  }
}
/* AnnualTimeZoneRule::getStartInYear: UTC ms when the rule starts in `year`, given the offsets in force before it */
static double annual_start(const SimpleTz *s, int isDstStart, int year, int32_t prevRaw, int32_t prevDst) {
  int month = isDstStart ? s->startMonth : s->endMonth;
  int day = isDstStart ? s->startDay : s->endDay;
  int dow = isDstStart ? s->startDow : s->endDow;
  int mode = isDstStart ? s->startMode : s->endMode;
  int32_t time = isDstStart ? s->startTime : s->endTime;
  int tmode = isDstStart ? s->startTimeMode : s->endTimeMode;
  double t = (double)rule_day(year, month, day, dow, mode) * DAYMS + time;
  if (tmode != 2) t -= prevRaw;
  if (tmode == 0) t -= prevDst;
  return t;
}
/* final-zone transitions at or after/before `base`, restricted to years >= finalYear */
static int final_next(const ZiZone *z, double base, int inclusive, double *time, int32_t *fromDst, int32_t *toDst) {
  const SimpleTz *s = &z->fin;
  int y0 = day_to_fields((int64_t)floor(base / DAYMS)).year;
  double best = INFINITY; int32_t bf = 0, bt = 0;
  for (int y = y0 - 1; y <= y0 + 1; y++) {
    if (y < z->finalYear) continue;
    double ds = annual_start(s, 1, y, s->rawOffset, 0);
    double ss = annual_start(s, 0, y, s->rawOffset, s->dstSavings);
    if ((ds > base || (inclusive && ds == base)) && ds < best) { best = ds; bf = 0; bt = s->dstSavings; }
    if ((ss > base || (inclusive && ss == base)) && ss < best) { best = ss; bf = s->dstSavings; bt = 0; }
  }
  if (best == INFINITY) return 0;
  *time = best; *fromDst = bf; *toDst = bt;
  return 1;
}
static int final_prev(const ZiZone *z, double base, int inclusive, double *time, int32_t *fromDst, int32_t *toDst) {
  const SimpleTz *s = &z->fin;
  int y0 = day_to_fields((int64_t)floor(base / DAYMS)).year;
  double best = -INFINITY; int32_t bf = 0, bt = 0;
  for (int y = y0 + 1; y >= y0 - 1; y--) {
    if (y < z->finalYear) continue;
    double ds = annual_start(s, 1, y, s->rawOffset, 0);
    double ss = annual_start(s, 0, y, s->rawOffset, s->dstSavings);
    if ((ds < base || (inclusive && ds == base)) && ds > best) { best = ds; bf = 0; bt = s->dstSavings; }
    if ((ss < base || (inclusive && ss == base)) && ss > best) { best = ss; bf = s->dstSavings; bt = 0; }
  }
  if (best == -INFINITY) return 0;
  *time = best; *fromDst = bf; *toDst = bt;
  return 1;
}

static int first_trans_idx(const ZiZone *z) {
  int i = 0;
  for (; i < z->ntrans; i++) if (z->tmap[i] != 0) break;
  return i; /* == ntrans when none */
}

/* the first final-zone transition (firstFinalTZTransition) */
static int first_final(const ZiZone *z, double *time, int32_t *fromDst, int32_t *toDst) {
  double t; int32_t f, tt;
  if (!final_next(z, z->finStartMs, 0, &t, &f, &tt)) {
    /* a final rule with no transitions would start at finalStartMillis */
    *time = z->finStartMs;
    *fromDst = z->ntrans > 0 ? z->toff[z->tmap[z->ntrans - 1] * 2 + 1] * 1000 : z->toff[1] * 1000;
    *toDst = 0;
    return 1;
  }
  /* getNextTransition(startTime, false) on the zone with its start year */
  *time = t;
  *fromDst = z->ntrans > 0 ? z->toff[z->tmap[z->ntrans - 1] * 2 + 1] * 1000 : z->toff[1] * 1000;
  *toDst = tt;
  return 1;
}

int zi_next_transition(const ZiZone *z, double base, int inclusive, double *time, int32_t *fromDst, int32_t *toDst) {
  double fft; int32_t ff, ft;
  int hasFF = 0;
  if (z->hasFinal) {
    hasFF = first_final(z, &fft, &ff, &ft);
    if (hasFF) {
      if (inclusive && base == fft) { *time = fft; *fromDst = ff; *toDst = ft; return 1; }
      if (base >= fft) return final_next(z, base, inclusive, time, fromDst, toDst);
    }
  }
  int first = first_trans_idx(z);
  if (z->ntrans > 0 && first < z->ntrans) {
    int tt = z->ntrans - 1;
    for (; tt >= first; tt--) {
      double t = (double)trans_sec(z, tt) * 1000.0;
      if (base > t || (!inclusive && base == t)) break;
    }
    if (tt == z->ntrans - 1) {
      if (hasFF) { *time = fft; *fromDst = ff; *toDst = ft; return 1; }
      return 0;
    } else if (tt < first) {
      *time = (double)trans_sec(z, first) * 1000.0;
      *fromDst = z->toff[1] * 1000;
      *toDst = z->toff[z->tmap[first] * 2 + 1] * 1000;
      return 1;
    } else {
      int to = z->tmap[tt + 1], from = z->tmap[tt];
      double st = (double)trans_sec(z, tt + 1) * 1000.0;
      if (z->toff[to * 2] == z->toff[from * 2] && z->toff[to * 2 + 1] == z->toff[from * 2 + 1]) return zi_next_transition(z, st, 0, time, fromDst, toDst);
      *time = st; *fromDst = z->toff[from * 2 + 1] * 1000; *toDst = z->toff[to * 2 + 1] * 1000;
      return 1;
    }
  }
  return 0;
}

int zi_prev_transition(const ZiZone *z, double base, int inclusive, double *time, int32_t *fromDst, int32_t *toDst) {
  double fft; int32_t ff, ft;
  int hasFF = 0;
  if (z->hasFinal) {
    hasFF = first_final(z, &fft, &ff, &ft);
    if (hasFF) {
      if (inclusive && base == fft) { *time = fft; *fromDst = ff; *toDst = ft; return 1; }
      if (base > fft) {
        if (uses_daylight(&z->fin)) return final_prev(z, base, inclusive, time, fromDst, toDst);
        *time = fft; *fromDst = ff; *toDst = ft; return 1;
      }
    }
  }
  int first = first_trans_idx(z);
  if (z->ntrans > 0 && first < z->ntrans) {
    int tt = z->ntrans - 1;
    for (; tt >= first; tt--) {
      double t = (double)trans_sec(z, tt) * 1000.0;
      if (base > t || (inclusive && base == t)) break;
    }
    if (tt < first) return 0;
    if (tt == first) {
      *time = (double)trans_sec(z, first) * 1000.0;
      *fromDst = z->toff[1] * 1000;
      *toDst = z->toff[z->tmap[first] * 2 + 1] * 1000;
      return 1;
    }
    int to = z->tmap[tt], from = z->tmap[tt - 1];
    double st = (double)trans_sec(z, tt) * 1000.0;
    if (z->toff[to * 2] == z->toff[from * 2] && z->toff[to * 2 + 1] == z->toff[from * 2 + 1]) return zi_prev_transition(z, st, 0, time, fromDst, toDst);
    *time = st; *fromDst = z->toff[from * 2 + 1] * 1000; *toDst = z->toff[to * 2 + 1] * 1000;
    return 1;
  }
  return 0;
}

/* ── ZoneMeta ────────────────────────────────────────────────────────────────────────────────────────────── */
static void colon_key(const char *id, char *out, size_t cap) {
  size_t i = 0;
  for (; id[i] && i + 1 < cap; i++) out[i] = id[i] == '/' ? ':' : id[i];
  out[i] = 0;
}

int zm_canonical_id(const char *tzid, char *out, size_t cap) {
  char key[96], path[160];
  colon_key(tzid, key, sizeof key);
  ScrRes r;
  snprintf(path, sizeof path, "typeMap/timezone/%s", key);
  if (scr_ures_misc("timezoneTypes", path, &r)) { snprintf(out, cap, "%s", tzid); return 1; }
  snprintf(path, sizeof path, "typeAlias/timezone/%s", key);
  if (scr_ures_misc("timezoneTypes", path, &r)) {
    size_t n; const char *s = scr_res_str(r, &n);
    if (s && n < cap) { memcpy(out, s, n); out[n] = 0; return 1; }
  }
  /* dereference the Olson link */
  int idx = name_index(tzid);
  if (idx < 0) return 0;
  zi_init();
  ScrRes zr = G.zoneRes[idx];
  const char *deref = G.name[idx];
  int guard = 0;
  while (scr_res_kind(zr) == SCR_RES_INT && guard++ < 8) {
    int ok; int t = scr_res_int(zr, &ok);
    if (!ok || t < 0 || t >= G.n) break;
    deref = G.name[t];
    zr = G.zoneRes[t];
  }
  colon_key(deref, key, sizeof key);
  snprintf(path, sizeof path, "typeAlias/timezone/%s", key);
  if (scr_ures_misc("timezoneTypes", path, &r)) {
    size_t n; const char *s = scr_res_str(r, &n);
    if (s && n < cap) { memcpy(out, s, n); out[n] = 0; return 1; }
  }
  snprintf(out, cap, "%s", deref);
  return 1;
}

int zm_region(const char *tzid, char *out, size_t cap) {
  int idx = name_index(tzid);
  if (idx < 0) return 0;
  size_t n;
  const char *s = scr_res_str(scr_res_array_at(G.regions, idx), &n);
  if (!s || n >= cap) return 0;
  memcpy(out, s, n); out[n] = 0;
  return 1;
}

static int is_canonical_location(int idx) {
  char can[96];
  if (!strcmp(G.name[idx], "Etc/Unknown")) return 0;
  if (!zm_canonical_id(G.name[idx], can, sizeof can) || strcmp(can, G.name[idx]) != 0) return 0;
  char reg[8];
  if (!zm_region(G.name[idx], reg, sizeof reg) || !strcmp(reg, "001")) return 0;
  return 1;
}

int zm_canonical_country(const char *canonicalId, char *country, size_t cap, int *isPrimary) {
  if (isPrimary) *isPrimary = 0;
  char reg[8];
  if (!zm_region(canonicalId, reg, sizeof reg) || !strcmp(reg, "001")) return 0;
  snprintf(country, cap, "%s", reg);
  if (!isPrimary) return 1;
  int count = 0;
  for (int i = 0; i < G.n; i++) {
    char r2[8];
    if (zm_region(G.name[i], r2, sizeof r2) && !strcmp(r2, reg) && is_canonical_location(i)) count++;
  }
  if (count == 1) { *isPrimary = 1; return 1; }
  char path[32];
  snprintf(path, sizeof path, "primaryZones/%s", reg);
  ScrRes r;
  if (scr_ures_misc("metaZones", path, &r)) {
    size_t n; const char *s = scr_res_str(r, &n);
    if (s && strlen(canonicalId) == n && !memcmp(canonicalId, s, n)) *isPrimary = 1;
    else {
      char can[96];
      if (s && zm_canonical_id(canonicalId, can, sizeof can) && strlen(can) == n && !memcmp(can, s, n)) *isPrimary = 1;
    }
  }
  return 1;
}

static double parse_date(const char *t) {
  size_t len = strlen(t);
  if (len != 16 && len != 10) return 0;
  int y = 0, mo = 0, d = 0, h = 0, mi = 0;
  sscanf(t, "%4d-%2d-%2d", &y, &mo, &d);
  if (len == 16) sscanf(t + 11, "%2d:%2d", &h, &mi);
  return (double)days_from_civil(y, mo, d) * DAYMS + h * 3600000.0 + mi * 60000.0;
}

int zm_metazone_id(const char *canonicalId, double date, char *out, size_t cap) {
  char key[96], path[160];
  colon_key(canonicalId, key, sizeof key);
  snprintf(path, sizeof path, "metazoneInfo/%s", key);
  ScrRes arr;
  if (!scr_ures_misc("metaZones", path, &arr)) return 0;
  int n = scr_res_array_len(arr);
  for (int i = 0; i < n; i++) {
    ScrRes e = scr_res_array_at(arr, i);
    size_t l;
    const char *mz = scr_res_str(scr_res_array_at(e, 0), &l);
    if (!mz) continue;
    char mzb[48];
    snprintf(mzb, sizeof mzb, "%.*s", (int)(l < 47 ? l : 47), mz);
    char from[24] = "1970-01-01 00:00", to[24] = "9999-12-31 23:59";
    if (scr_res_array_len(e) == 3) {
      const char *a = scr_res_str(scr_res_array_at(e, 1), &l);
      if (a) snprintf(from, sizeof from, "%.*s", (int)(l < 23 ? l : 23), a);
      const char *b = scr_res_str(scr_res_array_at(e, 2), &l);
      if (b) snprintf(to, sizeof to, "%.*s", (int)(l < 23 ? l : 23), b);
    }
    double f = parse_date(from), t = parse_date(to);
    if (f <= date && t > date) { snprintf(out, cap, "%s", mzb); return 1; }
  }
  return 0;
}

int zm_zone_for_metazone(const char *mzid, const char *region, char *out, size_t cap) {
  char path[120];
  ScrRes r;
  size_t n = 0;
  const char *s = NULL;
  if (region && (strlen(region) == 2 || strlen(region) == 3)) {
    snprintf(path, sizeof path, "mapTimezones/%s/%s", mzid, region);
    if (scr_ures_misc("metaZones", path, &r)) s = scr_res_str(r, &n);
  }
  if (!s) {
    snprintf(path, sizeof path, "mapTimezones/%s/001", mzid);
    if (scr_ures_misc("metaZones", path, &r)) s = scr_res_str(r, &n);
  }
  if (!s || n >= cap) return 0;
  memcpy(out, s, n); out[n] = 0;
  return 1;
}

int zm_short_id(const char *canonicalId, char *out, size_t cap) {
  char key[96], path[160];
  colon_key(canonicalId, key, sizeof key);
  snprintf(path, sizeof path, "typeMap/timezone/%s", key);
  ScrRes r;
  if (!scr_ures_misc("timezoneTypes", path, &r)) return 0;
  size_t n; const char *s = scr_res_str(r, &n);
  if (!s || n >= cap) return 0;
  memcpy(out, s, n); out[n] = 0;
  return 1;
}
