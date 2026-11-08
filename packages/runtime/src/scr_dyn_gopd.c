/* Object.getOwnPropertyDescriptor over a dyn receiver, one answer per dyn kind (the compiler links this unit only for a program that
 * lowers that call: moduleUsesDynGopd).
 *
 * The answer is JS's: undefined when the receiver has no OWN property of that name, otherwise a fresh descriptor object whose
 * properties are, in V8's order, `value, writable, enumerable, configurable` for a data property and `get, set, enumerable,
 * configurable` for an accessor. The own-property sets are exactly scr_dyn_has_own's (the SAME question, so presence and the
 * descriptor cannot disagree); this file adds the ATTRIBUTES:
 *
 *   OBJ        an own member is an ordinary data property (all three true); the hidden table (scr_dyn_obj_hidden_attrs) carries the
 *              non-enumerable data properties and the accessors with their real flags
 *   ARR        an index is {writable, enumerable, configurable} true (all but writable/configurable on a FROZEN array), `length` is
 *              {writable true (false when frozen), enumerable false, configurable false}; the named extras are ordinary data
 *   STR        an index is {writable false, enumerable true, configurable false}, `length` {false, false, false}
 *   BYTES      an index is an ordinary data property; `length` is NOT own (a getter on %TypedArray%.prototype)
 *   FUNC       `name` and `length` {writable false, enumerable false, configurable true}, `prototype` {writable true, enumerable
 *              false, configurable false}, and the own-property table of the closure (member = ordinary data, hidden table =
 *              its own flags)
 *   OBJINST    a declared field is an ordinary data property (enumerable per the member row); methods live on the prototype
 *   HANDLE     the handle's own-property table, then the hook the date unit installs for its extras
 *   others     ARRBUF, MAP, PROMISE, PROXY (the target / trap path), JSVAL (the engine's own descriptor), BOOL / NUM / BIG
 *              (wrapper objects with no own properties): the answers below
 *   nullish    TypeError "Cannot convert undefined or null to object", exactly Object.hasOwn's. */
#include "scr_runtime.h"

#include <stdio.h>
#include <string.h>

static ScrDyn *gopd_flag(bool b) { return scr_dyn_new_bool(b); }

/* { value, writable, enumerable, configurable }; `value` is MOVED in. */
static ScrDyn *gopd_data(ScrDyn *value, bool writable, bool enumerable, bool configurable) {
  ScrDyn *o = scr_dyn_new_obj();
  scr_dyn_obj_set(o, "value", 5, value);
  scr_dyn_obj_set(o, "writable", 8, gopd_flag(writable));
  scr_dyn_obj_set(o, "enumerable", 10, gopd_flag(enumerable));
  scr_dyn_obj_set(o, "configurable", 12, gopd_flag(configurable));
  return o;
}

/* { get, set, enumerable, configurable }; both halves are MOVED in. */
static ScrDyn *gopd_accessor(ScrDyn *getter, ScrDyn *setter, bool enumerable, bool configurable) {
  ScrDyn *o = scr_dyn_new_obj();
  scr_dyn_obj_set(o, "get", 3, getter);
  scr_dyn_obj_set(o, "set", 3, setter);
  scr_dyn_obj_set(o, "enumerable", 10, gopd_flag(enumerable));
  scr_dyn_obj_set(o, "configurable", 12, gopd_flag(configurable));
  return o;
}

static ScrDyn *gopd_undefined(void) { return scr_dyn_retain(scr_dyn_undefined()); }

static bool gopd_index(const ScrStr *key, size_t *out) {
  if (key->len == 0 || key->len > 15) return false;
  if (key->len > 1 && key->data[0] == '0') return false;
  size_t idx = 0;
  for (size_t i = 0; i < key->len; i++) {
    char c = key->data[i];
    if (c < '0' || c > '9') return false;
    idx = idx * 10 + (size_t)(c - '0');
  }
  *out = idx;
  return true;
}

/* An OBJ's own property: the member table (ordinary data), else the hidden table (its recorded flags). NULL when absent. */
static ScrDyn *gopd_obj(const ScrDyn *v, const char *key, size_t len) {
  bool is_data = true, writable = false, configurable = false, enumerable = false;
  if (scr_dyn_obj_hidden_attrs(v, key, len, &is_data, &writable, &configurable, &enumerable)) {
    const ScrDyn *h = scr_dyn_ext(v)->hidden;
    const ScrDyn *row = h != NULL ? scr_dyn_obj_get(h, key, len) : NULL;
    if (row != NULL && row->kind == SCR_DYN_ARR && row->v.arr.len >= 3) {
      if (is_data) return gopd_data(scr_dyn_retain(scr_dyn_elem_val(row->v.arr.items[1])), writable, enumerable, configurable);
      return gopd_accessor(scr_dyn_retain(scr_dyn_elem_val(row->v.arr.items[1])), scr_dyn_retain(scr_dyn_elem_val(row->v.arr.items[2])),
                           enumerable, configurable);
    }
  }
  ScrDyn *m = scr_dyn_obj_get(v, key, len);
  if (m != NULL) return gopd_data(scr_dyn_retain(m), true, true, true);
  return NULL;
}


/* FromPropertyDescriptor(CompletePropertyDescriptor(ToPropertyDescriptor(r))) for a proxy trap's answer: undefined stays undefined, a non-object is
 * V8's TypeError, an object becomes the complete descriptor (an accessor when it carries get or set, else data; absent flags default to false). */
static ScrDyn *gopd_complete_trap_result(ScrDyn *r, const ScrStr *key) {
  if (r == NULL) return NULL;
  if (r->kind == SCR_DYN_UNDEF) return r;
  if (r->kind != SCR_DYN_OBJ) {
    char msg[320];
    int n = snprintf(msg, sizeof msg, "'getOwnPropertyDescriptor' on proxy: trap returned neither object nor undefined for property '%.*s'",
                     (int)(key->len > 128 ? 128 : key->len), key->data);
    scr_dyn_release(r);
    scr_throw_error_msg(SCR_ERR_TYPE, msg, (size_t)(n < 0 ? 0 : n));
    return NULL;
  }
  const ScrDyn *get = scr_dyn_obj_get(r, "get", 3), *set = scr_dyn_obj_get(r, "set", 3);
  const ScrDyn *en = scr_dyn_obj_get(r, "enumerable", 10), *co = scr_dyn_obj_get(r, "configurable", 12);
  const bool e = en != NULL && scr_dyn_truthy(en), c = co != NULL && scr_dyn_truthy(co);
  ScrDyn *out;
  if (get != NULL || set != NULL) {
    out = gopd_accessor(scr_dyn_retain(get != NULL ? get : scr_dyn_undefined()), scr_dyn_retain(set != NULL ? set : scr_dyn_undefined()), e, c);
  } else {
    const ScrDyn *val = scr_dyn_obj_get(r, "value", 5), *wr = scr_dyn_obj_get(r, "writable", 8);
    out = gopd_data(scr_dyn_retain(val != NULL ? val : scr_dyn_undefined()), wr != NULL && scr_dyn_truthy(wr), e, c);
  }
  scr_dyn_release(r);
  return out;
}

ScrDyn *scr_dyn_get_own_desc(ScrDyn *v, ScrStr *key) {
  if (v->kind == SCR_DYN_UNDEF || v->kind == SCR_DYN_NULL) {
    const char *m = "Cannot convert undefined or null to object";
    scr_throw_error_msg(SCR_ERR_TYPE, m, strlen(m));
    return NULL;
  }
  const char *k = key->data;
  size_t kl = key->len;
  switch (v->kind) {
    case SCR_DYN_OBJ: {
      ScrDyn *d = gopd_obj(v, k, kl);
      return d != NULL ? d : gopd_undefined();
    }
    case SCR_DYN_ARR: {
      bool frozen = scr_dyn_arr_is_frozen(v);
      if (kl == 6 && memcmp(k, "length", 6) == 0) return gopd_data(scr_dyn_new_num((double)v->v.arr.len), !frozen, false, false);
      size_t idx = 0;
      if (gopd_index(key, &idx)) {
        if (idx < v->v.arr.len && !scr_dyn_is_hole(v->v.arr.items[idx])) {
          return gopd_data(scr_dyn_retain(v->v.arr.items[idx]), !frozen, true, !frozen);
        }
        return gopd_undefined();
      }
      ScrDyn *x = scr_dyn_arr_extras(v);
      if (x != NULL) {
        ScrDyn *d = gopd_obj(x, k, kl);
        if (d != NULL) return d;
      }
      return gopd_undefined();
    }
    case SCR_DYN_STR: {
      double n = scr_str_utf16_len(v->v.str);
      if (kl == 6 && memcmp(k, "length", 6) == 0) return gopd_data(scr_dyn_new_num(n), false, false, false);
      size_t idx = 0;
      if (gopd_index(key, &idx) && (double)idx < n) {
        ScrStr *c = scr_str_char_at(v->v.str, (double)idx);
        ScrDyn *cv = scr_dyn_new_str(c);
        scr_str_release(c);
        return gopd_data(cv, false, true, false);
      }
      return gopd_undefined();
    }
    case SCR_DYN_BYTES: {
      size_t idx = 0;
      if (gopd_index(key, &idx) && idx < v->v.bytes->len) return gopd_data(scr_dyn_bytes_elem(v->v.bytes, idx), true, true, true);
      if (v->v.bytes->own != NULL) {
        /* an own expando of the view: the same all-true data property a write created */
        ScrDyn *m = scr_bytes_own_ops->get(v->v.bytes, k, kl);
        if (m != NULL) return gopd_data(scr_dyn_retain(m), true, true, true);
      }
      return gopd_undefined();
    }
    case SCR_DYN_FUNC: {
      if (!scr_dyn_fn_has_own(v, k, kl)) return gopd_undefined();
      const bool is_class = scr_dyn_class_ops != NULL && scr_dyn_class_ops->class_of_value != NULL && scr_dyn_class_ops->class_of_value(v) != NULL;
      ScrDyn *table = v->v.fn.clo->props != NULL ? (ScrDyn *)scr_box_get_ref(v->v.fn.clo->props) : NULL; /* +1 */
      /* a property the program DEFINED with its own flags (the hidden table) wins over everything below */
      if (table != NULL && scr_dyn_obj_hidden_attrs(table, k, kl, NULL, NULL, NULL, NULL)) {
        ScrDyn *d = gopd_obj(table, k, kl);
        scr_dyn_release(table);
        if (d != NULL) return d;
        table = NULL;
      }
      const bool is_name = kl == 4 && memcmp(k, "name", 4) == 0, is_len = kl == 6 && memcmp(k, "length", 6) == 0,
                 is_proto = kl == 9 && memcmp(k, "prototype", 9) == 0;
      if (is_name || is_len || is_proto) {
        if (table != NULL) scr_dyn_release(table);
        ScrDyn *val = scr_dyn_fn_get(v, k, kl);
        if (val == NULL) return NULL;
        if (is_proto) return gopd_data(val, !is_class, false, false);
        return gopd_data(val, false, false, true);
      }
      if (is_class) {
        /* a class's static: a method is non-enumerable, a static FIELD is an ordinary data property; the class unit's own enumeration
         * says which names are the enumerable ones */
        if (table != NULL) scr_dyn_release(table);
        ScrDyn *val = scr_dyn_fn_get(v, k, kl);
        if (val == NULL) return NULL;
        bool enumerable = false;
        ScrDyn *names = scr_dyn_new_arr();
        if (scr_dyn_class_ops->class_walk != NULL && scr_dyn_class_ops->class_walk(v, SCR_OBJWALK_KEYS, names) == 1) {
          for (size_t i = 0; i < names->v.arr.len; i++) {
            const ScrDyn *n = names->v.arr.items[i];
            if (n->kind == SCR_DYN_STR && n->v.str->len == kl && memcmp(n->v.str->data, k, kl) == 0) enumerable = true;
          }
        }
        scr_dyn_release(names);
        return gopd_data(val, true, enumerable, true);
      }
      if (table != NULL) {
        ScrDyn *d = gopd_obj(table, k, kl);
        scr_dyn_release(table);
        if (d != NULL) return d;
      }
      ScrDyn *val = scr_dyn_fn_get(v, k, kl);
      if (val == NULL) return NULL;
      return gopd_data(val, true, true, true);
    }
    case SCR_DYN_OBJINST: {
      const ScrDynClassMember *cm = scr_dyn_objinst_member(v, k, kl);
      if (cm != NULL && cm->get != NULL && scr_dyn_has_own(v, key)) {
        ScrDyn *val = cm->get(v->v.inst.o);
        return gopd_data(val, true, cm->enumerable != 0, true);
      }
      return gopd_undefined();
    }
    case SCR_DYN_HANDLE: {
      /* a native handle's own properties: the expando table (ordinary data), then the members the owning unit makes own (a Stats box's cached time
       * members), whose value the handle's own read answers */
      const ScrDynHandleOps *hops = scr_dyn_handle_ops_of(v);
      /* a RegExp's own `lastIndex` (the one own property of a regular expression): {writable true, enumerable false, configurable false} */
      if (v->v.handle.tag == SCR_DYNH_REGEX && kl == 9 && memcmp(k, "lastIndex", 9) == 0) {
        ScrDyn *li = hops->get != NULL ? hops->get(v->v.handle.ptr, k, kl) : NULL;
        if (li == NULL && scr_exc_pending()) return NULL;
        return gopd_data(li != NULL ? li : scr_dyn_new_num(0), true, false, false);
      }
      ScrDyn *own = hops->own_props != NULL ? hops->own_props(v->v.handle.ptr) : NULL;
      if (own != NULL && own->kind == SCR_DYN_OBJ) {
        ScrDyn *d = gopd_obj(own, k, kl);
        if (d != NULL) return d;
      }
      if (scr_handle_own_extra_hook != NULL && scr_handle_own_extra_hook(v, k, kl) && hops->get != NULL) {
        ScrDyn *val = hops->get(v->v.handle.ptr, k, kl);
        if (val != NULL) return gopd_data(val, true, true, true);
        if (scr_exc_pending()) return NULL;
      }
      return gopd_undefined();
    }
    case SCR_DYN_PROXY: {
      /* the handler's getOwnPropertyDescriptor trap runs with the target and the key; without a trap the answer is the target's own */
      bool threw = false;
      ScrDyn *trap = scr_dyn_proxy_ops_ptr->trap(v, "getOwnPropertyDescriptor", &threw);
      if (trap == NULL) return threw ? NULL : scr_dyn_get_own_desc(v->v.proxy.target, key);
      ScrDyn *kd = scr_dyn_new_str(key);
      ScrDyn *args[2] = {v->v.proxy.target, kd};
      scr_dyn_this_push_dyn(v->v.proxy.handler);
      ScrDyn *r = scr_dyn_call(trap, args, 2, "getOwnPropertyDescriptor");
      scr_dyn_this_pop();
      scr_dyn_release(kd);
      scr_dyn_release(trap);
      return gopd_complete_trap_result(r, key);
    }
    case SCR_DYN_JSVAL: {
      ScrDyn *kd = scr_dyn_new_str(key);
      ScrDyn *r = scr_dyn_jsval_ops()->get_own_desc(v->v.jsval.cell, kd);
      scr_dyn_release(kd);
      return r;
    }
    case SCR_DYN_BOOL:
    case SCR_DYN_NUM:
    case SCR_DYN_BIG:
    case SCR_DYN_ARRBUF:
    case SCR_DYN_MAP:
    case SCR_DYN_PROMISE:
    default:
      return gopd_undefined();
  }
}

/* The untyped-key arm (a key that may be a symbol handle). It lives here, the one unit a program links for sym.anyGetOwnDesc (which implies the
 * symbol unit is linked too), so the symbol unit never names this one. */
ScrDyn *scr_dyn_any_get_own_desc(ScrDyn *recv, ScrDyn *key, ScrStr *keystr) {
  const bool is_sym = key->kind == SCR_DYN_HANDLE && key->v.handle.tag == SCR_DYNH_SYMBOL && key->v.handle.ptr != NULL;
  return is_sym ? scr_dyn_sym_get_own_desc(recv, (ScrSym *)key->v.handle.ptr) : scr_dyn_get_own_desc(recv, keystr);
}
