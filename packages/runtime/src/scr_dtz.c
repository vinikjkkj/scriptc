#include "scr_dtz.h"
#include "scr_date_zones.h"
#include "scr_dtfmt.h"
#include "scr_dtloc.h"
#include "scr_zone.h"
#include <ctype.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int parse_offset(const char *s, int *sec) {
  /* [+-U+2212]hh[:]mm as V8's GetOffsetTimeZone reads it */
  size_t len = strlen(s);
  int sign;
  const char *p;
  if (s[0] == '+') { sign = 1; p = s + 1; }
  else if (s[0] == '-') { sign = -1; p = s + 1; }
  else if ((unsigned char)s[0] == 0xE2 && (unsigned char)s[1] == 0x88 && (unsigned char)s[2] == 0x92) { sign = -1; p = s + 3; }
  else return 0;
  (void)len;
  int h, m = 0;
  if (!(isdigit((unsigned char)p[0]) && isdigit((unsigned char)p[1]))) return 0;
  h = (p[0] - '0') * 10 + (p[1] - '0');
  if (h > 23) return 0;
  p += 2;
  if (*p) {
    if (*p == ':') p++;
    if (!(isdigit((unsigned char)p[0]) && isdigit((unsigned char)p[1]) && p[2] == '\0')) return 0;
    m = (p[0] - '0') * 10 + (p[1] - '0');
    if (m > 59) return 0;
  }
  *sec = sign * (h * 3600 + m * 60);
  return 1;
}

/* JSDateTimeFormat::CanonicalizeTimeZoneID's special cases; NULL when the mined id is to be used */
static const char *v8_special(const char *in, char *buf, size_t cap) {
  char up[96];
  size_t n = strlen(in);
  if (n >= sizeof up) return NULL;
  for (size_t i = 0; i <= n; i++) up[i] = (char)toupper((unsigned char)in[i]);
  if (n == 3) return strcmp(up, "GMT") == 0 ? "UTC" : NULL;
  if (n > 3) {
    if (memcmp(up, "ETC", 3) == 0) {
      if (!strcmp(up, "ETC/UTC") || !strcmp(up, "ETC/GMT") || !strcmp(up, "ETC/UCT")) return "UTC";
    } else if (memcmp(up, "GMT", 3) == 0) {
      if (!strcmp(up, "GMT0") || !strcmp(up, "GMT+0") || !strcmp(up, "GMT-0")) return "UTC";
    }
  }
  (void)buf; (void)cap;
  return NULL;
}

int dtz_create(DtfZone *z, const char *opt) {
  memset(z, 0, sizeof *z);
  if (!opt) {
    z->tz = scr_tz_host();
    snprintf(z->id, sizeof z->id, "%s", z->tz->id ? z->tz->id : "UTC");
    z->zi = zi_find(z->id);
    return 0;
  }
  int sec;
  if (parse_offset(opt, &sec)) {
    z->isOffset = 1; z->offsetSec = sec;
    int a = sec < 0 ? -sec : sec;
    snprintf(z->id, sizeof z->id, "GMT%c%02d:%02d", sec < 0 ? '-' : '+', a / 3600, a / 60 % 60);
    if (sec == 0) { /* ICU's createTimeZone("GMT+00") is the zone "GMT" */
      z->isOffset = 0;
      snprintf(z->id, sizeof z->id, "GMT");
      z->zi = zi_find("GMT");
      z->tz = scr_tz_find("UTC", 3, 0);
    }
    return 0;
  }
  const struct scr_tz *t = scr_tz_find(opt, strlen(opt), 1);
  if (!t) return -1;
  z->tz = t;
  char b[8];
  const char *sp = v8_special(opt, b, sizeof b);
  snprintf(z->id, sizeof z->id, "%s", sp ? sp : (t->id ? t->id : opt));
  z->zi = zi_find(z->id);
  return 0;
}
void dtz_free(DtfZone *z) { (void)z; }

void dtz_offsets(const DtfZone *z, double utcMs, int32_t *rawMs, int32_t *dstMs) {
  if (z->isOffset) { *rawMs = z->offsetSec * 1000; *dstMs = 0; return; }
  int64_t t = (int64_t)floor(utcMs / 1000.0);
  int32_t total = scr_tz_offset(z->tz, t) * 1000;
  if (z->zi) {
    int32_t r, d;
    zi_offset(z->zi, utcMs, &r, &d);
    *rawMs = r;
    *dstMs = total - r;
    return;
  }
  *rawMs = total;
  *dstMs = 0;
}

/* ── small string helpers ────────────────────────────────────────────────────────────────────────────────── */
#define SB 512
typedef struct { char s[SB]; size_t n; } Str;
static void st_clear(Str *s) { s->s[0] = 0; s->n = 0; }
static void st_cat(Str *s, const char *t) {
  size_t l = strlen(t);
  if (s->n + l >= SB) l = SB - 1 - s->n;
  memcpy(s->s + s->n, t, l);
  s->n += l;
  s->s[s->n] = 0;
}
static void st_set(Str *s, const char *t) { st_clear(s); st_cat(s, t); }

static int ci_equal(const char *a, const char *b) {
  /* ASCII case-insensitive, other bytes exact (UnicodeString::caseCompare folds fully; the names differ in ASCII case only in practice) */
  for (; *a && *b; a++, b++) {
    unsigned char x = (unsigned char)*a, y = (unsigned char)*b;
    if (x < 128 && y < 128) { if (tolower(x) != tolower(y)) return 0; }
    else if (x != y) return 0;
  }
  return *a == *b;
}

/* SimpleFormatter (ApostropheMode DOUBLE_OPTIONAL): "{0}" "{1}" arguments, "'" quoting */
static void sf_format(const char *pat, const char *a0, const char *a1, Str *out) {
  st_clear(out);
  int inQuote = 0;
  for (const char *p = pat; *p;) {
    if (*p == '\'') {
      if (p[1] == '\'') { st_cat(out, "'"); p += 2; continue; }
      if (inQuote) { inQuote = 0; p++; continue; }
      if (p[1] == '{' || p[1] == '}') { inQuote = 1; p++; continue; }
      st_cat(out, "'"); p++; continue;
    }
    if (!inQuote && *p == '{' && isdigit((unsigned char)p[1]) && p[2] == '}') {
      st_cat(out, p[1] == '0' ? (a0 ? a0 : "") : (a1 ? a1 : ""));
      p += 3;
      continue;
    }
    char c[2] = {*p, 0};
    st_cat(out, c);
    p++;
  }
}

/* ── the context: one locale, one zone ───────────────────────────────────────────────────────────────────── */
enum { NI_EC, NI_LG, NI_LS, NI_LD, NI_SG, NI_SS, NI_SD, NI_COUNT };
typedef struct { Str n[NI_COUNT]; unsigned char st[NI_COUNT]; } ZNames; /* st: 0 unset, 1 name, 2 no-inheritance */

typedef struct { int type; char text[48]; int len; } OffItem; /* type 0 text, 1 hour, 2 minute, 3 second */
typedef struct { OffItem it[8]; int n; } OffPat;

typedef struct {
  const DtLoc *loc;
  const DtfZone *z;
  char target[8];
  Str gmtPre, gmtSuf;
  OffPat pat[6]; /* 0 +H, 1 +HM, 2 +HMS, 3 -H, 4 -HM, 5 -HMS */
  char digit[10][8];
  Str regionFmt, fallbackFmt;
} Ctx;

static int idx_of(const char *key, size_t kn) {
  if (kn != 2) return -1;
  if (key[0] == 'e' && key[1] == 'c') return NI_EC;
  if (key[0] == 'l') return key[1] == 'g' ? NI_LG : key[1] == 's' ? NI_LS : key[1] == 'd' ? NI_LD : -1;
  if (key[0] == 's') return key[1] == 'g' ? NI_SG : key[1] == 's' ? NI_SS : key[1] == 'd' ? NI_SD : -1;
  return -1;
}
static void zn_sink(void *ctx, const char *key, size_t kn, ScrRes v) {
  ZNames *zn = (ZNames *)ctx;
  int i = idx_of(key, kn);
  if (i < 0 || zn->st[i]) return;
  size_t n;
  const char *s = scr_res_str(v, &n);
  if (!s) return;
  if (n == 9 && memcmp(s, "\xE2\x88\x85\xE2\x88\x85\xE2\x88\x85", 9) == 0) { zn->st[i] = 2; return; }
  char tmp[SB];
  if (n >= sizeof tmp) n = sizeof tmp - 1;
  memcpy(tmp, s, n); tmp[n] = 0;
  st_set(&zn->n[i], tmp);
  zn->st[i] = 1;
}
static void load_names(const Ctx *c, const char *key, ZNames *zn) {
  memset(zn, 0, sizeof *zn);
  char path[160];
  snprintf(path, sizeof path, "zoneStrings/%s", key);
  scr_ures_all_items(&c->loc->uloc, SCR_URES_ZONE, path, zn_sink, zn);
}
static const char *zname(const ZNames *zn, int i) { return zn->st[i] == 1 ? zn->n[i].s : NULL; }

static void tz_key(const char *id, char *out, size_t cap) {
  size_t i = 0;
  for (; id[i] && i + 1 < cap; i++) out[i] = id[i] == '/' ? ':' : id[i];
  out[i] = 0;
}
static void default_exemplar(const char *tzid, Str *out) {
  st_clear(out);
  if (!tzid[0] || !strncmp(tzid, "Etc/", 4) || !strncmp(tzid, "SystemV/", 8)) return;
  const char *r8 = strstr(tzid, "Riyadh8");
  if (r8 && r8 > tzid) return;
  const char *sep = strrchr(tzid, '/');
  if (!sep || sep == tzid || !sep[1]) return;
  st_set(out, sep + 1);
  for (size_t i = 0; i < out->n; i++) if (out->s[i] == '_') out->s[i] = ' ';
}
/* TimeZoneNamesImpl::loadTimeZoneNames: the zone's names, the exemplar location computed when absent */
static void load_tz_names(const Ctx *c, const char *tzid, ZNames *zn) {
  char key[100];
  tz_key(tzid, key, sizeof key);
  load_names(c, key, zn);
  if (zn->st[NI_EC] != 1) {
    Str d;
    default_exemplar(tzid, &d);
    if (d.n > 0) { st_set(&zn->n[NI_EC], d.s); zn->st[NI_EC] = 1; }
    else zn->st[NI_EC] = 0;
  }
}
static void load_mz_names(const Ctx *c, const char *mzid, ZNames *zn) {
  char key[100];
  snprintf(key, sizeof key, "meta:%s", mzid);
  load_names(c, key, zn);
}

/* TimeZoneNames::getTimeZoneDisplayName / getMetaZoneDisplayName / getDisplayName */
static int tz_display_name(const Ctx *c, const char *tzid, int type, Str *out) {
  ZNames zn;
  load_tz_names(c, tzid, &zn);
  const char *s = zname(&zn, type);
  if (!s) return 0;
  st_set(out, s);
  return 1;
}
static int mz_display_name(const Ctx *c, const char *mzid, int type, Str *out) {
  if (!mzid[0]) return 0;
  ZNames zn;
  load_mz_names(c, mzid, &zn);
  const char *s = zname(&zn, type);
  if (!s) return 0;
  st_set(out, s);
  return 1;
}
static int get_display_name(const Ctx *c, const char *tzid, int type, double date, Str *out) {
  if (tz_display_name(c, tzid, type, out) && out->n) return 1;
  char mz[48];
  if (!zm_metazone_id(tzid, date, mz, sizeof mz)) return 0;
  return mz_display_name(c, mz, type, out) && out->n;
}
static void exemplar_name(const Ctx *c, const char *tzid, Str *out) {
  st_clear(out);
  ZNames zn;
  load_tz_names(c, tzid, &zn);
  const char *s = zname(&zn, NI_EC);
  if (s) st_set(out, s);
}

/* LocaleDisplayNames::regionDisplayName */
static void region_name(const Ctx *c, const char *code, Str *out) {
  char path[32], buf[SB];
  snprintf(path, sizeof path, "Countries/%s", code);
  if (scr_res_get_str(&c->loc->uloc, SCR_URES_REGION, path, buf, sizeof buf) && buf[0] && memcmp(buf, "\xE2\x88\x85\xE2\x88\x85\xE2\x88\x85", 9) != 0) st_set(out, buf);
  else st_set(out, code);
}

/* ── the zone ────────────────────────────────────────────────────────────────────────────────────────────── */
static int canonical_id(const Ctx *c, char *out, size_t cap) {
  if (c->z->isOffset || !c->z->zi) return 0;
  return zm_canonical_id(c->z->id, out, cap);
}
static void zone_offsets(const Ctx *c, double date, int32_t *raw, int32_t *dst) {
  if (c->z->isOffset) { *raw = c->z->offsetSec * 1000; *dst = 0; return; }
  if (c->z->zi) { zi_offset(c->z->zi, date, raw, dst); return; }
  dtz_offsets(c->z, date, raw, dst);
}

#define DST_CHECK_RANGE (184.0 * 86400000.0)

/* TZGNCore::getGenericLocationName */
static int generic_location(const Ctx *c, const char *canon, Str *out) {
  st_clear(out);
  char cc[8];
  int primary = 0;
  if (!zm_canonical_country(canon, cc, sizeof cc, &primary)) return 0;
  Str name, arg;
  if (primary) {
    region_name(c, cc, &arg);
  } else {
    exemplar_name(c, canon, &arg);
  }
  sf_format(c->regionFmt.s, arg.s, NULL, &name);
  if (!name.n) return 0;
  st_set(out, name.s);
  return 1;
}
static void partial_location(const Ctx *c, const char *canon, const char *mz, const char *mzName, Str *out) {
  Str location;
  char cc[8];
  if (zm_canonical_country(canon, cc, sizeof cc, NULL)) {
    char golden[96];
    if (zm_zone_for_metazone(mz, cc, golden, sizeof golden) && !strcmp(canon, golden)) region_name(c, cc, &location);
    else exemplar_name(c, canon, &location);
  } else {
    exemplar_name(c, canon, &location);
    if (!location.n) st_set(&location, canon);
  }
  sf_format(c->fallbackFmt.s, location.s, mzName, out);
}
/* TZGNCore::formatGenericNonLocationName */
static int generic_non_location(const Ctx *c, int isLong, double date, Str *out) {
  st_clear(out);
  char canon[96];
  if (!canonical_id(c, canon, sizeof canon)) return 0;
  int nameType = isLong ? NI_LG : NI_SG;
  if (tz_display_name(c, canon, nameType, out) && out->n) return 1;
  st_clear(out);
  char mz[48];
  if (!zm_metazone_id(canon, date, mz, sizeof mz)) return 0;
  int32_t raw, sav;
  zone_offsets(c, date, &raw, &sav);
  int useStandard = 0;
  if (sav == 0) {
    useStandard = 1;
    if (c->z->zi) {
      double t; int32_t f, to;
      if (zi_prev_transition(c->z->zi, date, 1, &t, &f, &to) && (date - t < DST_CHECK_RANGE) && f != 0) useStandard = 0;
      else if (zi_next_transition(c->z->zi, date, 0, &t, &f, &to) && (t - date < DST_CHECK_RANGE) && to != 0) useStandard = 0;
    }
  }
  if (useStandard) {
    Str stdName;
    if (get_display_name(c, canon, isLong ? NI_LS : NI_SS, date, &stdName)) {
      st_set(out, stdName.s);
      Str gen;
      if (mz_display_name(c, mz, nameType, &gen) && ci_equal(stdName.s, gen.s)) st_clear(out);
    }
  }
  if (!out->n) {
    Str mzName;
    if (mz_display_name(c, mz, nameType, &mzName) && mzName.n) {
      char golden[96];
      if (zm_zone_for_metazone(mz, c->target, golden, sizeof golden) && golden[0] && strcmp(golden, canon) != 0) {
        const ZiZone *gz = zi_find(golden);
        int32_t raw1 = 0, sav1 = 0;
        if (gz) {
          zi_offset_local(gz, date + raw + sav, &raw1, &sav1);
          if (raw != raw1 || sav != sav1) partial_location(c, canon, mz, mzName.s, out);
          else st_set(out, mzName.s);
        }
      } else st_set(out, mzName.s);
    }
  }
  return out->n > 0;
}
static int generic_name(const Ctx *c, int type /* 0 location 1 long 2 short */, double date, Str *out) {
  st_clear(out);
  char canon[96];
  if (type == 0) {
    if (!canonical_id(c, canon, sizeof canon)) return 0;
    return generic_location(c, canon, out);
  }
  generic_non_location(c, type == 1, date, out);
  if (!out->n && canonical_id(c, canon, sizeof canon)) generic_location(c, canon, out);
  return out->n > 0;
}
static int specific_name(const Ctx *c, int isLong, double date, Str *out) {
  st_clear(out);
  char canon[96];
  if (!canonical_id(c, canon, sizeof canon)) return 0;
  int32_t raw, dst;
  zone_offsets(c, date, &raw, &dst);
  int type = dst != 0 ? (isLong ? NI_LD : NI_SD) : (isLong ? NI_LS : NI_SS);
  return get_display_name(c, canon, type, date, out);
}

/* ── offset formats ──────────────────────────────────────────────────────────────────────────────────────── */
static void iso8601(int32_t offset, int basic, int useUtc, int isShort, int ignoreSeconds, Str *out) {
  st_clear(out);
  int32_t a = offset < 0 ? -offset : offset;
  if (useUtc && (a < 1000 || (ignoreSeconds && a < 60000))) { st_set(out, "Z"); return; }
  int minF = isShort ? 0 : 1, maxF = ignoreSeconds ? 1 : 2;
  if (a >= 86400000) return;
  int f[3];
  f[0] = a / 3600000; a %= 3600000;
  f[1] = a / 60000; a %= 60000;
  f[2] = a / 1000;
  int last = maxF;
  while (last > minF) { if (f[last] != 0) break; last--; }
  char sign = '+';
  if (offset < 0) for (int i = 0; i <= last; i++) if (f[i]) { sign = '-'; break; }
  char b[16];
  int n = 0;
  b[n++] = sign;
  for (int i = 0; i <= last; i++) {
    if (!basic && i) b[n++] = ':';
    b[n++] = (char)('0' + f[i] / 10);
    b[n++] = (char)('0' + f[i] % 10);
  }
  b[n] = 0;
  st_set(out, b);
}
static void append_digits(const Ctx *c, Str *out, int n, int minDigits) {
  int numDigits = n >= 10 ? 2 : 1;
  for (int i = 0; i < minDigits - numDigits; i++) st_cat(out, c->digit[0]);
  if (numDigits == 2) st_cat(out, c->digit[n / 10]);
  st_cat(out, c->digit[n % 10]);
}
static void localized_gmt(const Ctx *c, int32_t offset, int isShort, Str *out) {
  st_clear(out);
  if (offset <= -86400000 || offset >= 86400000) return;
  int positive = 1;
  if (offset < 0) { offset = -offset; positive = 0; }
  int h = offset / 3600000; offset %= 3600000;
  int m = offset / 60000; offset %= 60000;
  int s = offset / 1000;
  int which = s != 0 ? 2 : (m != 0 || !isShort) ? 1 : 0;
  const OffPat *p = &c->pat[(positive ? 0 : 3) + which];
  st_set(out, c->gmtPre.s);
  for (int i = 0; i < p->n; i++) {
    const OffItem *it = &p->it[i];
    if (it->type == 0) st_cat(out, it->text);
    else if (it->type == 1) append_digits(c, out, h, isShort ? 1 : 2);
    else if (it->type == 2) append_digits(c, out, m, 2);
    else append_digits(c, out, s, 2);
  }
  st_cat(out, c->gmtSuf.s);
}

static int item_valid(int type, int len) { return type == 1 ? (len == 1 || len == 2) : len == 2; }
/* TimeZoneFormat::parseOffsetPattern; returns 0 when the pattern is not usable */
static int parse_off_pattern(const char *pat, int required /* 1 H, 2 HM, 3 HMS */, OffPat *out) {
  out->n = 0;
  char text[48];
  size_t tl = 0;
  int itemType = 0, itemLen = 1, checkBits = 0, prevQuote = 0, inQuote = 0;
  for (const char *p = pat; *p; p++) {
    char ch = *p;
    if (ch == '\'') {
      if (prevQuote) { text[tl++] = '\''; prevQuote = 0; }
      else {
        prevQuote = 1;
        if (itemType != 0) {
          if (!item_valid(itemType, itemLen)) return 0;
          out->it[out->n].type = itemType; out->it[out->n].len = itemLen; out->it[out->n++].text[0] = 0;
          itemType = 0;
        }
      }
      inQuote = !inQuote;
    } else {
      prevQuote = 0;
      if (inQuote) { if (tl < 40) text[tl++] = ch; }
      else {
        int tmp = ch == 'H' ? 1 : ch == 'm' ? 2 : ch == 's' ? 3 : 0;
        if (tmp) {
          if (tmp == itemType) itemLen++;
          else {
            if (itemType == 0) {
              if (tl) { text[tl] = 0; out->it[out->n].type = 0; strcpy(out->it[out->n++].text, text); tl = 0; }
            } else {
              if (!item_valid(itemType, itemLen)) return 0;
              out->it[out->n].type = itemType; out->it[out->n].len = itemLen; out->it[out->n++].text[0] = 0;
            }
            itemType = tmp; itemLen = 1; checkBits |= 1 << (tmp - 1);
          }
        } else {
          if (itemType != 0) {
            if (!item_valid(itemType, itemLen)) return 0;
            out->it[out->n].type = itemType; out->it[out->n].len = itemLen; out->it[out->n++].text[0] = 0;
            itemType = 0;
          }
          if (tl < 40) text[tl++] = ch;
        }
      }
    }
    if (out->n > 6) return 0;
  }
  if (itemType == 0) { if (tl) { text[tl] = 0; out->it[out->n].type = 0; strcpy(out->it[out->n++].text, text); } }
  else {
    if (!item_valid(itemType, itemLen)) return 0;
    out->it[out->n].type = itemType; out->it[out->n].len = itemLen; out->it[out->n++].text[0] = 0;
  }
  int req = required == 1 ? 1 : required == 2 ? 3 : 7;
  return checkBits == req;
}

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

static void unquote(const char *p, size_t n, Str *out) {
  st_clear(out);
  int prevQuote = 0, inQuote = 0;
  for (size_t i = 0; i < n; i++) {
    char c = p[i];
    if (c == '\'') {
      if (prevQuote) { st_cat(out, "'"); prevQuote = 0; }
      else prevQuote = 1;
      inQuote = !inQuote;
    } else {
      prevQuote = 0;
      char b[2] = {c, 0};
      st_cat(out, b);
    }
  }
  (void)inQuote;
}

static void ctx_init(Ctx *c, const DtLoc *loc, const DtfZone *z) {
  memset(c, 0, sizeof *c);
  c->loc = loc;
  c->z = z;
  if (loc->region[0]) snprintf(c->target, sizeof c->target, "%s", loc->region);
  else {
    char l[12], s[8], r[8];
    if (scr_dt_add_likely(loc->lang, loc->script, "", l, s, r)) snprintf(c->target, sizeof c->target, "%s", r);
  }
  char buf[SB];
  /* gmtFormat / hourFormat / regionFormat / fallbackFormat live in zoneStrings, with root fallbacks */
  const char *gmt = "GMT{0}";
  if (scr_res_get_str(&loc->uloc, SCR_URES_ZONE, "zoneStrings/gmtFormat", buf, sizeof buf) && buf[0]) gmt = buf;
  const char *arg = strstr(gmt, "{0}");
  if (!arg) { gmt = "GMT{0}"; arg = gmt + 3; }
  unquote(gmt, (size_t)(arg - gmt), &c->gmtPre);
  unquote(arg + 3, strlen(arg + 3), &c->gmtSuf);
  char hf[SB];
  Str pos[3], neg[3];
  int useDef = 1;
  if (scr_res_get_str(&loc->uloc, SCR_URES_ZONE, "zoneStrings/hourFormat", hf, sizeof hf) && hf[0]) {
    char *sep = strchr(hf, ';');
    if (sep) {
      *sep = 0;
      st_set(&pos[1], hf);
      st_set(&neg[1], sep + 1);
      int ok = 1;
      for (int k = 0; k < 2 && ok; k++) {
        Str *hm = k ? &neg[1] : &pos[1];
        Str *hms = k ? &neg[2] : &pos[2];
        Str *h = k ? &neg[0] : &pos[0];
        char *mm = strstr(hm->s, "mm");
        if (!mm) { ok = 0; break; }
        size_t imm = (size_t)(mm - hm->s);
        /* expand: through "mm", the separator between the last H and mm, "ss", the rest */
        char sepb[32] = "";
        size_t iH = imm;
        while (iH > 0 && hm->s[iH - 1] != 'H') iH--;
        if (iH > 0) { size_t sl = imm - iH; if (sl < sizeof sepb) { memcpy(sepb, hm->s + iH, sl); sepb[sl] = 0; } }
        char tmp[SB];
        snprintf(tmp, sizeof tmp, "%.*s%s%s%s", (int)(imm + 2), hm->s, sepb, "ss", hm->s + imm + 2);
        st_set(hms, tmp);
        /* truncate */
        size_t cut = 0;
        int found = 0;
        for (size_t i = imm; i >= 2; i--) if (hm->s[i - 2] == 'H' && hm->s[i - 1] == 'H') { cut = i; found = 1; break; }
        if (!found) for (size_t i = imm; i >= 1; i--) if (hm->s[i - 1] == 'H') { cut = i; found = 1; break; }
        if (!found) { ok = 0; break; }
        snprintf(tmp, sizeof tmp, "%.*s", (int)cut, hm->s);
        st_set(h, tmp);
      }
      if (ok) useDef = 0;
    }
  }
  if (useDef) {
    st_set(&pos[0], "+H"); st_set(&pos[1], "+H:mm"); st_set(&pos[2], "+H:mm:ss");
    st_set(&neg[0], "-H"); st_set(&neg[1], "-H:mm"); st_set(&neg[2], "-H:mm:ss");
  }
  for (int i = 0; i < 3; i++) {
    parse_off_pattern(pos[i].s, i + 1, &c->pat[i]);
    parse_off_pattern(neg[i].s, i + 1, &c->pat[3 + i]);
  }
  /* digits */
  {
    char ns[24] = "";
    int ok = 0;
    if (loc->numbering[0]) { snprintf(ns, sizeof ns, "%s", loc->numbering); ok = ns_digits(ns, c->digit); }
    if (!ok) {
      char dn[24];
      if (!scr_res_get_str(&loc->uloc, SCR_URES_LOC, "NumberElements/default", dn, sizeof dn)) strcpy(dn, "latn");
      ok = ns_digits(dn, c->digit);
    }
    if (!ok) for (int i = 0; i < 10; i++) { c->digit[i][0] = (char)('0' + i); c->digit[i][1] = 0; }
  }
  st_set(&c->regionFmt, "{0}");
  st_set(&c->fallbackFmt, "{1} ({0})");
  if (scr_res_get_str(&loc->uloc, SCR_URES_ZONE, "zoneStrings/regionFormat", buf, sizeof buf) && buf[0]) st_set(&c->regionFmt, buf);
  if (scr_res_get_str(&loc->uloc, SCR_URES_ZONE, "zoneStrings/fallbackFormat", buf, sizeof buf) && buf[0]) st_set(&c->fallbackFmt, buf);
}

char *dtz_format_cb(void *ctx, int style, double utcMs, const ScrCal *cal) {
  (void)cal;
  const DtfZone *z = (const DtfZone *)ctx;
  Ctx c;
  ctx_init(&c, (const DtLoc *)z->loc, z);
  Str name;
  st_clear(&name);
  int noFallback = 0;
  switch (style) {
    case TZFMT_GENERIC_LOCATION: generic_name(&c, 0, utcMs, &name); break;
    case TZFMT_GENERIC_LONG: generic_name(&c, 1, utcMs, &name); break;
    case TZFMT_GENERIC_SHORT: generic_name(&c, 2, utcMs, &name); break;
    case TZFMT_SPECIFIC_LONG: specific_name(&c, 1, utcMs, &name); break;
    case TZFMT_SPECIFIC_SHORT: specific_name(&c, 0, utcMs, &name); break;
    case TZFMT_ZONE_ID: st_set(&name, z->id); noFallback = 1; break;
    case TZFMT_ZONE_ID_SHORT: {
      char canon[96], sid[32];
      if (canonical_id(&c, canon, sizeof canon) && zm_short_id(canon, sid, sizeof sid)) st_set(&name, sid);
      else st_set(&name, "unk");
      noFallback = 1;
      break;
    }
    case TZFMT_EXEMPLAR_LOCATION: {
      char canon[96];
      if (canonical_id(&c, canon, sizeof canon)) exemplar_name(&c, canon, &name);
      if (!name.n) exemplar_name(&c, "Etc/Unknown", &name);
      if (!name.n) st_set(&name, "Unknown");
      noFallback = 1;
      break;
    }
    default: break;
  }
  if (!name.n && !noFallback) {
    int32_t raw, dst;
    zone_offsets(&c, utcMs, &raw, &dst);
    int32_t off = raw + dst;
    switch (style) {
      case TZFMT_GENERIC_LOCATION: case TZFMT_GENERIC_LONG: case TZFMT_SPECIFIC_LONG: case TZFMT_LOCALIZED_GMT: localized_gmt(&c, off, 0, &name); break;
      case TZFMT_GENERIC_SHORT: case TZFMT_SPECIFIC_SHORT: case TZFMT_LOCALIZED_GMT_SHORT: localized_gmt(&c, off, 1, &name); break;
      case TZFMT_ISO_BASIC_SHORT: iso8601(off, 1, 1, 1, 1, &name); break;
      case TZFMT_ISO_BASIC_LOCAL_SHORT: iso8601(off, 1, 0, 1, 1, &name); break;
      case TZFMT_ISO_BASIC_FIXED: iso8601(off, 1, 1, 0, 1, &name); break;
      case TZFMT_ISO_BASIC_LOCAL_FIXED: iso8601(off, 1, 0, 0, 1, &name); break;
      case TZFMT_ISO_EXTENDED_FIXED: iso8601(off, 0, 1, 0, 1, &name); break;
      case TZFMT_ISO_EXTENDED_LOCAL_FIXED: iso8601(off, 0, 0, 0, 1, &name); break;
      case TZFMT_ISO_BASIC_FULL: iso8601(off, 1, 1, 0, 0, &name); break;
      case TZFMT_ISO_BASIC_LOCAL_FULL: iso8601(off, 1, 0, 0, 0, &name); break;
      case TZFMT_ISO_EXTENDED_FULL: iso8601(off, 0, 1, 0, 0, &name); break;
      case TZFMT_ISO_EXTENDED_LOCAL_FULL: iso8601(off, 0, 0, 0, 0, &name); break;
      default: break;
    }
  }
  return strdup(name.s);
}
