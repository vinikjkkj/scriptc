/* scr_dyn_proto.c -- intrinsic prototype values, primitive wrapper objects and builtin function values over the checked-dynamic tree.
 *
 * `Object.getPrototypeOf(x)`, `Object.prototype` as a value, `Object(x)` over a dyn (the wrapper objects) and the builtin
 * constructor/method values a prototype sentinel answers (`Object`, `Array`, `Function`, `hasOwnProperty`, ...) live here, NOT in
 * scr_json.c: every program that links the dyn core would otherwise pay for machinery only the programs using those features
 * reach. The unit is a LINK GATE (moduleUsesDynProto on the IR: the dyn.getPrototypeOf / dyn.objectPrototype / dyn.toObject /
 * dyn.unwrapPrim / dyn.objectCtor libCalls). The dyn core reaches it only through scr_dyn_proto_ops, which this unit's
 * constructor installs; without the unit no wrapper or sentinel can exist, and the forwarders in scr_json.c answer "none". */

#include "scr_runtime.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* INTRINSIC PROTOTYPE VALUES. `Object.prototype`, `Array.prototype`, a class's `C.prototype` and the rest are not
 * modelled as objects with their members, but a program that asks `Object.getPrototypeOf(x) === Object.prototype` (or
 * compares two prototypes) needs them to be VALUES with identity. Each is one immortal empty object, minted on first use:
 * identity, `typeof`, `=== null` and the plain-object test answer as in Node; a read of a member the intrinsic really
 * carries (`Object.prototype.hasOwnProperty`) is NOT answered by them (it reads as absent), which is why the lowering only
 * hands them out where the program compares or passes them. */
static ScrDyn *scr_dyn_object_prototype_mint(void);
static ScrDyn *scr_dyn_intrinsic_slot(ScrDyn **slot) {
  if (*slot == NULL) {
    ScrDyn *d = scr_dyn_new_obj();
    scr_dyn_make_immortal(d);
    *slot = d;
    /* Every intrinsic other than Object.prototype itself inherits from it. */
    scr_dyn_obj_set_proto(d, scr_dyn_object_prototype_mint());
  }
  return *slot;
}

static ScrDyn *scr_dyn_object_prototype_mint(void) {
  static ScrDyn *object_proto;
  if (object_proto == NULL) {
    ScrDyn *d = scr_dyn_new_obj_null_proto(); /* Object.prototype's own [[Prototype]] is null */
    scr_dyn_make_immortal(d);
    object_proto = d;
  }
  return object_proto;
}

ScrDyn *scr_dyn_object_prototype(void) { return scr_dyn_object_prototype_mint(); }

/* PRIMITIVE WRAPPER OBJECTS (`Object("s")`, `Object(5)`, `Object(false)`, `Object(1n)`): an ordinary dynamic object whose
 * constructor name is String / Number / Boolean / BigInt and whose primitive lives in the internal-slot table under `%prim`
 * (nothing else reads that table, so it is never enumerated or forged). typeof, truthiness (always true, `new Boolean(false)`
 * included) and identity (a fresh wrapper per call, `w === w`) are the plain object's; ToPrimitive, [[Get]] of `length` and
 * the indices of a String wrapper, method calls (they bind the primitive), util.inspect and JSON.stringify unwrap it at their
 * own sites. */
ScrDyn *scr_dyn_wrapper_new(const ScrDyn *prim) {
  ScrDyn *w = scr_dyn_new_obj();
  scr_dyn_obj_set_slot(w, "%prim", 5, scr_dyn_retain((ScrDyn *)prim));
  const char *cn = prim->kind == SCR_DYN_STR ? "String" : prim->kind == SCR_DYN_NUM ? "Number" : prim->kind == SCR_DYN_BOOL ? "Boolean" : scr_dyn_is_symbol(prim) ? "Symbol" : "BigInt";
  scr_dyn_obj_set_ctor_name(w, cn);
  return w;
}

/* The wrapped primitive (borrowed), or NULL when `d` is not a wrapper object. */
static const ScrDyn *proto_wrapper_prim(const ScrDyn *d) {
  if (d == NULL || d->kind != SCR_DYN_OBJ) return NULL;
  return scr_dyn_obj_slot_get(d, "%prim", 5);
}

/* The primitive a wrapper object holds, or `d` itself for anything else (+1): the receiver a primitive method call binds. */
ScrDyn *scr_dyn_unwrap_prim(const ScrDyn *d) {
  const ScrDyn *wp = scr_dyn_wrapper_prim(d);
  return scr_dyn_retain((ScrDyn *)(wp != NULL ? wp : d));
}

/* Object(d), +1 (ToObject over one argument): null and undefined answer a fresh empty object, an object-like value answers
 * itself (identity), and a primitive answers a fresh wrapper object. */
ScrDyn *scr_dyn_to_object(const ScrDyn *d) {
  switch (d->kind) {
    case SCR_DYN_NULL:
    case SCR_DYN_UNDEF:
      return scr_dyn_new_obj();
    case SCR_DYN_BOOL:
    case SCR_DYN_NUM:
    case SCR_DYN_STR:
    case SCR_DYN_BIG:
      return scr_dyn_wrapper_new(d);
    default:
      if (scr_dyn_is_symbol(d)) return scr_dyn_wrapper_new(d); /* Object(sym): a Symbol wrapper */
      return scr_dyn_retain((ScrDyn *)d);
  }
}

/* Object.getPrototypeOf(d), +1. A null-prototype dictionary answers null; an object with its own [[Prototype]] (a
 * constructor's instance, Object.create(p)) answers that object; a plain object Object.prototype; every other kind its
 * intrinsic (one per kind, one per class for a boxed class instance). null and undefined throw Node's TypeError. */
static ScrDyn *kind_protos[64];
static const ScrDynClass *class_keys[64];
static ScrDyn *class_protos[64];
static size_t class_n;

/* THE BUILTIN MEMBERS OF THE INTRINSIC PROTOTYPES. A sentinel above is an empty object, so a read of a member the real
 * prototype carries is answered here, by name, with a native function value (cached, released at exit): Object.prototype's
 * constructor, hasOwnProperty, isPrototypeOf, propertyIsEnumerable, toString, valueOf, toLocaleString, and the `constructor`
 * of the Array, Function, String, Number and Boolean prototypes. Every function binds its receiver the way a method does
 * (scr_dyn_this_get), so `proto.hasOwnProperty.call(o, k)` and `Object.prototype.toString.call(x)` work. */
static const ScrDynClass *scr_dyn_class_of_sentinel(const ScrDyn *d) {
  for (size_t i = 0; i < class_n; i++) if (class_protos[i] == d) return class_keys[i];
  return NULL;
}
static bool proto_is_intrinsic(const ScrDyn *d) {
  if (d == NULL || d->kind != SCR_DYN_OBJ || d->rc != SIZE_MAX) return false;
  if (d == scr_dyn_object_prototype()) return true;
  for (size_t i = 0; i < 64; i++) if (kind_protos[i] == d) return true;
  for (size_t i = 0; i < class_n; i++) if (class_protos[i] == d) return true;
  return false;
}

static ScrDyn *scr_builtin_this_object(void) {
  ScrDyn *t = scr_dyn_this_get();
  if (t->kind == SCR_DYN_UNDEF || t->kind == SCR_DYN_NULL) {
    scr_dyn_release(t);
    scr_throw_error(SCR_ERR_TYPE, scr_str_new("Cannot convert undefined or null to object", 42));
    return NULL;
  }
  return t;
}

static ScrDyn *scr_builtin_has_own(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  ScrDyn *t = scr_builtin_this_object();
  if (t == NULL) return NULL;
  ScrStr *k = argc > 0 ? scr_dyn_string_coerce(args[0]) : scr_str_new("undefined", 9);
  bool r = scr_dyn_has_own(t, k);
  scr_str_release(k);
  scr_dyn_release(t);
  return scr_dyn_new_bool(r);
}

static ScrDyn *scr_builtin_prop_is_enum(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  ScrDyn *t = scr_builtin_this_object();
  if (t == NULL) return NULL;
  ScrStr *k = argc > 0 ? scr_dyn_string_coerce(args[0]) : scr_str_new("undefined", 9);
  bool r = t->kind == SCR_DYN_OBJ ? scr_dyn_obj_own_data(t, k->data, k->len) != NULL : scr_dyn_has_own(t, k) && !(t->kind == SCR_DYN_ARR && k->len == 6 && memcmp(k->data, "length", 6) == 0);
  scr_str_release(k);
  scr_dyn_release(t);
  return scr_dyn_new_bool(r);
}

static ScrDyn *scr_builtin_is_proto_of(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  ScrDyn *t = scr_builtin_this_object();
  if (t == NULL) return NULL;
  bool found = false;
  if (argc > 0 && args[0]->kind != SCR_DYN_NULL && args[0]->kind != SCR_DYN_UNDEF && args[0]->kind != SCR_DYN_BOOL && args[0]->kind != SCR_DYN_NUM && args[0]->kind != SCR_DYN_STR && args[0]->kind != SCR_DYN_BIG) {
    ScrDyn *cur = scr_dyn_get_prototype_of(args[0]);
    for (int guard = 0; guard < 1024 && cur != NULL && cur->kind != SCR_DYN_NULL; guard++) {
      if (cur == t) {
        found = true;
        break;
      }
      ScrDyn *next = scr_dyn_get_prototype_of(cur);
      scr_dyn_release(cur);
      cur = next;
    }
    if (cur != NULL) scr_dyn_release(cur);
  }
  scr_dyn_release(t);
  return scr_dyn_new_bool(found);
}

/* Object.prototype.toString.call(x): "[object " + the class tag + "]". */
static ScrDyn *scr_builtin_to_string(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo; (void)args; (void)argc;
  ScrDyn *t = scr_dyn_this_get();
  const char *tag = "Object";
  const ScrDyn *wp = scr_dyn_wrapper_prim(t);
  const ScrDyn *k = wp != NULL ? wp : t;
  switch (k->kind) {
    case SCR_DYN_NULL: tag = "Null"; break;
    case SCR_DYN_UNDEF: tag = "Undefined"; break;
    case SCR_DYN_BOOL: tag = "Boolean"; break;
    case SCR_DYN_NUM: tag = "Number"; break;
    case SCR_DYN_STR: tag = "String"; break;
    case SCR_DYN_BIG: tag = "BigInt"; break;
    case SCR_DYN_ARR: tag = "Array"; break;
    case SCR_DYN_FUNC: tag = "Function"; break;
    default: break;
  }
  char buf[40];
  int n = snprintf(buf, sizeof buf, "[object %s]", tag);
  ScrStr *r = scr_str_new(buf, (size_t)n);
  ScrDyn *out = scr_dyn_new_str(r);
  scr_str_release(r);
  scr_dyn_release(t);
  return out;
}

static ScrDyn *scr_builtin_value_of(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo; (void)args; (void)argc;
  ScrDyn *t = scr_builtin_this_object();
  if (t == NULL) return NULL;
  if (t->kind == SCR_DYN_BOOL || t->kind == SCR_DYN_NUM || t->kind == SCR_DYN_STR || t->kind == SCR_DYN_BIG) {
    ScrDyn *w = scr_dyn_wrapper_new(t); /* ToObject(this): a primitive receiver answers its wrapper */
    scr_dyn_release(t);
    return w;
  }
  return t;
}

static ScrDyn *scr_builtin_object_ctor(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  if (argc == 0) return scr_dyn_new_obj();
  return scr_dyn_to_object(args[0]);
}
static ScrDyn *scr_builtin_string_ctor(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  ScrStr *r = argc == 0 ? scr_str_new("", 0) : scr_dyn_string_coerce(args[0]);
  ScrDyn *out = scr_dyn_new_str(r);
  scr_str_release(r);
  return out;
}
static ScrDyn *scr_builtin_number_ctor(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  return scr_dyn_new_num(argc == 0 ? 0.0 : scr_dyn_to_number(args[0]));
}
static ScrDyn *scr_builtin_boolean_ctor(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  return scr_dyn_new_bool(argc > 0 && scr_dyn_truthy(args[0]));
}
/* Array(...) / new Array(...): no argument is [], one argument is a LENGTH when it is a number (RangeError for an invalid one) and
 * the single element otherwise, several arguments are the elements. */
static ScrDyn *scr_builtin_array_ctor(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  if (argc == 1) return scr_dyn_new_arr_ctor1(args[0]);
  ScrDyn *a = scr_dyn_new_arr();
  for (size_t i = 0; i < argc; i++) scr_dyn_arr_push(a, scr_dyn_retain(args[i]));
  return a;
}
/* Function(...) / new Function(...): the sanctioned text path. The embedded engine (linked only into programs that can reach it)
 * registers the constructor here; without it the call names the missing engine instead of answering something else. */
static ScrDyn *scr_builtin_function_ctor(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  if (scr_function_ctor_hook != NULL) return scr_function_ctor_hook(args, argc);
  scr_throw_error(SCR_ERR_ERROR, scr_str_new("the Function constructor value needs the embedded engine, which this build does not include", 91));
  return NULL;
}

enum { SCR_BI_HASOWN, SCR_BI_ISPROTO, SCR_BI_PROPENUM, SCR_BI_TOSTRING, SCR_BI_VALUEOF, SCR_BI_TOLOCALE, SCR_BI_OBJECT, SCR_BI_ARRAY,
       SCR_BI_FUNCTION, SCR_BI_STRING, SCR_BI_NUMBER, SCR_BI_BOOLEAN, SCR_BI_COUNT };
static ScrDyn *scr_builtin_fns[SCR_BI_COUNT];
static bool scr_builtin_armed;
static void scr_builtin_teardown(void) {
  for (int i = 0; i < SCR_BI_COUNT; i++) {
    if (scr_builtin_fns[i] != NULL) {
      scr_dyn_release(scr_builtin_fns[i]);
      scr_builtin_fns[i] = NULL;
    }
  }
}
static ScrDyn *scr_builtin_fn(int which) {
  if (scr_builtin_fns[which] == NULL) {
    if (!scr_builtin_armed) {
      scr_builtin_armed = true;
      scr_atexit(scr_builtin_teardown);
    }
    static const struct { ScrDynThunk thunk; uint32_t arity; const char *name; } T[SCR_BI_COUNT] = {
      { scr_builtin_has_own, 1, "hasOwnProperty" }, { scr_builtin_is_proto_of, 1, "isPrototypeOf" },
      { scr_builtin_prop_is_enum, 1, "propertyIsEnumerable" }, { scr_builtin_to_string, 0, "toString" },
      { scr_builtin_value_of, 0, "valueOf" }, { scr_builtin_to_string, 0, "toLocaleString" },
      { scr_builtin_object_ctor, 1, "Object" }, { scr_builtin_array_ctor, 1, "Array" },
      { scr_builtin_function_ctor, 1, "Function" }, { scr_builtin_string_ctor, 1, "String" },
      { scr_builtin_number_ctor, 1, "Number" }, { scr_builtin_boolean_ctor, 1, "Boolean" },
    };
    scr_builtin_fns[which] = scr_dyn_new_func(scr_closure_new((void *)T[which].thunk, 0), T[which].thunk, T[which].arity, "()", T[which].name);
  }
  return scr_dyn_retain(scr_builtin_fns[which]);
}

/* `Object` as a value (the constructor function every plain object's prototype names). +1. */
ScrDyn *scr_dyn_object_ctor_value(void) { return scr_builtin_fn(SCR_BI_OBJECT); }

/* A member the intrinsic prototype `recv` carries by name, +1, or NULL when `recv` is not an intrinsic prototype or has no such member. */
static ScrDyn *proto_intrinsic_member(const ScrDyn *recv, const char *key, size_t key_len) {
  if (!proto_is_intrinsic(recv)) return NULL;
#define SCR_BI_IS(n) (key_len == sizeof(n) - 1 && memcmp(key, n, key_len) == 0)
  if (SCR_BI_IS("hasOwnProperty")) return scr_builtin_fn(SCR_BI_HASOWN);
  if (SCR_BI_IS("isPrototypeOf")) return scr_builtin_fn(SCR_BI_ISPROTO);
  if (SCR_BI_IS("propertyIsEnumerable")) return scr_builtin_fn(SCR_BI_PROPENUM);
  if (SCR_BI_IS("toString")) return scr_builtin_fn(SCR_BI_TOSTRING);
  if (SCR_BI_IS("toLocaleString")) return scr_builtin_fn(SCR_BI_TOLOCALE);
  if (SCR_BI_IS("valueOf")) return scr_builtin_fn(SCR_BI_VALUEOF);
  if (SCR_BI_IS("constructor")) {
    if (recv == scr_dyn_object_prototype()) return scr_builtin_fn(SCR_BI_OBJECT);
    if (recv == kind_protos[SCR_DYN_ARR]) return scr_builtin_fn(SCR_BI_ARRAY);
    if (recv == kind_protos[SCR_DYN_FUNC]) return scr_builtin_fn(SCR_BI_FUNCTION);
    if (recv == kind_protos[SCR_DYN_STR]) return scr_builtin_fn(SCR_BI_STRING);
    if (recv == kind_protos[SCR_DYN_NUM]) return scr_builtin_fn(SCR_BI_NUMBER);
    if (recv == kind_protos[SCR_DYN_BOOL]) return scr_builtin_fn(SCR_BI_BOOLEAN);
    /* A class's prototype names the class value (`Object.getPrototypeOf(inst).constructor === inst.constructor`). */
    const ScrDynClass *kc = scr_dyn_class_of_sentinel(recv);
    if (kc != NULL && scr_dyn_class_ops != NULL && scr_dyn_class_ops->class_value_of != NULL) return scr_dyn_class_ops->class_value_of(kc);
  }
#undef SCR_BI_IS
  return NULL;
}

ScrDyn *scr_dyn_get_prototype_of(const ScrDyn *d) {
  switch (d->kind) {
    case SCR_DYN_NULL:
    case SCR_DYN_UNDEF:
      scr_throw_error(SCR_ERR_TYPE, scr_str_new("Cannot convert undefined or null to object", 42));
      return scr_dyn_undefined();
    case SCR_DYN_OBJ: {
      if (scr_dyn_is_null_proto(d)) return scr_dyn_new_null();
      ScrDyn *own = scr_dyn_obj_proto_ref(d);
      if (own != NULL) return own;
      return scr_dyn_object_prototype();
    }
    case SCR_DYN_OBJINST: {
      const ScrDynClass *cls = scr_dyn_objinst_class_of(d);
      for (size_t i = 0; i < class_n; i++) if (class_keys[i] == cls) return scr_dyn_retain(class_protos[i]);
      if (class_n < 64) {
        class_keys[class_n] = cls;
        class_protos[class_n] = NULL;
        ScrDyn *p = scr_dyn_intrinsic_slot(&class_protos[class_n]);
        class_n++;
        return p;
      }
      return scr_dyn_object_prototype();
    }
    default:
      return scr_dyn_retain(scr_dyn_intrinsic_slot(&kind_protos[(unsigned)d->kind < 64 ? (unsigned)d->kind : 63]));
  }
}

/* The head of scr_dyn_obj_key_get for the receivers this unit models: an intrinsic prototype answers its builtin members, a
 * primitive wrapper reads the primitive's own surface (a String's `length` and indices, a Symbol's `description`). +1, or NULL
 * to let the ordinary own/chain walk run (a pending exception cannot happen here). */
static ScrDyn *proto_key_get(ScrDyn *recv, const char *key, size_t key_len) {
  if (recv->rc == SIZE_MAX) {
    ScrDyn *bi = proto_intrinsic_member(recv, key, key_len); /* an intrinsic prototype's builtin member */
    if (bi != NULL) return bi;
  }
  {
    /* A String wrapper's own `length` and index properties (the primitive's, read through the wrapper). */
    const ScrDyn *wp = scr_dyn_wrapper_prim(recv);
    if (wp != NULL && wp->kind == SCR_DYN_HANDLE) {
      /* A Symbol wrapper reads the symbol's own surface (`description`). */
      ScrStr *hk = scr_str_new(key, key_len);
      ScrDyn *hr = scr_dyn_handle_key_get(wp, hk);
      scr_str_release(hk);
      return hr != NULL ? hr : scr_dyn_retain(scr_dyn_undefined());
    }
    if (wp != NULL && wp->kind == SCR_DYN_STR) {
      if (key_len == 6 && memcmp(key, "length", 6) == 0) return scr_dyn_new_num(scr_str_utf16_len(wp->v.str));
      double idx = 0;
      if (scr_dyn_key_is_index(key, key_len, &idx) && idx < scr_str_utf16_len(wp->v.str)) {
        ScrStr *ch = scr_str_char_at(wp->v.str, idx);
        ScrDyn *r = scr_dyn_new_str(ch);
        scr_str_release(ch);
        return r;
      }
    }
  }
  return NULL;
}

static const ScrDynProtoOps proto_ops = { proto_wrapper_prim, proto_intrinsic_member, proto_is_intrinsic, proto_key_get };
__attribute__((constructor)) static void proto_install(void) { scr_dyn_proto_ops = &proto_ops; }
