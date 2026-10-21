/* scr_date_fmt.c -- Date.prototype.toString / toDateString / toTimeString /
 * toUTCString / toLocale{,Date,Time}String (en-US, no options).
 *
 * Linked only by programs that use a formatter (moduleUsesDateFmt), because
 * it carries the generated ICU zone-name table (scr_date_zones.c).
 *
 * THE ZONE NAME. "(Brasilia Standard Time)" is ICU's en-US LONG display name
 * of the host zone, one of TWO per zone (standard / daylight), which V8
 * caches once per process. Which one an instant prints is ICU's dst flag at
 * that instant for 0 <= t <= 2^31-1 s, and the flag of the EQUIVALENT year
 * (2008..2037, same weekday pattern and leap-ness, V8's DateCache rule)
 * outside it. libc's tm_isdst is NOT a substitute: it disagrees with the
 * flag for 232 of 418 zones over 1800-2100 (measured), so the table stores,
 * per zone, the instants in [0, 2^31) at which the flag toggles.
 * A zone id the table does not carry (a POSIX TZ string such as "XYZ3", an
 * unknown id) prints ICU's own fallback, "GMT+HH:MM" of the offset. */
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#ifdef _WIN32
#include <windows.h>
#else
#include <unistd.h>
#endif

#include "scr_runtime.h"
#include "scr_date_zones.h"

int scr_date_civil(double local_ms, long long *y, int *mo, int *d, int *h, int *mi, int *sec, int *wd);
int scr_date_tza_at(double t, double *out);

static int dz_varint(const uint8_t *b, size_t *p, uint64_t *out) {
  uint64_t v = 0, m = 1;
  while (b[*p] >= 128) { v += (uint64_t)(b[(*p)++] - 128) * m; m *= 128; }
  v += (uint64_t)b[(*p)++] * m;
  *out = v;
  return 1;
}
static int64_t dz_unzz(uint64_t v) { return (v & 1) ? -(int64_t)((v + 1) / 2) : (int64_t)(v / 2); }

/* The host's IANA zone id, or NULL. */
static const char *dz_host_id(char *buf, size_t cap) {
  const char *tz = getenv("TZ");
  if (tz != NULL) {
    if (*tz == ':') tz++;
    if (*tz == '\0') return "UTC";
    return tz;
  }
#ifdef _WIN32
  (void)buf; (void)cap;
  DYNAMIC_TIME_ZONE_INFORMATION z;
  if (GetDynamicTimeZoneInformation(&z) != TIME_ZONE_ID_INVALID && wcscmp(z.TimeZoneKeyName, L"UTC") == 0) return "UTC";
  return NULL;
#else
  ssize_t n = readlink("/etc/localtime", buf, cap - 1);
  if (n <= 0) return "UTC";
  buf[n] = '\0';
  const char *k = strstr(buf, "zoneinfo/");
  if (k == NULL) return "UTC";
  k += 9;
  if (strncmp(k, "posix/", 6) == 0) k += 6;
  else if (strncmp(k, "right/", 6) == 0) k += 6;
  return k;
#endif
}

static const scr_dz_rec *dz_find(const char *id) {
  size_t lo = 0, hi = scr_dz_nids;
  while (lo < hi) {
    size_t mid = (lo + hi) / 2;
    int c = strcmp(id, scr_dz_ids + scr_dz_id_off[mid]);
    if (c == 0) return &scr_dz_recs[scr_dz_id_rec[mid]];
    if (c < 0) hi = mid; else lo = mid + 1;
  }
  return NULL;
}

/* V8's equivalent year for an instant outside [0, 2^31) seconds. */
static long long dz_equiv_year(long long y) {
  long long yy = y - 1; /* Jan 1 weekday via days since epoch */
  long long era = (yy >= 0 ? yy : yy - 399) / 400;
  long long yoe = yy - era * 400;
  long long doy = (153 * (10 % 12) + 2) / 5; /* March-based day-of-year of Jan 1: 306 */
  long long doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  long long days = era * 146097 + doe - 719468;
  int w = (int)(((days + 4) % 7 + 7) % 7);
  int leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
  long long recent = (leap ? 1956 : 1967) + (w * 12) % 28;
  return 2008 + (recent + 3 * 28 - 2008) % 28;
}

/* The flag of the zone at an instant: 0 = name0, 1 = name1. */
static int dz_flag(const scr_dz_rec *r, double t_ms) {
  double secs;
  if (t_ms >= 0 && t_ms <= 2147483647000.0) {
    secs = floor(t_ms / 1000.0);
  } else {
    long long y; int mo, d, h, mi, s, wd;
    if (!scr_date_civil(t_ms, &y, &mo, &d, &h, &mi, &s, &wd)) return 0;
    long long ey = dz_equiv_year(y);
    /* the same month/day/time in the equivalent year: days_from_civil by hand */
    long long yy = ey - (mo + 1 <= 2);
    long long era = (yy >= 0 ? yy : yy - 399) / 400;
    long long yoe = yy - era * 400;
    int m1 = mo + 1;
    long long doy = (153 * (m1 + (m1 > 2 ? -3 : 9)) + 2) / 5 + d - 1;
    long long doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    long long days = era * 146097 + doe - 719468;
    secs = (double)days * 86400.0 + h * 3600.0 + mi * 60.0 + s;
  }
  size_t p = r->off;
  int64_t prev[2] = {0, 0};
  int flag = 0;
  for (unsigned i = 0; i < r->cnt; i++) {
    uint64_t v;
    dz_varint(scr_dz_blob, &p, &v);
    int64_t m;
    if (i < 2) m = (int64_t)v + (i ? prev[1] : 0);
    else {
      int64_t d = (v & 1) ? dz_unzz(v >> 1) : dz_unzz(v >> 1) * 1440;
      m = prev[0] + 525600 + d;
    }
    prev[0] = prev[1];
    prev[1] = m;
    if ((double)(m * scr_dz_unit) > secs) break;
    flag ^= 1;
  }
  return flag;
}

static const char *dz_zone_name(double t, double tza, char *fb, size_t fbcap) {
  char idbuf[512];
  const char *id = dz_host_id(idbuf, sizeof idbuf);
  const scr_dz_rec *r = id != NULL ? dz_find(id) : NULL;
  if (r != NULL) return scr_dz_names + scr_dz_name_off[dz_flag(r, t) ? r->n1 : r->n0];
  int off = (int)(tza / 60000.0), a = off < 0 ? -off : off;
  snprintf(fb, fbcap, "GMT%c%02d:%02d", off < 0 ? '-' : '+', a / 60, a % 60);
  return fb;
}

static const char *const day_names[] = {"Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"};
static const char *const month_names[] = {"Jan", "Feb", "Mar", "Apr", "May", "Jun",
                                          "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"};

/* kind: 0 toString, 1 toDateString, 2 toTimeString, 3 toUTCString,
 * 4 toLocaleString, 5 toLocaleDateString, 6 toLocaleTimeString. +1. */
ScrStr *scr_date_format(double ms, double kind_d) {
  int kind = (int)kind_d;
  if (!(fabs(ms) <= 8640000000000000.0)) return scr_str_new("Invalid Date", 12);
  double t = trunc(ms), tza = 0;
  if (kind != 3) {
    if (!scr_date_tza_at(t, &tza)) return scr_str_new("Invalid Date", 12);
  }
  long long y; int mo, d, h, mi, s, wd;
  if (!scr_date_civil(t + tza, &y, &mo, &d, &h, &mi, &s, &wd)) return scr_str_new("Invalid Date", 12);
  char buf[256], ybuf[32];
  if (y < 0) snprintf(ybuf, sizeof ybuf, "-%04lld", -y);
  else snprintf(ybuf, sizeof ybuf, "%04lld", y);
  int n = 0;
  if (kind >= 4) {
    long long ly = y <= 0 ? 1 - y : y; /* ICU's era-relative year */
    char dpart[64], tpart[64];
    snprintf(dpart, sizeof dpart, "%d/%d/%lld", mo + 1, d, ly);
    snprintf(tpart, sizeof tpart, "%d:%02d:%02d %s", h % 12 == 0 ? 12 : h % 12, mi, s, h < 12 ? "AM" : "PM");
    if (kind == 4) n = snprintf(buf, sizeof buf, "%s, %s", dpart, tpart);
    else if (kind == 5) n = snprintf(buf, sizeof buf, "%s", dpart);
    else n = snprintf(buf, sizeof buf, "%s", tpart);
    return scr_str_new(buf, (size_t)n);
  }
  if (kind == 3) {
    n = snprintf(buf, sizeof buf, "%s, %02d %s %s %02d:%02d:%02d GMT", day_names[wd], d, month_names[mo], ybuf, h, mi, s);
    return scr_str_new(buf, (size_t)n);
  }
  char fb[32];
  const char *zname = dz_zone_name(t, tza, fb, sizeof fb);
  int off = (int)(tza / 60000.0), aoff = off < 0 ? -off : off;
  if (kind == 1) n = snprintf(buf, sizeof buf, "%s %s %02d %s", day_names[wd], month_names[mo], d, ybuf);
  else if (kind == 2)
    n = snprintf(buf, sizeof buf, "%02d:%02d:%02d GMT%c%02d%02d (%s)", h, mi, s, off < 0 ? '-' : '+', aoff / 60, aoff % 60, zname);
  else
    n = snprintf(buf, sizeof buf, "%s %s %02d %s %02d:%02d:%02d GMT%c%02d%02d (%s)", day_names[wd], month_names[mo], d, ybuf,
                 h, mi, s, off < 0 ? '-' : '+', aoff / 60, aoff % 60, zname);
  return scr_str_new(buf, (size_t)n);
}

ScrStr *scr_date_to_string(double ms) { return scr_date_format(ms, 0); }
