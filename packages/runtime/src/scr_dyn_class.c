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
  if (scr_dyn_objinst_class_of(v)->rt_root != 0) {
    /* A class rooted in the runtime's EventEmitter has the own enumerable keys _events,
     * _eventsCount and _maxListeners ahead of the program's fields. The key LIST is a fact of
     * the class (the values are the emitter's own state, which no row states), so Object.keys
     * answers it; values, entries and every class rooted in a stream (whose prefix is far
     * larger) or carrying a run-time property table keep the loud fence rather than a silently
     * short answer. */
    if (scr_dyn_objinst_class_of(v)->rt_root != 1 || mode != SCR_OBJWALK_KEYS) {
      scr_dyn_objinst_fence(v, mode == SCR_OBJWALK_KEYS ? "Object.keys" : mode == SCR_OBJWALK_VALUES ? "Object.values" : "Object.entries");
      return NULL;
    }
    ScrDyn *keys = scr_dyn_new_arr();
    static const char *const pre[] = {"_events", "_eventsCount", "_maxListeners"};
    for (size_t i = 0; i < 3; i++) scr_dyn_arr_push(keys, dyn_cls_objwalk_key(pre[i], strlen(pre[i])));
    const size_t nm = scr_dyn_objinst_member_count(v);
    for (size_t i = 0; i < nm; i++) {
      const ScrDynClassMember *m = scr_dyn_objinst_member_at(v, i);
      if (scr_dyn_member_hidden(m, v->v.inst.o)) continue;
      scr_dyn_arr_push(keys, dyn_cls_objwalk_key(m->name, m->len));
    }
    return keys;
  }
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

/* ── ToPrimitive over a class instance that DECLARES valueOf or toString ──
 * Moved here from scr_json.c so a program that declares no class never links
 * it. The member table carries the methods (scr_dyn_objinst_member, which reads
 * the instance's own class), so the answer is the same whichever spelling
 * reached it. OrdinaryToPrimitive: the STRING hint runs toString then valueOf,
 * the DEFAULT and NUMBER hints run valueOf then toString. A missing user method
 * falls through to the next one; the built-in table answers once both are gone
 * (scr_dyn_objinst_builtin_prim). A method that throws leaves the exception
 * pending and answers NULL. */
/* A primitive answer (the same kinds scr_json.c's scr_dyn_is_prim names). */
static bool dyn_cls_is_prim(const ScrDyn *d) {
  switch (d->kind) {
  case SCR_DYN_NUM:
  case SCR_DYN_STR:
  case SCR_DYN_BOOL:
  case SCR_DYN_NULL:
  case SCR_DYN_UNDEF: return true;
  default: return false;
  }
}

/* A callable answer: a function box, or a function held by the island engine. */
static bool dyn_cls_is_callable(const ScrDyn *v) {
  return v->kind == SCR_DYN_FUNC || (v->kind == SCR_DYN_JSVAL && scr_dyn_isl_typeof_is(v, "function"));
}

/* One ToPrimitive step over the member row `m` (Node's OrdinaryToPrimitive
 * Get-then-Call). A METHOD row runs with the instance as the receiver, the entry
 * the dyn method call uses. A DATA row (a declared field, or an accessor read
 * through its getter) is read, and when its value is callable it runs with the
 * instance as `this`; a non-callable value is skipped. Borrows the instance; +1
 * primitive (or BigInt), or NULL: with the exception pending when a member threw,
 * otherwise when the step did not answer a primitive. */
static ScrDyn *dyn_cls_toprim_step(const ScrDyn *d, const ScrDynClassMember *m, const char *name) {
  if (m == NULL) return NULL; /* no row: nothing to call */
  ScrDyn *r = NULL;
  if (m->call != NULL) {
    r = m->call(d->v.inst.o, NULL, 0, name);
  } else {
    ScrDyn *fv = m->get != NULL ? m->get(d->v.inst.o) : NULL; /* +1; NULL: the read threw */
    if (fv == NULL) return NULL;
    if (dyn_cls_is_callable(fv)) {
      scr_dyn_this_push_dyn(d);
      r = scr_dyn_call(fv, NULL, 0, name);
      scr_dyn_this_pop();
    }
    scr_dyn_release(fv);
  }
  if (r == NULL) return NULL; /* threw (pending), or not callable */
  if (dyn_cls_is_prim(r) || r->kind == SCR_DYN_BIG) return r; /* +1 */
  scr_dyn_release(r); /* an object answer: OrdinaryToPrimitive goes on */
  return NULL;
}

/* ToPrimitive over a class instance, in OrdinaryToPrimitive order. The STRING hint
 * asks toString then valueOf; DEFAULT and NUMBER ask valueOf then toString. A member
 * row is read by name through the table, so an own FIELD holding a function answers
 * exactly as a method does, and a field holding a non-callable value is skipped.
 * With no toString row, Object.prototype.toString answers a primitive and the chain
 * stops at the built-in table. With a toString row and no primitive answer, the
 * chain is exhausted: TypeError. */
static ScrDyn *dyn_cls_objinst_to_primitive(const ScrDyn *d, int hint) {
  const ScrDynClassMember *tm = scr_dyn_objinst_member(d, "toString", 8);
  const ScrDynClassMember *vm = scr_dyn_objinst_member(d, "valueOf", 7);
  ScrDyn *r;
  if (hint == SCR_TOPRIM_STRING) {
    if (tm == NULL) return scr_dyn_objinst_builtin_prim(d);
    r = dyn_cls_toprim_step(d, tm, "toString");
    if (r != NULL || scr_exc_pending()) return r;
    r = dyn_cls_toprim_step(d, vm, "valueOf");
    if (r != NULL || scr_exc_pending()) return r;
  } else {
    r = dyn_cls_toprim_step(d, vm, "valueOf");
    if (r != NULL || scr_exc_pending()) return r;
    if (tm == NULL) return scr_dyn_objinst_builtin_prim(d);
    r = dyn_cls_toprim_step(d, tm, "toString");
    if (r != NULL || scr_exc_pending()) return r;
  }
  static const char msg[] = "Cannot convert object to primitive value";
  scr_throw_error_msg(SCR_ERR_TYPE, msg, sizeof msg - 1);
  return NULL;
}

/* util.format %s over a class instance: Node's hasBuiltInToString asks whether
 * `value.toString` is a function. A method row is one; so is a data row holding a
 * callable (the instance's own property). Returns 1 when it is, 0 when not, and 2
 * when reading the field threw (the exception stays pending). */
static int dyn_cls_objinst_user_tostring(const ScrDyn *d) {
  const ScrDynClassMember *cm = scr_dyn_objinst_member(d, "toString", 8);
  if (cm == NULL) return 0;
  if (cm->call != NULL) return 1;
  ScrDyn *fv = cm->get != NULL ? cm->get(d->v.inst.o) : NULL;
  if (fv == NULL) return scr_exc_pending() ? 2 : 0;
  int user = dyn_cls_is_callable(fv) ? 1 : 0;
  scr_dyn_release(fv);
  return user;
}

/* ToString(object) for a class instance: ToPrimitive with the STRING hint, then
 * ToString of the primitive. A class with no member table and no Error root has
 * no protocol at all: the built-in fence answers (String()'s wording). */
static ScrStr *dyn_cls_objinst_to_string(const ScrDyn *d) {
  if (!scr_dyn_objinst_has_members(d) && !scr_dyn_objinst_error_rooted(d)) return scr_dyn_objinst_builtin_string(d);
  ScrDyn *p = dyn_cls_objinst_to_primitive(d, SCR_TOPRIM_STRING);
  if (p == NULL) return scr_str_new("", 0); /* pending */
  ScrStr *ps = scr_dyn_string_coerce(p);
  scr_dyn_release(p);
  return ps;
}

static const ScrDynClassOps dyn_cls_ops_impl = {
  dyn_cls_impl_box, dyn_cls_impl_of_value,
  dyn_cls_impl_err_get, dyn_cls_impl_err_set, dyn_cls_impl_err_has, dyn_cls_impl_err_delete,
  dyn_cls_ops_fn_get, dyn_cls_ops_construct, dyn_cls_ops_set, dyn_cls_ops_delete, dyn_cls_ops_walk_error,
  dyn_cls_ops_error_rooted, dyn_cls_ops_error_instanceof,
  dyn_cls_objinst_to_primitive, dyn_cls_objinst_to_string, dyn_cls_objinst_user_tostring,
};

void scr_dyn_class_install(void) { scr_dyn_class_ops = &dyn_cls_ops_impl; }


/* ── for-in over an EventEmitter subclass: the inherited enumerable keys ────────
 * ECMAScript EnumerateObjectProperties visits an instance's own enumerable keys,
 * then the enumerable keys of each prototype up the chain, once per name. For an
 * EventEmitter subclass the chain reaches EventEmitter.prototype, whose enumerable
 * string keys are the 15 below, in Node's order (for (k in EventEmitter.prototype)
 * on the pinned Node, v24.15.0). Object.keys, JSON and util.inspect do NOT walk the
 * chain, so only for-in uses this. A subclass member of the same name shadows the
 * prototype key (JS skips a shadowed name, enumerable or not).
 * packages/compiler/test/runtime-proto-keys.test.ts fails if Node's list changes. */
static const char *const SCR_EE_PROTO_KEYS[] = {
  /* the first three are the emitter's own state (the prototype carries them too): an instance
   * lists them as its own keys, so the appended walk skips them (scr_dyn_forin_keys). */
  "_events", "_eventsCount", "_maxListeners",
  "setMaxListeners", "getMaxListeners", "emit", "addListener", "on", "prependListener", "once",
  "prependOnceListener", "removeListener", "off", "removeAllListeners", "listeners", "rawListeners",
  "listenerCount", "eventNames",
};
#define SCR_EE_PROTO_KEY_COUNT (sizeof SCR_EE_PROTO_KEYS / sizeof SCR_EE_PROTO_KEYS[0])

static bool ee_proto_key_index(const char *s, size_t n, size_t *idx) {
  for (size_t i = 0; i < SCR_EE_PROTO_KEY_COUNT; i++) {
    if (strlen(SCR_EE_PROTO_KEYS[i]) == n && memcmp(SCR_EE_PROTO_KEYS[i], s, n) == 0) {
      *idx = i;
      return true;
    }
  }
  return false;
}

/* True for an instance whose chain is rooted in the runtime's EventEmitter. */
static bool ee_rooted_instance(const ScrDyn *v) {
  return v != NULL && v->kind == SCR_DYN_OBJINST && scr_dyn_objinst_class_of(v)->rt_root == 1;
}

ScrDyn *scr_dyn_forin_keys(const ScrDyn *v) {
  ScrDyn *keys = scr_dyn_obj_keys(v);
  /* A native handle's inherited enumerable members (a Stats box's prototype, listed by its unit). */
  if (keys != NULL && v->kind == SCR_DYN_HANDLE && scr_handle_forin_hook != NULL && keys->kind == SCR_DYN_ARR) {
    scr_handle_forin_hook(v, keys);
  }
  if (keys == NULL || !ee_rooted_instance(v)) return keys;
  for (size_t i = 3; i < SCR_EE_PROTO_KEY_COUNT; i++) { /* [0..2] are the emitter's own keys, listed already */
    const char *name = SCR_EE_PROTO_KEYS[i];
    const size_t len = strlen(name);
    if (scr_dyn_objinst_member(v, name, len) != NULL) continue; /* shadowed by a member */
    scr_dyn_arr_push(keys, dyn_cls_objwalk_key(name, len));
  }
  return keys;
}

/* A key for-in visits WITHOUT a value check, on an EventEmitter-rooted instance: one of the
 * emitter's own keys (_events, _eventsCount, _maxListeners: created by its constructor, so
 * Node visits them even when undefined), a visible member, or an inherited EventEmitter.prototype
 * key that no member shadows. */
bool scr_dyn_forin_certain(const ScrDyn *v, const ScrStr *key) {
  /* A native handle's inherited member (no own shadow): visited without a value check. */
  if (v->kind == SCR_DYN_HANDLE && key != NULL && scr_handle_inherited_has_hook != NULL &&
      scr_handle_inherited_has_hook(v, key->data, key->len)) {
    return true;
  }
  if (!ee_rooted_instance(v) || key == NULL) return false;
  const char *s = key->data;
  const size_t n = key->len;
  static const char *const own_pre[] = {"_events", "_eventsCount", "_maxListeners"};
  for (size_t i = 0; i < 3; i++) {
    if (strlen(own_pre[i]) == n && memcmp(own_pre[i], s, n) == 0) return true;
  }
  const ScrDynClassMember *m = scr_dyn_objinst_member(v, s, n);
  if (m != NULL) return !scr_dyn_member_hidden(m, v->v.inst.o);
  size_t idx = 0;
  return ee_proto_key_index(s, n, &idx);
}

/* for-in's own-key test for every receiver that is NOT EventEmitter-rooted (the same answer
 * Object.hasOwn gives). EventEmitter-rooted instances answer through scr_dyn_forin_certain. */
bool scr_dyn_forin_plain(const ScrDyn *v, const ScrStr *key) {
  if (ee_rooted_instance(v)) return false;
  return scr_dyn_has_own(v, key);
}
