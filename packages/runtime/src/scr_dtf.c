/* V8's JSDateTimeFormat (src/objects/js-date-time-format.cc, Node 24.15.0) over scr_dtpg.c and scr_dtfmt.c. */
#include "scr_dtf.h"
#include "scr_dtfmt.h"
#include "scr_dtpg.h"
#include "scr_dtz.h"
#include "scr_locale.h"
#include <math.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* ── byte strings ────────────────────────────────────────────────────────────────────────────────────────── */
typedef struct { char *p; size_t n, cap; } Sb;
static void sb_put(Sb *b, const char *s, size_t n) {
  if (b->n + n + 1 > b->cap) {
    size_t nc = b->cap ? b->cap * 2 : 64;
    while (nc < b->n + n + 1) nc *= 2;
    b->p = (char *)realloc(b->p, nc);
    if (!b->p) abort();
    b->cap = nc;
  }
  memcpy(b->p + b->n, s, n);
  b->n += n;
  b->p[b->n] = 0;
}
static void sb_puts(Sb *b, const char *s) { sb_put(b, s, strlen(s)); }
static void sb_putc(Sb *b, char c) { sb_put(b, &c, 1); }
static char *sb_take(Sb *b) { if (!b->p) { b->p = (char *)malloc(1); b->p[0] = 0; } char *r = b->p; b->p = NULL; b->n = b->cap = 0; return r; }
static char *dups(const char *s) { size_t n = strlen(s); char *r = (char *)malloc(n + 1); memcpy(r, s, n + 1); return r; }

static const char *const kMethod[] = {"Date.prototype.toLocaleString", "Date.prototype.toLocaleDateString", "Date.prototype.toLocaleTimeString", "Intl.DateTimeFormat"};

static void fail(DtfErr *e, int kind, const char *fmt, ...) {
  va_list ap;
  va_start(ap, fmt);
  e->errKind = kind;
  vsnprintf(e->errMsg, sizeof e->errMsg, fmt, ap);
  va_end(ap);
}

/* ── the option bag ──────────────────────────────────────────────────────────────────────────────────────── */
typedef struct { const DtfKV *kv; int n; char tmp[8][64]; int ti; } Bag;

/* the LAST binding wins; NULL when absent or undefined */
static const char *bag_raw(const Bag *b, const char *key) {
  const char *v = NULL;
  for (int i = 0; i < b->n; i++) if (strcmp(b->kv[i].key, key) == 0) v = b->kv[i].val;
  if (!v || v[0] == 'u') return NULL;
  return v;
}
/* ToString of the value: 's' text, 'n' number text, 'b' true/false, 'z' "null" */
static const char *bag_str(Bag *b, const char *key) {
  const char *v = bag_raw(b, key);
  if (!v) return NULL;
  if (v[0] == 'z') return "null";
  return v + 1;
}
static int bag_bool(const Bag *b, const char *key, int *present) {
  const char *v = bag_raw(b, key);
  *present = v != NULL;
  if (!v) return 0;
  switch (v[0]) {
    case 's': return v[1] != 0;
    case 'n': { double d = strtod(v + 1, NULL); return !(d == 0 || d != d); }
    case 'b': return v[1] == 't';
    default: return 0;
  }
}

/* GetOption over a closed set of strings: index+1, 0 when absent; error otherwise */
static int opt_enum(Bag *b, DtfErr *e, int kind, const char *key, const char *const *vals, int nvals) {
  const char *v = bag_str(b, key);
  if (!v) return 0;
  for (int i = 0; i < nvals; i++) if (strcmp(v, vals[i]) == 0) return i + 1;
  fail(e, 1, "Value %.100s out of range for %s options property %s", v, kMethod[kind - 4 < 4 ? kind - 4 : 3], key);
  return 0;
}

static const char *const V_WIDTH3[] = {"narrow", "short", "long"};
static const char *const V_NUM2[] = {"numeric", "2-digit"};
static const char *const V_MONTH[] = {"numeric", "2-digit", "narrow", "short", "long"};
static const char *const V_TZNAME[] = {"short", "long", "shortOffset", "longOffset", "shortGeneric", "longGeneric"};
static const char *const V_STYLE[] = {"full", "long", "medium", "short"};
static const char *const V_HC[] = {"h11", "h12", "h23", "h24"};
static const char *const V_MATCHER[] = {"lookup", "best fit"};
static const char *const V_FMATCHER[] = {"basic", "best fit"};

/* 3*8alphanum *("-" 3*8alphanum) */
static int is_38_alnum_list(const char *s) {
  int ok = *s != 0;
  const char *p = s;
  while (ok && *p) {
    const char *q = p;
    while (*q && *q != '-') { if (!((*q >= 'a' && *q <= 'z') || (*q >= 'A' && *q <= 'Z') || (*q >= '0' && *q <= '9'))) ok = 0; q++; }
    size_t l = (size_t)(q - p);
    if (l < 3 || l > 8) ok = 0;
    if (*q == '-') { q++; if (!*q) ok = 0; }
    p = q;
  }
  return ok;
}
static void lower_inplace(char *s) { for (; *s; s++) if (*s >= 'A' && *s <= 'Z') *s = (char)(*s + 32); }

static int ns_is_numeric(const char *ns) {
  char k[48];
  snprintf(k, sizeof k, "ns/%s", ns);
  ScrCoreVal v = scr_core_get(k);
  return v.p && !(v.n >= 4 && memcmp(v.p, "alg:", 4) == 0);
}

/* ── options ─────────────────────────────────────────────────────────────────────────────────────────────── */
typedef struct {
  int weekday, era, year, month, day, dayPeriod, hour, minute, second, tzName; /* 0 absent, else index+1 into the value lists */
  int fsd;
  int dateStyle, timeStyle; /* 0 none, 1 full .. 4 short */
  int hc;                   /* 0 undefined, 11 12 23 24 */
  int hour12Set, hour12;
  char calendar[40];  /* the option as written (lowercased) or "" */
  char numbering[24];
  int hasCalendar, hasNumbering;
  char skeleton[64];
  int hasHourOption, explicitComponents;
  const char *tzOption;
} Dtf;

static const char *const kWeekday[3] = {"EEEEE", "EEEE", "EEE"}; /* narrow long short */
static const char *const kEra[3] = {"GGGGG", "GGGG", "GGG"};

/* the PatternItem tables: the skeleton letters for an option value */
static const char *skel_weekday(int v) { /* V_WIDTH3 index: narrow, short, long */ return v == 1 ? "EEEEE" : v == 2 ? "EEE" : "EEEE"; }
static const char *skel_era(int v) { return v == 1 ? "GGGGG" : v == 2 ? "GGG" : "GGGG"; }

static int parse_offset_zone(const char *s, int *sec) {
  if (s[0] != '+' && s[0] != '-') return 0;
  int sign = s[0] == '-' ? -1 : 1;
  const char *p = s + 1;
  int h, m = 0;
  if (!(p[0] >= '0' && p[0] <= '9' && p[1] >= '0' && p[1] <= '9')) return 0;
  h = (p[0] - '0') * 10 + (p[1] - '0');
  p += 2;
  if (*p == ':') p++;
  if (*p != '\0') {
    if (!(p[0] >= '0' && p[0] <= '9' && p[1] >= '0' && p[1] <= '9' && p[2] == '\0')) return 0;
    m = (p[0] - '0') * 10 + (p[1] - '0');
  }
  if (h > 23 || m > 59) return 0;
  *sec = sign * (h * 3600 + m * 60);
  return 1;
}

static char *replace_hour_cycle(const char *pattern, int hc) {
  char rep;
  switch (hc) { case 11: rep = 'K'; break; case 12: rep = 'h'; break; case 23: rep = 'H'; break; case 24: rep = 'k'; break; default: return dups(pattern); }
  int replace = 1;
  Sb r = {0};
  char last = 0;
  for (const char *p = pattern; *p; p++) {
    char ch = *p;
    switch (ch) {
      case '\'': replace = !replace; sb_putc(&r, ch); break;
      case 'H': case 'h': case 'K': case 'k':
        if (replace && last == 'd') sb_putc(&r, ' ');
        sb_putc(&r, replace ? rep : ch);
        break;
      default: sb_putc(&r, ch); break;
    }
    last = ch;
  }
  return sb_take(&r);
}

static int hour_cycle_of_pattern(const char *pattern) {
  int inq = 0;
  for (const char *p = pattern; *p; p++) {
    if (*p == '\'') inq = !inq;
    else if (!inq) { if (*p == 'K') return 11; if (*p == 'h') return 12; if (*p == 'H') return 23; if (*p == 'k') return 24; }
  }
  return 0;
}

static char *replace_skeleton(const char *skeleton, int hc) {
  char to = hc == 11 ? 'K' : hc == 12 ? 'h' : hc == 23 ? 'H' : 'k';
  Sb r = {0};
  for (const char *p = skeleton; *p; p++) {
    if (*p == 'a' || *p == 'b' || *p == 'B') continue;
    if (*p == 'h' || *p == 'H' || *p == 'K' || *p == 'k') sb_putc(&r, to);
    else sb_putc(&r, *p);
  }
  return sb_take(&r);
}

/* ── SimpleDateFormat(timeStyle, dateStyle, locale): the pattern of the style pair ──────────────────────────── */
static const char *const kTimeSkeletons[4] = {"jmmsszzzz", "jmmssz", "jmmss", "jmm"};

static int pattern_from_bundle(const ScrRes e, char **pat, char **ovr) {
  *pat = NULL; *ovr = NULL;
  if (scr_res_kind(e) == SCR_RES_STR) { size_t n; const char *s = scr_res_str(e, &n); *pat = (char *)malloc(n + 1); memcpy(*pat, s, n); (*pat)[n] = 0; return 1; }
  if (scr_res_kind(e) == SCR_RES_ARRAY) {
    size_t n; const char *s = scr_res_str(scr_res_array_at(e, 0), &n);
    if (!s) return 0;
    *pat = (char *)malloc(n + 1); memcpy(*pat, s, n); (*pat)[n] = 0;
    const char *o = scr_res_str(scr_res_array_at(e, 1), &n);
    if (o) { *ovr = (char *)malloc(n + 1); memcpy(*ovr, o, n); (*ovr)[n] = 0; }
    return 1;
  }
  return 0;
}

/* returns 1 and fills pattern / overrides; timeStyle/dateStyle 0 = none else 1..4 */
static int style_pattern(const DtLoc *loc, int calType, int dateStyle, int timeStyle, char **pattern, char **dateOvr, char **timeOvr) {
  *pattern = NULL; *dateOvr = NULL; *timeOvr = NULL;
  const char *cType = scr_cal_type_name(calType);
  ScrRes pats = {NULL, 0};
  int cIsGreg = strcmp(cType, "gregorian") == 0;
  char path[128];
  int have = 0;
  if (!cIsGreg) {
    snprintf(path, sizeof path, "calendar/%s/DateTimePatterns", cType);
    have = scr_ures_get(&loc->uloc, SCR_URES_LOC, path, &pats);
  }
  if (!have) have = scr_ures_get(&loc->uloc, SCR_URES_LOC, "calendar/gregorian/DateTimePatterns", &pats);
  if (!have || scr_res_array_len(pats) <= 8) return 0;
  char *timePattern = NULL;
  if (timeStyle) {
    int hasRgOrHc = loc->hours[0] != 0;
    if (strcmp(loc->base, "und") != 0) {
      /* the valid locale: the bundle the pattern array came from for the requested name */
      char validName[96] = "";
      size_t vn;
      const char *vs = scr_ures_locale_name(loc->uloc.start[SCR_URES_LOC], &vn);
      snprintf(validName, sizeof validName, "%.*s", (int)vn, vs);
      if (hasRgOrHc || strcmp(validName, loc->base) != 0) {
        int useDTPG = hasRgOrHc;
        /* validLoc: language / country of the bundle */
        char vLang[12] = "", vReg[8] = "";
        {
          char tmp[96];
          snprintf(tmp, sizeof tmp, "%s", validName);
          char *tok = strtok(tmp, "_");
          int idx = 0;
          while (tok) {
            size_t tl = strlen(tok);
            if (idx == 0) snprintf(vLang, sizeof vLang, "%s", tok);
            else if (tl == 2 || (tl == 3 && tok[0] >= '0' && tok[0] <= '9')) snprintf(vReg, sizeof vReg, "%s", tok);
            tok = strtok(NULL, "_");
            idx++;
          }
        }
        if ((loc->region[0] && strncmp(loc->region, vReg, 3) != 0) || strncmp(loc->lang, vLang, 3) != 0) useDTPG = 1;
        if (useDTPG) {
          ScrDtpg *g = scr_dtpg_new(loc, 1);
          if (g) { timePattern = scr_dtpg_best(g, kTimeSkeletons[timeStyle - 1], 0); scr_dtpg_free(g); }
        }
      }
    }
  }
  /* DateTimePatterns: time styles at 0..3, date styles at 4..7, date-time glue at 8 (kDateTime) or 9.. */
  char *tp = NULL, *dp = NULL;
  if (timeStyle && !timePattern) {
    if (!pattern_from_bundle(scr_res_array_at(pats, timeStyle - 1), &tp, timeOvr)) return 0;
  } else if (timeStyle) tp = timePattern;
  if (dateStyle) {
    if (!pattern_from_bundle(scr_res_array_at(pats, 4 + dateStyle - 1), &dp, dateOvr)) { free(tp); return 0; }
  }
  if (timeStyle && dateStyle) {
    ScrRes at = {NULL, 0};
    int haveAt = 0;
    if (!cIsGreg) { snprintf(path, sizeof path, "calendar/%s/DateTimePatterns%%atTime", cType); haveAt = scr_ures_get(&loc->uloc, SCR_URES_LOC, path, &at); }
    if (!haveAt) haveAt = scr_ures_get(&loc->uloc, SCR_URES_LOC, "calendar/gregorian/DateTimePatterns%atTime", &at);
    const char *glue = NULL; size_t gn = 0;
    if (haveAt && scr_res_array_len(at) >= 4) glue = scr_res_str(scr_res_array_at(at, dateStyle - 1), &gn);
    else {
      int glueIndex = 8;
      if (scr_res_array_len(pats) >= 9 + 3 + 1) glueIndex = 9 + (dateStyle - 1);
      glue = scr_res_str(scr_res_array_at(pats, glueIndex), &gn);
    }
    char *g2 = (char *)malloc(gn + 1);
    if (glue) memcpy(g2, glue, gn);
    g2[glue ? gn : 0] = 0;
    /* SimpleFormatter({1}, {0}): {0} time, {1} date */
    Sb r = {0};
    for (const char *p = g2; *p;) {
      if (*p == '\'' && p[1] == '\'') { sb_putc(&r, '\''); p += 2; continue; }
      if (*p == '{' && (p[1] == '0' || p[1] == '1') && p[2] == '}') { sb_puts(&r, p[1] == '0' ? tp : dp); p += 3; continue; }
      sb_putc(&r, *p++);
    }
    free(g2);
    *pattern = sb_take(&r);
    free(tp); free(dp);
  } else if (timeStyle) { *pattern = tp; free(dp); *dateOvr = *timeOvr; *timeOvr = NULL; } /* SimpleDateFormat keeps a time-only override in fDateOverride */
  else { *pattern = dp; free(tp); }
  return 1;
}

/* V8's DateFormatCache: at most 9 SimpleDateFormats keyed by "skeleton:locale name" (the hour cycle is NOT part of the
 * key, so the first creator of a key wins for the whole process; the whole cache is dropped when a tenth is needed). */
typedef struct { char *key, *pattern; } CacheEnt;
static CacheEnt gFmtCache[10];
static int gFmtCacheN;
static const char *fmt_cache_get(const char *key) {
  for (int i = 0; i < gFmtCacheN; i++) if (!strcmp(gFmtCache[i].key, key)) return gFmtCache[i].pattern;
  return NULL;
}
static void fmt_cache_put(const char *key, const char *pattern) {
  if (gFmtCacheN > 8) {
    for (int i = 0; i < gFmtCacheN; i++) { free(gFmtCache[i].key); free(gFmtCache[i].pattern); }
    gFmtCacheN = 0;
  }
  gFmtCache[gFmtCacheN].key = dups(key);
  gFmtCache[gFmtCacheN].pattern = dups(pattern);
  gFmtCacheN++;
}
/* icu::Locale::getName(): the base name and the keywords in alphabetical order */
static void icu_locale_name(const DtLoc *l, char *out, size_t cap) {
  size_t o = (size_t)snprintf(out, cap, "%s", l->base);
  const char *sep = "@";
  if (l->calendar[0]) { o += (size_t)snprintf(out + o, cap - o, "%scalendar=%s", sep, l->calendar); sep = ";"; }
  if (l->hours[0]) { o += (size_t)snprintf(out + o, cap - o, "%shours=%s", sep, l->hours); sep = ";"; }
  if (l->numbering[0]) { o += (size_t)snprintf(out + o, cap - o, "%snumbers=%s", sep, l->numbering); }
}
/* CreateICUDateFormatFromCache: the pattern for (skeleton, hc) in `loc`, through the cache */
static char *pattern_from_cache(ScrDtpg *gen, const DtLoc *loc, const char *skeleton, int hc) {
  char name[200], key[320];
  icu_locale_name(loc, name, sizeof name);
  snprintf(key, sizeof key, "%s:%s", skeleton, name);
  const char *hit = fmt_cache_get(key);
  if (hit) return dups(hit);
  char *best = scr_dtpg_best(gen, skeleton, DTPG_MATCH_HOUR);
  if (!best) return NULL;
  char *p = replace_hour_cycle(best, hc);
  free(best);
  fmt_cache_put(key, p);
  return p;
}

/* ── the formatter object ────────────────────────────────────────────────────────────────────────────────── */
typedef struct {
  DtLoc loc;
  ScrDtpg *gen;
  int hcDefault;
} Ctx;

static int hc_default12(const DtLoc *loc, int d) { if (d == 11 || d == 12) return d; return strcmp(loc->region, "JP") == 0 ? 11 : 12; }
static int hc_default24(int d) { if (d == 23 || d == 24) return d; return 23; }

static int hc_of_str(const char *s) { return !strcmp(s, "h11") ? 11 : !strcmp(s, "h12") ? 12 : !strcmp(s, "h23") ? 23 : !strcmp(s, "h24") ? 24 : 0; }

/* canonical BCP 47 spelling of a calendar type value, or NULL when ICU has no such calendar */
static const char *calendar_bcp(const char *v) {
  const char *legacy = scr_dt_calendar_legacy(v);
  return legacy ? scr_dt_calendar_bcp47(legacy) : NULL;
}

char *scr_dtf_format(const char *locales, const DtfKV *kv, int nkv, int kind, double ms, DtfErr *err) {
  err->errKind = 0;
  Bag bag = {kv, nkv, {{0}}, 0};
  Dtf o;
  memset(&o, 0, sizeof o);
  int mk = kind < 4 ? 4 : kind;
  /* 1. locales */
  ScrLocRes lr;
  if (scr_locale_resolve(SCR_LOC_DTF, locales, &lr) != 0) { fail(err, 1, "Incorrect locale information provided"); return NULL; }
  /* 3. localeMatcher */
  opt_enum(&bag, err, mk, "localeMatcher", V_MATCHER, 2);
  if (err->errKind) return NULL;
  /* 6. calendar (well-formedness only) */
  {
    const char *cv = bag_str(&bag, "calendar");
    if (cv) {
      if (!is_38_alnum_list(cv)) { fail(err, 1, "Invalid calendar : %s", cv); return NULL; }
      snprintf(o.calendar, sizeof o.calendar, "%s", cv);
      lower_inplace(o.calendar);
      o.hasCalendar = 1;
    }
  }
  {
    const char *nv = bag_str(&bag, "numberingSystem");
    if (nv) {
      if (!is_38_alnum_list(nv)) { fail(err, 1, "Invalid numberingSystem : %s", nv); return NULL; }
      snprintf(o.numbering, sizeof o.numbering, "%s", nv);
      lower_inplace(o.numbering);
      o.hasNumbering = 1;
    }
  }
  o.hour12 = bag_bool(&bag, "hour12", &o.hour12Set);
  int hcOpt = opt_enum(&bag, err, mk, "hourCycle", V_HC, 4);
  if (err->errKind) return NULL;
  int hourCycle = hcOpt ? hc_of_str(V_HC[hcOpt - 1]) : 0;
  if (o.hour12Set) hourCycle = 0;

  /* ResolveLocale: validate the extensions the tag carried */
  char extCa[40] = "", extNu[24] = "", extHc[8] = "";
  if (lr.ca[0] && calendar_bcp(lr.ca)) snprintf(extCa, sizeof extCa, "%s", calendar_bcp(lr.ca));
  if (lr.nu[0] && ns_is_numeric(lr.nu)) snprintf(extNu, sizeof extNu, "%s", lr.nu);
  if (lr.hc[0] && hc_of_str(lr.hc)) snprintf(extHc, sizeof extHc, "%s", lr.hc);
  DtLoc loc;
  scr_dtloc_init(&loc, lr.tag, extCa, extNu, extHc);
  /* option overrides */
  if (o.hasCalendar && extCa[0] && strcmp(extCa, o.calendar) != 0) loc.calendar[0] = 0;
  if (o.hasNumbering && extNu[0] && strcmp(extNu, o.numbering) != 0) loc.numbering[0] = 0;
  if (o.hasCalendar && calendar_bcp(o.calendar)) snprintf(loc.calendar, sizeof loc.calendar, "%s", scr_dt_calendar_legacy(o.calendar));
  if (o.hasNumbering && ns_is_numeric(o.numbering)) snprintf(loc.numbering, sizeof loc.numbering, "%s", o.numbering);

  ScrDtpg *gen = scr_dtpg_new(&loc, 0);
  if (!gen) { fail(err, 1, "Internal error. Icu error."); return NULL; }
  int hcDefault = scr_dtpg_default_hour_cycle(gen);
  int hc = 0;
  if (!hourCycle) { if (extHc[0]) hc = hc_of_str(extHc); } else hc = hourCycle;
  if (o.hour12Set) hc = o.hour12 ? hc_default12(&loc, hcDefault) : hc_default24(hcDefault);
  else if (!hc) hc = hcDefault;

  /* 17. timeZone */
  const char *tzv = bag_str(&bag, "timeZone");
  DtfZone zone;
  if (dtz_create(&zone, tzv) != 0) { fail(err, 1, "Invalid time zone specified: %s", tzv); scr_dtpg_free(gen); return NULL; }

  zone.loc = &loc;
  /* the calendar */
  char ctBuf[40];
  scr_dtloc_calendar_type(&loc, ctBuf, sizeof ctBuf);
  int calType = scr_cal_type_from_name(ctBuf);
  if (calType < 0) calType = CT_GREGORIAN;

  /* fields */
  Sb skel = {0};
  int hasHourOption = 0, explicitComponents = 0;
  static const struct { const char *prop; int kind; } order[] = {
    {"weekday", 0}, {"era", 1}, {"year", 2}, {"month", 3}, {"day", 4}, {"dayPeriod", 5}, {"hour", 6}, {"minute", 7}, {"second", 8}, {"timeZoneName", 9}};
  static const char *const hourLetters2[4] = {"KK", "hh", "HH", "kk"}; /* h11 h12 h23 h24 */
  static const char *const hourLetters1[4] = {"K", "h", "H", "k"};
  int hci = hc == 11 ? 0 : hc == 12 ? 1 : hc == 23 ? 2 : 3;
  for (size_t i = 0; i < sizeof order / sizeof *order; i++) {
    const char *prop = order[i].prop;
    if (order[i].kind == 9) {
      /* fractionalSecondDigits is read before timeZoneName */
      const char *fv = bag_raw(&bag, "fractionalSecondDigits");
      if (fv) {
        double d;
        switch (fv[0]) {
          case 's': { char *end; const char *t = fv + 1; while (*t == ' ' || *t == '\t' || *t == '\n') t++; d = *t ? strtod(t, &end) : 0.0; if (*t && *end && *end != ' ') d = NAN; break; }
          case 'n': d = strtod(fv + 1, NULL); break;
          case 'b': d = fv[1] == 't' ? 1 : 0; break;
          default: d = 0; break;
        }
        if (d != d || d < 1 || d > 3) { fail(err, 1, "fractionalSecondDigits value is out of range."); sb_puts(&skel, ""); scr_dtpg_free(gen); free(skel.p); return NULL; }
        o.fsd = (int)floor(d);
        explicitComponents = 1;
        for (int k = 0; k < o.fsd; k++) sb_putc(&skel, 'S');
      }
    }
    int v = 0;
    switch (order[i].kind) {
      case 0: v = opt_enum(&bag, err, mk, prop, V_WIDTH3, 3); break;
      case 1: v = opt_enum(&bag, err, mk, prop, V_WIDTH3, 3); break;
      case 2: v = opt_enum(&bag, err, mk, prop, V_NUM2, 2); break;
      case 3: v = opt_enum(&bag, err, mk, prop, V_MONTH, 5); break;
      case 4: v = opt_enum(&bag, err, mk, prop, V_NUM2, 2); break;
      case 5: v = opt_enum(&bag, err, mk, prop, V_WIDTH3, 3); break;
      case 6: case 7: case 8: v = opt_enum(&bag, err, mk, prop, V_NUM2, 2); break;
      case 9: v = opt_enum(&bag, err, mk, prop, V_TZNAME, 6); break;
    }
    if (err->errKind) { scr_dtpg_free(gen); free(skel.p); return NULL; }
    if (!v) continue;
    explicitComponents = 1;
    switch (order[i].kind) {
      case 0: o.weekday = v; sb_puts(&skel, skel_weekday(v)); break;
      case 1: o.era = v; sb_puts(&skel, skel_era(v)); break;
      case 2: o.year = v; sb_puts(&skel, v == 2 ? "yy" : "y"); break;
      case 3: o.month = v; sb_puts(&skel, v == 1 ? "M" : v == 2 ? "MM" : v == 3 ? "MMMMM" : v == 4 ? "MMM" : "MMMM"); break;
      case 4: o.day = v; sb_puts(&skel, v == 2 ? "dd" : "d"); break;
      case 5: o.dayPeriod = v; sb_puts(&skel, v == 1 ? "BBBBB" : v == 2 ? "B" : "BBBB"); break;
      case 6: o.hour = v; hasHourOption = 1; sb_puts(&skel, v == 2 ? hourLetters2[hci] : hourLetters1[hci]); break;
      case 7: o.minute = v; sb_puts(&skel, v == 2 ? "mm" : "m"); break;
      case 8: o.second = v; sb_puts(&skel, v == 2 ? "ss" : "s"); break;
      case 9: o.tzName = v; sb_puts(&skel, v == 1 ? "z" : v == 2 ? "zzzz" : v == 3 ? "O" : v == 4 ? "OOOO" : v == 5 ? "v" : "vvvv"); break;
    }
  }
  opt_enum(&bag, err, mk, "formatMatcher", V_FMATCHER, 2);
  if (err->errKind) { scr_dtpg_free(gen); free(skel.p); return NULL; }
  o.dateStyle = opt_enum(&bag, err, mk, "dateStyle", V_STYLE, 4);
  if (err->errKind) { scr_dtpg_free(gen); free(skel.p); return NULL; }
  o.timeStyle = opt_enum(&bag, err, mk, "timeStyle", V_STYLE, 4);
  if (err->errKind) { scr_dtpg_free(gen); free(skel.p); return NULL; }

  int required = mk == 5 ? 5 : mk == 6 ? 6 : 4; /* 4 any, 5 date, 6 time */
  int defaults = mk == 4 ? 4 : mk == 5 ? 5 : mk == 6 ? 6 : 5; /* all, date, time, DateTimeFormat: date */
  (void)defaults;
  int dtfHc = 0;
  if (o.timeStyle) dtfHc = hc;
  char *pattern = NULL, *dateOvr = NULL, *timeOvr = NULL;
  int styled = o.dateStyle || o.timeStyle;
  if (styled) {
    if (explicitComponents) { fail(err, 2, "Invalid option : option"); scr_dtpg_free(gen); free(skel.p); return NULL; }
    if (required == 5 && o.timeStyle) { fail(err, 2, "Invalid option : timeStyle"); scr_dtpg_free(gen); free(skel.p); return NULL; }
    if (required == 6 && o.dateStyle) { fail(err, 2, "Invalid option : dateStyle"); scr_dtpg_free(gen); free(skel.p); return NULL; }
    if (!style_pattern(&loc, calType, o.dateStyle, o.timeStyle, &pattern, &dateOvr, &timeOvr)) { fail(err, 1, "Internal error. Icu error."); scr_dtpg_free(gen); free(skel.p); return NULL; }
    if (o.dateStyle && !o.timeStyle) {
      /* a date-only style needs no hour cycle work */
    } else {
      char *sk = scr_dtpg_static_skeleton(pattern);
      if (dtfHc != hour_cycle_of_pattern(pattern)) {
        char *s2 = replace_skeleton(sk, dtfHc);
        free(pattern);
        pattern = pattern_from_cache(gen, &loc, s2, dtfHc);
        free(s2);
      }
      free(sk);
    }
  } else {
    int needDefaults = 1;
    if (required == 5 || required == 4) { if (o.weekday || o.year || o.month || o.day) needDefaults = 0; }
    if (required == 6 || required == 4) { if (o.dayPeriod || o.hour || o.minute || o.second || o.fsd) needDefaults = 0; }
    int dateDefaults = mk == 4 || mk == 5 || mk == 7;
    int timeDefaults = mk == 4 || mk == 6;
    if (kind == 7) { required = 4; }
    if (needDefaults && dateDefaults) sb_puts(&skel, "yMd");
    if (needDefaults && timeDefaults) {
      switch (hc) { case 12: sb_puts(&skel, "hms"); break; case 23: case 0: sb_puts(&skel, "Hms"); break; case 11: sb_puts(&skel, "Kms"); break; case 24: sb_puts(&skel, "kms"); break; }
    }
    dtfHc = hasHourOption ? hc : 0;
    pattern = pattern_from_cache(gen, &loc, skel.p ? skel.p : "", dtfHc);
  }
  free(skel.p);
  if (!pattern) { fail(err, 1, "Internal error. Icu error."); scr_dtpg_free(gen); return NULL; }

  ScrDtFmt *fmt = scr_dtfmt_new(&loc, pattern, calType, dateOvr, timeOvr);
  free(pattern); free(dateOvr); free(timeOvr);
  scr_dtpg_free(gen);
  if (!fmt) { fail(err, 1, "Internal error. Icu error."); return NULL; }
  int32_t raw = 0, dst = 0;
  dtz_offsets(&zone, ms, &raw, &dst);
  ScrDtZone zf = {&zone, dtz_format_cb};
  char *res = scr_dtfmt_format(fmt, ms, raw, dst, &zf);
  scr_dtfmt_free(fmt);
  dtz_free(&zone);
  if (!res) { fail(err, 1, "Invalid time value"); return NULL; }
  /* V8 reverts ICU 72's U+202F before AM/PM to a plain space */
  {
    Sb out = {0};
    for (const char *p = res; *p;) {
      if ((unsigned char)p[0] == 0xE2 && (unsigned char)p[1] == 0x80 && (unsigned char)p[2] == 0xAF) { sb_putc(&out, ' '); p += 3; }
      else sb_putc(&out, *p++);
    }
    free(res);
    res = sb_take(&out);
  }
  return res;
}
