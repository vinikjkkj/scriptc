/* scr_date_intl.c -- Date.prototype.toLocaleString / toLocaleDateString / toLocaleTimeString with
 * a locale and options, for the en-US locale.
 *
 * WHAT IT IS. Node answers these from ICU's DateTimePatternGenerator. This file does not reimplement
 * that generator: scripts/gen-date-intl.mjs asks Node for the pattern of EVERY option vector (13
 * million) and stores them factored as pattern(d, t) = D[d] + glue + T[t] with zero exceptions (the
 * generator checks every vector before it writes). What remains here is mechanical: the options
 * object (read and validated in V8's order, with V8's error messages), the vector, the pattern
 * assembled from the tables, and the pattern rendered over the instant's local civil fields. The
 * zone is the `timeZone` option or the host zone (scr_date_tz.c); its names per instant come from
 * the generated metazone-history sequences (scr_date_tznames.c).
 *
 * Pattern bytes (the generator's CODE table): 0x01.. are fields, everything else a literal byte.
 * The STYLE a code leaves to the vector (day-period width, fraction digits, zone style) is read from
 * the vector, so one pattern serves all its values; the hour letter is in the pattern, as mined.
 *
 * Locales: "en-US" and "en" (and an absent locale). The compiler refuses every other locale at
 * build time, and a non-literal one too; a locale that reaches this function any other way (a
 * checked-dynamic call) throws a catchable RangeError naming it. */
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "scr_runtime.h"
#include "scr_date_zones.h"

/* the generated tables (scr_date_intl_en.c) */
extern const uint8_t scr_di_pool[];
extern const uint16_t scr_di_d[];
extern const uint8_t scr_di_glue[];
extern const uint16_t scr_di_spaceglue[];
extern const int scr_di_nspaceglue;
extern const uint16_t scr_di_tedges[];
extern const uint16_t scr_di_troot;
extern const uint16_t scr_di_style[];

enum { C_WD_N = 1, C_WD_S, C_WD_L, C_ERA_N, C_ERA_S, C_ERA_L, C_Y, C_YY, C_M, C_MM, C_MMM, C_MMMM, C_MMMMM,
       C_D, C_DD, C_AMPM, C_B, C_H, C_HH, C_MIN, C_MIN2, C_S, C_SS, C_FS, C_TZ,
       /* the hour letter is mined per pattern (the generator's hourLetter): h = 1..12, K = 0..11, H = 0..23, k = 1..24 */
       C_K, C_KK, C_H23, C_HH23, C_H24, C_HH24 };

/* option values, as the generator's vector digits (0 = absent) */
typedef struct {
  int weekday, era, year, month, day, dayPeriod, hour, minute, second, fsd, tzName;
  int hc;                    /* 0 unset, 1 h11, 2 h12, 3 h23, 4 h24 */
  int dateStyle, timeStyle;  /* 0 none, 1 full, 2 long, 3 medium, 4 short */
  const scr_tz *tz;          /* NULL: the host zone */
  int tzOffsetSec;           /* when tz is an offset zone ("+05:30") */
  int tzIsOffset;
} Dtf;

static const char *const kMethod[] = {"Date.prototype.toLocaleString", "Date.prototype.toLocaleDateString",
                                      "Date.prototype.toLocaleTimeString"};

static void throw_msg(int kind, const char *msg) { scr_throw_error_msg(kind, msg, strlen(msg)); }

/* ── the option bag: key/value strings; "\x01" is undefined ───────────────────────────── */
typedef struct { const char *key; const char *val; } KV;
#define MAXKV 64

static const char *kv_get(const KV *kv, int n, const char *key) {
  const char *v = NULL;
  for (int i = 0; i < n; i++)
    if (strcmp(kv[i].key, key) == 0) v = kv[i].val; /* the later duplicate wins, as an object literal's does */
  if (v != NULL && v[0] == '\x01' && v[1] == '\0') return NULL;
  return v;
}

/* GetOption over a closed set of strings: index+1, 0 when absent; RangeError (and *err) otherwise. */
static int opt_enum(const KV *kv, int n, int kind, const char *key, const char *const *vals, int nvals, int *err) {
  const char *v = kv_get(kv, n, key);
  if (v == NULL) return 0;
  for (int i = 0; i < nvals; i++)
    if (strcmp(v, vals[i]) == 0) return i + 1;
  char msg[400];
  snprintf(msg, sizeof msg, "Value %.100s out of range for %s options property %s", v, kMethod[kind - 4], key);
  throw_msg(SCR_ERR_RANGE, msg);
  *err = 1;
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

/* Is `s` a valid offset time zone ("+05:30", "+0530", "+05")? Sets *sec. */
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

/* Reads and validates the whole bag in V8's order (hour12, hourCycle, timeZone, the fields, the
 * styles) and applies ToDateTimeOptions' defaults for `kind` (4 any/all, 5 date/date, 6 time/time).
 * Returns 0, or 1 with a pending exception. */
static int dtf_parse(Dtf *o, const KV *kv, int n, int kind) {
  int err = 0;
  memset(o, 0, sizeof *o);
  /* localeMatcher, calendar, numberingSystem: validated, no effect on en-US/gregory/latn */
  opt_enum(kv, n, kind, "localeMatcher", V_MATCHER, 2, &err);
  if (err) return 1;
  {
    const char *cal = kv_get(kv, n, "calendar");
    if (cal != NULL && strcmp(cal, "gregory") != 0) {
      char msg[200];
      snprintf(msg, sizeof msg, "calendar \"%.60s\" is not supported (only \"gregory\")", cal);
      throw_msg(SCR_ERR_RANGE, msg);
      return 1;
    }
    const char *ns = kv_get(kv, n, "numberingSystem");
    if (ns != NULL && strcmp(ns, "latn") != 0) {
      char msg[200];
      snprintf(msg, sizeof msg, "numberingSystem \"%.60s\" is not supported (only \"latn\")", ns);
      throw_msg(SCR_ERR_RANGE, msg);
      return 1;
    }
  }
  const char *h12 = kv_get(kv, n, "hour12");
  int hour12 = h12 == NULL ? -1 : strcmp(h12, "true") == 0 ? 1 : 0;
  int hc = opt_enum(kv, n, kind, "hourCycle", V_HC, 4, &err);
  if (err) return 1;
  if (hour12 >= 0) hc = hour12 ? 2 : 3; /* en-US: hour12 true is h12, false is h23 */
  o->hc = hc;
  const char *tzs = kv_get(kv, n, "timeZone");
  if (tzs != NULL) {
    int sec;
    const scr_tz *z = scr_tz_find(tzs, strlen(tzs), 1);
    if (z != NULL) o->tz = z;
    else if (parse_offset_zone(tzs, &sec)) { o->tzIsOffset = 1; o->tzOffsetSec = sec; }
    else {
      char msg[300];
      snprintf(msg, sizeof msg, "Invalid time zone specified: %.200s", tzs);
      throw_msg(SCR_ERR_RANGE, msg);
      return 1;
    }
  }
  o->weekday = opt_enum(kv, n, kind, "weekday", V_WIDTH3, 3, &err); if (err) return 1;
  o->era = opt_enum(kv, n, kind, "era", V_WIDTH3, 3, &err); if (err) return 1;
  o->year = opt_enum(kv, n, kind, "year", V_NUM2, 2, &err); if (err) return 1;
  o->month = opt_enum(kv, n, kind, "month", V_MONTH, 5, &err); if (err) return 1;
  o->day = opt_enum(kv, n, kind, "day", V_NUM2, 2, &err); if (err) return 1;
  o->dayPeriod = opt_enum(kv, n, kind, "dayPeriod", V_WIDTH3, 3, &err); if (err) return 1;
  o->hour = opt_enum(kv, n, kind, "hour", V_NUM2, 2, &err); if (err) return 1;
  o->minute = opt_enum(kv, n, kind, "minute", V_NUM2, 2, &err); if (err) return 1;
  o->second = opt_enum(kv, n, kind, "second", V_NUM2, 2, &err); if (err) return 1;
  {
    const char *f = kv_get(kv, n, "fractionalSecondDigits");
    if (f != NULL) {
      char *end;
      double d = strtod(f, &end);
      if (end == f || d != d || d < 1 || d > 3) {
        throw_msg(SCR_ERR_RANGE, "fractionalSecondDigits value is out of range.");
        return 1;
      }
      o->fsd = (int)floor(d);
    }
  }
  o->tzName = opt_enum(kv, n, kind, "timeZoneName", V_TZNAME, 6, &err); if (err) return 1;
  opt_enum(kv, n, kind, "formatMatcher", V_FMATCHER, 2, &err); if (err) return 1;
  o->dateStyle = opt_enum(kv, n, kind, "dateStyle", V_STYLE, 4, &err); if (err) return 1;
  o->timeStyle = opt_enum(kv, n, kind, "timeStyle", V_STYLE, 4, &err); if (err) return 1;
  if (o->dateStyle || o->timeStyle) {
    if (o->weekday || o->era || o->year || o->month || o->day || o->dayPeriod || o->hour || o->minute ||
        o->second || o->fsd || o->tzName) {
      throw_msg(SCR_ERR_TYPE, "Invalid option : option");
      return 1;
    }
    if (kind == 5 && o->timeStyle) { throw_msg(SCR_ERR_TYPE, "Invalid option : timeStyle"); return 1; }
    if (kind == 6 && o->dateStyle) { throw_msg(SCR_ERR_TYPE, "Invalid option : dateStyle"); return 1; }
    return 0;
  }
  /* ToDateTimeOptions: needDefaults unless a field of the required kind is present */
  int need = 1;
  if ((kind == 4 || kind == 5) && (o->weekday || o->year || o->month || o->day)) need = 0;
  if ((kind == 4 || kind == 6) && (o->dayPeriod || o->hour || o->minute || o->second || o->fsd)) need = 0;
  if (need && (kind == 4 || kind == 5)) { o->year = 1; o->month = 1; o->day = 1; }
  if (need && (kind == 4 || kind == 6)) {
    o->hour = 1; o->minute = 1; o->second = 1;
    /* An hour that came from the DEFAULTS, not from the caller, resolves through the locale's allowed hour formats
     * ('j'): V8 applies hourCycle only to an hour the caller named, so h11 reads as h12 and h24 as h23 here
     * (measured: toLocaleString("en-US", { hourCycle: "h11" }) prints 12:05 PM at noon, h24 prints 00:05 at midnight). */
    if (o->hc == 1) o->hc = 2;
    else if (o->hc == 4) o->hc = 3;
  }
  return 0;
}

/* ── the pattern: D + glue + T ───────────────────────────────────────────────────────── */
static const uint8_t *pat_at(uint16_t off) { return scr_di_pool + off; }

static int vec_t_digit(const Dtf *o, int dim) {
  switch (dim) {
    case 0: return o->dayPeriod;
    case 1: return o->hour;
    case 2: return o->minute;
    case 3: return o->second;
    case 4: return o->fsd;
    case 5: return o->tzName;
    default: return o->hc;
  }
}

/* Writes the pattern into out (cap bytes) and returns its length, or -1 when the vector is unreachable. */
static int pattern_of(const Dtf *o, uint8_t *out, size_t cap, int *tzStyleOut) {
  *tzStyleOut = o->tzName;
  if (o->dateStyle || o->timeStyle) {
    int idx = o->dateStyle * 25 + o->timeStyle * 5 + o->hc;
    uint16_t off = scr_di_style[idx];
    if (off == 0xffff) return -1;
    /* the zone token's style comes from the time style: full is long ("zzzz"), long is short ("z") */
    *tzStyleOut = o->timeStyle == 1 ? 2 : o->timeStyle == 2 ? 1 : 0;
    size_t n = strlen((const char *)pat_at(off));
    if (n >= cap) return -1;
    memcpy(out, pat_at(off), n);
    return (int)n;
  }
  int di = (((o->weekday * 4 + o->era) * 3 + o->year) * 6 + o->month) * 3 + o->day;
  int hasTime = o->dayPeriod || o->hour || o->minute || o->second || o->fsd;
  size_t n = 0;
  const uint8_t *dp = NULL, *tp = NULL;
  if (di != 0) {
    uint16_t doff = scr_di_d[di];
    if (doff == 0xffff) return -1;
    dp = pat_at(doff);
  }
  if (hasTime) {
    uint16_t v = scr_di_troot;
    while (!(v & 0x8000) && v != 0xffff) {
      int dim = scr_di_tedges[v];
      v = scr_di_tedges[v + 1 + vec_t_digit(o, dim)];
    }
    if (v == 0xffff) return -1;
    tp = pat_at(v & 0x7fff);
  } else if (o->tzName) {
    static const uint8_t tzonly[2] = {C_TZ, 0};
    tp = tzonly;
  }
  if (dp != NULL) {
    size_t l = strlen((const char *)dp);
    if (l >= cap) return -1;
    memcpy(out, dp, l);
    n = l;
  }
  if (dp != NULL && tp != NULL) {
    const char *g;
    if (!o->weekday || o->era || o->year || o->month || o->day) {
      g = scr_di_glue[di] == 1 ? " at " : ", ";
    } else {
      /* a weekday-only date half: a plain space after the time patterns that form one ("Tue 5:06 AM") */
      uint16_t toff = (uint16_t)(tp - scr_di_pool);
      g = ", ";
      for (int i = 0; i < scr_di_nspaceglue; i++)
        if (scr_di_spaceglue[i] == toff) { g = " "; break; }
    }
    size_t gl = strlen(g);
    if (n + gl >= cap) return -1;
    memcpy(out + n, g, gl);
    n += gl;
  }
  if (tp != NULL) {
    size_t l = strlen((const char *)tp);
    if (n + l >= cap) return -1;
    memcpy(out + n, tp, l);
    n += l;
  }
  return (int)n;
}

/* ── the instant's civil fields ──────────────────────────────────────────────────────── */
typedef struct { long long y; int mo, d, h, mi, s, ms, wd; } Civil;

static void civil_of(long long local_sec, int ms, Civil *c) {
  long long days = local_sec / 86400, sod = local_sec % 86400;
  if (sod < 0) { sod += 86400; days--; }
  long long z = days + 719468;
  long long era = (z >= 0 ? z : z - 146096) / 146097;
  long long doe = z - era * 146097;
  long long yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
  long long yy = yoe + era * 400;
  long long doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  long long mp = (5 * doy + 2) / 153;
  c->d = (int)(doy - (153 * mp + 2) / 5 + 1);
  c->mo = (int)(mp < 10 ? mp + 3 : mp - 9);
  c->y = yy + (c->mo <= 2);
  c->h = (int)(sod / 3600);
  c->mi = (int)(sod / 60 % 60);
  c->s = (int)(sod % 60);
  c->ms = ms;
  c->wd = (int)(((days + 4) % 7 + 7) % 7);
}

static const char *const kMonthL[] = {"January", "February", "March", "April", "May", "June", "July", "August",
                                      "September", "October", "November", "December"};
static const char *const kMonthS[] = {"Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"};
static const char kMonthN[] = "JFMAMJJASOND";
static const char *const kWdL[] = {"Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"};
static const char *const kWdS[] = {"Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"};
static const char kWdN[] = "SMTWTFS";

/* ── zone names ──────────────────────────────────────────────────────────────────────── */
static void gmt_name(char *buf, size_t cap, int off, int is_long) {
  char sign = off < 0 ? '-' : '+';
  int a = off < 0 ? -off : off, h = a / 3600, m = a / 60 % 60, s = a % 60;
  if (is_long) {
    if (s) snprintf(buf, cap, "GMT%c%02d:%02d:%02d", sign, h, m, s);
    else snprintf(buf, cap, "GMT%c%02d:%02d", sign, h, m);
  } else {
    if (s) snprintf(buf, cap, "GMT%c%d:%02d:%02d", sign, h, m, s);
    else if (m) snprintf(buf, cap, "GMT%c%d:%02d", sign, h, m);
    else snprintf(buf, cap, "GMT%c%d", sign, h);
  }
}

typedef struct { int v0, end, cnt; int64_t tail; int64_t *T; int *V; } NameSeq;
static NameSeq **nm_cache;

static uint64_t nm_varint(const uint8_t *b, size_t *p) {
  uint64_t v = 0, m = 1;
  while (b[*p] >= 128) { v += (uint64_t)(b[(*p)++] - 128) * m; m *= 128; }
  v += (uint64_t)b[(*p)++] * m;
  return v;
}

static const NameSeq *nm_open(int rec) {
  extern const scr_tzn_rec scr_tzn_recs[];
  extern const size_t scr_tzn_nrecs;
  extern const uint8_t scr_tzn_blob[];
  if (nm_cache == NULL) {
    nm_cache = (NameSeq **)calloc(scr_tzn_nrecs, sizeof(NameSeq *));
    if (!nm_cache) scr_trap("scriptc: out of memory\n");
  }
  if (nm_cache[rec] != NULL) return nm_cache[rec];
  const scr_tzn_rec *r = &scr_tzn_recs[rec];
  NameSeq *q = (NameSeq *)calloc(1, sizeof *q);
  if (!q) scr_trap("scriptc: out of memory\n");
  size_t p = r->off;
  q->v0 = (int)nm_varint(scr_tzn_blob, &p);
  q->end = r->end;
  q->cnt = r->cnt;
  q->tail = INT64_MAX;
  if (r->cnt > 0) {
    q->T = (int64_t *)malloc(sizeof(int64_t) * r->cnt);
    q->V = (int *)malloc(sizeof(int) * r->cnt);
    if (!q->T || !q->V) scr_trap("scriptc: out of memory\n");
    for (int i = 0; i < r->cnt; i++) {
      uint64_t v = nm_varint(scr_tzn_blob, &p);
      int mm = (int)(v & 1), days = (int)((v >> 1) & 1);
      uint64_t zz = v >> 2;
      int64_t res = ((zz & 1) ? -(int64_t)((zz + 1) / 2) : (int64_t)(zz / 2)) * (days ? 86400 : 1);
      int64_t pred = i == 0 ? 0 : i == 1 ? q->T[0] : q->T[i - 2] + 31536000;
      q->T[i] = pred + res;
      q->V[i] = mm ? (int)nm_varint(scr_tzn_blob, &p) : (i < 2 ? q->v0 : q->V[i - 2]);
    }
    /* the window start, as scr_date_tz.c computes it */
    q->tail = scr_tz_year_start((long long)q->end + 1);
  }
  nm_cache[rec] = q;
  return q;
}

/* the name id (0 = the localized GMT form) at instant t for sequence `rec` */
static int nm_value(int rec, int64_t t) {
  const NameSeq *q = nm_open(rec);
  if (q->cnt == 0) return q->v0;
  if (t >= q->tail) t = scr_tz_map_tail(t, q->end);
  int lo = 0, hi = q->cnt;
  while (lo < hi) {
    int mid = (lo + hi) / 2;
    if (q->T[mid] <= t) lo = mid + 1; else hi = mid;
  }
  return lo == 0 ? q->v0 : q->V[lo - 1];
}

/* style: 1 short 2 long 3 shortOffset 4 longOffset 5 shortGeneric 6 longGeneric */
static void tz_name(char *buf, size_t cap, const Dtf *o, const scr_tz *z, int64_t t, int off, int style) {
  extern const char scr_tzn_names[];
  extern const uint16_t scr_tzn_name_off[];
  extern const uint16_t scr_tzn_id_rec[];
  int is_long = style == 2 || style == 4 || style == 6;
  if (o->tzIsOffset && off == 0 && style != 3 && style != 4 && t >= 0 && t < scr_tzn_meta_end) {
    /* a zero-offset offset zone ("+00:00") carries the GMT metazone's names while that metazone is in force: from
     * 1970 (as for every zone) to the end of the metazone mapping (measured) */
    snprintf(buf, cap, "%s", is_long ? "Greenwich Mean Time" : "GMT");
    return;
  }
  if (style == 3 || style == 4 || o->tzIsOffset || z->idx < 0) {
    gmt_name(buf, cap, off, is_long);
    return;
  }
  static const int styleSlot[7] = {0, 0, 1, -1, -1, 2, 3};
  int rec = scr_tzn_id_rec[z->idx * 8 + styleSlot[style] * 2 + (t >= scr_tzn_meta_end ? 1 : 0)];
  int v = nm_value(rec, t);
  if (v == 0) gmt_name(buf, cap, off, is_long);
  else snprintf(buf, cap, "%s", scr_tzn_names + scr_tzn_name_off[v - 1]);
}

/* ── rendering ───────────────────────────────────────────────────────────────────────── */
typedef struct { char *p; size_t len, cap; } Out;
static void out_put(Out *o, const char *s, size_t n) {
  if (o->len + n + 1 > o->cap) {
    size_t nc = o->cap ? o->cap * 2 : 128;
    while (nc < o->len + n + 1) nc *= 2;
    o->p = (char *)realloc(o->p, nc);
    if (!o->p) scr_trap("scriptc: out of memory\n");
    o->cap = nc;
  }
  memcpy(o->p + o->len, s, n);
  o->len += n;
  o->p[o->len] = '\0';
}
static void out_num(Out *o, long long v, int width) {
  char b[40];
  int n = snprintf(b, sizeof b, "%0*lld", width, v);
  out_put(o, b, (size_t)n);
}

/* Day period text (en): see the notes in the generator's header for the measured rules. */
static const char *day_period(int hour, int minute, int second, int hasMin, int hasSec, int width) {
  if (hour == 12 && (!hasMin || minute == 0) && (!hasSec || second == 0)) return width == 1 ? "n" : "noon";
  if (hour < 12) return "in the morning";
  if (hour < 18) return "in the afternoon";
  if (hour < 21) return "in the evening";
  return "at night";
}

static void render(Out *out, const uint8_t *pat, int plen, const Dtf *o, const Civil *c, int64_t t_sec, int off,
                   int tzStyle, const scr_tz *z) {
  /* a day period reads the minute and the second only if the PATTERN shows them (the option can be dropped by the
   * pattern: {hour, second, fractionalSecondDigits, dayPeriod} has no "s" field) */
  int patMin = 0, patSec = 0;
  for (int i = 0; i < plen; i++) {
    if (pat[i] == C_MIN || pat[i] == C_MIN2) patMin = 1;
    else if (pat[i] == C_S || pat[i] == C_SS) patSec = 1;
  }
  for (int i = 0; i < plen; i++) {
    uint8_t b = pat[i];
    if (b >= 0x20 || b == 0) { out_put(out, (const char *)&b, 1); continue; }
    switch (b) {
      case C_WD_N: out_put(out, &kWdN[c->wd], 1); break;
      case C_WD_S: out_put(out, kWdS[c->wd], 3); break;
      case C_WD_L: out_put(out, kWdL[c->wd], strlen(kWdL[c->wd])); break;
      case C_ERA_N: out_put(out, c->y > 0 ? "A" : "B", 1); break;
      case C_ERA_S: out_put(out, c->y > 0 ? "AD" : "BC", 2); break;
      case C_ERA_L: out_put(out, c->y > 0 ? "Anno Domini" : "Before Christ", c->y > 0 ? 11 : 13); break;
      case C_Y: out_num(out, c->y > 0 ? c->y : 1 - c->y, 1); break;
      case C_YY: out_num(out, (c->y > 0 ? c->y : 1 - c->y) % 100, 2); break;
      case C_M: out_num(out, c->mo, 1); break;
      case C_MM: out_num(out, c->mo, 2); break;
      case C_MMM: out_put(out, kMonthS[c->mo - 1], 3); break;
      case C_MMMM: out_put(out, kMonthL[c->mo - 1], strlen(kMonthL[c->mo - 1])); break;
      case C_MMMMM: out_put(out, &kMonthN[c->mo - 1], 1); break;
      case C_D: out_num(out, c->d, 1); break;
      case C_DD: out_num(out, c->d, 2); break;
      case C_AMPM: out_put(out, c->h < 12 ? "AM" : "PM", 2); break;
      case C_B: {
        const char *s = day_period(c->h, c->mi, c->s, patMin, patSec, o->dayPeriod == 1);
        out_put(out, s, strlen(s));
        break;
      }
      case C_H: case C_HH: out_num(out, c->h % 12 == 0 ? 12 : c->h % 12, b == C_HH ? 2 : 1); break;
      case C_K: case C_KK: out_num(out, c->h % 12, b == C_KK ? 2 : 1); break;
      case C_H23: case C_HH23: out_num(out, c->h, b == C_HH23 ? 2 : 1); break;
      case C_H24: case C_HH24: out_num(out, c->h == 0 ? 24 : c->h, b == C_HH24 ? 2 : 1); break;
      case C_MIN: out_num(out, c->mi, 1); break;
      case C_MIN2: out_num(out, c->mi, 2); break;
      case C_S: out_num(out, c->s, 1); break;
      case C_SS: out_num(out, c->s, 2); break;
      case C_FS: {
        int n = o->fsd, v = c->ms;
        if (n == 1) v /= 100; else if (n == 2) v /= 10;
        out_num(out, v, n);
        break;
      }
      case C_TZ: {
        char nb[160];
        tz_name(nb, sizeof nb, o, z, t_sec, off, tzStyle);
        out_put(out, nb, strlen(nb));
        break;
      }
      default: break;
    }
  }
}

/* ── the entry point ─────────────────────────────────────────────────────────────────── */
static int locale_ok(ScrStr *locale) {
  if (locale == NULL || locale->len == 0) return 1;
  if (locale->len == 5 && memcmp(locale->data, "en-US", 5) == 0) return 1;
  if (locale->len == 2 && memcmp(locale->data, "en", 2) == 0) return 1;
  return 0;
}

/* toLocale{,Date,Time}String(locale, options): kind 4 / 5 / 6, `kv` a string[] of alternating key and
 * value ("\x01" = undefined). +1, or NULL with a pending exception. */
ScrStr *scr_date_format_opts(double ms, double kind_d, ScrStr *locale, ScrArr *kv) {
  int kind = (int)kind_d;
  /* Date.prototype.toLocaleString: an invalid Date answers "Invalid Date" BEFORE the options are read, so a bad
   * option on an invalid Date is not an error. */
  if (!(fabs(ms) <= 8640000000000000.0)) return scr_str_new("Invalid Date", 12);
  if (!locale_ok(locale)) {
    char msg[200];
    snprintf(msg, sizeof msg, "toLocaleString at locale \"%.60s\" is not supported (only en-US and en)", locale->data);
    throw_msg(SCR_ERR_RANGE, msg);
    return NULL;
  }
  KV bag[MAXKV];
  int n = 0;
  if (kv != NULL) {
    ScrStr **d = (ScrStr **)kv->data;
    for (size_t i = 0; i + 1 < kv->len && n < MAXKV; i += 2) { bag[n].key = d[i]->data; bag[n].val = d[i + 1]->data; n++; }
  }
  Dtf o;
  if (dtf_parse(&o, bag, n, kind)) return NULL;
  const scr_tz *z = o.tz != NULL ? o.tz : scr_tz_host();
  double tt = trunc(ms);
  int64_t t_sec = (int64_t)floor(tt / 1000.0);
  int off = o.tzIsOffset ? o.tzOffsetSec : (int)scr_tz_offset(z, t_sec);
  int msec = (int)(tt - floor(tt / 1000.0) * 1000.0);
  Civil c;
  civil_of(t_sec + off, msec, &c);
  uint8_t pat[512];
  int tzStyle;
  int plen = pattern_of(&o, pat, sizeof pat, &tzStyle);
  if (plen < 0) {
    throw_msg(SCR_ERR_ERROR, "scriptc: internal error: unreachable date format option vector");
    return NULL;
  }
  Out out = {0};
  out_put(&out, "", 0);
  render(&out, pat, plen, &o, &c, t_sec, off, tzStyle, z);
  ScrStr *r = scr_str_new(out.p, out.len);
  free(out.p);
  return r;
}
