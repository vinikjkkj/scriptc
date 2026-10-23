/* ICU 78.2 calendars (instant -> fields). Julian days follow ICU: JD 2440588 is 1970-01-01. */
#include "scr_cal.h"
#include "scr_ures.h"
#include "scr_cal_tables.h"
#include <math.h>
#include <stdlib.h>
#include <string.h>

#define kEpochStartAsJulianDay 2440588
#define U_MILLIS_PER_DAY 86400000.0

static int32_t fdiv32(int32_t n, int32_t d) { return n >= 0 ? n / d : ((n + 1) / d) - 1; }
static int32_t fdiv32r(int32_t n, int32_t d, int32_t *rem) { int32_t q = fdiv32(n, d); *rem = n - q * d; return q; }
static int64_t fdiv64(int64_t n, int64_t d) { return n >= 0 ? n / d : ((n + 1) / d) - 1; }

static const char *const kCalNames[CT_COUNT] = {
  "gregorian", "japanese", "buddhist", "roc", "persian", "islamic-civil", "islamic", "hebrew", "chinese", "indian", "coptic",
  "ethiopic", "ethiopic-amete-alem", "iso8601", "dangi", "islamic-umalqura", "islamic-tbla", "islamic-rgsa"};
int scr_cal_type_from_name(const char *s) { for (int i = 0; i < CT_COUNT; i++) if (strcmp(kCalNames[i], s) == 0) return i; return -1; }
const char *scr_cal_type_name(int t) { return kCalNames[t]; }

void scr_cal_set_week_data(ScrCal *c, int firstDayOfWeek, int minimalDays) { c->firstDayOfWeek = firstDayOfWeek; c->minimalDays = minimalDays; }

/* ── Grego ───────────────────────────────────────────────────────────────────────────────────────────────── */
static const int16_t DAYS_BEFORE[24] = {0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335};
static const int8_t MONTH_LENGTH[24] = {31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31, 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
#define JULIAN_1_CE 1721426
#define JULIAN_1970_CE 2440588

static int grego_leap(int32_t y) { return ((y & 3) == 0) && ((y % 100 != 0) || (y % 400 == 0)); }
static int grego_month_length(int32_t y, int m) { return MONTH_LENGTH[m + (grego_leap(y) ? 12 : 0)]; }

static int64_t grego_fields_to_day(int32_t year, int32_t month, int32_t dom) {
  int64_t y = year;
  y--;
  int64_t julian = 365LL * y + fdiv64(y, 4) + (JULIAN_1_CE - 3) + fdiv64(y, 400) - fdiv64(y, 100) + 2 + DAYS_BEFORE[month + (grego_leap(year) ? 12 : 0)] + dom;
  return julian - JULIAN_1970_CE;
}

static int32_t grego_day_to_year(int32_t day, int16_t *doy) {
  day += JULIAN_1970_CE - JULIAN_1_CE;
  int32_t doy32;
  int32_t n400 = fdiv32r(day, 146097, &doy32);
  int32_t n100 = fdiv32r(doy32, 36524, &doy32);
  int32_t n4 = fdiv32r(doy32, 1461, &doy32);
  int32_t n1 = fdiv32r(doy32, 365, &doy32);
  int32_t year = 400 * n400 + 100 * n100 + 4 * n4 + n1;
  if (n100 == 4 || n1 == 4) *doy = 365;
  else { *doy = (int16_t)doy32; ++year; }
  (*doy)++;
  return year;
}

static void grego_day_to_fields(int32_t day, int32_t *year, int *month, int *dom, int *dow, int *doyOut) {
  int16_t doy;
  *year = grego_day_to_year(day, &doy);
  int32_t d2 = day + (JULIAN_1970_CE - JULIAN_1_CE);
  int d = (int)((d2 + 1) % 7);
  d += d < 0 ? 1 + 7 : 1; /* UCAL_SUNDAY == 1 */
  *dow = d;
  int leap = grego_leap(*year);
  int march1 = leap ? 60 : 59;
  int correction = 0;
  if (doy > march1) correction = leap ? 1 : 2;
  *month = (12 * (doy - 1 + correction) + 6) / 367;
  *dom = doy - DAYS_BEFORE[*month + (leap ? 12 : 0)];
  *doyOut = doy;
}

/* ── GregorianCalendar (with the 1582 cutover unless the calendar sets the change to the start of time) ────── */
#define kJan1_1JulianDay 1721426
static const int kNumDays[12] = {0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334};
static const int kLeapNumDays[12] = {0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335};
#define kCutoverJulianDay 2299161
#define kDefaultCutoverYear 1582

static int32_t grego_shift(int32_t eyear) {
  /* Grego::gregorianShift */
  int64_t y = (int64_t)eyear - 1;
  int32_t gregShift = (int32_t)(fdiv64(y, 400) - fdiv64(y, 100) + 2);
  return gregShift;
}

typedef struct { int32_t eyear; int month, dom, doy, dow; } GregFields;

static void greg_compute(int32_t julianDay, int cutover, GregFields *g) {
  int32_t gy; int gm, gd, gdow, gdoy;
  grego_day_to_fields(julianDay - kEpochStartAsJulianDay, &gy, &gm, &gd, &gdow, &gdoy);
  g->dow = gdow;
  int32_t eyear; int month, dom, doy;
  if (!cutover || julianDay >= kCutoverJulianDay) { month = gm; dom = gd; doy = gdoy; eyear = gy; }
  else {
    int32_t julianEpochDay = julianDay - (kJan1_1JulianDay - 2);
    int32_t rem;
    int32_t num = (int32_t)(4.0 * julianEpochDay + 1464.0);
    eyear = fdiv32r(num, 1461, &rem);
    int32_t january1 = 365 * (eyear - 1) + fdiv32(eyear - 1, 4);
    doy = julianEpochDay - january1;
    int leap = (eyear & 3) == 0;
    int correction = 0;
    int march1 = leap ? 60 : 59;
    if (doy >= march1) correction = leap ? 1 : 2;
    month = (12 * (doy + correction) + 6) / 367;
    dom = doy - (leap ? kLeapNumDays[month] : kNumDays[month]) + 1;
    ++doy;
  }
  if (cutover && eyear == kDefaultCutoverYear && julianDay >= kCutoverJulianDay) doy += grego_shift(eyear);
  g->eyear = eyear; g->month = month; g->dom = dom; g->doy = doy;
}

/* ── Japanese eras (supplementalData calendarData/japanese/eras) ───────────────────────────────────────── */
typedef struct { int n; int32_t y[300], m[300], d[300]; int minEra; } EraTable;
static EraTable gJapEras;
static int gJapInit;
static void japanese_init(void) {
  if (gJapInit) return;
  gJapInit = 1;
  ScrRes eras;
  if (!scr_ures_misc("supplementalData", "calendarData/japanese/eras", &eras)) return;
  int n = scr_res_table_len(eras);
  int maxIdx = -1;
  for (int i = 0; i < n; i++) {
    const char *k; size_t kn;
    ScrRes e = scr_res_table_at(eras, i, &k, &kn);
    int idx = atoi(k);
    /* "named:false" marks a tentative era: not included (ICU_ENABLE_TENTATIVE_ERA is unset) */
    int named = 1;
    ScrRes start = {NULL, 0};
    for (int j = 0; j < scr_res_table_len(e); j++) {
      const char *kk; size_t kkn;
      ScrRes v = scr_res_table_at(e, j, &kk, &kkn);
      if (kkn == 5 && !memcmp(kk, "start", 5)) start = v;
      else if (kkn == 5 && !memcmp(kk, "named", 5)) { size_t sn; const char *s = scr_res_str(v, &sn); if (s && sn >= 5 && !memcmp(s, "false", 5)) named = 0; }
    }
    if (!named || !start.p || idx < 0 || idx >= 300) continue;
    /* an intvector [year, month, day] */
    int32_t iv[3];
    if (scr_res_intvec(start, iv, 3) != 3) continue;
    gJapEras.y[idx] = iv[0]; gJapEras.m[idx] = iv[1]; gJapEras.d[idx] = iv[2];
    if (idx > maxIdx) maxIdx = idx;
  }
  gJapEras.n = maxIdx + 1;
}
static int japanese_era_code(int32_t year, int month, int day) {
  japanese_init();
  for (int i = gJapEras.n - 1; i >= 0; i--) {
    if (gJapEras.y[i] == 0 && gJapEras.m[i] == 0) continue; /* unset */
    int c = gJapEras.y[i] != year ? (gJapEras.y[i] < year ? -1 : 1) : gJapEras.m[i] != month ? (gJapEras.m[i] < month ? -1 : 1) : gJapEras.d[i] != day ? (gJapEras.d[i] < day ? -1 : 1) : 0;
    if (c <= 0) return i;
  }
  return 0;
}
static int32_t japanese_start_year(int era) { japanese_init(); return gJapEras.y[era]; }

/* ── the entry point ─────────────────────────────────────────────────────────────────────────────────────── */
static void time_fields(ScrCal *c, int32_t millisInDay, int32_t rawOffsetMs, int32_t dstOffsetMs) {
  c->f[CAL_MILLIS_IN_DAY] = millisInDay;
  c->f[CAL_MILLISECOND] = millisInDay % 1000;
  millisInDay /= 1000;
  c->f[CAL_SECOND] = millisInDay % 60;
  millisInDay /= 60;
  c->f[CAL_MINUTE] = millisInDay % 60;
  millisInDay /= 60;
  c->f[CAL_HOUR_OF_DAY] = millisInDay;
  c->f[CAL_AM_PM] = millisInDay / 12;
  c->f[CAL_HOUR] = millisInDay % 12;
  c->f[CAL_ZONE_OFFSET] = rawOffsetMs;
  c->f[CAL_DST_OFFSET] = dstOffsetMs;
}

static int year_length(ScrCal *c, int32_t eyear);

static void week_fields(ScrCal *c) {
  int32_t dayOfWeek = c->f[CAL_DAY_OF_WEEK];
  int32_t first = c->firstDayOfWeek ? c->firstDayOfWeek : 1;
  int32_t minimal = c->minimalDays ? c->minimalDays : 1;
  int32_t dowLocal = dayOfWeek - first + 1;
  if (dowLocal < 1) dowLocal += 7;
  c->f[CAL_DOW_LOCAL] = dowLocal;
  int32_t eyear = c->f[CAL_EXTENDED_YEAR];
  int32_t dayOfYear = c->f[CAL_DAY_OF_YEAR];
  int32_t yearOfWeek = eyear;
  int32_t relDow = (dayOfWeek + 7 - first) % 7;
  int32_t relDowJan1 = (dayOfWeek - dayOfYear + 7001 - first) % 7;
  int32_t woy = (dayOfYear - 1 + relDowJan1) / 7;
  if ((7 - relDowJan1) >= minimal) ++woy;
  if (woy == 0) {
    int32_t prevDoy = dayOfYear + year_length(c, eyear - 1);
    /* weekNumber(prevDoy, dayOfWeek) */
    /* Calendar::weekNumber(desiredDay, dayOfPeriod, dayOfWeek) */
    {
      int32_t periodStartDayOfWeek = (dayOfWeek - first - prevDoy + 1) % 7;
      if (periodStartDayOfWeek < 0) periodStartDayOfWeek += 7;
      int32_t wno = (prevDoy + periodStartDayOfWeek - 1) / 7;
      if ((7 - periodStartDayOfWeek) >= minimal) ++wno;
      woy = wno;
    }
    yearOfWeek--;
  } else {
    int32_t lastDoy = year_length(c, eyear);
    if (dayOfYear >= lastDoy - 5) {
      int32_t lastRelDow = (relDow + lastDoy - dayOfYear) % 7;
      if (lastRelDow < 0) lastRelDow += 7;
      if (((6 - lastRelDow) >= minimal) && ((dayOfYear + 7 - relDow) > lastDoy)) { woy = 1; yearOfWeek++; }
    }
  }
  c->f[CAL_WEEK_OF_YEAR] = woy;
  c->f[CAL_YEAR_WOY] = yearOfWeek;
  int32_t dom = c->f[CAL_DATE];
  {
    int32_t periodStartDayOfWeek = (dayOfWeek - first - dom + 1) % 7;
    if (periodStartDayOfWeek < 0) periodStartDayOfWeek += 7;
    int32_t wno = (dom + periodStartDayOfWeek - 1) / 7;
    if ((7 - periodStartDayOfWeek) >= minimal) ++wno;
    c->f[CAL_WEEK_OF_MONTH] = wno;
  }
  c->f[CAL_DOW_IN_MONTH] = (dom - 1) / 7 + 1;
}


/* ── astronomy (astro.cpp) ───────────────────────────────────────────────────────────────────────────────── */
#define A_PI 3.14159265358979323846
#define A_SYNODIC_MONTH 29.530588853
#define A_TROPICAL_YEAR 365.242191
#define A_JULIAN_EPOCH_MS -210866760000000.0
#define A_JD_EPOCH 2447891.5
#define A_MINUTE_MS 60000.0
#define A_DAY_MS 86400000.0
typedef struct { double t, julianDay, sunLongitude, meanAnomalySun, moonEclipLong; } Astro;
static double a_norm(double v, double range) { return v - range * floor(v / range); }
static double a_norm2pi(double a) { return a_norm(a, A_PI * 2.0); }
static double a_normpi(double a) { return a_norm(a + A_PI, A_PI * 2.0) - A_PI; }
static void a_set(Astro *a, double t) { a->t = t; a->julianDay = a->sunLongitude = a->meanAnomalySun = a->moonEclipLong = NAN; }
static double a_jd(Astro *a) { if (isnan(a->julianDay)) a->julianDay = (a->t - A_JULIAN_EPOCH_MS) / A_DAY_MS; return a->julianDay; }
static double a_true_anomaly(double meanAnomaly, double ecc) {
  double delta, E = meanAnomaly;
  do {
    delta = E - ecc * sin(E) - meanAnomaly;
    E = E - delta / (1 - ecc * cos(E));
  } while (fabs(delta) > 1e-5);
  return 2.0 * atan(tan(E / 2) * sqrt((1 + ecc) / (1 - ecc)));
}
static double a_sun_longitude(Astro *a) {
  if (isnan(a->sunLongitude)) {
    double day = a_jd(a) - A_JD_EPOCH;
    double epochAngle = a_norm2pi(A_PI * 2.0 / A_TROPICAL_YEAR * day);
    double sunEtaG = 279.403303 * A_PI / 180, sunOmegaG = 282.768422 * A_PI / 180;
    a->meanAnomalySun = a_norm2pi(epochAngle + sunEtaG - sunOmegaG);
    a->sunLongitude = a_norm2pi(a_true_anomaly(a->meanAnomalySun, 0.016713) + sunOmegaG);
  }
  return a->sunLongitude;
}
static void a_moon_position(Astro *a) {
  if (!isnan(a->moonEclipLong)) return;
  a_sun_longitude(a);
  const double moonL0 = 318.351648 * A_PI / 180, moonP0 = 36.340410 * A_PI / 180, moonN0 = 318.510107 * A_PI / 180, moonI = 5.145366 * A_PI / 180;
  double day = a_jd(a) - A_JD_EPOCH;
  double meanLongitude = a_norm2pi(13.1763966 * A_PI / 180 * day + moonL0);
  double meanAnomalyMoon = a_norm2pi(meanLongitude - 0.1114041 * A_PI / 180 * day - moonP0);
  double evection = 1.2739 * A_PI / 180 * sin(2 * (meanLongitude - a->sunLongitude) - meanAnomalyMoon);
  double annual = 0.1858 * A_PI / 180 * sin(a->meanAnomalySun);
  double a3 = 0.3700 * A_PI / 180 * sin(a->meanAnomalySun);
  meanAnomalyMoon += evection - annual - a3;
  double center = 6.2886 * A_PI / 180 * sin(meanAnomalyMoon);
  double a4 = 0.2140 * A_PI / 180 * sin(2 * meanAnomalyMoon);
  double moonLongitude = meanLongitude + evection + center - annual + a4;
  double variation = 0.6583 * A_PI / 180 * sin(2 * (moonLongitude - a->sunLongitude));
  moonLongitude += variation;
  double nodeLongitude = a_norm2pi(moonN0 - 0.0529539 * A_PI / 180 * day);
  nodeLongitude -= 0.16 * A_PI / 180 * sin(a->meanAnomalySun);
  double y = sin(moonLongitude - nodeLongitude);
  double x = cos(moonLongitude - nodeLongitude);
  a->moonEclipLong = atan2(y * cos(moonI), x) + nodeLongitude;
}
static double a_moon_age(Astro *a) { a_moon_position(a); return a_norm2pi(a->moonEclipLong - a->sunLongitude); }
typedef double (*AngleFn)(Astro *);
static double a_time_of_angle(Astro *a, AngleFn func, double desired, double periodDays, double epsilon, int next) {
  double lastAngle = func(a);
  double deltaAngle = a_norm2pi(desired - lastAngle);
  double deltaT = (deltaAngle + (next ? 0.0 : -(A_PI * 2.0))) * (periodDays * A_DAY_MS) / (A_PI * 2.0);
  double lastDeltaT = deltaT;
  double startTime = a->t;
  a_set(a, a->t + ceil(deltaT));
  do {
    double angle = func(a);
    double factor = fabs(deltaT / a_normpi(angle - lastAngle));
    deltaT = a_normpi(desired - angle) * factor;
    if (fabs(deltaT) > fabs(lastDeltaT)) {
      double delta = ceil(periodDays * A_DAY_MS / 8.0);
      a_set(a, startTime + (next ? delta : -delta));
      return a_time_of_angle(a, func, desired, periodDays, epsilon, next);
    }
    lastDeltaT = deltaT;
    lastAngle = angle;
    a_set(a, a->t + ceil(deltaT));
  } while (fabs(deltaT) > epsilon);
  return a->t;
}
static double a_sun_fn(Astro *a) { return a_sun_longitude(a); }
static double a_moon_fn(Astro *a) { return a_moon_age(a); }
static double a_sun_time(Astro *a, double desired, int next) { return a_time_of_angle(a, a_sun_fn, desired, A_TROPICAL_YEAR, A_MINUTE_MS, next); }
static double a_moon_time(Astro *a, double desired, int next) { return a_time_of_angle(a, a_moon_fn, desired, A_SYNODIC_MONTH, A_MINUTE_MS, next); }

/* small memo tables keyed by int (CalendarCache) */
typedef struct { int used[512]; int key[512]; int val[512]; } Memo;
static int memo_get(Memo *m, int key, int *out) {
  unsigned h = (unsigned)key * 2654435761u;
  for (int i = 0; i < 512; i++) {
    unsigned s = (h + (unsigned)i) & 511;
    if (!m->used[s]) return 0;
    if (m->key[s] == key) { *out = m->val[s]; return 1; }
  }
  return 0;
}
static void memo_put(Memo *m, int key, int val) {
  unsigned h = (unsigned)key * 2654435761u;
  for (int i = 0; i < 512; i++) {
    unsigned s = (h + (unsigned)i) & 511;
    if (!m->used[s] || m->key[s] == key) { m->used[s] = 1; m->key[s] = key; m->val[s] = val; return; }
  }
  memset(m, 0, sizeof *m); /* full: start over */
}

/* ── Islamic ─────────────────────────────────────────────────────────────────────────────────────────────── */
#define HIJRA_MILLIS -42521587200000.0
#define CIVIL_EPOC 1948440
#define ASTRONOMICAL_EPOC 1948439
#define UMALQURA_YEAR_START 1300
#define UMALQURA_YEAR_END 1600

static int civil_leap_year(int32_t year) { return (14 + 11 * (int64_t)year) % 30 < 11; }

static double moon_age_deg(double time) {
  Astro a; a_set(&a, time);
  double age = a_moon_age(&a) * 180 / A_PI;
  if (age > 180) age = age - 360;
  return age;
}

static Memo gMonthCache;
static int32_t true_month_start(int32_t month) {
  int cached;
  if (memo_get(&gMonthCache, month, &cached) && cached != 0) return cached;
  double origin = HIJRA_MILLIS + floor(month * A_SYNODIC_MONTH) * A_DAY_MS;
  double age = moon_age_deg(origin);
  if (age >= 0) {
    do { origin -= A_DAY_MS; age = moon_age_deg(origin); } while (age >= 0);
  } else {
    do { origin += A_DAY_MS; age = moon_age_deg(origin); } while (age < 0);
  }
  int64_t q = (int64_t)floor(((double)(int64_t)origin - HIJRA_MILLIS) / A_DAY_MS);
  int32_t start = (int32_t)(q + 1);
  memo_put(&gMonthCache, month, start);
  return start;
}

static int64_t islamic_year_start_civil(int32_t year) { return 354LL * (year - 1LL) + fdiv64(3 + 11LL * year, 30LL); }
static int64_t islamic_month_start_civil(int32_t year, int32_t month) { return (int64_t)ceil(29.5 * month) + 354LL * (year - 1LL) + fdiv64(11LL * (int64_t)year + 3LL, 30LL); }
static int32_t islamic_civil_month_length(int32_t year, int32_t month) {
  int32_t length = 29 + (month + 1) % 2;
  if (month == 11 && civil_leap_year(year)) length++;
  return length;
}
static int64_t um_year_start(int32_t year) {
  if (year < UMALQURA_YEAR_START || year > UMALQURA_YEAR_END) return islamic_year_start_civil(year);
  year -= UMALQURA_YEAR_START;
  int64_t est = (int64_t)((354.36720 * (double)year) + 460322.05 + 0.5);
  return est + kUmalquraYrStartEstimateFix[year];
}
static int32_t um_month_length(int32_t y, int32_t month) {
  if (y < UMALQURA_YEAR_START || y > UMALQURA_YEAR_END) return islamic_civil_month_length(y, month);
  int32_t length = 29, mask = 0x01 << (11 - month), index = y - UMALQURA_YEAR_START;
  if ((kUmalquraMonthLength[index] & mask) != 0) length++;
  return length;
}
static int32_t um_year_length(int32_t y) {
  if (y < UMALQURA_YEAR_START || y > UMALQURA_YEAR_END) return 354 + (civil_leap_year(y) ? 1 : 0);
  int length = 0;
  for (int i = 0; i < 12; i++) length += um_month_length(y, i);
  return length;
}
static int64_t um_month_start(int32_t year, int32_t month) {
  int64_t ms = um_year_start(year);
  for (int i = 0; i < month; i++) ms += um_month_length(year, i);
  return ms;
}

static void islamic_civil_fields(ScrCal *c, int32_t julianDay, int32_t epoc) {
  int32_t days = julianDay - epoc;
  int64_t year = fdiv64(30LL * days + 10646LL, 10631LL);
  int32_t month = (int32_t)ceil((days - 29 - islamic_year_start_civil((int32_t)year)) / 29.5);
  month = month < 11 ? month : 11;
  int64_t dayOfMonth = (days - islamic_month_start_civil((int32_t)year, month)) + 1;
  int64_t dayOfYear = (days - islamic_month_start_civil((int32_t)year, 0)) + 1;
  c->f[CAL_ERA] = 0; c->f[CAL_YEAR] = (int32_t)year; c->f[CAL_EXTENDED_YEAR] = (int32_t)year; c->f[CAL_MONTH] = month;
  c->f[CAL_ORDINAL_MONTH] = month; c->f[CAL_DATE] = (int32_t)dayOfMonth; c->f[CAL_DAY_OF_YEAR] = (int32_t)dayOfYear;
}
static void islamic_umalqura_fields(ScrCal *c, int32_t julianDay) {
  int32_t days = julianDay - CIVIL_EPOC;
  int64_t kStart = um_year_start(UMALQURA_YEAR_START);
  if (days < kStart) { islamic_civil_fields(c, julianDay, CIVIL_EPOC); return; }
  int64_t year = (int64_t)(((double)days - (460322.05 + 0.5)) / 354.36720) + UMALQURA_YEAR_START - 1;
  int32_t month = 0, d = 1;
  while (d > 0) {
    d = (int32_t)(days - um_year_start((int32_t)++year) + 1);
    int32_t length = um_year_length((int32_t)year);
    if (d == length) { month = 11; break; }
    if (d < length) {
      int32_t monthLen = um_month_length((int32_t)year, month);
      for (month = 0; d > monthLen; monthLen = um_month_length((int32_t)year, ++month)) d -= monthLen;
      break;
    }
  }
  int32_t dayOfMonth = (int32_t)(um_month_start((int32_t)year, month)), dayOfYear = (int32_t)(um_month_start((int32_t)year, 0));
  dayOfMonth = -dayOfMonth + days + 1;
  dayOfYear = -dayOfYear + days + 1;
  c->f[CAL_ERA] = 0; c->f[CAL_YEAR] = (int32_t)year; c->f[CAL_EXTENDED_YEAR] = (int32_t)year; c->f[CAL_MONTH] = month;
  c->f[CAL_ORDINAL_MONTH] = month; c->f[CAL_DATE] = dayOfMonth; c->f[CAL_DAY_OF_YEAR] = dayOfYear;
}
static int64_t islamic_astro_month_start(int32_t year, int32_t month) { return true_month_start((year - 1) * 12 + month); }
static void islamic_astro_fields(ScrCal *c, int32_t julianDay, double utcMs) {
  int32_t days = julianDay - CIVIL_EPOC;
  int32_t month = (int32_t)floor((double)days / A_SYNODIC_MONTH);
  int32_t startDate = (int32_t)floor(month * A_SYNODIC_MONTH);
  double age = moon_age_deg(utcMs);
  if (days - startDate >= 25 && age > 0) month++;
  while ((startDate = true_month_start(month)) > days) month--;
  int32_t year = month >= 0 ? ((month / 12) + 1) : ((month + 1) / 12);
  month = ((month % 12) + 12) % 12;
  int64_t dayOfMonth = (days - islamic_astro_month_start(year, month)) + 1;
  int64_t dayOfYear = (days - islamic_astro_month_start(year, 0)) + 1;
  c->f[CAL_ERA] = 0; c->f[CAL_YEAR] = year; c->f[CAL_EXTENDED_YEAR] = year; c->f[CAL_MONTH] = month; c->f[CAL_ORDINAL_MONTH] = month;
  c->f[CAL_DATE] = (int32_t)dayOfMonth; c->f[CAL_DAY_OF_YEAR] = (int32_t)dayOfYear;
}
static int32_t gregoYearFromIslamicStart(int32_t year) {
  int cycle, offset, shift = 0;
  if (year >= 1397) { cycle = (year - 1397) / 67; offset = (year - 1397) % 67; shift = 2 * cycle + ((offset >= 33) ? 1 : 0); }
  else { cycle = (year - 1396) / 67 - 1; offset = -(year - 1396) % 67; shift = 2 * cycle + ((offset <= 33) ? 1 : 0); }
  return year + 579 - shift;
}

/* ── Persian ─────────────────────────────────────────────────────────────────────────────────────────────── */
#define PERSIAN_EPOCH 1948320
static const int16_t kPersianNumDays[12] = {0, 31, 62, 93, 124, 155, 186, 216, 246, 276, 306, 336};
static int persian_nonleap(int32_t y) {
  for (size_t i = 0; i < sizeof kPersianNonLeapYears / sizeof *kPersianNonLeapYears; i++) if (kPersianNonLeapYears[i] == y) return 1;
  return 0;
}
static int64_t persian_first_julian_of_year(int64_t year) {
  int64_t jd = 365LL * (year - 1LL) + fdiv64(8LL * year + 21, 33);
  if (year > 1502 && persian_nonleap((int32_t)(year - 1))) jd--;
  return jd;
}
static void persian_fields(ScrCal *c, int32_t julianDay) {
  int64_t daysSinceEpoch = (int64_t)julianDay - PERSIAN_EPOCH;
  int64_t year = fdiv64(33LL * daysSinceEpoch + 3LL, 12053LL) + 1LL;
  int64_t farvardin1 = persian_first_julian_of_year(year);
  int32_t dayOfYear = (int32_t)(daysSinceEpoch - farvardin1);
  if (dayOfYear == 365 && year >= 1502 && persian_nonleap((int32_t)year)) { year++; dayOfYear = 0; }
  int32_t month = dayOfYear < 216 ? dayOfYear / 31 : (dayOfYear - 6) / 30;
  ++dayOfYear;
  int32_t dayOfMonth = dayOfYear - kPersianNumDays[month];
  c->f[CAL_ERA] = 0; c->f[CAL_YEAR] = (int32_t)year; c->f[CAL_EXTENDED_YEAR] = (int32_t)year; c->f[CAL_MONTH] = month;
  c->f[CAL_ORDINAL_MONTH] = month; c->f[CAL_DATE] = dayOfMonth; c->f[CAL_DAY_OF_YEAR] = dayOfYear;
}

/* ── Indian ──────────────────────────────────────────────────────────────────────────────────────────────── */
static void indian_fields(ScrCal *c, int32_t julianDay, int32_t gregYear) {
  const int INDIAN_ERA_START = 78, INDIAN_YEAR_START = 80;
  int32_t IndianYear = gregYear - INDIAN_ERA_START;
  double jdAtStart = (double)grego_fields_to_day(gregYear, 0, 1) + kEpochStartAsJulianDay - 0.5;
  int32_t yday = (int32_t)(julianDay - jdAtStart);
  int32_t leapMonth, IndianMonth, IndianDay, mday;
  if (yday < INDIAN_YEAR_START) {
    IndianYear -= 1;
    leapMonth = grego_leap(gregYear - 1) ? 31 : 30;
    yday += leapMonth + (31 * 5) + (30 * 3) + 10;
  } else {
    leapMonth = grego_leap(gregYear) ? 31 : 30;
    yday -= INDIAN_YEAR_START;
  }
  if (yday < leapMonth) { IndianMonth = 0; IndianDay = yday + 1; }
  else {
    mday = yday - leapMonth;
    if (mday < (31 * 5)) { IndianMonth = (int32_t)floor(mday / 31) + 1; IndianDay = (mday % 31) + 1; }
    else { mday -= 31 * 5; IndianMonth = (int32_t)floor(mday / 30) + 6; IndianDay = (mday % 30) + 1; }
  }
  c->f[CAL_ERA] = 0; c->f[CAL_EXTENDED_YEAR] = IndianYear; c->f[CAL_YEAR] = IndianYear; c->f[CAL_MONTH] = IndianMonth;
  c->f[CAL_ORDINAL_MONTH] = IndianMonth; c->f[CAL_DATE] = IndianDay; c->f[CAL_DAY_OF_YEAR] = yday + 1;
}

/* ── Coptic / Ethiopic ───────────────────────────────────────────────────────────────────────────────────── */
static void ce_fields(ScrCal *c, int32_t julianDay, int32_t epochOffset, int type) {
  int32_t jd = julianDay - epochOffset, r4;
  int32_t c4 = fdiv32r(jd, 1461, &r4);
  int32_t year = 4 * c4 + (r4 / 365 - r4 / 1460);
  int32_t doy = (r4 == 1460) ? 365 : (r4 % 365);
  int32_t month = doy / 30, day = (doy % 30) + 1;
  doy++;
  int32_t era, y;
  switch (type) {
    case CT_COPTIC: era = year <= 0 ? 0 : 1; y = year <= 0 ? 1 - year : year; break;
    case CT_ETHIOPIC: era = year <= 0 ? 0 : 1; y = year <= 0 ? year + 5500 : year; break;
    default: era = 0; y = year; break;
  }
  c->f[CAL_EXTENDED_YEAR] = year; c->f[CAL_ERA] = era; c->f[CAL_YEAR] = y; c->f[CAL_MONTH] = month; c->f[CAL_ORDINAL_MONTH] = month;
  c->f[CAL_DATE] = day; c->f[CAL_DAY_OF_YEAR] = doy;
}

/* ── Hebrew ──────────────────────────────────────────────────────────────────────────────────────────────── */
static const int8_t kHebMonthLength[13][3] = {{30, 30, 30}, {29, 29, 30}, {29, 30, 30}, {29, 29, 29}, {30, 30, 30}, {30, 30, 30}, {29, 29, 29}, {30, 30, 30}, {29, 29, 29}, {30, 30, 30}, {29, 29, 29}, {30, 30, 30}, {29, 29, 29}};
static const int16_t kHebMonthStart[14][3] = {{0, 0, 0}, {30, 30, 30}, {59, 59, 60}, {88, 89, 90}, {117, 118, 119}, {147, 148, 149}, {147, 148, 149}, {176, 177, 178}, {206, 207, 208}, {235, 236, 237}, {265, 266, 267}, {294, 295, 296}, {324, 325, 326}, {353, 354, 355}};
static const int16_t kHebLeapMonthStart[14][3] = {{0, 0, 0}, {30, 30, 30}, {59, 59, 60}, {88, 89, 90}, {117, 118, 119}, {147, 148, 149}, {177, 178, 179}, {206, 207, 208}, {236, 237, 238}, {265, 266, 267}, {295, 296, 297}, {324, 325, 326}, {354, 355, 356}, {383, 384, 385}};
#define HOUR_PARTS 1080
#define DAY_PARTS (24 * HOUR_PARTS)
#define MONTH_FRACT (12 * HOUR_PARTS + 793)
#define MONTH_PARTS (29 * DAY_PARTS + MONTH_FRACT)
#define BAHARAD (11 * HOUR_PARTS + 204)
static int hebrew_is_leap(int32_t year) { int64_t x = (year * 12LL + 17) % 19; return x >= ((x < 0) ? -7 : 12); }
static Memo gHebCache;
static int32_t hebrew_start_of_year(int32_t year) {
  int cached;
  if (memo_get(&gHebCache, year, &cached) && cached != 0) return cached;
  int64_t months = fdiv64(235LL * (int64_t)year - 234LL, 19LL);
  int64_t frac = months * MONTH_FRACT + BAHARAD;
  int64_t day = months * 29LL + frac / DAY_PARTS;
  frac = frac % DAY_PARTS;
  int32_t wd = (int32_t)(day % 7);
  if (wd == 2 || wd == 4 || wd == 6) { day += 1; wd = (int32_t)(day % 7); }
  else if (wd == 1 && frac > 15 * HOUR_PARTS + 204 && !hebrew_is_leap(year)) day += 2;
  else if (wd == 0 && frac > 21 * HOUR_PARTS + 589 && hebrew_is_leap(year - 1)) day += 1;
  memo_put(&gHebCache, year, (int32_t)day);
  return (int32_t)day;
}
static int32_t hebrew_days_in_year(int32_t y) { return hebrew_start_of_year(y + 1) - hebrew_start_of_year(y); }
static int hebrew_year_type(int32_t year) {
  int32_t yl = hebrew_days_in_year(year);
  if (yl > 380) yl -= 30;
  switch (yl) { case 353: return 0; case 354: return 1; case 355: return 2; default: return 1; }
}
static void hebrew_fields(ScrCal *c, int32_t julianDay) {
  int32_t d = julianDay - 347997;
  double m = floor((d * (double)DAY_PARTS) / (double)MONTH_PARTS);
  int32_t year = (int32_t)(floor((19. * m + 234.) / 235.) + 1.);
  int32_t ys = hebrew_start_of_year(year);
  int32_t dayOfYear = d - ys;
  while (dayOfYear < 1) { year--; ys = hebrew_start_of_year(year); dayOfYear = d - ys; }
  int type = hebrew_year_type(year);
  int isLeap = hebrew_is_leap(year);
  int month = 0;
  while (month < 14 && dayOfYear > (isLeap ? kHebLeapMonthStart[month][type] : kHebMonthStart[month][type])) month++;
  if (month >= 14 || month <= 0) month = 1;
  month--;
  int dayOfMonth = dayOfYear - (isLeap ? kHebLeapMonthStart[month][type] : kHebMonthStart[month][type]);
  int ordinal = month;
  if (!isLeap && ordinal > 5) ordinal--;
  c->f[CAL_ERA] = 0; c->f[CAL_YEAR] = year; c->f[CAL_EXTENDED_YEAR] = year; c->f[CAL_ORDINAL_MONTH] = ordinal; c->f[CAL_MONTH] = month;
  c->f[CAL_DATE] = dayOfMonth; c->f[CAL_DAY_OF_YEAR] = dayOfYear;
  c->hebrewLeap = isLeap;
}

/* ── Chinese / Dangi ─────────────────────────────────────────────────────────────────────────────────────── */
#define SYNODIC_GAP 25
#define CHINA_OFFSET_MS (8 * 3600000)
typedef struct { int dangi; Memo *winter, *newYear; } CSetting;
static Memo gChinaWinter, gChinaNewYear, gDangiWinter, gDangiNewYear;
/* the astronomer zone: China is a fixed +8; Korea changes in 1897, 1898 and 1912 (dangical.cpp) */
static int32_t csetting_offset_ms(const CSetting *s, double millis) {
  if (!s->dangi) return CHINA_OFFSET_MS;
  const double m1897 = (double)((1897 - 1970) * 365LL) * 86400000.0, m1898 = (double)((1898 - 1970) * 365LL) * 86400000.0, m1912 = (double)((1912 - 1970) * 365LL) * 86400000.0;
  if (millis >= m1912) return 9 * 3600000;
  if (millis >= m1898) return 8 * 3600000;
  if (millis >= m1897) return 7 * 3600000;
  return 8 * 3600000;
}
static double c_days_to_millis(const CSetting *s, double days) {
  double millis = days * 86400000.0;
  return millis - (double)csetting_offset_ms(s, millis);
}
static double c_millis_to_days(const CSetting *s, double millis) {
  return floor((millis + (double)csetting_offset_ms(s, millis)) / 86400000.0);
}
static int32_t c_new_moon_near(const CSetting *s, double days, int after) {
  double ms = c_days_to_millis(s, days);
  Astro a; a_set(&a, ms);
  return (int32_t)c_millis_to_days(s, a_moon_time(&a, 0.0, after));
}
static int32_t c_synodic_months_between(int32_t d1, int32_t d2) {
  double roundme = ((d2 - d1) / A_SYNODIC_MONTH);
  return (int32_t)(roundme + (roundme >= 0 ? .5 : -.5));
}
static int32_t c_major_solar_term(const CSetting *s, int32_t days) {
  double ms = c_days_to_millis(s, days);
  Astro a; a_set(&a, ms);
  int32_t term = (((int32_t)(6 * a_sun_longitude(&a) / A_PI)) + 2) % 12;
  if (term < 1) term += 12;
  return term;
}
static int c_has_no_major_solar_term(const CSetting *s, int32_t newMoon) {
  int32_t t1 = c_major_solar_term(s, newMoon);
  int32_t t2 = c_major_solar_term(s, c_new_moon_near(s, newMoon + SYNODIC_GAP, 1));
  return t1 == t2;
}
static int c_is_leap_month_between(const CSetting *s, int32_t nm1, int32_t nm2) {
  while (nm2 >= nm1) {
    if (c_has_no_major_solar_term(s, nm2)) return 1;
    nm2 = c_new_moon_near(s, nm2 - SYNODIC_GAP, 0);
  }
  return 0;
}
static int32_t c_winter_solstice(const CSetting *s, int32_t gyear) {
  int cached;
  if (memo_get(s->winter, gyear, &cached) && cached != 0) return cached;
  double ms = c_days_to_millis(s, (double)grego_fields_to_day(gyear, 11, 1));
  Astro a; a_set(&a, ms);
  double days = c_millis_to_days(s, a_sun_time(&a, (A_PI * 3) / 2, 1));
  int32_t v = (int32_t)days;
  memo_put(s->winter, gyear, v);
  return v;
}
static int32_t c_new_year(const CSetting *s, int32_t gyear) {
  int cached;
  if (memo_get(s->newYear, gyear, &cached) && cached != 0) return cached;
  int32_t solsticeBefore = c_winter_solstice(s, gyear - 1), solsticeAfter = c_winter_solstice(s, gyear);
  int32_t newMoon1 = c_new_moon_near(s, solsticeBefore + 1, 1);
  int32_t newMoon2 = c_new_moon_near(s, newMoon1 + SYNODIC_GAP, 1);
  int32_t newMoon11 = c_new_moon_near(s, solsticeAfter + 1, 0);
  int32_t v;
  if (c_synodic_months_between(newMoon1, newMoon11) == 12 && (c_has_no_major_solar_term(s, newMoon1) || c_has_no_major_solar_term(s, newMoon2)))
    v = c_new_moon_near(s, newMoon2 + SYNODIC_GAP, 1);
  else v = newMoon2;
  memo_put(s->newYear, gyear, v);
  return v;
}
typedef struct { int32_t month, ordinalMonth, thisMoon; int isLeapMonth, hasLeapBetween; } MonthInfo;
static int c_month_info(const CSetting *s, int32_t gyear, int32_t days, MonthInfo *o) {
  memset(o, 0, sizeof *o);
  int32_t solsticeBefore, solsticeAfter = c_winter_solstice(s, gyear);
  if (days < solsticeAfter) solsticeBefore = c_winter_solstice(s, gyear - 1);
  else { solsticeBefore = solsticeAfter; solsticeAfter = c_winter_solstice(s, gyear + 1); }
  if (!(solsticeBefore <= days && days < solsticeAfter)) return -1;
  int32_t firstMoon = c_new_moon_near(s, solsticeBefore + 1, 1);
  int32_t lastMoon = c_new_moon_near(s, solsticeAfter + 1, 0);
  o->thisMoon = c_new_moon_near(s, days + 1, 0);
  o->hasLeapBetween = c_synodic_months_between(firstMoon, lastMoon) == 12;
  o->month = c_synodic_months_between(firstMoon, o->thisMoon);
  int32_t theNewYear = c_new_year(s, gyear);
  if (days < theNewYear) theNewYear = c_new_year(s, gyear - 1);
  if (o->hasLeapBetween && c_is_leap_month_between(s, firstMoon, o->thisMoon)) o->month--;
  if (o->month < 1) o->month += 12;
  o->ordinalMonth = c_synodic_months_between(theNewYear, o->thisMoon);
  if (o->ordinalMonth < 0) o->ordinalMonth += 12;
  o->isLeapMonth = o->hasLeapBetween && c_has_no_major_solar_term(s, o->thisMoon) &&
                   !c_is_leap_month_between(s, firstMoon, c_new_moon_near(s, o->thisMoon - SYNODIC_GAP, 0));
  return 0;
}
static int chinese_fields(ScrCal *c, int32_t julianDay, int32_t gyear, int32_t gmonth, int dangi) {
  CSetting s = {dangi, dangi ? &gDangiWinter : &gChinaWinter, dangi ? &gDangiNewYear : &gChinaNewYear};
  int32_t days = julianDay - kEpochStartAsJulianDay;
  MonthInfo mi;
  if (c_month_info(&s, gyear, days, &mi) != 0) return -1;
  int32_t eyear = gyear - 1;               /* CHINESE_EPOCH_YEAR */
  int32_t cycle_year = gyear + 2636;       /* CYCLE_EPOCH */
  if (mi.month < 11 || gmonth >= 6 /* July */) { eyear++; cycle_year++; }
  int32_t dayOfMonth = days - mi.thisMoon + 1;
  int32_t yearOfCycle;
  int32_t cycle = fdiv32r(cycle_year - 1, 60, &yearOfCycle);
  int32_t theNewYear = c_new_year(&s, gyear);
  if (days < theNewYear) theNewYear = c_new_year(&s, gyear - 1);
  cycle++; yearOfCycle++;
  int32_t dayOfYear = days - theNewYear + 1;
  c->f[CAL_MONTH] = mi.month - 1; c->f[CAL_ORDINAL_MONTH] = mi.ordinalMonth; c->f[CAL_IS_LEAP_MONTH] = mi.isLeapMonth ? 1 : 0;
  c->f[CAL_EXTENDED_YEAR] = eyear; c->f[CAL_ERA] = cycle; c->f[CAL_YEAR] = yearOfCycle; c->f[CAL_DATE] = dayOfMonth; c->f[CAL_DAY_OF_YEAR] = dayOfYear;
  return 0;
}

static int year_length(ScrCal *c, int32_t eyear) {
  switch (c->type) {
    case CT_GREGORIAN: case CT_ISO8601: return grego_leap(eyear) ? 366 : 365;
    case CT_BUDDHIST: case CT_ROC: case CT_JAPANESE:
      /* GregorianCalendar::handleGetYearLength: the cutover year is 355 days, Julian years before it */
      if (eyear == kDefaultCutoverYear) return 355;
      if (eyear < kDefaultCutoverYear) return (eyear & 3) == 0 ? 366 : 365;
      return grego_leap(eyear) ? 366 : 365;
    case CT_HEBREW: return hebrew_days_in_year(eyear);
    case CT_PERSIAN: return (int)(persian_first_julian_of_year(eyear + 1) - persian_first_julian_of_year(eyear));
    case CT_ISLAMIC_CIVIL: case CT_ISLAMIC_TBLA: return 354 + (civil_leap_year(eyear) ? 1 : 0);
    case CT_ISLAMIC_UMALQURA: return um_year_length(eyear);
    case CT_INDIAN: return grego_leap(eyear + 78) ? 366 : 365;
    case CT_COPTIC: case CT_ETHIOPIC: case CT_ETHIOPIC_AA: return (eyear % 4 == 3 || eyear % 4 == -1) ? 366 : 365;
    default: return 354;
  }
}

int scr_cal_compute(ScrCal *c, int type, double utcMs, int32_t rawOffsetMs, int32_t dstOffsetMs) {
  int32_t firstDow = c->firstDayOfWeek, minDays = c->minimalDays;
  memset(c, 0, sizeof *c);
  c->firstDayOfWeek = firstDow; c->minimalDays = minDays;
  c->type = type;
  double local = utcMs + (double)rawOffsetMs + (double)dstOffsetMs;
  double dayD = floor(local / U_MILLIS_PER_DAY);
  double rem = local - dayD * U_MILLIS_PER_DAY;
  if (rem < 0 || rem >= U_MILLIS_PER_DAY) { dayD += rem < 0 ? -1 : 1; rem = local - dayD * U_MILLIS_PER_DAY; }
  double jdD = dayD + kEpochStartAsJulianDay;
  if (jdD > INT32_MAX || jdD < INT32_MIN) return -1;
  int32_t julianDay = (int32_t)jdD;
  int32_t millisInDay = (int32_t)rem;
  c->f[CAL_JULIAN_DAY] = julianDay;
  GregFields g;
  int cutover = !(type == CT_GREGORIAN || type == CT_ISO8601); /* V8 moves the change to the start of time for these two */
  switch (type) {
    case CT_GREGORIAN: case CT_ISO8601: case CT_BUDDHIST: case CT_ROC: case CT_JAPANESE: {
      greg_compute(julianDay, cutover, &g);
      c->f[CAL_DAY_OF_WEEK] = g.dow;
      c->f[CAL_MONTH] = g.month; c->f[CAL_ORDINAL_MONTH] = g.month; c->f[CAL_DATE] = g.dom; c->f[CAL_DAY_OF_YEAR] = g.doy;
      c->f[CAL_EXTENDED_YEAR] = g.eyear;
      int32_t ey = g.eyear;
      if (type == CT_BUDDHIST) { c->f[CAL_ERA] = 0; c->f[CAL_YEAR] = g.eyear + 543; }
      else if (type == CT_ROC) {
        int32_t y = g.eyear - 1911;
        if (y > 0) { c->f[CAL_ERA] = 1; c->f[CAL_YEAR] = y; } else { c->f[CAL_ERA] = 0; c->f[CAL_YEAR] = 1 - y; }
      } else if (type == CT_JAPANESE) {
        int era = japanese_era_code(g.eyear, g.month + 1, g.dom);
        c->f[CAL_ERA] = era;
        c->f[CAL_YEAR] = g.eyear - (japanese_start_year(era) - 1);
      } else {
        if (ey < 1) { c->f[CAL_ERA] = 0; c->f[CAL_YEAR] = 1 - ey; } else { c->f[CAL_ERA] = 1; c->f[CAL_YEAR] = ey; }
      }
      break;
    }
    case CT_PERSIAN: persian_fields(c, julianDay); { GregFields g2; greg_compute(julianDay, 0, &g2); c->f[CAL_DAY_OF_WEEK] = g2.dow; } break;
    case CT_INDIAN: { GregFields g2; greg_compute(julianDay, 0, &g2); c->f[CAL_DAY_OF_WEEK] = g2.dow; indian_fields(c, julianDay, g2.eyear); } break;
    case CT_COPTIC: case CT_ETHIOPIC: case CT_ETHIOPIC_AA: {
      GregFields g2; greg_compute(julianDay, 0, &g2); c->f[CAL_DAY_OF_WEEK] = g2.dow;
      ce_fields(c, julianDay, type == CT_COPTIC ? 1824665 : type == CT_ETHIOPIC ? 1723856 : -285019, type);
      break;
    }
    case CT_ISLAMIC_CIVIL: case CT_ISLAMIC_TBLA: case CT_ISLAMIC_UMALQURA: case CT_ISLAMIC: case CT_ISLAMIC_RGSA: {
      GregFields g2; greg_compute(julianDay, 0, &g2); c->f[CAL_DAY_OF_WEEK] = g2.dow;
      if (type == CT_ISLAMIC_CIVIL) islamic_civil_fields(c, julianDay, CIVIL_EPOC);
      else if (type == CT_ISLAMIC_TBLA) islamic_civil_fields(c, julianDay, ASTRONOMICAL_EPOC);
      else if (type == CT_ISLAMIC_UMALQURA) islamic_umalqura_fields(c, julianDay);
      else islamic_astro_fields(c, julianDay, utcMs);
      break;
    }
    case CT_HEBREW: { GregFields g2; greg_compute(julianDay, 0, &g2); c->f[CAL_DAY_OF_WEEK] = g2.dow; hebrew_fields(c, julianDay); } break;
    case CT_CHINESE: case CT_DANGI: {
      GregFields g2; greg_compute(julianDay, 0, &g2); c->f[CAL_DAY_OF_WEEK] = g2.dow;
      if (chinese_fields(c, julianDay, g2.eyear, g2.month, type == CT_DANGI) != 0) return -1;
      break;
    }
    default:
      return -1;
  }
  week_fields(c);
  time_fields(c, millisInDay, rawOffsetMs, dstOffsetMs);
  {
    int32_t ey = c->f[CAL_EXTENDED_YEAR], diff = 0;
    switch (type) {
      case CT_PERSIAN: diff = 622; break; case CT_COPTIC: diff = 284; break; case CT_ETHIOPIC: diff = 8; break;
      case CT_INDIAN: diff = 79; break; case CT_HEBREW: diff = -3760; break;
      default: break;
    }
    if (type == CT_ISLAMIC || type == CT_ISLAMIC_CIVIL || type == CT_ISLAMIC_TBLA || type == CT_ISLAMIC_UMALQURA || type == CT_ISLAMIC_RGSA) c->relatedYear = gregoYearFromIslamicStart(ey);
    else c->relatedYear = ey + diff;
  }
  return 0;
}
