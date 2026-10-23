/* Port of ICU 78.2 i18n/dtptngen.cpp (DateTimePatternGenerator), over scr_ures.h. */
#include "scr_dtpg.h"
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
static void sb_free(Sb *b) { free(b->p); b->p = NULL; b->n = b->cap = 0; }
static char *sb_take(Sb *b) { if (!b->p) { b->p = (char *)malloc(1); b->p[0] = 0; } char *r = b->p; b->p = NULL; b->n = b->cap = 0; return r; }
static char *dupn(const char *s, size_t n) { char *r = (char *)malloc(n + 1); memcpy(r, s, n); r[n] = 0; return r; }
static char *dups(const char *s) { return dupn(s, strlen(s)); }

/* ── constants ───────────────────────────────────────────────────────────────────────────────────────────── */
enum {
  F_ERA, F_YEAR, F_QUARTER, F_MONTH, F_WEEK_OF_YEAR, F_WEEK_OF_MONTH, F_WEEKDAY, F_DAY_OF_YEAR, F_DOW_IN_MONTH, F_DAY,
  F_DAYPERIOD, F_HOUR, F_MINUTE, F_SECOND, F_FRACTIONAL, F_ZONE, F_COUNT
};
#define MAX_PATTERN_ENTRIES 52
#define MAX_DT_TOKEN 50
#define NONE 0
#define EXTRA_FIELD 0x10000
#define MISSING_FIELD 0x1000
#define DT_NARROW (-0x101)
#define DT_SHORTER (-0x102)
#define DT_SHORT (-0x103)
#define DT_LONG (-0x104)
#define DT_NUMERIC 0x100
#define DT_DELTA 0x10
enum { FLAG_NONE = 0, FLAG_FIX_FRACTIONAL = 1, FLAG_CAP_J = 2 };
#define FRACTIONAL_MASK (1 << F_FRACTIONAL)
#define SECOND_AND_FRACTIONAL_MASK ((1 << F_SECOND) | (1 << F_FRACTIONAL))

typedef struct { char ch; int field; int type; int minLen; int weight; } DtTypeElem;
static const DtTypeElem dtTypes[] = {
  {'G', F_ERA, DT_SHORT, 1, 3}, {'G', F_ERA, DT_LONG, 4, 0}, {'G', F_ERA, DT_NARROW, 5, 0},
  {'y', F_YEAR, DT_NUMERIC, 1, 20}, {'Y', F_YEAR, DT_NUMERIC + DT_DELTA, 1, 20},
  {'u', F_YEAR, DT_NUMERIC + 2 * DT_DELTA, 1, 20}, {'r', F_YEAR, DT_NUMERIC + 3 * DT_DELTA, 1, 20},
  {'U', F_YEAR, DT_SHORT, 1, 3}, {'U', F_YEAR, DT_LONG, 4, 0}, {'U', F_YEAR, DT_NARROW, 5, 0},
  {'Q', F_QUARTER, DT_NUMERIC, 1, 2}, {'Q', F_QUARTER, DT_SHORT, 3, 0}, {'Q', F_QUARTER, DT_LONG, 4, 0},
  {'Q', F_QUARTER, DT_NARROW, 5, 0},
  {'q', F_QUARTER, DT_NUMERIC + DT_DELTA, 1, 2}, {'q', F_QUARTER, DT_SHORT - DT_DELTA, 3, 0},
  {'q', F_QUARTER, DT_LONG - DT_DELTA, 4, 0}, {'q', F_QUARTER, DT_NARROW - DT_DELTA, 5, 0},
  {'M', F_MONTH, DT_NUMERIC, 1, 2}, {'M', F_MONTH, DT_SHORT, 3, 0}, {'M', F_MONTH, DT_LONG, 4, 0},
  {'M', F_MONTH, DT_NARROW, 5, 0},
  {'L', F_MONTH, DT_NUMERIC + DT_DELTA, 1, 2}, {'L', F_MONTH, DT_SHORT - DT_DELTA, 3, 0},
  {'L', F_MONTH, DT_LONG - DT_DELTA, 4, 0}, {'L', F_MONTH, DT_NARROW - DT_DELTA, 5, 0},
  {'l', F_MONTH, DT_NUMERIC + DT_DELTA, 1, 1},
  {'w', F_WEEK_OF_YEAR, DT_NUMERIC, 1, 2},
  {'W', F_WEEK_OF_MONTH, DT_NUMERIC, 1, 0},
  {'E', F_WEEKDAY, DT_SHORT, 1, 3}, {'E', F_WEEKDAY, DT_LONG, 4, 0}, {'E', F_WEEKDAY, DT_NARROW, 5, 0},
  {'E', F_WEEKDAY, DT_SHORTER, 6, 0},
  {'c', F_WEEKDAY, DT_NUMERIC + 2 * DT_DELTA, 1, 2}, {'c', F_WEEKDAY, DT_SHORT - 2 * DT_DELTA, 3, 0},
  {'c', F_WEEKDAY, DT_LONG - 2 * DT_DELTA, 4, 0}, {'c', F_WEEKDAY, DT_NARROW - 2 * DT_DELTA, 5, 0},
  {'c', F_WEEKDAY, DT_SHORTER - 2 * DT_DELTA, 6, 0},
  {'e', F_WEEKDAY, DT_NUMERIC + DT_DELTA, 1, 2}, {'e', F_WEEKDAY, DT_SHORT - DT_DELTA, 3, 0},
  {'e', F_WEEKDAY, DT_LONG - DT_DELTA, 4, 0}, {'e', F_WEEKDAY, DT_NARROW - DT_DELTA, 5, 0},
  {'e', F_WEEKDAY, DT_SHORTER - DT_DELTA, 6, 0},
  {'d', F_DAY, DT_NUMERIC, 1, 2}, {'g', F_DAY, DT_NUMERIC + DT_DELTA, 1, 20},
  {'D', F_DAY_OF_YEAR, DT_NUMERIC, 1, 3},
  {'F', F_DOW_IN_MONTH, DT_NUMERIC, 1, 0},
  {'a', F_DAYPERIOD, DT_SHORT, 1, 3}, {'a', F_DAYPERIOD, DT_LONG, 4, 0}, {'a', F_DAYPERIOD, DT_NARROW, 5, 0},
  {'b', F_DAYPERIOD, DT_SHORT - DT_DELTA, 1, 3}, {'b', F_DAYPERIOD, DT_LONG - DT_DELTA, 4, 0},
  {'b', F_DAYPERIOD, DT_NARROW - DT_DELTA, 5, 0},
  {'B', F_DAYPERIOD, DT_SHORT - 3 * DT_DELTA, 1, 3}, {'B', F_DAYPERIOD, DT_LONG - 3 * DT_DELTA, 4, 0},
  {'B', F_DAYPERIOD, DT_NARROW - 3 * DT_DELTA, 5, 0},
  {'H', F_HOUR, DT_NUMERIC + 10 * DT_DELTA, 1, 2}, {'k', F_HOUR, DT_NUMERIC + 11 * DT_DELTA, 1, 2},
  {'h', F_HOUR, DT_NUMERIC, 1, 2}, {'K', F_HOUR, DT_NUMERIC + DT_DELTA, 1, 2},
  {'J', F_HOUR, DT_NUMERIC + 5 * DT_DELTA, 1, 2}, {'j', F_HOUR, DT_NUMERIC + 6 * DT_DELTA, 1, 6},
  {'C', F_HOUR, DT_NUMERIC + 7 * DT_DELTA, 1, 6},
  {'m', F_MINUTE, DT_NUMERIC, 1, 2},
  {'s', F_SECOND, DT_NUMERIC, 1, 2}, {'A', F_SECOND, DT_NUMERIC + DT_DELTA, 1, 1000},
  {'S', F_FRACTIONAL, DT_NUMERIC, 1, 1000},
  {'v', F_ZONE, DT_SHORT - 2 * DT_DELTA, 1, 0}, {'v', F_ZONE, DT_LONG - 2 * DT_DELTA, 4, 0},
  {'z', F_ZONE, DT_SHORT, 1, 3}, {'z', F_ZONE, DT_LONG, 4, 0},
  {'Z', F_ZONE, DT_NARROW - DT_DELTA, 1, 3}, {'Z', F_ZONE, DT_LONG - DT_DELTA, 4, 0},
  {'Z', F_ZONE, DT_SHORT - DT_DELTA, 5, 0},
  {'O', F_ZONE, DT_SHORT - DT_DELTA, 1, 0}, {'O', F_ZONE, DT_LONG - DT_DELTA, 4, 0},
  {'V', F_ZONE, DT_SHORT - DT_DELTA, 1, 0}, {'V', F_ZONE, DT_LONG - DT_DELTA, 2, 0},
  {'V', F_ZONE, DT_LONG - 1 - DT_DELTA, 3, 0}, {'V', F_ZONE, DT_LONG - 2 - DT_DELTA, 4, 0},
  {'X', F_ZONE, DT_NARROW - DT_DELTA, 1, 0}, {'X', F_ZONE, DT_SHORT - DT_DELTA, 2, 0},
  {'X', F_ZONE, DT_LONG - DT_DELTA, 4, 0},
  {'x', F_ZONE, DT_NARROW - DT_DELTA, 1, 0}, {'x', F_ZONE, DT_SHORT - DT_DELTA, 2, 0},
  {'x', F_ZONE, DT_LONG - DT_DELTA, 4, 0},
  {0, F_COUNT, 0, 0, 0}};

static const char Canonical_Items[] = {'G', 'y', 'Q', 'M', 'w', 'W', 'E', 'D', 'F', 'd', 'a', 'H', 'm', 's', 'S', 'v', 0};
static const char *const CLDR_FIELD_APPEND[F_COUNT] = {"Era", "Year", "Quarter", "Month", "Week", "*", "Day-Of-Week", "*", "*", "Day", "*", "Hour", "Minute", "Second", "*", "Timezone"};
static const char *const CLDR_FIELD_NAME[F_COUNT] = {"era", "year", "quarter", "month", "week", "weekOfMonth", "weekday", "dayOfYear", "weekdayOfMonth", "day", "dayperiod", "hour", "minute", "second", "*", "zone"};
static const char *const CLDR_FIELD_WIDTH[3] = {"", "-short", "-narrow"};

/* ── skeleton ────────────────────────────────────────────────────────────────────────────────────────────── */
typedef struct { signed char chars[F_COUNT]; signed char lengths[F_COUNT]; } SkelFields;
typedef struct { int type[F_COUNT]; SkelFields original, baseOriginal; int addedDefaultDayPeriod; } PtnSkeleton;

static void sf_clear(SkelFields *f) { memset(f, 0, sizeof *f); }
static void sf_populate(SkelFields *f, int field, char ch, int len) { f->chars[field] = (signed char)ch; f->lengths[field] = (signed char)len; }
static int sf_empty(const SkelFields *f, int field) { return f->lengths[field] == 0; }
static void sf_clear_field(SkelFields *f, int field) { f->chars[field] = 0; f->lengths[field] = 0; }
static int sf_eq(const SkelFields *a, const SkelFields *b) { return memcmp(a, b, sizeof *a) == 0; }
static void sf_append_field(const SkelFields *f, int field, Sb *s) { for (int i = 0; i < f->lengths[field]; i++) sb_putc(s, f->chars[field]); }
static void sf_append(const SkelFields *f, Sb *s) { for (int i = 0; i < F_COUNT; i++) sf_append_field(f, i, s); }
static char sf_first_char(const SkelFields *f) { for (int i = 0; i < F_COUNT; i++) if (f->lengths[i] != 0) return f->chars[i]; return 0; }

static void skel_clear(PtnSkeleton *s) { memset(s, 0, sizeof *s); }
static char *skel_get(const PtnSkeleton *s, int base) {
  Sb r = {0};
  sf_append(base ? &s->baseOriginal : &s->original, &r);
  if (s->addedDefaultDayPeriod && r.p) {
    char *a = strchr(r.p, 'a');
    if (a) { memmove(a, a + 1, strlen(a)); r.n--; }
  }
  return sb_take(&r);
}

/* ── pattern map ─────────────────────────────────────────────────────────────────────────────────────────── */
typedef struct PtnElem {
  char *basePattern;
  PtnSkeleton skeleton;
  char *pattern;
  int skeletonWasSpecified;
  struct PtnElem *next;
} PtnElem;
typedef struct { PtnElem *boot[MAX_PATTERN_ENTRIES]; int isDupAllowed; } PatternMap;

static PtnElem *pm_header(const PatternMap *m, char c) {
  if (c >= 'A' && c <= 'Z') return m->boot[c - 'A'];
  if (c >= 'a' && c <= 'z') return m->boot[26 + c - 'a'];
  return NULL;
}
static void ptn_free(PtnElem *e) { while (e) { PtnElem *n = e->next; free(e->basePattern); free(e->pattern); free(e); e = n; } }

static PtnElem *pm_duplicate(const char *basePattern, const PtnSkeleton *skeleton, PtnElem *baseElem) {
  for (PtnElem *cur = baseElem; cur; cur = cur->next) {
    if (strcmp(basePattern, cur->basePattern) == 0) {
      int eq = 1;
      for (int i = 0; i < F_COUNT; i++) if (cur->skeleton.type[i] != skeleton->type[i]) { eq = 0; break; }
      if (eq) return cur;
    }
  }
  return NULL;
}
static int pm_add(PatternMap *m, const char *basePattern, const PtnSkeleton *skeleton, const char *value, int specified) {
  char bc = basePattern[0];
  PtnElem **slot;
  if (bc >= 'A' && bc <= 'Z') slot = &m->boot[bc - 'A'];
  else if (bc >= 'a' && bc <= 'z') slot = &m->boot[26 + bc - 'a'];
  else return 0;
  PtnElem *baseElem = *slot;
  if (!baseElem) {
    PtnElem *n = (PtnElem *)calloc(1, sizeof *n);
    n->basePattern = dups(basePattern);
    n->pattern = dups(value);
    n->skeleton = *skeleton;
    n->skeletonWasSpecified = specified;
    *slot = n;
    return 1;
  }
  PtnElem *cur = pm_duplicate(basePattern, skeleton, baseElem);
  if (!cur) {
    cur = baseElem;
    while (cur->next) cur = cur->next;
    PtnElem *n = (PtnElem *)calloc(1, sizeof *n);
    n->basePattern = dups(basePattern);
    n->pattern = dups(value);
    n->skeleton = *skeleton;
    n->skeletonWasSpecified = specified;
    cur->next = n;
  } else {
    if (!m->isDupAllowed) return 1;
    free(cur->pattern);
    cur->pattern = dups(value);
    cur->skeletonWasSpecified = specified;
  }
  return 1;
}
static const char *pm_from_base(const PatternMap *m, const char *basePattern, int *specified) {
  PtnElem *cur = pm_header(m, basePattern[0]);
  for (; cur; cur = cur->next)
    if (strcmp(basePattern, cur->basePattern) == 0) { *specified = cur->skeletonWasSpecified; return cur->pattern; }
  return NULL;
}
static const char *pm_from_skeleton(const PatternMap *m, const PtnSkeleton *skeleton, const PtnSkeleton **specifiedOut, int useOriginal) {
  if (specifiedOut) *specifiedOut = NULL;
  PtnElem *cur = pm_header(m, sf_first_char(&skeleton->baseOriginal));
  for (; cur; cur = cur->next) {
    int eq = useOriginal ? sf_eq(&cur->skeleton.original, &skeleton->original) : sf_eq(&cur->skeleton.baseOriginal, &skeleton->baseOriginal);
    if (eq) {
      if (specifiedOut && cur->skeletonWasSpecified) *specifiedOut = &cur->skeleton;
      return cur->pattern;
    }
  }
  return NULL;
}

/* ── the generator ───────────────────────────────────────────────────────────────────────────────────────── */
enum { AH_UNKNOWN = -1, AH_h, AH_H, AH_K, AH_k, AH_hb, AH_hB, AH_Kb, AH_KB, AH_Hb, AH_HB };

struct ScrDtpg {
  PatternMap map;
  char *dateTimeFormat[4];
  char *decimal;
  char *appendItemFormats[F_COUNT];
  char *fieldDisplayNames[F_COUNT][3];
  char **availKeys; int nAvail, capAvail;
  char defaultHourChar;
  int allowedHour[8];
  PtnSkeleton dtm; /* dtMatcher->skeleton */
  int missingFieldMask, extraFieldMask; /* distanceInfo */
};

/* ── FormatParser ────────────────────────────────────────────────────────────────────────────────────────── */
typedef struct { char *items[MAX_DT_TOKEN]; int itemNumber; } FormatParser;
static void fp_clear(FormatParser *fp) { for (int i = 0; i < fp->itemNumber; i++) free(fp->items[i]); fp->itemNumber = 0; }
static void fp_set(FormatParser *fp, const char *pat) {
  fp_clear(fp);
  size_t len = strlen(pat), start = 0;
  int units = 0; /* ICU counts UTF-16 code units: a non-ASCII character is one token (two when astral) */
  while (units < MAX_DT_TOKEN && start < len) {
    size_t cur = start;
    size_t tlen;
    int u = 1;
    for (;;) {
      unsigned char c = (unsigned char)pat[cur];
      if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')) cur++;
      else {
        start = cur;
        tlen = c >= 0xF0 ? 4 : c >= 0xE0 ? 3 : c >= 0xC0 ? 2 : 1;
        if (start + tlen > len) tlen = len - start;
        if (c >= 0xF0) u = 2;
        goto token;
      }
      if (cur >= len || pat[cur] != pat[start]) break;
    }
    tlen = cur - start;
  token:
    fp->items[fp->itemNumber++] = dupn(pat + start, tlen);
    units += u;
    start += tlen;
  }
}
static int fp_canonical_index(const char *s, int strict) {
  size_t len = strlen(s);
  if (len == 0) return -1;
  char ch = s[0];
  for (size_t l = 1; l < len; l++) if (ch != s[l]) return -1;
  int i = 0, bestRow = -1;
  while (dtTypes[i].ch != 0) {
    if (dtTypes[i].ch != ch) { ++i; continue; }
    bestRow = i;
    if (dtTypes[i].ch != dtTypes[i + 1].ch) return i;
    if (dtTypes[i + 1].minLen <= (int)len) { ++i; continue; }
    return i;
  }
  return strict ? -1 : bestRow;
}
static int fp_is_quote(const char *s) { return s[0] == '\''; }
/* appends the quote literal starting at items[*i] to q and leaves *i on its last item */
static void fp_get_quote(FormatParser *fp, Sb *q, int *itemIndex) {
  int i = *itemIndex;
  if (fp->items[i][0] == '\'') { sb_puts(q, fp->items[i]); ++i; }
  while (i < fp->itemNumber) {
    if (fp->items[i][0] == '\'') {
      if (i + 1 < fp->itemNumber && fp->items[i + 1][0] == '\'') { sb_puts(q, fp->items[i++]); sb_puts(q, fp->items[i++]); continue; }
      sb_puts(q, fp->items[i]);
      break;
    }
    sb_puts(q, fp->items[i]);
    ++i;
  }
  *itemIndex = i;
}
static int fp_is_separator(const FormatParser *fp, const char *field) {
  size_t n = strlen(field);
  for (size_t i = 0; i < n; i++) {
    char c = field[i];
    if (c == '\'' || c == '\\' || c == ' ' || c == ':' || c == '"' || c == ',' || c == '-' || (i < (size_t)fp->itemNumber && fp->items[i][0] == '.')) continue;
    return 0;
  }
  return 1;
}

/* ── DateTimeMatcher::set ────────────────────────────────────────────────────────────────────────────────── */
static void dtm_set(const char *pattern, FormatParser *fp, PtnSkeleton *res) {
  for (int i = 0; i < F_COUNT; i++) res->type[i] = NONE;
  sf_clear(&res->original);
  sf_clear(&res->baseOriginal);
  res->addedDefaultDayPeriod = 0;
  fp_set(fp, pattern);
  for (int i = 0; i < fp->itemNumber; i++) {
    const char *value = fp->items[i];
    if (fp_is_quote(value)) { Sb q = {0}; fp_get_quote(fp, &q, &i); sb_free(&q); continue; }
    int ci = fp_canonical_index(value, 1);
    if (ci < 0) continue;
    const DtTypeElem *row = &dtTypes[ci];
    int field = row->field;
    sf_populate(&res->original, field, value[0], (int)strlen(value));
    sf_populate(&res->baseOriginal, field, row->ch, row->minLen);
    int subField = row->type;
    if (row->type > 0) subField += (int)strlen(value);
    res->type[field] = subField;
  }
  if (!sf_empty(&res->original, F_MINUTE) && !sf_empty(&res->original, F_FRACTIONAL) && sf_empty(&res->original, F_SECOND)) {
    for (int i = 0; dtTypes[i].ch != 0; i++) {
      if (dtTypes[i].field == F_SECOND) {
        sf_populate(&res->original, F_SECOND, dtTypes[i].ch, dtTypes[i].minLen);
        sf_populate(&res->baseOriginal, F_SECOND, dtTypes[i].ch, dtTypes[i].minLen);
        int sub = dtTypes[i].type;
        res->type[F_SECOND] = sub > 0 ? sub + 1 : sub;
        break;
      }
    }
  }
  if (!sf_empty(&res->original, F_HOUR)) {
    char hc = res->original.chars[F_HOUR];
    if (hc == 'h' || hc == 'K') {
      if (sf_empty(&res->original, F_DAYPERIOD)) {
        for (int i = 0; dtTypes[i].ch != 0; i++) {
          if (dtTypes[i].field == F_DAYPERIOD) {
            sf_populate(&res->original, F_DAYPERIOD, dtTypes[i].ch, dtTypes[i].minLen);
            sf_populate(&res->baseOriginal, F_DAYPERIOD, dtTypes[i].ch, dtTypes[i].minLen);
            res->type[F_DAYPERIOD] = dtTypes[i].type;
            res->addedDefaultDayPeriod = 1;
            break;
          }
        }
      }
    } else {
      sf_clear_field(&res->original, F_DAYPERIOD);
      sf_clear_field(&res->baseOriginal, F_DAYPERIOD);
      res->type[F_DAYPERIOD] = NONE;
    }
  }
}

static int dtm_distance(const PtnSkeleton *mine, const PtnSkeleton *other, int includeMask, int *missing, int *extra) {
  int result = 0;
  *missing = *extra = 0;
  for (int i = 0; i < F_COUNT; i++) {
    int myType = (includeMask & (1 << i)) == 0 ? 0 : mine->type[i];
    int otherType = other->type[i];
    if (myType == otherType) continue;
    if (myType == 0) { result += EXTRA_FIELD; *extra |= 1 << i; }
    else if (otherType == 0) { result += MISSING_FIELD; *missing |= 1 << i; }
    else result += abs(myType - otherType);
  }
  return result;
}
static int dtm_field_mask(const PtnSkeleton *s) { int r = 0; for (int i = 0; i < F_COUNT; i++) if (s->type[i] != 0) r |= 1 << i; return r; }

/* ── resource helpers ────────────────────────────────────────────────────────────────────────────────────── */
static int res_str_dup(ScrRes r, char **out) {
  size_t n;
  const char *s = scr_res_str(r, &n);
  if (!s) return 0;
  *out = dupn(s, n);
  return 1;
}

/* ── generator setup ─────────────────────────────────────────────────────────────────────────────────────── */
static int g_avail_has(const ScrDtpg *g, const char *k) { for (int i = 0; i < g->nAvail; i++) if (strcmp(g->availKeys[i], k) == 0) return 1; return 0; }
static void g_avail_set(ScrDtpg *g, const char *k) {
  if (g->nAvail == g->capAvail) { g->capAvail = g->capAvail ? g->capAvail * 2 : 64; g->availKeys = (char **)realloc(g->availKeys, sizeof(char *) * (size_t)g->capAvail); }
  g->availKeys[g->nAvail++] = dups(k);
}

/* PatternMap duplicates and conflicts: addPatternWithOptionalSkeleton */
static void g_add_pattern(ScrDtpg *g, FormatParser *fp, const char *pattern, const char *skeletonToUse, int override) {
  PtnSkeleton skeleton;
  skel_clear(&skeleton);
  dtm_set(skeletonToUse ? skeletonToUse : pattern, fp, &skeleton);
  Sb base = {0};
  sf_append(&skeleton.baseOriginal, &base);
  const char *basePattern = base.p ? base.p : "";
  int entryHadSpecified = 0;
  const char *dup = pm_from_base(&g->map, basePattern, &entryHadSpecified);
  if (dup && (!entryHadSpecified || (skeletonToUse && !override))) {
    if (!override) { sb_free(&base); return; }
  }
  const PtnSkeleton *entrySpecified = NULL;
  dup = pm_from_skeleton(&g->map, &skeleton, &entrySpecified, 1);
  if (dup) {
    if (!override || (skeletonToUse && entrySpecified)) { sb_free(&base); return; }
  }
  pm_add(&g->map, basePattern, &skeleton, pattern, skeletonToUse != NULL);
  sb_free(&base);
}

static void g_add_canonical(ScrDtpg *g, FormatParser *fp) {
  for (int i = 0; i < F_COUNT; i++) {
    if (Canonical_Items[i] > 0) { char p[2] = {Canonical_Items[i], 0}; g_add_pattern(g, fp, p, NULL, 0); }
  }
}

/* ures_getFunctionalEquivalent("calendar", "calendar", locale): the calendar keyword value the locale resolves to,
 * with ICU's quirks (a default is only read from a bundle that holds the `calendar` table itself; the next locale
 * comes from the %%Parent the opened bundle inherits, else the truncated name). Returns 0 when the lookup fails. */
static void fe_parent(const char *found, int resIdx, char *out, size_t cap) {
  ScrRes r;
  out[0] = 0;
  if (resIdx >= 0 && scr_ures_bundle_get(resIdx, "%%Parent", &r)) {
    size_t n; const char *s = scr_res_str(r, &n);
    if (s && n < cap) { memcpy(out, s, n); out[n] = 0; }
  }
  if (!out[0]) {
    snprintf(out, cap, "%s", found);
    char *u = strrchr(out, '_');
    if (u && u > out) *u = 0; else out[0] = 0;
  }
}
static int own_default(int idx, char *out, size_t cap) {
  ScrRes r;
  if (!scr_ures_bundle_own(idx, "calendar/default", &r)) return 0;
  size_t n; const char *s = scr_res_str(r, &n);
  if (!s || !n || n >= cap) return 0;
  memcpy(out, s, n); out[n] = 0;
  return 1;
}
static int func_equiv_calendar(const DtLoc *loc, char *out, size_t cap) {
  char kwVal[48] = "", defVal[48] = "", defLoc[96] = "", found[96], parent[96], full[96] = "";
  if (loc->calendar[0]) snprintf(kwVal, sizeof kwVal, "%s", loc->calendar);
  const char *base = loc->base;
  snprintf(parent, sizeof parent, "%s", base);
  snprintf(found, sizeof found, "%s", base);
  do {
    int res = scr_ures_bundle_open(parent);
    int exact = parent[0] ? scr_ures_bundle_exact(parent) >= 0 : 1; /* "" is the root bundle, which opens exactly */
    ScrRes tmp;
    if (exact && scr_ures_bundle_own(res, "calendar", &tmp)) {
      char d[48];
      if (own_default(res, d, sizeof d)) {
        snprintf(defVal, sizeof defVal, "%s", d);
        snprintf(defLoc, sizeof defLoc, "%s", parent);
        if (!kwVal[0]) snprintf(kwVal, sizeof kwVal, "%s", defVal);
      }
    }
    snprintf(found, sizeof found, "%s", scr_ures_bundle_name(res));
    if (strcmp(found, parent) != 0) snprintf(parent, sizeof parent, "%s", found);
    else fe_parent(found, res, parent, sizeof parent);
  } while (!defVal[0] && found[0] && strcmp(found, "root") != 0);
  /* now look for the keyword's own table */
  for (int pass = 0; pass < 2; pass++) {
    snprintf(parent, sizeof parent, "%s", base);
    snprintf(found, sizeof found, "%s", base);
    do {
      int res = scr_ures_bundle_open(parent);
      int exact = parent[0] ? scr_ures_bundle_exact(parent) >= 0 : 1; /* "" is the root bundle, which opens exactly */
      if (exact) {
        char path[96];
        ScrRes tmp;
        snprintf(path, sizeof path, "calendar/%s", kwVal);
        if (scr_ures_bundle_own(res, "calendar", &tmp) && scr_ures_bundle_own(res, path, &tmp)) {
          snprintf(full, sizeof full, "%s", parent[0] ? parent : "root");
          if (strlen(defLoc) > strlen(full)) {
            char d[48];
            if (own_default(res, d, sizeof d)) { snprintf(defVal, sizeof defVal, "%s", d); snprintf(defLoc, sizeof defLoc, "%s", full); }
          }
        }
      }
      snprintf(found, sizeof found, "%s", parent);
      fe_parent(found, res, parent, sizeof parent);
    } while (!full[0] && found[0]);
    if (full[0] || !strcmp(kwVal, defVal)) break;
    snprintf(kwVal, sizeof kwVal, "%s", defVal);
  }
  if (!full[0]) return 0;
  snprintf(out, cap, "%s", kwVal);
  return 1;
}

/* getCalendarTypeToUse */
static void g_calendar_type(const DtLoc *loc, char *out, size_t cap) {
  snprintf(out, cap, "gregorian");
  char kw[48];
  if (func_equiv_calendar(loc, kw, sizeof kw) && kw[0]) snprintf(out, cap, "%s", kw);
}

static void g_add_icu_patterns(ScrDtpg *g, FormatParser *fp, const DtLoc *loc, const char *calType) {
  char path[128];
  snprintf(path, sizeof path, "calendar/%s/DateTimePatterns", calType);
  ScrRes arr;
  if (!scr_ures_get(&loc->uloc, SCR_URES_LOC, path, &arr) || scr_res_kind(arr) != SCR_RES_ARRAY || scr_res_array_len(arr) < 8) return;
  for (int i = 0; i < 8; i++) { /* kDateTime == 8 */
    ScrRes p = scr_res_array_at(arr, i);
    char *pat = NULL;
    if (scr_res_kind(p) == SCR_RES_STR) res_str_dup(p, &pat);
    else if (scr_res_kind(p) == SCR_RES_ARRAY) res_str_dup(scr_res_array_at(p, 0), &pat);
    if (pat) { g_add_pattern(g, fp, pat, NULL, 0); free(pat); }
  }
}

typedef struct { ScrDtpg *g; FormatParser *fp; int mode; } SinkCtx;

static int append_field_number(const char *key) { for (int i = 0; i < F_COUNT; i++) if (strcmp(CLDR_FIELD_APPEND[i], key) == 0) return i; return F_COUNT; }
static int field_and_width(const char *key, int *width) {
  char k[32];
  snprintf(k, sizeof k, "%s", key);
  *width = 0;
  char *h = strchr(k, '-');
  if (h) {
    for (int i = 2; i > 0; --i) if (strcmp(CLDR_FIELD_WIDTH[i], h) == 0) { *width = i; break; }
    *h = 0;
  }
  for (int i = 0; i < F_COUNT; i++) if (strcmp(CLDR_FIELD_NAME[i], k) == 0) return i;
  return F_COUNT;
}

static void sink_append_formats(void *ctx, const char *key, size_t kn, ScrRes v) {
  SinkCtx *c = (SinkCtx *)ctx;
  char k[64];
  if (kn >= sizeof k) return;
  memcpy(k, key, kn); k[kn] = 0;
  int field = append_field_number(k);
  if (field == F_COUNT) return;
  size_t n;
  const char *s = scr_res_str(v, &n);
  if (!s) return;
  if (!c->g->appendItemFormats[field] && n > 0) c->g->appendItemFormats[field] = dupn(s, n);
}
static void sink_field_names(void *ctx, const char *key, size_t kn, ScrRes v) {
  SinkCtx *c = (SinkCtx *)ctx;
  char k[64];
  if (kn >= sizeof k) return;
  memcpy(k, key, kn); k[kn] = 0;
  int width;
  int field = field_and_width(k, &width);
  if (field == F_COUNT) return;
  if (scr_res_kind(v) != SCR_RES_TABLE) return;
  /* findValue("dn") */
  for (int i = 0; i < scr_res_table_len(v); i++) {
    const char *tk; size_t tn;
    ScrRes dv = scr_res_table_at(v, i, &tk, &tn);
    if (tn == 2 && memcmp(tk, "dn", 2) == 0) {
      size_t n;
      const char *s = scr_res_str(dv, &n);
      if (s && !c->g->fieldDisplayNames[field][width] && n > 0) c->g->fieldDisplayNames[field][width] = dupn(s, n);
      return;
    }
  }
}
static void sink_available(void *ctx, const char *key, size_t kn, ScrRes v) {
  SinkCtx *c = (SinkCtx *)ctx;
  char k[64];
  if (kn >= sizeof k) return;
  memcpy(k, key, kn); k[kn] = 0;
  if (g_avail_has(c->g, k)) return;
  g_avail_set(c->g, k);
  size_t n;
  const char *s = scr_res_str(v, &n);
  if (!s) return;
  char *val = dupn(s, n);
  g_add_pattern(c->g, c->fp, val, k, 1);
  free(val);
}

static void g_add_cldr_data(ScrDtpg *g, FormatParser *fp, const DtLoc *loc, const char *calType) {
  SinkCtx ctx = {g, fp, 0};
  char path[128];
  snprintf(path, sizeof path, "calendar/%s/appendItems", calType);
  scr_ures_all_items(&loc->uloc, SCR_URES_LOC, path, sink_append_formats, &ctx);
  for (int i = 0; i < F_COUNT; i++) if (!g->appendItemFormats[i]) g->appendItemFormats[i] = dups("{0} \xE2\x94\x9C{2}: {1}\xE2\x94\xA4");
  scr_ures_all_items(&loc->uloc, SCR_URES_LOC, "fields", sink_field_names, &ctx);
  for (int i = 0; i < F_COUNT; i++) {
    if (!g->fieldDisplayNames[i][0]) {
      char b[8];
      if (i < 10) snprintf(b, sizeof b, "F%d", i); else snprintf(b, sizeof b, "F1%d", i - 10);
      g->fieldDisplayNames[i][0] = dups(b);
    }
    for (int j = 1; j < 3; j++) if (!g->fieldDisplayNames[i][j]) g->fieldDisplayNames[i][j] = dups(g->fieldDisplayNames[i][j - 1]);
  }
  snprintf(path, sizeof path, "calendar/%s/availableFormats", calType);
  scr_ures_all_items(&loc->uloc, SCR_URES_LOC, path, sink_available, &ctx);
}

/* Calendar::getCalendarTypeFromLocale: the type of the calendar ICU creates for the locale */
static void g_date_time_formats(ScrDtpg *g, const DtLoc *loc) {
  char cType[40];
  scr_dtloc_calendar_type(loc, cType, sizeof cType);
  int cIsGreg = strcmp(cType, "gregorian") == 0;
  ScrRes pats = {NULL, 0};
  int offset = 0, have = 0;
  char path[128];
  if (!cIsGreg) {
    snprintf(path, sizeof path, "calendar/%s/DateTimePatterns%%atTime", cType);
    have = scr_ures_get(&loc->uloc, SCR_URES_LOC, path, &pats);
  }
  if (!have) {
    have = scr_ures_get(&loc->uloc, SCR_URES_LOC, "calendar/gregorian/DateTimePatterns%atTime", &pats);
  }
  if (have && scr_res_array_len(pats) < 4) have = 0;
  if (!have) {
    offset = 9; /* kDateTimeOffset */
    if (!cIsGreg) {
      snprintf(path, sizeof path, "calendar/%s/DateTimePatterns", cType);
      have = scr_ures_get(&loc->uloc, SCR_URES_LOC, path, &pats);
    }
    if (!have) have = scr_ures_get(&loc->uloc, SCR_URES_LOC, "calendar/gregorian/DateTimePatterns", &pats);
  }
  if (!have) return;
  for (int style = 0; style < 4; style++) {
    char *s = NULL;
    ScrRes e = scr_res_array_at(pats, offset + style);
    if (res_str_dup(e, &s)) g->dateTimeFormat[style] = s;
  }
}

static const char *lookup_hour_formats(const char *lang, const char *country, ScrRes *out) {
  char path[64];
  snprintf(path, sizeof path, "timeData/%s_%s", lang, country);
  if (scr_ures_misc("supplementalData", path, out)) return "ok";
  snprintf(path, sizeof path, "timeData/%s", country);
  if (scr_ures_misc("supplementalData", path, out)) return "ok";
  return NULL;
}
static int hour_format_of(const char *s, size_t n) {
  if (n == 1) { if (s[0] == 'h') return AH_h; if (s[0] == 'H') return AH_H; if (s[0] == 'K') return AH_K; if (s[0] == 'k') return AH_k; }
  else if (n == 2) {
    if (s[0] == 'h' && s[1] == 'b') return AH_hb; if (s[0] == 'h' && s[1] == 'B') return AH_hB;
    if (s[0] == 'K' && s[1] == 'b') return AH_Kb; if (s[0] == 'K' && s[1] == 'B') return AH_KB;
    if (s[0] == 'H' && s[1] == 'b') return AH_Hb; if (s[0] == 'H' && s[1] == 'B') return AH_HB;
  }
  return AH_UNKNOWN;
}

static void g_allowed_hour_formats(ScrDtpg *g, const DtLoc *loc) {
  char language[12], country[8];
  snprintf(language, sizeof language, "%s", loc->lang);
  snprintf(country, sizeof country, "%s", loc->region);
  if (!language[0] || !country[0]) {
    char L[12], S[8], R[8];
    if (scr_dt_add_likely(loc->lang, loc->script, loc->region, L, S, R)) {
      snprintf(language, sizeof language, "%s", L);
      snprintf(country, sizeof country, "%s", R);
    }
  }
  if (!language[0]) snprintf(language, sizeof language, "und");
  if (!country[0]) snprintf(country, sizeof country, "001");
  ScrRes tbl = {NULL, 0};
  int found = lookup_hour_formats(language, country, &tbl) != NULL;
  g->defaultHourChar = 0;
  if (loc->hours[0]) {
    if (!strcmp(loc->hours, "h24")) g->defaultHourChar = 'k';
    else if (!strcmp(loc->hours, "h23")) g->defaultHourChar = 'H';
    else if (!strcmp(loc->hours, "h12")) g->defaultHourChar = 'h';
    else if (!strcmp(loc->hours, "h11")) g->defaultHourChar = 'K';
  }
  if (!found) {
    /* Region::getInstance(country): a deprecated region's replacement */
    char key[32];
    snprintf(key, sizeof key, "territoryAlias/%s", country);
    ScrCoreVal v = scr_core_get(key);
    if (v.p) {
      char rep[8];
      size_t n = v.n < 7 ? v.n : 7;
      memcpy(rep, v.p, n); rep[n] = 0;
      char *sp = strchr(rep, ' '); if (sp) *sp = 0;
      found = lookup_hour_formats(language, rep, &tbl) != NULL;
    }
  }
  if (found) {
    int list[8], len = 0, preferred = AH_UNKNOWN;
    ScrRes al = {NULL, 0}, pr = {NULL, 0};
    for (int j = 0; j < scr_res_table_len(tbl); j++) {
      const char *k; size_t kn;
      ScrRes v = scr_res_table_at(tbl, j, &k, &kn);
      if (kn == 7 && !memcmp(k, "allowed", 7)) al = v;
      else if (kn == 9 && !memcmp(k, "preferred", 9)) pr = v;
    }
    if (al.p) {
      if (scr_res_kind(al) == SCR_RES_STR) { size_t n; const char *s = scr_res_str(al, &n); list[1] = hour_format_of(s, n); len = 2; }
      else { int an = scr_res_array_len(al); len = an + 1; if (len > 7) len = 7; for (int k = 1; k < len; k++) { size_t n; const char *s = scr_res_str(scr_res_array_at(al, k - 1), &n); list[k] = s ? hour_format_of(s, n) : AH_UNKNOWN; } }
    }
    if (pr.p) { size_t n; const char *s = scr_res_str(pr, &n); if (s) preferred = hour_format_of(s, n); }
    if (len > 1) list[0] = preferred != AH_UNKNOWN ? preferred : list[1];
    else { len = 2; list[0] = preferred != AH_UNKNOWN ? preferred : AH_H; list[1] = list[0]; }
    list[len] = AH_UNKNOWN;
    if (!g->defaultHourChar) {
      switch (list[0]) {
        case AH_h: g->defaultHourChar = 'h'; break;
        case AH_H: g->defaultHourChar = 'H'; break;
        case AH_K: g->defaultHourChar = 'K'; break;
        case AH_k: g->defaultHourChar = 'k'; break;
        default: g->defaultHourChar = 'H'; break;
      }
    }
    for (int i = 0; i < 8; ++i) {
      g->allowedHour[i] = i + 1 <= len ? list[i + 1] : AH_UNKNOWN;
      if (g->allowedHour[i] == AH_UNKNOWN) break;
    }
  } else {
    if (!g->defaultHourChar) g->defaultHourChar = 'H';
    g->allowedHour[0] = AH_H;
    g->allowedHour[1] = AH_UNKNOWN;
  }
}

static char *decimal_symbol(const DtLoc *loc) {
  char ns[24] = "";
  if (loc->numbering[0]) snprintf(ns, sizeof ns, "%s", loc->numbering);
  else scr_res_get_str(&loc->uloc, SCR_URES_LOC, "NumberElements/default", ns, sizeof ns);
  if (!ns[0]) snprintf(ns, sizeof ns, "latn");
  char path[96];
  char buf[32];
  snprintf(path, sizeof path, "NumberElements/%s/symbols/decimal", ns);
  if (!scr_res_get_str(&loc->uloc, SCR_URES_LOC, path, buf, sizeof buf)) {
    if (!scr_res_get_str(&loc->uloc, SCR_URES_LOC, "NumberElements/latn/symbols/decimal", buf, sizeof buf)) snprintf(buf, sizeof buf, ".");
  }
  return dups(buf);
}

ScrDtpg *scr_dtpg_new(const DtLoc *loc, int skipStd) {
  ScrDtpg *g = (ScrDtpg *)calloc(1, sizeof *g);
  g->map.isDupAllowed = 1;
  FormatParser fp = {0};
  char calType[40];
  g_add_canonical(g, &fp);
  g_calendar_type(loc, calType, sizeof calType);
  if (!skipStd) {
    char ct[40];
    snprintf(ct, sizeof ct, "%s", calType);
    g_add_icu_patterns(g, &fp, loc, ct);
  }
  g_add_cldr_data(g, &fp, loc, calType);
  g_date_time_formats(g, loc);
  g->decimal = decimal_symbol(loc);
  g_allowed_hour_formats(g, loc);
  fp_clear(&fp);
  return g;
}

void scr_dtpg_free(ScrDtpg *g) {
  if (!g) return;
  for (int i = 0; i < MAX_PATTERN_ENTRIES; i++) ptn_free(g->map.boot[i]);
  for (int i = 0; i < 4; i++) free(g->dateTimeFormat[i]);
  free(g->decimal);
  for (int i = 0; i < F_COUNT; i++) { free(g->appendItemFormats[i]); for (int j = 0; j < 3; j++) free(g->fieldDisplayNames[i][j]); }
  for (int i = 0; i < g->nAvail; i++) free(g->availKeys[i]);
  free(g->availKeys);
  free(g);
}

int scr_dtpg_default_hour_cycle(const ScrDtpg *g) {
  switch (g->defaultHourChar) { case 'K': return 11; case 'h': return 12; case 'H': return 23; case 'k': return 24; }
  return 23;
}

/* ── best pattern ────────────────────────────────────────────────────────────────────────────────────────── */
static const char *g_best_raw(ScrDtpg *g, const PtnSkeleton *source, int includeMask, int *missingOut, int *extraOut, const PtnSkeleton **specifiedOut) {
  int bestDistance = 0x7fffffff, bestMissing = -1;
  const char *bestPattern = NULL;
  const PtnSkeleton *specified = NULL;
  for (int bi = 0; bi < MAX_PATTERN_ENTRIES; bi++) {
    for (PtnElem *e = g->map.boot[bi]; e; e = e->next) {
      int miss, extra;
      int distance = dtm_distance(source, &e->skeleton, includeMask, &miss, &extra);
      if (distance < bestDistance || (distance == bestDistance && bestMissing < miss)) {
        bestDistance = distance;
        bestMissing = miss;
        bestPattern = pm_from_skeleton(&g->map, &e->skeleton, &specified, 1);
        *missingOut = miss;
        *extraOut = extra;
        if (distance == 0) goto done;
      }
    }
  }
done:
  if (bestPattern && specifiedOut) *specifiedOut = specified;
  return bestPattern;
}

static char *g_adjust_field_types(ScrDtpg *g, const char *pattern, const PtnSkeleton *specifiedSkeleton, int flags, int options, FormatParser *fp) {
  Sb newPattern = {0};
  fp_set(fp, pattern);
  for (int i = 0; i < fp->itemNumber; i++) {
    const char *fieldIn = fp->items[i];
    if (fp_is_quote(fieldIn)) { Sb q = {0}; fp_get_quote(fp, &q, &i); sb_puts(&newPattern, q.p ? q.p : ""); sb_free(&q); continue; }
    if (fp_is_separator(fp, fieldIn)) { sb_puts(&newPattern, fieldIn); continue; }
    int ci = fp_canonical_index(fieldIn, 1);
    if (ci < 0) { sb_puts(&newPattern, fieldIn); continue; }
    const DtTypeElem *row = &dtTypes[ci];
    int typeValue = row->field;
    Sb field = {0};
    sb_puts(&field, fieldIn);
    if ((flags & FLAG_FIX_FRACTIONAL) != 0 && typeValue == F_SECOND) {
      sb_puts(&field, g->decimal);
      sf_append_field(&g->dtm.original, F_FRACTIONAL, &field);
    } else if (g->dtm.type[typeValue] != 0) {
      char reqFieldChar = g->dtm.original.chars[typeValue];
      int reqFieldLen = g->dtm.original.lengths[typeValue];
      if (reqFieldChar == 'E' && reqFieldLen < 3) reqFieldLen = 3;
      int adjFieldLen = reqFieldLen;
      if ((typeValue == F_HOUR && (options & DTPG_MATCH_HOUR) == 0) || (typeValue == F_MINUTE && (options & DTPG_MATCH_MINUTE) == 0) ||
          (typeValue == F_SECOND && (options & DTPG_MATCH_SECOND) == 0)) {
        adjFieldLen = (int)field.n;
      } else if (specifiedSkeleton && reqFieldChar != 'c' && reqFieldChar != 'e') {
        int skelFieldLen = specifiedSkeleton->original.lengths[typeValue];
        int patFieldIsNumeric = row->type > 0;
        int reqFieldIsNumeric = g->dtm.type[typeValue] > 0;
        if (skelFieldLen == reqFieldLen || (patFieldIsNumeric && !reqFieldIsNumeric) || (reqFieldIsNumeric && !patFieldIsNumeric)) adjFieldLen = (int)field.n;
      }
      char c = (typeValue != F_HOUR && typeValue != F_MONTH && typeValue != F_WEEKDAY && (typeValue != F_YEAR || reqFieldChar == 'Y')) ? reqFieldChar : field.p[0];
      if (c == 'E' && adjFieldLen < 3) c = 'e';
      if (typeValue == F_HOUR && g->defaultHourChar != 0) {
        char d = g->defaultHourChar;
        if ((flags & FLAG_CAP_J) != 0 || reqFieldChar == d) c = d;
        else if (reqFieldChar == 'h' && d == 'K') c = 'K';
        else if (reqFieldChar == 'H' && d == 'k') c = 'k';
        else if (reqFieldChar == 'k' && d == 'H') c = 'H';
        else if (reqFieldChar == 'K' && d == 'h') c = 'h';
      }
      field.n = 0;
      field.p[0] = 0;
      for (int j = adjFieldLen; j > 0; --j) sb_putc(&field, c);
    }
    sb_puts(&newPattern, field.p ? field.p : "");
    sb_free(&field);
  }
  return sb_take(&newPattern);
}

static int top_bit_number(int mask) {
  if (mask == 0) return 0;
  int i = 0;
  while (mask != 0) { mask >>= 1; ++i; }
  if (i - 1 > F_ZONE) return F_ZONE;
  return i - 1;
}

/* SimpleFormatter with {0} {1} {2} placeholders */
static char *simple_format(const char *pat, const char *a0, const char *a1, const char *a2) {
  Sb r = {0};
  const char *p = pat;
  int inQuote = 0;
  while (*p) {
    if (*p == '\'') {
      if (p[1] == '\'') { sb_putc(&r, '\''); p += 2; continue; }
      /* quotes in SimpleFormatter: a quote starts a quoted section only before '{' ... keep ICU's ApostropheMode DOUBLE_OPTIONAL */
      if (p[1] == '{') { const char *q = strchr(p + 2, '\''); if (q) { sb_put(&r, p + 1, (size_t)(q - p - 1)); p = q + 1; continue; } }
      sb_putc(&r, '\''); p++; (void)inQuote; continue;
    }
    if (*p == '{' && p[1] >= '0' && p[1] <= '9' && p[2] == '}') {
      const char *v = p[1] == '0' ? a0 : p[1] == '1' ? a1 : a2;
      if (v) sb_puts(&r, v);
      p += 3;
      continue;
    }
    sb_putc(&r, *p++);
  }
  return sb_take(&r);
}

static char *g_best_appending(ScrDtpg *g, int missingFields, int flags, int options, FormatParser *fp) {
  Sb result = {0};
  int lastMissing = 0;
  if (missingFields != 0) {
    const PtnSkeleton *specified = NULL;
    int miss = 0, extra = 0;
    const char *tmp = g_best_raw(g, &g->dtm, missingFields, &miss, &extra, &specified);
    g->missingFieldMask = miss; g->extraFieldMask = extra;
    char *res = g_adjust_field_types(g, tmp, specified, flags, options, fp);
    if (g->missingFieldMask == 0) { sb_free(&result); return res; }
    sb_puts(&result, res);
    free(res);
    while (g->missingFieldMask != 0) {
      if (lastMissing == g->missingFieldMask) break;
      if (((g->missingFieldMask & SECOND_AND_FRACTIONAL_MASK) == FRACTIONAL_MASK) && ((missingFields & SECOND_AND_FRACTIONAL_MASK) == SECOND_AND_FRACTIONAL_MASK)) {
        char *r2 = g_adjust_field_types(g, result.p, specified, flags | FLAG_FIX_FRACTIONAL, options, fp);
        sb_free(&result);
        sb_puts(&result, r2);
        free(r2);
        g->missingFieldMask &= ~FRACTIONAL_MASK;
        continue;
      }
      int startingMask = g->missingFieldMask;
      tmp = g_best_raw(g, &g->dtm, g->missingFieldMask, &miss, &extra, &specified);
      g->missingFieldMask = miss; g->extraFieldMask = extra;
      char *tp = g_adjust_field_types(g, tmp, specified, flags, options, fp);
      int foundMask = startingMask & ~g->missingFieldMask;
      int topField = top_bit_number(foundMask);
      if (g->appendItemFormats[topField] && g->appendItemFormats[topField][0]) {
        Sb an = {0};
        sb_putc(&an, '\'');
        sb_puts(&an, g->fieldDisplayNames[topField][0]);
        sb_putc(&an, '\'');
        char *f = simple_format(g->appendItemFormats[topField], result.p, tp, an.p);
        sb_free(&an);
        sb_free(&result);
        sb_puts(&result, f);
        free(f);
      }
      free(tp);
      lastMissing = g->missingFieldMask;
    }
  }
  return sb_take(&result);
}

static char *g_map_metachars(ScrDtpg *g, const char *form, int *flags) {
  Sb out = {0};
  int inQuoted = 0;
  size_t len = strlen(form);
  for (size_t pos = 0; pos < len; pos++) {
    char c = form[pos];
    if (c == '\'') inQuoted = !inQuoted;
    else if (!inQuoted) {
      if (c == 'j' || c == 'C') {
        int extra = 0;
        while (pos + 1 < len && form[pos + 1] == c) { extra++; pos++; }
        int hourLen = 1 + (extra & 1);
        int dayPeriodLen = extra < 2 ? 1 : 3 + (extra >> 1);
        char hourChar = 'h', dayPeriodChar = 'a';
        if (c == 'j') hourChar = g->defaultHourChar;
        else {
          int best = g->allowedHour[0];
          if (best == AH_UNKNOWN) { sb_free(&out); return NULL; }
          if (best == AH_H || best == AH_HB || best == AH_Hb) hourChar = 'H';
          else if (best == AH_K || best == AH_KB || best == AH_Kb) hourChar = 'K';
          else if (best == AH_k) hourChar = 'k';
          if (best == AH_HB || best == AH_hB || best == AH_KB) dayPeriodChar = 'B';
          else if (best == AH_Hb || best == AH_hb || best == AH_Kb) dayPeriodChar = 'b';
        }
        if (hourChar == 'H' || hourChar == 'k') dayPeriodLen = 0;
        while (dayPeriodLen-- > 0) sb_putc(&out, dayPeriodChar);
        while (hourLen-- > 0) sb_putc(&out, hourChar);
      } else if (c == 'J') {
        sb_putc(&out, 'H');
        *flags |= FLAG_CAP_J;
      } else sb_putc(&out, c);
    }
  }
  return sb_take(&out);
}

char *scr_dtpg_best(ScrDtpg *g, const char *patternForm, int options) {
  FormatParser fp = {0};
  int flags = FLAG_NONE;
  int dateMask = (1 << F_DAYPERIOD) - 1;
  int timeMask = (1 << F_COUNT) - 1 - dateMask;
  char *mapped = g_map_metachars(g, patternForm, &flags);
  if (!mapped) return NULL;
  dtm_set(mapped, &fp, &g->dtm);
  free(mapped);
  const PtnSkeleton *specified = NULL;
  int miss = 0, extra = 0;
  const char *best = g_best_raw(g, &g->dtm, -1, &miss, &extra, &specified);
  g->missingFieldMask = miss; g->extraFieldMask = extra;
  if (!best) { fp_clear(&fp); return NULL; }
  if (miss == 0 && extra == 0) {
    char *r = g_adjust_field_types(g, best, specified, flags, options, &fp);
    fp_clear(&fp);
    return r;
  }
  int needed = dtm_field_mask(&g->dtm);
  char *datePattern = g_best_appending(g, needed & dateMask, flags, options, &fp);
  char *timePattern = g_best_appending(g, needed & timeMask, flags, options, &fp);
  char *result;
  if (datePattern[0] == 0) {
    free(datePattern);
    fp_clear(&fp);
    return timePattern; /* empty when both are */
  }
  if (timePattern[0] == 0) { free(timePattern); fp_clear(&fp); return datePattern; }
  int style = 3; /* UDAT_SHORT */
  int monthLen = g->dtm.baseOriginal.lengths[F_MONTH];
  if (monthLen == 4) style = g->dtm.baseOriginal.lengths[F_WEEKDAY] > 0 ? 0 : 1;
  else if (monthLen == 3) style = 2;
  const char *dtf = g->dateTimeFormat[style] ? g->dateTimeFormat[style] : "{1} {0}";
  result = simple_format(dtf, timePattern, datePattern, NULL);
  free(datePattern);
  free(timePattern);
  fp_clear(&fp);
  return result;
}

char *scr_dtpg_static_skeleton(const char *pattern) {
  FormatParser fp = {0};
  PtnSkeleton s;
  skel_clear(&s);
  dtm_set(pattern, &fp, &s);
  fp_clear(&fp);
  return skel_get(&s, 0);
}
