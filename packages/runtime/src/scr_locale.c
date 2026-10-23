#include "scr_locale.h"
#include "scr_ures.h"
#ifndef SCR_NF_STANDALONE
#include "scr_runtime.h"
#endif
#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define MAXSUB 24

static int is_alpha(const char *s, size_t n) { for (size_t i = 0; i < n; i++) if (!isalpha((unsigned char)s[i])) return 0; return n > 0; }
static int is_digit(const char *s, size_t n) { for (size_t i = 0; i < n; i++) if (!isdigit((unsigned char)s[i])) return 0; return n > 0; }
static int is_alnum(const char *s, size_t n) { for (size_t i = 0; i < n; i++) if (!isalnum((unsigned char)s[i])) return 0; return n > 0; }

typedef struct { char s[12]; size_t n; } Sub;

static void lower(char *s) { for (; *s; s++) *s = (char)tolower((unsigned char)*s); }

/* Replacement from a CLDR alias table ("languageAlias/iw" -> "he"); NULL when none. */
static const char *alias_get(const char *kind, const char *key, char *buf, size_t cap) {
  char k[64];
  snprintf(k, sizeof k, "%s/%s", kind, key);
  ScrCoreVal v = scr_core_get(k);
  if (!v.p || v.n >= cap) return NULL;
  memcpy(buf, v.p, v.n);
  buf[v.n] = 0;
  return buf;
}

static int cmp_str(const void *a, const void *b) { return strcmp((const char *)a, (const char *)b); }

typedef struct { char key[4]; char val[64]; } UKw;

int scr_locale_canonicalize(const char *in, size_t n, char *out, size_t cap) {
  if (n == 0 || n >= 200) return -1;
  Sub sub[MAXSUB];
  int ns = 0;
  size_t i = 0;
  while (i <= n) {
    size_t j = i;
    while (j < n && in[j] != '-') j++;
    size_t len = j - i;
    if (len == 0 || len > 8 || ns >= MAXSUB) return -1;
    if (!is_alnum(in + i, len)) return -1;
    memcpy(sub[ns].s, in + i, len);
    sub[ns].s[len] = 0;
    sub[ns].n = len;
    lower(sub[ns].s);
    ns++;
    i = j + 1;
  }
  int p = 0;
  /* language */
  size_t ln = sub[0].n;
  if (!is_alpha(sub[0].s, ln) || ln == 1 || ln == 4 || ln > 8) return -1;
  char lang[12];
  strcpy(lang, sub[0].s);
  p = 1;
  char script[8] = "", region[8] = "";
  char variants[8][12];
  int nv = 0;
  if (p < ns && sub[p].n == 4 && is_alpha(sub[p].s, 4)) { strcpy(script, sub[p].s); p++; }
  if (p < ns && ((sub[p].n == 2 && is_alpha(sub[p].s, 2)) || (sub[p].n == 3 && is_digit(sub[p].s, 3)))) { strcpy(region, sub[p].s); p++; }
  while (p < ns) {
    size_t vn = sub[p].n;
    int ok = (vn >= 5 && vn <= 8) || (vn == 4 && isdigit((unsigned char)sub[p].s[0]));
    if (!ok) break;
    if (nv >= 8) return -1;
    for (int q = 0; q < nv; q++) if (strcmp(variants[q], sub[p].s) == 0) return -1;
    strcpy(variants[nv++], sub[p].s);
    p++;
  }
  /* extensions */
  char exts[26][160];
  int hasext[26];
  memset(hasext, 0, sizeof hasext);
  char priv[160] = "";
  while (p < ns) {
    if (sub[p].n != 1) return -1;
    char single = sub[p].s[0];
    if (single == 'x') {
      p++;
      if (p >= ns) return -1;
      size_t o = 0;
      priv[0] = 0;
      for (; p < ns; p++) {
        if (sub[p].n < 1 || sub[p].n > 8) return -1;
        o += (size_t)snprintf(priv + o, sizeof priv - o, "%s%s", o ? "-" : "", sub[p].s);
      }
      break;
    }
    if (single < 'a' || single > 'z') {
      if (!isdigit((unsigned char)single)) return -1;
    }
    int idx = isdigit((unsigned char)single) ? -1 : single - 'a';
    if (idx < 0) return -1; /* digit singletons are not assigned; V8 accepts them structurally but they never matter */
    if (hasext[idx]) return -1;
    hasext[idx] = 1;
    p++;
    int cnt = 0;
    char buf[160] = "";
    size_t o = 0;
    if (single == 'u') {
      UKw kws[16]; int nk = 0;
      char attrs[64] = "";
      while (p < ns && sub[p].n >= 3) { /* attributes */
        o = strlen(attrs);
        snprintf(attrs + o, sizeof attrs - o, "%s%s", o ? "-" : "", sub[p].s); p++; cnt++;
      }
      while (p < ns && sub[p].n == 2) {
        if (nk >= 16) return -1;
        strcpy(kws[nk].key, sub[p].s); p++; cnt++;
        kws[nk].val[0] = 0;
        size_t vo = 0;
        while (p < ns && sub[p].n >= 3) {
          vo += (size_t)snprintf(kws[nk].val + vo, sizeof kws[nk].val - vo, "%s%s", vo ? "-" : "", sub[p].s); p++;
        }
        for (int q = 0; q < nk; q++) if (strcmp(kws[q].key, kws[nk].key) == 0) { nk = -1; break; }
        if (nk < 0) return -1;
        nk++;
      }
      if (cnt == 0) return -1;
      if (p < ns && sub[p].n != 1) return -1;
      /* sort keywords by key, drop "true" values, canonical aliases of a few values */
      for (int a = 0; a < nk; a++) for (int b = a + 1; b < nk; b++) if (strcmp(kws[a].key, kws[b].key) > 0) { UKw t = kws[a]; kws[a] = kws[b]; kws[b] = t; }
      o = 0;
      buf[0] = 0;
      if (attrs[0]) o += (size_t)snprintf(buf + o, sizeof buf - o, "%s", attrs);
      for (int a = 0; a < nk; a++) {
        if (strcmp(kws[a].val, "true") == 0) kws[a].val[0] = 0;
        if (strcmp(kws[a].key, "ca") == 0) {
          if (strcmp(kws[a].val, "islamicc") == 0) strcpy(kws[a].val, "islamic-civil");
          else if (strcmp(kws[a].val, "ethiopic-amete-alem") == 0) strcpy(kws[a].val, "ethioaa");
        }
        o += (size_t)snprintf(buf + o, sizeof buf - o, "%s%s%s%s", o ? "-" : "", kws[a].key, kws[a].val[0] ? "-" : "", kws[a].val);
      }
    } else {
      while (p < ns && sub[p].n >= 2) {
        o += (size_t)snprintf(buf + o, sizeof buf - o, "%s%s", o ? "-" : "", sub[p].s); p++; cnt++;
      }
      if (cnt == 0) return -1;
      if (p < ns && sub[p].n != 1) return -1;
    }
    snprintf(exts[idx], sizeof exts[idx], "%s", buf);
  }
  /* aliases */
  char rep[96];
  if (alias_get("languageAlias", lang, rep, sizeof rep)) {
    /* a replacement may carry script/region: take them when the tag has none */
    char *d1 = strchr(rep, '-');
    char l2[12] = "", s2[8] = "", r2[8] = "";
    if (d1) {
      *d1 = 0;
      char *q = d1 + 1;
      if (strlen(q) == 4) { strcpy(s2, q); } else if (strlen(q) == 2 || strlen(q) == 3) strcpy(r2, q);
      char *d2 = strchr(q, '-');
      if (d2) { *d2 = 0; strcpy(s2, q); strcpy(r2, d2 + 1); }
    }
    strncpy(l2, rep, 11);
    if (strlen(l2) >= 2) {
      strcpy(lang, l2);
      if (!script[0] && s2[0]) strcpy(script, s2);
      if (!region[0] && r2[0]) strcpy(region, r2);
    }
  }
  if (region[0]) {
    char up[8];
    strcpy(up, region);
    for (char *c = up; *c; c++) *c = (char)toupper((unsigned char)*c);
    if (alias_get("territoryAlias", up, rep, sizeof rep)) {
      char *sp = strchr(rep, ' ');
      if (sp) *sp = 0;
      strcpy(region, rep);
      lower(region);
    }
  }
  if (script[0] && alias_get("scriptAlias", script, rep, sizeof rep)) { /* none are in play for lowercase keys */ }
  /* assemble */
  size_t o = 0;
  o += (size_t)snprintf(out + o, cap - o, "%s", lang);
  if (script[0]) o += (size_t)snprintf(out + o, cap - o, "-%c%s", toupper((unsigned char)script[0]), script + 1);
  if (region[0]) {
    char up[8]; strcpy(up, region);
    for (char *c = up; *c; c++) *c = (char)toupper((unsigned char)*c);
    o += (size_t)snprintf(out + o, cap - o, "-%s", up);
  }
  /* variants sorted */
  for (int a = 0; a < nv; a++) for (int b = a + 1; b < nv; b++) if (strcmp(variants[a], variants[b]) > 0) { char t[12]; strcpy(t, variants[a]); strcpy(variants[a], variants[b]); strcpy(variants[b], t); }
  for (int a = 0; a < nv; a++) o += (size_t)snprintf(out + o, cap - o, "-%s", variants[a]);
  for (int c = 0; c < 26; c++) if (hasext[c]) o += (size_t)snprintf(out + o, cap - o, "-%c-%s", 'a' + c, exts[c]);
  if (priv[0]) o += (size_t)snprintf(out + o, cap - o, "-x-%s", priv);
  (void)cmp_str;
  return 0;
}

/* ── availability ──────────────────────────────────────────────────────────────────────────────────────────── */
static int avail_has(int service, const char *tag) {
  ScrCoreVal v = scr_core_get(service == SCR_LOC_NF ? "avail/nf" : "avail/dtf");
  size_t n = strlen(tag);
  const char *p = v.p, *end = v.p ? v.p + v.n : NULL;
  while (p && p < end) {
    const char *q = p;
    while (q < end && *q != ' ') q++;
    if ((size_t)(q - p) == n && memcmp(p, tag, n) == 0) return 1;
    p = q + 1;
  }
  return 0;
}

static void u_ext_get(const char *canon, const char *key, char *out, size_t cap) {
  out[0] = 0;
  const char *u = strstr(canon, "-u-");
  if (!u) return;
  u += 3;
  /* the extension ends at the next singleton subtag */
  size_t kn = strlen(key);
  const char *p = u;
  while (*p) {
    const char *q = strchr(p, '-');
    size_t sl = q ? (size_t)(q - p) : strlen(p);
    if (sl == 1) return;
    if (sl == kn && memcmp(p, key, kn) == 0) {
      const char *v = q ? q + 1 : p + sl;
      size_t o = 0;
      while (*v) {
        const char *w = strchr(v, '-');
        size_t vl = w ? (size_t)(w - v) : strlen(v);
        if (vl < 3) break;
        if (o) { if (o + 1 < cap) out[o++] = '-'; }
        for (size_t i = 0; i < vl && o + 1 < cap; i++) out[o++] = v[i];
        v = w ? w + 1 : v + vl;
      }
      out[o] = 0;
      return;
    }
    if (!q) return;
    p = q + 1;
  }
}

/* The environment's default locale (V8's Intl::DefaultLocale): en-US unless LC_ALL / LC_MESSAGES / LANG name one. */
static void default_tag(char *buf, size_t cap) {
#ifdef SCR_NF_STANDALONE
  snprintf(buf, cap, "%s", "en-US");
#else
  ScrStr *d = scr_intl_default_locale();
  snprintf(buf, cap, "%s", d->data);
  scr_str_release(d);
#endif
}

/* JSLocale::StartsWithUnicodeLanguageId: the tag starts with a unicode_language_id (language, script, region, variants),
 * possibly followed by an extension singleton and anything after it. */
static int sv_alpha(const char *s, size_t n) { return is_alpha(s, n); }
static int sv_alnum(const char *s, size_t n) { return is_alnum(s, n); }
static int structurally_valid(const char *s, size_t n) {
  const char *tok[MAXSUB * 2];
  size_t len[MAXSUB * 2];
  int nt = 0;
  size_t i = 0;
  while (i < n) { /* std::getline: an empty trailing token is not produced */
    size_t j = i;
    while (j < n && s[j] != '-') j++;
    if (nt >= MAXSUB * 2) return 0;
    tok[nt] = s + i; len[nt] = j - i; nt++;
    i = j + 1;
  }
  if (nt == 0) return 0;
  if (!(sv_alpha(tok[0], len[0]) && ((len[0] >= 2 && len[0] <= 3) || (len[0] >= 5 && len[0] <= 8)))) return 0;
  if (nt == 1) return 1;
  if (len[1] == 1 && sv_alnum(tok[1], 1)) return 1;
  int idx = 1;
  if (len[idx] == 4 && sv_alpha(tok[idx], 4)) { idx++; if (idx == nt) return 1; }
  if ((len[idx] == 2 && sv_alpha(tok[idx], 2)) || (len[idx] == 3 && is_digit(tok[idx], 3))) idx++;
  while (idx < nt) {
    if (len[idx] == 1 && sv_alnum(tok[idx], 1)) return 1;
    int variant = (len[idx] >= 5 && len[idx] <= 8 && sv_alnum(tok[idx], len[idx])) || (len[idx] == 4 && isdigit((unsigned char)tok[idx][0]) && sv_alnum(tok[idx], 4));
    if (!variant) return 0;
    idx++;
  }
  return 1;
}

static struct { int valid; char key[200]; } g_icu_cache[4];
const char *scr_icu_cache_lookup(int type, const char *locales) {
  if (strcmp(locales, "-") == 0 && g_icu_cache[type].valid && g_icu_cache[type].key[0] == 0) return "";
  return locales;
}
void scr_icu_cache_store(int type, const char *locales) {
  if (g_icu_cache[type].valid && strcmp(g_icu_cache[type].key, locales) == 0) return; /* a hit keeps its entry */
  if (strcmp(locales, "-") == 0) return;
  snprintf(g_icu_cache[type].key, sizeof g_icu_cache[type].key, "%s", locales);
  g_icu_cache[type].valid = 1;
}

void scr_locale_error_message(int rc, const ScrLocRes *r, char *buf, size_t cap) {
  if (rc == -2) snprintf(buf, cap, "Invalid language tag: %s", r->bad);
  else snprintf(buf, cap, "Incorrect locale information provided");
}

int scr_locale_resolve(int service, const char *locales, ScrLocRes *r) {
  memset(r, 0, sizeof *r);
  char defbuf[96];
  if (!locales || !*locales) { default_tag(defbuf, sizeof defbuf); locales = defbuf; }
  char canon[200] = "";
  int found = 0;
  const char *p = locales;
  while (p && *p) {
    const char *e = strchr(p, ',');
    size_t n = e ? (size_t)(e - p) : strlen(p);
    char c[200];
    if (!structurally_valid(p, n)) return -1;
    if (scr_locale_canonicalize(p, n, c, sizeof c) != 0) {
      size_t m = n < sizeof r->bad - 1 ? n : sizeof r->bad - 1;
      for (size_t k = 0; k < m; k++) r->bad[k] = (char)tolower((unsigned char)p[k]);
      r->bad[m] = 0;
      return -2;
    }
    if (!found) {
      /* strip the extensions and walk the lookup chain */
      char base[200];
      snprintf(base, sizeof base, "%s", c);
      char *ext = strstr(base, "-u-");
      char *x1 = strstr(base, "-x-");
      char *cut = NULL;
      for (char *q = base; *q; q++) if (q[0] == '-' && q[2] == '-' && q != base) { cut = q; break; }
      (void)ext; (void)x1;
      if (cut) *cut = 0;
      char probe[200];
      snprintf(probe, sizeof probe, "%s", base);
      for (;;) {
        if (avail_has(service, probe)) { found = 1; snprintf(r->tag, sizeof r->tag, "%s", probe); snprintf(canon, sizeof canon, "%s", c); break; }
        char *d = strrchr(probe, '-');
        if (!d) break;
        *d = 0;
      }
    }
    p = e ? e + 1 : NULL;
  }
  if (!found) {
    snprintf(r->tag, sizeof r->tag, "en-US");
    canon[0] = 0;
  }
  {
    char name[96];
    size_t n = strlen(r->tag);
    if (n >= sizeof name) n = sizeof name - 1;
    for (size_t i = 0; i < n; i++) name[i] = r->tag[i] == '-' ? '_' : r->tag[i];
    name[n] = 0;
    scr_ures_open(name, &r->uloc);
  }
  if (canon[0]) {
    u_ext_get(canon, "nu", r->nu, sizeof r->nu);
    u_ext_get(canon, "ca", r->ca, sizeof r->ca);
    u_ext_get(canon, "hc", r->hc, sizeof r->hc);
  }
  return 0;
}
