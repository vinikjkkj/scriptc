/* scr_urj_reason.c -- the text Node's UnhandledPromiseRejection report names a rejection reason by.
 *
 * A GATED unit (cc.ts urjReason): linked by a program that has a promise rejection path and holds dyn values, and by every program that embeds
 * the engine. A program without it reports a scalar reason from scr_async.c alone. Its constructor installs the reader the default report calls
 * (scr_urj_reason_fn); the island installs its own engine-side reader through scr_island_reason_text_fn, defined here so the island unit has one
 * symbol to set whenever it is linked. Kept out of scr_json.c on purpose: a constructor there is a link root that retains the whole dyn
 * conversion surface in every program (measured: hello world doubled). */
#include "scr_runtime.h"
#include <string.h>

extern ScrStr *(*scr_urj_reason_fn)(void *payload, void *(*retain)(void *)); /* scr_async.c */
ScrError *scr_errdyn_err_of(const ScrDyn *d);                              /* scr_json.c: +1 or NULL */

/* V8's NoSideEffectsToString of a rejection reason, over a dyn value: what Node's UnhandledPromiseRejection message names. A string is itself,
 * a number its ToString (-0 is "0"), a bigint its digits, a Symbol its description, a function its source text; a receiver whose toString is
 * Object.prototype's is "#<ConstructorName>" and every other receiver "[object Tag]" (an array "[object Array]", a Date, a RegExp, a Uint8Array,
 * an object or class instance with a toString of its own "[object Object]"). An engine value asks the engine (scr_island_reason_text_fn). NULL
 * for a value this cannot read (then the report keeps its old text). */
ScrStr *(*scr_island_reason_text_fn)(const ScrDyn *jsval) = NULL;
static ScrStr *scr_nse_lit(const char *s) { return scr_str_new(s, strlen(s)); }
static ScrStr *scr_nse_hash_name(const char *name) {
  ScrStr *r = scr_str_new("#<", 2);
  ScrStr *a = scr_str_new(name, strlen(name));
  ScrStr *b = scr_str_new(">", 1);
  ScrStr *ra = scr_str_concat(r, a);
  ScrStr *rb = scr_str_concat(ra, b);
  scr_str_release(r);
  scr_str_release(a);
  scr_str_release(b);
  scr_str_release(ra);
  return rb;
}
static ScrStr *scr_dyn_nse_string(const ScrDyn *d) {
  char buf[64];
  switch (d->kind) {
  case SCR_DYN_STR: return scr_str_retain(d->v.str);
  case SCR_DYN_NUM: scr_f64_to_str(d->v.num == 0 ? 0.0 : d->v.num, buf); return scr_nse_lit(buf);
  case SCR_DYN_BOOL: return scr_nse_lit(d->v.b ? "true" : "false");
  case SCR_DYN_NULL: return scr_nse_lit("null");
  case SCR_DYN_UNDEF: return scr_nse_lit("undefined");
  case SCR_DYN_BIG: return scr_dyn_string_coerce(d);
  /* A function's source text exists only in a program that carries the text table (moduleUsesFnText; a function thrown or rejected with
   * directly asks for it). A function that reaches the report through an untyped value in a program without the table has no source to name:
   * NULL, and the report keeps its old "[object]" text rather than aborting the exit path. */
  case SCR_DYN_FUNC: return scr_fn_text_row_hook != NULL ? scr_dyn_string_coerce(d) : NULL;
  case SCR_DYN_ARR: return scr_nse_lit("[object Array]");
  case SCR_DYN_BYTES: return scr_nse_lit("[object Uint8Array]");
  case SCR_DYN_ARRBUF: return scr_nse_lit("#<ArrayBuffer>");
  case SCR_DYN_PROMISE: return scr_nse_lit("#<Promise>");
  case SCR_DYN_MAP: {
    const char *tk = d->v.map.tkey;
    const bool is_set = d->v.map.ops != NULL ? d->v.map.ops->val_to_dyn == NULL : tk != NULL && strncmp(tk, "set", 3) == 0;
    return scr_nse_lit(is_set ? "#<Set>" : "#<Map>");
  }
  case SCR_DYN_JSVAL: return scr_island_reason_text_fn != NULL ? scr_island_reason_text_fn(d) : NULL;
  case SCR_DYN_OBJ: {
    if (scr_dyn_is_null_proto(d)) return scr_nse_lit("[object Object]");
    const ScrDyn *o = d;
    for (;;) {
      if (scr_dyn_obj_get(o, "toString", 8) != NULL) return scr_nse_lit("[object Object]");
      ScrDyn *pr = scr_dyn_obj_proto_ref(o);
      if (pr == NULL || pr->kind != SCR_DYN_OBJ) break;
      o = pr;
    }
    return scr_nse_lit("#<Object>");
  }
  case SCR_DYN_OBJINST: {
    const ScrDynClass *cls = scr_dyn_objinst_class_of(d);
    if (cls == NULL || cls->name == NULL) return NULL;
    for (size_t i = 0; i < cls->nmembers; i++) {
      if (cls->members[i].len == 8 && memcmp(cls->members[i].name, "toString", 8) == 0) return scr_nse_lit("[object Object]");
    }
    return scr_nse_hash_name(cls->name);
  }
  case SCR_DYN_HANDLE: {
    if (scr_dyn_is_symbol(d)) return scr_dyn_symbol_descriptive(d);
    if (d->v.handle.tag == SCR_DYNH_DATE) return scr_nse_lit("[object Date]");
    if (d->v.handle.tag == SCR_DYNH_REGEX) return scr_nse_lit("[object RegExp]");
    const ScrDynHandleOps *ops = scr_dyn_handle_ops_of(d);
    if (ops != NULL && ops->cls != NULL) return scr_nse_hash_name(ops->cls);
    return NULL;
  }
  default: return NULL;
  }
}
static ScrStr *scr_urj_reason_text(void *payload, void *(*retain)(void *)) {
  if (payload == NULL) return NULL;
  if (retain == scr_dyn_retain_v) {
    /* A dyn that wraps an Error is reported as the error, by the caller's existing path. */
    ScrError *err = scr_errdyn_err_of((const ScrDyn *)payload);
    if (err != NULL) {
      scr_error_release(err);
      return NULL;
    }
    return scr_dyn_nse_string((const ScrDyn *)payload);
  }
  ScrDyn *(*fn)(void *) = (ScrDyn * (*)(void *)) scr_exc_todyn_find(retain);
  if (fn == NULL) return NULL;
  ScrDyn *d = fn(payload);
  ScrStr *r = scr_dyn_nse_string(d);
  scr_dyn_release(d);
  return r;
}


__attribute__((constructor)) static void scr_urj_install_reason_reader(void) { scr_urj_reason_fn = scr_urj_reason_text; }
