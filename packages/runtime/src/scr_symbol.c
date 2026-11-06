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

static void scr_dsym_install_hooks(void);

struct ScrSym {
  size_t rc;
  ScrStr *desc;    /* owned; NULL = no description (Symbol()) */
  ScrStr *reg_key; /* owned; non-NULL exactly for Symbol.for symbols */
  ScrStr *site;    /* owned; the creation site ("file:offset") of a Symbol() call the program tagged, else NULL */
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
    scr_str_release(s->site);
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
  s->site = NULL;
  s->reg_next = NULL;
  return s;
}

/* `Symbol(desc)` whose creation site the compiler recorded: a boxed class instance's member table matches a symbol-keyed
 * member by this site, so two symbols that share a description stay two keys. */
ScrSym *scr_sym_new_tagged(ScrStr *desc, ScrStr *site) {
  ScrSym *s = scr_sym_new(desc);
  s->site = scr_str_retain(site);
  return s;
}
ScrSym *scr_sym_new_anon_tagged(ScrStr *site) { return scr_sym_new_tagged(NULL, site); }
const ScrStr *scr_sym_site(const ScrSym *s) { return s->site; }

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
  scr_dsym_install_hooks();
}

/* ── symbol-keyed properties on dyn receivers ────────────────────────────
 * The checked-dynamic object model is string-keyed (an OBJ's entries are
 * byte-string names; two distinct symbols may share a description, so a
 * description-spelled key would alias them). A symbol-keyed own property
 * therefore lives in a SECOND table on the receiver's ext (ScrDynSymTab,
 * scr_runtime.h): (retained symbol, owned value, attributes) rows in creation
 * order. That order IS the spec's: OrdinaryOwnPropertyKeys lists strings
 * first and symbols after, each in creation order, and the two tables are
 * separate. An object that never stored a symbol property has no table, so
 * the string-keyed hot paths neither read nor allocate anything for it.
 *
 * LIFETIME. Values are traced by the cycle collector (scr_json.c's OBJ and ARR
 * trace visit them), so the webidl2js shape -- wrapper[implSymbol] = impl,
 * impl[wrapperSymbol] = wrapper -- is an ordinary reference cycle the
 * collector reclaims, exactly like any string-keyed cycle. The symbol keys
 * are refcounted leaves (a symbol owns only strings) and never part of one.
 *
 * Strict-mode semantics throughout (this runtime never does the quiet
 * sloppy answer): writing a non-writable property or deleting a
 * non-configurable one throws V8's TypeError text. */

static void scr_sym_key_release_hook(ScrSym *k) { scr_sym_release(k); }
static void scr_dsym_copy_enum(ScrDyn *target, const ScrDyn *src);
static ScrDyn *scr_dsym_row_value(const ScrDyn *self, const ScrDynSymEnt *row);
static bool scr_dsym_proto_test(int op, ScrDyn *recv, ScrSym *k);

/* Installed by the emitted main exactly when this unit links, so the always-linked core and the gated units that cannot
 * name it (inspect, assert, the dyn invoke dispatch) reach it through these. */
static void scr_dsym_free_table(ScrDynSymTab *t, bool release);
static void scr_dsym_trace_table(const ScrDynSymTab *t, ScrTraceVisit visit, void *ctx);

/* ── Map / Set receivers ───────────────────────────────────────────────────────────────────────────────────────
 * A ScrMap has no object slots, so a symbol-keyed expando on it (`m[sym] = v`, JS allows it on any object) keeps its
 * table in a side table keyed by the ScrMap's identity: every dyn box of the same map shares the pointer, so every box
 * sees one table. The map's has_symx byte (in struct padding) tells its teardown to drop the entry; a map that never
 * carried a symbol pays that one byte test and links none of this. The values are traced through scr_map_trace, so a
 * cycle through a map whose values are cycle-capable is collected like an object's. */
typedef struct { ScrMap *m; ScrDynObjExt *x; } ScrDsymMapRow;
static ScrDsymMapRow *scr_dsym_maps; /* open addressing, linear probe, backward-shift delete */
static size_t scr_dsym_maps_cap, scr_dsym_maps_len;

static size_t scr_dsym_map_slot(const ScrMap *m) { return ((uintptr_t)m >> 4) * 11400714819323198485ull; }

static ScrDsymMapRow *scr_dsym_map_find(const ScrMap *m) {
  if (scr_dsym_maps_len == 0) return NULL;
  for (size_t i = scr_dsym_map_slot(m) & (scr_dsym_maps_cap - 1);; i = (i + 1) & (scr_dsym_maps_cap - 1)) {
    if (scr_dsym_maps[i].m == m) return &scr_dsym_maps[i];
    if (scr_dsym_maps[i].m == NULL) return NULL;
  }
}

static void scr_dsym_map_put(ScrMap *m, ScrDynObjExt *x) {
  size_t i = scr_dsym_map_slot(m) & (scr_dsym_maps_cap - 1);
  while (scr_dsym_maps[i].m != NULL) i = (i + 1) & (scr_dsym_maps_cap - 1);
  scr_dsym_maps[i].m = m;
  scr_dsym_maps[i].x = x;
}

static ScrDynObjExt *scr_dsym_map_host(ScrMap *m, bool create) {
  ScrDsymMapRow *r = scr_dsym_map_find(m);
  if (r != NULL) return r->x;
  if (!create) return NULL;
  if ((scr_dsym_maps_len + 1) * 2 > scr_dsym_maps_cap) {
    ScrDsymMapRow *old = scr_dsym_maps;
    const size_t ocap = scr_dsym_maps_cap;
    scr_dsym_maps_cap = ocap == 0 ? 16 : ocap * 2;
    scr_dsym_maps = (ScrDsymMapRow *)calloc(scr_dsym_maps_cap, sizeof *scr_dsym_maps);
    if (scr_dsym_maps == NULL) scr_trap("scriptc: out of memory\n");
    for (size_t i = 0; i < ocap; i++)
      if (old[i].m != NULL) scr_dsym_map_put(old[i].m, old[i].x);
    free(old);
  }
  ScrDynObjExt *x = (ScrDynObjExt *)calloc(1, sizeof *x);
  if (x == NULL) scr_trap("scriptc: out of memory\n");
  scr_dsym_map_put(m, x);
  scr_dsym_maps_len++;
  m->has_symx = 1;
  return x;
}

static void scr_dsym_map_drop(ScrMap *m, bool release) {
  ScrDsymMapRow *r = scr_dsym_map_find(m);
  if (r == NULL) return;
  ScrDynObjExt *x = r->x;
  /* backward-shift the cluster over the hole */
  size_t mask = scr_dsym_maps_cap - 1, i = (size_t)(r - scr_dsym_maps), j = i;
  for (;;) {
    j = (j + 1) & mask;
    if (scr_dsym_maps[j].m == NULL) break;
    const size_t home = scr_dsym_map_slot(scr_dsym_maps[j].m) & mask;
    if (((j - home) & mask) >= ((j - i) & mask)) {
      scr_dsym_maps[i] = scr_dsym_maps[j];
      i = j;
    }
  }
  scr_dsym_maps[i].m = NULL;
  scr_dsym_maps[i].x = NULL;
  scr_dsym_maps_len--;
  m->has_symx = 0;
  if (x->syms != NULL) scr_dsym_free_table(x->syms, release);
  free(x);
}

static void scr_dsym_map_trace(ScrMap *m, ScrTraceVisit visit, void *ctx) {
  ScrDsymMapRow *r = scr_dsym_map_find(m);
  if (r != NULL && r->x->syms != NULL) scr_dsym_trace_table(r->x->syms, visit, ctx);
}

static const ScrDynSymTab *scr_dsym_map_table(const ScrMap *m) {
  ScrDsymMapRow *r = scr_dsym_map_find(m);
  return r == NULL ? NULL : r->x->syms;
}

static void scr_dsym_install_hooks(void) {
  scr_map_symx_table_hook = &scr_dsym_map_table;
  scr_map_symx_drop = &scr_dsym_map_drop;
  scr_map_symx_trace = &scr_dsym_map_trace;
  scr_dyn_sym_free_table = &scr_dsym_free_table;
  scr_dyn_sym_trace_table = &scr_dsym_trace_table;
  scr_dyn_sym_key_release = &scr_sym_key_release_hook;
  scr_dyn_sym_key_str = &scr_sym_to_string;
  scr_dyn_sym_copy_enum = &scr_dsym_copy_enum;
  scr_dyn_sym_row_value = &scr_dsym_row_value;
  scr_dyn_sym_proto_test = &scr_dsym_proto_test;
}

/* "Symbol(desc)" as a C string in `buf` (truncated, which only shortens a diagnostic). */
static void scr_dsym_name(ScrSym *k, char *buf, size_t cap) {
  ScrStr *s = scr_sym_to_string(k);
  size_t n = s->len < cap - 1 ? s->len : cap - 1;
  memcpy(buf, s->data, n);
  buf[n] = '\0';
  scr_str_release(s);
}

/* V8's rendering of a receiver in these messages: a null-prototype object is "[object Object]", an array "[object Array]",
 * any other object "#<Ctor>" (an instance of a program class: its class name). */
static void scr_dsym_recv_text(const ScrDyn *r, char *buf, size_t cap) {
  if (r->kind == SCR_DYN_ARR) snprintf(buf, cap, "[object Array]");
  else if (r->kind == SCR_DYN_OBJ && r->null_proto) snprintf(buf, cap, "[object Object]");
  else if (r->kind == SCR_DYN_OBJ) snprintf(buf, cap, "#<%s>", scr_dyn_ext(r)->cname != NULL ? scr_dyn_ext(r)->cname : "Object");
  else if (r->kind == SCR_DYN_OBJINST) snprintf(buf, cap, "#<%s>", scr_dyn_objinst_cls(r));
  else snprintf(buf, cap, "#<Object>");
}

/* TypeError text: pre + "Symbol(desc)" + post. */
static void scr_dsym_throw(const char *pre, ScrSym *k, const char *post) {
  char name[192], msg[640];
  scr_dsym_name(k, name, sizeof name);
  const int n = snprintf(msg, sizeof msg, "%s%s%s", pre, name, post);
  scr_throw_error_msg(SCR_ERR_TYPE, msg, (size_t)(n < 0 ? 0 : n >= (int)sizeof msg ? (int)sizeof msg - 1 : n));
}

static const char *scr_dsym_kind(const ScrDyn *d) {
  return d == NULL ? "undefined" : d->kind == SCR_DYN_NULL ? "null" : "undefined";
}

static void scr_dsym_fence(const ScrDyn *recv, const char *what) {
  char msg[320];
  const int n = snprintf(msg, sizeof msg,
                         "%s a symbol-keyed property on a dynamic %s value is not supported yet", what,
                         scr_dyn_kind_name(recv));
  scr_throw_error_msg(SCR_ERR_ERROR, msg, (size_t)(n < 0 ? 0 : n >= (int)sizeof msg ? (int)sizeof msg - 1 : n));
}

static bool scr_dsym_nullish(const ScrDyn *d) {
  return d == NULL || d->kind == SCR_DYN_UNDEF || d->kind == SCR_DYN_NULL;
}

/* V8's receiver rendering after the key: `quoted` -> "<kind> '<text>'" (create-property: "on number '5'"), else the bare text
 * ("in 3", "in abc"; undefined / null by name). */
static void scr_dsym_prim_tail(char *out, size_t cap, const char *lead, const ScrDyn *d, bool quoted) {
  if (scr_dsym_nullish(d)) {
    snprintf(out, cap, "%s%s", lead, scr_dsym_kind(d));
    return;
  }
  ScrStr *t = scr_dyn_to_string(d, NULL); /* a primitive's own rendering */
  const int n = quoted ? snprintf(out, cap, "%s%s '%.*s'", lead, scr_dyn_kind_name(d), (int)t->len, t->data)
                       : snprintf(out, cap, "%s%.*s", lead, (int)t->len, t->data);
  (void)n;
  scr_str_release(t);
}

#define SCR_ANY_SYM(k) ((ScrSym *)(k)->v.handle.ptr)
static inline bool scr_any_is_sym(const ScrDyn *k) { return k->kind == SCR_DYN_HANDLE && k->v.handle.tag == SCR_DYNH_SYMBOL; }

/* A Proxy receiver. The handler's trap for the operation runs with the symbol itself as its property argument (a dyn
 * Symbol handle, the same value `typeof k === 'symbol'` sees inside the trap); a handler with no such trap lets the
 * operation fall through to the TARGET. A revoked proxy throws V8's TypeError (scr_dyn_proxy_trap). */
static ScrDyn *scr_dsym_px_run(ScrDyn *p, const char *name, ScrDyn *const *args, size_t n, bool *ran) {
  bool threw;
  ScrDyn *trap = scr_dyn_proxy_ops_ptr->trap(p, name, &threw);
  *ran = threw || trap != NULL;
  if (trap == NULL) return NULL; /* none (fall through) or the exception pending */
  scr_dyn_this_push_dyn(p->v.proxy.handler);
  ScrDyn *r = scr_dyn_call(trap, args, n, name);
  scr_dyn_this_pop();
  scr_dyn_release(trap);
  return r;
}

/* The symbol as the dyn value a trap receives (+1). */
static ScrDyn *scr_dsym_keydyn(ScrSym *k) { return scr_dyn_new_handle(k, SCR_DYNH_SYMBOL); }

/* TypeError "'<trap>' on proxy: trap returned falsish for property 'Symbol(d)'". */
static void scr_dsym_px_falsish(const char *trap, ScrSym *k) {
  char name[192], msg[320];
  scr_dsym_name(k, name, sizeof name);
  const int n = snprintf(msg, sizeof msg, "'%s' on proxy: trap returned falsish for property '%s'", trap, name);
  scr_throw_error_msg(SCR_ERR_TYPE, msg, (size_t)(n < 0 ? 0 : n >= (int)sizeof msg ? (int)sizeof msg - 1 : n));
}

/* How a receiver kind answers a symbol-keyed READ.
 *   STORE   an OBJ / ARR / FUNC: its own table, then (OBJ) the prototype chain.
 *   ABSENT  a kind with no symbol storage whose user-symbol answer is exactly "absent" (a primitive, bytes, a map,
 *           a promise, a native handle): no symbol property can have been stored on it (a store fences below).
 *   INST    a boxed program-class instance: its class member table names a symbol-keyed field "Symbol(desc)".
 *   FENCE   an engine value or a proxy: a symbol property may live there, and the answer is not ours to give. */
typedef enum { SCR_DSYM_STORE, SCR_DSYM_ABSENT, SCR_DSYM_INST, SCR_DSYM_FENCE } ScrDsymClass;

static ScrDsymClass scr_dsym_class(const ScrDyn *d) {
  switch (d->kind) {
  case SCR_DYN_OBJ:
  case SCR_DYN_ARR:
  case SCR_DYN_FUNC:
  case SCR_DYN_BYTES:
  case SCR_DYN_MAP:
    return SCR_DSYM_STORE;
  case SCR_DYN_OBJINST:
    return SCR_DSYM_INST;
  case SCR_DYN_JSVAL:
  case SCR_DYN_PROXY:
    return SCR_DSYM_FENCE;
  default:
    return SCR_DSYM_ABSENT;
  }
}

/* The class member of `k` on a boxed instance, or NULL. The class lowering names the members it keeps for a symbol key by
 * the key's compile-time identity: a field is "Symbol(desc)", a method or accessor keyed by a module symbol is
 * "sym.uniq:Symbol(desc)", and one keyed by a Symbol.for symbol is "sym.for:<registry key>". */
static const ScrDynClassMember *scr_dsym_inst_row(const ScrDyn *d, const char *prefix, size_t plen, const char *body, size_t blen) {
  char *nm = (char *)malloc(plen + blen + 1);
  if (nm == NULL) scr_trap("scriptc: out of memory\n");
  memcpy(nm, prefix, plen);
  memcpy(nm + plen, body, blen);
  const ScrDynClassMember *m = scr_dyn_objinst_member(d, nm, plen + blen);
  free(nm);
  return m;
}

/* A module symbol's member row names the creation site of its key in a companion `%symid:<row>` member; the symbol carries the
 * site of the Symbol() call that made it. They must be the same one: two symbols that share a description are two keys. A symbol
 * with no site (made by engine code) or a row with no companion matches nothing: the build refuses a class member whose key it
 * cannot trace, so the second cannot arise in a program that reads symbols off untyped values. */
static bool scr_dsym_site_ok(const ScrDyn *d, const ScrDynClassMember *m, ScrSym *k) {
  if (m == NULL) return false;
  const ScrStr *ks = scr_sym_site(k);
  if (ks == NULL) return false; /* a symbol the program did not make from a traced Symbol() call is no class member's key */
  const ScrDynClassMember *cm = scr_dsym_inst_row(d, "%symid:", 7, m->name, m->len);
  if (cm == NULL || cm->call == NULL) return false;
  ScrDyn *r = cm->call(d->v.inst.o, NULL, 0, "a symbol-keyed member");
  if (r == NULL) return false;
  const bool same = r->kind == SCR_DYN_STR && scr_str_eq(r->v.str, ks);
  scr_dyn_release(r);
  return same;
}

static const ScrDynClassMember *scr_dsym_inst_member(const ScrDyn *d, ScrSym *k) {
  const ScrDynClassMember *m = NULL;
  ScrStr *rk = scr_sym_key_for(k); /* +1 or NULL */
  if (rk != NULL) {
    m = scr_dsym_inst_row(d, "sym.for:", 8, rk->data, rk->len);
    scr_str_release(rk);
    return m;
  }
  ScrStr *n = scr_sym_to_string(k);
  /* a field is spelled "Symbol(desc)", a method or accessor "sym.uniq:Symbol(desc)": each candidate must pass the site test */
  m = scr_dyn_objinst_member(d, n->data, n->len);
  if (m != NULL && !scr_dsym_site_ok(d, m, k)) m = NULL;
  if (m == NULL) {
    m = scr_dsym_inst_row(d, "sym.uniq:", 9, n->data, n->len);
    if (m != NULL && !scr_dsym_site_ok(d, m, k)) m = NULL;
  }
  scr_str_release(n);
  return m;
}

/* A miss on a boxed instance is "absent" only when its class names every member it has. */
static bool scr_dsym_inst_complete(const ScrDyn *d) { return !scr_dyn_objinst_class_of(d)->opaque; }

/* The run-time property table (%props) of a boxed instance, which hosts its symbol-keyed own properties: the OBJ bag
 * (+1), or NULL. `ensure` asks the class's synthesized %dynBag member to create it; a class with no table answers NULL
 * either way. */
static ScrDyn *scr_dsym_inst_bag(const ScrDyn *d, bool ensure) {
  if (scr_dyn_objinst_error_rooted(d)) {
    /* an Error subclass keeps its expando properties in the runtime's own bag (ScrError.props); the symbol table rides its ext */
    ScrError *e = (ScrError *)d->v.inst.o;
    if (e->props == NULL || e->props->kind == SCR_DYN_UNDEF) { /* an Error subclass's %props starts as the undefined value */
      if (!ensure) return NULL;
      ScrDyn *old = e->props;
      e->props = scr_dyn_new_obj();
      scr_dyn_release(old);
    }
    return e->props->kind == SCR_DYN_OBJ ? scr_dyn_retain(e->props) : NULL;
  }
  const ScrDynClassMember *m = scr_dyn_objinst_member(d, "%props", 6);
  if (m == NULL || m->get == NULL) return NULL;
  ScrDyn *b = m->get(d->v.inst.o); /* +1 */
  if (b != NULL && b->kind == SCR_DYN_OBJ) return b;
  scr_dyn_release(b);
  if (!ensure) return NULL;
  const ScrDynClassMember *ds = scr_dyn_objinst_member(d, "%dynBag", 7);
  if (ds == NULL || ds->call == NULL) return NULL;
  ScrDyn *r = ds->call(d->v.inst.o, NULL, 0, "a symbol-keyed property");
  if (r != NULL && r->kind == SCR_DYN_OBJ) return r;
  scr_dyn_release(r);
  return NULL;
}

/* The ext that holds a receiver's symbol table: an OBJ's or ARR's own, a FUNC's through the table that hangs off its
 * closure. NULL = the kind has no symbol storage. `create` makes the ext (and a FUNC's table) on demand; without it a
 * receiver that never stored one answers NULL ext via *none. */
static ScrDynObjExt *scr_dsym_host(ScrDyn *recv, bool create, bool *none) {
  *none = false;
  if (recv->kind == SCR_DYN_OBJ || recv->kind == SCR_DYN_ARR) {
    if (recv->v.obj.ext == NULL) {
      if (!create) {
        *none = true;
        return NULL;
      }
      return scr_dyn_ext_w(recv);
    }
    return recv->v.obj.ext;
  }
  if (recv->kind == SCR_DYN_MAP) {
    ScrDynObjExt *x = scr_dsym_map_host(recv->v.map.m, create);
    if (x == NULL) *none = true;
    return x;
  }
  if (recv->kind == SCR_DYN_BYTES) {
    /* a typed array / Buffer / DataView: the table rides its own-property block, shared by every box of the value */
    ScrBytes *b = recv->v.bytes;
    if (b->own == NULL) {
      if (!create) {
        *none = true;
        return NULL;
      }
      if (scr_bytes_own_ops == NULL) return NULL; /* the own-property unit is linked by every sym write; a read of a never-written value is "none" */
      b->own = (struct ScrBytesOwn *)calloc(1, sizeof(ScrBytesOwn));
      if (b->own == NULL) scr_trap("scriptc: out of memory\n");
    }
    return &b->own->ext;
  }
  if (recv->kind == SCR_DYN_FUNC) {
    if (!create && recv->v.fn.clo->props == NULL) {
      *none = true;
      return NULL;
    }
    ScrDyn *table = scr_dyn_fn_props(recv); /* +1; the closure keeps the table alive */
    scr_dyn_release(table);
    return table->v.obj.ext != NULL ? table->v.obj.ext : (create ? scr_dyn_ext_w(table) : NULL);
  }
  return NULL;
}

static ScrDynSymEnt *scr_dsym_find(const ScrDynObjExt *x, const ScrSym *k) {
  if (x == NULL || x->syms == NULL) return NULL;
  ScrDynSymTab *t = x->syms;
  for (uint32_t i = 0; i < t->len; i++)
    if (t->e[i].key == k) return &t->e[i];
  return NULL;
}

/* Appends a row (the key is retained, the value MOVED in). */
static ScrDynSymEnt *scr_dsym_add(ScrDynObjExt *x, ScrSym *k, ScrDyn *v, uint32_t flags) {
  if (scr_dyn_sym_key_release == NULL) scr_dsym_install_hooks();
  if (x->syms == NULL) {
    x->syms = (ScrDynSymTab *)calloc(1, sizeof *x->syms);
    if (x->syms == NULL) scr_trap("scriptc: out of memory\n");
  }
  ScrDynSymTab *t = x->syms;
  if (t->len == t->cap) {
    uint32_t cap = t->cap == 0 ? 2 : t->cap * 2;
    ScrDynSymEnt *ne = (ScrDynSymEnt *)realloc(t->e, cap * sizeof *ne);
    if (ne == NULL) scr_trap("scriptc: out of memory\n");
    t->e = ne;
    t->cap = cap;
  }
  ScrDynSymEnt *r = &t->e[t->len++];
  r->key = scr_sym_retain(k);
  r->val = v;
  r->flags = flags;
  return r;
}

/* The row of `k` on `recv` itself, or NULL. A FUNC with no closure table and an OBJ/ARR with no ext answer NULL
 * without allocating. */
static ScrDynSymEnt *scr_dsym_own(ScrDyn *recv, ScrSym *k) {
  bool none;
  ScrDynObjExt *x = scr_dsym_host(recv, false, &none);
  return scr_dsym_find(x, k);
}

/* A row's [[Get]] value (+1, or NULL with the getter's exception pending): the data value, or an accessor's getter run with
 * `this` bound to `self`. A missing getter reads undefined. */
static ScrDyn *scr_dsym_row_value(const ScrDyn *self, const ScrDynSymEnt *row) {
  if (!(row->flags & SCR_SYMP_ACC)) return scr_dyn_retain(row->val);
  ScrDyn *g = row->val->v.arr.items[0];
  if (g->kind != SCR_DYN_FUNC) return scr_dyn_retain(scr_dyn_undefined());
  scr_dyn_this_push_dyn(self);
  ScrDyn *r = scr_dyn_call(g, NULL, 0, "getter");
  scr_dyn_this_pop();
  return r;
}

/* An engine value (SCR_DYN_JSVAL): the symbol-keyed operation runs in the engine on THE engine symbol of the runtime symbol's
 * identity (scr_island.c). +1 result, or NULL with the exception pending. */
static ScrDyn *scr_dsym_engine(ScrDyn *recv, ScrJsvSymOp op, ScrSym *k, const ScrDyn *arg) {
  return scr_dyn_jsval_ops()->sym_op(recv->v.jsval.cell, (int)op, k, arg);
}
static bool scr_dsym_engine_bool(ScrDyn *recv, ScrJsvSymOp op, ScrSym *k) {
  ScrDyn *r = scr_dsym_engine(recv, op, k, NULL);
  if (r == NULL) return false;
  const bool b = r->kind == SCR_DYN_BOOL && r->v.b;
  scr_dyn_release(r);
  return b;
}

static ScrDyn *scr_dsym_get(ScrDyn *recv, ScrSym *k, ScrDyn *self) {
  if (recv != NULL && recv->kind == SCR_DYN_JSVAL) return scr_dsym_engine(recv, SCR_JSV_SYM_GET, k, NULL);
  if (recv != NULL && recv->kind == SCR_DYN_PROXY) {
    ScrDyn *kd = scr_dsym_keydyn(k);
    ScrDyn *args[3] = {recv->v.proxy.target, kd, recv};
    bool ran;
    ScrDyn *r = scr_dsym_px_run(recv, "get", args, 3, &ran);
    scr_dyn_release(kd);
    if (ran) return r;
    return scr_dsym_get(recv->v.proxy.target, k, recv->v.proxy.target);
  }
  if (scr_dsym_nullish(recv)) {
    { char pre[64]; snprintf(pre, sizeof pre, "Cannot read properties of %s (reading '", scr_dsym_kind(recv)); scr_dsym_throw(pre, k, "')"); }
    return NULL;
  }
  switch (scr_dsym_class(recv)) {
  case SCR_DSYM_STORE:
    for (ScrDyn *o = recv; o != NULL;) {
      ScrDynSymEnt *r = scr_dsym_own(o, k);
      if (r != NULL) return scr_dsym_row_value(self, r);
      if (o->kind != SCR_DYN_OBJ) break;
      o = scr_dyn_ext(o)->proto;
    }
    break;
  case SCR_DSYM_INST: {
    const ScrDynClassMember *m = scr_dsym_inst_member(recv, k);
    if (m != NULL && m->get != NULL) return m->get(recv->v.inst.o);
    if (m != NULL && m->value != NULL) return scr_dyn_member_value(recv, m);
    if (m != NULL) {
      scr_dsym_fence(recv, "reading"); /* a method row with no function value */
      return NULL;
    }
    ScrDyn *bag = scr_dsym_inst_bag(recv, false);
    if (bag != NULL) {
      ScrDynSymEnt *r = scr_dsym_own(bag, k);
      ScrDyn *out = r != NULL ? scr_dsym_row_value(self, r) : NULL;
      const bool threw = r != NULL && out == NULL;
      scr_dyn_release(bag);
      if (out != NULL || threw) return out;
    }
    if (!scr_dsym_inst_complete(recv)) {
      scr_dsym_fence(recv, "reading"); /* a class that does not name all its members */
      return NULL;
    }
    break;
  }
  case SCR_DSYM_FENCE:
    scr_dsym_fence(recv, "reading");
    return NULL;
  case SCR_DSYM_ABSENT:
    break;
  }
  return scr_dyn_retain(scr_dyn_undefined());
}

/* [[Set]] reached an accessor row: the setter runs with `this` bound to the receiver; a getter-only accessor is V8's
 * strict-mode TypeError (quiet in a sloppy file). */
static void scr_dsym_run_setter(const ScrDynSymEnt *row, ScrSym *k, ScrDyn *v, bool strict, ScrDyn *self) {
  ScrDyn *st = row->val->v.arr.items[1];
  if (st->kind != SCR_DYN_FUNC) {
    if (strict) {
      char name[192], msg[640];
      scr_dsym_name(k, name, sizeof name);
      char rt[96];
      scr_dsym_recv_text(self, rt, sizeof rt);
      const int n = snprintf(msg, sizeof msg, "Cannot set property %s of %s which has only a getter", name, rt);
      scr_throw_error_msg(SCR_ERR_TYPE, msg, (size_t)(n < 0 ? 0 : n >= (int)sizeof msg ? (int)sizeof msg - 1 : n));
    }
    return;
  }
  ScrDyn *args[1] = {v};
  scr_dyn_this_push_dyn(self);
  ScrDyn *r = scr_dyn_call(st, args, 1, "setter");
  scr_dyn_this_pop();
  scr_dyn_release(r);
}

static void scr_dsym_read_only(ScrSym *k, const ScrDyn *self) {
  char rt[96], post[128];
  scr_dsym_recv_text(self, rt, sizeof rt);
  snprintf(post, sizeof post, "' of object '%s'", rt);
  scr_dsym_throw("Cannot assign to read only property '", k, post);
}

static void scr_dsym_set(ScrDyn *recv, ScrSym *k, ScrDyn *v, bool strict, ScrDyn *self) {
  if (recv != NULL && recv->kind == SCR_DYN_JSVAL) {
    ScrDyn *r = scr_dsym_engine(recv, SCR_JSV_SYM_SET, k, v);
    scr_dyn_release(r);
    return;
  }
  if (recv != NULL && recv->kind == SCR_DYN_PROXY) {
    ScrDyn *kd = scr_dsym_keydyn(k);
    ScrDyn *args[4] = {recv->v.proxy.target, kd, v, recv};
    bool ran;
    ScrDyn *r = scr_dsym_px_run(recv, "set", args, 4, &ran);
    scr_dyn_release(kd);
    if (!ran) {
      scr_dsym_set(recv->v.proxy.target, k, v, strict, recv->v.proxy.target);
      return;
    }
    if (r == NULL) return;
    const bool ok = scr_dyn_truthy(r);
    scr_dyn_release(r);
    if (!ok && strict) scr_dsym_px_falsish("set", k);
    return;
  }
  if (scr_dsym_nullish(recv)) {
    { char pre[64]; snprintf(pre, sizeof pre, "Cannot set properties of %s (setting '", scr_dsym_kind(recv)); scr_dsym_throw(pre, k, "')"); }
    return;
  }
  if (recv->static_copy) {
    scr_dyn_static_copy_refuse("assigning a property");
    return;
  }
  if (recv->kind == SCR_DYN_OBJINST) {
    ScrDyn *bag = scr_dsym_inst_member(recv, k) == NULL ? scr_dsym_inst_bag(recv, true) : NULL;
    if (bag == NULL) {
      scr_dsym_fence(recv, "writing"); /* a class member keyed by the symbol, or a class with no property table */
      return;
    }
    scr_dsym_set(bag, k, v, strict, recv);
    scr_dyn_release(bag);
    return;
  }
  if (scr_dsym_class(recv) != SCR_DSYM_STORE) {
    if (recv->kind == SCR_DYN_STR || recv->kind == SCR_DYN_NUM || recv->kind == SCR_DYN_BOOL ||
        recv->kind == SCR_DYN_BIG || (recv->kind == SCR_DYN_HANDLE && recv->v.handle.tag == SCR_DYNH_SYMBOL)) {
      if (!strict) return; /* sloppy: the write to a primitive is dropped */
      { char post[192]; scr_dsym_prim_tail(post, sizeof post, "' on ", recv, true); scr_dsym_throw("Cannot create property '", k, post); }
      return;
    }
    scr_dsym_fence(recv, "writing");
    return;
  }
  bool none;
  ScrDynSymEnt *r = scr_dsym_find(scr_dsym_host(recv, false, &none), k);
  if (r != NULL && (r->flags & SCR_SYMP_ACC)) {
    scr_dsym_run_setter(r, k, v, strict, self);
    return;
  }
  if (r != NULL) {
    if (!(r->flags & SCR_SYMP_WRITE)) {
      if (strict) scr_dsym_read_only(k, self);
      return;
    }
    ScrDyn *old = r->val;
    r->val = scr_dyn_retain(v);
    scr_dyn_release(old); /* after the retain: v may BE old */
    return;
  }
  /* a symbol property on the prototype chain that is read-only blocks the write; a plain inherited one is shadowed */
  if (recv->kind == SCR_DYN_OBJ) {
    for (ScrDyn *o = scr_dyn_ext(recv)->proto; o != NULL && o->kind == SCR_DYN_OBJ; o = scr_dyn_ext(o)->proto) {
      ScrDynSymEnt *p = scr_dsym_own(o, k);
      if (p != NULL && (p->flags & SCR_SYMP_ACC)) {
        scr_dsym_run_setter(p, k, v, strict, self); /* an inherited accessor takes the write, `this` the receiver */
        return;
      }
      if (p != NULL) {
        if (!(p->flags & SCR_SYMP_WRITE)) {
          if (strict) scr_dsym_read_only(k, self);
          return;
        }
        break;
      }
    }
  }
  ScrDynObjExt *x = scr_dsym_host(recv, true, &none);
  if (x == NULL) {
    scr_dsym_fence(recv, "writing");
    return;
  }
  scr_dsym_add(x, k, scr_dyn_retain(v), SCR_SYMP_ENUM | SCR_SYMP_WRITE | SCR_SYMP_CONFIG);
}

ScrDyn *scr_dyn_sym_get(ScrDyn *recv, ScrSym *k) { return scr_dsym_get(recv, k, recv); }
ScrDyn *scr_dyn_sym_get_opt(ScrDyn *recv, ScrSym *k) {
  if (scr_dsym_nullish(recv)) return scr_dyn_retain(scr_dyn_undefined());
  return scr_dsym_get(recv, k, recv);
}
ScrDyn *scr_dyn_sym_get_self(ScrDyn *recv, ScrSym *k, ScrDyn *self) { return scr_dsym_get(recv, k, self); }
void scr_dyn_sym_set_self(ScrDyn *recv, ScrSym *k, ScrDyn *v, ScrDyn *self) { scr_dsym_set(recv, k, v, true, self); }
void scr_dyn_sym_set_self_sloppy(ScrDyn *recv, ScrSym *k, ScrDyn *v, ScrDyn *self) { scr_dsym_set(recv, k, v, false, self); }
/* Does the table on `recv` hold an accessor row? (A class instance's bag: the lowering boxes the instance as `this` only then.) */
bool scr_dyn_sym_has_acc(ScrDyn *recv) {
  bool none;
  ScrDynObjExt *x = (recv != NULL && scr_dsym_class(recv) == SCR_DSYM_STORE) ? scr_dsym_host(recv, false, &none) : NULL;
  for (uint32_t i = 0; x != NULL && x->syms != NULL && i < x->syms->len; i++)
    if (x->syms->e[i].flags & SCR_SYMP_ACC) return true;
  return false;
}
void scr_dyn_sym_set(ScrDyn *recv, ScrSym *k, ScrDyn *v) { scr_dsym_set(recv, k, v, true, recv); }
void scr_dyn_sym_set_sloppy(ScrDyn *recv, ScrSym *k, ScrDyn *v) { scr_dsym_set(recv, k, v, false, recv); }

bool scr_dyn_sym_has_own(ScrDyn *recv, ScrSym *k) {
  if (recv != NULL && recv->kind == SCR_DYN_JSVAL) return scr_dsym_engine_bool(recv, SCR_JSV_SYM_HAS_OWN, k);
  if (recv != NULL && recv->kind == SCR_DYN_PROXY) {
    ScrDyn *kd = scr_dsym_keydyn(k);
    ScrDyn *args[2] = {recv->v.proxy.target, kd};
    bool ran;
    ScrDyn *r = scr_dsym_px_run(recv, "getOwnPropertyDescriptor", args, 2, &ran);
    scr_dyn_release(kd);
    if (!ran) return scr_dyn_sym_has_own(recv->v.proxy.target, k);
    if (r == NULL) return false;
    const bool own = r->kind != SCR_DYN_UNDEF;
    scr_dyn_release(r);
    return own;
  }
  if (scr_dsym_nullish(recv)) {
    static const char msg[] = "Cannot convert undefined or null to object";
    scr_throw_error_msg(SCR_ERR_TYPE, msg, sizeof msg - 1);
    return false;
  }
  switch (scr_dsym_class(recv)) {
  case SCR_DSYM_STORE:
    return scr_dsym_own(recv, k) != NULL;
  case SCR_DSYM_INST: {
    /* only a FIELD keyed by the symbol is an own property; a method or accessor lives on the prototype (`in` sees it, hasOwn does not) */
    const ScrDynClassMember *m = scr_dsym_inst_member(recv, k);
    if (m != NULL && m->len > 7 && memcmp(m->name, "Symbol(", 7) == 0) return true;
    ScrDyn *bag = scr_dsym_inst_bag(recv, false);
    const bool own = bag != NULL && scr_dsym_own(bag, k) != NULL;
    scr_dyn_release(bag);
    return own;
  }
  case SCR_DSYM_FENCE:
    scr_dsym_fence(recv, "testing");
    return false;
  case SCR_DSYM_ABSENT:
    break;
  }
  return false;
}

bool scr_dyn_sym_has(ScrDyn *recv, ScrSym *k) {
  if (recv != NULL && recv->kind == SCR_DYN_JSVAL) return scr_dsym_engine_bool(recv, SCR_JSV_SYM_HAS, k);
  if (recv != NULL && recv->kind == SCR_DYN_PROXY) {
    ScrDyn *kd = scr_dsym_keydyn(k);
    ScrDyn *args[2] = {recv->v.proxy.target, kd};
    bool ran;
    ScrDyn *r = scr_dsym_px_run(recv, "has", args, 2, &ran);
    scr_dyn_release(kd);
    if (!ran) return scr_dyn_sym_has(recv->v.proxy.target, k);
    if (r == NULL) return false;
    const bool has = scr_dyn_truthy(r);
    scr_dyn_release(r);
    return has;
  }
  if (scr_dsym_nullish(recv) || recv->kind == SCR_DYN_STR || recv->kind == SCR_DYN_NUM || recv->kind == SCR_DYN_BOOL ||
      recv->kind == SCR_DYN_BIG || (recv->kind == SCR_DYN_HANDLE && recv->v.handle.tag == SCR_DYNH_SYMBOL)) {
    { char post[192]; scr_dsym_prim_tail(post, sizeof post, "' in ", recv, false); scr_dsym_throw("Cannot use 'in' operator to search for '", k, post); }
    return false;
  }
  switch (scr_dsym_class(recv)) {
  case SCR_DSYM_STORE:
    for (ScrDyn *o = recv; o != NULL;) {
      if (scr_dsym_own(o, k) != NULL) return true;
      if (o->kind != SCR_DYN_OBJ) break;
      o = scr_dyn_ext(o)->proto;
    }
    return false;
  case SCR_DSYM_INST: {
    if (scr_dsym_inst_member(recv, k) != NULL) return true;
    ScrDyn *bag = scr_dsym_inst_bag(recv, false);
    const bool own = bag != NULL && scr_dsym_own(bag, k) != NULL;
    scr_dyn_release(bag);
    return own;
  }
  case SCR_DSYM_FENCE:
    scr_dsym_fence(recv, "testing");
    return false;
  case SCR_DSYM_ABSENT:
    break;
  }
  return false;
}

static bool scr_dsym_delete(ScrDyn *recv, ScrSym *k, bool strict, const ScrDyn *self) {
  if (recv != NULL && recv->kind == SCR_DYN_JSVAL) return scr_dsym_engine_bool(recv, SCR_JSV_SYM_DELETE, k);
  if (recv != NULL && recv->kind == SCR_DYN_PROXY) {
    ScrDyn *kd = scr_dsym_keydyn(k);
    ScrDyn *args[2] = {recv->v.proxy.target, kd};
    bool ran;
    ScrDyn *r = scr_dsym_px_run(recv, "deleteProperty", args, 2, &ran);
    scr_dyn_release(kd);
    if (!ran) return scr_dsym_delete(recv->v.proxy.target, k, strict, recv->v.proxy.target);
    if (r == NULL) return false;
    const bool ok = scr_dyn_truthy(r);
    scr_dyn_release(r);
    if (!ok && strict) scr_dsym_px_falsish("deleteProperty", k);
    return ok;
  }
  if (scr_dsym_nullish(recv)) {
    static const char msg[] = "Cannot convert undefined or null to object";
    scr_throw_error_msg(SCR_ERR_TYPE, msg, sizeof msg - 1);
    return false;
  }
  if (recv->static_copy) {
    scr_dyn_static_copy_refuse("deleting a property");
    return false;
  }
  if (recv->kind == SCR_DYN_OBJINST) {
    if (scr_dsym_inst_member(recv, k) != NULL) {
      scr_dsym_fence(recv, "deleting"); /* a class member keyed by the symbol */
      return false;
    }
    ScrDyn *bag = scr_dsym_inst_bag(recv, false);
    if (bag == NULL) return true;
    const bool ok = scr_dsym_delete(bag, k, strict, recv);
    scr_dyn_release(bag);
    return ok;
  }
  bool none;
  ScrDynObjExt *x = scr_dsym_host(recv, false, &none);
  ScrDynSymEnt *r = scr_dsym_find(x, k);
  if (r == NULL) return true;
  if (!(r->flags & SCR_SYMP_CONFIG)) {
    if (strict) {
      char rt[96], post[128];
      scr_dsym_recv_text(self, rt, sizeof rt);
      snprintf(post, sizeof post, "' of %s", rt);
      scr_dsym_throw("Cannot delete property '", k, post);
    }
    return false;
  }
  ScrDynSymTab *t = x->syms;
  uint32_t i = (uint32_t)(r - t->e);
  ScrSym *key = t->e[i].key;
  ScrDyn *val = t->e[i].val;
  memmove(&t->e[i], &t->e[i + 1], (t->len - i - 1) * sizeof t->e[0]); /* order-preserving */
  t->len--;
  scr_sym_release(key);
  scr_dyn_release(val); /* last: the release may run arbitrary teardown */
  return true;
}

ScrDyn *scr_dyn_sym_define(ScrDyn *recv, ScrSym *k, ScrDyn *desc) {
  if (recv != NULL && recv->kind == SCR_DYN_JSVAL) {
    ScrDyn *r = scr_dsym_engine(recv, SCR_JSV_SYM_DEFINE, k, desc);
    if (r == NULL) return NULL;
    scr_dyn_release(r);
    return scr_dyn_retain(recv);
  }
  if (recv != NULL && recv->kind == SCR_DYN_PROXY) {
    ScrDyn *kd = scr_dsym_keydyn(k);
    ScrDyn *args[3] = {recv->v.proxy.target, kd, desc};
    bool ran;
    ScrDyn *r = scr_dsym_px_run(recv, "defineProperty", args, 3, &ran);
    scr_dyn_release(kd);
    if (!ran) {
      ScrDyn *d = scr_dyn_sym_define(recv->v.proxy.target, k, desc);
      if (d == NULL) return NULL;
      scr_dyn_release(d);
      return scr_dyn_retain(recv);
    }
    if (r == NULL) return NULL;
    const bool ok = scr_dyn_truthy(r);
    scr_dyn_release(r);
    if (!ok) {
      scr_dsym_px_falsish("defineProperty", k);
      return NULL;
    }
    return scr_dyn_retain(recv);
  }
  if (scr_dsym_nullish(recv) ||
      (scr_dsym_class(recv) != SCR_DSYM_STORE && recv->kind != SCR_DYN_OBJINST)) {
    static const char msg[] = "Object.defineProperty called on non-object";
    if (scr_dsym_nullish(recv) || recv->kind == SCR_DYN_STR || recv->kind == SCR_DYN_NUM || recv->kind == SCR_DYN_BOOL)
      scr_throw_error_msg(SCR_ERR_TYPE, msg, sizeof msg - 1);
    else
      scr_dsym_fence(recv, "defining");
    return NULL;
  }
  if (desc == NULL || desc->kind != SCR_DYN_OBJ) {
    static const char msg[] = "Property description must be an object";
    scr_throw_error_msg(SCR_ERR_TYPE, msg, sizeof msg - 1);
    return NULL;
  }
  if (recv->static_copy) {
    scr_dyn_static_copy_refuse("defining a property");
    return NULL;
  }
  if (recv->kind == SCR_DYN_OBJINST) {
    ScrDyn *bag = scr_dsym_inst_member(recv, k) == NULL ? scr_dsym_inst_bag(recv, true) : NULL;
    if (bag == NULL) {
      scr_dsym_fence(recv, "defining"); /* a class member keyed by the symbol, or a class with no property table */
      return NULL;
    }
    ScrDyn *r = scr_dyn_sym_define(bag, k, desc);
    scr_dyn_release(r);
    scr_dyn_release(bag);
    return scr_dyn_retain(recv);
  }
  ScrDyn *dg = scr_dyn_obj_get(desc, "get", 3);
  ScrDyn *ds = scr_dyn_obj_get(desc, "set", 3);
  ScrDyn *dv = scr_dyn_obj_get(desc, "value", 5);
  ScrDyn *dw = scr_dyn_obj_get(desc, "writable", 8);
  ScrDyn *de = scr_dyn_obj_get(desc, "enumerable", 10);
  ScrDyn *dc = scr_dyn_obj_get(desc, "configurable", 12);
  const bool accessor = dg != NULL || ds != NULL;
  if (accessor && (dv != NULL || dw != NULL)) {
    char rt[96], msg[256];
    scr_dsym_recv_text(desc, rt, sizeof rt);
    const int n = snprintf(msg, sizeof msg, "Invalid property descriptor. Cannot both specify accessors and a value or writable attribute, %s", rt);
    scr_throw_error_msg(SCR_ERR_TYPE, msg, (size_t)(n < 0 ? 0 : n >= (int)sizeof msg ? (int)sizeof msg - 1 : n));
    return NULL;
  }
  if ((dg != NULL && dg->kind != SCR_DYN_FUNC && dg->kind != SCR_DYN_UNDEF) ||
      (ds != NULL && ds->kind != SCR_DYN_FUNC && ds->kind != SCR_DYN_UNDEF)) {
    const bool bad_get = dg != NULL && dg->kind != SCR_DYN_FUNC && dg->kind != SCR_DYN_UNDEF;
    ScrStr *t = scr_dyn_to_string(bad_get ? dg : ds, NULL);
    char msg[256];
    const int n = snprintf(msg, sizeof msg, "%s must be a function: %.*s", bad_get ? "Getter" : "Setter", (int)t->len, t->data);
    scr_str_release(t);
    scr_throw_error_msg(SCR_ERR_TYPE, msg, (size_t)(n < 0 ? 0 : n >= (int)sizeof msg ? (int)sizeof msg - 1 : n));
    return NULL;
  }
  bool none;
  ScrDynSymEnt *r = scr_dsym_find(scr_dsym_host(recv, false, &none), k);
  /* an omitted attribute is false on a new property and unchanged on an existing one; turning a data row into an
   * accessor (or back) resets the kind-specific bits */
  uint32_t flags = r != NULL ? r->flags : 0;
  if (r != NULL && accessor != ((r->flags & SCR_SYMP_ACC) != 0)) flags &= ~(SCR_SYMP_WRITE | SCR_SYMP_ACC);
  if (accessor) flags = (flags | SCR_SYMP_ACC) & ~SCR_SYMP_WRITE;
  if (dw != NULL) flags = scr_dyn_truthy(dw) ? (flags | SCR_SYMP_WRITE) : (flags & ~SCR_SYMP_WRITE);
  if (de != NULL) flags = scr_dyn_truthy(de) ? (flags | SCR_SYMP_ENUM) : (flags & ~SCR_SYMP_ENUM);
  if (dc != NULL) flags = scr_dyn_truthy(dc) ? (flags | SCR_SYMP_CONFIG) : (flags & ~SCR_SYMP_CONFIG);
  /* the new value cell: an accessor's [getter, setter] pair (an omitted half keeps an existing accessor's), or the data value */
  ScrDyn *cell = NULL;
  if (accessor) {
    cell = scr_dyn_new_arr();
    ScrDyn *og = r != NULL && (r->flags & SCR_SYMP_ACC) ? r->val->v.arr.items[0] : scr_dyn_undefined();
    ScrDyn *os = r != NULL && (r->flags & SCR_SYMP_ACC) ? r->val->v.arr.items[1] : scr_dyn_undefined();
    scr_dyn_arr_push(cell, scr_dyn_retain(dg != NULL ? dg : og));
    scr_dyn_arr_push(cell, scr_dyn_retain(ds != NULL ? ds : os));
  }
  if (r != NULL) {
    if (!(r->flags & SCR_SYMP_CONFIG)) {
      /* a non-configurable property admits only an identical attribute set, a same-value redefinition, and
       * writable -> non-writable; an accessor admits no change at all */
      const bool same_attrs = (r->flags & (SCR_SYMP_ENUM | SCR_SYMP_CONFIG)) == (flags & (SCR_SYMP_ENUM | SCR_SYMP_CONFIG));
      const bool same_kind = ((r->flags & SCR_SYMP_ACC) != 0) == accessor;
      const bool writable_ok = (r->flags & SCR_SYMP_WRITE) || !(flags & SCR_SYMP_WRITE);
      const bool value_ok = accessor ? ((dg == NULL || dg == r->val->v.arr.items[0]) && (ds == NULL || ds == r->val->v.arr.items[1]))
                                     : (dv == NULL || (r->flags & SCR_SYMP_WRITE) || scr_dyn_same_value(r->val, dv));
      if (!same_attrs || !same_kind || !writable_ok || !value_ok) {
        scr_dyn_release(cell);
        scr_dsym_throw("Cannot redefine property: ", k, "");
        return NULL;
      }
    }
    if (accessor) {
      ScrDyn *old = r->val;
      r->val = cell;
      scr_dyn_release(old);
    } else if (dv != NULL || (r->flags & SCR_SYMP_ACC)) {
      ScrDyn *old = r->val;
      r->val = scr_dyn_retain(dv != NULL ? dv : scr_dyn_undefined());
      scr_dyn_release(old);
    }
    r->flags = flags;
    return scr_dyn_retain(recv);
  }
  ScrDynObjExt *x = scr_dsym_host(recv, true, &none);
  if (x == NULL) {
    scr_dyn_release(cell);
    scr_dsym_fence(recv, "defining");
    return NULL;
  }
  scr_dsym_add(x, k, accessor ? cell : scr_dyn_retain(dv != NULL ? dv : scr_dyn_undefined()), flags);
  return scr_dyn_retain(recv);
}

bool scr_dyn_sym_delete(ScrDyn *recv, ScrSym *k) { return scr_dsym_delete(recv, k, true, recv); }
bool scr_dyn_sym_delete_sloppy(ScrDyn *recv, ScrSym *k) { return scr_dsym_delete(recv, k, false, recv); }

static ScrArr *scr_dsym_keys(ScrDyn *recv, bool enum_only) {
  if (recv != NULL && recv->kind == SCR_DYN_JSVAL) {
    ScrDyn *flag = scr_dyn_new_bool(enum_only);
    ScrDyn *list = scr_dsym_engine(recv, SCR_JSV_SYM_KEYS, NULL, flag);
    scr_dyn_release(flag);
    if (list == NULL) return NULL;
    ScrArr *out = scr_arr_new_ref(&scr_sym_retain_v, &scr_sym_release_v, NULL, 4);
    for (size_t i = 0; i < list->v.arr.len; i++) scr_arr_push_ref(out, scr_sym_retain(SCR_ANY_SYM(list->v.arr.items[i])));
    scr_dyn_release(list);
    return out;
  }
  if (recv != NULL && recv->kind == SCR_DYN_PROXY) {
    ScrDyn *targs[1] = {recv->v.proxy.target};
    bool ran;
    ScrDyn *list = scr_dsym_px_run(recv, "ownKeys", targs, 1, &ran);
    if (!ran) return scr_dsym_keys(recv->v.proxy.target, enum_only);
    if (list == NULL) return NULL;
    if (list->kind != SCR_DYN_ARR) {
      static const char msg[] = "CreateListFromArrayLike called on non-object";
      scr_throw_error_msg(SCR_ERR_TYPE, msg, sizeof msg - 1);
      scr_dyn_release(list);
      return NULL;
    }
    ScrArr *out = scr_arr_new_ref(&scr_sym_retain_v, &scr_sym_release_v, NULL, 4);
    for (size_t i = 0; i < list->v.arr.len; i++) {
      ScrDyn *kd = list->v.arr.items[i];
      if (!scr_any_is_sym(kd)) continue; /* the string keys are the string walk's */
      ScrSym *sk = SCR_ANY_SYM(kd);
      if (enum_only && !scr_dsym_proto_test(1, recv, sk)) {
        if (scr_exc_pending()) break;
        continue;
      }
      scr_arr_push_ref(out, scr_sym_retain(sk));
    }
    scr_dyn_release(list);
    if (scr_exc_pending()) {
      scr_arr_release(out);
      return NULL;
    }
    return out;
  }
  if (scr_dsym_nullish(recv)) {
    static const char msg[] = "Cannot convert undefined or null to object";
    scr_throw_error_msg(SCR_ERR_TYPE, msg, sizeof msg - 1);
    return NULL;
  }
  const ScrDsymClass cls = scr_dsym_class(recv);
  if (cls == SCR_DSYM_FENCE) {
    scr_dsym_fence(recv, "listing");
    return NULL;
  }
  if (cls == SCR_DSYM_INST) {
    /* a class that declares a symbol-keyed member has own symbols this list cannot name; one that declares none has none */
    for (size_t i = 0, n = scr_dyn_objinst_member_count(recv); i < n; i++) {
      const ScrDynClassMember *m = scr_dyn_objinst_member_at(recv, i);
      if (m != NULL && m->len > 7 && memcmp(m->name, "Symbol(", 7) == 0) {
        scr_dsym_fence(recv, "listing");
        return NULL;
      }
    }
  }
  ScrArr *out = scr_arr_new_ref(&scr_sym_retain_v, &scr_sym_release_v, NULL, 4);
  bool none;
  ScrDyn *held = cls == SCR_DSYM_INST ? scr_dsym_inst_bag(recv, false) : NULL; /* the instance's table, +1 */
  ScrDynObjExt *x = held != NULL ? scr_dsym_host(held, false, &none)
                    : scr_dsym_class(recv) == SCR_DSYM_STORE
                        ? scr_dsym_host(recv, false, &none)
                        : NULL;
  if (x != NULL && x->syms != NULL) {
    for (uint32_t i = 0; i < x->syms->len; i++) {
      if (enum_only && !(x->syms->e[i].flags & SCR_SYMP_ENUM)) continue;
      scr_arr_push_ref(out, scr_sym_retain(x->syms->e[i].key));
    }
  }
  scr_dyn_release(held);
  return out;
}

ScrArr *scr_dyn_sym_own_keys(ScrDyn *recv) { return scr_dsym_keys(recv, false); }
ScrArr *scr_dyn_sym_own_enum_keys(ScrDyn *recv) { return scr_dsym_keys(recv, true); }

/* Object.assign / spread: the source's ENUMERABLE symbol rows land on the target in creation order (a [[Set]] on the
 * target, so a read-only target property refuses exactly as it does for a string key). The loop re-reads the length
 * each step: a setter the copy triggers may grow the source. */
/* An object whose own keys are only known by asking it (a proxy's ownKeys / getOwnPropertyDescriptor traps, an engine object):
 * [[OwnPropertyKeys]], each symbol filtered by its descriptor's enumerable bit, read with [[Get]]. */
static void scr_dsym_copy_enum_keyed(ScrDyn *target, const ScrDyn *src) {
  /* [[OwnPropertyKeys]] through the ownKeys trap, each symbol filtered by its descriptor's enumerable bit, read with [[Get]] */
  ScrArr *ks = scr_dsym_keys((ScrDyn *)src, true);
  if (ks == NULL) return;
  for (size_t i = 0, n = (size_t)scr_arr_len(ks); i < n && !scr_exc_pending(); i++) {
    ScrSym *k = (ScrSym *)scr_arr_get_ref(ks, (double)i); /* +1 */
    ScrDyn *v = scr_dsym_get((ScrDyn *)src, k, (ScrDyn *)src);
    if (v != NULL) {
      scr_dsym_set(target, k, v, true, target);
      scr_dyn_release(v);
    }
    scr_sym_release(k);
  }
  scr_arr_release(ks);
}

static void scr_dsym_copy_enum(ScrDyn *target, const ScrDyn *src) {
  if (src->kind == SCR_DYN_JSVAL) {
    scr_dsym_copy_enum_keyed(target, src);
    return;
  }
  bool none;
  if (src->kind == SCR_DYN_PROXY) {
    scr_dsym_copy_enum_keyed(target, src);
    return;
  }
  ScrDyn *held = src->kind == SCR_DYN_OBJINST ? scr_dsym_inst_bag(src, false) : NULL; /* the instance's table, +1 */
  if (src->kind == SCR_DYN_OBJINST && held == NULL) return;
  ScrDynObjExt *x = scr_dsym_host(held != NULL ? held : (ScrDyn *)src, false, &none);
  if (x == NULL || x->syms == NULL) {
    scr_dyn_release(held);
    return;
  }
  for (uint32_t i = 0; i < x->syms->len; i++) {
    ScrDynSymEnt *r = &x->syms->e[i];
    if (!(r->flags & SCR_SYMP_ENUM)) continue;
    ScrSym *k = scr_sym_retain(r->key);
    ScrDyn *v = scr_dsym_row_value(src->kind == SCR_DYN_OBJINST ? src : (held != NULL ? held : src), r); /* a getter runs */
    if (v != NULL) {
      scr_dsym_set(target, k, v, true, target);
      scr_dyn_release(v);
    }
    scr_sym_release(k);
    if (scr_exc_pending()) break;
  }
  scr_dyn_release(held);
}

ScrDyn *scr_dyn_sym_append(ScrDyn *names, ScrDyn *recv) {
  ScrArr *syms = scr_dsym_keys(recv, false);
  if (syms == NULL) return NULL; /* a fenced kind: the exception is pending */
  for (size_t i = 0, n = (size_t)scr_arr_len(syms); i < n; i++) {
    ScrSym *k = (ScrSym *)scr_arr_get_ref(syms, (double)i); /* +1 */
    scr_dyn_arr_push(names, scr_dyn_new_handle(k, SCR_DYNH_SYMBOL));
    scr_sym_release(k);
  }
  scr_arr_release(syms);
  return scr_dyn_retain(names);
}

/* Object.prototype.hasOwnProperty (op 0) and propertyIsEnumerable (op 1) over a symbol argument. */
static bool scr_dsym_proto_test(int op, ScrDyn *recv, ScrSym *k) {
  if (op == 0) return scr_dyn_sym_has_own(recv, k);
  if (recv != NULL && recv->kind == SCR_DYN_PROXY) {
    ScrDyn *kd = scr_dsym_keydyn(k);
    ScrDyn *args[2] = {recv->v.proxy.target, kd};
    bool ran;
    ScrDyn *r = scr_dsym_px_run(recv, "getOwnPropertyDescriptor", args, 2, &ran);
    scr_dyn_release(kd);
    if (!ran) return scr_dsym_proto_test(1, recv->v.proxy.target, k);
    if (r == NULL) return false;
    bool en = false;
    if (r->kind == SCR_DYN_OBJ) {
      const ScrDyn *e = scr_dyn_obj_get(r, "enumerable", 10);
      en = e != NULL && scr_dyn_truthy(e);
    }
    scr_dyn_release(r);
    return en;
  }
  if (scr_dsym_nullish(recv)) {
    static const char msg[] = "Cannot convert undefined or null to object";
    scr_throw_error_msg(SCR_ERR_TYPE, msg, sizeof msg - 1);
    return false;
  }
  if (recv != NULL && recv->kind == SCR_DYN_JSVAL) return scr_dsym_engine_bool(recv, SCR_JSV_SYM_IS_ENUM, k);
  ScrDyn *held = recv->kind == SCR_DYN_OBJINST ? scr_dsym_inst_bag(recv, false) : NULL;
  const ScrDynSymEnt *r = (scr_dsym_class(recv) == SCR_DSYM_STORE) ? scr_dsym_own(recv, k) : held != NULL ? scr_dsym_own(held, k) : NULL;
  const bool en = r != NULL && (r->flags & SCR_SYMP_ENUM) != 0;
  scr_dyn_release(held);
  return en;
}

/* `recv[Symbol.toStringTag]` over a checked-dynamic receiver: the string tag of the kinds that have a built-in one, else
 * undefined (+1). Typed arrays answer their own name (a Buffer and a Uint8Array are both "Uint8Array"), a DataView
 * "DataView", an ArrayBuffer "ArrayBuffer", a Map or Set theirs. A nullish receiver answers undefined (the optional
 * chain's form); an object whose class or literal sets the tag itself (a well-known symbol property this runtime does not
 * store) fences, as does an engine value. */
ScrDyn *scr_dyn_sym_tag(ScrDyn *recv) {
  if (scr_dsym_nullish(recv)) return scr_dyn_retain(scr_dyn_undefined());
  const char *tag = NULL;
  switch (recv->kind) {
  case SCR_DYN_BYTES:
    if (recv->v.bytes->flavor == SCR_BF_DATAVIEW) tag = "DataView";
    else
      switch (recv->v.bytes->elem) {
      case SCR_BYTES_U8: tag = "Uint8Array"; break;
      case SCR_BYTES_U32: tag = "Uint32Array"; break;
      case SCR_BYTES_F32: tag = "Float32Array"; break;
      case SCR_BYTES_I32: tag = "Int32Array"; break;
      case SCR_BYTES_F64: tag = "Float64Array"; break;
      case SCR_BYTES_I8: tag = "Int8Array"; break;
      case SCR_BYTES_BUF: tag = "ArrayBuffer"; break;
      case SCR_BYTES_I16: tag = "Int16Array"; break;
      case SCR_BYTES_U16: tag = "Uint16Array"; break;
      case SCR_BYTES_U8C: tag = "Uint8ClampedArray"; break;
      case SCR_BYTES_F16: tag = "Float16Array"; break;
      case SCR_BYTES_I64: tag = "BigInt64Array"; break;
      case SCR_BYTES_U64: tag = "BigUint64Array"; break;
      default: break;
      }
    break;
  case SCR_DYN_ARRBUF:
    tag = "ArrayBuffer";
    break;
  case SCR_DYN_MAP:
    tag = scr_dyn_map_cls(recv);
    break;
  case SCR_DYN_PROMISE:
    tag = "Promise";
    break;
  case SCR_DYN_STR:
  case SCR_DYN_NUM:
  case SCR_DYN_BOOL:
  case SCR_DYN_BIG:
  case SCR_DYN_ARR:
  case SCR_DYN_OBJ:
  case SCR_DYN_FUNC:
    break;
  default:
    scr_dsym_fence(recv, "reading Symbol.toStringTag of");
    return NULL;
  }
  if (tag == NULL) return scr_dyn_retain(scr_dyn_undefined());
  ScrStr *t = scr_str_new(tag, strlen(tag));
  ScrDyn *d = scr_dyn_new_str(t);
  scr_str_release(t);
  return d;
}

/* ── the table's teardown, collector trace and util.inspect rendering (reached through hooks, see scr_runtime.h) ───────────────────── */

/* The keys are plain refcounts in BOTH teardown paths; the values are released only by the refcount path (the collector's trace
 * already accounted for them). */
static void scr_dsym_free_table(ScrDynSymTab *t, bool release) {
  for (uint32_t i = 0; i < t->len; i++) {
    scr_sym_release(t->e[i].key);
    if (release) scr_dyn_release(t->e[i].val);
  }
  free(t->e);
  free(t);
}

static void scr_dsym_trace_table(const ScrDynSymTab *t, ScrTraceVisit visit, void *ctx) {
  for (uint32_t i = 0; i < t->len; i++) visit(t->e[i].val, ctx);
}


/* ── a dynamic key of unknown static type (see scr_runtime.h): a symbol handle takes the table, everything else the string op ───── */

void scr_dyn_any_set(ScrDyn *recv, ScrDyn *key, ScrStr *keystr, ScrDyn *v) {
  if (scr_any_is_sym(key)) scr_dyn_sym_set(recv, SCR_ANY_SYM(key), v);
  else scr_dyn_key_set(recv, keystr, v);
}
void scr_dyn_any_set_sloppy(ScrDyn *recv, ScrDyn *key, ScrStr *keystr, ScrDyn *v) {
  if (scr_any_is_sym(key)) scr_dyn_sym_set_sloppy(recv, SCR_ANY_SYM(key), v);
  else scr_dyn_key_set_sloppy(recv, keystr, v);
}
bool scr_dyn_any_delete(ScrDyn *recv, ScrDyn *key, ScrStr *keystr) {
  return scr_any_is_sym(key) ? scr_dyn_sym_delete(recv, SCR_ANY_SYM(key)) : scr_dyn_key_delete(recv, keystr);
}
bool scr_dyn_any_has(ScrDyn *recv, ScrDyn *key, ScrStr *keystr) {
  return scr_any_is_sym(key) ? scr_dyn_sym_has(recv, SCR_ANY_SYM(key)) : scr_dyn_has_key_full_hook(recv, keystr);
}
bool scr_dyn_any_has_own(ScrDyn *recv, ScrDyn *key, ScrStr *keystr) {
  return scr_any_is_sym(key) ? scr_dyn_sym_has_own(recv, SCR_ANY_SYM(key)) : scr_dyn_has_own(recv, keystr);
}
ScrDyn *scr_dyn_any_define(ScrDyn *recv, ScrDyn *key, ScrStr *keystr, ScrDyn *desc) {
  return scr_any_is_sym(key) ? scr_dyn_sym_define(recv, SCR_ANY_SYM(key), desc) : scr_dyn_define_prop_hook(recv, keystr, desc);
}
