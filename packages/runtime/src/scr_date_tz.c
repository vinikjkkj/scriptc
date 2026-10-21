/* scr_date_tz.c -- the zone database every local-time Date operation reads.
 *
 * Node answers local time from ICU with ITS OWN bundled tzdata, so a binary that asked the host
 * (localtime, SystemTimeToTzSpecificLocalTimeEx) would disagree with it wherever the host's
 * release differs from Node's, and on Windows would need a registry round trip to name a zone.
 * Instead scripts/gen-date-zones.mjs measures Node's offsets (scr_date_tzdb.c) and this file
 * replays them: the same answer on every platform, by construction.
 *
 * A zone is: the offset before the first transition, the explicit transitions (1700 .. a per-zone
 * END year) and, after END, the instant mapped into the equivalent year of the 28-year window
 * [END-27, END] (same leap-ness, same weekday of Jan 1: the final recurring rule is calendar
 * periodic). The generator checks that model against Node before it writes a byte.
 *
 * WHICH ZONE. Node's rule, as ICU implements it: the TZ environment variable names an IANA id; a
 * POSIX offset string without a DST part ("XYZ3", "<-03>3", "UTC+3") is a fixed offset whose
 * name prints as GMT+HH:MM; one WITH a DST part, or an empty/absent TZ, is the system zone
 * (measured: Node ignores the rules and uses /etc/localtime); an unknown id is UTC. The system
 * zone is /etc/localtime's target (or /etc/timezone) on POSIX and the registry's zone, mapped
 * to its IANA id through CLDR's windowsZones, on Windows. */
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#ifdef _WIN32
#include <windows.h>
#else
#include <unistd.h>
#endif

#include "scr_runtime.h"
#include "scr_date_zones.h"
#ifdef _WIN32
#include "scr_date_winzones.h"
#endif

static int64_t tz_floor_div(int64_t a, int64_t b) {
  int64_t q = a / b;
  if ((a % b != 0) && ((a < 0) != (b < 0))) q--;
  return q;
}

static int64_t tz_days_from_civil(int64_t y, int m, int d) {
  y -= m <= 2;
  int64_t era = (y >= 0 ? y : y - 399) / 400;
  int64_t yoe = y - era * 400;
  int64_t doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
  int64_t doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  return era * 146097 + doe - 719468;
}

static void tz_civil_from_days(int64_t z, int64_t *y, int *m, int *d) {
  z += 719468;
  int64_t era = (z >= 0 ? z : z - 146096) / 146097;
  int64_t doe = z - era * 146097;
  int64_t yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
  int64_t yy = yoe + era * 400;
  int64_t doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  int64_t mp = (5 * doy + 2) / 153;
  *d = (int)(doy - (153 * mp + 2) / 5 + 1);
  *m = (int)(mp < 10 ? mp + 3 : mp - 9);
  *y = yy + (*m <= 2);
}

static int tz_leap(long long y) { return (y % 4 == 0 && y % 100 != 0) || y % 400 == 0; }
static int tz_jan1_wd(long long y) { return (int)(((tz_days_from_civil(y, 1, 1) + 4) % 7 + 7) % 7); }

/* The latest year in [end-27, end] with the same leap-ness and the same weekday of Jan 1 as `y`. The
 * generator guarantees every window holds all 14 (leap-ness, weekday) classes, so one always exists. */
int scr_tz_equiv_year(long long y, int end) {
  int w = tz_jan1_wd(y), leap = tz_leap(y);
  for (long long c = end; c >= (long long)end - 27; c--)
    if (tz_leap(c) == leap && tz_jan1_wd(c) == w) return (int)c;
  return end;
}

static uint64_t tz_varint(const uint8_t *b, size_t *p) {
  uint64_t v = 0, m = 1;
  while (b[*p] >= 128) { v += (uint64_t)(b[(*p)++] - 128) * m; m *= 128; }
  v += (uint64_t)b[(*p)++] * m;
  return v;
}
static int64_t tz_unzz(uint64_t v) { return (v & 1) ? -(int64_t)((v + 1) / 2) : (int64_t)(v / 2); }

static void tz_oom(void) { scr_trap("scriptc: out of memory\n"); }

/* Decode one offset record (the generator's codec) into heap arrays. */
static void tz_load(const scr_tz_rec *r, scr_tz *z) {
  size_t p = r->off;
  int noff = (int)tz_varint(scr_tz_blob, &p);
  int32_t offs[256];
  for (int i = 0; i < noff && i < 256; i++) offs[i] = (int32_t)tz_unzz(tz_varint(scr_tz_blob, &p));
  z->off0 = r->off0;
  z->cnt = r->cnt;
  z->end = r->end;
  z->T = NULL;
  z->O = NULL;
  z->tail = INT64_MAX;
  if (r->cnt == 0) return;
  z->T = (int64_t *)malloc(sizeof(int64_t) * r->cnt);
  z->O = (int32_t *)malloc(sizeof(int32_t) * r->cnt);
  uint8_t *idx = (uint8_t *)malloc(r->cnt);
  if (!z->T || !z->O || !idx) tz_oom();
  for (int i = 0; i < r->cnt; i++) {
    uint64_t v = tz_varint(scr_tz_blob, &p);
    int mm = (int)(v & 1), days = (int)((v >> 1) & 1);
    int64_t res = tz_unzz(v >> 2) * (days ? 86400 : 1);
    int64_t pred = i == 0 ? 0 : i == 1 ? z->T[0] : z->T[i - 2] + 31536000;
    z->T[i] = pred + res;
    idx[i] = mm ? scr_tz_blob[p++] : (i < 2 ? 0 : idx[i - 2]);
    z->O[i] = offs[idx[i]];
  }
  free(idx);
  z->tail = tz_days_from_civil((int64_t)r->end + 1, 1, 1) * 86400;
}

int64_t scr_tz_year_start(long long year) { return tz_days_from_civil(year, 1, 1) * 86400; }

int64_t scr_tz_map_tail(int64_t t, int end) {
  int64_t days = tz_floor_div(t, 86400), sod = t - days * 86400, y;
  int m, d;
  tz_civil_from_days(days, &y, &m, &d);
  return tz_days_from_civil(scr_tz_equiv_year(y, end), m, d) * 86400 + sod;
}

int32_t scr_tz_offset(const scr_tz *z, int64_t t) {
  if (z->cnt == 0) return z->off0;
  if (t >= z->tail) t = scr_tz_map_tail(t, z->end);
  int lo = 0, hi = z->cnt;
  while (lo < hi) {
    int mid = (lo + hi) / 2;
    if (z->T[mid] <= t) lo = mid + 1; else hi = mid;
  }
  return lo == 0 ? z->off0 : z->O[lo - 1];
}

/* ── id lookup ─────────────────────────────────────────────────────────── */
static scr_tz **tz_cache;

static int tz_lower(int c) { return c >= 'A' && c <= 'Z' ? c + 32 : c; }

static const scr_tz *tz_open(size_t i) {
  if (tz_cache == NULL) {
    tz_cache = (scr_tz **)calloc(scr_tz_nids, sizeof(scr_tz *));
    if (!tz_cache) tz_oom();
  }
  if (tz_cache[i] == NULL) {
    scr_tz *z = (scr_tz *)calloc(1, sizeof *z);
    if (!z) tz_oom();
    tz_load(&scr_tz_recs[scr_tz_id_orec[i]], z);
    z->id = scr_tz_ids + scr_tz_id_off[i];
    z->idx = (int)i;
    z->nrec = scr_tz_id_nrec[i];
    tz_cache[i] = z;
  }
  return tz_cache[i];
}

const scr_tz *scr_tz_find(const char *id, size_t len, int nocase) {
  if (nocase) {
    for (size_t i = 0; i < scr_tz_nids; i++) {
      const char *c = scr_tz_ids + scr_tz_id_off[i];
      size_t k = 0;
      while (k < len && c[k] && tz_lower((unsigned char)c[k]) == tz_lower((unsigned char)id[k])) k++;
      if (k == len && c[k] == '\0') return tz_open(i);
    }
    return NULL;
  }
  size_t lo = 0, hi = scr_tz_nids;
  while (lo < hi) {
    size_t mid = (lo + hi) / 2;
    const char *c = scr_tz_ids + scr_tz_id_off[mid];
    int cmp = strncmp(id, c, len);
    if (cmp == 0) cmp = c[len] == '\0' ? 0 : -1;
    if (cmp == 0) return tz_open(mid);
    if (cmp < 0) hi = mid; else lo = mid + 1;
  }
  return NULL;
}

/* ── the host zone ─────────────────────────────────────────────────────── */
static scr_tz tz_custom; /* a fixed-offset or unknown zone */
static const scr_tz *tz_host_cached;

static const scr_tz *tz_fixed(int32_t off) {
  memset(&tz_custom, 0, sizeof tz_custom);
  tz_custom.idx = -1;
  tz_custom.nrec = -1;
  tz_custom.off0 = off;
  tz_custom.tail = INT64_MAX;
  return &tz_custom;
}

/* A POSIX offset string WITHOUT a DST part: "XYZ3", "<-03>3", "UTC+3", "EST5:30". Sets *rest to what
 * follows the offset (non-empty means a DST part). Returns 1 and the seconds EAST of UTC. */
static int tz_parse_posix(const char *s, int32_t *east, const char **rest) {
  const char *p = s;
  if (*p == '<') {
    while (*p && *p != '>') p++;
    if (*p != '>') return 0;
    p++;
  } else {
    int n = 0;
    while ((*p >= 'A' && *p <= 'Z') || (*p >= 'a' && *p <= 'z')) { p++; n++; }
    if (n < 3) return 0;
  }
  int sign = 1;
  if (*p == '+') p++;
  else if (*p == '-') { sign = -1; p++; }
  if (!(*p >= '0' && *p <= '9')) return 0;
  int h = 0, m = 0, sec = 0;
  while (*p >= '0' && *p <= '9') { h = h * 10 + (*p - '0'); p++; }
  if (*p == ':') {
    p++;
    while (*p >= '0' && *p <= '9') { m = m * 10 + (*p - '0'); p++; }
    if (*p == ':') {
      p++;
      while (*p >= '0' && *p <= '9') { sec = sec * 10 + (*p - '0'); p++; }
    }
  }
  *east = -sign * (h * 3600 + m * 60 + sec); /* POSIX counts WEST of UTC */
  *rest = p;
  return 1;
}

static const scr_tz *tz_from_id(const char *id) {
  size_t len = strlen(id);
  if (len > 8 && strncmp(id, "/usr/", 5) == 0) {
    const char *k = strstr(id, "zoneinfo/");
    if (k != NULL) { id = k + 9; len = strlen(id); }
  }
  if (len > 6 && strncmp(id, "posix/", 6) == 0) { id += 6; len -= 6; }
  else if (len > 6 && strncmp(id, "right/", 6) == 0) { id += 6; len -= 6; }
  return scr_tz_find(id, len, 0);
}

/* The system zone: never NULL (UTC when nothing names one). */
static const scr_tz *tz_system(void) {
#ifdef _WIN32
  DYNAMIC_TIME_ZONE_INFORMATION z;
  if (GetDynamicTimeZoneInformation(&z) != TIME_ZONE_ID_INVALID) {
    char key[128];
    size_t n = 0;
    for (; n + 1 < sizeof key && z.TimeZoneKeyName[n]; n++) key[n] = (char)z.TimeZoneKeyName[n];
    key[n] = '\0';
    const char *id = scr_win_zone_to_iana(key);
    if (id != NULL) {
      const scr_tz *r = tz_from_id(id);
      if (r != NULL) return r;
    }
  }
#else
  char buf[512];
  ssize_t n = readlink("/etc/localtime", buf, sizeof buf - 1);
  if (n > 0) {
    buf[n] = '\0';
    const char *k = strstr(buf, "zoneinfo/");
    if (k != NULL) {
      const scr_tz *r = tz_from_id(k + 9);
      if (r != NULL) return r;
    }
  } else {
    FILE *f = fopen("/etc/timezone", "r");
    if (f != NULL) {
      if (fgets(buf, sizeof buf, f) != NULL) {
        size_t l = strlen(buf);
        while (l > 0 && (buf[l - 1] == '\n' || buf[l - 1] == '\r' || buf[l - 1] == ' ')) buf[--l] = '\0';
        const scr_tz *r = tz_from_id(buf);
        if (r != NULL) { fclose(f); return r; }
      }
      fclose(f);
    }
  }
#endif
  const scr_tz *u = scr_tz_find("UTC", 3, 0);
  return u != NULL ? u : tz_fixed(0);
}

const scr_tz *scr_tz_host(void) {
  if (tz_host_cached != NULL) return tz_host_cached;
  const scr_tz *z = NULL;
  const char *tz = getenv("TZ");
  if (tz != NULL) {
    if (*tz == ':') tz++;
    if (*tz == '\0') {
      z = tz_fixed(0);
    } else if ((z = tz_from_id(tz)) == NULL) {
      int32_t east;
      const char *rest;
      if (tz_parse_posix(tz, &east, &rest)) z = *rest == '\0' ? tz_fixed(east) : tz_system();
      else z = tz_fixed(0); /* an unknown id is UTC (ICU's Etc/Unknown) */
    }
  } else {
    z = tz_system();
  }
  tz_host_cached = z;
  return z;
}

/* LocalTZA for the time value t (integral ms, in range), in ms: what scr_date.c's local reads use. */
int scr_tz_host_tza(double t_ms, double *out_ms) {
  const scr_tz *z = scr_tz_host();
  *out_ms = (double)scr_tz_offset(z, (int64_t)floor(t_ms / 1000.0)) * 1000.0;
  return 1;
}
