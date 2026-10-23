/* Port of ICU 78.2 SimpleDateFormat formatting and DateFormatSymbols loading (dtfmtsym.cpp, smpdtfmt.cpp). */
#include "scr_dtfmt.h"
#include "scr_rbnf.h"
#include <ctype.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* ── byte strings ────────────────────────────────────────────────────────────────────────────────────────── */
typedef struct { char *p; size_t n, cap; } Sb;
static void sb_reserve(Sb *b, size_t add) {
  if (b->n + add + 1 > b->cap) {
    size_t nc = b->cap ? b->cap * 2 : 64;
    while (nc < b->n + add + 1) nc *= 2;
    b->p = (char *)realloc(b->p, nc);
    if (!b->p) abort();
    b->cap = nc;
  }
}
static void sb_put(Sb *b, const char *s, size_t n) { sb_reserve(b, n); memcpy(b->p + b->n, s, n); b->n += n; b->p[b->n] = 0; }
static void sb_puts(Sb *b, const char *s) { sb_put(b, s, strlen(s)); }
static void sb_putc(Sb *b, char c) { sb_put(b, &c, 1); }
static char *sb_take(Sb *b) { if (!b->p) { b->p = (char *)malloc(1); b->p[0] = 0; } char *r = b->p; b->p = NULL; b->n = b->cap = 0; return r; }
static void sb_free(Sb *b) { free(b->p); b->p = NULL; b->n = b->cap = 0; }
static char *dupn(const char *s, size_t n) { char *r = (char *)malloc(n + 1); memcpy(r, s, n); r[n] = 0; return r; }
static char *dups(const char *s) { return dupn(s, strlen(s)); }

/* ── UDateFormatField ────────────────────────────────────────────────────────────────────────────────────── */
enum {
  U_ERA, U_YEAR, U_MONTH, U_DATE, U_HOUR_OF_DAY1, U_HOUR_OF_DAY0, U_MINUTE, U_SECOND, U_FRACTIONAL_SECOND, U_DAY_OF_WEEK,
  U_DAY_OF_YEAR, U_DOW_IN_MONTH, U_WEEK_OF_YEAR, U_WEEK_OF_MONTH, U_AM_PM, U_HOUR1, U_HOUR0, U_TIMEZONE, U_YEAR_WOY, U_DOW_LOCAL,
  U_EXTENDED_YEAR, U_JULIAN_DAY, U_MILLIS_IN_DAY, U_TZ_RFC, U_TZ_GENERIC, U_STANDALONE_DAY, U_STANDALONE_MONTH, U_QUARTER,
  U_STANDALONE_QUARTER, U_TZ_SPECIAL, U_YEAR_NAME, U_TZ_LOCALIZED_GMT, U_TZ_ISO, U_TZ_ISO_LOCAL, U_RELATED_YEAR,
  U_AM_PM_MIDNIGHT_NOON, U_FLEXIBLE_DAY_PERIOD, U_FIELD_COUNT
};
static const char kPatternChars[] = "GyMdkHmsSEDFwWahKzYeugAZvcLQqVUOXxrbB";
static int pattern_char_index(char c) {
  const char *p = c ? strchr(kPatternChars, c) : NULL;
  return p ? (int)(p - kPatternChars) : U_FIELD_COUNT;
}
int scr_dt_is_syntax_char(char c) { return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z'); }

/* UCalendarDateFields per pattern index (fgPatternIndexToCalendarField), CAL_FIELD_COUNT for none */
static const int kIdxToCal[U_FIELD_COUNT] = {
  CAL_ERA, CAL_YEAR, CAL_MONTH, CAL_DATE, CAL_HOUR_OF_DAY, CAL_HOUR_OF_DAY, CAL_MINUTE, CAL_SECOND, CAL_MILLISECOND,
  CAL_DAY_OF_WEEK, CAL_DAY_OF_YEAR, CAL_DOW_IN_MONTH, CAL_WEEK_OF_YEAR, CAL_WEEK_OF_MONTH, CAL_AM_PM, CAL_HOUR, CAL_HOUR,
  CAL_ZONE_OFFSET, CAL_YEAR_WOY, CAL_DOW_LOCAL, CAL_EXTENDED_YEAR, CAL_JULIAN_DAY, CAL_MILLIS_IN_DAY, CAL_ZONE_OFFSET,
  CAL_ZONE_OFFSET, CAL_DOW_LOCAL, CAL_MONTH, CAL_MONTH, CAL_MONTH, CAL_ZONE_OFFSET, CAL_YEAR, CAL_ZONE_OFFSET, CAL_ZONE_OFFSET,
  CAL_ZONE_OFFSET, CAL_EXTENDED_YEAR, CAL_FIELD_COUNT, CAL_FIELD_COUNT};

/* ── string arrays ───────────────────────────────────────────────────────────────────────────────────────── */
typedef struct { char **s; int n; } StrArr;
static void sa_free(StrArr *a) { for (int i = 0; i < a->n; i++) free(a->s[i]); free(a->s); a->s = NULL; a->n = 0; }
static void sa_alloc(StrArr *a, int n) { a->s = (char **)calloc((size_t)(n ? n : 1), sizeof(char *)); a->n = n; }
static int sa_copy(StrArr *dst, const StrArr *src, int offset) {
  if (!src->s) return 0;
  sa_alloc(dst, src->n + offset);
  for (int i = 0; i < src->n; i++) dst->s[i + offset] = src->s[i] ? dups(src->s[i]) : NULL;
  for (int i = 0; i < offset; i++) dst->s[i] = dups("");
  return 1;
}

typedef struct {
  StrArr eras, eraNames, narrowEras;
  StrArr months, shortMonths, narrowMonths, standaloneMonths, standaloneShortMonths, standaloneNarrowMonths;
  StrArr weekdays, shortWeekdays, shorterWeekdays, narrowWeekdays;
  StrArr standaloneWeekdays, standaloneShortWeekdays, standaloneShorterWeekdays, standaloneNarrowWeekdays;
  StrArr ampms, wideAmpms, narrowAmpms;
  StrArr quarters, shortQuarters, narrowQuarters, standaloneQuarters, standaloneShortQuarters, standaloneNarrowQuarters;
  StrArr leap; /* 7 month patterns, NULL entries when absent */
  int hasLeap;
  StrArr shortYearNames, shortZodiacNames;
  StrArr dp[6]; /* abbreviated, wide, narrow, standalone abbreviated, wide, narrow: 10 entries, NULL = bogus */
  char *timeSeparator;
} Syms;

enum { DP_ABBR, DP_WIDE, DP_NARROW, DP_SABBR, DP_SWIDE, DP_SNARROW };
enum { LP_FWIDE, LP_FABBR, LP_FNARROW, LP_SWIDE, LP_SABBR, LP_SNARROW, LP_NUMERIC };

static void syms_free(Syms *s) {
  StrArr *all[] = {&s->eras, &s->eraNames, &s->narrowEras, &s->months, &s->shortMonths, &s->narrowMonths, &s->standaloneMonths,
                   &s->standaloneShortMonths, &s->standaloneNarrowMonths, &s->weekdays, &s->shortWeekdays, &s->shorterWeekdays,
                   &s->narrowWeekdays, &s->standaloneWeekdays, &s->standaloneShortWeekdays, &s->standaloneShorterWeekdays,
                   &s->standaloneNarrowWeekdays, &s->ampms, &s->wideAmpms, &s->narrowAmpms, &s->quarters, &s->shortQuarters,
                   &s->narrowQuarters, &s->standaloneQuarters, &s->standaloneShortQuarters, &s->standaloneNarrowQuarters,
                   &s->leap, &s->shortYearNames, &s->shortZodiacNames, &s->dp[0], &s->dp[1], &s->dp[2], &s->dp[3], &s->dp[4], &s->dp[5]};
  for (size_t i = 0; i < sizeof all / sizeof *all; i++) sa_free(all[i]);
  free(s->timeSeparator);
}

/* ── CalendarDataSink: the arrays and string maps DateFormatSymbols is built from ──────────────────────────────── */
typedef struct { char *path; int isMap; StrArr arr; char **mk, **mv; int nm; } SEntry;
typedef struct {
  SEntry *e; int n, cap;
  char **pairs; int np, cappairs;
  char curType[48], nextType[48]; int hasNext;
  char **visit; int nvisit; int hasVisit;
  char aliasRel[200];
  int failed;
  const DtLoc *loc;
} Sink;
enum { AL_NONE, AL_SAME, AL_DIFF, AL_GREG };

static SEntry *sink_find(Sink *k, const char *path, int wantMap) {
  for (int i = 0; i < k->n; i++) if (!strcmp(k->e[i].path, path) && (wantMap < 0 || k->e[i].isMap == wantMap)) return &k->e[i];
  return NULL;
}
static SEntry *sink_any(Sink *k, const char *path) { return sink_find(k, path, -1); }
static SEntry *sink_add(Sink *k, const char *path, int isMap) {
  if (k->n == k->cap) { k->cap = k->cap ? k->cap * 2 : 64; k->e = (SEntry *)realloc(k->e, sizeof(SEntry) * (size_t)k->cap); }
  SEntry *e = &k->e[k->n++];
  memset(e, 0, sizeof *e);
  e->path = dups(path);
  e->isMap = isMap;
  return e;
}
static void pair_add(Sink *k, const char *a) {
  if (k->np == k->cappairs) { k->cappairs = k->cappairs ? k->cappairs * 2 : 16; k->pairs = (char **)realloc(k->pairs, sizeof(char *) * (size_t)k->cappairs); }
  k->pairs[k->np++] = dups(a);
}
static void sink_free(Sink *k) {
  for (int i = 0; i < k->n; i++) { free(k->e[i].path); sa_free(&k->e[i].arr); for (int j = 0; j < k->e[i].nm; j++) { free(k->e[i].mk[j]); free(k->e[i].mv[j]); } free(k->e[i].mk); free(k->e[i].mv); }
  free(k->e);
  for (int i = 0; i < k->np; i++) free(k->pairs[i]);
  free(k->pairs);
  for (int i = 0; i < k->nvisit; i++) free(k->visit[i]);
  free(k->visit);
}

static int process_alias(Sink *k, const char *currentRel, ScrRes value) {
  if (scr_res_kind(value) != SCR_RES_ALIAS) return AL_NONE;
  size_t n;
  const char *ap = scr_res_str(value, &n);
  static const char prefix[] = "/LOCALE/calendar/";
  size_t pl = sizeof prefix - 1;
  if (n > pl && !memcmp(ap, prefix, pl)) {
    const char *slash = memchr(ap + pl, '/', n - pl);
    if (slash && slash > ap + pl) {
      char calType[48];
      size_t cl = (size_t)(slash - ap - (long)pl);
      snprintf(calType, sizeof calType, "%.*s", (int)(cl < 47 ? cl : 47), ap + pl);
      size_t rl = n - (size_t)(slash + 1 - ap);
      snprintf(k->aliasRel, sizeof k->aliasRel, "%.*s", (int)(rl < 199 ? rl : 199), slash + 1);
      if (!strcmp(k->curType, calType) && strcmp(currentRel, k->aliasRel) != 0) return AL_SAME;
      if (strcmp(k->curType, calType) != 0 && !strcmp(currentRel, k->aliasRel)) {
        if (!strcmp(calType, "gregorian")) return AL_GREG;
        if (!k->hasNext) { snprintf(k->nextType, sizeof k->nextType, "%s", calType); k->hasNext = 1; return AL_DIFF; }
        if (!strcmp(k->nextType, calType)) return AL_DIFF;
      }
    }
  }
  k->failed = 1;
  return AL_NONE;
}

static int cyclic_allowed(const char *path) {
  static const char base[] = "cyclicNameSets";
  size_t bl = sizeof base - 1;
  if (strncmp(path, base, bl) != 0) return 1;
  const char *p = path + bl;
  if (!*p) return 1;
  static const char *const names[] = {"/zodiacs", "/years", "/dayParts"};
  int ok = 0;
  for (int i = 0; i < 3; i++) { size_t l = strlen(names[i]); if (!strncmp(p, names[i], l)) { p += l; ok = 1; break; } }
  if (!ok) return 0;
  if (!*p) return 1;
  if (strncmp(p, "/format", 7) != 0) return 0;
  p += 7;
  if (!*p) return 1;
  return !strcmp(p, "/abbreviated");
}

static void sink_process_resource(Sink *k, char *path, size_t pathCap, ScrRes table) {
  SEntry *smap = NULL;
  int n = scr_res_table_len(table);
  for (int i = 0; i < n; i++) {
    const char *kk; size_t kn;
    ScrRes v = scr_res_table_at(table, i, &kk, &kn);
    char key[96];
    snprintf(key, sizeof key, "%.*s", (int)(kn < 95 ? kn : 95), kk);
    size_t kl = strlen(key);
    if (kl >= 8 && !strcmp(key + kl - 8, "%variant")) continue;
    if (scr_res_kind(v) == SCR_RES_STR) {
      if (i == 0) { smap = sink_add(k, path, 1); }
      if (smap) {
        size_t vl; const char *vs = scr_res_str(v, &vl);
        smap->mk = (char **)realloc(smap->mk, sizeof(char *) * (size_t)(smap->nm + 1));
        smap->mv = (char **)realloc(smap->mv, sizeof(char *) * (size_t)(smap->nm + 1));
        smap->mk[smap->nm] = dups(key);
        smap->mv[smap->nm] = dupn(vs, vl);
        smap->nm++;
      }
      continue;
    }
    size_t pathLength = strlen(path);
    if (pathLength + 1 + kl + 1 > pathCap) continue;
    path[pathLength] = '/';
    memcpy(path + pathLength + 1, key, kl + 1);
    if (!cyclic_allowed(path)) { path[pathLength] = 0; continue; }
    if (sink_any(k, path)) { path[pathLength] = 0; continue; }
    int at = process_alias(k, path, v);
    if (at == AL_SAME) { pair_add(k, k->aliasRel); pair_add(k, path); path[pathLength] = 0; continue; }
    if (scr_res_kind(v) == SCR_RES_ARRAY) {
      SEntry *e = sink_add(k, path, 0);
      int an = scr_res_array_len(v);
      sa_alloc(&e->arr, an);
      for (int j = 0; j < an; j++) { size_t l; const char *s = scr_res_str(scr_res_array_at(v, j), &l); e->arr.s[j] = s ? dupn(s, l) : dups(""); }
    } else if (scr_res_kind(v) == SCR_RES_TABLE) sink_process_resource(k, path, pathCap, v);
    path[pathLength] = 0;
  }
}

static int visit_contains(Sink *k, const char *key) { for (int i = 0; i < k->nvisit; i++) if (!strcmp(k->visit[i], key)) return 1; return 0; }

static void sink_put(void *ctx, ScrRes table) {
  Sink *k = (Sink *)ctx;
  if (k->failed) return;
  char **visitNext = NULL; int nvn = 0;
  int n = scr_res_table_len(table);
  for (int i = 0; i < n; i++) {
    const char *kk; size_t kn;
    ScrRes v = scr_res_table_at(table, i, &kk, &kn);
    char key[96];
    snprintf(key, sizeof key, "%.*s", (int)(kn < 95 ? kn : 95), kk);
    int at = process_alias(k, key, v);
    if (k->failed) break;
    if (at == AL_GREG) continue;
    if (at == AL_DIFF) { visitNext = (char **)realloc(visitNext, sizeof(char *) * (size_t)(nvn + 1)); visitNext[nvn++] = dups(k->aliasRel); continue; }
    if (at == AL_SAME) {
      if (!sink_any(k, k->aliasRel)) { pair_add(k, k->aliasRel); pair_add(k, key); }
      continue;
    }
    if (k->hasVisit && k->nvisit > 0 && !visit_contains(k, key) && strcmp(key, "AmPmMarkersAbbr") != 0) continue;
    if (!strcmp(key, "AmPmMarkers") || !strcmp(key, "AmPmMarkersAbbr") || !strcmp(key, "AmPmMarkersNarrow")) {
      if (!sink_any(k, key) && scr_res_kind(v) == SCR_RES_ARRAY) {
        SEntry *e = sink_add(k, key, 0);
        int an = scr_res_array_len(v);
        sa_alloc(&e->arr, an);
        for (int j = 0; j < an; j++) { size_t l; const char *s = scr_res_str(scr_res_array_at(v, j), &l); e->arr.s[j] = s ? dupn(s, l) : dups(""); }
      }
    } else if (!strcmp(key, "eras") || !strcmp(key, "dayNames") || !strcmp(key, "monthNames") || !strcmp(key, "quarters") || !strcmp(key, "dayPeriod") ||
               !strcmp(key, "monthPatterns") || !strcmp(key, "cyclicNameSets")) {
      if (scr_res_kind(v) == SCR_RES_TABLE) { char path[256]; snprintf(path, sizeof path, "%s", key); sink_process_resource(k, path, sizeof path, v); }
    }
  }
  /* apply same-calendar aliases */
  int modified;
  do {
    modified = 0;
    for (int i = 0; i < k->np;) {
      int mod = 0;
      SEntry *src = sink_any(k, k->pairs[i]);
      if (src) {
        const char *path = k->pairs[i + 1];
        if (!sink_any(k, path)) {
          SEntry *dst = sink_add(k, path, src->isMap);
          src = sink_any(k, k->pairs[i]); /* the table may have moved */
          if (!src->isMap) sa_copy(&dst->arr, &src->arr, 0);
          else {
            dst->nm = src->nm;
            dst->mk = (char **)malloc(sizeof(char *) * (size_t)(src->nm ? src->nm : 1));
            dst->mv = (char **)malloc(sizeof(char *) * (size_t)(src->nm ? src->nm : 1));
            for (int j = 0; j < src->nm; j++) { dst->mk[j] = dups(src->mk[j]); dst->mv[j] = dups(src->mv[j]); }
          }
        }
        mod = 1;
      }
      if (mod) {
        free(k->pairs[i]); free(k->pairs[i + 1]);
        memmove(k->pairs + i, k->pairs + i + 2, sizeof(char *) * (size_t)(k->np - i - 2));
        k->np -= 2;
        modified = 1;
      } else i += 2;
    }
  } while (modified && k->np > 0);
  if (visitNext) {
    for (int i = 0; i < k->nvisit; i++) free(k->visit[i]);
    free(k->visit);
    k->visit = visitNext; k->nvisit = nvn; k->hasVisit = 1;
  }
}

static int sink_load(Sink *k, const DtLoc *loc, const char *type) {
  memset(k, 0, sizeof *k);
  k->loc = loc;
  char cal[48];
  snprintf(cal, sizeof cal, "%s", type);
  for (int guard = 0; guard < 8; guard++) {
    char path[96];
    snprintf(path, sizeof path, "calendar/%s", cal);
    ScrRes probe;
    if (!scr_ures_get(&loc->uloc, SCR_URES_LOC, path, &probe)) {
      if (strcmp(cal, "gregorian") != 0) { snprintf(cal, sizeof cal, "gregorian"); k->hasVisit = 0; continue; }
      return 0;
    }
    snprintf(k->curType, sizeof k->curType, "%s", cal);
    k->hasNext = 0; k->nextType[0] = 0;
    for (int i = 0; i < k->np; i++) free(k->pairs[i]);
    k->np = 0;
    scr_ures_each_table(&loc->uloc, SCR_URES_LOC, path, sink_put, k);
    if (k->failed) return 0;
    if (!strcmp(cal, "gregorian")) break;
    if (k->hasNext) snprintf(cal, sizeof cal, "%s", k->nextType);
    else { snprintf(cal, sizeof cal, "gregorian"); for (int i = 0; i < k->nvisit; i++) free(k->visit[i]); free(k->visit); k->visit = NULL; k->nvisit = 0; k->hasVisit = 0; }
  }
  return 1;
}

static int sink_arr(Sink *k, const char *path, StrArr *out, int offset) {
  SEntry *e = sink_find(k, path, 0);
  if (!e) return 0;
  sa_copy(out, &e->arr, offset);
  return 1;
}

/* EraRules: the highest era code of a calendar type (includeTentativeEra false) */
static int max_era_code(const char *cal) {
  char path[96];
  snprintf(path, sizeof path, "calendarData/%s/eras", cal);
  ScrRes eras;
  if (!scr_ures_misc("supplementalData", path, &eras)) return 1;
  int n = scr_res_table_len(eras);
  int setv[300] = {0}, size = 0, firstTentative = 0x7fffffff;
  for (int i = 0; i < n; i++) {
    const char *k; size_t kn;
    ScrRes e = scr_res_table_at(eras, i, &k, &kn);
    int idx = atoi(k);
    if (idx < 0 || idx >= 300) continue;
    int hasName = 1, hasEnd = 0, isSet = 0;
    for (int j = 0; j < scr_res_table_len(e); j++) {
      const char *kk; size_t kkn;
      ScrRes v = scr_res_table_at(e, j, &kk, &kkn);
      if (kkn == 5 && !memcmp(kk, "start", 5)) isSet = 1;
      else if (kkn == 5 && !memcmp(kk, "named", 5)) { size_t sn; const char *s = scr_res_str(v, &sn); if (s && sn >= 5 && !memcmp(s, "false", 5)) hasName = 0; }
      else if (kkn == 3 && !memcmp(kk, "end", 3)) hasEnd = 1;
    }
    if (!isSet && hasEnd) isSet = 1; /* MIN_ENCODED_START */
    setv[idx] = isSet;
    if (idx + 1 > size) size = idx + 1;
    if (!hasName && idx < firstTentative) firstTentative = idx;
  }
  while (firstTentative < size) size--;
  while (size > 0 && !setv[size - 1]) size--;
  int minEra = 0;
  int s0 = 0;
  while (s0 < size && !setv[s0]) { s0++; minEra++; }
  int len = size - s0;
  return minEra + len - 1;
}

/* initEras: the width's names from the sink's map, the missing codes from the type's own era table chain; 0 = no map */
static int init_eras(Sink *k, const DtLoc *loc, const char *cal, const char *width, StrArr *out, int maxEra) {
  char path[160];
  snprintf(path, sizeof path, "eras/%s", width);
  SEntry *map = sink_find(k, path, 1);
  if (!map) return 0;
  sa_alloc(out, maxEra + 1);
  for (int code = 0; code <= maxEra; code++) {
    char key[16];
    snprintf(key, sizeof key, "%d", code);
    const char *s = NULL; size_t l = 0;
    for (int j = 0; j < map->nm; j++) if (!strcmp(map->mk[j], key)) { s = map->mv[j]; l = strlen(s); break; }
    if (!s) {
      char kp[200];
      snprintf(kp, sizeof kp, "calendar/%s/eras/%s/%s", cal, width, key);
      ScrRes r;
      if (scr_ures_get(&loc->uloc, SCR_URES_LOC, kp, &r)) s = scr_res_str(r, &l);
    }
    out->s[code] = s ? dupn(s, l) : dups("");
  }
  return 1;
}

static void load_day_periods(Sink *k, const char *ctx, const char *width, StrArr *out) {
  static const char *const keys[10] = {"midnight", "noon", "morning1", "afternoon1", "evening1", "night1", "morning2", "afternoon2", "evening2", "night2"};
  char path[96];
  snprintf(path, sizeof path, "dayPeriod/%s/%s", ctx, width);
  SEntry *map = sink_find(k, path, 1);
  sa_alloc(out, 10);
  for (int i = 0; i < 10; i++) {
    out->s[i] = NULL;
    if (!map) continue;
    for (int j = 0; j < map->nm; j++) if (!strcmp(map->mk[j], keys[i])) { out->s[i] = dups(map->mv[j]); break; }
  }
}

/* initLeapMonthPattern: 1 = map present (*out may stay NULL = bogus), 0 = missing */
static int month_pattern_leap(Sink *k, const char *ctx, const char *width, char **out) {
  char path[96];
  snprintf(path, sizeof path, "monthPatterns/%s/%s", ctx, width);
  SEntry *map = sink_find(k, path, 1);
  *out = NULL;
  if (!map) return 0;
  for (int j = 0; j < map->nm; j++) if (!strcmp(map->mk[j], "leap")) { *out = dups(map->mv[j]); break; }
  return 1;
}

static void assign_array(StrArr *dst, const StrArr *src) { sa_free(dst); sa_copy(dst, src, 0); }

/* A guarded initField: skipped once the status has failed; a missing array fails it. */
static int fld(int *st, Sink *k, const char *rest, StrArr *out, int offset) {
  if (*st) return 0;
  if (sink_arr(k, rest, out, offset)) return 1;
  *st = 1;
  return 0;
}

static int syms_load(Syms *s, const DtLoc *loc, const char *cal) {
  memset(s, 0, sizeof *s);
  Sink sk;
  if (!sink_load(&sk, loc, cal)) { sink_free(&sk); return 0; }
  /* leap month patterns: all seven must exist */
  {
    static const char *const ctx[7] = {"format", "format", "format", "stand-alone", "stand-alone", "stand-alone", "numeric"};
    static const char *const wd[7] = {"wide", "abbreviated", "narrow", "wide", "abbreviated", "narrow", "all"};
    sa_alloc(&s->leap, 7);
    int ok = 1;
    for (int i = 0; i < 7; i++) {
      if (!month_pattern_leap(&sk, ctx[i], wd[i], &s->leap.s[i])) ok = 0;
    }
    if (ok) {
      for (int i = 0; i < 7; i++) if (!s->leap.s[i]) s->leap.s[i] = dups("");
      if (!s->leap.s[LP_FABBR][0]) { free(s->leap.s[LP_FABBR]); s->leap.s[LP_FABBR] = dups(s->leap.s[LP_FWIDE]); }
      if (!s->leap.s[LP_FNARROW][0]) { free(s->leap.s[LP_FNARROW]); s->leap.s[LP_FNARROW] = dups(s->leap.s[LP_SNARROW]); }
      if (!s->leap.s[LP_SWIDE][0]) { free(s->leap.s[LP_SWIDE]); s->leap.s[LP_SWIDE] = dups(s->leap.s[LP_FWIDE]); }
      if (!s->leap.s[LP_SABBR][0]) { free(s->leap.s[LP_SABBR]); s->leap.s[LP_SABBR] = dups(s->leap.s[LP_FABBR]); }
      s->hasLeap = 1;
    } else sa_free(&s->leap);
  }
  sink_arr(&sk, "cyclicNameSets/years/format/abbreviated", &s->shortYearNames, 0);
  sink_arr(&sk, "cyclicNameSets/zodiacs/format/abbreviated", &s->shortZodiacNames, 0);
  /* time separator */
  {
    char ns[24] = "";
    if (loc->numbering[0]) snprintf(ns, sizeof ns, "%s", loc->numbering);
    else scr_res_get_str(&loc->uloc, SCR_URES_LOC, "NumberElements/default", ns, sizeof ns);
    if (!ns[0]) snprintf(ns, sizeof ns, "latn");
    char path[96], buf[32];
    snprintf(path, sizeof path, "NumberElements/%s/symbols/timeSeparator", ns);
    if (scr_res_get_str(&loc->uloc, SCR_URES_LOC, path, buf, sizeof buf)) s->timeSeparator = dups(buf);
    else s->timeSeparator = dups(":");
  }
  load_day_periods(&sk, "format", "abbreviated", &s->dp[DP_ABBR]);
  load_day_periods(&sk, "format", "wide", &s->dp[DP_WIDE]);
  load_day_periods(&sk, "format", "narrow", &s->dp[DP_NARROW]);
  load_day_periods(&sk, "stand-alone", "abbreviated", &s->dp[DP_SABBR]);
  load_day_periods(&sk, "stand-alone", "wide", &s->dp[DP_SWIDE]);
  load_day_periods(&sk, "stand-alone", "narrow", &s->dp[DP_SNARROW]);
  for (int i = 0; i < s->dp[DP_ABBR].n; i++) {
    if (!s->dp[DP_WIDE].s[i] && s->dp[DP_ABBR].s[i]) s->dp[DP_WIDE].s[i] = dups(s->dp[DP_ABBR].s[i]);
    if (!s->dp[DP_NARROW].s[i] && s->dp[DP_ABBR].s[i]) s->dp[DP_NARROW].s[i] = dups(s->dp[DP_ABBR].s[i]);
    if (!s->dp[DP_SABBR].s[i] && s->dp[DP_ABBR].s[i]) s->dp[DP_SABBR].s[i] = dups(s->dp[DP_ABBR].s[i]);
    if (!s->dp[DP_SWIDE].s[i] && s->dp[DP_SABBR].s[i]) s->dp[DP_SWIDE].s[i] = dups(s->dp[DP_SABBR].s[i]);
    if (!s->dp[DP_SNARROW].s[i] && s->dp[DP_SABBR].s[i]) s->dp[DP_SNARROW].s[i] = dups(s->dp[DP_SABBR].s[i]);
  }

  /* the status-carrying part of initializeData, step for step */
  int st = 0;
  int maxEra = 0;
  {
    char path[96];
    ScrRes tmp;
    snprintf(path, sizeof path, "calendarData/%s/eras", cal);
    if (!scr_ures_misc("supplementalData", path, &tmp)) st = 1; /* EraRules::createInstance fails */
    else maxEra = max_era_code(cal);
  }
  if (!st && !init_eras(&sk, loc, cal, "abbreviated", &s->eras, maxEra)) st = 1;
  {
    int old = st;
    if (!st && !init_eras(&sk, loc, cal, "wide", &s->eraNames, maxEra)) st = 1;
    if (st) { st = old; sa_free(&s->eraNames); sa_copy(&s->eraNames, &s->eras, 0); }
    old = st;
    if (!st && !init_eras(&sk, loc, cal, "narrow", &s->narrowEras, maxEra)) st = 1;
    if (st) { st = old; sa_free(&s->narrowEras); sa_copy(&s->narrowEras, &s->eras, 0); }
  }
  fld(&st, &sk, "monthNames/format/wide", &s->months, 0);
  fld(&st, &sk, "monthNames/format/abbreviated", &s->shortMonths, 0);
  fld(&st, &sk, "monthNames/stand-alone/wide", &s->standaloneMonths, 0);
  if (st) { st = 0; sa_free(&s->standaloneMonths); sa_copy(&s->standaloneMonths, &s->months, 0); }
  fld(&st, &sk, "monthNames/stand-alone/abbreviated", &s->standaloneShortMonths, 0);
  if (st) { st = 0; sa_free(&s->standaloneShortMonths); sa_copy(&s->standaloneShortMonths, &s->shortMonths, 0); }
  {
    int ec1 = st, ec2 = st;
    fld(&ec1, &sk, "monthNames/format/narrow", &s->narrowMonths, 0);
    fld(&ec2, &sk, "monthNames/stand-alone/narrow", &s->standaloneNarrowMonths, 0);
    if (ec1 && !ec2) sa_copy(&s->narrowMonths, &s->standaloneNarrowMonths, 0);
    else if (!ec1 && ec2) sa_copy(&s->standaloneNarrowMonths, &s->narrowMonths, 0);
    else if (ec1 && ec2) { sa_free(&s->narrowMonths); sa_free(&s->standaloneNarrowMonths); sa_copy(&s->narrowMonths, &s->shortMonths, 0); sa_copy(&s->standaloneNarrowMonths, &s->shortMonths, 0); }
  }
  /* AM/PM markers use their own status */
  if (!sink_arr(&sk, "AmPmMarkersAbbr", &s->ampms, 0)) { sa_alloc(&s->ampms, 2); s->ampms.s[0] = dups("AM"); s->ampms.s[1] = dups("PM"); }
  if (!sink_arr(&sk, "AmPmMarkersNarrow", &s->narrowAmpms, 0)) sa_copy(&s->narrowAmpms, &s->ampms, 0);
  if (!sink_arr(&sk, "AmPmMarkers", &s->wideAmpms, 0)) sa_copy(&s->wideAmpms, &s->ampms, 0);

  fld(&st, &sk, "quarters/format/wide", &s->quarters, 0);
  fld(&st, &sk, "quarters/format/abbreviated", &s->shortQuarters, 0);
  if (st) { st = 0; sa_free(&s->shortQuarters); sa_copy(&s->shortQuarters, &s->quarters, 0); }
  fld(&st, &sk, "quarters/stand-alone/wide", &s->standaloneQuarters, 0);
  if (st) { st = 0; sa_free(&s->standaloneQuarters); sa_copy(&s->standaloneQuarters, &s->quarters, 0); }
  fld(&st, &sk, "quarters/stand-alone/abbreviated", &s->standaloneShortQuarters, 0);
  if (st) { st = 0; sa_free(&s->standaloneShortQuarters); sa_copy(&s->standaloneShortQuarters, &s->shortQuarters, 0); }
  fld(&st, &sk, "quarters/stand-alone/narrow", &s->standaloneNarrowQuarters, 0);
  fld(&st, &sk, "quarters/format/narrow", &s->narrowQuarters, 0);
  if (st) { st = 0; sa_free(&s->narrowQuarters); sa_copy(&s->narrowQuarters, &s->standaloneNarrowQuarters, 0); }

  fld(&st, &sk, "dayNames/format/wide", &s->weekdays, 1);
  fld(&st, &sk, "dayNames/format/abbreviated", &s->shortWeekdays, 1);
  fld(&st, &sk, "dayNames/format/short", &s->shorterWeekdays, 1);
  if (st) { st = 0; sa_free(&s->shorterWeekdays); sa_copy(&s->shorterWeekdays, &s->shortWeekdays, 0); }
  fld(&st, &sk, "dayNames/stand-alone/wide", &s->standaloneWeekdays, 1);
  if (st) { st = 0; sa_free(&s->standaloneWeekdays); sa_copy(&s->standaloneWeekdays, &s->weekdays, 0); }
  fld(&st, &sk, "dayNames/stand-alone/abbreviated", &s->standaloneShortWeekdays, 1);
  if (st) { st = 0; sa_free(&s->standaloneShortWeekdays); sa_copy(&s->standaloneShortWeekdays, &s->shortWeekdays, 0); }
  fld(&st, &sk, "dayNames/stand-alone/short", &s->standaloneShorterWeekdays, 1);
  if (st) { st = 0; sa_free(&s->standaloneShorterWeekdays); sa_copy(&s->standaloneShorterWeekdays, &s->shorterWeekdays, 0); }
  {
    int ec1 = st, ec2 = st;
    fld(&ec1, &sk, "dayNames/format/narrow", &s->narrowWeekdays, 1);
    fld(&ec2, &sk, "dayNames/stand-alone/narrow", &s->standaloneNarrowWeekdays, 1);
    if (ec1 && !ec2) sa_copy(&s->narrowWeekdays, &s->standaloneNarrowWeekdays, 0);
    else if (!ec1 && ec2) sa_copy(&s->standaloneNarrowWeekdays, &s->narrowWeekdays, 0);
    else if (ec1 && ec2) { sa_free(&s->narrowWeekdays); sa_free(&s->standaloneNarrowWeekdays); sa_copy(&s->narrowWeekdays, &s->shortWeekdays, 0); sa_copy(&s->standaloneNarrowWeekdays, &s->shortWeekdays, 0); }
  }
  sink_free(&sk);
  return st ? 0 : 1;
}

/* ── day period rules ────────────────────────────────────────────────────────────────────────────────────── */
enum { DPR_MIDNIGHT = 0, DPR_NOON, DPR_MORNING1, DPR_AFTERNOON1, DPR_EVENING1, DPR_NIGHT1, DPR_MORNING2, DPR_AFTERNOON2, DPR_EVENING2, DPR_NIGHT2, DPR_AM, DPR_PM, DPR_UNKNOWN = -1 };
typedef struct { int forHour[24]; int hasMidnight, hasNoon; } DpRules;

static int dpr_from_string(const char *k) {
  static const char *const n[12] = {"midnight", "noon", "morning1", "afternoon1", "evening1", "night1", "morning2", "afternoon2", "evening2", "night2", "am", "pm"};
  for (int i = 0; i < 12; i++) if (strcmp(n[i], k) == 0) return i;
  return DPR_UNKNOWN;
}
static int parse_hour(const char *s) { return atoi(s); }

static int dp_rules_load(const char *baseName, DpRules *out) {
  char name[96];
  snprintf(name, sizeof name, "%s", baseName[0] ? baseName : "root");
  char setname[16] = "";
  for (;;) {
    char path[128];
    snprintf(path, sizeof path, "locales/%s", name);
    ScrRes r;
    if (scr_ures_misc("dayPeriods", path, &r)) { size_t n; const char *s = scr_res_str(r, &n); if (s && n < sizeof setname) { memcpy(setname, s, n); setname[n] = 0; } break; }
    char *u = strrchr(name, '_');
    if (!u) break;
    *u = 0;
  }
  if (!setname[0]) return 0;
  char path[128];
  snprintf(path, sizeof path, "rules/%s", setname);
  ScrRes set;
  if (!scr_ures_misc("dayPeriods", path, &set)) return 0;
  for (int i = 0; i < 24; i++) out->forHour[i] = DPR_UNKNOWN;
  out->hasMidnight = out->hasNoon = 0;
  for (int pi = 0; pi < scr_res_table_len(set); pi++) {
    const char *pk; size_t pkn;
    ScrRes pdef = scr_res_table_at(set, pi, &pk, &pkn);
    char pname[24];
    snprintf(pname, sizeof pname, "%.*s", (int)pkn, pk);
    int period = dpr_from_string(pname);
    if (period == DPR_UNKNOWN) return 0;
    int cutoffs[25] = {0}; /* bit0 before, bit1 after, bit2 from, bit3 at */
    for (int ki = 0; ki < scr_res_table_len(pdef); ki++) {
      const char *kk; size_t kn;
      ScrRes v = scr_res_table_at(pdef, ki, &kk, &kn);
      int type = -1;
      if (kn == 4 && !memcmp(kk, "from", 4)) type = 2;
      else if (kn == 6 && !memcmp(kk, "before", 6)) type = 0;
      else if (kn == 5 && !memcmp(kk, "after", 5)) type = 1;
      else if (kn == 2 && !memcmp(kk, "at", 2)) type = 3;
      if (type < 0) return 0;
      if (scr_res_kind(v) == SCR_RES_STR) { size_t l; const char *s = scr_res_str(v, &l); cutoffs[parse_hour(s)] |= 1 << type; }
      else for (int a = 0; a < scr_res_array_len(v); a++) { size_t l; const char *s = scr_res_str(scr_res_array_at(v, a), &l); cutoffs[parse_hour(s)] |= 1 << type; }
    }
    for (int start = 0; start <= 24; start++) {
      if (cutoffs[start] & (1 << 3)) {
        if (start == 0 && period == DPR_MIDNIGHT) out->hasMidnight = 1;
        else if (start == 12 && period == DPR_NOON) out->hasNoon = 1;
        else return 0;
      }
      if (cutoffs[start] & ((1 << 2) | (1 << 1))) {
        for (int hour = start + 1;; ++hour) {
          if (hour == start) return 0;
          if (hour == 25) hour = 0;
          if (cutoffs[hour] & 1) {
            for (int i = start; i != hour; ++i) { if (i == 24) i = 0; out->forHour[i] = period; }
            break;
          }
        }
      }
    }
  }
  for (int i = 0; i < 24; i++) if (out->forHour[i] == DPR_UNKNOWN) return 0;
  return 1;
}

/* ── numbers: the locale's numbering system digits ───────────────────────────────────────────────────────── */
typedef struct { char digit[10][8]; char minus[16]; } NumFmt;

static int ns_digits(const char *ns, char dig[10][8]) {
  char k[48];
  snprintf(k, sizeof k, "ns/%s", ns);
  ScrCoreVal v = scr_core_get(k);
  if (!v.p || (v.n >= 4 && memcmp(v.p, "alg:", 4) == 0)) return 0;
  const unsigned char *p = (const unsigned char *)v.p, *e = p + v.n;
  int i = 0;
  while (p < e && i < 10) {
    size_t l = 1;
    if (*p >= 0xF0) l = 4; else if (*p >= 0xE0) l = 3; else if (*p >= 0xC0) l = 2;
    memcpy(dig[i], p, l);
    dig[i][l] = 0;
    p += l;
    i++;
  }
  return i == 10;
}

static void numfmt_init(NumFmt *nf, const DtLoc *loc, const char *forceNs) {
  char ns[24] = "";
  if (forceNs && forceNs[0] && ns_digits(forceNs, nf->digit)) snprintf(ns, sizeof ns, "%s", forceNs);
  else if (loc->numbering[0] && ns_digits(loc->numbering, nf->digit)) snprintf(ns, sizeof ns, "%s", loc->numbering);
  else {
    char dn[24];
    if (!scr_res_get_str(&loc->uloc, SCR_URES_LOC, "NumberElements/default", dn, sizeof dn)) strcpy(dn, "latn");
    if (!ns_digits(dn, nf->digit)) { strcpy(dn, "latn"); ns_digits(dn, nf->digit); }
    snprintf(ns, sizeof ns, "%s", dn);
  }
  char path[96];
  snprintf(path, sizeof path, "NumberElements/%s/symbols/minusSign", ns);
  if (!scr_res_get_str(&loc->uloc, SCR_URES_LOC, path, nf->minus, sizeof nf->minus)) {
    if (!scr_res_get_str(&loc->uloc, SCR_URES_LOC, "NumberElements/latn/symbols/minusSign", nf->minus, sizeof nf->minus)) strcpy(nf->minus, "-");
  }
}

/* zeroPaddingNumber: min..max integer digits (the low digits are kept when there are more) */
static void put_number(Sb *out, const NumFmt *nf, int64_t value, int minDigits, int maxDigits) {
  char tmp[32];
  int neg = value < 0;
  uint64_t u = neg ? (uint64_t)(-value) : (uint64_t)value;
  int n = 0;
  do { tmp[n++] = (char)('0' + (int)(u % 10)); u /= 10; } while (u && n < 30);
  if (n > maxDigits) n = maxDigits;
  if (neg) sb_puts(out, nf->minus);
  for (int i = n; i < minDigits; i++) sb_puts(out, nf->digit[0]);
  for (int i = n - 1; i >= 0; i--) sb_puts(out, nf->digit[tmp[i] - '0']);
}

/* ── the formatter ───────────────────────────────────────────────────────────────────────────────────────── */
typedef struct { NumFmt nf; ScrRbnf *rb; char name[24]; } OvrFmt;
struct ScrDtFmt {
  DtLoc loc;
  OvrFmt ovr[6]; int novr;
  signed char fieldOvr[U_FIELD_COUNT];
  int hebrewYearOverride; /* fDateOverride == "hebr" */
  char *pattern;
  int calType;
  Syms syms;
  NumFmt nf;
  DpRules dpr;
  int hasDpr;
  int hasMinute, hasSecond;
  ScrCal cal;
  int calFailed, failed; /* the calendar could not compute fields for the instant / a field failed (ICU's U_FAILURE(status)) */
};

/* zeroPaddingNumber over the field's number format (an RBNF ignores the digit counts) */
static void pn(ScrDtFmt *f, int idx, Sb *out, int64_t value, int minDigits, int maxDigits) {
  int oi = f->fieldOvr[idx];
  if (oi >= 0 && f->ovr[oi].rb) {
    char *t = scr_rbnf_format(f->ovr[oi].rb, value);
    if (t) { sb_puts(out, t); free(t); }
    return;
  }
  put_number(out, oi >= 0 ? &f->ovr[oi].nf : &f->nf, value, minDigits, maxDigits);
}

static const unsigned char kDateFieldIdx[16] = {U_YEAR, U_MONTH, U_DATE, U_DAY_OF_YEAR, U_DOW_IN_MONTH, U_WEEK_OF_YEAR, U_WEEK_OF_MONTH, U_YEAR_WOY, U_EXTENDED_YEAR, U_JULIAN_DAY, U_STANDALONE_DAY, U_STANDALONE_MONTH, U_QUARTER, U_STANDALONE_QUARTER, U_YEAR_NAME, U_RELATED_YEAR};
static const unsigned char kTimeFieldIdx[10] = {U_HOUR_OF_DAY1, U_HOUR_OF_DAY0, U_MINUTE, U_SECOND, U_FRACTIONAL_SECOND, U_HOUR1, U_HOUR0, U_MILLIS_IN_DAY, U_TZ_RFC, U_TZ_LOCALIZED_GMT};

/* the override's number format: a numeric system's digits, or the RBNF behind an algorithmic one */
static int ovr_get(ScrDtFmt *f, const char *nsName) {
  for (int i = 0; i < f->novr; i++) if (!strcmp(f->ovr[i].name, nsName)) return i;
  if (f->novr >= 6) return -1;
  OvrFmt *o = &f->ovr[f->novr];
  memset(o, 0, sizeof *o);
  snprintf(o->name, sizeof o->name, "%s", nsName);
  char k[48];
  snprintf(k, sizeof k, "ns/%s", nsName);
  ScrCoreVal v = scr_core_get(k);
  if (v.p && v.n >= 4 && !memcmp(v.p, "alg:", 4)) {
    char desc[96];
    size_t dn = v.n - 4 < sizeof desc - 1 ? v.n - 4 : sizeof desc - 1;
    memcpy(desc, v.p + 4, dn); desc[dn] = 0;
    char lcl[16] = "root", grp[32] = "NumberingSystemRules", setName[64];
    const char *sl = strchr(desc, '/');
    if (sl) {
      const char *sl2 = strchr(sl + 1, '/');
      if (!sl2) return -1;
      snprintf(lcl, sizeof lcl, "%.*s", (int)(sl - desc), desc);
      snprintf(grp, sizeof grp, "%.*s", (int)(sl2 - sl - 1), sl + 1);
      snprintf(setName, sizeof setName, "%s%s", sl2[1] == '%' ? "" : "%", sl2 + 1);
    } else snprintf(setName, sizeof setName, "%s%s", desc[0] == '%' ? "" : "%", desc);
    snprintf(k, sizeof k, "rbnf/%s/%s", lcl, grp);
    ScrCoreVal rt = scr_core_get(k);
    if (!rt.p) return -1;
    char *text = (char *)malloc(rt.n + 1);
    memcpy(text, rt.p, rt.n); text[rt.n] = 0;
    numfmt_init(&o->nf, &f->loc, NULL);
    o->rb = scr_rbnf_open(text, setName, o->nf.minus, ",");
    free(text);
  } else if (v.p) {
    numfmt_init(&o->nf, &f->loc, nsName);
  } else return -1;
  return f->novr++;
}

static void apply_override(ScrDtFmt *f, const char *str, int isTime) {
  if (!str) return;
  const char *p = str;
  while (*p) {
    const char *semi = strchr(p, ';');
    size_t len = semi ? (size_t)(semi - p) : strlen(p);
    char item[64];
    snprintf(item, sizeof item, "%.*s", (int)(len < 63 ? len : 63), p);
    char *eq = strchr(item, '=');
    const char *nsName = eq ? eq + 1 : item;
    int oi = ovr_get(f, nsName);
    if (oi >= 0) {
      if (!eq) {
        if (!isTime) for (int i = 0; i < 16; i++) f->fieldOvr[kDateFieldIdx[i]] = (signed char)oi;
        else for (int i = 0; i < 10; i++) f->fieldOvr[kTimeFieldIdx[i]] = (signed char)oi;
      } else {
        int fi = pattern_char_index(item[0]);
        if (fi != U_FIELD_COUNT) f->fieldOvr[fi] = (signed char)oi;
      }
    }
    if (!semi) break;
    p = semi + 1;
  }
}

static void parse_pattern_flags(ScrDtFmt *f) {
  int inQuote = 0;
  for (const char *p = f->pattern; *p; p++) {
    if (*p == '\'') inQuote = !inQuote;
    if (!inQuote) { if (*p == 'm') f->hasMinute = 1; if (*p == 's') f->hasSecond = 1; }
  }
}

static void week_data(const DtLoc *loc, int *first, int *minDays) {
  *first = 1; *minDays = 1;
  char region[8];
  scr_dtloc_supplemental_region(loc, 1, region, sizeof region);
  ScrRes r;
  char path[32];
  snprintf(path, sizeof path, "weekData/%s", region);
  if (!region[0] || !scr_ures_misc("supplementalData", path, &r)) {
    if (!scr_ures_misc("supplementalData", "weekData/001", &r)) return;
  }
  int32_t v[6];
  if (scr_res_intvec(r, v, 6) >= 2) { *first = v[0]; *minDays = v[1]; }
}

ScrDtFmt *scr_dtfmt_new(const DtLoc *loc, const char *pattern, int calType, const char *dateOverride, const char *timeOverride) {
  ScrDtFmt *f = (ScrDtFmt *)calloc(1, sizeof *f);
  f->loc = *loc;
  f->pattern = dups(pattern);
  f->calType = calType;
  if (!syms_load(&f->syms, loc, scr_cal_type_name(calType))) { syms_free(&f->syms); free(f->pattern); free(f); return NULL; }
  numfmt_init(&f->nf, loc, NULL);
  f->hasDpr = dp_rules_load(loc->base, &f->dpr);
  parse_pattern_flags(f);
  memset(f->fieldOvr, -1, sizeof f->fieldOvr);
  {
    int hasHan = strstr(pattern, "\xE5\xB9\xB4") != NULL;
    const char *dov = dateOverride;
    if (!dov && hasHan && calType == CT_JAPANESE && !strcmp(loc->lang, "ja")) dov = "y=jpanyear";
    apply_override(f, dov, 0);
    apply_override(f, timeOverride, 1);
    f->hebrewYearOverride = dov && !strcmp(dov, "hebr");
  }
  int fd, md;
  week_data(loc, &fd, &md);
  if (calType == CT_ISO8601) { fd = 2; md = 4; }
  scr_cal_set_week_data(&f->cal, fd, md);
  return f;
}

void scr_dtfmt_free(ScrDtFmt *f) {
  if (!f) return;
  syms_free(&f->syms);
  for (int i = 0; i < f->novr; i++) scr_rbnf_free(f->ovr[i].rb);
  free(f->pattern);
  free(f);
}
const char *scr_dtfmt_pattern(const ScrDtFmt *f) { return f->pattern; }

static void append_sym(Sb *out, const StrArr *a, int v) {
  if (v >= 0 && v < a->n && a->s[v]) sb_puts(out, a->s[v]);
}

static char *simple_format1(const char *pat, const char *arg) {
  Sb r = {0};
  const char *p = pat;
  while (*p) {
    if (*p == '\'' && p[1] == '\'') { sb_putc(&r, '\''); p += 2; continue; }
    if (*p == '{' && p[1] == '0' && p[2] == '}') { sb_puts(&r, arg); p += 3; continue; }
    sb_putc(&r, *p++);
  }
  return sb_take(&r);
}
static void append_sym_leap(Sb *out, const StrArr *a, int v, const char *monthPattern) {
  if (v < 0 || v >= a->n || !a->s[v]) return;
  if (!monthPattern) { sb_puts(out, a->s[v]); return; }
  char *t = simple_format1(monthPattern, a->s[v]);
  sb_puts(out, t);
  free(t);
}

static void sub_format(ScrDtFmt *f, Sb *out, char ch, int count, const ScrDtZone *zone, double utcMs, char fieldToOutput);

static int hebrew_leap_year(int32_t year) { return ((12 * year + 17) % 19) >= 12; }

static void sub_format(ScrDtFmt *f, Sb *out, char ch, int count, const ScrDtZone *zone, double utcMs, char fieldToOutput) {
  (void)fieldToOutput;
  if (f->failed) return;
  int idx = pattern_char_index(ch);
  if (idx == U_FIELD_COUNT) return;
  if (f->calFailed && (kIdxToCal[idx] < CAL_FIELD_COUNT || idx == U_AM_PM_MIDNIGHT_NOON || idx == U_FLEXIBLE_DAY_PERIOD)) { f->failed = 1; return; }
  const Syms *S = &f->syms;
  const ScrCal *cal = &f->cal;
  int calField = kIdxToCal[idx];
  int32_t value = 0;
  if (calField < CAL_FIELD_COUNT) value = idx != U_RELATED_YEAR ? cal->f[calField] : cal->relatedYear;
  switch (idx) {
    case U_ERA:
      if (f->calType == CT_CHINESE || f->calType == CT_DANGI) pn(f, idx, out, value, 1, 9);
      else if (count == 5) append_sym(out, &S->narrowEras, value);
      else if (count == 4) append_sym(out, &S->eraNames, value);
      else append_sym(out, &S->eras, value);
      break;
    case U_YEAR_NAME:
      if (S->shortYearNames.s && value <= S->shortYearNames.n) { append_sym(out, &S->shortYearNames, value - 1); break; }
      /* fall through to numeric year */
    case U_YEAR: case U_YEAR_WOY:
      if (f->hebrewYearOverride && value > 5000 && value < 6000) value -= 5000;
      if (count == 2) pn(f, idx, out, value, 2, 2);
      else pn(f, idx, out, value, count, 10);
      break;
    case U_MONTH: case U_STANDALONE_MONTH: {
      if (f->calType == CT_HEBREW) {
        int leap = hebrew_leap_year(cal->f[CAL_YEAR]);
        if (leap && value == 6 && count >= 3) value = 13;
        if (!leap && value >= 6 && count < 3) value--;
      }
      int isLeapMonth = S->hasLeap ? cal->f[CAL_IS_LEAP_MONTH] : 0;
      const char *const *lp = S->hasLeap ? (const char *const *)S->leap.s : NULL;
      int std = idx == U_STANDALONE_MONTH;
      if (count == 5) append_sym_leap(out, std ? &S->standaloneNarrowMonths : &S->narrowMonths, value, isLeapMonth && lp ? lp[std ? LP_SNARROW : LP_FNARROW] : NULL);
      else if (count == 4) append_sym_leap(out, std ? &S->standaloneMonths : &S->months, value, isLeapMonth && lp ? lp[std ? LP_SWIDE : LP_FWIDE] : NULL);
      else if (count == 3) append_sym_leap(out, std ? &S->standaloneShortMonths : &S->shortMonths, value, isLeapMonth && lp ? lp[std ? LP_SABBR : LP_FABBR] : NULL);
      else {
        Sb num = {0};
        pn(f, idx, &num, value + 1, count, 10);
        if (isLeapMonth && lp) { char *t = simple_format1(lp[LP_NUMERIC], num.p); sb_puts(out, t); free(t); }
        else sb_puts(out, num.p);
        sb_free(&num);
      }
      break;
    }
    case U_HOUR_OF_DAY1:
      pn(f, idx, out, value == 0 ? 24 : value, count, 10);
      break;
    case U_FRACTIONAL_SECOND: {
      int minDigits = count > 3 ? 3 : count;
      if (count == 1) value /= 100; else if (count == 2) value /= 10;
      pn(f, idx, out, value, minDigits, 10);
      if (count > 3) pn(f, idx, out, 0, count - 3, 10);
      break;
    }
    case U_DOW_LOCAL:
      if (count < 3) { pn(f, idx, out, value, count, 10); break; }
      value = cal->f[CAL_DAY_OF_WEEK];
      /* fall through */
    case U_DAY_OF_WEEK:
      if (count == 5) append_sym(out, &S->narrowWeekdays, value);
      else if (count == 4) append_sym(out, &S->weekdays, value);
      else if (count == 6) append_sym(out, &S->shorterWeekdays, value);
      else append_sym(out, &S->shortWeekdays, value);
      break;
    case U_STANDALONE_DAY:
      if (count < 3) { pn(f, idx, out, value, 1, 10); break; }
      value = cal->f[CAL_DAY_OF_WEEK];
      if (count == 5) append_sym(out, &S->standaloneNarrowWeekdays, value);
      else if (count == 4) append_sym(out, &S->standaloneWeekdays, value);
      else if (count == 6) append_sym(out, &S->standaloneShorterWeekdays, value);
      else append_sym(out, &S->standaloneShortWeekdays, value);
      break;
    case U_AM_PM:
      if (count == 4) append_sym(out, &S->wideAmpms, value);
      else if (count == 5) append_sym(out, &S->narrowAmpms, value);
      else append_sym(out, &S->ampms, value);
      break;
    case U_HOUR1:
      pn(f, idx, out, value == 0 ? 12 : value, count, 10); /* getLeastMaximum(HOUR) + 1 */
      break;
    case U_TIMEZONE: case U_TZ_RFC: case U_TZ_GENERIC: case U_TZ_SPECIAL: case U_TZ_LOCALIZED_GMT: case U_TZ_ISO: case U_TZ_ISO_LOCAL: {
      int style = -1;
      switch (idx) {
        case U_TIMEZONE: style = count < 4 ? TZFMT_SPECIFIC_SHORT : TZFMT_SPECIFIC_LONG; break;
        case U_TZ_RFC: style = count < 4 ? TZFMT_ISO_BASIC_LOCAL_FULL : count == 5 ? TZFMT_ISO_EXTENDED_FULL : TZFMT_LOCALIZED_GMT; break;
        case U_TZ_GENERIC: style = count == 1 ? TZFMT_GENERIC_SHORT : count == 4 ? TZFMT_GENERIC_LONG : -1; break;
        case U_TZ_SPECIAL: style = count == 1 ? TZFMT_ZONE_ID_SHORT : count == 2 ? TZFMT_ZONE_ID : count == 3 ? TZFMT_EXEMPLAR_LOCATION : count == 4 ? TZFMT_GENERIC_LOCATION : -1; break;
        case U_TZ_LOCALIZED_GMT: style = count == 1 ? TZFMT_LOCALIZED_GMT_SHORT : count == 4 ? TZFMT_LOCALIZED_GMT : -1; break;
        case U_TZ_ISO: style = count == 1 ? TZFMT_ISO_BASIC_SHORT : count == 2 ? TZFMT_ISO_BASIC_FIXED : count == 3 ? TZFMT_ISO_EXTENDED_FIXED : count == 4 ? TZFMT_ISO_BASIC_FULL : count == 5 ? TZFMT_ISO_EXTENDED_FULL : -1; break;
        case U_TZ_ISO_LOCAL: style = count == 1 ? TZFMT_ISO_BASIC_LOCAL_SHORT : count == 2 ? TZFMT_ISO_BASIC_LOCAL_FIXED : count == 3 ? TZFMT_ISO_EXTENDED_LOCAL_FIXED : count == 4 ? TZFMT_ISO_BASIC_LOCAL_FULL : count == 5 ? TZFMT_ISO_EXTENDED_LOCAL_FULL : -1; break;
      }
      if (style >= 0 && zone && zone->format) {
        char *z = zone->format(zone->ctx, style, utcMs, cal);
        if (z) { sb_puts(out, z); free(z); }
      }
      break;
    }
    case U_QUARTER:
      if (count >= 5) append_sym(out, &S->narrowQuarters, value / 3);
      else if (count == 4) append_sym(out, &S->quarters, value / 3);
      else if (count == 3) append_sym(out, &S->shortQuarters, value / 3);
      else pn(f, idx, out, value / 3 + 1, count, 10);
      break;
    case U_STANDALONE_QUARTER:
      if (count >= 5) append_sym(out, &S->standaloneNarrowQuarters, value / 3);
      else if (count == 4) append_sym(out, &S->standaloneQuarters, value / 3);
      else if (count == 3) append_sym(out, &S->standaloneShortQuarters, value / 3);
      else pn(f, idx, out, value / 3 + 1, count, 10);
      break;
    case U_AM_PM_MIDNIGHT_NOON: {
      const char *toAppend = NULL;
      int hour = cal->f[CAL_HOUR_OF_DAY];
      if (hour == 12 && (!f->hasMinute || cal->f[CAL_MINUTE] == 0) && (!f->hasSecond || cal->f[CAL_SECOND] == 0)) {
        int val = cal->f[CAL_AM_PM];
        const StrArr *a = count <= 3 ? &S->dp[DP_ABBR] : (count == 4 || count > 5) ? &S->dp[DP_WIDE] : &S->dp[DP_NARROW];
        if (val < a->n) toAppend = a->s[val];
      }
      if (!toAppend) { sub_format(f, out, 'a', count, zone, utcMs, 'b'); return; }
      sb_puts(out, toAppend);
      break;
    }
    case U_FLEXIBLE_DAY_PERIOD: {
      if (!f->hasDpr) { sub_format(f, out, 'a', count, zone, utcMs, 'B'); return; }
      int hour = cal->f[CAL_HOUR_OF_DAY];
      int minute = f->hasMinute ? cal->f[CAL_MINUTE] : 0;
      int second = f->hasSecond ? cal->f[CAL_SECOND] : 0;
      int periodType;
      if (hour == 0 && minute == 0 && second == 0 && f->dpr.hasMidnight) periodType = DPR_MIDNIGHT;
      else if (hour == 12 && minute == 0 && second == 0 && f->dpr.hasNoon) periodType = DPR_NOON;
      else periodType = f->dpr.forHour[hour];
      const char *toAppend = NULL;
      if (periodType != DPR_AM && periodType != DPR_PM && periodType != DPR_MIDNIGHT) {
        const StrArr *a = count <= 3 ? &S->dp[DP_ABBR] : (count == 4 || count > 5) ? &S->dp[DP_WIDE] : &S->dp[DP_NARROW];
        toAppend = periodType < a->n ? a->s[periodType] : NULL;
      }
      if (!toAppend && (periodType == DPR_MIDNIGHT || periodType == DPR_NOON)) {
        periodType = f->dpr.forHour[hour];
        const StrArr *a = count <= 3 ? &S->dp[DP_ABBR] : (count == 4 || count > 5) ? &S->dp[DP_WIDE] : &S->dp[DP_NARROW];
        toAppend = periodType < a->n ? a->s[periodType] : NULL;
      }
      if (periodType == DPR_AM || periodType == DPR_PM || !toAppend) { sub_format(f, out, 'a', count, zone, utcMs, 'B'); return; }
      sb_puts(out, toAppend);
      break;
    }
    default:
      pn(f, idx, out, value, count, 10);
      break;
  }
}

char *scr_dtfmt_format(ScrDtFmt *f, double utcMs, int32_t rawOffsetMs, int32_t dstOffsetMs, const ScrDtZone *zone) {
  f->calFailed = scr_cal_compute(&f->cal, f->calType, utcMs, rawOffsetMs, dstOffsetMs) != 0;
  f->failed = 0;
  Sb out = {0};
  int inQuote = 0;
  char prevCh = 0;
  int count = 0;
  size_t plen = strlen(f->pattern);
  for (size_t i = 0; i < plen && !f->failed; i++) {
    char ch = f->pattern[i];
    if (ch != prevCh && count > 0) { sub_format(f, &out, prevCh, count, zone, utcMs, prevCh); count = 0; }
    if (ch == '\'') {
      if (i + 1 < plen && f->pattern[i + 1] == '\'') { sb_putc(&out, '\''); ++i; }
      else inQuote = !inQuote;
    } else if (!inQuote && scr_dt_is_syntax_char(ch)) {
      prevCh = ch;
      ++count;
    } else sb_putc(&out, ch);
  }
  if (count > 0) sub_format(f, &out, prevCh, count, zone, utcMs, prevCh);
  return sb_take(&out);
}
