/* ES Symbol values (scr_runtime.h has the API contract): a runtime-unique
 * identity value — the POINTER is the identity, so `Symbol('a') ===
 * Symbol('a')` is false and a symbol equals exactly itself, JS's spec
 * without approximation. A symbol owns at most a description string and
 * (for Symbol.for symbols) its registry key: pure immutable data, never
 * part of a cycle, no trace header.
 *
 * The Symbol.for registry is the spec's GlobalSymbolRegistry: one symbol
 * per key (byte equality), never evicted for the program's lifetime. The
 * chain is intrusive (reg_next) and holds one reference per entry; the
 * atexit cleanup releases the chain — registered at FIRST use, which is
 * always after scr_init registered the RC audit, so atexit's LIFO order
 * runs it before the audit and the audited string counts stay exact. */
#include "scr_runtime.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

struct ScrSym {
  size_t rc;
  ScrStr *desc;    /* owned; NULL = no description (Symbol()) */
  ScrStr *reg_key; /* owned; non-NULL exactly for Symbol.for symbols */
  struct ScrSym *reg_next; /* the registry's intrusive chain */
};

ScrSym *scr_sym_retain(ScrSym *s) {
  if (s->rc != SIZE_MAX) s->rc++;
  return s;
}

void scr_sym_release(ScrSym *s) {
  if (!s || s->rc == SIZE_MAX) return;
  if (--s->rc == 0) {
    scr_str_release(s->desc);
    scr_str_release(s->reg_key);
    free(s);
  }
}

void *scr_sym_retain_v(void *p) { return scr_sym_retain(p); }
void scr_sym_release_v(void *p) { scr_sym_release(p); }

ScrSym *scr_sym_new(ScrStr *desc) {
  ScrSym *s = malloc(sizeof(ScrSym));
  if (!s) {
    scr_trap("scriptc: out of memory\n");
  }
  s->rc = 1;
  s->desc = desc ? scr_str_retain(desc) : NULL;
  s->reg_key = NULL;
  s->reg_next = NULL;
  return s;
}

/* ── the Symbol.for global registry ──────────────────────────────────── */

static ScrSym *g_sym_registry = NULL;

static void scr_sym_registry_cleanup(void) {
  ScrSym *s = g_sym_registry;
  g_sym_registry = NULL;
  while (s) {
    ScrSym *next = s->reg_next;
    scr_sym_release(s);
    s = next;
  }
}

ScrSym *scr_sym_for(ScrStr *key) {
  for (ScrSym *s = g_sym_registry; s; s = s->reg_next) {
    if (scr_str_eq(s->reg_key, key)) return scr_sym_retain(s);
  }
  /* First request for this key: a fresh symbol whose description IS the
   * key (the spec's Symbol.for behavior), chained into the registry with
   * the registry's own reference. */
  if (!g_sym_registry) scr_atexit(scr_sym_registry_cleanup);
  ScrSym *s = scr_sym_new(key);
  s->reg_key = scr_str_retain(key);
  s->reg_next = g_sym_registry;
  g_sym_registry = scr_sym_retain(s);
  return s;
}

ScrStr *scr_sym_desc(ScrSym *s) { return s->desc ? scr_str_retain(s->desc) : NULL; }

ScrStr *scr_sym_key_for(ScrSym *s) { return s->reg_key ? scr_str_retain(s->reg_key) : NULL; }

ScrStr *scr_sym_to_string(ScrSym *s) {
  /* "Symbol(desc)" — Symbol.prototype.toString: an absent description
   * prints as the empty parenthesis pair ("Symbol()"), exactly Node
   * (Symbol() and Symbol(undefined) alike). */
  size_t dlen = s->desc ? s->desc->len : 0;
  size_t len = 7 + dlen + 1; /* "Symbol(" + desc + ")" */
  ScrStr *out = scr_str_alloc_raw(len, len);
  memcpy(out->data, "Symbol(", 7);
  if (dlen > 0) memcpy(out->data + 7, s->desc->data, dlen);
  out->data[7 + dlen] = ')';
  out->data[len] = '\0';
  out->len = (uint32_t)len;
  return out;
}

/* ── assert strict equality over symbols (lives here for the same reason
 * assert.match lives in scr_regex.c: it needs the symbol rendering, and
 * every call site carries symbol values, so the symbol link switch is
 * already on; the assert switch pulls scr_assert.c alongside) ─────────
 * strictEqual IS deepStrictEqual for symbols (a primitive under
 * SameValue): pointer identity — every scr_sym_new is a distinct
 * identity, Symbol.for interns per key. Failing messages are v24's
 * string-style forms over the "Symbol(desc)" rendering: symbols take the
 * stacked diff with the first-difference `^` indicator (the shared
 * "Symbol(" prefix keeps the indicator past the i >= 3 skip; equal
 * renderings of distinct symbols print the +/- pair with no indicator),
 * and never the 12-char short form ("Symbol()" twice is already 16). */
void scr_assert_eq_sym(ScrSym *a, ScrSym *b, bool negated, bool deep,
                       ScrStr *msg, bool has_msg) {
  bool same = a == b;
  if ((negated && !same) || (!negated && same)) return;
  ScrStr *ia = scr_sym_to_string(a);
  if (negated) {
    scr_assert_neq_fail(ia->data, ia->len, deep, msg, has_msg);
    scr_str_release(ia);
    return;
  }
  ScrStr *ib = scr_sym_to_string(b);
  scr_assert_eq_fail(ia->data, ia->len, ib->data, ib->len, 0, false, true, deep,
                     msg, has_msg);
  scr_str_release(ia);
  scr_str_release(ib);
}

/* ── the checked-dynamic Symbol handle (SCR_DYNH_SYMBOL) ─────────────────
 * A symbol crosses into the checked-dynamic tree BY REFERENCE: it is an
 * immutable identity value, so boxing is a retain and `===` through the box
 * is the pointer compare the static side already uses (the box compares by
 * HANDLE identity — one symbol boxed twice is one symbol, and Symbol.for
 * interns per key). Nothing is copied and nothing can alias.
 *
 * The MODELED surface is the part with an exact answer: `toString()`
 * ("Symbol(desc)"), `valueOf()` (the symbol itself) and `description`. The
 * conversions a symbol REFUSES in JS (`"" + s`, a template literal, Number(s))
 * are TypeErrors, and the dyn tree's own string/number coercion sites throw
 * the loud ladder for a handle that is not a plain object, so none of them
 * answers a wrong string. */
static ScrDyn *scr_sym_dynh_invoke(void *h, ScrDyn *self, const char *method,
                                   ScrDyn *const *args, size_t argc, const char *what) {
  ScrSym *s = (ScrSym *)h;
  (void)args;
  (void)argc;
  if (strcmp(method, "toString") == 0) {
    ScrStr *t = scr_sym_to_string(s); /* +1 */
    ScrDyn *d = scr_dyn_new_str(t);
    scr_str_release(t);
    return d;
  }
  if (strcmp(method, "valueOf") == 0) return scr_dyn_retain(self);
  char msg[160];
  const int n = snprintf(msg, sizeof msg, "%s is not a function", what);
  scr_throw_error_msg(SCR_ERR_TYPE, msg, (size_t)n);
  return NULL;
}

static ScrDyn *scr_sym_dynh_get(void *h, const char *key, size_t key_len) {
  (void)key_len;
  if (strcmp(key, "description") == 0) {
    ScrStr *d = scr_sym_desc((ScrSym *)h); /* +1, or NULL when absent */
    if (d == NULL) return NULL;             /* undefined — the caller answers it */
    ScrDyn *r = scr_dyn_new_str(d);
    scr_str_release(d);
    return r;
  }
  return NULL;
}

static bool scr_sym_dynh_set(void *h, const char *key, size_t key_len, const ScrDyn *value) {
  (void)h;
  (void)key;
  (void)key_len;
  (void)value;
  return false;
}

static const ScrDynHandleOps scr_sym_dynh_ops = {
  "Symbol",
  &scr_sym_retain_v,
  &scr_sym_release_v,
  &scr_sym_dynh_invoke,
  &scr_sym_dynh_get,
  &scr_sym_dynh_set,
  NULL, /* no pipe destination */
};

void scr_sym_dyn_install(void) {
  scr_dyn_handle_install(SCR_DYNH_SYMBOL, &scr_sym_dynh_ops);
}
