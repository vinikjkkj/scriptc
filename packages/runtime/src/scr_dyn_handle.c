/* The checked-dynamic HANDLE support unit — everything the handle
 * dispatchers (scr_http.c / scr_net.c) and the emitter unit's dyn
 * registrations share BEYOND the dyn core: the listener gate over the
 * ERR_INVALID_ARG_TYPE throwers (the throwers themselves live in
 * scr_json.c beside the dyn core — the always-linked bytes/fs argument
 * validators call them too), and the runtime-built listener adapter
 * closures whose fire thunks box event tuples back into the checked-dynamic tree. Split
 * out of scr_json.c so handle-free binaries keep their exact size
 * class: cc.ts compiles this unit exactly when a user of it links (the
 * net or emitter gate — http implies net).
 */
#include "scr_runtime.h"

#include <stdio.h>
#include <string.h>

/* Node's ERR_INVALID_ARG_TYPE listener gate (errors.js's
 * determineSpecificType shapes — the scr_emitter_check_listener wording,
 * shared here so the gated units need not link the emitter unit). */
void scr_dyn_check_listener(const ScrDyn *cb, const char *argname) {
  if (cb->kind == SCR_DYN_FUNC) return;
  scr_dyn_arg_type_fail(argname, "of type function", cb);
}

/* ── runtime-built listener closures (the handle dispatchers' .on paths) ─
 * One capture: a box holding the retained dyn FUNCTION value. The fire
 * thunks box the event tuple back into the checked-dynamic tree and call through the
 * checked-dynamic machinery (scr_dyn_call — per-arg validation lives in
 * the boxed thunk). A throw from the listener stays pending, exactly like
 * a compiler-emitted listener body. */
static ScrDyn *scr_dyn_listener_peek(ScrClosure *cb) {
  return (ScrDyn *)scr_box_get_ref(cb->caps[0]); /* +1 */
}

/* The boxed dyn FUNCTION a listener closure carries (+1) — for fire
 * thunks the OWNING units define themselves (handle-boxing tuples this
 * unit cannot spell: scr_net.c's 'connection', scr_http.c's 'request'). */
ScrDyn *scr_dyn_listener_fn(ScrClosure *cb) { return scr_dyn_listener_peek(cb); }

void scr_dyn_listener_fire0(ScrClosure *cb) {
  ScrDyn *fn = scr_dyn_listener_peek(cb);
  ScrDyn *r = scr_dyn_call(fn, NULL, 0, "listener");
  scr_dyn_release(r);
  scr_dyn_release(fn);
}

void scr_dyn_listener_fire_data(ScrClosure *cb, ScrBytes *chunk) {
  ScrDyn *fn = scr_dyn_listener_peek(cb);
  ScrDyn *arg = scr_dyn_new_chunk(chunk); /* Buffer-flavored, or a string inside a setEncoding window */
  ScrDyn *args[1] = { arg };
  ScrDyn *r = scr_dyn_call(fn, args, 1, "listener");
  scr_dyn_release(r);
  scr_dyn_release(arg);
  scr_dyn_release(fn);
}

void scr_dyn_listener_fire_err(ScrClosure *cb, ScrStr *msg) {
  ScrDyn *fn = scr_dyn_listener_peek(cb);
  /* The checked-dynamic tree's error encoding (caughtToDyn's shape) — what a dyn 'error'
   * listener body can instanceof-test and read .message from.
   *
   * Built by MAKING an error and boxing it, rather than by open-coding the
   * encoding's members here. Open-coding them is what let this copy fall
   * behind: it stamped a reserved "%error" key plus enumerable name and
   * message, which is what the boxing did too - and the day the boxing
   * became Node's shape (a prototype link plus non-enumerable members),
   * this listener would have kept handing out the old one. */
  ScrError *err = scr_error_new(SCR_ERR_ERROR, msg);
  ScrDyn *arg = scr_dyn_from_error(err);
  scr_error_release(err);
  ScrDyn *args[1] = { arg };
  ScrDyn *r = scr_dyn_call(fn, args, 1, "listener");
  scr_dyn_release(r);
  scr_dyn_release(arg);
  scr_dyn_release(fn);
}

static ScrClosure *scr_dyn_listener_closure(const ScrDyn *cb, void *fire) {
  ScrClosure *clo = scr_closure_new(fire, 1);
  ScrBox *box = scr_box_new_obj(&scr_dyn_retain_v, &scr_dyn_release_v, NULL);
  scr_box_set_ref(box, scr_dyn_retain((ScrDyn *)cb));
  clo->caps[0] = box;
  return clo;
}

ScrClosure *scr_dyn_listener_closure_fn(const ScrDyn *cb, void *fire) {
  return scr_dyn_listener_closure(cb, fire);
}
ScrClosure *scr_dyn_listener_closure0(const ScrDyn *cb) {
  return scr_dyn_listener_closure(cb, (void *)&scr_dyn_listener_fire0);
}
ScrClosure *scr_dyn_listener_closure_data(const ScrDyn *cb) {
  return scr_dyn_listener_closure(cb, (void *)&scr_dyn_listener_fire_data);
}
ScrClosure *scr_dyn_listener_closure_err(const ScrDyn *cb) {
  return scr_dyn_listener_closure(cb, (void *)&scr_dyn_listener_fire_err);
}

/* ── the checked-dynamic child-stdio handle (SCR_DYNH_CHILD_STREAM) ────
 *
 * A child's stdout/stderr crosses into the checked-dynamic tree BY
 * REFERENCE, like the socket handles: it is a stateful I/O object, so
 * boxing is a retain and identity survives the round trip.
 *
 * This is the kind zapo's SC1101 actually fences on, and it arrives
 * under a name that hides it. `Readable` from "node:stream" maps to THIS
 * kind under @types/node (types.ts's childStream branch) and to the
 * runtime stream CLASS under the shipped fallback declarations — so a
 * reproducer written against the fallback exercises SCR_DYN_OBJINST and
 * proves nothing about a record field spelled the same way in a
 * @types/node build.
 *
 * WHY HERE and not in scr_child.c, where the stream itself lives: this
 * unit is GATED (cc.ts links it with the emitter/stream/net families and
 * now with childStream), while scr_child.c is ALWAYS linked. The ops
 * need the listener adapters directly above, so putting them next to
 * the stream would have made an always-linked TU reference a gated one
 * — an undefined symbol in every handle-free binary, which is exactly
 * what the link tried first. Gated→always-linked is the direction that
 * works, so the ops sit on this side and call scr_child_stream_on_*
 * across.
 *
 * The MODELED surface is exactly the static lowering's:
 * on/once("data" | "end"). That is the whole of what
 * lowerChildStreamMethodCall accepts, so the dynamic spelling reaches
 * every entry point the static one can and no more. */

static bool scr_cs_dynh_name_is(const ScrDyn *name, const char *lit) {
  size_t n = strlen(lit);
  return name->kind == SCR_DYN_STR && name->v.str->len == n &&
         memcmp(name->v.str->data, lit, n) == 0;
}

static void scr_cs_dynh_unsupported(const char *member, const char *why) {
  char msg[240];
  const int n = snprintf(msg, sizeof msg,
                         "'Readable.prototype.%s' on a dynamic value is not supported yet%s%s",
                         member, why ? " — " : "", why ? why : "");
  scr_throw_error_msg(SCR_ERR_ERROR, msg, (size_t)n);
}

static ScrDyn *scr_cs_dynh_invoke(void *h, ScrDyn *self, const char *method,
                                  ScrDyn *const *args, size_t argc, const char *what) {
  ScrChildStream *s = (ScrChildStream *)h;
  bool reg = false, once = false;
  if (strcmp(method, "on") == 0 || strcmp(method, "addListener") == 0) reg = true;
  else if (strcmp(method, "once") == 0) { reg = true; once = true; }
  if (reg) {
    const ScrDyn *name = argc > 0 ? args[0] : scr_dyn_undefined();
    const ScrDyn *cb = argc > 1 ? args[1] : scr_dyn_undefined();
    scr_dyn_check_listener(cb, "listener");
    if (scr_exc_pending()) return NULL;
    if (scr_cs_dynh_name_is(name, "data")) {
      scr_child_stream_on_data(s, scr_dyn_listener_closure_data(cb),
                               (ScrChildStreamDataFn)&scr_dyn_listener_fire_data, once);
    } else if (scr_cs_dynh_name_is(name, "end")) {
      scr_child_stream_on_end(s, scr_dyn_listener_closure0(cb), once);
    } else {
      /* Every other event name — 'error', 'close', 'readable' — is a
       * REAL Readable event this surface never fires. Accepting the
       * registration would be worse than refusing it: the listener would
       * simply never run, which reads as a hang rather than as a missing
       * feature. */
      ScrJsonBuf b;
      scr_jb_init(&b);
      scr_jb_puts(&b, "listening for '");
      if (name->kind == SCR_DYN_STR) {
        for (size_t i = 0; i < name->v.str->len; i++) scr_jb_putc(&b, name->v.str->data[i]);
      }
      scr_jb_puts(&b, "' on a dynamic child stream is not supported yet"
                      " (\"data\" and \"end\" are the modeled events)");
      scr_throw_error(SCR_ERR_ERROR, scr_jb_finish(&b));
      return NULL;
    }
    return scr_dyn_retain(self); /* Node returns the stream for chaining */
  }
  {
    /* Real members whose dynamic answer would have to be approximate —
     * loud, and each named so the message says what is missing. */
    static const char *const known[] = {
      "pipe", "read", "setEncoding", "pause", "resume", "destroy",
      "removeListener", "off", "unpipe", NULL,
    };
    for (size_t i = 0; known[i]; i++) {
      if (strcmp(method, known[i]) == 0) {
        scr_cs_dynh_unsupported(method, NULL);
        return NULL;
      }
    }
  }
  {
    /* A name Readable never had: Node's own TypeError, not our ladder. */
    char msg[160];
    const int n = snprintf(msg, sizeof msg, "%s is not a function", what);
    scr_throw_error_msg(SCR_ERR_TYPE, msg, (size_t)n);
  }
  return NULL;
}

static ScrDyn *scr_cs_dynh_get(void *h, const char *key, size_t key_len) {
  (void)h;
  (void)key_len;
  /* The stream's state flags are real properties with real answers this
   * surface does not track (nothing here records whether the pipe has
   * ended, only that an 'end' listener was asked for). Answering
   * `undefined` for `readable` would read as "not a stream"; answering
   * false would be a claim. Refuse by name. */
  static const char *const known[] = {
    "readable", "readableEnded", "readableFlowing", "readableLength",
    "readableHighWaterMark", "readableObjectMode", "destroyed", "closed",
    "errored", "readableEncoding", NULL,
  };
  for (size_t i = 0; known[i]; i++) {
    if (strcmp(key, known[i]) == 0) {
      scr_cs_dynh_unsupported(key, "this surface tracks no stream state");
      return NULL;
    }
  }
  return NULL; /* not a modeled property — the caller answers undefined */
}

static bool scr_cs_dynh_set(void *h, const char *key, size_t key_len, const ScrDyn *value) {
  (void)h;
  (void)key;
  (void)key_len;
  (void)value;
  return false; /* nothing is writable here — the caller throws the loud ladder */
}

static const ScrDynHandleOps scr_cs_dynh_ops = {
  "Readable",
  &scr_child_stream_retain_v,
  &scr_child_stream_release_v,
  &scr_cs_dynh_invoke,
  &scr_cs_dynh_get,
  &scr_cs_dynh_set,
  NULL, /* no pipe destination */
};

void scr_child_stream_dyn_install(void) {
  scr_dyn_handle_install(SCR_DYNH_CHILD_STREAM, &scr_cs_dynh_ops);
}

