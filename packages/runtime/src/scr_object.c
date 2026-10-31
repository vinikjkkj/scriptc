/* Class instances are per-class C structs emitted by the compiler; the
 * runtime only provides the RC-audit hooks their emitted new/release
 * helpers call — plus the class-OBJECT entry points (classes as values:
 * every class object is an emitted immortal static, so the adapters are
 * no-ops behind the uniform container RC machinery). */
#include "scr_runtime.h"

void *scr_classobj_retain_v(void *c) {
  return scr_classobj_retain((ScrClassObj *)c);
}
void scr_classobj_release_v(void *c) { scr_classobj_release((ScrClassObj *)c); }

ScrStr *scr_classobj_name(ScrClassObj *c) {
  return scr_str_retain((ScrStr *)c->name);
}

/* `obj.constructor.name` where obj is an instance of a hierarchy class: every
 * such layout is { size_t rc; const ScrVt *vt; ... }, and the class's vtable
 * names its class. An emitted user class stamps the name; the runtime-provided
 * hierarchies (the Error kinds) answer from their kind table, and anything
 * else is a plain Object. */
ScrStr *scr_object_ctor_name(void *obj) {
  const ScrVt *vt = ((const struct { size_t rc; const ScrVt *vt; } *)obj)->vt;
  if (vt != NULL && vt->name != NULL) return scr_str_retain((ScrStr *)vt->name);
  if (vt != NULL && vt >= scr_error_vts && vt < scr_error_vts + SCR_ERR_KINDS) {
    const char *n = scr_error_kind_name((int)(vt - scr_error_vts));
    /* DOMException's `name` slot defaults to "Error"; its CONSTRUCTOR is not Error. */
    if ((int)(vt - scr_error_vts) == SCR_ERR_DOMEX) n = "DOMException";
    if (n != NULL) return scr_str_new(n, strlen(n));
  }
  return scr_str_new("Object", 6);
}

/* The keyed-write MISS on a fixed-shape (signature-free) record: JS would
 * ADD the property, which a monomorphic struct cannot — the write throws
 * the catchable TypeError naming the key instead (the documented
 * divergence; the emitted per-shape keyed-write helpers call this after
 * the declared-field chain misses). */
void scr_record_key_miss(ScrStr *k) {
  const char *base = "Cannot add property '";
  ScrStr *head = scr_str_new(base, strlen(base));
  ScrStr *with_key = scr_str_concat(head, k);
  scr_str_release(head);
  const char *tail_c = "' to a fixed-shape object";
  ScrStr *tail = scr_str_new(tail_c, strlen(tail_c));
  ScrStr *msg = scr_str_concat(with_key, tail);
  scr_str_release(with_key);
  scr_str_release(tail);
  scr_throw_error(SCR_ERR_TYPE, msg); /* takes ownership */
}

#ifdef SCR_RC_AUDIT
static long scr_live_objects = 0;
long scr_obj_live_count(void) { return scr_live_objects; }
void scr_obj_alloc_note(void) { scr_live_objects++; }
void scr_obj_free_note(void) { scr_live_objects--; }

/* The handle kinds' live counters. Here rather than beside their values
 * because scr_bigint.c, scr_asym.c and scr_cipher_value.c are OPTIONAL
 * link units and this TU is always linked -- see scr_runtime.h. Off the
 * audit lane the notes are macros that expand to nothing, so none of this
 * exists. */
/* The pending-timer count, mirrored here by scr_async.c on every change of
 * its heap size (SCR_TIMERS_MIRROR). The timer heap lives in a link-gated
 * unit; this TU is always linked, so the audit's read always resolves. */
static long scr_live_timers = 0;
long scr_timers_live_count(void) { return scr_live_timers; }
void scr_timers_live_set(long n) { scr_live_timers = n; }

#define SCR_HANDLE_COUNTER(kind)                                 \
  static long scr_live_##kind = 0;                               \
  long scr_##kind##_live_count(void) { return scr_live_##kind; } \
  void scr_##kind##_alloc_note(void) { scr_live_##kind++; }      \
  void scr_##kind##_free_note(void) { scr_live_##kind--; }
SCR_HANDLE_COUNTER(bigint)
SCR_HANDLE_COUNTER(keyobj)
SCR_HANDLE_COUNTER(hash)
SCR_HANDLE_COUNTER(hmac)
SCR_HANDLE_COUNTER(cipher)
SCR_HANDLE_COUNTER(abortsig)
SCR_HANDLE_COUNTER(abortctl)
SCR_HANDLE_COUNTER(netsock)
SCR_HANDLE_COUNTER(netsrv)
SCR_HANDLE_COUNTER(tlsctx)
SCR_HANDLE_COUNTER(tlssock)
SCR_HANDLE_COUNTER(httpconn)
SCR_HANDLE_COUNTER(httpmsg)
SCR_HANDLE_COUNTER(h2sess)
SCR_HANDLE_COUNTER(h2stream)
SCR_HANDLE_COUNTER(dgram)
SCR_HANDLE_COUNTER(watcher)
SCR_HANDLE_COUNTER(child)
SCR_HANDLE_COUNTER(childstream)
#undef SCR_HANDLE_COUNTER
#else
void scr_obj_alloc_note(void) {}
void scr_obj_free_note(void) {}
#endif
