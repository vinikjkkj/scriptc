/* Own named properties of a bytes value (mysql2's MockBuffer writes a noop over every Buffer.prototype name of
 * one buffer). A separate unit so that programs without a dyn keyed write (no own table can exist) keep their
 * size class: scr_bytes.c reaches this only through scr_bytes_own_ops, which the program's install call sets.
 * The release of a value is scr_dyn_release_v (scr_json.c), which every program links. */
#include "scr_runtime.h"

#include <stdlib.h>
#include <string.h>

/* CanonicalNumericIndexString(name): "-0", or ToString(ToNumber(name)) === name. The string must first be a
 * StrDecimalLiteral (or Infinity / NaN) so ToNumber does not read hex, octal, or padding; then the number's
 * ToString (scr_num_to_str_radix, radix 10) must reproduce the spelling exactly. */
static bool scr_canonical_numeric_name(const ScrStr *k) {
  if (k->len == 2 && memcmp(k->data, "-0", 2) == 0) return true;
  if (k->len == 0 || k->len > 400) return false;
  char buf[402];
  memcpy(buf, k->data, k->len);
  buf[k->len] = '\0';
  if (strcmp(buf, "NaN") == 0 || strcmp(buf, "Infinity") == 0 || strcmp(buf, "-Infinity") == 0) return true;
  size_t i = 0;
  if (buf[i] == '+' || buf[i] == '-') i++;
  size_t digits = 0, frac = 0;
  while (buf[i] >= '0' && buf[i] <= '9') { i++; digits++; }
  if (buf[i] == '.') {
    i++;
    while (buf[i] >= '0' && buf[i] <= '9') { i++; frac++; }
  }
  if (digits + frac == 0) return false;
  if (buf[i] == 'e' || buf[i] == 'E') {
    i++;
    if (buf[i] == '+' || buf[i] == '-') i++;
    size_t ed = 0;
    while (buf[i] >= '0' && buf[i] <= '9') { i++; ed++; }
    if (ed == 0) return false;
  }
  if (buf[i] != '\0') return false;
  double d = strtod(buf, NULL);
  ScrStr *t = scr_num_to_str_radix(d, 10);
  bool same = t != NULL && t->len == k->len && memcmp(t->data, k->data, k->len) == 0;
  if (t != NULL) scr_str_release(t);
  return same;
}

/* CanonicalNumericIndexString(name) for the own write: "-0", or a name whose ToString(ToNumber(name)) is itself. */
static bool scr_canonical_numeric_name_own(const char *k, size_t kl) {
  ScrStr *s = scr_str_new(k, kl);
  bool r = scr_canonical_numeric_name(s);
  scr_str_release(s);
  return r;
}

/* ── own named properties (ScrBytesOwn) ─────────────────────────────── */

static ScrDyn *scr_bytes_own_get(const ScrBytes *b, const char *k, size_t kl) {
  if (b->own == NULL) return NULL;
  for (size_t i = 0; i < b->own->n; i++) {
    const ScrBytesOwnEnt *e = &b->own->ents[i];
    if (e->klen == kl && memcmp(e->key, k, kl) == 0) return e->val;
  }
  return NULL;
}

static void scr_bytes_own_set(ScrBytes *b, const char *k, size_t kl, ScrDyn *v) {
  /* CanonicalNumericIndexString names are integer-indexed exotic keys: the write is ignored. */
  if (scr_canonical_numeric_name_own(k, kl)) return;
  ScrDyn *nv = scr_dyn_retain(v);
  if (b->own == NULL) {
    b->own = calloc(1, sizeof(ScrBytesOwn));
    if (b->own == NULL) scr_trap("scriptc: out of memory\n");
  }
  ScrBytesOwn *t = b->own;
  for (size_t i = 0; i < t->n; i++) {
    ScrBytesOwnEnt *e = &t->ents[i];
    if (e->klen == kl && memcmp(e->key, k, kl) == 0) {
      ScrDyn *old = e->val;
      e->val = nv; /* after the retain: v may BE old */
      scr_dyn_release_v(old);
      return;
    }
  }
  if (t->n == t->cap) {
    size_t cap = t->cap ? t->cap * 2 : 4;
    ScrBytesOwnEnt *ne = realloc(t->ents, cap * sizeof(ScrBytesOwnEnt));
    if (ne == NULL) scr_trap("scriptc: out of memory\n");
    t->ents = ne;
    t->cap = cap;
  }
  ScrBytesOwnEnt *e = &t->ents[t->n++];
  e->key = malloc(kl + 1);
  if (e->key == NULL) scr_trap("scriptc: out of memory\n");
  memcpy(e->key, k, kl);
  e->key[kl] = '\0';
  e->klen = kl;
  e->val = nv;
}

static bool scr_bytes_own_delete(ScrBytes *b, const char *k, size_t kl) {
  if (b->own == NULL) return false;
  ScrBytesOwn *t = b->own;
  for (size_t i = 0; i < t->n; i++) {
    ScrBytesOwnEnt *e = &t->ents[i];
    if (e->klen != kl || memcmp(e->key, k, kl) != 0) continue;
    ScrDyn *old = e->val;
    free(e->key);
    memmove(&t->ents[i], &t->ents[i + 1], (t->n - i - 1) * sizeof(ScrBytesOwnEnt));
    t->n--;
    scr_dyn_release_v(old);
    return true;
  }
  return false;
}

static void scr_bytes_own_free(ScrBytes *b) {
  ScrBytesOwn *t = b->own;
  b->own = NULL;
  for (size_t i = 0; i < t->n; i++) {
    free(t->ents[i].key);
    scr_dyn_release_v(t->ents[i].val);
  }
  free(t->ents);
  free(t);
}

static const ScrBytesOwnOps scr_bytes_own_tbl = {
  scr_bytes_own_get,
  scr_bytes_own_set,
  scr_bytes_own_delete,
  scr_bytes_own_free,
};

void scr_bytes_own_install(void) { scr_bytes_own_ops = &scr_bytes_own_tbl; }
