#include "scr_ures.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct { const unsigned char *data; uint32_t len; } Blk;
typedef struct { uint32_t n; const unsigned char **p; uint32_t *len; } Dict;

static struct {
  bool ready;
  Dict dict[SCR_URES_NPKG];
  int nloc;
  const unsigned char **name;
  uint32_t *namen;
  Blk *blk[SCR_URES_NPKG]; /* [nloc] */
  int root;
  uint32_t ncore;
  const unsigned char **corek, **corev;
  uint32_t *corekn, *corevn;
} G;

static uint32_t rd32(const unsigned char **p) {
  const unsigned char *q = *p;
  uint32_t v = (uint32_t)q[0] | ((uint32_t)q[1] << 8) | ((uint32_t)q[2] << 16) | ((uint32_t)q[3] << 24);
  *p += 4;
  return v;
}
static uint32_t rdvar(const unsigned char **p) {
  uint32_t v = 0;
  int sh = 0;
  for (;;) {
    unsigned char b = *(*p)++;
    v |= (uint32_t)(b & 0x7f) << sh;
    if (!(b & 0x80)) return v;
    sh += 7;
  }
}

static const char *const pkg_names[SCR_URES_NPKG] = {"loc", "curr", "unit", "zone", "misc", "region"};

static void init(void) {
  if (G.ready) return;
  size_t len = 0;
  const unsigned char *p = scr_ures_image(&len);
  p += 8;
  { uint32_t n = rd32(&p); p += n; } /* version */
  uint32_t npkg = rd32(&p);
  int pk[16];
  for (uint32_t i = 0; i < npkg; i++) {
    uint32_t nl = rd32(&p);
    int pi = -1;
    for (int j = 0; j < SCR_URES_NPKG; j++) if (strlen(pkg_names[j]) == nl && memcmp(pkg_names[j], p, nl) == 0) pi = j;
    p += nl;
    pk[i] = pi;
    uint32_t nk = rd32(&p);
    if (pi >= 0) {
      G.dict[pi].n = nk;
      G.dict[pi].p = malloc(sizeof(char *) * (nk ? nk : 1));
      G.dict[pi].len = malloc(sizeof(uint32_t) * (nk ? nk : 1));
    }
    for (uint32_t k = 0; k < nk; k++) {
      uint32_t kl = rd32(&p);
      if (pi >= 0) { G.dict[pi].p[k] = p; G.dict[pi].len[k] = kl; }
      p += kl;
    }
  }
  G.nloc = (int)rd32(&p);
  G.name = malloc(sizeof(char *) * (size_t)G.nloc);
  G.namen = malloc(sizeof(uint32_t) * (size_t)G.nloc);
  for (int i = 0; i < G.nloc; i++) {
    uint32_t nl = rd32(&p);
    G.name[i] = p; G.namen[i] = nl; p += nl;
    if (nl == 4 && memcmp(G.name[i], "root", 4) == 0) G.root = i;
  }
  for (int j = 0; j < SCR_URES_NPKG; j++) G.blk[j] = calloc((size_t)G.nloc, sizeof(Blk));
  uint32_t nb = rd32(&p);
  for (uint32_t b = 0; b < nb; b++) {
    uint32_t pi = rd32(&p), li = rd32(&p), bl = rd32(&p);
    if (pk[pi] >= 0) { G.blk[pk[pi]][li].data = p; G.blk[pk[pi]][li].len = bl; }
    p += bl;
  }
  G.ncore = rd32(&p);
  G.corek = malloc(sizeof(char *) * (G.ncore ? G.ncore : 1));
  G.corev = malloc(sizeof(char *) * (G.ncore ? G.ncore : 1));
  G.corekn = malloc(sizeof(uint32_t) * (G.ncore ? G.ncore : 1));
  G.corevn = malloc(sizeof(uint32_t) * (G.ncore ? G.ncore : 1));
  for (uint32_t i = 0; i < G.ncore; i++) {
    uint32_t kl = rd32(&p); G.corek[i] = p; G.corekn[i] = kl; p += kl;
    uint32_t vl = rd32(&p); G.corev[i] = p; G.corevn[i] = vl; p += vl;
  }
  G.ready = true;
}

int scr_ures_locale_count(void) { init(); return G.nloc; }
const char *scr_ures_locale_name(int loc, size_t *n) { init(); *n = G.namen[loc]; return (const char *)G.name[loc]; }
int scr_ures_locale_find(const char *name, size_t n) {
  init();
  int lo = 0, hi = G.nloc - 1;
  while (lo <= hi) { /* names are sorted */
    int mid = (lo + hi) / 2;
    size_t m = G.namen[mid] < n ? G.namen[mid] : n;
    int c = memcmp(G.name[mid], name, m);
    if (c == 0) c = G.namen[mid] < n ? -1 : (G.namen[mid] > n ? 1 : 0);
    if (c == 0) return mid;
    if (c < 0) lo = mid + 1; else hi = mid - 1;
  }
  return -1;
}
/* ── node access ───────────────────────────────────────────────────────────────────────────────────────────── */
static const unsigned char *skip(const unsigned char *p) {
  const unsigned char *q = p + 1;
  uint32_t l = rdvar(&q);
  return q + l;
}
int scr_res_kind(ScrRes r) { return r.p ? r.p[0] : -1; }
const char *scr_res_str(ScrRes r, size_t *n) {
  if (!r.p || (r.p[0] != SCR_RES_STR && r.p[0] != SCR_RES_ALIAS)) { *n = 0; return NULL; }
  const unsigned char *q = r.p + 1;
  *n = rdvar(&q);
  return (const char *)q;
}
static const unsigned char *payload(ScrRes r) { const unsigned char *q = r.p + 1; rdvar(&q); return q; }
static int32_t unzig(uint32_t z) { return (z & 1) ? -(int32_t)((z + 1) / 2) : (int32_t)(z / 2); }
int scr_res_intvec(ScrRes r, int32_t *out, int cap) {
  if (!r.p || r.p[0] != SCR_RES_INTVEC) return -1;
  const unsigned char *q = r.p + 1;
  rdvar(&q);
  int n = (int)rdvar(&q);
  for (int i = 0; i < n; i++) { uint32_t z = rdvar(&q); if (i < cap) out[i] = unzig(z); }
  return n;
}
int32_t scr_res_int(ScrRes r, int *ok) {
  if (!r.p || r.p[0] != SCR_RES_INT) { if (ok) *ok = 0; return 0; }
  const unsigned char *q = r.p + 1;
  rdvar(&q);
  if (ok) *ok = 1;
  return unzig(rdvar(&q));
}
int scr_res_array_len(ScrRes r) {
  if (!r.p || r.p[0] != SCR_RES_ARRAY) return 0;
  const unsigned char *q = payload(r);
  return (int)rdvar(&q);
}
ScrRes scr_res_array_at(ScrRes r, int i) {
  ScrRes none = {NULL, r.pkg};
  if (!r.p || r.p[0] != SCR_RES_ARRAY) return none;
  const unsigned char *q = payload(r);
  int n = (int)rdvar(&q);
  if (i < 0 || i >= n) return none;
  for (int k = 0; k < i; k++) q = skip(q);
  ScrRes out = {q, r.pkg};
  return out;
}
int scr_res_table_len(ScrRes r) {
  if (!r.p || r.p[0] != SCR_RES_TABLE) return 0;
  const unsigned char *q = payload(r);
  return (int)rdvar(&q);
}
ScrRes scr_res_table_at(ScrRes r, int i, const char **key, size_t *kn) {
  ScrRes none = {NULL, r.pkg};
  if (!r.p || r.p[0] != SCR_RES_TABLE) return none;
  const unsigned char *q = payload(r);
  int n = (int)rdvar(&q);
  if (i < 0 || i >= n) return none;
  for (int k = 0; k < i; k++) { rdvar(&q); q = skip(q); }
  uint32_t id = rdvar(&q);
  if (key) { *key = (const char *)G.dict[r.pkg].p[id]; *kn = G.dict[r.pkg].len[id]; }
  ScrRes out = {q, r.pkg};
  return out;
}

static int dict_find(int pkg, const char *key, size_t kn) {
  Dict *d = &G.dict[pkg];
  int lo = 0, hi = (int)d->n - 1;
  while (lo <= hi) {
    int mid = (lo + hi) / 2;
    size_t m = d->len[mid] < kn ? d->len[mid] : kn;
    int c = memcmp(d->p[mid], key, m);
    if (c == 0) c = d->len[mid] < kn ? -1 : (d->len[mid] > kn ? 1 : 0);
    if (c == 0) return mid;
    if (c < 0) lo = mid + 1; else hi = mid - 1;
  }
  return -1;
}
static ScrRes table_find(ScrRes t, int keyId) {
  ScrRes none = {NULL, t.pkg};
  if (!t.p || t.p[0] != SCR_RES_TABLE) return none;
  const unsigned char *q = payload(t);
  uint32_t n = rdvar(&q);
  for (uint32_t i = 0; i < n; i++) {
    uint32_t id = rdvar(&q);
    if ((int)id == keyId) { ScrRes r = {q, t.pkg}; return r; }
    if ((int)id > keyId) break; /* entries are sorted by key id */
    q = skip(q);
  }
  return none;
}

/* ── lookup with fallback ──────────────────────────────────────────────────────────────────────────────────── */
static int parent_of(int pkg, int loc) {
  /* explicit %%Parent of the bundle, else truncation, else root */
  Blk *b = &G.blk[pkg][loc];
  if (b->data) {
    int kid = dict_find(pkg, "%%Parent", 8);
    if (kid >= 0) {
      ScrRes root = {b->data, pkg};
      ScrRes v = table_find(root, kid);
      size_t n;
      const char *s = scr_res_str(v, &n);
      if (s) { int l = scr_ures_locale_find(s, n); if (l >= 0) return l; }
    }
  }
  if (loc == G.root) return -1;
  char buf[96];
  size_t n = G.namen[loc];
  memcpy(buf, G.name[loc], n);
  buf[n] = 0;
  for (;;) {
    char *u = strrchr(buf, '_');
    if (!u) return G.root;
    n = (size_t)(u - buf);
    buf[n] = 0;
    int l = scr_ures_locale_find(buf, n);
    if (l >= 0) return l;
  }
}
/* %%ALIAS: the bundle stands for another locale */
static int alias_target(int pkg, int loc) {
  Blk *b = &G.blk[pkg][loc];
  if (!b->data) return loc;
  int kid = dict_find(pkg, "%%ALIAS", 7);
  if (kid < 0) return loc;
  ScrRes root = {b->data, pkg};
  ScrRes v = table_find(root, kid);
  size_t n;
  const char *s = scr_res_str(v, &n);
  if (!s) return loc;
  int l = scr_ures_locale_find(s, n);
  return l >= 0 ? l : loc;
}

static bool get_depth(int pkg, int loc, const char *path, ScrRes *out, int depth);
static bool has_block_fwd(int pkg, int idx) { return idx >= 0 && G.blk[pkg][idx].data != NULL; }

/* Walks `path` below the bundle root `node`. An alias met on the way (the alias text is "/LOCALE/<path>") is expanded
 * into a fresh lookup of <path>/<rest of the walk> against the REQUESTED locale, with its own fallback: `alias`
 * receives the expanded path and the function returns false. */
static bool walk(int pkg, ScrRes node, const char *path, size_t pn, ScrRes *out, char *alias, size_t aliasCap) {
  size_t i = 0;
  alias[0] = 0;
  while (i < pn) {
    size_t j = i;
    while (j < pn && path[j] != '/') j++;
    int kid = dict_find(pkg, path + i, j - i);
    if (kid < 0) return false;
    ScrRes c = table_find(node, kid);
    if (!c.p) return false;
    if (c.p[0] == SCR_RES_ALIAS) {
      size_t n;
      const char *s = scr_res_str(c, &n);
      if (n > 8 && memcmp(s, "/LOCALE/", 8) == 0) {
        size_t rest = j < pn ? pn - j - 1 : 0;
        if (n - 8 + 1 + rest + 1 > aliasCap) return false;
        memcpy(alias, s + 8, n - 8);
        size_t k = n - 8;
        if (rest) { alias[k++] = '/'; memcpy(alias + k, path + j + 1, rest); k += rest; }
        alias[k] = 0;
      }
      return false;
    }
    node = c;
    i = j < pn ? j + 1 : j;
  }
  *out = node;
  return true;
}

static int chain_next(int pkg, int loc) { return parent_of(pkg, loc); }

static bool get_depth(int pkg, int loc, const char *path, ScrRes *out, int depth) {
  init();
  if (depth > 16) return false;
  size_t pn = strlen(path);
  for (int cur = loc; cur >= 0;) {
    int l = alias_target(pkg, cur);
    cur = chain_next(pkg, l);
    Blk *b = &G.blk[pkg][l];
    if (!b->data) continue;
    ScrRes root = {b->data, pkg};
    char alias[512];
    if (walk(pkg, root, path, pn, out, alias, sizeof alias)) return true;
    if (alias[0] && get_depth(pkg, loc, alias, out, depth + 1)) return true;
  }
  return false;
}
bool scr_ures_get(const ScrUloc *u, int pkg, const char *path, ScrRes *out) { return get_depth(pkg, u->start[pkg], path, out, 0); }

bool scr_ures_misc(const char *bundle, const char *path, ScrRes *out) {
  init();
  int idx = scr_ures_locale_find(bundle, strlen(bundle));
  if (idx < 0 || !has_block_fwd(SCR_URES_MISC, idx)) return false;
  return get_depth(SCR_URES_MISC, idx, path, out, 0);
}

bool scr_res_get_str(const ScrUloc *u, int pkg, const char *path, char *out, size_t cap) {
  ScrRes r;
  if (!scr_ures_get(u, pkg, path, &r) || r.p[0] != SCR_RES_STR) return false;
  size_t n;
  const char *s = scr_res_str(r, &n);
  if (n + 1 > cap) return false;
  memcpy(out, s, n);
  out[n] = 0;
  return true;
}

static bool all_items_depth(int pkg, int loc, const char *path, ScrResSink sink, void *ctx, int depth) {
  init();
  if (depth > 16) return false;
  bool any = false;
  size_t pn = strlen(path);
  for (int cur = loc; cur >= 0;) {
    int l = alias_target(pkg, cur);
    cur = chain_next(pkg, l);
    Blk *b = &G.blk[pkg][l];
    if (!b->data) continue;
    ScrRes root = {b->data, pkg}, t;
    char alias[512];
    if (!walk(pkg, root, path, pn, &t, alias, sizeof alias)) {
      if (alias[0] && all_items_depth(pkg, loc, alias, sink, ctx, depth + 1)) any = true;
      continue;
    }
    if (t.p[0] != SCR_RES_TABLE) continue;
    any = true;
    int n = scr_res_table_len(t);
    for (int i = 0; i < n; i++) {
      const char *k;
      size_t kn;
      ScrRes v = scr_res_table_at(t, i, &k, &kn);
      if (v.p[0] == SCR_RES_ALIAS) {
        size_t an;
        const char *as = scr_res_str(v, &an);
        ScrRes rv;
        if (an > 8 && memcmp(as, "/LOCALE/", 8) == 0 && an - 8 < 256) {
          char ap[256];
          memcpy(ap, as + 8, an - 8);
          ap[an - 8] = 0;
          if (get_depth(pkg, loc, ap, &rv, depth + 1)) sink(ctx, k, kn, rv);
        }
        continue;
      }
      sink(ctx, k, kn, v);
    }
  }
  return any;
}
/* the table at `path` of every bundle in the chain that has one, child first, children left unresolved */
static bool each_table_depth(int pkg, int loc, const char *path, ScrResTableCb cb, void *ctx, int depth) {
  init();
  if (depth > 16) return false;
  bool any = false;
  size_t pn = strlen(path);
  for (int cur = loc; cur >= 0;) {
    int l = alias_target(pkg, cur);
    cur = chain_next(pkg, l);
    Blk *b = &G.blk[pkg][l];
    if (!b->data) continue;
    ScrRes root = {b->data, pkg}, t;
    char alias[512];
    if (!walk(pkg, root, path, pn, &t, alias, sizeof alias)) {
      if (alias[0] && each_table_depth(pkg, loc, alias, cb, ctx, depth + 1)) any = true;
      continue;
    }
    if (t.p[0] != SCR_RES_TABLE) continue;
    any = true;
    cb(ctx, t);
  }
  return any;
}
bool scr_ures_each_table(const ScrUloc *u, int pkg, const char *path, ScrResTableCb cb, void *ctx) { return each_table_depth(pkg, u->start[pkg], path, cb, ctx, 0); }

bool scr_ures_all_items(const ScrUloc *u, int pkg, const char *path, ScrResSink sink, void *ctx) { return all_items_depth(pkg, u->start[pkg], path, sink, ctx, 0); }

/* ── ures_open: findFirstExisting with CLDR's fallback for names that have no bundle ──────────────────────── */
static int has_block(int pkg, int idx) { return idx >= 0 && G.blk[pkg][idx].data != NULL; }

typedef struct { char lang[16], script[8], region[8]; int variant; } Subtags;
static void split_subtags(const char *name, Subtags *s) {
  memset(s, 0, sizeof *s);
  char buf[96];
  snprintf(buf, sizeof buf, "%s", name);
  char *tok = buf, *next;
  int idx = 0;
  while (tok) {
    next = strchr(tok, '_');
    if (next) *next++ = 0;
    size_t n = strlen(tok);
    if (idx == 0) snprintf(s->lang, sizeof s->lang, "%s", tok);
    else if (n == 4 && !s->script[0] && !s->region[0]) { int alpha = 1; for (size_t i = 0; i < n; i++) if (!((tok[i] >= 'a' && tok[i] <= 'z') || (tok[i] >= 'A' && tok[i] <= 'Z'))) alpha = 0; if (alpha) snprintf(s->script, sizeof s->script, "%s", tok); else s->variant = 1; }
    else if (!s->region[0] && (n == 2 || (n == 3 && tok[0] >= '0' && tok[0] <= '9'))) snprintf(s->region, sizeof s->region, "%s", tok);
    else s->variant = 1;
    tok = next;
    idx++;
  }
}
static bool chop_name(char *name) {
  char *u = strrchr(name, '_');
  if (!u) return false;
  *u = 0;
  return true;
}
static void default_script(const char *lang, const char *region, char *out) {
  char k[64];
  strcpy(out, "Latn");
  ScrCoreVal v = {NULL, 0};
  if (region && region[0]) { snprintf(k, sizeof k, "dscript/%s_%s", lang, region); v = scr_core_get(k); }
  if (!v.p) { snprintf(k, sizeof k, "dscript/%s", lang); v = scr_core_get(k); }
  if (v.p && v.n < 8) { memcpy(out, v.p, v.n); out[v.n] = 0; }
}
/* uresbund.cpp getParentLocaleID (URES_OPEN_LOCALE_DEFAULT_ROOT) */
static bool parent_locale_id(char *name, const char *orig) {
  size_t n = strlen(name);
  Subtags s;
  split_subtags(name, &s);
  if (!n || name[n - 1] == '_' || s.variant) return chop_name(name);
  char k[96];
  snprintf(k, sizeof k, "parentloc/%s", name);
  ScrCoreVal pv = scr_core_get(k);
  if (pv.p && pv.n < 64) { memcpy(name, pv.p, pv.n); name[pv.n] = 0; return true; }
  char ds[8], work[96];
  work[0] = 0;
  if (s.script[0] && s.region[0]) {
    default_script(s.lang, s.region, ds);
    if (strcmp(ds, s.script) == 0) snprintf(work, sizeof work, "%s_%s", s.lang, s.region);
    else snprintf(work, sizeof work, "%s_%s", s.lang, s.script);
  } else if (s.region[0]) {
    Subtags o;
    split_subtags(orig, &o);
    if (o.script[0]) snprintf(work, sizeof work, "%s_%s", s.lang, o.script);
    else { default_script(s.lang, s.region, ds); snprintf(work, sizeof work, "%s_%s", s.lang, ds); }
  } else if (s.script[0]) {
    default_script(s.lang, NULL, ds);
    if (strcmp(ds, s.script) == 0) snprintf(work, sizeof work, "%s", s.lang);
    else return false;
  } else return false;
  if (!work[0]) return false;
  snprintf(name, 96, "%s", work);
  return true;
}
static int find_first_existing(int pkg, const char *req) {
  char name[96], orig[96];
  snprintf(orig, sizeof orig, "%s", req);
  snprintf(name, sizeof name, "%s", req);
  for (int guard = 0; guard < 16; guard++) {
    int idx = scr_ures_locale_find(name, strlen(name));
    if (has_block(pkg, idx)) return alias_target(pkg, idx);
    if (strcmp(name, "root") == 0) break;
    if (!parent_locale_id(name, orig)) break;
  }
  return G.root;
}
void scr_ures_open(const char *icuName, ScrUloc *u) {
  init();
  for (int p = 0; p < SCR_URES_NPKG; p++) u->start[p] = find_first_existing(p, icuName);
}

/* ── single-bundle access (ures_open / getByKey as the functional-equivalent search uses them) ──────────────── */
int scr_ures_bundle_exact(const char *name) {
  init();
  int idx = scr_ures_locale_find(name, strlen(name));
  return has_block(SCR_URES_LOC, idx) ? idx : -1;
}
int scr_ures_bundle_open(const char *name) { /* ures_open: the exact bundle, else the first existing one */
  init();
  if (!name[0]) return G.root;
  return find_first_existing(SCR_URES_LOC, name);
}
const char *scr_ures_bundle_name(int idx) { size_t n; static char buf[96]; const char *s = scr_ures_locale_name(idx, &n); snprintf(buf, sizeof buf, "%.*s", (int)(n < 95 ? n : 95), s); return buf; }
bool scr_ures_bundle_own(int idx, const char *path, ScrRes *out) {
  init();
  Blk *b = &G.blk[SCR_URES_LOC][idx];
  if (!b->data) return false;
  ScrRes root = {b->data, SCR_URES_LOC};
  char alias[64];
  return walk(SCR_URES_LOC, root, path, strlen(path), out, alias, sizeof alias);
}
bool scr_ures_bundle_get(int idx, const char *path, ScrRes *out) { init(); return get_depth(SCR_URES_LOC, idx, path, out, 0); }

ScrCoreVal scr_core_get(const char *key) {
  init();
  size_t kn = strlen(key);
  int lo = 0, hi = (int)G.ncore - 1;
  ScrCoreVal none = {NULL, 0};
  while (lo <= hi) {
    int mid = (lo + hi) / 2;
    size_t m = G.corekn[mid] < kn ? G.corekn[mid] : kn;
    int c = memcmp(G.corek[mid], key, m);
    if (c == 0) c = G.corekn[mid] < kn ? -1 : (G.corekn[mid] > kn ? 1 : 0);
    if (c == 0) { ScrCoreVal v = {(const char *)G.corev[mid], G.corevn[mid]}; return v; }
    if (c < 0) lo = mid + 1; else hi = mid - 1;
  }
  return none;
}
