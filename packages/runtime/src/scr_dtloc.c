#include "scr_dtloc.h"
#include "scr_locale.h"
#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static const struct { const char *legacy, *bcp; } kCal[] = {
  {"gregorian", "gregory"}, {"japanese", "japanese"}, {"buddhist", "buddhist"}, {"roc", "roc"},
  {"persian", "persian"}, {"islamic-civil", "islamic-civil"}, {"islamic", "islamic"}, {"hebrew", "hebrew"},
  {"chinese", "chinese"}, {"indian", "indian"}, {"coptic", "coptic"}, {"ethiopic", "ethiopic"},
  {"ethiopic-amete-alem", "ethioaa"}, {"iso8601", "iso8601"}, {"dangi", "dangi"},
  {"islamic-umalqura", "islamic-umalqura"}, {"islamic-tbla", "islamic-tbla"}, {"islamic-rgsa", "islamic-rgsa"},
  {NULL, NULL}};

const char *scr_dt_calendar_legacy(const char *bcp) {
  for (int i = 0; kCal[i].legacy; i++) if (strcmp(kCal[i].bcp, bcp) == 0) return kCal[i].legacy;
  if (strcmp(bcp, "islamicc") == 0) return "islamic-civil";
  if (strcmp(bcp, "ethiopic-amete-alem") == 0) return "ethiopic-amete-alem";
  return NULL;
}
const char *scr_dt_calendar_bcp47(const char *legacy) {
  for (int i = 0; kCal[i].legacy; i++) if (strcmp(kCal[i].legacy, legacy) == 0) return kCal[i].bcp;
  return NULL;
}

void scr_dtloc_init(DtLoc *l, const char *tag, const char *ca, const char *nu, const char *hc) {
  memset(l, 0, sizeof *l);
  char buf[96];
  snprintf(buf, sizeof buf, "%s", tag);
  char *save = buf;
  int idx = 0;
  while (save) {
    char *dash = strchr(save, '-');
    if (dash) *dash = 0;
    size_t n = strlen(save);
    if (idx == 0) snprintf(l->lang, sizeof l->lang, "%s", save);
    else if (n == 4 && isalpha((unsigned char)save[0]) && !l->script[0] && !l->region[0]) {
      snprintf(l->script, sizeof l->script, "%c%s", toupper((unsigned char)save[0]), save + 1);
      for (char *c = l->script + 1; *c; c++) *c = (char)tolower((unsigned char)*c);
    } else if ((n == 2 || (n == 3 && isdigit((unsigned char)save[0]))) && !l->region[0]) {
      snprintf(l->region, sizeof l->region, "%s", save);
      for (char *c = l->region; *c; c++) *c = (char)toupper((unsigned char)*c);
    }
    save = dash ? dash + 1 : NULL;
    idx++;
  }
  size_t o = (size_t)snprintf(l->base, sizeof l->base, "%s", l->lang);
  if (l->script[0]) o += (size_t)snprintf(l->base + o, sizeof l->base - o, "_%s", l->script);
  if (l->region[0]) o += (size_t)snprintf(l->base + o, sizeof l->base - o, "_%s", l->region);
  if (ca && *ca) {
    const char *lg = scr_dt_calendar_legacy(ca);
    if (lg) snprintf(l->calendar, sizeof l->calendar, "%s", lg);
  }
  if (nu && *nu) snprintf(l->numbering, sizeof l->numbering, "%s", nu);
  if (hc && *hc) snprintf(l->hours, sizeof l->hours, "%s", hc);
  scr_ures_open(l->base, &l->uloc);
}

int scr_dt_add_likely(const char *lang, const char *script, const char *region, char *oL, char *oS, char *oR) {
  /* only the locales a DateTimeFormat can resolve to are precomputed ("likely/<tag>") */
  char k[64];
  size_t o = (size_t)snprintf(k, sizeof k, "likely/%s", lang);
  if (script && *script) o += (size_t)snprintf(k + o, sizeof k - o, "-%s", script);
  if (region && *region) snprintf(k + o, sizeof k - o, "-%s", region);
  ScrCoreVal v = scr_core_get(k);
  if (!v.p) return 0;
  char t[64];
  size_t n = v.n < sizeof t - 1 ? v.n : sizeof t - 1;
  memcpy(t, v.p, n);
  t[n] = 0;
  oL[0] = oS[0] = oR[0] = 0;
  char *p = t;
  int part = 0;
  while (p) {
    char *d = strchr(p, '-');
    if (d) *d = 0;
    size_t pl = strlen(p);
    if (part == 0) snprintf(oL, 12, "%s", p);
    else if (pl == 4) snprintf(oS, 8, "%s", p);
    else snprintf(oR, 8, "%s", p);
    p = d ? d + 1 : NULL;
    part++;
  }
  return 1;
}

void scr_dtloc_supplemental_region(const DtLoc *l, int infer, char *out, size_t cap) {
  out[0] = 0;
  if (l->region[0]) { snprintf(out, cap, "%s", l->region); return; }
  if (!infer) return;
  char L[12], S[8], R[8];
  if (scr_dt_add_likely(l->lang, l->script, l->region, L, S, R) && R[0]) snprintf(out, cap, "%s", R);
}

const char *scr_dtloc_calendar_type(const DtLoc *l, char *buf, size_t cap) {
  if (l->calendar[0]) { snprintf(buf, cap, "%s", l->calendar); return buf; }
  char region[8];
  scr_dtloc_supplemental_region(l, 1, region, sizeof region);
  ScrRes r;
  char path[64];
  snprintf(path, sizeof path, "calendarPreferenceData/%s", region);
  if (!region[0] || !scr_ures_misc("supplementalData", path, &r)) {
    if (!scr_ures_misc("supplementalData", "calendarPreferenceData/001", &r)) { snprintf(buf, cap, "gregorian"); return buf; }
  }
  ScrRes first = scr_res_array_at(r, 0);
  size_t n;
  const char *s = scr_res_str(first, &n);
  if (!s || n >= cap) { snprintf(buf, cap, "gregorian"); return buf; }
  memcpy(buf, s, n);
  buf[n] = 0;
  if (!scr_dt_calendar_bcp47(buf)) snprintf(buf, cap, "gregorian");
  return buf;
}
