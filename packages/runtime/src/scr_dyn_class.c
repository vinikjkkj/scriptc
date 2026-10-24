/* Class instances and class values in the checked-dynamic tree: the member
 * tables' consumers that need a program class (writes, deletes, class values,
 * Error-rooted instances). Linked only into a program that has a class
 * (moduleUsesDynClass), so the always-linked scr_json.c carries none of it;
 * scr_dyn_class_install() points scr_dyn_class_ops here from the emitted main. */
#include "scr_runtime.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static ScrDyn *dyn_cls_objwalk_key(const char *key, size_t key_len) {
  ScrStr *k = scr_str_new(key, key_len);
  ScrDyn *d = scr_dyn_new_str(k);
  scr_str_release(k);
  return d;
}

/* ── class VALUES: the static side of a class as a dyn function object ─────
 *
 * `x.constructor`, or a class handed to untyped code, is ONE immortal FUNC
 * box per class (minted on first use, kept in a small registry and released
 * at exit, so `a.constructor === b.constructor` is box identity and nothing
 * leaks). Its closure's single capture holds the class's emitted descriptor.
 * What makes it a CLASS is the thunk: called without `new` it throws Node's
 * "Class constructor X cannot be invoked without 'new'", and every other
 * arm recognizes the box by that thunk's address -- `new` runs the class's
 * synthesized `%dynNew`, a read goes to the descriptor's statics table
 * (a data row answers its value, a method row a bound function), a write to
 * `%dynStaticSet`. `name` is the FUNC box's own. */
static void *dyn_cls_noop_v(void *p) { return p; }
static void dyn_cls_noop_rel_v(void *p) { (void)p; }

static const ScrDynClass *dyn_class_of_clo(ScrClosure *clo) {
  return (const ScrDynClass *)scr_box_get_ref((ScrBox *)clo->caps[0]);
}

static ScrDyn *dyn_class_box_thunk(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)args;
  (void)argc;
  ScrJsonBuf b;
  scr_jb_init(&b);
  scr_jb_puts(&b, "Class constructor ");
  scr_jb_puts(&b, dyn_class_of_clo(clo)->name);
  scr_jb_puts(&b, " cannot be invoked without 'new'");
  scr_throw_error(SCR_ERR_TYPE, scr_jb_finish(&b));
  return NULL;
}

const ScrDynClass *dyn_cls_impl_of_value(const ScrDyn *d) {
  if (d == NULL || d->kind != SCR_DYN_FUNC || d->v.fn.thunk != dyn_class_box_thunk) return NULL;
  return dyn_class_of_clo(d->v.fn.clo);
}

typedef struct { const ScrDynClass *cls; ScrDyn *box; } DynClsBox;
static DynClsBox *dyn_cls_boxes = NULL;
static size_t dyn_cls_boxes_n = 0;
static size_t dyn_cls_boxes_cap = 0;

static void dyn_cls_boxes_teardown(void) {
  for (size_t i = 0; i < dyn_cls_boxes_n; i++) scr_dyn_release(dyn_cls_boxes[i].box);
  free(dyn_cls_boxes);
  dyn_cls_boxes = NULL;
  dyn_cls_boxes_n = dyn_cls_boxes_cap = 0;
}

ScrDyn *dyn_cls_impl_box(const ScrDynClass *cls) {
  for (size_t i = 0; i < dyn_cls_boxes_n; i++) {
    if (dyn_cls_boxes[i].cls == cls) return scr_dyn_retain(dyn_cls_boxes[i].box);
  }
  ScrClosure *clo = scr_closure_new((void *)dyn_class_box_thunk, 1);
  clo->caps[0] = scr_box_new_obj(dyn_cls_noop_v, dyn_cls_noop_rel_v, NULL);
  scr_box_set_ref((ScrBox *)clo->caps[0], (void *)cls);
  ScrDyn *b = scr_dyn_new_func(clo, dyn_class_box_thunk, 0, "()", cls->name);
  if (dyn_cls_boxes_cap == 0) scr_atexit(dyn_cls_boxes_teardown);
  if (dyn_cls_boxes_n == dyn_cls_boxes_cap) {
    dyn_cls_boxes_cap = dyn_cls_boxes_cap ? dyn_cls_boxes_cap * 2 : 8;
    dyn_cls_boxes = realloc(dyn_cls_boxes, dyn_cls_boxes_cap * sizeof *dyn_cls_boxes);
  }
  dyn_cls_boxes[dyn_cls_boxes_n].cls = cls;
  dyn_cls_boxes[dyn_cls_boxes_n].box = b; /* the registry's own +1 */
  dyn_cls_boxes_n++;
  return scr_dyn_retain(b);
}

ScrDyn *scr_dyn_class_value(const ScrClassObj *c) {
  size_t reg_n = 0;
  const ScrDynClass *const *reg = scr_dyn_class_registry(&reg_n);
  for (size_t i = 0; i < reg_n; i++) {
    const ScrDynClass *k = reg[i];
    if (k->pre == c->pre && k->post == c->post) return dyn_cls_impl_box(k);
  }
  /* The emitter interns the static type's class and every descendant before
   * it emits this call, so a class object with no descriptor is a compiler
   * bug, not a program's. */
  scr_trap("emitter bug: a class value with no registered descriptor");
  return NULL;
}

/* The BUILTIN error classes' values (Error, TypeError, ...): `e.constructor`
 * of an error ENCODING. Same shape as a program class's box -- one immortal
 * FUNC per kind, typeof "function", `name` the kind's -- except that an
 * Error constructor is callable WITHOUT `new` too (it constructs either
 * way), and that no statics are modeled: every other key is the loud ladder
 * (Error.captureStackTrace and friends are real members this box cannot
 * answer, and undefined would be the silent wrong answer). */
static ScrDyn *dyn_error_class_boxes[SCR_ERR_KINDS];
static bool dyn_error_class_teardown_set = false;

static void dyn_error_class_teardown(void) {
  for (int i = 0; i < SCR_ERR_KINDS; i++) {
    scr_dyn_release(dyn_error_class_boxes[i]);
    dyn_error_class_boxes[i] = NULL;
  }
  dyn_error_class_teardown_set = false;
}

static int dyn_error_class_kind_of_clo(ScrClosure *clo) {
  return (int)(intptr_t)scr_box_get_ref((ScrBox *)clo->caps[0]);
}

static ScrDyn *dyn_error_class_make(int kind, const ScrDyn *msg) {
  ScrStr *m = NULL;
  if (msg != NULL && msg->kind != SCR_DYN_UNDEF) {
    m = scr_dyn_string_coerce((ScrDyn *)msg);
    if (scr_exc_pending()) {
      scr_str_release(m);
      return NULL;
    }
  }
  ScrError *e = scr_error_new(kind, m);
  scr_str_release(m);
  ScrDyn *r = scr_dyn_from_error(e);
  scr_error_release(e);
  return r;
}

static ScrDyn *dyn_error_class_thunk(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  return dyn_error_class_make(dyn_error_class_kind_of_clo(clo), argc > 0 ? args[0] : NULL);
}

static bool dyn_error_class_is(const ScrDyn *d) {
  return d != NULL && d->kind == SCR_DYN_FUNC && d->v.fn.thunk == dyn_error_class_thunk;
}

ScrDyn *dyn_cls_impl_error_box(int kind) {
  if (kind < 0 || kind >= SCR_ERR_KINDS || kind == SCR_ERR_DOMEX) return NULL;
  if (dyn_error_class_boxes[kind] == NULL) {
    ScrClosure *clo = scr_closure_new((void *)dyn_error_class_thunk, 1);
    clo->caps[0] = scr_box_new_obj(dyn_cls_noop_v, dyn_cls_noop_rel_v, NULL);
    scr_box_set_ref((ScrBox *)clo->caps[0], (void *)(intptr_t)kind);
    dyn_error_class_boxes[kind] = scr_dyn_new_func(clo, dyn_error_class_thunk, 1, "(string)", scr_error_kind_name(kind));
    if (!dyn_error_class_teardown_set) {
      dyn_error_class_teardown_set = true;
      scr_atexit(dyn_error_class_teardown);
    }
  }
  return scr_dyn_retain(dyn_error_class_boxes[kind]);
}

static const ScrDynClassMember *dyn_class_static(const ScrDynClass *cls, const char *k, size_t n) {
  for (size_t i = 0; i < cls->nstatics; i++) {
    const ScrDynClassMember *m = &cls->statics[i];
    if (m->len == n && memcmp(m->name, k, n) == 0) return m;
  }
  return NULL;
}

static void dyn_class_fence(const ScrDynClass *cls, const char *what) {
  ScrJsonBuf b;
  scr_jb_init(&b);
  scr_jb_puts(&b, what);
  scr_jb_puts(&b, " on the class value ");
  scr_jb_puts(&b, cls->name);
  scr_jb_puts(&b, " is not supported yet");
  scr_throw_error(SCR_ERR_ERROR, scr_jb_finish(&b));
}

/* A static method read as a VALUE (`const f = C.make`): a function over the
 * same row a call takes. */
static ScrDyn *dyn_class_static_call_thunk(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  const ScrDynClass *cls = dyn_class_of_clo(clo);
  ScrDyn *nm = (ScrDyn *)scr_box_get_ref((ScrBox *)clo->caps[1]); /* +1 */
  const ScrDynClassMember *m = dyn_class_static(cls, nm->v.str->data, nm->v.str->len);
  scr_dyn_release(nm);
  if (m == NULL || m->call == NULL) {
    dyn_class_fence(cls, "a static member");
    return NULL;
  }
  return m->call(NULL, args, argc, "a static method");
}

static ScrDyn *dyn_class_static_method_value(const ScrDynClass *cls, const ScrDynClassMember *m) {
  ScrClosure *clo = scr_closure_new((void *)dyn_class_static_call_thunk, 2);
  clo->caps[0] = scr_box_new_obj(dyn_cls_noop_v, dyn_cls_noop_rel_v, NULL);
  scr_box_set_ref((ScrBox *)clo->caps[0], (void *)cls);
  clo->caps[1] = scr_box_new_obj(scr_dyn_retain_v, scr_dyn_release_v, NULL);
  ScrStr *s = scr_str_new(m->name, m->len);
  ScrDyn *nameBox = scr_dyn_new_str(s);
  scr_str_release(s);
  scr_box_set_ref((ScrBox *)clo->caps[1], nameBox); /* takes the +1 */
  return scr_dyn_new_func(clo, dyn_class_static_call_thunk, 0, "()", "bound");
}

/* A keyed read on a class value: its statics table, then the loud ladder for
 * the members this box cannot answer exactly. NULL with nothing pending lets
 * the caller's function-object arms (name, ...) answer. */
static ScrDyn *dyn_class_static_get(const ScrDynClass *cls, const char *key, size_t key_len) {
  const ScrDynClassMember *m = dyn_class_static(cls, key, key_len);
  if (m != NULL) return m->get != NULL ? m->get(NULL) : dyn_class_static_method_value(cls, m);
  /* `length` is the constructor's arity and `prototype` the object its
   * instances inherit from: neither is modeled for a class value, and the
   * function-object defaults (0, an empty object) would be wrong answers. */
  if ((key_len == 6 && memcmp(key, "length", 6) == 0) || (key_len == 9 && memcmp(key, "prototype", 9) == 0)) {
    dyn_class_fence(cls, key_len == 6 ? "reading 'length'" : "reading 'prototype'");
    return NULL;
  }
  if (cls->staticsOpaque && !(key_len == 4 && memcmp(key, "name", 4) == 0)) {
    dyn_class_fence(cls, "reading a static member");
    return NULL;
  }
  return NULL;
}

/* `new C(...args)` over a class value: the class's synthesized `%dynNew`. */
static ScrDyn *dyn_class_construct(const ScrDynClass *cls, const ScrDyn *args) {
  const ScrDynClassMember *m = dyn_class_static(cls, "%dynNew", 7);
  if (m == NULL || m->call == NULL) {
    dyn_class_fence(cls, "`new`");
    return NULL;
  }
  ScrDyn *av[1] = { (ScrDyn *)args };
  return m->call(NULL, av, 1, "new");
}


static bool dyn_err_key_is(const ScrStr *k, const char *lit, size_t n) {
  return k->len == n && memcmp(k->data, lit, n) == 0;
}

ScrDyn *dyn_cls_impl_err_get(ScrDyn *d, const ScrStr *key) {
  ScrError *e = (ScrError *)d->v.inst.o;
  /* An own property in the bag shadows the cell it names (a message or name
   * written with a non-string value lives there). */
  if (e->props != NULL && e->props->kind == SCR_DYN_OBJ &&
      scr_dyn_obj_key_present(e->props, key->data, key->len)) {
    return scr_dyn_obj_key_get(e->props, key->data, key->len); /* +1, or NULL when a getter threw */
  }
  if (dyn_err_key_is(key, "message", 7) || dyn_err_key_is(key, "name", 4)) {
    bool msg = key->data[0] == 'm';
    ScrStr *cell = msg ? e->message : e->name;
    if (cell != NULL) return scr_dyn_new_str(cell); /* retains */
    ScrStr *dflt = scr_str_new(msg ? "" : "Error", msg ? 0 : 5);
    ScrDyn *r = scr_dyn_new_str(dflt);
    scr_str_release(dflt);
    return r;
  }
  return scr_error_prop_get(e, (ScrStr *)key); /* code, stack, undefined */
}

void dyn_cls_impl_err_set(ScrDyn *d, const ScrStr *key, const ScrDyn *value) {
  ScrError *e = (ScrError *)d->v.inst.o;
  bool is_msg = dyn_err_key_is(key, "message", 7);
  bool is_name = dyn_err_key_is(key, "name", 4);
  bool is_code = dyn_err_key_is(key, "code", 4);
  if ((is_msg || is_name || is_code) && value->kind == SCR_DYN_STR) {
    ScrStr *s = scr_dyn_string_coerce((ScrDyn *)value);
    ScrStr **cell = is_msg ? &e->message : is_name ? &e->name : &e->code;
    ScrStr *old = *cell;
    *cell = s;
    scr_str_release(old);
    if (e->props != NULL && e->props->kind == SCR_DYN_OBJ) scr_dyn_key_delete(e->props, (ScrStr *)key);
    return;
  }
  scr_error_prop_set(e, (ScrStr *)key, (ScrDyn *)value);
}

bool dyn_cls_impl_err_has(const ScrDyn *d, const char *key, size_t key_len) {
  ScrError *e = (ScrError *)d->v.inst.o;
  if ((key_len == 7 && memcmp(key, "message", 7) == 0) || (key_len == 4 && memcmp(key, "name", 4) == 0) ||
      (key_len == 5 && memcmp(key, "stack", 5) == 0)) {
    return true;
  }
  if (key_len == 4 && memcmp(key, "code", 4) == 0 && e->code != NULL) return true;
  return e->props != NULL && e->props->kind == SCR_DYN_OBJ && scr_dyn_obj_key_present(e->props, key, key_len);
}

bool dyn_cls_impl_err_delete(ScrDyn *d, const ScrStr *key) {
  ScrError *e = (ScrError *)d->v.inst.o;
  if (dyn_err_key_is(key, "message", 7) || dyn_err_key_is(key, "name", 4) || dyn_err_key_is(key, "stack", 5) ||
      dyn_err_key_is(key, "code", 4)) {
    return false;
  }
  if (e->props != NULL && e->props->kind == SCR_DYN_OBJ) return scr_dyn_key_delete(e->props, (ScrStr *)key);
  return true; /* nothing own by that name: Node answers true */
}


static ScrDyn *dyn_cls_ops_fn_get(const ScrDyn *d, const char *key, size_t key_len) {
  /* A BUILTIN ERROR CLASS value answers `name` (below) and nothing else. */
  if (dyn_error_class_is(d) && !(key_len == 4 && memcmp(key, "name", 4) == 0)) {
    ScrJsonBuf fb;
    scr_jb_init(&fb);
    scr_jb_puts(&fb, "reading '");
    scr_jb_write(&fb, key, key_len);
    scr_jb_puts(&fb, "' on the class value ");
    scr_jb_puts(&fb, scr_dyn_fn_name(d));
    scr_jb_puts(&fb, " is not supported yet");
    scr_throw_error(SCR_ERR_ERROR, scr_jb_finish(&fb));
    return NULL;
  }
  /* A CLASS VALUE answers its statics first (dyn_class_static_get). */
  {
    const ScrDynClass *cls = dyn_cls_impl_of_value(d);
    if (cls != NULL) {
      ScrDyn *s = dyn_class_static_get(cls, key, key_len);
      if (s != NULL || scr_exc_pending()) return s;
    }
  }
  return NULL;
}

static ScrDyn *dyn_cls_ops_construct(const ScrDyn *fn, const ScrDyn *args, bool *handled) {
  *handled = true;
  if (dyn_error_class_is(fn)) {
    return dyn_error_class_make(dyn_error_class_kind_of_clo(fn->v.fn.clo),
                                args->kind == SCR_DYN_ARR && args->v.arr.len > 0 ? args->v.arr.items[0] : NULL);
  }
  /* A CLASS VALUE: the class's own constructor (dyn_class_construct). */
  {
    const ScrDynClass *cls = dyn_cls_impl_of_value(fn);
    if (cls != NULL) return dyn_class_construct(cls, args);
  }
  *handled = false;
  return NULL;
}

static bool dyn_cls_ops_set(ScrDyn *recv, const ScrStr *key, const ScrDyn *value) {
  if (recv->kind == SCR_DYN_OBJINST) {
    /* Node writes the instance's real field. The compiler lists one
     * synthesized member, `%dynSet(key, value): boolean`, on every class a
     * dyn box can hold (dynSetFn): it runs what the static side would have
     * run for the same write -- the field's checked store, a setter, the
     * run-time property table. true = taken. A class with no such member,
     * or a key nothing can hold, keeps the loud ladder: a write that
     * silently went nowhere is the one answer worse than a refusal (the
     * static_copy stance). */
    const ScrDynClassMember *ds = scr_dyn_objinst_member(recv, "%dynSet", 7);
    if (ds != NULL && ds->call != NULL) {
      /* Writing a field `delete` removed re-creates the property at the END
       * of the key order in JS; the layout keeps declaration order, so the
       * list would come out wrong. Loud rather than reordered. */
      const ScrDynClassMember *rm = scr_dyn_objinst_member(recv, key->data, key->len);
      if (rm != NULL && rm->enumerable == 4 && value != scr_dyn_absent() && scr_dyn_member_hidden(rm, recv->v.inst.o)) {
        scr_dyn_objinst_fence(recv, "re-adding a deleted field");
        return true;
      }
      ScrDyn *kd = scr_dyn_new_str((ScrStr *)key);
      ScrDyn *av[2] = { kd, (ScrDyn *)value };
      ScrDyn *r = ds->call(recv->v.inst.o, av, 2, "a property write");
      scr_dyn_release(kd);
      if (r == NULL) return true; /* the write threw */
      bool taken = r->kind == SCR_DYN_BOOL && r->v.b;
      scr_dyn_release(r);
      if (taken) return true;
    }
    /* An Error-rooted instance: the runtime's cells and expando bag. */
    if (scr_dyn_objinst_error_rooted(recv)) {
      dyn_cls_impl_err_set(recv, key, value);
      return true;
    }
    return false; /* the caller keeps the loud ladder */
  }
  if (recv->kind == SCR_DYN_FUNC && dyn_cls_impl_of_value(recv) != NULL) {
    /* A write on a CLASS VALUE: the class's own static field or setter
     * (%dynStaticSet), which answers false for a name it cannot hold -- an
     * inherited static would be an OWN property of this class in JS, and a
     * global cannot be -- and then keeps the loud ladder. */
    const ScrDynClass *cls = dyn_cls_impl_of_value(recv);
    const ScrDynClassMember *m = dyn_class_static(cls, "%dynStaticSet", 13);
    if (m != NULL && m->call != NULL) {
      ScrDyn *kd = scr_dyn_new_str((ScrStr *)key);
      ScrDyn *av[2] = { kd, (ScrDyn *)value };
      ScrDyn *r = m->call(NULL, av, 2, "a static write");
      scr_dyn_release(kd);
      if (r == NULL) return true; /* the write threw */
      bool taken = r->kind == SCR_DYN_BOOL && r->v.b;
      scr_dyn_release(r);
      if (taken) return true;
    }
    dyn_class_fence(cls, "assigning a static member");
    return true;
  }
  return false;
}

/* -1: not ours (the caller's ladder runs); 0/1: the delete's answer. */
static int dyn_cls_ops_delete(ScrDyn *recv, const ScrStr *key) {
  {
    /* The class's own `%dynDel(key): boolean` (dynDelFn) takes what a fixed
     * layout can hold -- a field whose slot admits undefined takes the
     * undefined arm, a run-time property table loses its key -- and
     * answers false for the rest, which fall to the ladder below. */
    /* A field held in a dyn slot is deleted by storing the ABSENT marker
     * (scr_dyn_absent) through the class's own checked write: every read
     * still sees undefined, and the own-key surfaces see a removed key. */
    {
      const ScrDynClassMember *fm = scr_dyn_objinst_member(recv, key->data, key->len);
      const ScrDynClassMember *ds = scr_dyn_objinst_member(recv, "%dynSet", 7);
      if (fm != NULL && fm->enumerable == 4 && ds != NULL && ds->call != NULL) {
        ScrDyn *kd = scr_dyn_new_str((ScrStr *)key);
        ScrDyn *av[2] = { kd, scr_dyn_absent() };
        ScrDyn *r = ds->call(recv->v.inst.o, av, 2, "'delete'");
        scr_dyn_release(kd);
        if (r == NULL) return 0; /* the store threw */
        scr_dyn_release(r);
        return 1;
      }
    }
    const ScrDynClassMember *dd = scr_dyn_objinst_member(recv, "%dynDel", 7);
    if (dd != NULL && dd->call != NULL) {
      ScrDyn *kd = scr_dyn_new_str((ScrStr *)key);
      ScrDyn *av[1] = { kd };
      ScrDyn *r = dd->call(recv->v.inst.o, av, 1, "'delete'");
      scr_dyn_release(kd);
      if (r == NULL) return 0; /* the delete threw */
      bool taken = r->kind == SCR_DYN_BOOL && r->v.b;
      scr_dyn_release(r);
      if (taken) return 1;
    }
  }
  if (scr_dyn_objinst_member(recv, key->data, key->len) == NULL && scr_dyn_objinst_error_rooted(recv) &&
      dyn_cls_impl_err_delete(recv, key)) {
    return 1;
  }
  return -1;
}

static ScrDyn *dyn_cls_ops_walk_error(const ScrDyn *v, ScrObjWalk mode) {
  ScrDyn *out = scr_dyn_new_arr();
  {
    /* An Error's own ENUMERABLE keys: `message` and `stack` are own
     * NON-enumerable properties and never listed; `name` is listed only
     * when something ASSIGNED it (otherwise it is the prototype's), which
     * the cell shows by differing from the nearest builtin ancestor's
     * default; `code` is listed when the cell holds one (assigned, or
     * stamped by the throw site, which Node also makes own and
     * enumerable); then the class's own fields and the expando bag, in
     * that order. Order among them is the one thing the cells cannot
     * state: Node lists them in ASSIGNMENT order. */
    ScrError *e = (ScrError *)v->v.inst.o;
    const size_t pre = scr_dyn_objinst_pre(v);
    int own_kind = 0;
    size_t own_pre = 0;
    for (int k = 0; k < SCR_ERR_KINDS; k++) {
      if (scr_error_vts[k].pre <= pre && pre <= scr_error_vts[k].post && scr_error_vts[k].pre >= own_pre) {
        own_kind = k;
        own_pre = scr_error_vts[k].pre;
      }
    }
    const char *dflt = scr_error_kind_name(own_kind);
    if (e->name != NULL && !(dflt != NULL && e->name->len == strlen(dflt) && memcmp(e->name->data, dflt, e->name->len) == 0)) {
      ScrDyn *nv = scr_dyn_new_str(e->name);
      scr_dyn_objwalk_push(out, mode, "name", 4, nv);
      scr_dyn_release(nv);
    }
    /* (a class that DECLARES `code` has it as a member row below, and it is
     * the same slot: listed once) */
    if (e->code != NULL && scr_dyn_objinst_member(v, "code", 4) == NULL) {
      ScrDyn *cv = scr_dyn_new_str(e->code);
      scr_dyn_objwalk_push(out, mode, "code", 4, cv);
      scr_dyn_release(cv);
    }
    const size_t nm = scr_dyn_objinst_member_count(v);
    for (size_t i = 0; i < nm; i++) {
      const ScrDynClassMember *m = scr_dyn_objinst_member_at(v, i);
      if (scr_dyn_member_hidden(m, v->v.inst.o)) continue;
      if (mode == SCR_OBJWALK_KEYS) {
        scr_dyn_arr_push(out, dyn_cls_objwalk_key(m->name, m->len));
        continue;
      }
      ScrDyn *val = m->get(v->v.inst.o);
      if (val == NULL) {
        scr_dyn_release(out);
        return NULL;
      }
      scr_dyn_objwalk_push(out, mode, m->name, m->len, val);
      scr_dyn_release(val);
    }
    if (e->props != NULL && e->props->kind == SCR_DYN_OBJ) {
      ScrDyn *bag = scr_dyn_objwalk(e->props, mode);
      if (bag == NULL) {
        scr_dyn_release(out);
        return NULL;
      }
      for (size_t i = 0; i < bag->v.arr.len; i++) scr_dyn_arr_push(out, scr_dyn_retain(bag->v.arr.items[i]));
      scr_dyn_release(bag);
    }
    return out;
  }
}

static bool dyn_cls_ops_error_rooted(const ScrDyn *d) {
  if (d == NULL || d->kind != SCR_DYN_OBJINST) return false;
  return scr_dyn_objinst_class_of(d)->errorRooted;
}

static bool dyn_cls_ops_error_instanceof(const ScrDyn *d, int k) {
  if (!dyn_cls_ops_error_rooted(d)) return false;
  size_t pre = scr_dyn_objinst_pre(d);
  return scr_error_vts[k].pre <= pre && pre <= scr_error_vts[k].post;
}

static const ScrDynClassOps dyn_cls_ops_impl = {
  dyn_cls_impl_box, dyn_cls_impl_of_value, dyn_cls_impl_error_box,
  dyn_cls_impl_err_get, dyn_cls_impl_err_set, dyn_cls_impl_err_has, dyn_cls_impl_err_delete,
  dyn_cls_ops_fn_get, dyn_cls_ops_construct, dyn_cls_ops_set, dyn_cls_ops_delete, dyn_cls_ops_walk_error,
  dyn_cls_ops_error_rooted, dyn_cls_ops_error_instanceof,
};

void scr_dyn_class_install(void) { scr_dyn_class_ops = &dyn_cls_ops_impl; }
