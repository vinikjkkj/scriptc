/* Blob and File, and the buffer module's values (scr_buffer_val.c). A link unit of its own:
 * linked only into a program whose IR holds a dyn.bufferValue libCall (cc.ts, bufferVal). Its
 * promise and dyn helpers come from the gated units that dyn.bufferValue also links. */
#include "scr_runtime.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

const char *scr_enc_canon_dyn_pub(const ScrDyn *enc, bool lenient);

/* ── Blob and File as VALUES ─────────────────────────────────────────────
 *
 * The two members of require('buffer') that are classes of their own. A
 * Blob is an ordinary dyn object whose prototype is %Blob.prototype%; its
 * bytes and type ride in two HIDDEN own data keys (non-enumerable, so Object.keys
 * and for-in never see them; the key strings start with \x01, which no
 * JavaScript identifier spells). A File is a Blob with a name and a
 * lastModified. The constructors are FUNC boxes (process singletons, built on
 * first read through scr_dyn_buffer_value), and `new` reaches the thunk through
 * the ordinary construct path, which takes the object the thunk returns.
 * text()/arrayBuffer()/bytes() answer settled promises. Gated with the buffer
 * values (cc.ts links this unit for dyn.bufferValue).
 *
 * NOT MAPPED yet (named, not silent): Blob#stream() and the Symbol.toStringTag
 * of Blob.prototype. Both are absent from the prototype, so reading them answers
 * undefined. That is recorded in the slice report as the remaining gap. */

#define SCR_BLOB_KEY_BYTES "\x01" "b"
#define SCR_BLOB_KEY_TYPE "\x01" "t"
#define SCR_BLOB_KEY_NAME "\x01" "n"
#define SCR_BLOB_KEY_LM "\x01" "m"

static ScrDyn *scr_blob_proto_box = NULL; /* %Blob.prototype%, owned by the singleton */
static ScrDyn *scr_file_proto_box = NULL; /* %File.prototype% */
static ScrDyn *scr_blob_ctor_box = NULL;  /* %Blob% */
static ScrDyn *scr_file_ctor_box = NULL;  /* %File% */

/* Blob.type: ASCII printable only, lowercased; anything else is the empty type (the spec). */
static ScrStr *scr_blob_norm_type(const ScrDyn *v) {
  if (v == NULL || v->kind != SCR_DYN_STR) return scr_str_new("", 0);
  const ScrStr *s = v->v.str;
  char *out = (char *)malloc(s->len + 1);
  if (out == NULL) scr_bytes_io_oom();
  for (size_t i = 0; i < s->len; i++) {
    unsigned char c = (unsigned char)s->data[i];
    if (c < 0x20 || c > 0x7E) {
      free(out);
      return scr_str_new("", 0);
    }
    out[i] = (c >= 'A' && c <= 'Z') ? (char)(c + 32) : (char)c;
  }
  ScrStr *r = scr_str_new(out, s->len);
  free(out);
  return r;
}

/* The bytes of one blob-part (a string as UTF-8; a view or an ArrayBuffer by copy;
 * a Blob by copy of its bytes; anything else by its ToString). +1, NULL with the pending throw. */
static ScrBytes *scr_blob_part_bytes(const ScrDyn *p) {
  ScrStr *utf8 = scr_str_new("utf8", 4);
  ScrBytes *out = NULL;
  if (p->kind == SCR_DYN_STR) {
    out = scr_bytes_from_str(p->v.str, utf8);
  } else if ((p->kind == SCR_DYN_BYTES || p->kind == SCR_DYN_ARRBUF) && p->v.bytes != NULL) {
    size_t n = p->v.bytes->len * scr_bytes_elem_size(p->v.bytes->elem);
    out = scr_bytes_new(SCR_BYTES_U8, (double)n);
    if (out != NULL && n > 0) memcpy(out->data, p->v.bytes->data, n);
  } else if (p->kind == SCR_DYN_OBJ) {
    const ScrDyn *inner = scr_dyn_obj_own_data(p, SCR_BLOB_KEY_BYTES, 2);
    if (inner != NULL && inner->kind == SCR_DYN_BYTES && inner->v.bytes != NULL) {
      size_t n = inner->v.bytes->len;
      out = scr_bytes_new(SCR_BYTES_U8, (double)n);
      if (out != NULL && n > 0) memcpy(out->data, inner->v.bytes->data, n);
    } else {
      ScrStr *s = scr_dyn_to_string(p, utf8);
      if (s != NULL) {
        out = scr_bytes_from_str(s, utf8);
        scr_str_release(s);
      }
    }
  } else {
    ScrStr *s = scr_dyn_to_string(p, utf8);
    if (s != NULL) {
      out = scr_bytes_from_str(s, utf8);
      scr_str_release(s);
    }
  }
  scr_str_release(utf8);
  return out;
}

static double scr_blob_now_ms(void) {
  /* Second resolution (clock_gettime needs a POSIX feature macro this unit does not set). */
  return (double)time(NULL) * 1000.0;
}

/* A Blob (or File) object over `bytes` (+1, consumed) with `type` (+1, consumed). */
static ScrDyn *scr_blob_make(ScrBytes *bytes, ScrStr *type, bool is_file, ScrStr *name, double lm) {
  ScrDyn *obj = scr_dyn_new_obj(); /* +1 */
  scr_dyn_obj_set_proto(obj, is_file ? scr_file_proto_box : scr_blob_proto_box);
  ScrDyn *bd = scr_dyn_new_bytes_ref(bytes); /* +1, retains */
  scr_bytes_release(bytes);
  scr_dyn_obj_define_hidden_data(obj, SCR_BLOB_KEY_BYTES, 2, bd, false, false);
  scr_dyn_release(bd);
  ScrDyn *td = scr_dyn_new_str(type); /* retains */
  scr_str_release(type);
  scr_dyn_obj_define_hidden_data(obj, SCR_BLOB_KEY_TYPE, 2, td, false, false);
  scr_dyn_release(td);
  if (is_file) {
    ScrDyn *nd = scr_dyn_new_str(name); /* retains */
    scr_str_release(name);
    scr_dyn_obj_define_hidden_data(obj, SCR_BLOB_KEY_NAME, 2, nd, false, false);
    scr_dyn_release(nd);
    ScrDyn *md = scr_dyn_new_num(lm);
    scr_dyn_obj_define_hidden_data(obj, SCR_BLOB_KEY_LM, 2, md, false, false);
    scr_dyn_release(md);
  }
  return obj;
}

/* `this` of a Blob method: the receiver object (borrowed from the +1 window read `self`). */
static const ScrDyn *scr_blob_this_bytes(ScrDyn *self, const char *what) {
  const ScrDyn *b = (self != NULL && self->kind == SCR_DYN_OBJ) ? scr_dyn_obj_own_data(self, SCR_BLOB_KEY_BYTES, 2) : NULL;
  if (b == NULL || b->kind != SCR_DYN_BYTES) {
    ScrJsonBuf jb;
    scr_jb_init(&jb);
    scr_jb_puts(&jb, "Value of \"this\" must be of type Blob (");
    scr_jb_puts(&jb, what);
    scr_jb_puts(&jb, ")");
    scr_throw_error(SCR_ERR_TYPE, scr_jb_finish(&jb));
    return NULL;
  }
  return b;
}

static ScrDyn *scr_blob_construct(ScrDyn *const *args, size_t argc, bool is_file) {
  const char *cname = is_file ? "File" : "Blob";
  ScrDyn *self = scr_dyn_this_get(); /* +1; the construct path binds the fresh object here */
  bool plain = self == NULL || self->kind == SCR_DYN_UNDEF;
  scr_dyn_release(self);
  if (plain) {
    ScrJsonBuf jb;
    scr_jb_init(&jb);
    scr_jb_puts(&jb, "Class constructor ");
    scr_jb_puts(&jb, cname);
    scr_jb_puts(&jb, " cannot be invoked without 'new'");
    scr_throw_error(SCR_ERR_TYPE, scr_jb_finish(&jb));
    return NULL;
  }
  const ScrDyn *undef = scr_dyn_undefined();
  const ScrDyn *sources = argc >= 1 ? args[0] : undef;
  const ScrDyn *opts = argc >= (is_file ? 3u : 2u) ? args[is_file ? 2 : 1] : undef;
  if (is_file && argc < 2) {
    static const char msg[] = "The \"fileBits\" and \"fileName\" arguments must be specified";
    scr_throw_error_msg_code(SCR_ERR_TYPE, msg, sizeof msg - 1, "ERR_MISSING_ARGS");
    return NULL;
  }
  /* The parts, in order. */
  size_t nparts = 0;
  if (sources->kind == SCR_DYN_ARR) nparts = sources->v.arr.len;
  else if (sources->kind != SCR_DYN_UNDEF) {
    scr_dyn_arg_type_fail("sources", "an instance of Array", sources);
    return NULL;
  }
  ScrBytes **parts = nparts > 0 ? (ScrBytes **)calloc(nparts, sizeof(ScrBytes *)) : NULL;
  if (nparts > 0 && parts == NULL) scr_bytes_io_oom();
  size_t total = 0;
  for (size_t i = 0; i < nparts; i++) {
    parts[i] = scr_blob_part_bytes(sources->v.arr.items[i]);
    if (parts[i] == NULL) {
      for (size_t j = 0; j < i; j++) scr_bytes_release(parts[j]);
      free(parts);
      return NULL;
    }
    total += parts[i]->len;
  }
  ScrBytes *out = scr_bytes_new(SCR_BYTES_U8, (double)total);
  if (out == NULL) {
    for (size_t j = 0; j < nparts; j++) scr_bytes_release(parts[j]);
    free(parts);
    return NULL;
  }
  size_t off = 0;
  for (size_t i = 0; i < nparts; i++) {
    if (parts[i]->len > 0) memcpy(out->data + off, parts[i]->data, parts[i]->len);
    off += parts[i]->len;
    scr_bytes_release(parts[i]);
  }
  free(parts);
  /* The options bag: type, and for File lastModified. */
  ScrStr *type = scr_str_new("", 0);
  if (opts->kind == SCR_DYN_OBJ) {
    const ScrDyn *t = scr_dyn_obj_get(opts, "type", 4);
    if (t != NULL) {
      scr_str_release(type);
      type = scr_blob_norm_type(t);
    }
  } else if (opts->kind != SCR_DYN_UNDEF) {
    scr_str_release(type);
    scr_dyn_arg_type_fail("options", "of type object", opts);
    scr_bytes_release(out);
    return NULL;
  }
  ScrStr *name = NULL;
  double lm = 0.0;
  if (is_file) {
    ScrStr *utf8 = scr_str_new("utf8", 4);
    name = scr_dyn_to_string(args[1], utf8);
    scr_str_release(utf8);
    if (name == NULL) {
      scr_bytes_release(out);
      scr_str_release(type);
      return NULL;
    }
    lm = scr_blob_now_ms();
    if (opts->kind == SCR_DYN_OBJ) {
      const ScrDyn *m = scr_dyn_obj_get(opts, "lastModified", 12);
      if (m != NULL && m->kind == SCR_DYN_NUM) lm = m->v.num;
    }
  }
  return scr_blob_make(out, type, is_file, name, lm);
}

static ScrDyn *scr_blob_ctor_thunk(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  return scr_blob_construct(args, argc, false);
}

static ScrDyn *scr_file_ctor_thunk(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  return scr_blob_construct(args, argc, true);
}

/* Prototype members. Each reads its receiver from the `this` window. */
static ScrDyn *scr_blob_g_size(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo; (void)args; (void)argc;
  ScrDyn *self = scr_dyn_this_get();
  const ScrDyn *b = scr_blob_this_bytes(self, "size");
  double n = b != NULL ? (double)b->v.bytes->len : 0.0;
  scr_dyn_release(self);
  if (b == NULL) return NULL;
  return scr_dyn_new_num(n);
}

static ScrDyn *scr_blob_g_type(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo; (void)args; (void)argc;
  ScrDyn *self = scr_dyn_this_get();
  const ScrDyn *b = scr_blob_this_bytes(self, "type");
  if (b == NULL) { scr_dyn_release(self); return NULL; }
  const ScrDyn *t = scr_dyn_obj_own_data(self, SCR_BLOB_KEY_TYPE, 2);
  ScrStr *s = scr_str_new(t != NULL && t->kind == SCR_DYN_STR ? t->v.str->data : "", t != NULL && t->kind == SCR_DYN_STR ? t->v.str->len : 0);
  scr_dyn_release(self);
  ScrDyn *r_ = scr_dyn_new_str(s); /* retains */
  scr_str_release(s);
  return r_;
}

static ScrDyn *scr_blob_g_name(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo; (void)args; (void)argc;
  ScrDyn *self = scr_dyn_this_get();
  const ScrDyn *b = scr_blob_this_bytes(self, "name");
  if (b == NULL) { scr_dyn_release(self); return NULL; }
  const ScrDyn *n = scr_dyn_obj_own_data(self, SCR_BLOB_KEY_NAME, 2);
  ScrStr *s = scr_str_new(n != NULL && n->kind == SCR_DYN_STR ? n->v.str->data : "", n != NULL && n->kind == SCR_DYN_STR ? n->v.str->len : 0);
  scr_dyn_release(self);
  ScrDyn *r_ = scr_dyn_new_str(s); /* retains */
  scr_str_release(s);
  return r_;
}

static ScrDyn *scr_blob_g_last_modified(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo; (void)args; (void)argc;
  ScrDyn *self = scr_dyn_this_get();
  const ScrDyn *b = scr_blob_this_bytes(self, "lastModified");
  if (b == NULL) { scr_dyn_release(self); return NULL; }
  const ScrDyn *m = scr_dyn_obj_own_data(self, SCR_BLOB_KEY_LM, 2);
  double v = m != NULL && m->kind == SCR_DYN_NUM ? m->v.num : 0.0;
  scr_dyn_release(self);
  return scr_dyn_new_num(v);
}

/* slice(start?, end?, contentType?): Node's relative-index clamp over the byte length. */
static ScrDyn *scr_blob_m_slice(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  ScrDyn *self = scr_dyn_this_get();
  const ScrDyn *bd = scr_blob_this_bytes(self, "slice");
  if (bd == NULL) { scr_dyn_release(self); return NULL; }
  double size = (double)bd->v.bytes->len;
  const ScrDyn *undef = scr_dyn_undefined();
  double start = 0, end = size;
  const ScrDyn *a0 = argc >= 1 ? args[0] : undef;
  const ScrDyn *a1 = argc >= 2 ? args[1] : undef;
  const ScrDyn *a2 = argc >= 3 ? args[2] : undef;
  if (a0->kind != SCR_DYN_UNDEF) {
    double r = scr_dyn_to_number(a0);
    if (scr_exc_pending()) { scr_dyn_release(self); return NULL; }
    if (r != r) r = 0;
    start = r < 0 ? (size + r < 0 ? 0 : size + r) : (r > size ? size : r);
  }
  if (a1->kind != SCR_DYN_UNDEF) {
    double r = scr_dyn_to_number(a1);
    if (scr_exc_pending()) { scr_dyn_release(self); return NULL; }
    if (r != r) r = 0;
    end = r < 0 ? (size + r < 0 ? 0 : size + r) : (r > size ? size : r);
  }
  double len = end > start ? end - start : 0;
  ScrBytes *out = scr_bytes_new(SCR_BYTES_U8, len);
  if (out == NULL) { scr_dyn_release(self); return NULL; }
  if (len > 0) memcpy(out->data, bd->v.bytes->data + (size_t)start, (size_t)len);
  ScrStr *type = a2->kind == SCR_DYN_UNDEF ? scr_str_new("", 0) : scr_blob_norm_type(a2);
  scr_dyn_release(self);
  return scr_blob_make(out, type, false, NULL, 0.0);
}

/* A Blob read settles in a LATER turn, as Node's does (its read runs off the main
 * turn): a pending promise fulfilled from the immediate queue, so the reactions
 * already queued (a plain Promise.resolve(...).then) run first. The closure holds the
 * promise and the payload; the immediate calls it once. */
static void scr_blob_settle_str_later(ScrClosure *self) {
  ScrPromise *p = (ScrPromise *)scr_box_get_ref(self->caps[0]); /* +1 */
  ScrStr *s = (ScrStr *)scr_box_get_ref(self->caps[1]);         /* +1, moves into the fulfil */
  scr_promise_fulfill_str(p, s);
  scr_promise_release(p);
}
/* The payload of a dyn promise is a checked-dynamic value (scr_await_dyn reads it as one). */
static void scr_blob_settle_dyn_later(ScrClosure *self) {
  ScrPromise *p = (ScrPromise *)scr_box_get_ref(self->caps[0]); /* +1 */
  ScrDyn *v = (ScrDyn *)scr_box_get_ref(self->caps[1]);         /* +1, moves into the promise */
  scr_promise_fulfill_ref(p, v, scr_dyn_retain_v, scr_dyn_release_v, NULL);
  scr_promise_release(p);
}

/* A pending promise over the closure `fn`, fulfilled by the immediate queue. +1. */
static ScrPromise *scr_blob_deferred(void (*fn)(ScrClosure *), void *payload,
                                     void *(*pretain)(void *), void (*prelease)(void *),
                                     void *(*pl_retain)(void *), void (*pl_release)(void *)) {
  ScrPromise *p = scr_promise_new(); /* +1, ours */
  ScrClosure *c = scr_closure_new((void *)fn, 2);
  ScrBox *pb = scr_box_new_obj(pretain, prelease, NULL);
  scr_box_set_ref(pb, scr_promise_retain(p));
  ScrBox *vb = scr_box_new_obj(pl_retain, pl_release, NULL);
  scr_box_set_ref(vb, pl_retain(payload));
  c->caps[0] = pb;
  c->caps[1] = vb;
  scr_set_immediate(c);
  return p;
}

/* text(): a promise of the bytes decoded as UTF-8, settled in a later turn. */
static ScrDyn *scr_blob_m_text(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo; (void)args; (void)argc;
  ScrDyn *self = scr_dyn_this_get();
  const ScrDyn *bd = scr_blob_this_bytes(self, "text");
  if (bd == NULL) { scr_dyn_release(self); return NULL; }
  ScrStr *utf8 = scr_str_new("utf8", 4);
  ScrStr *s = scr_bytes_to_str(bd->v.bytes, utf8);
  scr_str_release(utf8);
  scr_dyn_release(self);
  ScrPromise *p = scr_blob_deferred(scr_blob_settle_str_later, s, &scr_promise_retain_v, &scr_promise_release_v,
                                    &scr_str_retain_v, &scr_str_release_v);
  scr_str_release(s);
  ScrDyn *d = scr_dyn_new_promise(p);
  scr_promise_release(p);
  return d;
}

/* bytes(): a settled promise of a fresh Uint8Array copy. */
static ScrDyn *scr_blob_m_bytes(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo; (void)args; (void)argc;
  ScrDyn *self = scr_dyn_this_get();
  const ScrDyn *bd = scr_blob_this_bytes(self, "bytes");
  if (bd == NULL) { scr_dyn_release(self); return NULL; }
  ScrBytes *out = scr_bytes_new(SCR_BYTES_U8, (double)bd->v.bytes->len);
  if (out != NULL && bd->v.bytes->len > 0) memcpy(out->data, bd->v.bytes->data, bd->v.bytes->len);
  scr_dyn_release(self);
  if (out == NULL) return NULL;
  ScrDyn *dv = scr_dyn_new_bytes_ref(out); /* +1 */
  scr_bytes_release(out);
  ScrPromise *p = scr_blob_deferred(scr_blob_settle_dyn_later, dv, &scr_promise_retain_v, &scr_promise_release_v,
                                    &scr_dyn_retain_v, &scr_dyn_release_v);
  scr_dyn_release(dv);
  ScrDyn *d = scr_dyn_new_promise(p);
  scr_promise_release(p);
  return d;
}

/* arrayBuffer(): a settled promise of a fresh ArrayBuffer copy. */
static ScrDyn *scr_blob_m_array_buffer(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo; (void)args; (void)argc;
  ScrDyn *self = scr_dyn_this_get();
  const ScrDyn *bd = scr_blob_this_bytes(self, "arrayBuffer");
  if (bd == NULL) { scr_dyn_release(self); return NULL; }
  ScrBytes *out = scr_bytes_new(SCR_BYTES_U8, (double)bd->v.bytes->len);
  if (out != NULL && bd->v.bytes->len > 0) memcpy(out->data, bd->v.bytes->data, bd->v.bytes->len);
  scr_dyn_release(self);
  if (out == NULL) return NULL;
  ScrDyn *ab = scr_dyn_new_arrbuf_ref(out); /* +1, retains */
  scr_bytes_release(out);
  ScrPromise *p = scr_blob_deferred(scr_blob_settle_dyn_later, ab, &scr_promise_retain_v, &scr_promise_release_v,
                                    &scr_dyn_retain_v, &scr_dyn_release_v);
  scr_dyn_release(ab);
  ScrDyn *d = scr_dyn_new_promise(p);
  scr_promise_release(p);
  return d;
}

static void scr_blob_define_method(ScrDyn *target, const char *name, ScrDynThunk thunk, uint32_t arity) {
  ScrDyn *f = scr_dyn_new_func(scr_closure_new((void *)thunk, 0), thunk, arity, "()", name); /* +1 */
  scr_dyn_obj_define_hidden_data(target, name, strlen(name), f, true, true);
  scr_dyn_release(f);
}

static void scr_blob_define_getter(ScrDyn *target, const char *name, ScrDynThunk thunk) {
  ScrDyn *g = scr_dyn_new_func(scr_closure_new((void *)thunk, 0), thunk, 0, "()", name); /* +1 */
  scr_dyn_obj_define_accessor(target, name, strlen(name), g, scr_dyn_undefined(), true, false);
  scr_dyn_release(g);
}

static void scr_blob_teardown(void) {
  scr_dyn_release(scr_file_ctor_box);
  scr_file_ctor_box = NULL;
  scr_dyn_release(scr_blob_ctor_box);
  scr_blob_ctor_box = NULL;
  scr_dyn_release(scr_file_proto_box);
  scr_file_proto_box = NULL;
  scr_dyn_release(scr_blob_proto_box);
  scr_blob_proto_box = NULL;
}

/* %Blob% (is_file false) or %File% as process singletons. */
ScrDyn *scr_dyn_blob_class(bool is_file) {
  if (scr_blob_proto_box == NULL) {
    ScrDyn *bp = scr_dyn_new_obj(); /* %Blob.prototype% +1 */
    scr_blob_define_method(bp, "slice", scr_blob_m_slice, 0);
    scr_blob_define_method(bp, "text", scr_blob_m_text, 0);
    scr_blob_define_method(bp, "arrayBuffer", scr_blob_m_array_buffer, 0);
    scr_blob_define_method(bp, "bytes", scr_blob_m_bytes, 0);
    scr_blob_define_getter(bp, "size", scr_blob_g_size);
    scr_blob_define_getter(bp, "type", scr_blob_g_type);
    ScrDyn *c = scr_dyn_new_func(scr_closure_new((void *)scr_blob_ctor_thunk, 0), scr_blob_ctor_thunk, 2, "()", "Blob");
    ScrDyn *table = scr_dyn_fn_props(c);
    scr_dyn_obj_set(table, "prototype", 9, scr_dyn_retain(bp));
    scr_dyn_release(table);
    scr_dyn_obj_define_hidden_data(bp, "constructor", 11, c, true, true);
    scr_blob_ctor_box = c;
    scr_blob_proto_box = bp;

    ScrDyn *fp = scr_dyn_new_obj(); /* %File.prototype% +1 */
    scr_dyn_obj_set_proto(fp, bp);
    scr_blob_define_getter(fp, "name", scr_blob_g_name);
    scr_blob_define_getter(fp, "lastModified", scr_blob_g_last_modified);
    ScrDyn *fc = scr_dyn_new_func(scr_closure_new((void *)scr_file_ctor_thunk, 0), scr_file_ctor_thunk, 3, "()", "File");
    ScrDyn *ftable = scr_dyn_fn_props(fc);
    scr_dyn_obj_set(ftable, "prototype", 9, scr_dyn_retain(fp));
    scr_dyn_release(ftable);
    scr_dyn_obj_define_hidden_data(fp, "constructor", 11, fc, true, true);
    scr_file_ctor_box = fc;
    scr_file_proto_box = fp;
    scr_atexit(scr_blob_teardown);
  }
  return scr_dyn_retain(is_file ? scr_file_ctor_box : scr_blob_ctor_box);
}

const char *scr_enc_canon_dyn_pub(const ScrDyn *enc, bool lenient);
/* ── the builtin Buffer CLASS and the `buffer` MODULE as VALUES ──────────
 *
 * `Buffer` taken as a value (`var o = {}; o.B = Buffer`, `require('buffer')
 * .Buffer`, a package re-export) is a FUNCTION object in Node: typeof says
 * "function", it is stored and compared by identity, and its statics are
 * readable through any alias. The JavaScript identity token gave it the
 * type "string" (a silent wrong answer). This is the checked-dynamic box
 * for it, built the way %Uint8Array% is (scr_u8_build above): one immortal
 * function object whose property table holds the twelve enumerable
 * statics, in Node's for-in order.
 *
 * `require('buffer')` as a value is a second immortal box: the module's
 * fourteen enumerable keys, in Node's order, each one a value this tier
 * can hold. Blob and File are NOT in it yet (see the note at the end of
 * the module section): until they are, the whole-module box is not built
 * and the lowering refuses a whole-module value by name.
 *
 * Every static here answers by calling the runtime body the lowered
 * `Buffer.<member>(...)` form already uses, so the two spellings agree. */

static ScrDyn *scr_bv_ctor = NULL;      /* %Buffer%, owned by the singleton */
static ScrDyn *scr_bv_module = NULL;    /* require('buffer'), owned by the singleton */

static ScrDyn *scr_bv_new_fn(const char *name, ScrDynThunk thunk, uint32_t arity) {
  /* ZERO captures, a static literal name: the same contract as scr_u8_new_func. */
  return scr_dyn_new_func(scr_closure_new((void *)thunk, 0), thunk, arity, "()", name);
}

static const ScrDyn *scr_bv_arg(ScrDyn *const *args, size_t argc, size_t i) {
  return i < argc ? args[i] : scr_dyn_undefined();
}

static bool scr_bv_is_undef(const ScrDyn *d) {
  return d == NULL || d->kind == SCR_DYN_UNDEF;
}

/* Buffer.of's and Buffer.from(array)'s element rule: ToUint8 (mod 256, NaN 0). */
static uint8_t scr_bv_u8_of_num(double x) {
  double m = fmod(trunc(x), 256.0);
  if (!(m == m)) m = 0.0;
  if (m < 0) m += 256.0;
  return (uint8_t)m;
}

/* A fresh +1 Buffer-flavored dyn over a +1 bytes value (the caller's ref is consumed). */
static ScrDyn *scr_bv_wrap_buffer(ScrBytes *b) {
  if (b == NULL) return NULL;
  scr_bytes_stamp_buffer(b);
  ScrDyn *d = scr_dyn_new_bytes_ref(b);
  scr_bytes_release(b);
  return d;
}

/* ── Buffer.from(value, encodingOrOffset, length) as a VALUE ─────────────
 * Node's lib/buffer.js from(), arm by arm, over checked-dynamic operands
 * (the Buffer class's `from` box is the one every mention of Buffer.from
 * yields, so a program can store it and call it with any argument kinds):
 *   string           the encoding (ERR_UNKNOWN_ENCODING for an unknown name)
 *   ArrayBuffer      byteOffset and length; the Buffer ALIASES the buffer
 *   other objects    valueOf's answer when that is a string or an object
 *                    (not a number); else the array-like or the
 *                    {type:'Buffer', data} contents; a DataView is empty
 *   array / typed    every element ToNumber'd and ToUint8'd (BigInt throws)
 *   anything else    ERR_INVALID_ARG_TYPE, "first argument" wording
 * The direct Buffer.from(dyn) call takes this same path (scr_bv_from_dyn). */
#define SCR_BV_FROM_DEPTH_MAX 1000

static void scr_bv_throw_plain(const char *msg) {
  scr_throw_error(SCR_ERR_TYPE, scr_str_new(msg, strlen(msg)));
}

static void scr_bv_throw_kind(int kind, const char *msg) {
  scr_throw_error(kind, scr_str_new(msg, strlen(msg)));
}

/* Node's ERR_INVALID_ARG_TYPE for the first argument (the "first argument must be" wording:
 * no quotes, unlike scr_dyn_arg_type_fail). */
static void scr_bv_throw_first_arg(const ScrDyn *v) {
  char detail[64];
  const char *d = scr_dyn_specific_type(v, detail, sizeof detail);
  char msg[320];
  int len = snprintf(msg, sizeof msg,
                     "The first argument must be of type string or an instance of Buffer, ArrayBuffer, or Array or an Array-like Object. Received %s", d);
  scr_throw_error_msg_code(SCR_ERR_TYPE, msg, (size_t)len, "ERR_INVALID_ARG_TYPE");
}

static void scr_bv_throw_code(int kind, const char *msg, const char *code) {
  scr_throw_error_msg_code(kind, msg, strlen(msg), code);
}

/* A string's bytes under Buffer.from's encoding: an untyped encoding is lenient (anything but a
 * non-empty string is utf8), an unknown name throws ERR_UNKNOWN_ENCODING. +1, NULL pending. */
static ScrBytes *scr_bv_str_bytes(const ScrStr *s, const ScrDyn *enc) {
  const char *canon = scr_enc_canon_dyn_pub(enc, true);
  if (canon == NULL) return NULL;
  ScrStr *e = scr_str_new(canon, strlen(canon));
  ScrBytes *b = scr_bytes_from_str(s, e);
  scr_str_release(e);
  return b;
}

static ScrDyn *scr_bv_from_val(const ScrDyn *v, const ScrDyn *a1, const ScrDyn *a2, int depth);

/* JS ToNumber of one element (Node's typed-array store): BigInt throws, objects
 * run ToPrimitive(number). Writes *out; false with the exception pending. */
/* [[Get]] of one named member of an object-kind value (OBJ, or a class instance OBJINST): +1, a
 * missing member is undefined, NULL with the exception pending when a getter throws. A class
 * instance's method comes back bound to the instance (scr_dyn_objinst_member_get). */
static ScrDyn *scr_bv_get(const ScrDyn *v, const char *key, size_t kl) {
  if (v->kind == SCR_DYN_OBJINST) {
    ScrStr *k = scr_str_new(key, kl);
    ScrDyn *m = scr_dyn_objinst_member_get((ScrDyn *)v, k);
    scr_str_release(k);
    if (m != NULL) return m;
    if (scr_exc_pending()) return NULL;
    return scr_dyn_retain(scr_dyn_undefined());
  }
  return scr_dyn_obj_key_get((ScrDyn *)v, key, kl);
}

/* ToPrimitive(number hint) of a class instance: valueOf, then toString, each taken when it is a
 * method that answers a primitive; otherwise the built-in "[object Object]". +1, NULL pending. */
static ScrDyn *scr_bv_obj_prim(const ScrDyn *v) {
  static const char *const names[2] = { "valueOf", "toString" };
  for (int i = 0; i < 2; i++) {
    ScrDyn *m = scr_bv_get(v, names[i], strlen(names[i]));
    if (m == NULL) return NULL;
    if (m->kind != SCR_DYN_FUNC) {
      scr_dyn_release(m);
      continue;
    }
    scr_dyn_this_push_dyn(v);
    ScrDyn *r = scr_dyn_call(m, NULL, 0, names[i]);
    scr_dyn_this_pop();
    scr_dyn_release(m);
    if (r == NULL) return NULL;
    if (r->kind != SCR_DYN_OBJ && r->kind != SCR_DYN_OBJINST && r->kind != SCR_DYN_ARR &&
        r->kind != SCR_DYN_BYTES && r->kind != SCR_DYN_FUNC && r->kind != SCR_DYN_HANDLE &&
        r->kind != SCR_DYN_PROMISE && r->kind != SCR_DYN_MAP && r->kind != SCR_DYN_ARRBUF) {
      return r;
    }
    scr_dyn_release(r);
  }
  ScrStr *os = scr_str_new("[object Object]", 15);
  ScrDyn *od = scr_dyn_new_str(os); /* retains os */
  scr_str_release(os);
  return od;
}

static bool scr_bv_elem_num(const ScrDyn *e, double *out) {
  if (e == NULL) e = scr_dyn_undefined();
  if (e->kind == SCR_DYN_OBJINST) {
    ScrDyn *p = scr_bv_obj_prim(e);
    if (p == NULL) return false;
    *out = scr_dyn_to_number(p);
    scr_dyn_release(p);
    return !scr_exc_pending();
  }
  if (e->kind == SCR_DYN_BIG) {
    scr_bv_throw_plain("Cannot convert a BigInt value to a number");
    return false;
  }
  if (e->kind == SCR_DYN_OBJ || e->kind == SCR_DYN_ARR || e->kind == SCR_DYN_HANDLE) {
    ScrDyn *p = scr_dyn_to_primitive(e, SCR_TOPRIM_NUMBER);
    if (p == NULL) return false;
    if (p->kind == SCR_DYN_BIG) {
      scr_dyn_release(p);
      scr_bv_throw_plain("Cannot convert a BigInt value to a number");
      return false;
    }
    *out = scr_dyn_to_number(p);
    scr_dyn_release(p);
    return !scr_exc_pending();
  }
  *out = scr_dyn_to_number(e);
  return !scr_exc_pending();
}

/* A buffer of n bytes filled from element reads: f(i) answers the i-th element (+1, or
 * NULL with the exception pending). The one loop every array-like arm shares. */
typedef ScrDyn *(*ScrBvElemFn)(const ScrDyn *src, size_t i);

static ScrDyn *scr_bv_elem_of_arr(const ScrDyn *src, size_t i) {
  const ScrDyn *e = src->v.arr.items[i];
  return scr_dyn_retain(e != NULL ? (ScrDyn *)e : scr_dyn_undefined());
}

static ScrDyn *scr_bv_elem_of_obj(const ScrDyn *src, size_t i) {
  char key[32];
  int kl = snprintf(key, sizeof key, "%zu", i);
  return scr_bv_get(src, key, (size_t)kl);
}

static ScrDyn *scr_bv_fill_from_elems(const ScrDyn *src, size_t n, ScrBvElemFn elem) {
  ScrBytes *out = scr_bytes_new(SCR_BYTES_U8, (double)n);
  if (out == NULL) return NULL;
  for (size_t i = 0; i < n; i++) {
    ScrDyn *e = elem(src, i);
    if (e == NULL) {
      scr_bytes_release(out);
      return NULL;
    }
    double x = 0;
    bool ok = scr_bv_elem_num(e, &x);
    scr_dyn_release(e);
    if (!ok) {
      scr_bytes_release(out);
      return NULL;
    }
    out->data[i] = scr_bv_u8_of_num(x);
  }
  return scr_bv_wrap_buffer(out);
}

static ScrDyn *scr_bv_from_typed(const ScrBytes *b) {
  /* A typed array (Buffer included): element values, not raw bytes. */
  if (b->elem == SCR_BYTES_U8 || b->elem == SCR_BYTES_U8C) {
    ScrBytes *out = scr_bytes_new(SCR_BYTES_U8, (double)b->len);
    if (out == NULL) return NULL;
    if (b->len > 0) memcpy(out->data, b->data, b->len);
    return scr_bv_wrap_buffer(out);
  }
  if (b->elem == SCR_BYTES_I64 || b->elem == SCR_BYTES_U64) {
    if (b->len > 0) {
      scr_bv_throw_plain("Cannot mix BigInt and other types, use explicit conversions");
      return NULL;
    }
    return scr_bv_wrap_buffer(scr_bytes_new(SCR_BYTES_U8, 0));
  }
  ScrBytes *out = scr_bytes_new(SCR_BYTES_U8, (double)b->len);
  if (out == NULL) return NULL;
  for (size_t i = 0; i < b->len; i++) out->data[i] = scr_bv_u8_of_num(scr_bytes_get(b, (double)i));
  return scr_bv_wrap_buffer(out);
}

/* The ArrayBuffer arm: Node's fromArrayBuffer checks, then a Uint8Array view (aliasing). */
static ScrDyn *scr_bv_from_arrbuf(const ScrDyn *v, const ScrDyn *a1, const ScrDyn *a2) {
  double off = 0;
  if (a1->kind != SCR_DYN_UNDEF) {
    if (!scr_bv_elem_num(a1, &off)) return NULL;
    if (off != off) off = 0;
  }
  double maxlen = (double)v->v.bytes->len - off;
  if (maxlen < 0) {
    scr_bv_throw_code(SCR_ERR_RANGE, "\"offset\" is outside of buffer bounds", "ERR_BUFFER_OUT_OF_BOUNDS");
    return NULL;
  }
  double len = maxlen;
  if (a2->kind != SCR_DYN_UNDEF) {
    if (!scr_bv_elem_num(a2, &len)) return NULL;
    if (len > 0) {
      if (len > maxlen) {
        scr_bv_throw_code(SCR_ERR_RANGE, "\"length\" is outside of buffer bounds", "ERR_BUFFER_OUT_OF_BOUNDS");
        return NULL;
      }
    } else {
      len = 0;
    }
  }
  ScrDyn *od = scr_dyn_new_num(off);
  ScrDyn *ld = scr_dyn_new_num(len);
  ScrBytes *view = scr_dyn_u8view_new(v, od, ld);
  scr_dyn_release(od);
  scr_dyn_release(ld);
  if (view == NULL) return NULL;
  return scr_bv_wrap_buffer(view);
}

/* A Date (a handle, not an OBJ) has Symbol.toPrimitive, and Node's from() takes its
 * ToPrimitive('string') answer (valueOf answers a number, which from() ignores). Returns true
 * for a Date; *out is its buffer (+1), or NULL with the exception pending. */
static bool scr_bv_date_arm(const ScrDyn *v, const ScrDyn *a1, const ScrDyn *a2, int depth, ScrDyn **out) {
  char detail[64];
  const char *d = scr_dyn_specific_type(v, detail, sizeof detail);
  if (strcmp(d, "an instance of Date") != 0) return false;
  ScrDyn *p = scr_dyn_to_primitive(v, SCR_TOPRIM_STRING);
  if (p == NULL) {
    *out = NULL;
    return true;
  }
  *out = p->kind == SCR_DYN_STR ? scr_bv_from_val(p, a1, a2, depth + 1) : NULL;
  scr_dyn_release(p);
  return true;
}

static ScrDyn *scr_bv_from_obj(const ScrDyn *v, const ScrDyn *a1, const ScrDyn *a2, int depth) {
  /* valueOf: its answer is used when it is a string or an object other than v. */
  ScrDyn *vo = scr_bv_get(v, "valueOf", 7);
  if (vo == NULL) return NULL;
  if (vo->kind == SCR_DYN_FUNC) {
    /* The call window carries the receiver as `this` (an OBJ method is not bound to it). */
    scr_dyn_this_push_dyn(v);
    ScrDyn *r = scr_dyn_call(vo, NULL, 0, "valueOf");
    scr_dyn_this_pop();
    scr_dyn_release(vo);
    if (r == NULL) return NULL;
    bool object = r->kind == SCR_DYN_STR ||
                  (r->kind != SCR_DYN_NULL && r->kind != SCR_DYN_FUNC && r->kind != SCR_DYN_NUM &&
                   r->kind != SCR_DYN_BOOL && r->kind != SCR_DYN_UNDEF && r->kind != SCR_DYN_BIG &&
                   scr_dyn_typeof_is_object(r));
    if (r != v && object) {
      ScrDyn *out = scr_bv_from_val(r, a1, a2, depth + 1);
      scr_dyn_release(r);
      return out;
    }
    scr_dyn_release(r);
  } else {
    scr_dyn_release(vo);
  }
  /* fromObject: an array-like (a numeric length, or a buffer-backed object), then {type:'Buffer', data}. */
  ScrDyn *len = scr_bv_get(v, "length", 6);
  if (len == NULL) return NULL;
  ScrDyn *abuf = NULL;
  if (len->kind == SCR_DYN_UNDEF) {
    abuf = scr_bv_get(v, "buffer", 6);
    if (abuf == NULL) {
      scr_dyn_release(len);
      return NULL;
    }
    if (abuf->kind == SCR_DYN_ARRBUF) {
      scr_dyn_release(abuf);
      scr_dyn_release(len);
      return scr_bv_wrap_buffer(scr_bytes_new(SCR_BYTES_U8, 0));
    }
    scr_dyn_release(abuf);
    ScrDyn *type = scr_bv_get(v, "type", 4);
    if (type == NULL) {
      scr_dyn_release(len);
      return NULL;
    }
    bool is_buffer_type = type->kind == SCR_DYN_STR && type->v.str->len == 6 && memcmp(type->v.str->data, "Buffer", 6) == 0;
    scr_dyn_release(type);
    if (is_buffer_type) {
      ScrDyn *data = scr_bv_get(v, "data", 4);
      if (data == NULL) {
        scr_dyn_release(len);
        return NULL;
      }
      if (data->kind == SCR_DYN_ARR) {
        ScrDyn *out = scr_bv_fill_from_elems(data, data->v.arr.len, scr_bv_elem_of_arr);
        scr_dyn_release(data);
        scr_dyn_release(len);
        return out;
      }
      scr_dyn_release(data);
    }
    scr_dyn_release(len);
    {
      ScrDyn *dout = NULL;
      if (scr_bv_date_arm(v, a1, a2, depth, &dout)) return dout;
    }
    scr_bv_throw_first_arg(v);
    return NULL;
  }
  if (len->kind != SCR_DYN_NUM) {
    scr_dyn_release(len);
    return scr_bv_wrap_buffer(scr_bytes_new(SCR_BYTES_U8, 0));
  }
  double n = len->v.num;
  scr_dyn_release(len);
  if (!(n > 0)) n = 0;
  n = floor(n);
  return scr_bv_fill_from_elems(v, (size_t)n, scr_bv_elem_of_obj);
}

static ScrDyn *scr_bv_from_val(const ScrDyn *v, const ScrDyn *a1, const ScrDyn *a2, int depth) {
  if (depth > SCR_BV_FROM_DEPTH_MAX) {
    scr_bv_throw_kind(SCR_ERR_RANGE, "Maximum call stack size exceeded");
    return NULL;
  }
  switch (v->kind) {
    case SCR_DYN_STR: {
      ScrBytes *b = scr_bv_str_bytes(v->v.str, a1);
      if (b == NULL) return NULL;
      return scr_bv_wrap_buffer(b);
    }
    case SCR_DYN_ARRBUF:
      return scr_bv_from_arrbuf(v, a1, a2);
    case SCR_DYN_BYTES:
      if (v->v.bytes->flavor == SCR_BF_DATAVIEW) return scr_bv_wrap_buffer(scr_bytes_new(SCR_BYTES_U8, 0));
      return scr_bv_from_typed(v->v.bytes);
    case SCR_DYN_ARR:
      return scr_bv_fill_from_elems(v, v->v.arr.len, scr_bv_elem_of_arr);
    case SCR_DYN_OBJ:
    case SCR_DYN_OBJINST:
      return scr_bv_from_obj(v, a1, a2, depth);
    default:
      break;
  }
  {
    ScrDyn *dout = NULL;
    if (scr_bv_date_arm(v, a1, a2, depth, &dout)) return dout;
  }
  scr_bv_throw_first_arg(v);
  return NULL;
}

/* The direct Buffer.from(dyn) call and Buffer.from(dyn, enc) (lower-containers: an untyped operand):
 * the value path with the missing arguments undefined. +1 ScrBytes, NULL with the exception pending. */
static ScrBytes *scr_bv_direct(const ScrDyn *v, const ScrDyn *enc) {
  ScrDyn *d = scr_bv_from_val(v, enc, scr_dyn_undefined(), 0);
  if (d == NULL) return NULL;
  ScrBytes *b = scr_bytes_retain(d->v.bytes);
  scr_dyn_release(d);
  return b;
}

ScrBytes *scr_bv_from_dyn(const ScrDyn *v) { return scr_bv_direct(v, scr_dyn_undefined()); }
ScrBytes *scr_bv_from_dyn_enc(const ScrDyn *v, const ScrDyn *enc) { return scr_bv_direct(v, enc); }

static ScrDyn *scr_bv_s_from(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  return scr_bv_from_val(scr_bv_arg(args, argc, 0), scr_bv_arg(args, argc, 1), scr_bv_arg(args, argc, 2), 0);
}

static ScrDyn *scr_bv_s_of(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  ScrBytes *b = scr_bytes_new(SCR_BYTES_U8, (double)argc);
  if (b == NULL) return NULL;
  for (size_t i = 0; i < argc; i++) {
    double x = scr_dyn_to_number(args[i]);
    if (scr_exc_pending()) {
      scr_bytes_release(b);
      return NULL;
    }
    b->data[i] = scr_bv_u8_of_num(x);
  }
  return scr_bv_wrap_buffer(b);
}

/* alloc / allocUnsafe / allocUnsafeSlow / SlowBuffer: zero-filled (the
 * lowered forms say the same: an unspecified allocUnsafe is zeros). The
 * size goes through Node's validateNumber (type) and the kMaxLength range. */
static ScrBytes *scr_bv_size_buffer(const ScrDyn *size) {
  if (size == NULL || size->kind != SCR_DYN_NUM) {
    scr_dyn_arg_type_fail("size", "of type number", size != NULL ? size : scr_dyn_undefined());
    return NULL;
  }
  if (!scr_bytes_validate_off("size", size->v.num, 9007199254740991.0)) return NULL;
  return scr_bytes_new(SCR_BYTES_U8, size->v.num);
}

static ScrDyn *scr_bv_alloc_impl(ScrDyn *const *args, size_t argc, bool with_fill) {
  ScrBytes *b = scr_bv_size_buffer(scr_bv_arg(args, argc, 0));
  if (b == NULL) return NULL;
  const ScrDyn *fill = with_fill ? scr_bv_arg(args, argc, 1) : scr_dyn_undefined();
  if (!scr_bv_is_undef(fill)) {
    ScrBytes *r = NULL;
    if (fill->kind == SCR_DYN_NUM) {
      r = scr_bytes_fill_num(b, fill->v.num, 0, 0, 0);
    } else if (fill->kind == SCR_DYN_STR) {
      const ScrDyn *encv = scr_bv_arg(args, argc, 2);
      const char *canon = scr_enc_canon_dyn_pub(encv, false);
      if (canon == NULL) {
        scr_bytes_release(b);
        return NULL;
      }
      ScrStr *e = scr_str_new(canon, strlen(canon));
      r = scr_bytes_fill_str(b, fill->v.str, e, 0, 0, 0);
      scr_str_release(e);
    } else if (fill->kind == SCR_DYN_BYTES && fill->v.bytes != NULL) {
      r = scr_bytes_fill(b, fill->v.bytes, 0, 0, 0);
    } else {
      scr_bytes_release(b);
      scr_dyn_arg_type_fail("value", "of type string or an instance of Buffer or Uint8Array", fill);
      return NULL;
    }
    scr_bytes_release(b);
    b = r;
    if (b == NULL) return NULL;
  }
  return scr_bv_wrap_buffer(b);
}

static ScrDyn *scr_bv_s_alloc(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  return scr_bv_alloc_impl(args, argc, true);
}

static ScrDyn *scr_bv_s_alloc_unsafe(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  return scr_bv_alloc_impl(args, argc, false);
}

/* Buffer(...) and new Buffer(...) without the statics: Node's legacy constructor. A NUMBER is
 * the zero-filled allocation (DEP0005, Buffer.alloc); anything else is Buffer.from(value, ...). */
static ScrDyn *scr_bv_ctor_call(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  if (argc >= 1 && args[0]->kind == SCR_DYN_NUM) return scr_bv_alloc_impl(args, argc, false);
  return scr_bv_s_from(clo, args, argc);
}

static ScrDyn *scr_bv_s_is_buffer(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  ScrStr *why = scr_str_new("Buffer.isBuffer", 15); /* names the site if the flavor is unknown */
  bool r = scr_dyn_is_buffer(scr_bv_arg(args, argc, 0), why);
  scr_str_release(why);
  if (scr_exc_pending()) return NULL;
  return scr_dyn_new_bool(r);
}

static ScrDyn *scr_bv_s_compare(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  double r = scr_buffer_compare_chk(scr_bv_arg(args, argc, 0), scr_bv_arg(args, argc, 1));
  if (scr_exc_pending()) return NULL;
  return scr_dyn_new_num(r);
}

static ScrDyn *scr_bv_s_concat(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  ScrBytes *b = argc >= 2 && !scr_bv_is_undef(args[1])
                    ? scr_buffer_concat_dyn_len(scr_bv_arg(args, argc, 0), args[1])
                    : scr_buffer_concat_dyn(scr_bv_arg(args, argc, 0));
  return scr_bv_wrap_buffer(b);
}

static ScrDyn *scr_bv_s_byte_length(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  double n = scr_buffer_byte_length_dyn(scr_bv_arg(args, argc, 0), scr_bv_arg(args, argc, 1));
  if (scr_exc_pending()) return NULL;
  return scr_dyn_new_num(n);
}

static ScrDyn *scr_bv_s_is_encoding(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  return scr_dyn_new_bool(scr_buffer_is_encoding_dyn(scr_bv_arg(args, argc, 0)));
}

/* Buffer.copyBytesFrom(view, offset, length): a fresh Buffer of the view's
 * elements' bytes, element-indexed like Node. */
static ScrDyn *scr_bv_s_copy_bytes_from(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  const ScrDyn *view = scr_bv_arg(args, argc, 0);
  if (view->kind != SCR_DYN_BYTES || view->v.bytes == NULL) {
    scr_dyn_arg_type_fail("view", "an instance of TypedArray", view);
    return NULL;
  }
  const ScrBytes *src = view->v.bytes;
  double total = (double)src->len;
  double off = 0, len = total;
  if (argc >= 2 && !scr_bv_is_undef(args[1])) {
    off = scr_dyn_to_number(args[1]);
    if (scr_exc_pending()) return NULL;
    if (!scr_bytes_validate_off("offset", off, total)) return NULL;
  }
  if (argc >= 3 && !scr_bv_is_undef(args[2])) {
    len = scr_dyn_to_number(args[2]);
    if (scr_exc_pending()) return NULL;
    if (!scr_bytes_validate_off("length", len, total - off)) return NULL;
  } else {
    len = total - off;
  }
  size_t es = scr_bytes_elem_size(src->elem);
  ScrBytes *b = scr_bytes_new(SCR_BYTES_U8, len * (double)es);
  if (b == NULL) return NULL;
  if (b->len > 0) memcpy(b->data, src->data + (size_t)off * es, b->len);
  return scr_bv_wrap_buffer(b);
}

static ScrDyn *scr_bv_pool_size_value(void) { return scr_dyn_new_num(8192); }

/* SlowBuffer(size): the module's deprecated alias of allocUnsafeSlow. Node
 * also prints DEP0030 to stderr, which this build does not reproduce. */
static ScrDyn *scr_bv_m_slow_buffer(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  return scr_bv_alloc_impl(args, argc, false);
}

/* Node's transcode accepts four encodings and answers ICU's refusal for any
 * other pair. Decoding is UTF-16 code units, encoding substitutes '?'
 * where the target cannot hold a unit (ICU's default substitution). */
static int scr_bv_tc_enc(const ScrDyn *d) {
  if (d == NULL || d->kind != SCR_DYN_STR) return -1;
  const ScrStr *s = d->v.str;
  if (s->len == 4 && memcmp(s->data, "utf8", 4) == 0) return 0;
  if (s->len == 4 && memcmp(s->data, "ucs2", 4) == 0) return 1;
  if (s->len == 6 && memcmp(s->data, "latin1", 6) == 0) return 2;
  if (s->len == 5 && memcmp(s->data, "ascii", 5) == 0) return 3;
  return -1;
}

static ScrDyn *scr_bv_m_transcode(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  const ScrDyn *src = scr_bv_arg(args, argc, 0);
  if (src->kind != SCR_DYN_BYTES || src->v.bytes == NULL) {
    scr_dyn_arg_type_fail("source", "an instance of Buffer or Uint8Array", src);
    return NULL;
  }
  int from = scr_bv_tc_enc(scr_bv_arg(args, argc, 1));
  int to = scr_bv_tc_enc(scr_bv_arg(args, argc, 2));
  if (from < 0 || to < 0) {
    static const char msg[] = "Unable to transcode Buffer [U_ILLEGAL_ARGUMENT_ERROR]";
    scr_throw_error_msg_code(SCR_ERR_ERROR, msg, sizeof msg - 1, "U_ILLEGAL_ARGUMENT_ERROR");
    return NULL;
  }
  const ScrBytes *b = src->v.bytes;
  const uint8_t *in = (const uint8_t *)b->data;
  size_t n = b->len * scr_bytes_elem_size(b->elem);
  /* Decode into code points (<= 0x10FFFF) first, then encode each one. */
  size_t cap = n * 2 + 4, k = 0;
  uint32_t *cp = (uint32_t *)malloc(cap * sizeof(uint32_t));
  if (cp == NULL) scr_bytes_io_oom();
  if (from == 0) { /* utf8, WHATWG replacement on bad sequences */
    size_t i = 0;
    while (i < n) {
      uint8_t c = in[i];
      if (c < 0x80) { cp[k++] = c; i++; continue; }
      int need = 0; uint32_t v = 0, lo = 0x80, hi = 0xBF;
      if (c >= 0xC2 && c <= 0xDF) { need = 1; v = c & 0x1F; }
      else if (c >= 0xE0 && c <= 0xEF) { need = 2; v = c & 0x0F; if (c == 0xE0) lo = 0xA0; if (c == 0xED) hi = 0x9F; }
      else if (c >= 0xF0 && c <= 0xF4) { need = 3; v = c & 0x07; if (c == 0xF0) lo = 0x90; if (c == 0xF4) hi = 0x8F; }
      else { cp[k++] = 0xFFFD; i++; continue; }
      size_t j = i + 1; bool ok = true;
      for (int r = 0; r < need; r++, j++) {
        if (j >= n || in[j] < lo || in[j] > hi) { ok = false; break; }
        v = (v << 6) | (in[j] & 0x3F);
        lo = 0x80; hi = 0xBF;
      }
      if (ok) { cp[k++] = v; i = j; }
      else { cp[k++] = 0xFFFD; i = j > i + 1 ? j : i + 1; }
    }
  } else if (from == 1) { /* ucs2: LE pairs, a trailing odd byte is dropped */
    for (size_t i = 0; i + 1 < n; i += 2) cp[k++] = (uint32_t)in[i] | ((uint32_t)in[i + 1] << 8);
  } else if (from == 2) { /* latin1: one unit per byte */
    for (size_t i = 0; i < n; i++) cp[k++] = in[i];
  } else { /* ascii: a byte above 0x7F is U+FFFD */
    for (size_t i = 0; i < n; i++) cp[k++] = in[i] < 0x80 ? in[i] : 0xFFFD;
  }
  /* Encode. The byte count is bounded by 4 per code point (utf8) or 2 (ucs2). */
  size_t outcap = k * 4 + 4;
  uint8_t *out = (uint8_t *)malloc(outcap);
  if (out == NULL) { free(cp); scr_bytes_io_oom(); }
  size_t o = 0;
  for (size_t i = 0; i < k; i++) {
    uint32_t c = cp[i];
    if (to == 0) {
      if (c >= 0xD800 && c <= 0xDFFF) c = 0xFFFD;
      if (c < 0x80) out[o++] = (uint8_t)c;
      else if (c < 0x800) { out[o++] = (uint8_t)(0xC0 | (c >> 6)); out[o++] = (uint8_t)(0x80 | (c & 0x3F)); }
      else if (c < 0x10000) { out[o++] = (uint8_t)(0xE0 | (c >> 12)); out[o++] = (uint8_t)(0x80 | ((c >> 6) & 0x3F)); out[o++] = (uint8_t)(0x80 | (c & 0x3F)); }
      else { out[o++] = (uint8_t)(0xF0 | (c >> 18)); out[o++] = (uint8_t)(0x80 | ((c >> 12) & 0x3F)); out[o++] = (uint8_t)(0x80 | ((c >> 6) & 0x3F)); out[o++] = (uint8_t)(0x80 | (c & 0x3F)); }
    } else if (to == 1) {
      uint32_t u = c > 0xFFFF ? 0xFFFD : c;
      out[o++] = (uint8_t)(u & 0xFF); out[o++] = (uint8_t)(u >> 8);
    } else if (to == 2) {
      out[o++] = c > 0xFF ? (uint8_t)'?' : (uint8_t)c;
    } else {
      out[o++] = c > 0x7F ? (uint8_t)'?' : (uint8_t)c;
    }
  }
  free(cp);
  ScrBytes *res = scr_bytes_new(SCR_BYTES_U8, (double)o);
  if (res == NULL) { free(out); return NULL; }
  if (o > 0) memcpy(res->data, out, o);
  free(out);
  return scr_bv_wrap_buffer(res);
}

/* isAscii / isUtf8 over an ArrayBuffer, a Buffer or a TypedArray. */
static bool scr_bv_input_bytes(const ScrDyn *in, const uint8_t **data, size_t *n) {
  if ((in->kind != SCR_DYN_BYTES && in->kind != SCR_DYN_ARRBUF) || in->v.bytes == NULL) {
    scr_dyn_arg_type_fail("input", "an instance of ArrayBuffer, Buffer, or TypedArray", in);
    return false;
  }
  *data = (const uint8_t *)in->v.bytes->data;
  *n = in->v.bytes->len * scr_bytes_elem_size(in->v.bytes->elem);
  return true;
}

static ScrDyn *scr_bv_m_is_ascii(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  const uint8_t *d = NULL; size_t n = 0;
  if (!scr_bv_input_bytes(scr_bv_arg(args, argc, 0), &d, &n)) return NULL;
  for (size_t i = 0; i < n; i++) if (d[i] > 0x7F) return scr_dyn_new_bool(false);
  return scr_dyn_new_bool(true);
}

static ScrDyn *scr_bv_m_is_utf8(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  const uint8_t *in = NULL; size_t n = 0;
  if (!scr_bv_input_bytes(scr_bv_arg(args, argc, 0), &in, &n)) return NULL;
  size_t i = 0;
  while (i < n) {
    uint8_t c = in[i];
    if (c < 0x80) { i++; continue; }
    int need; uint32_t lo = 0x80, hi = 0xBF;
    if (c >= 0xC2 && c <= 0xDF) need = 1;
    else if (c >= 0xE0 && c <= 0xEF) { need = 2; if (c == 0xE0) lo = 0xA0; if (c == 0xED) hi = 0x9F; }
    else if (c >= 0xF0 && c <= 0xF4) { need = 3; if (c == 0xF0) lo = 0x90; if (c == 0xF4) hi = 0x8F; }
    else return scr_dyn_new_bool(false);
    for (int r = 0; r < need; r++) {
      if (i + 1 + r >= n) return scr_dyn_new_bool(false);
      uint8_t b = in[i + 1 + r];
      if (b < lo || b > hi) return scr_dyn_new_bool(false);
      lo = 0x80; hi = 0xBF;
    }
    i += (size_t)need + 1;
  }
  return scr_dyn_new_bool(true);
}

static ScrDyn *scr_bv_m_btoa(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  ScrStr *s = scr_btoa(scr_bv_arg(args, argc, 0));
  if (s == NULL) return NULL;
  ScrDyn *r_ = scr_dyn_new_str(s); /* retains */
  scr_str_release(s);
  return r_;
}

static ScrDyn *scr_bv_m_atob(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  ScrStr *s = scr_atob(scr_bv_arg(args, argc, 0));
  if (s == NULL) return NULL;
  ScrDyn *r_ = scr_dyn_new_str(s); /* retains */
  scr_str_release(s);
  return r_;
}

static ScrDyn *scr_bv_m_resolve_object_url(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  (void)args;
  (void)argc;
  /* No URL.createObjectURL exists in a static build, so no blob: URL is ever registered. */
  return scr_dyn_undefined();
}

static ScrDyn *scr_bv_build_constants(void) {
  ScrDyn *c = scr_dyn_new_obj();
  scr_dyn_obj_set(c, "MAX_LENGTH", 10, scr_dyn_new_num(9007199254740991.0));
  scr_dyn_obj_set(c, "MAX_STRING_LENGTH", 17, scr_dyn_new_num(536870888.0));
  return c;
}

static void scr_bv_teardown(void) {
  scr_dyn_release(scr_bv_module);
  scr_bv_module = NULL;
  scr_dyn_release(scr_bv_ctor);
  scr_bv_ctor = NULL;
}

/* %Buffer% as a value. Built once; every mention of Buffer yields this box,
 * so `===` is a pointer compare, as in Node. */
ScrDyn *scr_dyn_buffer_ctor(void) {
  if (scr_bv_ctor != NULL) return scr_dyn_retain(scr_bv_ctor);
  ScrDyn *c = scr_bv_new_fn("Buffer", scr_bv_ctor_call, 2); /* +1 */
  /* Node's for-in order: poolSize, from, copyBytesFrom, of, alloc,
   * allocUnsafe, allocUnsafeSlow, isBuffer, compare, isEncoding, concat,
   * byteLength. Each is an enumerable data property of the class. */
  ScrDyn *table = scr_dyn_fn_props(c); /* +1 */
  scr_dyn_obj_set(table, "poolSize", 8, scr_bv_pool_size_value());
  scr_dyn_obj_set(table, "from", 4, scr_bv_new_fn("from", scr_bv_s_from, 3));
  scr_dyn_obj_set(table, "copyBytesFrom", 13, scr_bv_new_fn("copyBytesFrom", scr_bv_s_copy_bytes_from, 3));
  scr_dyn_obj_set(table, "of", 2, scr_bv_new_fn("of", scr_bv_s_of, 0));
  scr_dyn_obj_set(table, "alloc", 5, scr_bv_new_fn("alloc", scr_bv_s_alloc, 3));
  scr_dyn_obj_set(table, "allocUnsafe", 11, scr_bv_new_fn("allocUnsafe", scr_bv_s_alloc_unsafe, 1));
  scr_dyn_obj_set(table, "allocUnsafeSlow", 15, scr_bv_new_fn("allocUnsafeSlow", scr_bv_s_alloc_unsafe, 1));
  scr_dyn_obj_set(table, "isBuffer", 8, scr_bv_new_fn("isBuffer", scr_bv_s_is_buffer, 1));
  scr_dyn_obj_set(table, "compare", 7, scr_bv_new_fn("compare", scr_bv_s_compare, 2));
  scr_dyn_obj_set(table, "isEncoding", 10, scr_bv_new_fn("isEncoding", scr_bv_s_is_encoding, 1));
  scr_dyn_obj_set(table, "concat", 6, scr_bv_new_fn("concat", scr_bv_s_concat, 2));
  scr_dyn_obj_set(table, "byteLength", 10, scr_bv_new_fn("byteLength", scr_bv_s_byte_length, 2));
  scr_dyn_release(table);
  scr_bv_ctor = c; /* the singleton keeps this +1 */
  scr_atexit(scr_bv_teardown);
  return scr_dyn_retain(scr_bv_ctor);
}

/* The value of one enumerable member of require('buffer'), by its index in
 * Node's for-in order with Blob and File left out (they have no runtime
 * value yet, so the whole-module box is not built). The index is the
 * lowering's literal: 0 Buffer, 1 SlowBuffer, 2 transcode, 3 isUtf8,
 * 4 isAscii, 5 kMaxLength, 6 kStringMaxLength, 7 btoa, 8 atob, 9 constants,
 * 10 INSPECT_MAX_BYTES, 11 resolveObjectURL. Any other index is a lowering bug. */
static ScrDyn *scr_bv_build_value(int which) {
  switch (which) {
    case 0: return scr_dyn_buffer_ctor();
    case 1: return scr_bv_new_fn("SlowBuffer", scr_bv_m_slow_buffer, 1);
    case 2: return scr_bv_new_fn("transcode", scr_bv_m_transcode, 3);
    case 3: return scr_bv_new_fn("isUtf8", scr_bv_m_is_utf8, 1);
    case 4: return scr_bv_new_fn("isAscii", scr_bv_m_is_ascii, 1);
    case 5: return scr_dyn_new_num(9007199254740991.0);
    case 6: return scr_dyn_new_num(536870888.0);
    case 7: return scr_bv_new_fn("btoa", scr_bv_m_btoa, 1);
    case 8: return scr_bv_new_fn("atob", scr_bv_m_atob, 1);
    case 9: return scr_bv_build_constants();
    case 10: return scr_dyn_new_num(50);
    case 11: return scr_bv_new_fn("resolveObjectURL", scr_bv_m_resolve_object_url, 1);
    case 12: return scr_dyn_blob_class(false);
    case 13: return scr_dyn_blob_class(true);
    default: break;
  }
  return NULL;
}

/* require('buffer') as a value: ONE process object (the cache keeps it), its fourteen
 * enumerable keys in Node's for-in order. Each key is the cached member value, so
 * `require('buffer').Buffer === Buffer` holds through the object too. */
ScrDyn *scr_dyn_buffer_module(void) {
  static const int order[14] = {0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 11, 13};
  static const char *const names[14] = {
    "Buffer", "SlowBuffer", "transcode", "isUtf8", "isAscii", "kMaxLength", "kStringMaxLength",
    "btoa", "atob", "constants", "INSPECT_MAX_BYTES", "Blob", "resolveObjectURL", "File",
  };
  ScrDyn *obj = scr_dyn_new_obj(); /* +1 */
  for (size_t k = 0; k < 14; k++) {
    ScrDyn *v = scr_dyn_buffer_value((double)order[k]); /* +1 */
    if (v == NULL) {
      scr_dyn_release(obj);
      return NULL;
    }
    scr_dyn_obj_set(obj, names[k], strlen(names[k]), v); /* takes the +1 */
  }
  return obj;
}

/* ── %Buffer.prototype% as a VALUE ─────────────────────────────────────────
 *
 * `Buffer.prototype` read as a value is the prototype object Node's Buffer
 * instances inherit from: its own enumerable keys are the 95 names of
 * Node's for-in (93 functions, parent/offset getters), in Node's order; its
 * prototype is %Uint8Array.prototype% and its constructor is %Buffer%. A
 * key Node points at ONE function object (the 19 lowercase/toLocaleString
 * spellings) is ONE box here too, so `P.readUint8 === P.readUInt8` holds.
 *
 * What a method DOES is implemented where the runtime already has the body:
 * the fixed-width numeric reads and writes (scr_bytes_read_num /
 * scr_bytes_write_num, Node's own range errors) and the variable-width
 * family (scr_bytes_read_var / scr_bytes_write_var). Every other method is a
 * LOUD refusal when it is called as a value: a named TypeError, never the
 * is-not-a-function that would read as Node's absence. The numeric
 * methods read the receiver as a byte array (Node's readUInt8 reads any
 * Uint8Array-shaped this). A non-number argument refuses by name (Node
 * coerces it; this tier does not yet). */

#define BVP_N 95

typedef struct {
  const char *key;
  int canon;
  int getter;
  ScrDynThunk fn;
  uint32_t arity;
  const char *name;
} BvpRow;

/* Refuses a method of %Buffer.prototype% that this tier does not answer yet. Returns NULL with the
 * TypeError pending. */
static ScrDyn *scr_bvp_refuse(const char *name, const char *why) {
  ScrJsonBuf jb;
  scr_jb_init(&jb);
  scr_jb_puts(&jb, "Buffer.prototype.");
  scr_jb_puts(&jb, name);
  scr_jb_puts(&jb, " (");
  scr_jb_puts(&jb, why);
  scr_jb_puts(&jb, ") is not implemented as a value in scriptc yet");
  scr_throw_error(SCR_ERR_ERROR, scr_jb_finish(&jb));
  return NULL;
}

/* The prototype thunks of the names the byte-array dispatch answers (scr_json.c): the receiver's own
 * Buffer-only body first, then the typed-array body, both shared with the dynamic and static spellings. */
static ScrDyn *scr_bvp_dyn(const char *name, ScrDyn *const *args, size_t argc) {
  ScrDyn *self = scr_dyn_this_get();
  if (self == NULL || self->kind != SCR_DYN_BYTES) {
    if (self != NULL) scr_dyn_release(self);
    return scr_bvp_refuse(name, "receiver is not a byte array");
  }
  bool known = false;
  ScrDyn *r = scr_dyn_buffer_only_method(self, name, args, argc, "Buffer.prototype", &known);
  if (!known) r = scr_dyn_bytes_method(self, name, args, argc, "Buffer.prototype", &known);
  scr_dyn_release(self);
  if (!known) return scr_bvp_refuse(name, "not a method of a byte array");
  return r;
}
#define BVP_DYN(fn, nm) \
  static ScrDyn *fn(ScrClosure *clo, ScrDyn *const *args, size_t argc) { \
    (void)clo; return scr_bvp_dyn(nm, args, argc); }

/* The receiver: a BYTES box (borrowed from self). */
static ScrDyn *scr_bvp_recv(ScrDyn *self, const char *name) {
  if (self == NULL || self->kind != SCR_DYN_BYTES) {
    scr_bvp_refuse(name, "receiver is not a byte array");
    return NULL;
  }
  return self;
}

static ScrDyn *scr_bvp_rd(const char *name, ScrBytesNumKind kind, bool le, ScrDyn *const *args, size_t argc) {
  ScrDyn *self = scr_dyn_this_get();
  ScrDyn *recv = scr_bvp_recv(self, name);
  double off = 0;
  if (recv != NULL && argc >= 1 && args[0]->kind != SCR_DYN_UNDEF) {
    if (args[0]->kind != SCR_DYN_NUM) {
      scr_bvp_refuse(name, "non-number offset");
      recv = NULL;
    } else {
      off = args[0]->v.num;
    }
  }
  double r = 0;
  if (recv != NULL) r = scr_bytes_read_num(recv->v.bytes, off, kind, le);
  if (self != NULL) scr_dyn_release(self);
  if (recv == NULL || scr_exc_pending()) return NULL;
  return scr_dyn_new_num(r);
}

static ScrDyn *scr_bvp_wr(const char *name, ScrBytesNumKind kind, bool le, ScrDyn *const *args, size_t argc) {
  ScrDyn *self = scr_dyn_this_get();
  ScrDyn *recv = scr_bvp_recv(self, name);
  double v = 0, off = 0;
  if (recv != NULL && (argc < 1 || args[0]->kind != SCR_DYN_NUM)) {
    scr_bvp_refuse(name, "non-number value");
    recv = NULL;
  } else if (recv != NULL) {
    v = args[0]->v.num;
    if (argc >= 2 && args[1]->kind != SCR_DYN_UNDEF) {
      if (args[1]->kind != SCR_DYN_NUM) {
        scr_bvp_refuse(name, "non-number offset");
        recv = NULL;
      } else {
        off = args[1]->v.num;
      }
    }
  }
  double r = 0;
  if (recv != NULL) r = scr_bytes_write_num(recv->v.bytes, v, off, kind, le);
  if (self != NULL) scr_dyn_release(self);
  if (recv == NULL || scr_exc_pending()) return NULL;
  return scr_dyn_new_num(r);
}

/* readUIntLE(offset = 0, byteLength) / readIntLE: byteLength is required here. */
static ScrDyn *scr_bvp_rdv(const char *name, bool sign, bool le, ScrDyn *const *args, size_t argc) {
  ScrDyn *self = scr_dyn_this_get();
  ScrDyn *recv = scr_bvp_recv(self, name);
  double off = 0, blen = 0;
  if (recv != NULL && (argc < 2 || args[1]->kind != SCR_DYN_NUM)) {
    scr_bvp_refuse(name, "byteLength is not a number");
    recv = NULL;
  } else if (recv != NULL) {
    blen = args[1]->v.num;
    if (argc >= 1 && args[0]->kind != SCR_DYN_UNDEF) {
      if (args[0]->kind != SCR_DYN_NUM) {
        scr_bvp_refuse(name, "non-number offset");
        recv = NULL;
      } else {
        off = args[0]->v.num;
      }
    }
  }
  double r = 0;
  if (recv != NULL) r = scr_bytes_read_var(recv->v.bytes, off, blen, sign, le);
  if (self != NULL) scr_dyn_release(self);
  if (recv == NULL || scr_exc_pending()) return NULL;
  return scr_dyn_new_num(r);
}

/* writeUIntLE(value, offset = 0, byteLength): byteLength is required here. */
static ScrDyn *scr_bvp_wrv(const char *name, bool sign, bool le, ScrDyn *const *args, size_t argc) {
  ScrDyn *self = scr_dyn_this_get();
  ScrDyn *recv = scr_bvp_recv(self, name);
  double v = 0, off = 0, blen = 0;
  if (recv != NULL && (argc < 3 || args[0]->kind != SCR_DYN_NUM || args[2]->kind != SCR_DYN_NUM)) {
    scr_bvp_refuse(name, "non-number value or byteLength");
    recv = NULL;
  } else if (recv != NULL) {
    v = args[0]->v.num;
    blen = args[2]->v.num;
    if (args[1]->kind != SCR_DYN_UNDEF) {
      if (args[1]->kind != SCR_DYN_NUM) {
        scr_bvp_refuse(name, "non-number offset");
        recv = NULL;
      } else {
        off = args[1]->v.num;
      }
    }
  }
  double r = 0;
  if (recv != NULL) r = scr_bytes_write_var(recv->v.bytes, v, off, blen, sign, le);
  if (self != NULL) scr_dyn_release(self);
  if (recv == NULL || scr_exc_pending()) return NULL;
  return scr_dyn_new_num(r);
}

#define BVP_RD(fn, nm, kind, le) \
  static ScrDyn *fn(ScrClosure *clo, ScrDyn *const *args, size_t argc) { \
    (void)clo; return scr_bvp_rd(nm, kind, le, args, argc); }
#define BVP_WR(fn, nm, kind, le) \
  static ScrDyn *fn(ScrClosure *clo, ScrDyn *const *args, size_t argc) { \
    (void)clo; return scr_bvp_wr(nm, kind, le, args, argc); }
#define BVP_RDV(fn, nm, sign, le) \
  static ScrDyn *fn(ScrClosure *clo, ScrDyn *const *args, size_t argc) { \
    (void)clo; return scr_bvp_rdv(nm, sign, le, args, argc); }
#define BVP_WRV(fn, nm, sign, le) \
  static ScrDyn *fn(ScrClosure *clo, ScrDyn *const *args, size_t argc) { \
    (void)clo; (void)args; (void)argc; return scr_bvp_wrv(nm, sign, le, args, argc); }
#define BVP_NYI(fn, nm) \
  static ScrDyn *fn(ScrClosure *clo, ScrDyn *const *args, size_t argc) { \
    (void)clo; (void)args; (void)argc; return scr_bvp_refuse(nm, "body not mapped"); }

/* parent / offset: Node answers undefined for a receiver that is not a Buffer (the prototype
 * itself). A byte-array receiver would read its buffer/byteOffset, which this tier does not map. */
static ScrDyn *scr_bvp_getter(const char *name) {
  ScrDyn *self = scr_dyn_this_get();
  bool bytes = self != NULL && self->kind == SCR_DYN_BYTES;
  if (self != NULL) scr_dyn_release(self);
  if (bytes) {
    scr_bvp_refuse(name, "getter on a byte array");
    return NULL;
  }
  return scr_dyn_undefined();
}
static ScrDyn *scr_bvp_get_parent(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo; (void)args; (void)argc;
  return scr_bvp_getter("parent");
}
static ScrDyn *scr_bvp_get_offset(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo; (void)args; (void)argc;
  return scr_bvp_getter("offset");
}

BVP_DYN(bvp_readBigUInt64LE, "readBigUInt64LE")
BVP_DYN(bvp_readBigUInt64BE, "readBigUInt64BE")
BVP_DYN(bvp_readBigInt64LE, "readBigInt64LE")
BVP_DYN(bvp_readBigInt64BE, "readBigInt64BE")
BVP_DYN(bvp_writeBigUInt64LE, "writeBigUInt64LE")
BVP_DYN(bvp_writeBigUInt64BE, "writeBigUInt64BE")
BVP_DYN(bvp_writeBigInt64LE, "writeBigInt64LE")
BVP_DYN(bvp_writeBigInt64BE, "writeBigInt64BE")
BVP_RDV(bvp_readUIntLE, "readUIntLE", 0, 1)
BVP_RD(bvp_readUInt32LE, "readUInt32LE", SCR_BN_U32, 1)
BVP_RD(bvp_readUInt16LE, "readUInt16LE", SCR_BN_U16, 1)
BVP_RD(bvp_readUInt8, "readUInt8", SCR_BN_U8, 0)
BVP_RDV(bvp_readUIntBE, "readUIntBE", 0, 0)
BVP_RD(bvp_readUInt32BE, "readUInt32BE", SCR_BN_U32, 0)
BVP_RD(bvp_readUInt16BE, "readUInt16BE", SCR_BN_U16, 0)
BVP_RDV(bvp_readIntLE, "readIntLE", 1, 1)
BVP_RD(bvp_readInt32LE, "readInt32LE", SCR_BN_I32, 1)
BVP_RD(bvp_readInt16LE, "readInt16LE", SCR_BN_I16, 1)
BVP_RD(bvp_readInt8, "readInt8", SCR_BN_I8, 0)
BVP_RDV(bvp_readIntBE, "readIntBE", 1, 0)
BVP_RD(bvp_readInt32BE, "readInt32BE", SCR_BN_I32, 0)
BVP_RD(bvp_readInt16BE, "readInt16BE", SCR_BN_I16, 0)
BVP_WRV(bvp_writeUIntLE, "writeUIntLE", 0, 1)
BVP_WR(bvp_writeUInt32LE, "writeUInt32LE", SCR_BN_U32, 1)
BVP_WR(bvp_writeUInt16LE, "writeUInt16LE", SCR_BN_U16, 1)
BVP_WR(bvp_writeUInt8, "writeUInt8", SCR_BN_U8, 0)
BVP_WRV(bvp_writeUIntBE, "writeUIntBE", 0, 0)
BVP_WR(bvp_writeUInt32BE, "writeUInt32BE", SCR_BN_U32, 0)
BVP_WR(bvp_writeUInt16BE, "writeUInt16BE", SCR_BN_U16, 0)
BVP_WRV(bvp_writeIntLE, "writeIntLE", 1, 1)
BVP_WR(bvp_writeInt32LE, "writeInt32LE", SCR_BN_I32, 1)
BVP_WR(bvp_writeInt16LE, "writeInt16LE", SCR_BN_I16, 1)
BVP_WR(bvp_writeInt8, "writeInt8", SCR_BN_I8, 0)
BVP_WRV(bvp_writeIntBE, "writeIntBE", 1, 0)
BVP_WR(bvp_writeInt32BE, "writeInt32BE", SCR_BN_I32, 0)
BVP_WR(bvp_writeInt16BE, "writeInt16BE", SCR_BN_I16, 0)
BVP_RD(bvp_readFloatLE, "readFloatLE", SCR_BN_F32, 1)
BVP_RD(bvp_readFloatBE, "readFloatBE", SCR_BN_F32, 0)
BVP_RD(bvp_readDoubleLE, "readDoubleLE", SCR_BN_F64, 1)
BVP_RD(bvp_readDoubleBE, "readDoubleBE", SCR_BN_F64, 0)
BVP_WR(bvp_writeFloatLE, "writeFloatLE", SCR_BN_F32, 1)
BVP_WR(bvp_writeFloatBE, "writeFloatBE", SCR_BN_F32, 0)
BVP_WR(bvp_writeDoubleLE, "writeDoubleLE", SCR_BN_F64, 1)
BVP_WR(bvp_writeDoubleBE, "writeDoubleBE", SCR_BN_F64, 0)
BVP_DYN(bvp_asciiSlice, "asciiSlice")
BVP_DYN(bvp_base64Slice, "base64Slice")
BVP_DYN(bvp_base64urlSlice, "base64urlSlice")
BVP_DYN(bvp_latin1Slice, "latin1Slice")
BVP_DYN(bvp_hexSlice, "hexSlice")
BVP_DYN(bvp_ucs2Slice, "ucs2Slice")
BVP_DYN(bvp_utf8Slice, "utf8Slice")
BVP_DYN(bvp_asciiWrite, "asciiWrite")
BVP_DYN(bvp_base64Write, "base64Write")
BVP_DYN(bvp_base64urlWrite, "base64urlWrite")
BVP_DYN(bvp_latin1Write, "latin1Write")
BVP_DYN(bvp_hexWrite, "hexWrite")
BVP_DYN(bvp_ucs2Write, "ucs2Write")
BVP_DYN(bvp_utf8Write, "utf8Write")
BVP_DYN(bvp_copy, "copy")
BVP_DYN(bvp_toString, "toString")
BVP_DYN(bvp_equals, "equals")
BVP_DYN(bvp_inspect, "inspect")
BVP_DYN(bvp_compare, "compare")
BVP_DYN(bvp_indexOf, "indexOf")
BVP_DYN(bvp_lastIndexOf, "lastIndexOf")
BVP_DYN(bvp_includes, "includes")
BVP_DYN(bvp_fill, "fill")
BVP_DYN(bvp_write, "write")
BVP_DYN(bvp_toJSON, "toJSON")
BVP_DYN(bvp_subarray, "subarray")
BVP_DYN(bvp_slice, "slice")
BVP_DYN(bvp_swap16, "swap16")
BVP_DYN(bvp_swap32, "swap32")
BVP_DYN(bvp_swap64, "swap64")

/* key, canon (row of the shared function box, -1 for own), getter, thunk, Node length, Node name */
static const BvpRow bvp_rows[BVP_N] = {
  { "readBigUInt64LE", -1, 0, bvp_readBigUInt64LE, 0, "readBigUInt64LE" },
  { "readBigUInt64BE", -1, 0, bvp_readBigUInt64BE, 0, "readBigUInt64BE" },
  { "readBigUint64LE", 0, 0, NULL, 0, "readBigUInt64LE" },
  { "readBigUint64BE", 1, 0, NULL, 0, "readBigUInt64BE" },
  { "readBigInt64LE", -1, 0, bvp_readBigInt64LE, 0, "readBigInt64LE" },
  { "readBigInt64BE", -1, 0, bvp_readBigInt64BE, 0, "readBigInt64BE" },
  { "writeBigUInt64LE", -1, 0, bvp_writeBigUInt64LE, 1, "writeBigUInt64LE" },
  { "writeBigUInt64BE", -1, 0, bvp_writeBigUInt64BE, 1, "writeBigUInt64BE" },
  { "writeBigUint64LE", 6, 0, NULL, 1, "writeBigUInt64LE" },
  { "writeBigUint64BE", 7, 0, NULL, 1, "writeBigUInt64BE" },
  { "writeBigInt64LE", -1, 0, bvp_writeBigInt64LE, 1, "writeBigInt64LE" },
  { "writeBigInt64BE", -1, 0, bvp_writeBigInt64BE, 1, "writeBigInt64BE" },
  { "readUIntLE", -1, 0, bvp_readUIntLE, 2, "readUIntLE" },
  { "readUInt32LE", -1, 0, bvp_readUInt32LE, 1, "" },
  { "readUInt16LE", -1, 0, bvp_readUInt16LE, 1, "" },
  { "readUInt8", -1, 0, bvp_readUInt8, 1, "" },
  { "readUIntBE", -1, 0, bvp_readUIntBE, 2, "readUIntBE" },
  { "readUInt32BE", -1, 0, bvp_readUInt32BE, 1, "" },
  { "readUInt16BE", -1, 0, bvp_readUInt16BE, 1, "" },
  { "readUintLE", 12, 0, NULL, 2, "readUIntLE" },
  { "readUint32LE", 13, 0, NULL, 1, "" },
  { "readUint16LE", 14, 0, NULL, 1, "" },
  { "readUint8", 15, 0, NULL, 1, "" },
  { "readUintBE", 16, 0, NULL, 2, "readUIntBE" },
  { "readUint32BE", 17, 0, NULL, 1, "" },
  { "readUint16BE", 18, 0, NULL, 1, "" },
  { "readIntLE", -1, 0, bvp_readIntLE, 2, "readIntLE" },
  { "readInt32LE", -1, 0, bvp_readInt32LE, 1, "" },
  { "readInt16LE", -1, 0, bvp_readInt16LE, 1, "" },
  { "readInt8", -1, 0, bvp_readInt8, 1, "" },
  { "readIntBE", -1, 0, bvp_readIntBE, 2, "readIntBE" },
  { "readInt32BE", -1, 0, bvp_readInt32BE, 1, "" },
  { "readInt16BE", -1, 0, bvp_readInt16BE, 1, "" },
  { "writeUIntLE", -1, 0, bvp_writeUIntLE, 3, "writeUIntLE" },
  { "writeUInt32LE", -1, 0, bvp_writeUInt32LE, 1, "writeUInt32LE" },
  { "writeUInt16LE", -1, 0, bvp_writeUInt16LE, 1, "writeUInt16LE" },
  { "writeUInt8", -1, 0, bvp_writeUInt8, 1, "writeUInt8" },
  { "writeUIntBE", -1, 0, bvp_writeUIntBE, 3, "writeUIntBE" },
  { "writeUInt32BE", -1, 0, bvp_writeUInt32BE, 1, "writeUInt32BE" },
  { "writeUInt16BE", -1, 0, bvp_writeUInt16BE, 1, "writeUInt16BE" },
  { "writeUintLE", 33, 0, NULL, 3, "writeUIntLE" },
  { "writeUint32LE", 34, 0, NULL, 1, "writeUInt32LE" },
  { "writeUint16LE", 35, 0, NULL, 1, "writeUInt16LE" },
  { "writeUint8", 36, 0, NULL, 1, "writeUInt8" },
  { "writeUintBE", 37, 0, NULL, 3, "writeUIntBE" },
  { "writeUint32BE", 38, 0, NULL, 1, "writeUInt32BE" },
  { "writeUint16BE", 39, 0, NULL, 1, "writeUInt16BE" },
  { "writeIntLE", -1, 0, bvp_writeIntLE, 3, "writeIntLE" },
  { "writeInt32LE", -1, 0, bvp_writeInt32LE, 1, "writeInt32LE" },
  { "writeInt16LE", -1, 0, bvp_writeInt16LE, 1, "writeInt16LE" },
  { "writeInt8", -1, 0, bvp_writeInt8, 1, "writeInt8" },
  { "writeIntBE", -1, 0, bvp_writeIntBE, 3, "writeIntBE" },
  { "writeInt32BE", -1, 0, bvp_writeInt32BE, 1, "writeInt32BE" },
  { "writeInt16BE", -1, 0, bvp_writeInt16BE, 1, "writeInt16BE" },
  { "readFloatLE", -1, 0, bvp_readFloatLE, 0, "readFloatForwards" },
  { "readFloatBE", -1, 0, bvp_readFloatBE, 0, "readFloatBackwards" },
  { "readDoubleLE", -1, 0, bvp_readDoubleLE, 0, "readDoubleForwards" },
  { "readDoubleBE", -1, 0, bvp_readDoubleBE, 0, "readDoubleBackwards" },
  { "writeFloatLE", -1, 0, bvp_writeFloatLE, 1, "writeFloatForwards" },
  { "writeFloatBE", -1, 0, bvp_writeFloatBE, 1, "writeFloatBackwards" },
  { "writeDoubleLE", -1, 0, bvp_writeDoubleLE, 1, "writeDoubleForwards" },
  { "writeDoubleBE", -1, 0, bvp_writeDoubleBE, 1, "writeDoubleBackwards" },
  { "asciiSlice", -1, 0, bvp_asciiSlice, 2, "" },
  { "base64Slice", -1, 0, bvp_base64Slice, 2, "" },
  { "base64urlSlice", -1, 0, bvp_base64urlSlice, 2, "" },
  { "latin1Slice", -1, 0, bvp_latin1Slice, 2, "" },
  { "hexSlice", -1, 0, bvp_hexSlice, 2, "" },
  { "ucs2Slice", -1, 0, bvp_ucs2Slice, 2, "" },
  { "utf8Slice", -1, 0, bvp_utf8Slice, 2, "" },
  { "asciiWrite", -1, 0, bvp_asciiWrite, 3, "" },
  { "base64Write", -1, 0, bvp_base64Write, 3, "" },
  { "base64urlWrite", -1, 0, bvp_base64urlWrite, 3, "" },
  { "latin1Write", -1, 0, bvp_latin1Write, 3, "" },
  { "hexWrite", -1, 0, bvp_hexWrite, 3, "" },
  { "ucs2Write", -1, 0, bvp_ucs2Write, 3, "" },
  { "utf8Write", -1, 0, bvp_utf8Write, 3, "" },
  { "parent", -1, 1, NULL, 0, "get parent" },
  { "offset", -1, 1, NULL, 0, "get offset" },
  { "copy", -1, 0, bvp_copy, 4, "copy" },
  { "toString", -1, 0, bvp_toString, 3, "toString" },
  { "equals", -1, 0, bvp_equals, 1, "equals" },
  { "inspect", -1, 0, bvp_inspect, 2, "inspect" },
  { "compare", -1, 0, bvp_compare, 5, "compare" },
  { "indexOf", -1, 0, bvp_indexOf, 3, "indexOf" },
  { "lastIndexOf", -1, 0, bvp_lastIndexOf, 3, "lastIndexOf" },
  { "includes", -1, 0, bvp_includes, 3, "includes" },
  { "fill", -1, 0, bvp_fill, 4, "fill" },
  { "write", -1, 0, bvp_write, 4, "write" },
  { "toJSON", -1, 0, bvp_toJSON, 0, "toJSON" },
  { "subarray", -1, 0, bvp_subarray, 2, "subarray" },
  { "slice", -1, 0, bvp_slice, 2, "slice" },
  { "swap16", -1, 0, bvp_swap16, 0, "swap16" },
  { "swap32", -1, 0, bvp_swap32, 0, "swap32" },
  { "swap64", -1, 0, bvp_swap64, 0, "swap64" },
  { "toLocaleString", 79, 0, NULL, 3, "toString" },
};
/* MEASURED 95 rows: 74 function boxes, 19 aliases, 2 getters. */

/* The process value of %Buffer.prototype%: built on first read, kept by the cache (scr_bv_values[15]).
 * +1. Its rows are the generated table below (lab/gen-proto.js). */
static ScrDyn *scr_bvp_build(void) {
  ScrDyn *p = scr_dyn_new_obj(); /* +1 */
  ScrDyn *u8p = scr_dyn_uint8array_prototype(); /* +1 */
  scr_dyn_obj_set_proto(p, u8p);
  scr_dyn_release(u8p);
  ScrDyn *boxes[BVP_N];
  for (int i = 0; i < BVP_N; i++) {
    const BvpRow *r = &bvp_rows[i];
    size_t klen = strlen(r->key);
    boxes[i] = NULL;
    if (r->getter) {
      ScrDynThunk gt = strcmp(r->key, "parent") == 0 ? scr_bvp_get_parent : scr_bvp_get_offset;
      ScrDyn *g = scr_dyn_new_func(scr_closure_new((void *)gt, 0), gt, 0, "()", r->name); /* +1 */
      scr_dyn_obj_define_accessor(p, r->key, klen, g, scr_dyn_undefined(), true, true);
      scr_dyn_release(g);
      continue;
    }
    if (r->canon >= 0) {
      boxes[i] = boxes[r->canon]; /* borrowed: the canonical row's box */
    } else {
      boxes[i] = scr_dyn_new_func(scr_closure_new((void *)r->fn, 0), r->fn, r->arity, "()", r->name); /* +1, released below */
    }
    scr_dyn_obj_set(p, r->key, klen, scr_dyn_retain(boxes[i])); /* the object takes this +1 */
  }
  for (int i = 0; i < BVP_N; i++) {
    if (bvp_rows[i].canon < 0 && !bvp_rows[i].getter) scr_dyn_release(boxes[i]);
  }
  ScrDyn *ctor = scr_dyn_buffer_ctor(); /* +1 */
  scr_dyn_obj_define_hidden_data(p, "constructor", 11, ctor, true, true); /* borrowed */
  ScrDyn *ctab = scr_dyn_fn_props(ctor); /* +1: %Buffer%.prototype, non-enumerable */
  scr_dyn_obj_define_hidden_data(ctab, "prototype", 9, p, false, false); /* borrowed */
  scr_dyn_release(ctab);
  scr_dyn_release(ctor);
  scr_dyn_buffer_proto_ptr = p; /* borrowed by instanceof; the cache owns p */
  return p;
}

/* Each member is ONE process value, built on first read and kept (the cache holds
 * the box), so every read of `buffer.<member>` is the same object as Node's:
 * `b.transcode === b.transcode`, `b.constants === b.constants`. */
static ScrDyn *scr_bv_values[16];
static void scr_bv_values_teardown(void) {
  scr_dyn_buffer_proto_ptr = NULL;
  for (size_t i = 0; i < 16; i++) {
    scr_dyn_release(scr_bv_values[i]);
    scr_bv_values[i] = NULL;
  }
}

ScrDyn *scr_dyn_buffer_value(double which) {
  int i = (int)which;
  if (i < 0 || i > 15 || (double)i != which) {
    static const char msg[] = "internal: unknown buffer module member";
    scr_throw_error_msg(SCR_ERR_ERROR, msg, sizeof msg - 1);
    return NULL;
  }
  if (scr_bv_values[i] == NULL) {
    if (i == 0) {
      scr_bv_values[0] = scr_dyn_buffer_ctor(); /* +1 kept by the cache */
      /* %Buffer%.prototype must exist with the constructor, or a read of it would mint a fresh object. */
      ScrDyn *pp = scr_dyn_buffer_value(15);
      scr_dyn_release(pp);
    } else if (i == 14) {
      scr_bv_values[14] = scr_dyn_buffer_module();
    } else if (i == 15) {
      scr_bv_values[15] = scr_bvp_build();
    } else {
      scr_bv_values[i] = scr_bv_build_value(i);
      if (scr_bv_values[i] == NULL) return NULL;
    }
    static bool registered = false;
    if (!registered) {
      registered = true;
      scr_atexit(scr_bv_values_teardown);
    }
  }
  return scr_dyn_retain(scr_bv_values[i]);
}
