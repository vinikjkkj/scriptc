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

/* "Symbol(desc)" as a C string in `buf` (truncated, which only shortens a diagnostic). */
static void scr_dsym_name(ScrSym *k, char *buf, size_t cap) {
  ScrStr *s = scr_sym_to_string(k);
  size_t n = s->len < cap - 1 ? s->len : cap - 1;
  memcpy(buf, s->data, n);
  buf[n] = '\0';
  scr_str_release(s);
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
static const ScrDynClassMember *scr_dsym_inst_member(const ScrDyn *d, ScrSym *k) {
  const ScrDynClassMember *m = NULL;
  ScrStr *rk = scr_sym_key_for(k); /* +1 or NULL */
  if (rk != NULL) {
    char *nm = (char *)malloc(rk->len + 9);
    if (nm == NULL) scr_trap("scriptc: out of memory\n");
    memcpy(nm, "sym.for:", 8);
    memcpy(nm + 8, rk->data, rk->len);
    m = scr_dyn_objinst_member(d, nm, rk->len + 8);
    free(nm);
    scr_str_release(rk);
    return m;
  }
  ScrStr *n = scr_sym_to_string(k);
  m = scr_dyn_objinst_member(d, n->data, n->len);
  if (m == NULL) {
    char *nm = (char *)malloc(n->len + 10);
    if (nm == NULL) scr_trap("scriptc: out of memory\n");
    memcpy(nm, "sym.uniq:", 9);
    memcpy(nm + 9, n->data, n->len);
    m = scr_dyn_objinst_member(d, nm, n->len + 9);
    free(nm);
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
  if (scr_dyn_sym_key_release == NULL) {
    scr_dyn_sym_key_release = &scr_sym_key_release_hook;
    scr_dyn_sym_key_str = &scr_sym_to_string;
    scr_dyn_sym_copy_enum = &scr_dsym_copy_enum;
  }
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

ScrDyn *scr_dyn_sym_get(ScrDyn *recv, ScrSym *k) {
  if (scr_dsym_nullish(recv)) {
    { char pre[64]; snprintf(pre, sizeof pre, "Cannot read properties of %s (reading '", scr_dsym_kind(recv)); scr_dsym_throw(pre, k, "')"); }
    return NULL;
  }
  switch (scr_dsym_class(recv)) {
  case SCR_DSYM_STORE:
    for (ScrDyn *o = recv; o != NULL;) {
      ScrDynSymEnt *r = scr_dsym_own(o, k);
      if (r != NULL) return scr_dyn_retain(r->val);
      if (o->kind != SCR_DYN_OBJ) break;
      o = scr_dyn_ext(o)->proto;
    }
    break;
  case SCR_DSYM_INST: {
    const ScrDynClassMember *m = scr_dsym_inst_member(recv, k);
    if (m != NULL && m->get != NULL) return m->get(recv->v.inst.o);
    if (m != NULL && m->value != NULL) return m->value();
    if (m != NULL) {
      scr_dsym_fence(recv, "reading"); /* a method row with no function value */
      return NULL;
    }
    ScrDyn *bag = scr_dsym_inst_bag(recv, false);
    if (bag != NULL) {
      ScrDynSymEnt *r = scr_dsym_own(bag, k);
      ScrDyn *out = r != NULL ? scr_dyn_retain(r->val) : NULL;
      scr_dyn_release(bag);
      if (out != NULL) return out;
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

static void scr_dsym_set(ScrDyn *recv, ScrSym *k, ScrDyn *v, bool strict) {
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
    scr_dsym_set(bag, k, v, strict);
    scr_dyn_release(bag);
    return;
  }
  if (recv->kind != SCR_DYN_OBJ && recv->kind != SCR_DYN_ARR && recv->kind != SCR_DYN_FUNC) {
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
  if (r != NULL) {
    if (!(r->flags & SCR_SYMP_WRITE)) {
      if (strict) scr_dsym_throw("Cannot assign to read only property '", k, "' of object '#<Object>'");
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
      if (p != NULL) {
        if (!(p->flags & SCR_SYMP_WRITE)) {
          if (strict) scr_dsym_throw("Cannot assign to read only property '", k, "' of object '#<Object>'");
          return;
        }
        break;
      }
    }
  }
  ScrDynObjExt *x = scr_dsym_host(recv, true, &none);
  scr_dsym_add(x, k, scr_dyn_retain(v), SCR_SYMP_ENUM | SCR_SYMP_WRITE | SCR_SYMP_CONFIG);
}

void scr_dyn_sym_set(ScrDyn *recv, ScrSym *k, ScrDyn *v) { scr_dsym_set(recv, k, v, true); }
void scr_dyn_sym_set_sloppy(ScrDyn *recv, ScrSym *k, ScrDyn *v) { scr_dsym_set(recv, k, v, false); }

bool scr_dyn_sym_has_own(ScrDyn *recv, ScrSym *k) {
  if (scr_dsym_nullish(recv)) {
    static const char msg[] = "Cannot convert undefined or null to object";
    scr_throw_error_msg(SCR_ERR_TYPE, msg, sizeof msg - 1);
    return false;
  }
  switch (scr_dsym_class(recv)) {
  case SCR_DSYM_STORE:
    return scr_dsym_own(recv, k) != NULL;
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

bool scr_dyn_sym_has(ScrDyn *recv, ScrSym *k) {
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

static bool scr_dsym_delete(ScrDyn *recv, ScrSym *k, bool strict) {
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
    const bool ok = scr_dsym_delete(bag, k, strict);
    scr_dyn_release(bag);
    return ok;
  }
  bool none;
  ScrDynObjExt *x = scr_dsym_host(recv, false, &none);
  ScrDynSymEnt *r = scr_dsym_find(x, k);
  if (r == NULL) return true;
  if (!(r->flags & SCR_SYMP_CONFIG)) {
    if (strict) scr_dsym_throw("Cannot delete property '", k, "' of #<Object>");
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
  if (scr_dsym_nullish(recv) ||
      (recv->kind != SCR_DYN_OBJ && recv->kind != SCR_DYN_ARR && recv->kind != SCR_DYN_FUNC && recv->kind != SCR_DYN_OBJINST)) {
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
  if (scr_dyn_obj_get(desc, "get", 3) != NULL || scr_dyn_obj_get(desc, "set", 3) != NULL) {
    static const char msg[] =
        "defining a symbol-keyed accessor property on a dynamic value is not supported yet";
    scr_throw_error_msg(SCR_ERR_ERROR, msg, sizeof msg - 1);
    return NULL;
  }
  ScrDyn *dv = scr_dyn_obj_get(desc, "value", 5);
  ScrDyn *dw = scr_dyn_obj_get(desc, "writable", 8);
  ScrDyn *de = scr_dyn_obj_get(desc, "enumerable", 10);
  ScrDyn *dc = scr_dyn_obj_get(desc, "configurable", 12);
  bool none;
  ScrDynSymEnt *r = scr_dsym_find(scr_dsym_host(recv, false, &none), k);
  /* an omitted attribute is false on a new property and unchanged on an existing one */
  uint32_t flags = r != NULL ? r->flags : 0;
  if (dw != NULL) flags = scr_dyn_truthy(dw) ? (flags | SCR_SYMP_WRITE) : (flags & ~SCR_SYMP_WRITE);
  if (de != NULL) flags = scr_dyn_truthy(de) ? (flags | SCR_SYMP_ENUM) : (flags & ~SCR_SYMP_ENUM);
  if (dc != NULL) flags = scr_dyn_truthy(dc) ? (flags | SCR_SYMP_CONFIG) : (flags & ~SCR_SYMP_CONFIG);
  if (r != NULL) {
    if (!(r->flags & SCR_SYMP_CONFIG)) {
      /* a non-configurable property admits only an identical attribute set, a same-value redefinition, and
       * writable -> non-writable */
      const bool same_attrs = (r->flags & (SCR_SYMP_ENUM | SCR_SYMP_CONFIG)) == (flags & (SCR_SYMP_ENUM | SCR_SYMP_CONFIG));
      const bool writable_ok = (r->flags & SCR_SYMP_WRITE) || !(flags & SCR_SYMP_WRITE);
      const bool value_ok = dv == NULL || (r->flags & SCR_SYMP_WRITE) || scr_dyn_same_value(r->val, dv);
      if (!same_attrs || !writable_ok || !value_ok) {
        scr_dsym_throw("Cannot redefine property: ", k, "");
        return NULL;
      }
    }
    if (dv != NULL) {
      ScrDyn *old = r->val;
      r->val = scr_dyn_retain(dv);
      scr_dyn_release(old);
    }
    r->flags = flags;
    return scr_dyn_retain(recv);
  }
  ScrDynObjExt *x = scr_dsym_host(recv, true, &none);
  scr_dsym_add(x, k, scr_dyn_retain(dv != NULL ? dv : scr_dyn_undefined()), flags);
  return scr_dyn_retain(recv);
}

bool scr_dyn_sym_delete(ScrDyn *recv, ScrSym *k) { return scr_dsym_delete(recv, k, true); }
bool scr_dyn_sym_delete_sloppy(ScrDyn *recv, ScrSym *k) { return scr_dsym_delete(recv, k, false); }

static ScrArr *scr_dsym_keys(ScrDyn *recv, bool enum_only) {
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
                    : (recv->kind == SCR_DYN_OBJ || recv->kind == SCR_DYN_ARR || recv->kind == SCR_DYN_FUNC)
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
static void scr_dsym_copy_enum(ScrDyn *target, const ScrDyn *src) {
  bool none;
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
    ScrDyn *v = scr_dyn_retain(r->val);
    scr_dsym_set(target, k, v, true);
    scr_dyn_release(v);
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
