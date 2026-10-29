/* process.stdout / process.stderr as checked-dynamic handles (SCR_DYNH_PROC_STREAM).
 * Linked exactly when a program boxes a stream value (cc.ts procDyn gate): the
 * write callback rides scr_next_tick, which only the loop units provide. */
#include "scr_runtime.h"
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
/* ── process.stdout / process.stderr as checked-dynamic handles ───────────
 * (SCR_DYNH_PROC_STREAM). The static value is the stream's fd scalar (1 or
 * 2). Boxed, the handle's pointer IS that fd (nothing is allocated), so two
 * boxes of one stream are one identity and the runtime's handle compare
 * answers `===` the way the static compare does. Node's stream is a
 * singleton, so one own expando object per fd serves every box; it exists
 * only once a program has written an expando. Writes land on the same
 * scr_stdio_write path the static write uses, so the two interleave in source
 * order. Members that Node's Writable/tty surface has and that this unit does
 * not model answer the loud "not supported yet" ladder (never undefined). */
static void *scr_ps_retain(void *h) { return h; }
static void scr_ps_release(void *h) { (void)h; }
static ScrDyn *scr_ps_own_objs[3];
static ScrDyn *scr_ps_write_fn;
static void scr_ps_teardown(void) {
  for (int i = 0; i < 3; i++) {
    if (scr_ps_own_objs[i] != NULL) scr_dyn_release(scr_ps_own_objs[i]);
    scr_ps_own_objs[i] = NULL;
  }
  if (scr_ps_write_fn != NULL) scr_dyn_release(scr_ps_write_fn);
  scr_ps_write_fn = NULL;
}
static bool scr_ps_registered;
static void scr_ps_arm(void) {
  if (!scr_ps_registered) {
    scr_ps_registered = true;
    scr_atexit(scr_ps_teardown); /* LIFO: runs before the RC audit; a library build drains it on reset */
  }
}
static ScrDyn *scr_ps_own(int fd, bool mint) {
  if (scr_ps_own_objs[fd] == NULL && mint) {
    scr_ps_arm();
    scr_ps_own_objs[fd] = scr_dyn_new_obj();
  }
  return scr_ps_own_objs[fd];
}

/* The write() callback fires on the next tick with a null error, as Node's
 * afterWrite does. The closure owns one reference to the dyn callback. */
static void scr_ps_cb_fire(ScrClosure *self) {
  ScrDyn *f = (ScrDyn *)scr_box_get_ref(self->caps[0]); /* +1 */
  ScrDyn *nul = scr_dyn_new_null();
  ScrDyn *r = scr_dyn_call(f, &nul, 1, "callback");
  if (r != NULL) scr_dyn_release(r);
  scr_dyn_release(nul);
  scr_dyn_release(f);
}

/* The write(chunk[, encoding][, cb]) answer. A string chunk without an
 * encoding is the static write exactly; with one, the bytes come from
 * scr_bytes_from_str (Node's own encoding table). Buffers and typed arrays
 * write their bytes. Any other chunk throws Node's ERR_INVALID_ARG_TYPE. */
static ScrDyn *scr_ps_write_dyn(int fd, ScrDyn *const *args, size_t argc) {
  const ScrDyn *chunk = argc > 0 ? args[0] : NULL;
  const ScrDyn *enc = NULL;
  const ScrDyn *cb = NULL;
  if (argc >= 2) {
    if (args[1]->kind == SCR_DYN_FUNC) cb = args[1];
    else if (args[1]->kind == SCR_DYN_STR) enc = args[1];
  }
  if (argc >= 3 && args[2]->kind == SCR_DYN_FUNC) cb = args[2];
  bool ok = true;
  if (chunk != NULL && chunk->kind == SCR_DYN_STR && enc == NULL) {
    ok = scr_proc_stream_write((double)fd, scr_dyn_str_value(chunk));
  } else if (chunk != NULL && chunk->kind == SCR_DYN_STR) {
    ScrBytes *b = scr_bytes_from_str(scr_dyn_str_value(chunk), scr_dyn_str_value(enc));
    scr_stdio_write(fd, b->data, (size_t)scr_bytes_byte_len(b));
    scr_bytes_release(b);
  } else if (chunk != NULL && chunk->kind == SCR_DYN_BYTES) {
    ScrBytes *b = chunk->v.bytes;
    scr_stdio_write(fd, b->data, (size_t)scr_bytes_byte_len(b));
  } else {
    char detail[256];
    const char *got = scr_dyn_specific_type(chunk, detail, sizeof detail);
    char msg[400];
    int ml = snprintf(msg, sizeof msg,
        "The \"chunk\" argument must be of type string or an instance of Buffer, TypedArray, or DataView. Received %s", got);
    scr_throw_error_msg_code(SCR_ERR_TYPE, msg, (size_t)ml, "ERR_INVALID_ARG_TYPE");
    return NULL;
  }
  if (cb != NULL) {
#ifdef SCR_LIB
    /* A library artifact links no loop (scr_async.c), so there is no tick queue to
     * fire on, the same stance as fs.stat's callback. */
    (void)scr_ps_cb_fire;
    scr_trap("scriptc: internal error: process stream write callback reached in a library build — please report this");
#else
    ScrClosure *clo = scr_closure_new((void *)scr_ps_cb_fire, 1);
    /* The box traces its dyn payload, so the collector sees the callback's own references. */
    clo->caps[0] = scr_box_new_obj(scr_dyn_retain_v, scr_dyn_release_v, scr_dyn_trace_v);
    scr_box_set_ref(clo->caps[0], scr_dyn_retain((ScrDyn *)cb));
    scr_next_tick(clo);
#endif
  }
  return scr_dyn_new_bool(ok);
}

/* Members the Writable / tty stream surface has that this unit does not
 * model: a read or call answers the loud ladder, never undefined. */
static const char *const scr_ps_ladder_names[] = {
    "on", "once", "off", "addListener", "removeListener", "removeAllListeners", "prependListener",
    "prependOnceListener", "emit", "listeners", "rawListeners", "listenerCount", "eventNames",
    "setMaxListeners", "getMaxListeners", "end", "cork", "uncork", "destroy", "pipe", "unpipe",
    "setDefaultEncoding", "_write", "_writev", "_destroy", "writableLength", "writableNeedDrain",
    "writableAborted", "errored", "constructor", "getColorDepth", "hasColors",
    "getWindowSize", "clearLine", "clearScreenDown", "cursorTo", "moveCursor", "isRaw", "setRawMode",
    "_type", "_isStdio", "_handle", "_writableState",
};
static bool scr_ps_key_is(const char *k, size_t n, const char *lit) {
  return strlen(lit) == n && memcmp(lit, k, n) == 0;
}
static bool scr_ps_is_ladder(const char *k, size_t n) {
  for (size_t i = 0; i < sizeof scr_ps_ladder_names / sizeof scr_ps_ladder_names[0]; i++) {
    if (strlen(scr_ps_ladder_names[i]) == n && memcmp(scr_ps_ladder_names[i], k, n) == 0) return true;
  }
  return false;
}
static void scr_ps_throw_ladder(const char *what, size_t n) {
  char msg[320];
  int ml = snprintf(msg, sizeof msg, "%.*s on a dynamic process stream value is not supported yet", (int)n, what);
  scr_throw_error_msg(SCR_ERR_TYPE, msg, (size_t)ml);
}

static ScrDyn *scr_ps_write_thunk(ScrClosure *clo, ScrDyn *const *args, size_t argc);
static ScrDyn *scr_ps_write_method(void) {
  if (scr_ps_write_fn == NULL) {
    scr_ps_arm();
    scr_ps_write_fn = scr_dyn_new_func(scr_closure_new((void *)scr_ps_write_thunk, 0), scr_ps_write_thunk, 1, "()", "write");
  }
  return scr_dyn_retain(scr_ps_write_fn);
}

static ScrDyn *scr_ps_write_thunk(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  ScrDyn *self = scr_dyn_this_get(); /* +1 */
  if (self == NULL || self->kind != SCR_DYN_HANDLE || self->v.handle.tag != SCR_DYNH_PROC_STREAM) {
    if (self != NULL) scr_dyn_release(self);
    scr_throw_error_msg(SCR_ERR_TYPE, "Illegal invocation", 18);
    return NULL;
  }
  ScrDyn *r = scr_ps_write_dyn((int)(uintptr_t)self->v.handle.ptr, args, argc);
  scr_dyn_release(self);
  return r;
}

static ScrDyn *scr_ps_dynh_invoke(void *h, ScrDyn *self, const char *method, ScrDyn *const *args, size_t argc, const char *what) {
  (void)self;
  const size_t n = strlen(method);
  if (n == 5 && memcmp(method, "write", 5) == 0) return scr_ps_write_dyn((int)(uintptr_t)h, args, argc);
  if (scr_ps_is_ladder(method, n)) {
    scr_ps_throw_ladder(method, n);
    return NULL;
  }
  char msg[200];
  int ml = snprintf(msg, sizeof msg, "%s is not a function", what);
  scr_throw_error_msg(SCR_ERR_TYPE, msg, (size_t)ml);
  return NULL;
}

/* A member READ. Own expandos shadow the built-in members, as on Node's
 * object. NULL is undefined: only names Node's stream does not have. */
static ScrDyn *scr_ps_dynh_get(void *h, const char *key, size_t key_len) {
  const int fd = (int)(uintptr_t)h;
  ScrDyn *own = scr_ps_own(fd, false);
  if (own != NULL) {
    ScrDyn *m = scr_dyn_obj_own_data(own, key, key_len);
    if (m != NULL) return scr_dyn_retain(m);
  }
  /* The WriteStream state reads the typed surface answers the same way
   * (lower-builtins.ts PROC_STREAM_STATE_BOOL / _NUM, measured on Node
   * v24.15.0): writable is true; nothing can end, cork or destroy a
   * process stream here, so the rest hold their initial values. */
  if (key_len == 8 && memcmp(key, "writable", 8) == 0) return scr_dyn_new_bool(true);
  if (scr_ps_key_is(key, key_len, "writableEnded") || scr_ps_key_is(key, key_len, "writableFinished") ||
      scr_ps_key_is(key, key_len, "writableObjectMode") || scr_ps_key_is(key, key_len, "destroyed") ||
      scr_ps_key_is(key, key_len, "closed")) return scr_dyn_new_bool(false);
  if (scr_ps_key_is(key, key_len, "writableHighWaterMark")) return scr_dyn_new_num(65536.0);
  if (scr_ps_key_is(key, key_len, "writableCorked")) return scr_dyn_new_num(0.0);
  if (key_len == 2 && memcmp(key, "fd", 2) == 0) return scr_dyn_new_num((double)fd);
  if (key_len == 5 && memcmp(key, "write", 5) == 0) return scr_ps_write_method();
  if (key_len == 5 && memcmp(key, "isTTY", 5) == 0) return scr_dyn_new_bool(scr_process_is_tty((double)fd));
  if (key_len == 7 && memcmp(key, "columns", 7) == 0) {
    double cols = scr_process_columns((double)fd);
    return cols < 0 ? NULL : scr_dyn_new_num(cols);
  }
  if (scr_ps_is_ladder(key, key_len)) {
    scr_ps_throw_ladder(key, key_len);
    return NULL;
  }
  return NULL;
}

/* `stream.k = v`: an own expando, shared by every box of this stream (Node's
 * stream is one object). */
static bool scr_ps_dynh_set(void *h, const char *key, size_t key_len, const ScrDyn *value) {
  ScrDyn *own = scr_ps_own((int)(uintptr_t)h, true);
  scr_dyn_obj_set(own, key, key_len, scr_dyn_retain((ScrDyn *)value));
  return true;
}

static ScrDyn *scr_ps_dynh_own_props(void *h) { return scr_ps_own((int)(uintptr_t)h, false); }

static const ScrDynHandleOps scr_ps_dynh_ops = {
    "WriteStream", &scr_ps_retain, &scr_ps_release, &scr_ps_dynh_invoke, &scr_ps_dynh_get,
    &scr_ps_dynh_set, NULL, &scr_ps_dynh_own_props,
};

/* Boxes process.stdout (fd 1) or process.stderr (fd 2) by reference. The
 * ops install here, on the first box, so no emitted main() has to know. */
ScrDyn *scr_proc_stream_box(double fd) {
  scr_dyn_handle_install(SCR_DYNH_PROC_STREAM, &scr_ps_dynh_ops); /* idempotent */
  return scr_dyn_new_handle((void *)(uintptr_t)(int)fd, SCR_DYNH_PROC_STREAM);
}

