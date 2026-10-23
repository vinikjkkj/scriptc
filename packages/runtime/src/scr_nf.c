/* Intl.NumberFormat / Number.prototype.toLocaleString for every CLDR locale: the ECMA-402 option algorithm with
 * V8's validation order and messages, ICU's number formatting pipeline (rounding on the shortest decimal digits,
 * notation, grouping, patterns, symbols, plural-dependent compact/unit/currency names) over the CLDR 48.0.0 store.
 *
 * Entry: scr_nf_format_core() (also used by the standalone lab harness) and scr_nf_format() (ScrStr result). */
#include "scr_ures.h"
#include "scr_locale.h"
#include "scr_nf.h"
#include <math.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "scr_nf_cat.h"

/* ── growable buffer ─────────────────────────────────────────────────────────────────────────────────────── */
typedef struct { char *p; size_t n, cap; } Buf;
static void b_reserve(Buf *b, size_t add) {
  if (b->n + add + 1 > b->cap) {
    size_t nc = b->cap ? b->cap * 2 : 128;
    while (nc < b->n + add + 1) nc *= 2;
    b->p = realloc(b->p, nc);
    if (!b->p) abort();
    b->cap = nc;
  }
}
static void b_put(Buf *b, const char *s, size_t n) { b_reserve(b, n); memcpy(b->p + b->n, s, n); b->n += n; b->p[b->n] = 0; }
static void b_puts(Buf *b, const char *s) { b_put(b, s, strlen(s)); }
static void b_putc(Buf *b, char c) { b_put(b, &c, 1); }
static void b_free(Buf *b) { free(b->p); b->p = NULL; b->n = b->cap = 0; }

/* ── decimal quantity: value = int(d) * 10^exp; d has no leading or trailing zeros; n == 0 is zero ───────────── */
typedef struct { char *d; int n; long exp; } Dec;
static void dec_free(Dec *q) { free(q->d); q->d = NULL; q->n = 0; q->exp = 0; }
static void dec_norm(Dec *q) {
  int s = 0;
  while (s < q->n && q->d[s] == '0') s++;
  if (s) { memmove(q->d, q->d + s, (size_t)(q->n - s)); q->n -= s; }
  while (q->n > 0 && q->d[q->n - 1] == '0') { q->n--; q->exp++; }
  if (q->n == 0) q->exp = 0;
}
static Dec dec_zero(void) { Dec q; q.d = malloc(1); q.n = 0; q.exp = 0; return q; }
static Dec dec_copy(const Dec *a) { Dec q; q.d = malloc((size_t)a->n + 1); memcpy(q.d, a->d, (size_t)a->n); q.n = a->n; q.exp = a->exp; return q; }
static long dec_mag(const Dec *q) { return q->n == 0 ? 0 : q->n - 1 + q->exp; }

#ifdef SCR_NF_STANDALONE
static size_t nf_f64_to_str(double x, char *buf) {
  for (int p = 1; p <= 17; p++) {
    snprintf(buf, 40, "%.*e", p - 1, x);
    if (strtod(buf, NULL) == x) break;
  }
  return strlen(buf);
}
#else
#include "scr_runtime.h"
static size_t nf_f64_to_str(double x, char *buf) { return scr_f64_to_str(x, buf); }
#endif

/* x finite and >= 0 */
static Dec dec_from_double(double x) {
  char buf[64];
  nf_f64_to_str(x, buf);
  Dec q;
  q.d = malloc(strlen(buf) + 2);
  q.n = 0;
  long e10 = 0;
  int frac = 0, seen_dot = 0;
  const char *p = buf;
  for (; *p && *p != 'e' && *p != 'E'; p++) {
    if (*p == '.') { seen_dot = 1; continue; }
    q.d[q.n++] = *p;
    if (seen_dot) frac++;
  }
  if (*p) e10 = strtol(p + 1, NULL, 10);
  q.exp = e10 - frac;
  dec_norm(&q);
  return q;
}
/* digits: decimal integer text without sign */
static Dec dec_from_digits(const char *s, size_t n) {
  Dec q;
  q.d = malloc(n + 1);
  memcpy(q.d, s, n);
  q.n = (int)n;
  q.exp = 0;
  dec_norm(&q);
  return q;
}

/* ICU's DecimalQuantity::_setToDoubleFast: the BCD digits a double starts with. They are approximate for a
 * fractional double or one beyond 2^53, and ICU's increment rounding divides THOSE digits (it only switches to the
 * shortest representation when it rounds to a magnitude). */
static Dec dec_from_double_fast(double x) {
  uint64_t bits;
  memcpy(&bits, &x, sizeof bits);
  int exponent = (int)((bits & 0x7ff0000000000000ULL) >> 52) - 0x3ff;
  if ((exponent <= 52 && (double)(long long)x == x) || exponent == -1023 || exponent == 1024) return dec_from_double(x);
  static const double MULT[] = {1e0, 1e1, 1e2, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12, 1e13, 1e14, 1e15, 1e16, 1e17, 1e18, 1e19, 1e20, 1e21, 1e22};
  int fracLength = (int)((52 - exponent) / 3.32192809488736234787031942948939017586);
  double v = x;
  if (fracLength >= 0) {
    int i = fracLength;
    for (; i >= 22; i -= 22) v *= 1e22;
    v *= MULT[i];
  } else {
    int i = fracLength;
    for (; i <= -22; i += 22) v /= 1e22;
    v /= MULT[-i];
  }
  long long r = (long long)floor(v + 0.5); /* uprv_round */
  if (r == 0) return dec_zero();
  char buf[32];
  int len = snprintf(buf, sizeof buf, "%lld", r);
  Dec q = dec_from_digits(buf, (size_t)len);
  q.exp -= fracLength;
  return q;
}

typedef enum { RM_CEIL, RM_FLOOR, RM_EXPAND, RM_TRUNC, RM_HALF_CEIL, RM_HALF_FLOOR, RM_HALF_EXPAND, RM_HALF_TRUNC, RM_HALF_EVEN } RMode;

/* Round to a multiple of inc * 10^pos. */
static void dec_round(Dec *q, long pos, int inc, RMode mode, int neg) {
  if (q->n == 0) return;
  long dc = pos - q->exp; /* digits dropped (may be <= 0) */
  if (dc <= 0 && inc == 1) return;
  if (dc < 0) { /* express the value in units of 10^pos: append zeros */
    long add = -dc;
    q->d = realloc(q->d, (size_t)q->n + (size_t)add + 1);
    memset(q->d + q->n, '0', (size_t)add);
    q->n += (int)add;
    q->exp = pos;
    dc = 0;
  }
  int n = q->n;
  /* K = leading digits kept, R = dropped digits */
  long kn = dc > 0 ? (long)n - dc : n; /* count of kept digits, may be <= 0 */
  int rcmp = 0; /* 0: R == 0, 1: 0 < R < half, 2: R == half, 3: R > half */
  if (dc > 0) {
    if (dc > n) rcmp = 1;
    else {
      int f = q->d[n - dc] - '0';
      if (f > 5) rcmp = 3;
      else if (f < 5) rcmp = 1;
      else rcmp = (dc == 1) ? 2 : 3;
      /* d has no trailing zeros, so any digit after f is part of a nonzero tail */
    }
  }
  if (kn < 0) kn = 0;
  /* last four kept digits as an integer */
  long L = 0;
  long hn = kn > 4 ? kn - 4 : 0; /* count of high digits */
  for (long i = hn; i < kn; i++) L = L * 10 + (q->d[i] - '0');
  long rem = L % inc;
  int nz = rem > 0 || rcmp > 0;
  int cmp; /* remainder vs half of inc: -1 below, 0 equal, 1 above */
  if (inc % 2 == 0) {
    long hh = inc / 2;
    if (rem > hh) cmp = 1; else if (rem < hh) cmp = -1; else cmp = rcmp == 0 ? 0 : 1;
  } else {
    long hh = (inc - 1) / 2;
    if (rem > hh) cmp = 1; else if (rem < hh) cmp = -1;
    else cmp = rcmp == 0 ? -1 : (rcmp == 1 ? -1 : (rcmp == 2 ? 0 : 1));
  }
  int odd = (((L - rem) / inc) & 1) != 0;
  int up = 0;
  switch (mode) {
    case RM_CEIL: up = nz && !neg; break;
    case RM_FLOOR: up = nz && neg; break;
    case RM_EXPAND: up = nz; break;
    case RM_TRUNC: up = 0; break;
    case RM_HALF_CEIL: up = cmp > 0 || (cmp == 0 && !neg); break;
    case RM_HALF_FLOOR: up = cmp > 0 || (cmp == 0 && neg); break;
    case RM_HALF_EXPAND: up = cmp >= 0; break;
    case RM_HALF_TRUNC: up = cmp > 0; break;
    case RM_HALF_EVEN: up = cmp > 0 || (cmp == 0 && odd); break;
  }
  long L2 = L - rem + (up ? inc : 0);
  char *nd = malloc((size_t)hn + 8);
  int nn = 0;
  memcpy(nd, q->d, (size_t)hn);
  nn = (int)hn;
  long carry = L2 / 10000;
  L2 %= 10000;
  if (carry) {
    /* add carry (0 or 1) to the high digits */
    int i = nn - 1;
    long c = carry;
    while (c && i >= 0) { int v = nd[i] - '0' + (int)c; nd[i] = (char)('0' + v % 10); c = v / 10; i--; }
    if (c) { memmove(nd + 1, nd, (size_t)nn); nd[0] = (char)('0' + c); nn++; }
  }
  if (nn > 0 || carry) {
    nd[nn++] = (char)('0' + L2 / 1000); nd[nn++] = (char)('0' + L2 / 100 % 10);
    nd[nn++] = (char)('0' + L2 / 10 % 10); nd[nn++] = (char)('0' + L2 % 10);
  } else {
    char t[8];
    int tn = snprintf(t, sizeof t, "%ld", L2);
    if (L2 == 0) tn = 0;
    memcpy(nd + nn, t, (size_t)tn);
    nn += tn;
  }
  free(q->d);
  q->d = nd;
  q->n = nn;
  q->exp = pos;
  dec_norm(q);
}

/* ── options ─────────────────────────────────────────────────────────────────────────────────────────────── */
typedef enum { ST_DECIMAL, ST_PERCENT, ST_CURRENCY, ST_UNIT } Style;
typedef enum { CD_SYMBOL, CD_NARROW, CD_CODE, CD_NAME } CurDisp;
typedef enum { NT_STANDARD, NT_SCIENTIFIC, NT_ENGINEERING, NT_COMPACT } Notation;
typedef enum { SD_AUTO, SD_NEVER, SD_ALWAYS, SD_EXCEPT_ZERO, SD_NEGATIVE } SignDisp;
typedef enum { RT_FRACTION, RT_SIG, RT_MORE, RT_LESS } RType;
typedef enum { UG_FALSE, UG_AUTO, UG_ALWAYS, UG_MIN2 } UGroup;

typedef struct {
  Style style;
  char currency[4];
  CurDisp curDisp;
  int accounting;
  char unit[64];
  int unitDisp; /* 0 short 1 narrow 2 long */
  Notation notation;
  int compactLong;
  SignDisp sign;
  UGroup group;
  int minInt, minFrac, maxFrac, minSig, maxSig;
  RType rtype;
  int incr;
  RMode rmode;
  int stripZero;
  char nu[24];
  int hasNu;
} NfOpts;

typedef struct {
  const char **kv; /* key0, tagged value0, key1, ... */
  int nkv;
  Buf err;
  int errKind; /* 0 ok, 1 RangeError, 2 TypeError */
} NfCtx;

static void nf_fail(NfCtx *c, int kind, const char *fmt, ...) {
  va_list ap;
  va_start(ap, fmt);
  char tmp[512];
  vsnprintf(tmp, sizeof tmp, fmt, ap);
  va_end(ap);
  b_puts(&c->err, tmp);
  c->errKind = kind;
}

/* value of an option as its tagged text, or NULL when undefined. Tags: 's' string, 'n' number, 'b' boolean. */
static const char *opt_get(NfCtx *c, const char *key) {
  for (int i = 0; i < c->nkv; i++)
    if (strcmp(c->kv[2 * i], key) == 0) {
      const char *v = c->kv[2 * i + 1];
      if (v[0] == 'u') return NULL;
      return v;
    }
  return NULL;
}
/* ToString of the tagged value (booleans "true"/"false", numbers as written) */
static const char *tagged_text(const char *v) { return v[0] == 'z' ? "null" : v + 1; }

/* GetOption(type string): returns index in list or -1 when undefined; sets error when not listed */
static int get_enum(NfCtx *c, const char *key, const char *const *list, int nlist, int dflt) {
  const char *v = opt_get(c, key);
  if (!v) return dflt;
  const char *t = tagged_text(v);
  for (int i = 0; i < nlist; i++) if (strcmp(list[i], t) == 0) return i;
  nf_fail(c, 1, "Value %s out of range for Intl.NumberFormat options property %s", t, key);
  return dflt;
}

static int is_wellformed_currency(const char *s) {
  if (strlen(s) != 3) return 0;
  for (int i = 0; i < 3; i++) if (!((s[i] >= 'a' && s[i] <= 'z') || (s[i] >= 'A' && s[i] <= 'Z'))) return 0;
  return 1;
}

/* the sanctioned simple units */
static const char *const SIMPLE_UNITS[] = {
  "acre", "bit", "byte", "celsius", "centimeter", "day", "degree", "fahrenheit", "fluid-ounce", "foot", "gallon",
  "gigabit", "gigabyte", "gram", "hectare", "hour", "inch", "kilobit", "kilobyte", "kilogram", "kilometer", "liter",
  "megabit", "megabyte", "meter", "microsecond", "mile", "mile-scandinavian", "milliliter", "millimeter",
  "millisecond", "minute", "month", "nanosecond", "ounce", "percent", "petabyte", "pound", "second", "stone",
  "terabit", "terabyte", "week", "yard", "year"};
static const char *const SIMPLE_CAT[] = {
  "area", "digital", "digital", "temperature", "length", "duration", "angle", "temperature", "volume", "length", "volume",
  "digital", "digital", "mass", "area", "duration", "length", "digital", "digital", "mass", "length", "volume",
  "digital", "digital", "length", "duration", "length", "length", "volume", "length",
  "duration", "duration", "duration", "duration", "mass", "concentr", "digital", "mass", "duration", "mass",
  "digital", "digital", "duration", "length", "duration"};
#define NSIMPLE ((int)(sizeof SIMPLE_UNITS / sizeof SIMPLE_UNITS[0]))
static int simple_unit_index(const char *s, size_t n) {
  for (int i = 0; i < NSIMPLE; i++) if (strlen(SIMPLE_UNITS[i]) == n && memcmp(SIMPLE_UNITS[i], s, n) == 0) return i;
  return -1;
}
/* "CLDR id" of a simple unit: category-name, with the two CLDR spelling differences */
static void unit_cldr_id(int idx, char *out, size_t cap) {
  snprintf(out, cap, "%s-%s", SIMPLE_CAT[idx], SIMPLE_UNITS[idx]);
}

typedef struct { int num, den; } UnitSpec; /* indexes into SIMPLE_UNITS, den = -1 for a simple unit */
static int parse_unit(const char *u, UnitSpec *us) {
  int i = simple_unit_index(u, strlen(u));
  if (i >= 0) { us->num = i; us->den = -1; return 1; }
  const char *per = strstr(u, "-per-");
  if (!per) return 0;
  int a = simple_unit_index(u, (size_t)(per - u));
  int b = simple_unit_index(per + 5, strlen(per + 5));
  if (a < 0 || b < 0) return 0;
  us->num = a; us->den = b;
  return 1;
}

static const char *const RM_NAMES[] = {"ceil", "floor", "expand", "trunc", "halfCeil", "halfFloor", "halfExpand", "halfTrunc", "halfEven"};

/* ToNumber of a tagged option value */
static double to_number_tagged(const char *v) {
  double x;
  if (v[0] == 'z') x = 0; /* ToNumber(null) */
  else if (v[0] == 'n') x = strtod(v + 1, NULL);
  else if (v[0] == 'b') x = strcmp(v + 1, "true") == 0 ? 1 : 0;
  else {
    const char *t = v + 1;
    char *end;
    while (*t == ' ') t++;
    x = *t ? strtod(t, &end) : 0;
    if (*t && (*end != 0 && *end != ' ')) x = NAN;
    if (strncmp(t, "Infinity", 8) == 0) x = INFINITY;
  }
  return x;
}
/* DefaultNumberOption on an already-read value: floor(x) or an error */
static double default_number(NfCtx *c, const char *key, int present, double x, double lo, double hi, double fallback) {
  if (!present) return fallback;
  if (isnan(x) || x < lo || x > hi) { nf_fail(c, 1, "%s value is out of range.", key); return fallback; }
  return floor(x);
}
/* GetNumberOption: the read and the check together */
static double get_number(NfCtx *c, const char *key, double lo, double hi, int *present) {
  const char *v = opt_get(c, key);
  *present = v != NULL;
  if (!v) return -1;
  return default_number(c, key, 1, to_number_tagged(v), lo, hi, -1);
}

static int parse_options(NfCtx *c, NfOpts *o, const char *locale_for_nu, int *localeMatcherOk) {
  (void)locale_for_nu; (void)localeMatcherOk;
  static const char *const LM[] = {"lookup", "best fit"};
  get_enum(c, "localeMatcher", LM, 2, 1);
  if (c->errKind) return -1;
  const char *nv = opt_get(c, "numberingSystem");
  o->hasNu = 0;
  o->nu[0] = 0;
  if (nv) {
    const char *t = tagged_text(nv);
    /* type = 3*8alphanum *("-" 3*8alphanum) */
    int ok = *t != 0;
    const char *p = t;
    while (ok && *p) {
      const char *q = p;
      while (*q && *q != '-') { if (!((*q >= 'a' && *q <= 'z') || (*q >= 'A' && *q <= 'Z') || (*q >= '0' && *q <= '9'))) ok = 0; q++; }
      size_t l = (size_t)(q - p);
      if (l < 3 || l > 8) ok = 0;
      if (*q == '-') { q++; if (!*q) ok = 0; }
      p = q;
    }
    if (!ok) { nf_fail(c, 1, "Invalid numberingSystem : %s", t); return -1; }
    snprintf(o->nu, sizeof o->nu, "%s", t);
    for (char *q = o->nu; *q; q++) if (*q >= 'A' && *q <= 'Z') *q = (char)(*q + 32);
    o->hasNu = 1;
  }
  static const char *const STY[] = {"decimal", "percent", "currency", "unit"};
  o->style = (Style)get_enum(c, "style", STY, 4, ST_DECIMAL);
  if (c->errKind) return -1;
  const char *cv = opt_get(c, "currency");
  o->currency[0] = 0;
  if (cv) {
    const char *t = tagged_text(cv);
    if (!is_wellformed_currency(t)) { nf_fail(c, 1, "Invalid currency code : %s", t); return -1; }
    for (int i = 0; i < 3; i++) o->currency[i] = (char)((t[i] >= 'a' && t[i] <= 'z') ? t[i] - 32 : t[i]);
    o->currency[3] = 0;
  } else if (o->style == ST_CURRENCY) { nf_fail(c, 2, "Currency code is required with currency style."); return -1; }
  static const char *const CDS[] = {"symbol", "narrowSymbol", "code", "name"};
  o->curDisp = (CurDisp)get_enum(c, "currencyDisplay", CDS, 4, CD_SYMBOL);
  if (c->errKind) return -1;
  static const char *const CSG[] = {"standard", "accounting"};
  o->accounting = get_enum(c, "currencySign", CSG, 2, 0);
  if (c->errKind) return -1;
  const char *uv = opt_get(c, "unit");
  o->unit[0] = 0;
  UnitSpec us;
  if (uv) {
    const char *t = tagged_text(uv);
    if (!parse_unit(t, &us)) { nf_fail(c, 1, "Invalid unit argument for Intl.NumberFormat() '%s'", t); return -1; }
    snprintf(o->unit, sizeof o->unit, "%s", t);
  } else if (o->style == ST_UNIT) { nf_fail(c, 2, "Invalid unit argument for Intl.NumberFormat() ''"); return -1; }
  static const char *const UD[] = {"short", "narrow", "long"};
  o->unitDisp = get_enum(c, "unitDisplay", UD, 3, 0);
  if (c->errKind) return -1;
  static const char *const NTN[] = {"standard", "scientific", "engineering", "compact"};
  o->notation = (Notation)get_enum(c, "notation", NTN, 4, NT_STANDARD);
  if (c->errKind) return -1;
  /* digit options */
  int mnfdDefault, mxfdDefault;
  if (o->style == ST_CURRENCY && o->notation == NT_STANDARD) {
    char k[32];
    snprintf(k, sizeof k, "curfrac/%s", o->currency);
    ScrCoreVal v = scr_core_get(k);
    int cd = 2;
    if (v.p) cd = atoi(v.p); else { ScrCoreVal d = scr_core_get("curfrac/DEFAULT"); if (d.p) cd = atoi(d.p); }
    mnfdDefault = mxfdDefault = cd;
  } else {
    mnfdDefault = 0;
    mxfdDefault = o->style == ST_PERCENT ? 0 : 3;
  }
  int pr;
  double mnid = get_number(c, "minimumIntegerDigits", 1, 21, &pr);
  if (c->errKind) return -1;
  o->minInt = pr ? (int)mnid : 1;
  int p_mnfd = 0, p_mxfd = 0, p_mnsd = 0, p_mxsd = 0;
  double mnfd = 0, mxfd = 0, mnsd = 0, mxsd = 0;
  { const char *v;
    if ((v = opt_get(c, "minimumFractionDigits"))) { p_mnfd = 1; mnfd = to_number_tagged(v); }
    if ((v = opt_get(c, "maximumFractionDigits"))) { p_mxfd = 1; mxfd = to_number_tagged(v); }
    if ((v = opt_get(c, "minimumSignificantDigits"))) { p_mnsd = 1; mnsd = to_number_tagged(v); }
    if ((v = opt_get(c, "maximumSignificantDigits"))) { p_mxsd = 1; mxsd = to_number_tagged(v); }
  }
  int p_inc;
  double inc = get_number(c, "roundingIncrement", 1, 5000, &p_inc);
  if (c->errKind) return -1;
  o->incr = p_inc ? (int)inc : 1;
  {
    static const int ok[] = {1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000};
    int f = 0;
    for (size_t i = 0; i < sizeof ok / sizeof ok[0]; i++) if (ok[i] == o->incr) f = 1;
    if (!f) { nf_fail(c, 1, "roundingIncrement value is out of range."); return -1; }
  }
  o->rmode = (RMode)get_enum(c, "roundingMode", RM_NAMES, 9, RM_HALF_EXPAND);
  if (c->errKind) return -1;
  static const char *const RP[] = {"auto", "morePrecision", "lessPrecision"};
  int rp = get_enum(c, "roundingPriority", RP, 3, 0);
  if (c->errKind) return -1;
  static const char *const TZD[] = {"auto", "stripIfInteger"};
  o->stripZero = get_enum(c, "trailingZeroDisplay", TZD, 2, 0);
  if (c->errKind) return -1;
  /* V8 keeps the unit defaults when roundingIncrement is given (the spec lowers mxfdDefault to mnfdDefault) */
  int hasSd = p_mnsd || p_mxsd, hasFd = p_mnfd || p_mxfd;
  int needSd = 1, needFd = 1;
  if (rp == 0) {
    needSd = hasSd;
    if (needSd || (!hasFd && o->notation == NT_COMPACT)) needFd = 0;
  }
  int cmnsd = 1, cmxsd = 21, cmnfd = 0, cmxfd = 0;
  if (needSd) {
    if (hasSd) {
      double d1 = default_number(c, "minimumSignificantDigits", p_mnsd, mnsd, 1, 21, 1);
      if (c->errKind) return -1;
      cmnsd = (int)d1;
      double d2 = default_number(c, "maximumSignificantDigits", p_mxsd, mxsd, cmnsd, 21, 21);
      if (c->errKind) return -1;
      cmxsd = (int)d2;
    } else { cmnsd = 1; cmxsd = 21; }
  }
  if (needFd) {
    if (hasFd) {
      double a1 = default_number(c, "minimumFractionDigits", p_mnfd, mnfd, 0, 100, -1);
      if (c->errKind) return -1;
      double a2 = default_number(c, "maximumFractionDigits", p_mxfd, mxfd, 0, 100, -1);
      if (c->errKind) return -1;
      int u1 = !p_mnfd, u2 = !p_mxfd;
      if (u1) { cmxfd = (int)a2; cmnfd = mnfdDefault < cmxfd ? mnfdDefault : cmxfd; }
      else if (u2) { cmnfd = (int)a1; cmxfd = mxfdDefault > cmnfd ? mxfdDefault : cmnfd; }
      else if (a1 > a2) { nf_fail(c, 1, "maximumFractionDigits value is out of range."); return -1; }
      else { cmnfd = (int)a1; cmxfd = (int)a2; }
    } else { cmnfd = mnfdDefault; cmxfd = mxfdDefault; }
  }
  if (!needSd && !needFd) {
    cmnfd = 0; cmxfd = 0; cmnsd = 1; cmxsd = 2;
    o->rtype = RT_MORE;
  } else if (rp == 1) o->rtype = RT_MORE;
  else if (rp == 2) o->rtype = RT_LESS;
  else if (hasSd) o->rtype = RT_SIG;
  else o->rtype = RT_FRACTION;
  o->minFrac = cmnfd; o->maxFrac = cmxfd; o->minSig = cmnsd; o->maxSig = cmxsd;
  if (o->incr != 1) {
    if (o->rtype != RT_FRACTION) { nf_fail(c, 2, "RoundingType is not fractionDigits"); return -1; }
    if (o->maxFrac != o->minFrac) { nf_fail(c, 1, "maximumFractionDigits value is out of range."); return -1; }
  }
  static const char *const CDL[] = {"short", "long"};
  o->compactLong = get_enum(c, "compactDisplay", CDL, 2, 0);
  if (c->errKind) return -1;
  /* useGrouping: GetBooleanOrStringNumberFormatOption */
  {
    const char *v = opt_get(c, "useGrouping");
    o->group = o->notation == NT_COMPACT ? UG_MIN2 : UG_AUTO;
    if (v) {
      const char *t = tagged_text(v);
      if (v[0] == 'z') o->group = UG_FALSE; /* ToBoolean(null) */
      else if (v[0] == 'b') o->group = strcmp(t, "true") == 0 ? UG_ALWAYS : UG_FALSE;
      else if (v[0] == 'n') {
        double x = strtod(t, NULL);
        if (x == 0 || isnan(x)) o->group = UG_FALSE;
        else { nf_fail(c, 1, "Value %s out of range for Intl.NumberFormat options property useGrouping", t); return -1; }
      } else {
        if (*t == 0) o->group = UG_FALSE;
        else if (strcmp(t, "true") == 0 || strcmp(t, "false") == 0) { /* keep the default */ }
        else if (strcmp(t, "min2") == 0) o->group = UG_MIN2;
        else if (strcmp(t, "auto") == 0) o->group = UG_AUTO;
        else if (strcmp(t, "always") == 0) o->group = UG_ALWAYS;
        else { nf_fail(c, 1, "Value %s out of range for Intl.NumberFormat options property useGrouping", t); return -1; }
      }
    }
  }
  static const char *const SG[] = {"auto", "never", "always", "exceptZero", "negative"};
  o->sign = (SignDisp)get_enum(c, "signDisplay", SG, 5, SD_AUTO);
  if (c->errKind) return -1;
  return 0;
}

/* ── rounding by the options ─────────────────────────────────────────────────────────────────────────────── */
static void apply_rounding(const NfOpts *o, Dec *q, int neg, int *minFracOut) {
  Dec f, s;
  long fpos = -(long)o->maxFrac;
  long e = dec_mag(q);
  long spos = e - o->maxSig + 1;
  int useSig = 0;
  switch (o->rtype) {
    case RT_FRACTION: dec_round(q, fpos, o->incr, o->rmode, neg); *minFracOut = o->minFrac; break;
    case RT_SIG: useSig = 1; break;
    case RT_MORE: case RT_LESS: {
      useSig = o->rtype == RT_MORE ? (spos <= fpos) : !(spos <= fpos);
      break;
    }
  }
  if (o->rtype == RT_FRACTION) goto done;
  (void)f; (void)s;
  if (useSig) {
    dec_round(q, spos, 1, o->rmode, neg);
    long m = dec_mag(q);
    long mf = o->minSig - 1 - m;
    *minFracOut = mf > 0 ? (int)mf : 0;
  } else {
    dec_round(q, fpos, o->incr, o->rmode, neg);
    *minFracOut = o->minFrac;
  }
done:
  if (o->stripZero && q->exp >= 0) *minFracOut = 0;
}

/* ── rendering of digits ─────────────────────────────────────────────────────────────────────────────────── */

/* integer and fraction digit text of a rounded Dec */
static void split_digits(const Dec *r, int minInt, int minFrac, Buf *ip, Buf *fp) {
  /* integer part: digits with exponent >= 0 */
  long intLen = r->n == 0 ? 0 : (r->exp >= 0 ? r->n + r->exp : (r->n + r->exp > 0 ? r->n + r->exp : 0));
  Buf ib = {0};
  for (long i = intLen; i < minInt; i++) b_putc(&ib, '0');
  for (long i = 0; i < intLen; i++) {
    long idx = i;
    b_putc(&ib, idx < r->n ? r->d[idx] : '0');
  }
  if (ib.n == 0) b_putc(&ib, '0');
  /* fraction: digits at negative exponents */
  Buf fb = {0};
  long fracDigits = r->n == 0 ? 0 : (r->exp < 0 ? -r->exp : 0);
  for (long j = 0; j < fracDigits; j++) {
    long idx = intLen + j; /* position within d; leading fractional zeros when intLen would be negative */
    if (r->n + r->exp < 0) {
      long lead = -(r->n + r->exp);
      if (j < lead) b_putc(&fb, '0'); else b_putc(&fb, r->d[j - lead]);
    } else b_putc(&fb, r->d[idx]);
  }
  while ((long)fb.n < minFrac) b_putc(&fb, '0');
  *ip = ib;
  *fp = fb;
}


/* ── UTF helpers ─────────────────────────────────────────────────────────────────────────────────────────── */
static int is_sz(unsigned cp) {
  int lo = 0, hi = (int)(sizeof nf_sz_ranges / sizeof nf_sz_ranges[0]) - 1;
  while (lo <= hi) {
    int mid = (lo + hi) / 2;
    if (cp < nf_sz_ranges[mid][0]) hi = mid - 1;
    else if (cp > nf_sz_ranges[mid][1]) lo = mid + 1;
    else return 1;
  }
  return 0;
}
static int is_nd(unsigned cp) {
  int lo = 0, hi = (int)(sizeof nf_nd_ranges / sizeof nf_nd_ranges[0]) - 1;
  while (lo <= hi) {
    int mid = (lo + hi) / 2;
    if (cp < nf_nd_ranges[mid][0]) hi = mid - 1;
    else if (cp > nf_nd_ranges[mid][1]) lo = mid + 1;
    else return 1;
  }
  return 0;
}
static size_t u8len(unsigned char c) { return c < 0x80 ? 1 : c < 0xe0 ? 2 : c < 0xf0 ? 3 : 4; }
static unsigned first_cp(const char *s) {
  const unsigned char *p = (const unsigned char *)s;
  if (!*p) return 0;
  if (*p < 0x80) return *p;
  if (*p < 0xe0) return ((*p & 0x1f) << 6) | (p[1] & 0x3f);
  if (*p < 0xf0) return ((*p & 0x0f) << 12) | ((p[1] & 0x3f) << 6) | (p[2] & 0x3f);
  return ((*p & 0x07) << 18) | ((p[1] & 0x3f) << 12) | ((p[2] & 0x3f) << 6) | (p[3] & 0x3f);
}
static unsigned last_cp(const char *s, size_t n) {
  if (!n) return 0;
  size_t i = n - 1;
  while (i > 0 && ((unsigned char)s[i] & 0xc0) == 0x80) i--;
  return first_cp(s + i);
}
/* u_isJavaSpaceChar: Zs, Zl, Zp */
static int is_java_space(unsigned cp) {
  return cp == 0x20 || cp == 0xa0 || cp == 0x1680 || (cp >= 0x2000 && cp <= 0x200a) || cp == 0x2028 || cp == 0x2029 ||
         cp == 0x202f || cp == 0x205f || cp == 0x3000;
}
static void put_wtf8(Buf *b, unsigned cp) {
  if (cp < 0x80) b_putc(b, (char)cp);
  else if (cp < 0x800) { b_putc(b, (char)(0xc0 | (cp >> 6))); b_putc(b, (char)(0x80 | (cp & 0x3f))); }
  else if (cp < 0x10000) { b_putc(b, (char)(0xe0 | (cp >> 12))); b_putc(b, (char)(0x80 | ((cp >> 6) & 0x3f))); b_putc(b, (char)(0x80 | (cp & 0x3f))); }
  else { b_putc(b, (char)(0xf0 | (cp >> 18))); b_putc(b, (char)(0x80 | ((cp >> 12) & 0x3f))); b_putc(b, (char)(0x80 | ((cp >> 6) & 0x3f))); b_putc(b, (char)(0x80 | (cp & 0x3f))); }
}
static size_t utf16_of(const char *s, uint16_t *u) {
  unsigned cp = first_cp(s);
  if (cp >= 0x10000) { cp -= 0x10000; u[0] = (uint16_t)(0xd800 + (cp >> 10)); u[1] = (uint16_t)(0xdc00 + (cp & 0x3ff)); return 2; }
  u[0] = (uint16_t)cp;
  return 1;
}
/* WTF-8 (possibly with lone surrogates) to UTF-16 units; caller frees */
static uint16_t *to_utf16(const char *s, size_t n, size_t *outn) {
  uint16_t *u = malloc((n + 1) * sizeof(uint16_t));
  size_t k = 0;
  for (size_t i = 0; i < n;) {
    unsigned char c = (unsigned char)s[i];
    unsigned cp;
    size_t l = u8len(c);
    if (c < 0x80) cp = c;
    else if (c < 0xe0) cp = ((c & 0x1f) << 6) | (s[i + 1] & 0x3f);
    else if (c < 0xf0) cp = ((c & 0x0f) << 12) | ((s[i + 1] & 0x3f) << 6) | (s[i + 2] & 0x3f);
    else cp = ((c & 0x07) << 18) | ((s[i + 1] & 0x3f) << 12) | ((s[i + 2] & 0x3f) << 6) | (s[i + 3] & 0x3f);
    if (cp >= 0x10000) { cp -= 0x10000; u[k++] = (uint16_t)(0xd800 + (cp >> 10)); u[k++] = (uint16_t)(0xdc00 + (cp & 0x3ff)); }
    else u[k++] = (uint16_t)cp;
    i += l;
  }
  *outn = k;
  return u;
}
static void put_utf16(Buf *out, const uint16_t *a, size_t len) {
  for (size_t k = 0; k < len; k++) {
    unsigned u = a[k];
    if (u >= 0xd800 && u < 0xdc00 && k + 1 < len && a[k + 1] >= 0xdc00 && a[k + 1] < 0xe000) {
      put_wtf8(out, 0x10000 + ((u - 0xd800) << 10) + (a[k + 1] - 0xdc00));
      k++;
    } else put_wtf8(out, u);
  }
}

/* ── SimpleFormatter (ApostropheMode::DOUBLE_OPTIONAL) ───────────────────────────────────────────────────── */
/* Substitutes a0 / a1 verbatim for {0} / {1}; sf_has0 says whether the pattern has a {0}. */
static void sf_format(Buf *out, const char *pat, const char *a0, const char *a1) {
  enum { INIT, APOS, QUOTE } st = INIT;
  for (const char *p = pat; *p;) {
    char c = *p;
    if (st == INIT) {
      if (c == '\'') { st = APOS; p++; }
      else if (c == '{' && p[1] >= '0' && p[1] <= '9' && p[2] == '}') {
        const char *a = p[1] == '0' ? a0 : (p[1] == '1' ? a1 : NULL);
        if (a) b_puts(out, a);
        p += 3;
      } else { b_putc(out, c); p++; }
    } else if (st == APOS) {
      if (c == '\'') { b_putc(out, '\''); st = INIT; p++; }
      else if (c == '{' || c == '}') { st = QUOTE; b_putc(out, c); p++; }
      else { b_putc(out, '\''); st = INIT; /* reprocess c */ }
    } else {
      if (c == '\'') { st = APOS; p++; } else { b_putc(out, c); p++; }
    }
  }
  if (st == APOS) b_putc(out, '\'');
}
static int sf_has0(const char *pat) {
  int q = 0;
  for (const char *p = pat; *p; p++) {
    if (*p == '\'') { if (p[1] == '\'') p++; else if (p[1] == '{' || p[1] == '}') q = !q; }
    else if (!q && p[0] == '{' && p[1] == '0' && p[2] == '}') return 1;
  }
  return 0;
}
/* the pattern with its arguments removed */
static void sf_no_args(Buf *out, const char *pat) { sf_format(out, pat, "", ""); }

/* ── ICU resource access helpers ──────────────────────────────────────────────────────────────────────────── */
static int rget(const ScrUloc *u, int pkg, const char *path, char *out, size_t cap) { return scr_res_get_str(u, pkg, path, out, cap); }
static char *rdup(const ScrUloc *u, int pkg, const char *path) {
  ScrRes r;
  if (!scr_ures_get(u, pkg, path, &r) || scr_res_kind(r) != SCR_RES_STR) return NULL;
  size_t n;
  const char *s = scr_res_str(r, &n);
  char *d = malloc(n + 1);
  memcpy(d, s, n);
  d[n] = 0;
  return d;
}
static char *str_dup_n(const char *s, size_t n) { char *d = malloc(n + 1); memcpy(d, s, n); d[n] = 0; return d; }

/* ── plural rules ─────────────────────────────────────────────────────────────────────────────────────────── */
typedef struct { unsigned long long i, f, t; int v, w; long e; double n; } PluralOps;
typedef struct { const char *p, *end; const PluralOps *o; } PRule;
static void ps(PRule *r) { while (r->p < r->end && *r->p == ' ') r->p++; }
static int pnum(PRule *r, long long *out) {
  ps(r);
  if (r->p >= r->end || *r->p < '0' || *r->p > '9') return 0;
  long long v = 0;
  while (r->p < r->end && *r->p >= '0' && *r->p <= '9') v = v * 10 + (*r->p++ - '0');
  *out = v;
  return 1;
}
static int p_relation(PRule *r) {
  ps(r);
  char c = *r->p++;
  long long mod = 0;
  ps(r);
  if (r->p < r->end && *r->p == '%') { r->p++; pnum(r, &mod); }
  ps(r);
  int neg = 0;
  if (*r->p == '!') { neg = 1; r->p++; }
  if (*r->p == '=') r->p++;
  const PluralOps *o = r->o;
  double x;
  int integral = 1;
  switch (c) {
    case 'i': x = mod ? (double)(o->i % (unsigned long long)mod) : (double)o->i; break;
    case 'f': x = mod ? (double)(o->f % (unsigned long long)mod) : (double)o->f; break;
    case 't': x = mod ? (double)(o->t % (unsigned long long)mod) : (double)o->t; break;
    case 'v': x = mod ? (double)(o->v % mod) : o->v; break;
    case 'w': x = mod ? (double)(o->w % mod) : o->w; break;
    case 'e': case 'c': x = mod ? (double)(o->e % mod) : (double)o->e; break;
    default: /* n */
      x = mod ? fmod(o->n, (double)mod) : o->n;
      integral = x == floor(x);
  }
  int hit = 0;
  for (;;) {
    long long lo, hi;
    if (!pnum(r, &lo)) break;
    hi = lo;
    if (r->p + 1 < r->end && r->p[0] == '.' && r->p[1] == '.') { r->p += 2; pnum(r, &hi); }
    if (integral && x >= (double)lo && x <= (double)hi) hit = 1;
    ps(r);
    if (r->p < r->end && *r->p == ',') { r->p++; continue; }
    break;
  }
  return neg ? !hit : hit;
}
static int p_and(PRule *r) {
  int v = p_relation(r);
  for (;;) {
    ps(r);
    if (r->end - r->p >= 3 && strncmp(r->p, "and", 3) == 0) { r->p += 3; int w = p_relation(r); v = v && w; } else break;
  }
  return v;
}
static int rule_eval(const char *s, size_t n, const PluralOps *o) {
  PRule r = {s, s + n, o};
  int v = p_and(&r);
  for (;;) {
    ps(&r);
    if (r.end - r.p >= 2 && strncmp(r.p, "or", 2) == 0) { r.p += 2; int w = p_and(&r); v = v || w; } else break;
  }
  return v;
}
enum { PL_ZERO, PL_ONE, PL_TWO, PL_FEW, PL_MANY, PL_OTHER, PL_COUNT };
static const char *const PL_NAMES[PL_COUNT] = {"zero", "one", "two", "few", "many", "other"};
/* ICU's PluralRules keep their rules in resource key order: few, many, one, two, zero; no match is "other".
 * `key` is the locale spelled as plurals.txt does ("pt_PT"); it is truncated at '_' until a rule set is found. */
static int plural_select(const char *key, const PluralOps *o) {
  char k[96], base[64];
  snprintf(base, sizeof base, "%s", key);
  for (;;) {
    static const int ORDER[5] = {PL_FEW, PL_MANY, PL_ONE, PL_TWO, PL_ZERO};
    int found = 0;
    for (int oi = 0; oi < 5; oi++) {
      snprintf(k, sizeof k, "plural/%s/%s", base, PL_NAMES[ORDER[oi]]);
      ScrCoreVal v = scr_core_get(k);
      if (v.p) { found = 1; if (rule_eval(v.p, v.n, o)) return ORDER[oi]; }
    }
    snprintf(k, sizeof k, "plural/%s/other", base);
    if (found || scr_core_get(k).p) return PL_OTHER;
    char *u = strrchr(base, '_');
    if (!u) return PL_OTHER;
    *u = 0;
  }
}
/* the keywords a locale's rules define (for "fill missing plural forms from other") */
static int plural_has(const char *key, int pl) {
  char k[96], base[64];
  snprintf(base, sizeof base, "%s", key);
  for (;;) {
    snprintf(k, sizeof k, "plural/%s/other", base);
    int any = scr_core_get(k).p != NULL;
    for (int i = 0; i < 5 && !any; i++) { snprintf(k, sizeof k, "plural/%s/%s", base, PL_NAMES[i]); any = scr_core_get(k).p != NULL; }
    if (any) { snprintf(k, sizeof k, "plural/%s/%s", base, PL_NAMES[pl]); return pl == PL_OTHER || scr_core_get(k).p != NULL; }
    char *u = strrchr(base, '_');
    if (!u) return pl == PL_OTHER;
    *u = 0;
  }
}

/* ── locale data ─────────────────────────────────────────────────────────────────────────────────────────── */
enum { Y_DEC, Y_GRP, Y_PCT, Y_MINUS, Y_PLUS, Y_EXP, Y_PERMILLE, Y_INF, Y_NAN, Y_CDEC, Y_CGRP, Y_COUNT };
static const char *const Y_KEYS[Y_COUNT] = {"decimal", "group", "percentSign", "minusSign", "plusSign", "exponential", "perMille", "infinity", "nan", "currencyDecimal", "currencyGroup"};

typedef struct {
  ScrLocRes lr;
  ScrUloc uloc;
  char name[64];
  char region[8];
  char ns[16];
  char dig[10][8];
  char sym[Y_COUNT][96];
  int seen[Y_COUNT];
  /* the currency format info DecimalFormatSymbols::setCurrency leaves behind */
  char curPat[96];
  int hasCurPat;
} NfLoc;

typedef struct { NfLoc *L; } SymSink;
static void sym_sink(void *ctx, const char *key, size_t kn, ScrRes v) {
  NfLoc *L = ((SymSink *)ctx)->L;
  for (int i = 0; i < Y_COUNT; i++) {
    if (strlen(Y_KEYS[i]) == kn && memcmp(Y_KEYS[i], key, kn) == 0) {
      if (L->seen[i]) return;
      size_t n;
      const char *s = scr_res_str(v, &n);
      if (!s || n >= sizeof L->sym[i]) return;
      memcpy(L->sym[i], s, n);
      L->sym[i][n] = 0;
      L->seen[i] = 1;
      return;
    }
  }
}

static int ns_numeric_digits(const char *ns, char dig[10][8]) {
  char k[48];
  snprintf(k, sizeof k, "ns/%s", ns);
  ScrCoreVal v = scr_core_get(k);
  if (!v.p || (v.n >= 4 && memcmp(v.p, "alg:", 4) == 0)) return 0;
  const unsigned char *p = (const unsigned char *)v.p, *e = p + v.n;
  int i = 0;
  while (p < e && i < 10) {
    size_t l = u8len(*p);
    memcpy(dig[i], p, l);
    dig[i][l] = 0;
    p += l;
    i++;
  }
  return i == 10;
}

static void tag_region(const char *tag, char *out) {
  out[0] = 0;
  const char *p = strchr(tag, '-');
  while (p) {
    p++;
    const char *e = strchr(p, '-');
    size_t n = e ? (size_t)(e - p) : strlen(p);
    if ((n == 2 && p[0] >= 'A' && p[0] <= 'Z') || (n == 3 && p[0] >= '0' && p[0] <= '9')) { memcpy(out, p, n); out[n] = 0; return; }
    if (n == 1) return;
    p = e;
  }
}

/* ICU's currency format info: Currencies/<code> = [symbol, name, {pattern, decimal, group}] */
static void cur_info_apply(NfLoc *L, const char *code) {
  char path[48];
  snprintf(path, sizeof path, "Currencies/%s", code);
  ScrRes r;
  if (!scr_ures_get(&L->uloc, SCR_URES_CURR, path, &r) || scr_res_array_len(r) <= 2) return;
  ScrRes t = scr_res_array_at(r, 2);
  if (scr_res_array_len(t) < 3) return;
  size_t n;
  const char *s = scr_res_str(scr_res_array_at(t, 0), &n);
  if (s && n < sizeof L->curPat) { memcpy(L->curPat, s, n); L->curPat[n] = 0; L->hasCurPat = 1; }
  s = scr_res_str(scr_res_array_at(t, 1), &n);
  if (s && n < sizeof L->sym[Y_CDEC]) { memcpy(L->sym[Y_CDEC], s, n); L->sym[Y_CDEC][n] = 0; }
  s = scr_res_str(scr_res_array_at(t, 2), &n);
  if (s && n < sizeof L->sym[Y_CGRP]) { memcpy(L->sym[Y_CGRP], s, n); L->sym[Y_CGRP][n] = 0; }
}

static int load_locale(NfCtx *c, NfLoc *L, const char *locales, const NfOpts *o) {
  { int lrc = scr_locale_resolve(SCR_LOC_NF, locales, &L->lr);
    if (lrc != 0) { char em[260]; scr_locale_error_message(lrc, &L->lr, em, sizeof em); nf_fail(c, 1, "%s", em); return -1; } }
  size_t n = strlen(L->lr.tag);
  for (size_t i = 0; i <= n; i++) L->name[i] = L->lr.tag[i] == '-' ? '_' : L->lr.tag[i];
  L->uloc = L->lr.uloc;
  tag_region(L->lr.tag, L->region);
  /* NumberingSystem::createInstance: the keyword, else NumberElements/default */
  char ns[24] = "";
  if (o->hasNu && ns_numeric_digits(o->nu, L->dig)) snprintf(ns, sizeof ns, "%s", o->nu);
  else if (!o->hasNu && L->lr.nu[0] && ns_numeric_digits(L->lr.nu, L->dig)) snprintf(ns, sizeof ns, "%s", L->lr.nu);
  else {
    char dn[24];
    if (!rget(&L->uloc, SCR_URES_LOC, "NumberElements/default", dn, sizeof dn)) strcpy(dn, "latn");
    if (!ns_numeric_digits(dn, L->dig)) { strcpy(dn, "latn"); ns_numeric_digits(dn, L->dig); }
    snprintf(ns, sizeof ns, "%s", dn);
  }
  snprintf(L->ns, sizeof L->ns, "%s", ns);
  /* DecimalFormatSymbols::initialize: defaults, the ns symbols, latn for what is missing, monetary fallbacks */
  strcpy(L->sym[Y_DEC], "."); strcpy(L->sym[Y_GRP], ""); strcpy(L->sym[Y_PCT], "%"); strcpy(L->sym[Y_MINUS], "-");
  strcpy(L->sym[Y_PLUS], "+"); strcpy(L->sym[Y_EXP], "E"); strcpy(L->sym[Y_PERMILLE], "\xe2\x80\xb0");
  strcpy(L->sym[Y_INF], "\xe2\x88\x9e"); strcpy(L->sym[Y_NAN], "\xef\xbf\xbd"); strcpy(L->sym[Y_CDEC], "."); strcpy(L->sym[Y_CGRP], "");
  SymSink sk = {L};
  char path[96];
  if (strcmp(ns, "latn") != 0) {
    snprintf(path, sizeof path, "NumberElements/%s/symbols", ns);
    scr_ures_all_items(&L->uloc, SCR_URES_LOC, path, sym_sink, &sk);
  }
  scr_ures_all_items(&L->uloc, SCR_URES_LOC, "NumberElements/latn/symbols", sym_sink, &sk);
  if (!L->seen[Y_CDEC]) strcpy(L->sym[Y_CDEC], L->sym[Y_DEC]);
  if (!L->seen[Y_CGRP]) strcpy(L->sym[Y_CGRP], L->sym[Y_GRP]);
  /* the locale's own region currency, then (later) the formatted one */
  if (L->region[0]) {
    char rk[24];
    snprintf(rk, sizeof rk, "curregion/%s", L->region);
    ScrCoreVal rc = scr_core_get(rk);
    if (rc.p && rc.n == 3) { char code[4]; memcpy(code, rc.p, 3); code[3] = 0; cur_info_apply(L, code); }
  }
  return 0;
}

static int min_grouping(const NfLoc *L) {
  char b[8];
  if (!rget(&L->uloc, SCR_URES_LOC, "NumberElements/minimumGroupingDigits", b, sizeof b) || strlen(b) != 1) return 1;
  return b[0] - '0';
}

/* the pattern of a style: NumberElements/<ns>/patterns/<key>, then latn */
static int pat_get(const NfLoc *L, const char *key, char *out, size_t cap) {
  char path[128];
  snprintf(path, sizeof path, "NumberElements/%s/patterns/%s", L->ns, key);
  if (rget(&L->uloc, SCR_URES_LOC, path, out, cap)) return 1;
  if (strcmp(L->ns, "latn") != 0) {
    snprintf(path, sizeof path, "NumberElements/latn/patterns/%s", key);
    return rget(&L->uloc, SCR_URES_LOC, path, out, cap);
  }
  return 0;
}

/* ── patterns ────────────────────────────────────────────────────────────────────────────────────────────── */
typedef struct { char prefix[96], suffix[96]; int primary, secondary; int hasCurrency; int hasBody; } SubPat;
typedef struct { SubPat pos, neg; int hasNeg; } PatInfo;

static int affix_has_unquoted(const char *a, char ch) {
  int q = 0;
  for (const char *p = a; *p; p++) {
    if (*p == '\'') { if (p[1] == '\'') p++; else q = !q; }
    else if (!q && *p == ch) return 1;
  }
  return 0;
}
static int affix_has_currency(const char *a) {
  int q = 0;
  for (const char *p = a; *p; p++) {
    if (*p == '\'') { if (p[1] == '\'') p++; else q = !q; }
    else if (!q && (unsigned char)p[0] == 0xc2 && (unsigned char)p[1] == 0xa4) return 1;
  }
  return 0;
}
static void parse_subpat(const char *s, size_t n, SubPat *sp) {
  size_t i, ns = n;
  int q = 0;
  for (i = 0; i < n; i++) {
    if (s[i] == '\'') { if (i + 1 < n && s[i + 1] == '\'') { i++; continue; } q = !q; continue; }
    if (!q && (s[i] == '#' || (s[i] >= '0' && s[i] <= '9') || s[i] == '@' || s[i] == ',' || s[i] == '.')) { ns = i; break; }
  }
  size_t ne = ns;
  for (i = ns; i < n; i++) {
    if (s[i] == '#' || (s[i] >= '0' && s[i] <= '9') || s[i] == '@' || s[i] == ',' || s[i] == '.' || s[i] == 'E') ne = i + 1;
    else if (s[i] == '+' && i > ns && s[i - 1] == 'E') ne = i + 1;
    else break;
  }
  size_t pl = ns < sizeof sp->prefix - 1 ? ns : sizeof sp->prefix - 1;
  memcpy(sp->prefix, s, pl);
  sp->prefix[pl] = 0;
  size_t sl = n - ne < sizeof sp->suffix - 1 ? n - ne : sizeof sp->suffix - 1;
  memcpy(sp->suffix, s + ne, sl);
  sp->suffix[sl] = 0;
  size_t intEnd = ns;
  while (intEnd < ne && s[intEnd] != '.' && s[intEnd] != 'E') intEnd++;
  int lastComma = -1, prevComma = -1;
  for (size_t k = ns; k < intEnd; k++) if (s[k] == ',') { prevComma = lastComma; lastComma = (int)k; }
  if (lastComma < 0) { sp->primary = -1; sp->secondary = -1; }
  else {
    sp->primary = (int)intEnd - lastComma - 1;
    sp->secondary = prevComma >= 0 ? lastComma - prevComma - 1 : sp->primary;
  }
  sp->hasCurrency = affix_has_currency(sp->prefix) || affix_has_currency(sp->suffix);
  sp->hasBody = ns < n; /* a pattern with no digit part ("mille") replaces the number */
}
static void parse_pattern(const char *s, PatInfo *p) {
  size_t n = strlen(s), semi = n;
  int q = 0;
  for (size_t i = 0; i < n; i++) {
    if (s[i] == '\'') { if (i + 1 < n && s[i + 1] == '\'') i++; else q = !q; }
    else if (!q && s[i] == ';') { semi = i; break; }
  }
  parse_subpat(s, semi, &p->pos);
  if (semi < n) { parse_subpat(s + semi + 1, n - semi - 1, &p->neg); p->hasNeg = 1; }
  else { p->neg = p->pos; p->hasNeg = 0; }
}

/* Grouper::setLocaleData: sizes from the pattern, or 3 for "always" when the pattern has none */
static void resolve_grouping(UGroup g, const SubPat *sp, int *g1, int *g2) {
  if (g == UG_FALSE) { *g1 = -1; *g2 = -1; return; }
  if (sp->primary < 0) { *g1 = g == UG_ALWAYS ? 3 : -1; *g2 = *g1; return; }
  *g1 = sp->primary;
  *g2 = sp->secondary;
}

/* ── currency names ───────────────────────────────────────────────────────────────────────────────────────── */
/* ucurr_getName: 0 symbol, 1 long name; narrow via Currencies%narrow. The ISO code is the last resort. */
static char *cur_name(const NfLoc *L, const char *code, int style /* 0 symbol, 1 long, 2 narrow */) {
  char path[64];
  if (style == 2) {
    snprintf(path, sizeof path, "Currencies%%narrow/%s", code);
    char *s = rdup(&L->uloc, SCR_URES_CURR, path);
    if (s) return s;
    style = 0;
  }
  snprintf(path, sizeof path, "Currencies/%s", code);
  ScrRes r;
  if (scr_ures_get(&L->uloc, SCR_URES_CURR, path, &r) && scr_res_array_len(r) > style) {
    size_t n;
    const char *s = scr_res_str(scr_res_array_at(r, style), &n);
    if (s) return str_dup_n(s, n);
  }
  return str_dup_n(code, 3);
}
static char *cur_plural_name(const NfLoc *L, const char *code, int pl) {
  char path[96];
  snprintf(path, sizeof path, "CurrencyPlurals/%s/%s", code, PL_NAMES[pl]);
  char *s = rdup(&L->uloc, SCR_URES_CURR, path);
  if (s) return s;
  snprintf(path, sizeof path, "CurrencyPlurals/%s/other", code);
  s = rdup(&L->uloc, SCR_URES_CURR, path);
  if (s) return s;
  return cur_name(L, code, 1);
}

/* ── per-plural pattern tables (units, currency long names) ─────────────────────────────────────────────── */
enum { F_DNAM = PL_COUNT, F_PER, F_GENDER, F_COUNT };
typedef struct { char *f[F_COUNT]; } Fmts;
static void fmts_free(Fmts *x) { for (int i = 0; i < F_COUNT; i++) { free(x->f[i]); x->f[i] = NULL; } }
static int fmt_index(const char *k, size_t kn) {
  for (int i = 0; i < PL_COUNT; i++) if (strlen(PL_NAMES[i]) == kn && memcmp(PL_NAMES[i], k, kn) == 0) return i;
  if (kn == 4 && memcmp(k, "dnam", 4) == 0) return F_DNAM;
  if (kn == 3 && memcmp(k, "per", 3) == 0) return F_PER;
  if (kn == 6 && memcmp(k, "gender", 6) == 0) return F_GENDER;
  return -1;
}
static void fmts_sink(void *ctx, const char *key, size_t kn, ScrRes v) {
  Fmts *x = ctx;
  int i = fmt_index(key, kn);
  if (i < 0 || x->f[i]) return; /* "case" and unknown keys are skipped; the first bundle wins */
  size_t n;
  const char *s = scr_res_str(v, &n);
  if (s) x->f[i] = str_dup_n(s, n);
}
/* getWithPlural: the form, else OTHER, else "" */
static const char *fmt_with_plural(const Fmts *x, int pl) { return x->f[pl] ? x->f[pl] : (x->f[PL_OTHER] ? x->f[PL_OTHER] : ""); }

/* ── units (number_longnames.cpp) ─────────────────────────────────────────────────────────────────────────── */
static const char *const WIDTH_KEY[3] = {"unitsShort", "unitsNarrow", "units"};
static void unit_load(const NfLoc *L, int unitDisp, const char *type, const char *sub, Fmts *out) {
  char path[160];
  snprintf(path, sizeof path, "%s/%s/%s", WIDTH_KEY[unitDisp], type, sub);
  scr_ures_all_items(&L->uloc, SCR_URES_UNIT, path, fmts_sink, out);
}
static char *compound_value(const NfLoc *L, int unitDisp, const char *key) {
  char path[96];
  snprintf(path, sizeof path, "%s/compound/%s", WIDTH_KEY[unitDisp], key);
  char *s = rdup(&L->uloc, SCR_URES_UNIT, path);
  if (!s && unitDisp != 0) {
    snprintf(path, sizeof path, "unitsShort/compound/%s", key);
    s = rdup(&L->uloc, SCR_URES_UNIT, path);
  }
  return s;
}
typedef struct { const char *id, *type; } BuiltinCompound;
static const BuiltinCompound BUILTIN_COMPOUNDS[] = {
  {"kilometer-per-hour", "speed"}, {"meter-per-second", "speed"}, {"mile-per-hour", "speed"},
  {"liter-per-kilometer", "consumption"}, {"mile-per-gallon", "consumption"}};

/* The patterns of a unit (simple, builtin compound, or numerator per denominator) as one Fmts, plural by plural. */
static void unit_patterns(const NfLoc *L, int unitDisp, const char *unit, Fmts *out) {
  UnitSpec us;
  parse_unit(unit, &us);
  if (us.den < 0) { unit_load(L, unitDisp, SIMPLE_CAT[us.num], SIMPLE_UNITS[us.num], out); return; }
  for (size_t i = 0; i < sizeof BUILTIN_COMPOUNDS / sizeof BUILTIN_COMPOUNDS[0]; i++)
    if (strcmp(BUILTIN_COMPOUNDS[i].id, unit) == 0) { unit_load(L, unitDisp, BUILTIN_COMPOUNDS[i].type, unit, out); return; }
  Fmts N, D;
  memset(&N, 0, sizeof N);
  memset(&D, 0, sizeof D);
  unit_load(L, unitDisp, SIMPLE_CAT[us.num], SIMPLE_UNITS[us.num], &N);
  unit_load(L, unitDisp, SIMPLE_CAT[us.den], SIMPLE_UNITS[us.den], &D);
  Buf per = {0};
  if (D.f[F_PER]) b_puts(&per, D.f[F_PER]);
  else {
    char *raw = compound_value(L, unitDisp, "per");
    Buf dn = {0}, name = {0};
    sf_no_args(&dn, fmt_with_plural(&D, PL_ONE));
    size_t s = 0, e = dn.n;
    while (s < e) { size_t l = u8len((unsigned char)dn.p[s]); if (is_java_space(first_cp(dn.p + s))) s += l; else break; }
    while (e > s) {
      size_t i = e - 1;
      while (i > s && ((unsigned char)dn.p[i] & 0xc0) == 0x80) i--;
      if (is_java_space(first_cp(dn.p + i))) e = i; else break;
    }
    b_put(&name, dn.p ? dn.p + s : "", e - s);
    sf_format(&per, raw ? raw : "{0}/{1}", "{0}", name.p ? name.p : "");
    free(raw);
    b_free(&dn); b_free(&name);
  }
  for (int pl = 0; pl < PL_COUNT; pl++) {
    const char *lead = fmt_with_plural(&N, pl);
    Buf o2 = {0};
    if (!*lead) b_put(&o2, per.p ? per.p : "", per.n);
    else sf_format(&o2, per.p ? per.p : "", lead, "");
    out->f[pl] = o2.p ? o2.p : strdup("");
  }
  b_free(&per);
  fmts_free(&N);
  fmts_free(&D);
}
/* currency long names: CurrencyUnitPatterns with {1} replaced by the plural name */
static void currency_long_patterns(const NfLoc *L, const char *code, Fmts *out) {
  scr_ures_all_items(&L->uloc, SCR_URES_CURR, "CurrencyUnitPatterns", fmts_sink, out);
  for (int pl = 0; pl < PL_COUNT; pl++)
    if (pl != PL_OTHER && !out->f[pl] && out->f[PL_OTHER] && plural_has(L->name, pl)) out->f[pl] = strdup(out->f[PL_OTHER]);
  for (int pl = 0; pl < PL_COUNT; pl++) {
    if (!out->f[pl]) continue;
    char *nm = cur_plural_name(L, code, pl);
    Buf b = {0};
    const char *p = out->f[pl];
    while (*p) {
      if (p[0] == '{' && p[1] == '1' && p[2] == '}') { b_puts(&b, nm); p += 3; } else { b_putc(&b, *p); p++; }
    }
    free(nm);
    free(out->f[pl]);
    out->f[pl] = b.p;
  }
}

/* ── compact data (number_compact.cpp) ────────────────────────────────────────────────────────────────────── */
#define CMAX 20
typedef struct {
  char *pat[CMAX][PL_COUNT];
  signed char state[CMAX][PL_COUNT]; /* 0 absent, 1 pattern, 2 use-fallback ("0") */
  signed char mult[CMAX];
  int largest;
  int isEmpty;
} CompactData;
static void compact_free(CompactData *c) { for (int m = 0; m < CMAX; m++) for (int p = 0; p < PL_COUNT; p++) free(c->pat[m][p]); }
static int count_zeros(const char *s) {
  int z = 0;
  for (; *s; s++) { if (*s == '0') z++; else if (z > 0) break; }
  return z;
}
static void compact_sink(void *ctx, const char *key, size_t kn, ScrRes table) {
  CompactData *c = ctx;
  int magnitude = (int)kn - 1;
  if (magnitude < 0 || magnitude >= CMAX || scr_res_kind(table) != SCR_RES_TABLE) return;
  int multiplier = c->mult[magnitude];
  int n = scr_res_table_len(table);
  for (int i = 0; i < n; i++) {
    const char *k;
    size_t pk;
    ScrRes v = scr_res_table_at(table, i, &k, &pk);
    int pl = -1;
    for (int j = 0; j < PL_COUNT; j++) if (strlen(PL_NAMES[j]) == pk && memcmp(PL_NAMES[j], k, pk) == 0) pl = j;
    if (pl < 0 || c->state[magnitude][pl]) continue;
    size_t sn;
    const char *s = scr_res_str(v, &sn);
    if (!s) continue;
    if (sn == 1 && s[0] == '0') { c->state[magnitude][pl] = 2; sn = 0; s = ""; }
    else { c->state[magnitude][pl] = 1; c->pat[magnitude][pl] = str_dup_n(s, sn); }
    if (multiplier == 0) {
      int z = count_zeros(s);
      if (z > 0) multiplier = z - magnitude - 1;
    }
  }
  if (c->mult[magnitude] == 0) {
    c->mult[magnitude] = (signed char)multiplier;
    if (magnitude > c->largest) c->largest = magnitude;
    c->isEmpty = 0;
  }
}
static void compact_populate(const NfLoc *L, int isLong, int isCurrency, CompactData *c) {
  memset(c, 0, sizeof *c);
  c->isEmpty = 1;
  const char *tail = isCurrency ? "currencyFormat" : "decimalFormat";
  int nsLatn = strcmp(L->ns, "latn") == 0;
  char path[160];
  snprintf(path, sizeof path, "NumberElements/%s/patterns%s/%s", L->ns, isLong ? "Long" : "Short", tail);
  scr_ures_all_items(&L->uloc, SCR_URES_LOC, path, compact_sink, c);
  if (c->isEmpty && !nsLatn) {
    snprintf(path, sizeof path, "NumberElements/latn/patterns%s/%s", isLong ? "Long" : "Short", tail);
    scr_ures_all_items(&L->uloc, SCR_URES_LOC, path, compact_sink, c);
  }
  if (c->isEmpty && isLong) {
    snprintf(path, sizeof path, "NumberElements/%s/patternsShort/%s", L->ns, tail);
    scr_ures_all_items(&L->uloc, SCR_URES_LOC, path, compact_sink, c);
  }
  if (c->isEmpty && !nsLatn && isLong) {
    snprintf(path, sizeof path, "NumberElements/latn/patternsShort/%s", tail);
    scr_ures_all_items(&L->uloc, SCR_URES_LOC, path, compact_sink, c);
  }
}
static int compact_multiplier(const CompactData *c, int magnitude) {
  if (magnitude < 0) return 0;
  if (magnitude > c->largest) magnitude = c->largest;
  return c->mult[magnitude];
}
/* NULL when the plain pattern applies */
static const char *compact_pattern(const CompactData *c, int magnitude, int pl) {
  if (magnitude < 0) return NULL;
  if (magnitude > c->largest) magnitude = c->largest;
  if (c->state[magnitude][pl] == 0 && pl != PL_OTHER) pl = PL_OTHER;
  if (c->state[magnitude][pl] == 1) return c->pat[magnitude][pl];
  return NULL;
}

/* ── the quantity ─────────────────────────────────────────────────────────────────────────────────────────── */
typedef struct {
  Dec d;     /* the (rounded) digits: value = d * 10^d.exp, shifted so the mantissa shows */
  long E;    /* the exponent the notation took out */
  int minFrac;
  int neg, special;
} Quant;

static void q_ops(const Quant *q, PluralOps *o, Buf *scratch) {
  memset(o, 0, sizeof *o);
  Buf ip = {0}, fp = {0};
  split_digits(&q->d, 1, q->minFrac, &ip, &fp);
  Buf fi = {0}, ff = {0};
  /* shift the displayed digits by E (positive: the number grows) */
  {
    Buf d = {0};
    b_put(&d, ip.p, ip.n);
    b_put(&d, fp.p ? fp.p : "", fp.n);
    long p = (long)ip.n + q->E;
    if (p <= 0) { b_putc(&fi, '0'); for (long k = 0; k < -p; k++) b_putc(&ff, '0'); b_put(&ff, d.p, d.n); }
    else if (p >= (long)d.n) { b_put(&fi, d.p, d.n); for (long k = (long)d.n; k < p; k++) b_putc(&fi, '0'); }
    else { b_put(&fi, d.p, (size_t)p); b_put(&ff, d.p + p, d.n - (size_t)p); }
    b_free(&d);
  }
  size_t z = 0;
  while (z + 1 < fi.n && fi.p[z] == '0') z++;
  const char *ib = fi.p + z;
  size_t il = fi.n - z;
  if (il > 18) { ib += il - 18; il = 18; }
  unsigned long long iv = 0;
  for (size_t k = 0; k < il; k++) iv = iv * 10 + (unsigned long long)(ib[k] - '0');
  unsigned long long fv = 0, tv = 0;
  size_t fl = ff.n > 19 ? 19 : ff.n;
  for (size_t k = 0; k < fl; k++) fv = fv * 10 + (unsigned long long)(ff.p[k] - '0');
  size_t tl = fl;
  while (tl > 0 && ff.p[tl - 1] == '0') tl--;
  for (size_t k = 0; k < tl; k++) tv = tv * 10 + (unsigned long long)(ff.p[k] - '0');
  o->i = iv; o->f = fv; o->t = tv;
  o->v = (int)ff.n;
  long scale = q->d.n ? q->d.exp : 0;
  long w = -scale - q->E;
  o->w = w > 0 ? (int)w : 0;
  o->e = q->E;
  if (q->d.n == 0) o->n = 0;
  else {
    Buf nb = {0};
    b_put(&nb, q->d.d, (size_t)q->d.n);
    char e[32];
    snprintf(e, sizeof e, "e%ld", q->d.exp + q->E);
    b_puts(&nb, e);
    o->n = strtod(nb.p, NULL);
    b_free(&nb);
  }
  b_free(&ip); b_free(&fp); b_free(&fi); b_free(&ff);
  (void)scratch;
}

/* ── the number text (integer digits with grouping, decimal mark, fraction digits) ─────────────────────────── */
static void put_digits(Buf *b, const NfLoc *L, const char *digits, size_t n) { for (size_t i = 0; i < n; i++) b_puts(b, L->dig[digits[i] - '0']); }

static void write_number(Buf *out, const NfLoc *L, const NfOpts *o, const Quant *q, int minInt, int useCurrency, int g1, int g2, int minGroup) {
  if (q->special == 1) { b_puts(out, L->sym[Y_NAN]); return; }
  if (q->special == 2) { b_puts(out, L->sym[Y_INF]); return; }
  Buf ip = {0}, fp = {0};
  split_digits(&q->d, minInt, q->minFrac, &ip, &fp);
  size_t in = ip.n;
  for (size_t i = 0; i < in; i++) {
    int position = (int)(in - i) - 1; /* index from the right of this digit */
    if (i > 0 && g1 > 0) {
      int pos = position + 1 - g1; /* ICU asks about the separator before the digit at `position + 1`... */
      (void)pos;
    }
    /* groupAtPosition(position = digits to the right of the candidate separator) */
    if (i > 0 && g1 > 0) {
      int right = (int)(in - i);
      int p = right - g1;
      if (p >= 0 && (g2 > 0 ? p % g2 == 0 : 0) && (int)in - 1 - g1 + 1 >= minGroup)
        b_puts(out, useCurrency ? L->sym[Y_CGRP] : L->sym[Y_GRP]);
    }
    b_puts(out, L->dig[ip.p[i] - '0']);
  }
  if (fp.n) {
    b_puts(out, useCurrency ? L->sym[Y_CDEC] : L->sym[Y_DEC]);
    put_digits(out, L, fp.p, fp.n);
  }
  (void)o;
  b_free(&ip); b_free(&fp);
}

/* ICU's ScientificModifier: exponent digits inserted at (i - j) with i advancing by the digit's UTF-16 length. */
static void exp_digits(Buf *out, const NfLoc *L, long e) {
  uint16_t arr[128];
  int len = 0;
  long i = 0, disp = e;
  for (long j = 0; j < 1 || disp > 0; j++, disp /= 10) {
    uint16_t du[2];
    size_t dl = utf16_of(L->dig[disp % 10], du);
    long pos = i - j;
    if (pos < 0) pos = 0;
    if (pos > len) pos = len;
    memmove(arr + pos + dl, arr + pos, (size_t)(len - pos) * sizeof(uint16_t));
    for (size_t k = 0; k < dl; k++) arr[pos + (long)k] = du[k];
    len += (int)dl;
    i += (long)dl;
  }
  put_utf16(out, arr, (size_t)len);
}

/* ── affixes (PatternStringUtils::patternInfoToStringBuilder + AffixUtils::unescape) ───────────────────────── */
typedef struct { Buf s; int firstCur, lastCur; } AffixOut;
typedef struct {
  const NfLoc *L;
  const char *curSymbol; /* for a single ¤ at the unit width in force */
  const char *curCode;
  const char *curPlural; /* ¤¤¤ */
} AffixCtx;
enum { SIGN_POS = 0, SIGN_POS_SIGN = 1, SIGN_NEG = 2 };

static void unescape_affix(AffixOut *out, const char *a, const AffixCtx *x, int prependSign, int plusInstead) {
  int q = 0, first = 1;
  const NfLoc *L = x->L;
  int lastWasCur = 0;
  if (prependSign) { b_puts(&out->s, plusInstead ? L->sym[Y_PLUS] : L->sym[Y_MINUS]); first = 0; lastWasCur = 0; }
  for (const char *p = a; *p;) {
    if (*p == '\'') {
      if (p[1] == '\'') { b_putc(&out->s, '\''); p += 2; first = 0; lastWasCur = 0; continue; }
      q = !q; p++; continue;
    }
    if (q) { b_putc(&out->s, *p); p++; first = 0; lastWasCur = 0; continue; }
    if ((unsigned char)p[0] == 0xc2 && (unsigned char)p[1] == 0xa4) {
      int run = 0;
      while ((unsigned char)p[0] == 0xc2 && (unsigned char)p[1] == 0xa4) { run++; p += 2; }
      if (first) out->firstCur = 1;
      if (run == 1) b_puts(&out->s, x->curSymbol);
      else if (run == 2) b_puts(&out->s, x->curCode);
      else if (run == 3) b_puts(&out->s, x->curPlural ? x->curPlural : x->curCode);
      else b_puts(&out->s, "\xef\xbf\xbd");
      first = 0; lastWasCur = 1;
      continue;
    }
    if (*p == '%') b_puts(&out->s, L->sym[Y_PCT]);
    else if ((unsigned char)p[0] == 0xe2 && (unsigned char)p[1] == 0x80 && (unsigned char)p[2] == 0xb0) { b_puts(&out->s, L->sym[Y_PERMILLE]); p += 3; first = 0; lastWasCur = 0; continue; }
    else if (*p == '-') b_puts(&out->s, plusInstead ? L->sym[Y_PLUS] : L->sym[Y_MINUS]);
    else if (*p == '+') b_puts(&out->s, L->sym[Y_PLUS]);
    else b_putc(&out->s, *p);
    p++; first = 0; lastWasCur = 0;
  }
  out->lastCur = lastWasCur;
}
static void build_affix(AffixOut *out, const PatInfo *pi, int isPrefix, int signType, const AffixCtx *x) {
  int posHasPlus = affix_has_unquoted(pi->pos.prefix, '+') || affix_has_unquoted(pi->pos.suffix, '+');
  int negHasMinus = pi->hasNeg && (affix_has_unquoted(pi->neg.prefix, '-') || affix_has_unquoted(pi->neg.suffix, '-'));
  int plusReplaces = signType == SIGN_POS_SIGN && !posHasPlus;
  int useNeg = pi->hasNeg && (signType == SIGN_NEG || (negHasMinus && plusReplaces));
  int prepend = (!isPrefix || useNeg) ? 0 : (signType == SIGN_NEG ? 1 : plusReplaces);
  const SubPat *sp = useNeg ? &pi->neg : &pi->pos;
  unescape_affix(out, isPrefix ? sp->prefix : sp->suffix, x, prepend, plusReplaces);
}

static int resolve_sign(SignDisp sd, int neg, int zero) {
  /* signum: NEG / NEG_ZERO / POS_ZERO / POS */
  switch (sd) {
    case SD_AUTO: return neg ? SIGN_NEG : SIGN_POS;
    case SD_ALWAYS: return neg ? SIGN_NEG : SIGN_POS_SIGN;
    case SD_EXCEPT_ZERO: return neg && !zero ? SIGN_NEG : (zero ? SIGN_POS : SIGN_POS_SIGN);
    case SD_NEGATIVE: return neg && !zero ? SIGN_NEG : SIGN_POS;
    case SD_NEVER: return SIGN_POS;
  }
  return SIGN_POS;
}

/* the modifier of one pattern, spliced around `inner`; returns the UTF-16 length of any currency spacing added */
static size_t apply_pattern(Buf *out, const PatInfo *pi, int signType, const AffixCtx *x, const char *inner, size_t innerN) {
  if (!(signType == SIGN_NEG && pi->hasNeg ? pi->neg.hasBody : pi->pos.hasBody)) { inner = ""; innerN = 0; }
  AffixOut pre = {{0}}, suf = {{0}};
  build_affix(&pre, pi, 1, signType, x);
  build_affix(&suf, pi, 0, signType, x);
  size_t spacing = 0;
  const NfLoc *L = x->L;
  b_put(out, pre.s.p ? pre.s.p : "", pre.s.n);
  /* CurrencySpacingEnabledModifier */
  if (pre.lastCur && innerN > 0 && pre.s.n > 0) {
    unsigned affixCp = last_cp(pre.s.p, pre.s.n);
    int numberIsDigit = is_nd(first_cp(inner));
    if (!is_sz(affixCp) && numberIsDigit) {
      char ins[16];
      if (!rget(&L->uloc, SCR_URES_CURR, "currencySpacing/afterCurrency/insertBetween", ins, sizeof ins)) strcpy(ins, "\xc2\xa0");
      b_puts(out, ins);
      uint16_t tmp[4]; size_t u = 0;
      for (const char *p = ins; *p; p += u8len((unsigned char)*p)) u += utf16_of(p, tmp);
      spacing += u;
    }
  }
  b_put(out, inner, innerN);
  if (suf.firstCur && innerN > 0 && suf.s.n > 0) {
    unsigned affixCp = first_cp(suf.s.p);
    unsigned numberCp = last_cp(inner, innerN);
    int numberIsDigit = is_nd(numberCp);
    if (!is_sz(affixCp) && numberIsDigit) {
      char ins[16];
      if (!rget(&L->uloc, SCR_URES_CURR, "currencySpacing/beforeCurrency/insertBetween", ins, sizeof ins)) strcpy(ins, "\xc2\xa0");
      b_puts(out, ins);
      uint16_t tmp[4]; size_t u = 0;
      for (const char *p = ins; *p; p += u8len((unsigned char)*p)) u += utf16_of(p, tmp);
      spacing += u;
    }
  }
  b_put(out, suf.s.p ? suf.s.p : "", suf.s.n);
  b_free(&pre.s); b_free(&suf.s);
  return spacing;
}

/* SimpleModifier(pattern with 0..1 arguments) applied to [0, rightIndex) of `mid`; the part of mid after
 * rightIndex stays behind the pattern's suffix (ICU hands the outer modifier an end index that misses the
 * currency spacing the middle modifier inserted). */
static void apply_outer(Buf *out, const char *pat, const char *mid, size_t midN, size_t spacingUnits) {
  if (!sf_has0(pat)) { sf_format(out, pat, "", ""); return; } /* no argument: the pattern replaces the number */
  Buf pfx = {0}, sfx = {0};
  /* split the pattern at {0} */
  Buf whole = {0};
  sf_format(&whole, pat, "\x01", "");
  char *mark = memchr(whole.p, '\x01', whole.n);
  size_t pn = (size_t)(mark - whole.p);
  b_put(&pfx, whole.p, pn);
  b_put(&sfx, mark + 1, whole.n - pn - 1);
  if (spacingUnits == 0) {
    b_put(out, pfx.p ? pfx.p : "", pfx.n);
    b_put(out, mid, midN);
    b_put(out, sfx.p ? sfx.p : "", sfx.n);
  } else {
    size_t un;
    uint16_t *u = to_utf16(mid, midN, &un);
    size_t cut = un >= spacingUnits ? un - spacingUnits : 0;
    b_put(out, pfx.p ? pfx.p : "", pfx.n);
    put_utf16(out, u, cut);
    b_put(out, sfx.p ? sfx.p : "", sfx.n);
    put_utf16(out, u + cut, un - cut);
    free(u);
  }
  b_free(&pfx); b_free(&sfx); b_free(&whole);
}

/* ── RoundingImpl::chooseMultiplierAndApply ────────────────────────────────────────────────────────────────── */
typedef int (*MultFn)(void *ctx, int magnitude);
static int choose_multiplier(Quant *q, const NfOpts *o, MultFn mf, void *ctx) {
  int magnitude = (int)dec_mag(&q->d);
  int multiplier = mf(ctx, magnitude);
  if (q->d.n) q->d.exp += multiplier;
  apply_rounding(o, &q->d, q->neg, &q->minFrac);
  if (q->d.n == 0) return multiplier;
  if (dec_mag(&q->d) == magnitude + multiplier) return multiplier;
  int m2 = mf(ctx, magnitude + 1);
  if (multiplier == m2) return multiplier;
  q->d.exp += m2 - multiplier;
  apply_rounding(o, &q->d, q->neg, &q->minFrac);
  return m2;
}
typedef struct { int interval; } SciCtx;
static int sci_multiplier(void *c, int magnitude) {
  int interval = ((SciCtx *)c)->interval;
  int digitsShown = interval <= 1 ? 1 : ((magnitude % interval + interval) % interval) + 1;
  return digitsShown - magnitude - 1;
}
static int compact_mult_fn(void *c, int magnitude) { return compact_multiplier((const CompactData *)c, magnitude); }

/* ── the formatter (NumberFormatterImpl::macrosToMicroGenerator, in V8's configuration) ─────────────────────── */
static int nf_run(NfCtx *c, const NfOpts *o, NfLoc *L, int special, int neg, Dec qdec, double xdbl, int fromDouble, Buf *out) {
  (void)c;
  if (!special && fromDouble && o->incr != 1 && o->incr != 5 && o->rtype == RT_FRACTION) { dec_free(&qdec); qdec = dec_from_double_fast(fabs(xdbl)); }
  int isCurrency = o->style == ST_CURRENCY;
  int unitWidth; /* 0 short, 1 narrow, 2 full name, 3 ISO code */
  if (isCurrency) unitWidth = o->curDisp == CD_CODE ? 3 : o->curDisp == CD_NARROW ? 1 : o->curDisp == CD_NAME ? 2 : 0;
  else if (o->style == ST_UNIT) unitWidth = o->unitDisp == 2 ? 2 : o->unitDisp == 1 ? 1 : 0;
  else unitWidth = 0;
  UnitSpec us;
  us.num = us.den = -1;
  int isPercent = o->style == ST_PERCENT;
  if (o->style == ST_UNIT) {
    parse_unit(o->unit, &us);
    if (strcmp(SIMPLE_UNITS[us.num], "percent") == 0) isPercent = 1;
  }
  int isCompact = o->notation == NT_COMPACT;
  int isBase = o->style == ST_DECIMAL;
  int isCldrUnit = !isCurrency && !isBase && (unitWidth == 2 || !isPercent || isCompact) && (o->style == ST_UNIT || (o->style == ST_PERCENT && isCompact));
  /* style percent is the percent unit scaled by 100; with compact notation it is formatted from the unit data */
  UnitSpec pu;
  char pctUnitName[16] = "percent";

  /* symbols: the formatted currency's format info joins the region currency's */
  if (isCurrency) cur_info_apply(L, o->currency);

  /* the pattern ICU parses for grouping sizes and affixes */
  char pbuf[256];
  const char *patKey;
  if (isCurrency && L->hasCurPat) { snprintf(pbuf, sizeof pbuf, "%s", L->curPat); patKey = NULL; }
  else {
    if (isCldrUnit) patKey = "decimalFormat";
    else if (isPercent) patKey = "percentFormat";
    else if (!isCurrency || unitWidth == 2) patKey = "decimalFormat";
    else if (o->accounting && o->sign != SD_NEVER) patKey = "accountingFormat"; /* V8 has no accounting variant of signDisplay never */
    else patKey = "currencyFormat";
    if (!pat_get(L, patKey, pbuf, sizeof pbuf)) strcpy(pbuf, patKey[0] == 'p' ? "#,##0%" : patKey[0] == 'c' || patKey[0] == 'a' ? "\xc2\xa4#,##0.00" : "#,##0.###");
  }
  PatInfo pat;
  parse_pattern(pbuf, &pat);
  int minGroupLoc = min_grouping(L);
  int minGroup = o->group == UG_ALWAYS ? 1 : (o->group == UG_MIN2 || (o->group == UG_AUTO && isCompact)) ? (minGroupLoc > 2 ? minGroupLoc : 2) : minGroupLoc;
  int g1, g2;
  resolve_grouping(o->group, &pat.pos, &g1, &g2);

  /* currency symbols at the unit width */
  char *curSym = NULL;
  if (isCurrency) {
    if (unitWidth == 1) curSym = cur_name(L, o->currency, 2);
    else if (unitWidth == 3) curSym = str_dup_n(o->currency, 3);
    else curSym = cur_name(L, o->currency, 0);
  } else curSym = strdup("");

  Quant q;
  memset(&q, 0, sizeof q);
  q.special = special;
  q.neg = neg;
  q.d = special ? dec_zero() : dec_copy(&qdec);
  if (!special && o->style == ST_PERCENT && q.d.n) q.d.exp += 2;
  (void)pu;

  CompactData cd;
  int haveCompact = 0;
  const char *compactPat = NULL;
  char *compactPatCopy = NULL;
  Buf expText = {0};
  PluralOps ops;
  Fmts unitF;
  memset(&unitF, 0, sizeof unitF);
  if (!special) {
    if (o->notation == NT_STANDARD) apply_rounding(o, &q.d, neg, &q.minFrac);
    else if (o->notation == NT_SCIENTIFIC || o->notation == NT_ENGINEERING) {
      SciCtx sc = {o->notation == NT_SCIENTIFIC ? 1 : 3};
      long exponent = 0;
      if (q.d.n == 0) apply_rounding(o, &q.d, neg, &q.minFrac);
      else exponent = -choose_multiplier(&q, o, sci_multiplier, &sc);
      q.E = exponent;
      b_puts(&expText, L->sym[Y_EXP]);
      if (exponent < 0) b_puts(&expText, L->sym[Y_MINUS]);
      exp_digits(&expText, L, exponent < 0 ? -exponent : exponent);
    } else { /* compact */
      int curType = isCurrency && unitWidth != 2;
      compact_populate(L, o->compactLong, curType, &cd);
      haveCompact = 1;
      int magnitude, multiplier = 0;
      if (q.d.n == 0) { magnitude = 0; apply_rounding(o, &q.d, neg, &q.minFrac); }
      else {
        multiplier = choose_multiplier(&q, o, compact_mult_fn, &cd);
        magnitude = q.d.n == 0 ? 0 : (int)dec_mag(&q.d);
        magnitude -= multiplier;
      }
      PluralOps mo;
      Buf sc = {0};
      q_ops(&q, &mo, &sc);
      int pl = plural_select(L->name, &mo);
      compactPat = compact_pattern(&cd, magnitude, pl);
      if (compactPat) compactPatCopy = strdup(compactPat);
      q.E = -multiplier;
    }
  } else {
    if (isCompact) { /* zero-like: the plain modifier */ }
  }
  q_ops(&q, &ops, NULL);
  int plural = special ? PL_OTHER : plural_select(L->name, &ops);
  if (!special && isCompact && (isCldrUnit || (isCurrency && unitWidth == 2))) {
    /* the long-name handler sits before the compact handler: it sees the quantity at its natural scale, rounded
     * by the configured precision (getPluralSafe rounds a copy) */
    Quant qc;
    memset(&qc, 0, sizeof qc);
    qc.neg = neg;
    qc.d = dec_copy(&qdec);
    if (o->style == ST_PERCENT && qc.d.n) qc.d.exp += 2;
    apply_rounding(o, &qc.d, neg, &qc.minFrac);
    PluralOps po;
    q_ops(&qc, &po, NULL);
    plural = plural_select(L->name, &po);
    dec_free(&qc.d);
  }

  int zero = special == 1 || (!special && q.d.n == 0); /* NaN has no digits: ICU treats it as zero-ish */
  int signType = resolve_sign(o->sign, special == 1 ? 0 : neg, zero);

  /* the modifier pattern: the compact pattern when one applies, else the main pattern */
  PatInfo cpat;
  const PatInfo *useP = &pat;
  if (compactPatCopy) { parse_pattern(compactPatCopy, &cpat); useP = &cpat; }
  char *plName = (isCurrency) ? cur_plural_name(L, o->currency, plural) : NULL;
  AffixCtx ax = {L, curSym, isCurrency ? o->currency : "", plName};

  /* the number with its inner modifier */
  Buf inner = {0};
  write_number(&inner, L, o, &q, o->minInt, isCurrency, g1, g2, minGroup);
  if (expText.n) b_put(&inner, expText.p, expText.n);
  Buf mid = {0};
  size_t spacing = apply_pattern(&mid, useP, signType, &ax, inner.p ? inner.p : "", inner.n);

  /* outer modifier: unit names or currency long names */
  Buf body = {0};
  Fmts curF;
  memset(&curF, 0, sizeof curF);
  if (isCldrUnit) {
    if (o->style == ST_PERCENT) {
      /* percent style in compact notation formats as the percent unit, short */
      unit_load(L, 0, "concentr", "percent", &unitF);
    } else unit_patterns(L, o->unitDisp, o->unit, &unitF);
    apply_outer(&body, fmt_with_plural(&unitF, plural), mid.p ? mid.p : "", mid.n, spacing);
  } else if (isCurrency && unitWidth == 2) {
    currency_long_patterns(L, o->currency, &curF);
    apply_outer(&body, fmt_with_plural(&curF, plural), mid.p ? mid.p : "", mid.n, spacing);
  } else b_put(&body, mid.p ? mid.p : "", mid.n);
  b_put(out, body.p ? body.p : "", body.n);

  b_free(&body); b_free(&mid); b_free(&inner); b_free(&expText);
  fmts_free(&unitF); fmts_free(&curF);
  if (haveCompact) compact_free(&cd);
  free(compactPatCopy); free(curSym); free(plName);
  dec_free(&q.d);
  return 0;
}

int scr_nf_format_core(char **out, const char *locales, int is_bigint, double x, const char *big, const char *const *kv,
                       int nkv) {
  NfCtx c;
  memset(&c, 0, sizeof c);
  c.kv = kv;
  c.nkv = nkv;
  NfOpts o;
  memset(&o, 0, sizeof o);
  NfLoc *L = calloc(1, sizeof *L);
  Buf res = {0};
  int rc = 0;
  { /* CanonicalizeLocaleList comes before the options are read */
    ScrLocRes probe;
    int lrc = scr_locale_resolve(SCR_LOC_NF, locales, &probe);
    if (lrc != 0) { char em[260]; scr_locale_error_message(lrc, &probe, em, sizeof em); nf_fail(&c, 1, "%s", em); goto fail; }
  }
  if (parse_options(&c, &o, locales, NULL) != 0 || c.errKind) goto fail;
  if (load_locale(&c, L, locales, &o) != 0) goto fail;
  {
    int special = 0, neg = 0;
    Dec q;
    if (is_bigint) {
      const char *s = big;
      if (*s == '-') { neg = 1; s++; }
      q = dec_from_digits(s, strlen(s));
    } else if (isnan(x)) { special = 1; q = dec_zero(); }
    else if (isinf(x)) { special = 2; neg = x < 0; q = dec_zero(); }
    else { neg = signbit(x) != 0; q = dec_from_double(fabs(x)); }
    nf_run(&c, &o, L, special, neg, q, x, !is_bigint, &res);
    dec_free(&q);
  }
  free(L);
  *out = res.p ? res.p : strdup("");
  return 0;
fail:
  free(L);
  rc = c.errKind ? c.errKind : 1;
  *out = c.err.p ? c.err.p : strdup("error");
  b_free(&res);
  return rc;
}

#ifndef SCR_NF_STANDALONE
/* ── the runtime entries ──────────────────────────────────────────────────────────────────────────────────── */
static ScrStr *nf_entry(int is_big, double x, ScrStr *digits, ScrStr *locales, ScrArr *kv) {
  const char *loc = locales ? locales->data : "";
  enum { MAXKV = 48 };
  const char *pairs[MAXKV * 2];
  int n = 0;
  if (kv != NULL) {
    ScrStr **d = (ScrStr **)kv->data;
    for (size_t i = 0; i + 1 < kv->len && n < MAXKV; i += 2) { pairs[2 * n] = d[i]->data; pairs[2 * n + 1] = d[i + 1]->data; n++; }
  }
  int cacheable = 0;
  for (int i = 0; i < n; i++) if (strcmp(pairs[2 * i], SCR_ICU_CACHE_KEY) == 0) cacheable = 1;
  const char *eff = cacheable ? scr_icu_cache_lookup(SCR_ICUC_NUMBER, loc) : loc;
  char *res = NULL;
  int rc = scr_nf_format_core(&res, eff, is_big, x, is_big ? digits->data : NULL, pairs, n);
  if (rc == 0 && cacheable) scr_icu_cache_store(SCR_ICUC_NUMBER, loc);
  if (rc != 0) {
    scr_throw_error_msg(rc == 2 ? SCR_ERR_TYPE : SCR_ERR_RANGE, res, strlen(res));
    free(res);
    return NULL;
  }
  ScrStr *s = scr_str_new(res, strlen(res));
  free(res);
  return s;
}
/* x.toLocaleString(locales, options) / Intl.NumberFormat(locales, options).format(x): +1, or NULL with the
 * RangeError / TypeError pending. `kv` is a string[] of alternating option name and tagged value. */
ScrStr *scr_nf_format_num(double x, ScrStr *locales, ScrArr *kv) { return nf_entry(0, x, NULL, locales, kv); }
ScrStr *scr_nf_format_big(ScrStr *digits, ScrStr *locales, ScrArr *kv) { return nf_entry(1, 0, digits, locales, kv); }

/* ── checked-dynamic arguments ────────────────────────────────────────────────────────────────────────────── */
static const char *const NF_KEYS[] = {
  "localeMatcher", "numberingSystem", "style", "currency", "currencyDisplay", "currencySign", "unit", "unitDisplay",
  "notation", "minimumIntegerDigits", "minimumFractionDigits", "maximumFractionDigits", "minimumSignificantDigits",
  "maximumSignificantDigits", "roundingIncrement", "roundingMode", "roundingPriority", "trailingZeroDisplay",
  "compactDisplay", "useGrouping", "signDisplay", NULL};

/* The locales argument as text: "" for undefined, an empty list or a primitive (ToObject gives it no elements), tags
 * joined with "," otherwise ("-", which is not a structurally valid tag, for an empty one: V8 rejects it, it is not
 * the default locale). CanonicalizeLocaleList's element rules: a string, or an object converted with ToString;
 * anything else is a TypeError. +1 or NULL with the exception pending. */
static ScrStr *dyn_locales_text(const ScrDyn *l) {
  if (l == NULL || l->kind == SCR_DYN_UNDEF) return scr_str_new("", 0);
  if (l->kind == SCR_DYN_NULL) { scr_throw_error_msg(SCR_ERR_TYPE, "Cannot convert undefined or null to object", 42); return NULL; }
  if (l->kind == SCR_DYN_STR) return l->v.str->len == 0 ? scr_str_new("-", 1) : scr_str_retain(l->v.str);
  size_t n = 0;
  const ScrDyn *const *items = NULL;
  ScrDyn **owned = NULL;
  if (l->kind == SCR_DYN_ARR) { n = l->v.arr.len; items = (const ScrDyn *const *)l->v.arr.items; }
  else if (l->kind == SCR_DYN_OBJ) { /* an array-like: its length and index properties */
    const ScrDyn *len = scr_dyn_obj_get(l, "length", 6);
    if (len != NULL && len->kind == SCR_DYN_NUM && len->v.num >= 1) {
      n = len->v.num > 1000000 ? 1000000 : (size_t)len->v.num;
      owned = (ScrDyn **)calloc(n, sizeof(ScrDyn *));
      for (size_t i = 0; i < n; i++) { char k[24]; int kl = snprintf(k, sizeof k, "%zu", i); owned[i] = (ScrDyn *)scr_dyn_obj_get(l, k, (size_t)kl); }
      items = (const ScrDyn *const *)owned;
    }
  }
  if (n == 0) { free(owned); return scr_str_new("", 0); }
  size_t cap = 64, len = 0;
  char *b = (char *)malloc(cap);
  for (size_t i = 0; i < n; i++) {
    const ScrDyn *e = items[i];
    ScrStr *t = NULL;
    if (e != NULL && e->kind == SCR_DYN_STR) t = scr_str_retain(e->v.str);
    else if (e == NULL || e->kind == SCR_DYN_UNDEF || e->kind == SCR_DYN_NULL || e->kind == SCR_DYN_NUM || e->kind == SCR_DYN_BOOL || e->kind == SCR_DYN_BIG) {
      free(b); free(owned);
      scr_throw_error_msg(SCR_ERR_TYPE, "Language ID should be string or object.", 38);
      return NULL;
    } else {
      t = scr_dyn_string_coerce_js(e);
      if (t == NULL) { free(b); free(owned); return NULL; }
    }
    while (len + t->len + 3 > cap) { cap *= 2; b = (char *)realloc(b, cap); }
    if (i) b[len++] = ',';
    if (t->len == 0) { b[len++] = '-'; b[len++] = '-'; } /* "--": not the cache key "-" of an empty string */
    memcpy(b + len, t->data, t->len);
    len += t->len;
    scr_str_release(t);
  }
  free(owned);
  ScrStr *r = scr_str_new(b, len);
  free(b);
  return r;
}
static void kv_push(ScrArr *kv, const char *key, char tag, const char *text, size_t n) {
  scr_arr_push_ref(kv, scr_str_new(key, strlen(key)));
  Buf b = {0};
  b_putc(&b, tag);
  b_put(&b, text, n);
  scr_arr_push_ref(kv, scr_str_new(b.p, b.n));
  b_free(&b);
}
/* the options object as alternating name / tagged value; +1, NULL with the exception pending */
static ScrArr *dyn_options_kv(const ScrDyn *o, const char *who) {
  ScrArr *kv = scr_arr_new(SCR_ELEM_STR, 0);
  if (o == NULL || o->kind == SCR_DYN_UNDEF) { kv_push(kv, SCR_ICU_CACHE_KEY, 'u', "", 0); return kv; }
  if (o->kind == SCR_DYN_NULL) {
    scr_arr_release(kv);
    char msg[96];
    int mn = snprintf(msg, sizeof msg, "%s.prototype.toLocaleString called on null or undefined", who);
    scr_throw_error_msg(SCR_ERR_TYPE, msg, (size_t)mn);
    return NULL;
  }
  if (o->kind != SCR_DYN_OBJ) return kv; /* a primitive has none of the properties */
  for (int i = 0; NF_KEYS[i]; i++) {
    const ScrDyn *v = scr_dyn_obj_get(o, NF_KEYS[i], strlen(NF_KEYS[i]));
    if (v == NULL || v->kind == SCR_DYN_UNDEF) continue;
    char num[40];
    switch (v->kind) {
      case SCR_DYN_STR: kv_push(kv, NF_KEYS[i], 's', v->v.str->data, v->v.str->len); break;
      case SCR_DYN_NUM: { size_t n = scr_f64_to_str(v->v.num, num); kv_push(kv, NF_KEYS[i], 'n', num, n); break; }
      case SCR_DYN_BOOL: kv_push(kv, NF_KEYS[i], 'b', v->v.b ? "true" : "false", v->v.b ? 4 : 5); break;
      case SCR_DYN_NULL: kv_push(kv, NF_KEYS[i], 'z', "", 0); break;
      default: {
        ScrStr *t = scr_dyn_string_coerce_js(v);
        if (t == NULL) { scr_arr_release(kv); return NULL; }
        kv_push(kv, NF_KEYS[i], 's', t->data, t->len);
        scr_str_release(t);
      }
    }
  }
  return kv;
}
/* null options: the locales are canonicalized first, so a bad locale wins over the TypeError */
static int nf_locale_probe_fails(double x, ScrStr *locales) {
  ScrArr *none = scr_arr_new(SCR_ELEM_STR, 0);
  ScrStr *p = scr_nf_format_num(x, locales, none);
  scr_arr_release(none);
  if (p == NULL) return 1;
  scr_str_release(p);
  return 0;
}
ScrStr *scr_nf_format_num_dyn(double x, ScrStr *locales, const ScrDyn *opts) {
  if (opts != NULL && opts->kind == SCR_DYN_NULL && nf_locale_probe_fails(x, locales)) return NULL;
  ScrArr *kv = dyn_options_kv(opts, "Number");
  if (kv == NULL) return NULL;
  ScrStr *r = scr_nf_format_num(x, locales, kv);
  scr_arr_release(kv);
  return r;
}
ScrStr *scr_nf_format_big_dyn(ScrStr *digits, ScrStr *locales, const ScrDyn *opts) {
  if (opts != NULL && opts->kind == SCR_DYN_NULL) {
    ScrArr *none = scr_arr_new(SCR_ELEM_STR, 0);
    ScrStr *p = scr_nf_format_big(digits, locales, none);
    scr_arr_release(none);
    if (p == NULL) return NULL;
    scr_str_release(p);
  }
  ScrArr *kv = dyn_options_kv(opts, "BigInt");
  if (kv == NULL) return NULL;
  ScrStr *r = scr_nf_format_big(digits, locales, kv);
  scr_arr_release(kv);
  return r;
}
/* the hook the checked-dynamic toLocaleString uses (the receiver is a number or a bigint) */
static ScrStr *nf_dyn_entry(const ScrDyn *v, const ScrDyn *locales, const ScrDyn *opts) {
  ScrStr *l = dyn_locales_text(locales);
  if (l == NULL) return NULL;
  ScrStr *r;
  if (v->kind == SCR_DYN_NUM) r = scr_nf_format_num_dyn(v->v.num, l, opts);
  else {
    ScrStr *d = scr_dyn_big_ops()->to_str(v->v.big, 10);
    r = scr_nf_format_big_dyn(d, l, opts);
    scr_str_release(d);
  }
  scr_str_release(l);
  return r;
}
__attribute__((constructor)) static void nf_register(void) { scr_nf_hook_dyn = nf_dyn_entry; }
#endif
