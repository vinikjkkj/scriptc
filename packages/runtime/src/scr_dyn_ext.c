/* The checked-dynamic extensions, a GATED unit: forms nothing in a plain
 * program names, so a hello-world binary does not carry them. The compiler
 * links this file when the IR holds one of its libCalls (moduleUsesDynExt in
 * ir/nodes.ts):
 *
 *   - the fs callback forms (readFile/mkdtemp/read/lchmod over callbacks) and
 *     mkdtempSync's option forms;
 *   - Buffer.concat and Buffer.isBuffer over dyn values;
 *   - IsLooselyEqual over two dyn values;
 *   - the errno/syscall/path/dest reads of an error. */

#include "scr_runtime.h"

#include <errno.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#ifdef _WIN32
#include <io.h>
#else
#include <unistd.h>
#endif
#ifdef __APPLE__
#include <sys/stat.h> /* lchmod(2) — the fs.lchmodSync ladder's real tail */
#endif

/* Small argument helpers duplicated from scr_bytes_io.c (static there, so the
 * always-linked unit keeps them inlined into its own callers). */
static const char *scr_fs_enc_canon(const ScrStr *e) {
  char lo[16];
  if (e->len == 0 || e->len >= sizeof lo) return NULL;
  for (size_t i = 0; i < e->len; i++) {
    char c = e->data[i];
    lo[i] = (c >= 'A' && c <= 'Z') ? (char)(c + 32) : c;
  }
  lo[e->len] = 0;
  if (!strcmp(lo, "utf8") || !strcmp(lo, "utf-8")) return "utf8";
  if (!strcmp(lo, "ucs2") || !strcmp(lo, "ucs-2") || !strcmp(lo, "utf16le") || !strcmp(lo, "utf-16le")) return "utf16le";
  if (!strcmp(lo, "latin1") || !strcmp(lo, "binary")) return "latin1";
  if (!strcmp(lo, "ascii")) return "ascii";
  if (!strcmp(lo, "hex")) return "hex";
  if (!strcmp(lo, "base64")) return "base64";
  if (!strcmp(lo, "base64url")) return "base64url";
  return NULL;
}

static bool scr_fs_mode_chk(const ScrDyn *m, const char *name) {
  if (m->kind == SCR_DYN_STR) {
    const ScrStr *s = m->v.str;
    bool octal = s->len > 0;
    for (size_t i = 0; octal && i < s->len; i++) {
      if (s->data[i] < '0' || s->data[i] > '7') octal = false;
    }
    if (octal) return true;
    scr_dyn_arg_value_fail(name, "must be a 32-bit unsigned integer or an octal string", m);
    return false;
  }
  if (m->kind != SCR_DYN_NUM) {
    scr_dyn_arg_type_fail(name, "of type number", m);
    return false;
  }
  double v = m->v.num;
  if (!(isfinite(v) && trunc(v) == v)) {
    char recv[48], msg[160];
    scr_num_received(v, recv);
    int len = snprintf(msg, sizeof msg,
                       "The value of \"%s\" is out of range. It must be an integer. Received %s",
                       name, recv);
    scr_throw_error_msg_code(SCR_ERR_RANGE, msg, (size_t)len, "ERR_OUT_OF_RANGE");
    return false;
  }
  if (v < 0 || v > 4294967295.0) {
    char recv[48], msg[160];
    scr_num_received(v, recv);
    int len = snprintf(msg, sizeof msg,
                       "The value of \"%s\" is out of range. It must be >= 0 && <= 4294967295. Received %s",
                       name, recv);
    scr_throw_error_msg_code(SCR_ERR_RANGE, msg, (size_t)len, "ERR_OUT_OF_RANGE");
    return false;
  }
  return true;
}

static bool scr_fs_str_is(const ScrStr *s, const char *lit) {
  size_t n = strlen(lit);
  return s->len == n && memcmp(s->data, lit, n) == 0;
}

/* ── the callback fs forms and mkdtempSync's option forms ──────────────
 * Each follows lib/fs.js's argument order exactly (read from the source of
 * Node v24.15.0): the callback check, getOptions' type and encoding checks,
 * then the path or buffer contract; every failure past that point rides the
 * callback, one loop turn later. The operation itself runs at fire time
 * through the same sync functions the *Sync forms use. */

static bool scr_fs_lchmod_defined(const char *api);

static const char *scr_fs_opt_encoding(const ScrDyn *opts, bool *is_buffer) {
  *is_buffer = false;
  const ScrDyn *enc = opts;
  if (opts->kind == SCR_DYN_OBJ) enc = scr_dyn_obj_get(opts, "encoding", 8);
  if (enc == NULL || enc->kind != SCR_DYN_STR || enc->v.str->len == 0) return "";
  if (scr_fs_str_is(enc->v.str, "buffer")) {
    *is_buffer = true;
    return "";
  }
  const char *c = scr_fs_enc_canon(enc->v.str);
  return c != NULL ? c : "";
}

/* getOptions' type gate: nullish and functions are the defaults; strings
 * and objects pass to assertEncoding; anything else is a type error. */
static bool scr_fs_get_options(const ScrDyn *opts) {
  if (scr_fs_dyn_absent(opts) || opts->kind == SCR_DYN_FUNC) return true;
  if (opts->kind != SCR_DYN_STR && opts->kind != SCR_DYN_OBJ) {
    scr_dyn_arg_type_fail("options", "one of type string or object", opts);
    return false;
  }
  return scr_fs_encoding_chk(opts);
}

static ScrStr *scr_fs_path_str(const ScrDyn *p) {
  if (p->kind == SCR_DYN_STR) return scr_str_retain(p->v.str);
  return scr_str_new((const char *)p->v.bytes->data, p->v.bytes->len);
}

#ifndef SCR_LIB
/* The pending exception as a dyn value. Every fs failure is a ScrError, whose
 * dyn encoding lives in the always-linked scr_json.c (scr_caught_to_dyn is in
 * the gated async unit, which a plain fs program does not link). */
static ScrDyn *scr_fs_take_error_dyn(void) {
  ScrCaught *c = scr_exc_take();
  ScrDyn *e = (c->kind == SCR_EXC_OBJ && c->payload != NULL && scr_error_is(c->payload))
                  ? scr_dyn_from_error((const ScrError *)c->payload)
                  : scr_dyn_retain(scr_dyn_undefined());
  scr_caught_release(c);
  return e;
}

/* cb(err) / cb(null, ...results): the loop turn's call into user code; a
 * throw in the callback stays pending (an uncaught exception, like Node's). */
static void scr_fs_cb_finish(ScrDyn *cb, ScrDyn *const *vals, size_t nvals, const char *what) {
  ScrDyn *r;
  if (scr_exc_pending()) {
    ScrDyn *err = scr_fs_take_error_dyn();
    r = scr_dyn_call(cb, &err, 1, what);
    scr_dyn_release(err);
  } else {
    ScrDyn *args[4];
    args[0] = scr_dyn_new_null();
    for (size_t i = 0; i < nvals && i < 3; i++) args[i + 1] = vals[i];
    r = scr_dyn_call(cb, args, nvals + 1, what);
    scr_dyn_release(args[0]);
  }
  if (r != NULL) scr_dyn_release(r);
}

static ScrClosure *scr_fs_cb_closure(void (*fire)(ScrClosure *), size_t n, const ScrDyn *const *vals) {
  ScrClosure *clo = scr_closure_new((void *)fire, n);
  for (size_t i = 0; i < n; i++) {
    clo->caps[i] = scr_box_new_obj(scr_dyn_retain_v, scr_dyn_release_v, NULL);
    scr_box_set_ref(clo->caps[i], scr_dyn_retain((ScrDyn *)vals[i]));
  }
  return clo;
}
#endif

#ifndef SCR_LIB
/* The bytes of everything readable from `fd` from its current position. */
static ScrBytes *scr_fs_read_fd_all(int fd) {
  size_t cap = 4096, len = 0;
  uint8_t *buf = malloc(cap);
  if (!buf) scr_bytes_io_oom();
  for (;;) {
    if (cap - len < 2048) {
      cap *= 2;
      uint8_t *grown = realloc(buf, cap);
      if (!grown) scr_bytes_io_oom();
      buf = grown;
    }
    ssize_t n = read(fd, buf + len, cap - len);
    if (n < 0) {
      int e = errno;
      free(buf);
      ScrStr *none = scr_str_new("", 0);
      scr_fs_throw(e, "read", none);
      scr_str_release(none);
      return NULL;
    }
    if (n == 0) break;
    len += (size_t)n;
  }
  ScrBytes *b = scr_bytes_new(SCR_BYTES_U8, (double)len);
  memcpy(b->data, buf, len);
  free(buf);
  return scr_bytes_stamp_buffer(b);
}
#endif

/* The encoded form of a finished read: Buffer for none, the decoded
 * string for a named encoding. +1 dyn. */
static ScrDyn *scr_fs_bytes_result(ScrBytes *b, const char *canon) {
  if (canon[0] == 0) {
    ScrDyn *d = scr_dyn_new_buffer_copy(b);
    return d;
  }
  ScrStr *name = scr_str_new(canon, strlen(canon));
  ScrStr *text = scr_bytes_to_str(b, name);
  scr_str_release(name);
  ScrDyn *d = scr_dyn_new_str(text);
  scr_str_release(text);
  return d;
}

#ifndef SCR_LIB
static void scr_fs_read_file_fire(ScrClosure *self) {
  ScrDyn *path = scr_box_get_ref(self->caps[0]);
  ScrDyn *opts = scr_box_get_ref(self->caps[1]);
  ScrDyn *cb = scr_box_get_ref(self->caps[2]);
  ScrDyn *out = NULL;
  if (path->kind == SCR_DYN_NUM) {
    ScrBytes *b = scr_fs_read_fd_all((int)path->v.num);
    if (b != NULL) {
      bool isbuf;
      const char *canon = scr_fs_opt_encoding(opts, &isbuf);
      out = scr_fs_bytes_result(b, canon);
      scr_bytes_release(b);
    }
  } else {
    ScrStr *p = scr_fs_path_str(path);
    out = scr_fs_read_file_sync_dyn(p, opts->kind == SCR_DYN_FUNC ? scr_dyn_undefined() : opts);
    scr_str_release(p);
  }
  scr_fs_cb_finish(cb, &out, out != NULL ? 1 : 0, "the fs.readFile callback");
  if (out != NULL) scr_dyn_release(out);
  scr_dyn_release(path);
  scr_dyn_release(opts);
  scr_dyn_release(cb);
}
#endif

/* fs.readFile(path, options?, cb) — `callback ||= options`, then Node's
 * order: cb, getOptions (type, assertEncoding), the path (an fd is a
 * non-negative integer; anything else must be a string or Buffer). */
ScrDyn *scr_fs_read_file_cb(const ScrDyn *path, const ScrDyn *opts, const ScrDyn *cb) {
  const ScrDyn *callback = scr_dyn_truthy(cb) ? cb : opts;
  if (!scr_fs_cb_chk(callback, "cb")) return NULL;
  if (!scr_fs_get_options(opts)) return NULL;
  bool is_fd = path->kind == SCR_DYN_NUM && path->v.num >= 0 && path->v.num <= 4294967295.0 &&
               trunc(path->v.num) == path->v.num;
  if (!is_fd && !scr_fs_path_chk(path, "path")) return NULL;
#ifdef SCR_LIB
  scr_trap("scriptc: internal error: fs.readFile callback reached in a library build — please report this");
  return NULL;
#else
  const ScrDyn *vals[3] = {path, opts, callback};
  scr_set_timeout(scr_fs_cb_closure(scr_fs_read_file_fire, 3, vals), 0);
  return scr_dyn_retain(scr_dyn_undefined());
#endif
}

/* The path mkdtemp answers, in the requested encoding: the utf8 string, a
 * Buffer for 'buffer', or the path's bytes decoded as the named encoding. */
static ScrDyn *scr_fs_mkdtemp_result(ScrStr *made, const ScrDyn *opts) {
  bool isbuf;
  const char *canon = scr_fs_opt_encoding(opts, &isbuf);
  if (!isbuf && (canon[0] == 0 || strcmp(canon, "utf8") == 0)) return scr_dyn_new_str(made);
  ScrStr *u8 = scr_str_new("utf8", 4);
  ScrBytes *b = scr_bytes_from_str(made, u8);
  scr_str_release(u8);
  ScrDyn *d = scr_fs_bytes_result(b, isbuf ? "" : canon);
  scr_bytes_release(b);
  return d;
}

#ifndef SCR_LIB
static void scr_fs_mkdtemp_fire(ScrClosure *self) {
  ScrDyn *prefix = scr_box_get_ref(self->caps[0]);
  ScrDyn *opts = scr_box_get_ref(self->caps[1]);
  ScrDyn *cb = scr_box_get_ref(self->caps[2]);
  ScrStr *p = scr_fs_path_str(prefix);
  ScrStr *made = scr_fs_mkdtemp(p);
  scr_str_release(p);
  ScrDyn *out = NULL;
  if (made != NULL) {
    out = scr_fs_mkdtemp_result(made, opts);
    scr_str_release(made);
  }
  scr_fs_cb_finish(cb, &out, out != NULL ? 1 : 0, "the fs.mkdtemp callback");
  if (out != NULL) scr_dyn_release(out);
  scr_dyn_release(prefix);
  scr_dyn_release(opts);
  scr_dyn_release(cb);
}
#endif

/* fs.mkdtemp(prefix, options?, cb): the callback is `options` when that is
 * a function; then getOptions, then getValidatedPath(prefix, 'prefix'). */
ScrDyn *scr_fs_mkdtemp_cb(const ScrDyn *prefix, const ScrDyn *opts, const ScrDyn *cb) {
  const ScrDyn *callback = opts->kind == SCR_DYN_FUNC ? opts : cb;
  if (!scr_fs_cb_chk(callback, "cb")) return NULL;
  if (!scr_fs_get_options(opts)) return NULL;
  if (!scr_fs_path_chk(prefix, "prefix")) return NULL;
#ifdef SCR_LIB
  scr_trap("scriptc: internal error: fs.mkdtemp callback reached in a library build — please report this");
  return NULL;
#else
  const ScrDyn *vals[3] = {prefix, opts, callback};
  scr_set_timeout(scr_fs_cb_closure(scr_fs_mkdtemp_fire, 3, vals), 0);
  return scr_dyn_retain(scr_dyn_undefined());
#endif
}

/* fs.mkdtempSync(prefix, options?): the prefix, then getOptions, then the
 * real mkdtemp(3) with the result in the requested encoding. +1 dyn or
 * NULL with the exception pending. */
ScrDyn *scr_fs_mkdtemp_sync_opts(const ScrDyn *prefix, const ScrDyn *opts) {
  if (!scr_fs_path_chk(prefix, "prefix")) return NULL;
  if (!scr_fs_get_options(opts)) return NULL;
  ScrStr *p = scr_fs_path_str(prefix);
  ScrStr *made = scr_fs_mkdtemp(p);
  scr_str_release(p);
  if (made == NULL) return NULL;
  ScrDyn *out = scr_fs_mkdtemp_result(made, opts);
  scr_str_release(made);
  return out;
}

/* fs.read — lib/fs.js's ladder over (fd, buffer, offsetOrOptions, length,
 * position, callback), argc being the count the caller wrote. */
static bool scr_fs_read_validate_integer(const ScrDyn *v, const char *name, double min, const char *range) {
  return scr_fs_int_range_chk(v, name, min, 9007199254740991.0, range);
}

#ifndef SCR_LIB
static void scr_fs_read_fire(ScrClosure *self) {
  ScrDyn *fd = scr_box_get_ref(self->caps[0]);
  ScrDyn *buf = scr_box_get_ref(self->caps[1]);
  ScrDyn *cb = scr_box_get_ref(self->caps[2]);
  ScrDyn *nums = scr_box_get_ref(self->caps[3]); /* [offset, length, position] */
  double off = nums->v.arr.items[0]->v.num;
  double len = nums->v.arr.items[1]->v.num;
  double pos = nums->v.arr.items[2]->v.num;
  double n = scr_fs_read_at(fd->v.num, buf->v.bytes, off, len, pos);
  ScrDyn *vals[2] = {NULL, buf};
  if (!scr_exc_pending()) {
    vals[0] = scr_dyn_new_num(n);
    scr_fs_cb_finish(cb, vals, 2, "the fs.read callback");
    scr_dyn_release(vals[0]);
  } else {
    scr_fs_cb_finish(cb, vals, 0, "the fs.read callback");
  }
  scr_dyn_release(fd);
  scr_dyn_release(buf);
  scr_dyn_release(cb);
  scr_dyn_release(nums);
}

static void scr_fs_read_zero_tick(ScrClosure *self) {
  ScrDyn *buf = scr_box_get_ref(self->caps[0]);
  ScrDyn *cb = scr_box_get_ref(self->caps[1]);
  ScrDyn *vals[2] = {scr_dyn_new_num(0), buf};
  scr_fs_cb_finish(cb, vals, 2, "the fs.read callback");
  scr_dyn_release(vals[0]);
  scr_dyn_release(buf);
  scr_dyn_release(cb);
}
#endif

static double scr_fs_toint32(double v) {
  if (!isfinite(v)) return 0;
  double m = fmod(trunc(v), 4294967296.0);
  if (m < 0) m += 4294967296.0;
  return (double)(int32_t)(uint32_t)m;
}

static ScrDyn *scr_fs_default_read_buffer(void) {
  ScrBytes *z = scr_bytes_new(SCR_BYTES_U8, 16384.0);
  memset(z->data, 0, 16384);
  ScrDyn *d = scr_dyn_new_buffer_copy(scr_bytes_stamp_buffer(z));
  scr_bytes_release(z);
  return d;
}

ScrDyn *scr_fs_read_cb(const ScrDyn *fd, const ScrDyn *buffer, const ScrDyn *a2, const ScrDyn *a3,
                       const ScrDyn *a4, const ScrDyn *a5, double argc) {
  /* getValidatedFd */
  if (fd->kind != SCR_DYN_NUM) {
    scr_dyn_arg_type_fail("fd", "of type number", fd);
    return NULL;
  }
  const ScrDyn *undef = scr_dyn_undefined();
  const ScrDyn *buf = buffer, *callback = a5;
  const ScrDyn *offv = a2, *lenv = a3, *posv = a4;
  bool lenFromBuffer = false; /* options omit `length`: byteLength - offset */
  ScrDyn *alloc = NULL;       /* the default 16384-byte buffer, owned here */
  ScrDyn *result = NULL;
  if (argc <= 4) {
    const ScrDyn *params = NULL;
    if (argc == 4) {
      /* fs.read(fd, buffer, options, callback) */
      if (a2->kind != SCR_DYN_OBJ && a2->kind != SCR_DYN_NULL) {
        scr_dyn_arg_type_fail("options", "of type object", a2);
        return NULL;
      }
      callback = a3;
      params = a2->kind == SCR_DYN_OBJ ? a2 : NULL;
    } else if (argc == 3) {
      /* fs.read(fd, bufferOrParams, callback) */
      callback = a2;
      if (buffer->kind != SCR_DYN_BYTES) {
        if (buffer->kind != SCR_DYN_OBJ && buffer->kind != SCR_DYN_NULL && buffer->kind != SCR_DYN_UNDEF) {
          scr_dyn_arg_type_fail("options", "of type object", buffer);
          return NULL;
        }
        params = buffer->kind == SCR_DYN_OBJ ? buffer : NULL;
        const ScrDyn *pb = params ? scr_dyn_obj_get((ScrDyn *)params, "buffer", 6) : NULL;
        if (pb != NULL && pb->kind != SCR_DYN_UNDEF) {
          buf = pb;
        } else {
          alloc = scr_fs_default_read_buffer();
          buf = alloc;
        }
      }
    } else {
      /* fs.read(fd, callback) */
      callback = buffer;
      alloc = scr_fs_default_read_buffer();
      buf = alloc;
    }
    offv = undef;
    lenv = undef;
    posv = undef;
    if (params != NULL) {
      const ScrDyn *o = scr_dyn_obj_get((ScrDyn *)params, "offset", 6);
      const ScrDyn *l = scr_dyn_obj_get((ScrDyn *)params, "length", 6);
      const ScrDyn *p = scr_dyn_obj_get((ScrDyn *)params, "position", 8);
      if (o != NULL) offv = o;
      if (l != NULL) lenv = l;
      if (p != NULL) posv = p;
    }
    lenFromBuffer = lenv->kind == SCR_DYN_UNDEF;
  }
  do {
    /* validateBuffer, then validateFunction(callback, 'cb') */
    if (buf->kind != SCR_DYN_BYTES) {
      scr_dyn_arg_type_fail("buffer", "an instance of Buffer, TypedArray, or DataView", buf);
      break;
    }
    if (!scr_fs_cb_chk(callback, "cb")) break;
    double buflen = scr_bytes_byte_len(buf->v.bytes);
    double offset = 0;
    if (!scr_fs_dyn_absent(offv)) {
      if (!scr_fs_read_validate_integer(offv, "offset", 0, ">= 0 && <= 9007199254740991")) break;
      offset = offv->v.num;
    }
    double lraw;
    if (lenFromBuffer) {
      lraw = buflen - offset;
    } else if (scr_fs_dyn_absent(lenv)) {
      lraw = 0;
    } else {
      lraw = scr_dyn_to_number(lenv);
      if (scr_exc_pending()) break;
    }
    const double length = scr_fs_toint32(lraw);
    if (length == 0) {
#ifdef SCR_LIB
      scr_trap("scriptc: internal error: fs.read callback reached in a library build — please report this");
#else
      ScrClosure *clo = scr_closure_new((void *)scr_fs_read_zero_tick, 2);
      clo->caps[0] = scr_box_new_obj(scr_dyn_retain_v, scr_dyn_release_v, NULL);
      scr_box_set_ref(clo->caps[0], scr_dyn_retain((ScrDyn *)buf));
      clo->caps[1] = scr_box_new_obj(scr_dyn_retain_v, scr_dyn_release_v, NULL);
      scr_box_set_ref(clo->caps[1], scr_dyn_retain((ScrDyn *)callback));
      scr_next_tick(clo);
      result = scr_dyn_retain(scr_dyn_undefined());
#endif
      break;
    }
    if (buflen == 0) {
      scr_dyn_arg_value_fail("buffer", "is empty and cannot be written", buf);
      break;
    }
    /* validateOffsetLengthRead */
    char recv[48], msg[192];
    if (length < 0) {
      scr_num_received(length, recv);
      int n = snprintf(msg, sizeof msg, "The value of \"length\" is out of range. It must be >= 0. Received %s", recv);
      scr_throw_error_msg_code(SCR_ERR_RANGE, msg, (size_t)n, "ERR_OUT_OF_RANGE");
      break;
    }
    if (offset + length > buflen) {
      scr_num_received(length, recv);
      int n = snprintf(msg, sizeof msg, "The value of \"length\" is out of range. It must be <= %.0f. Received %s",
                       buflen - offset, recv);
      scr_throw_error_msg_code(SCR_ERR_RANGE, msg, (size_t)n, "ERR_OUT_OF_RANGE");
      break;
    }
    double position = -1;
    if (!scr_fs_dyn_absent(posv)) {
      if (posv->kind != SCR_DYN_NUM) {
        scr_dyn_arg_type_fail("position", "of type bigint or integer", posv);
        break;
      }
      if (!scr_fs_int_range_chk(posv, "position", -1, 9007199254740991.0, ">= -1 && <= 9007199254740991")) break;
      position = posv->v.num;
    }
#ifdef SCR_LIB
    (void)position;
    scr_trap("scriptc: internal error: fs.read callback reached in a library build — please report this");
#else
    ScrDyn *nums = scr_dyn_new_arr();
    scr_dyn_arr_push(nums, scr_dyn_new_num(offset));
    scr_dyn_arr_push(nums, scr_dyn_new_num(length));
    scr_dyn_arr_push(nums, scr_dyn_new_num(position));
    const ScrDyn *vals[4] = {fd, buf, callback, nums};
    scr_set_timeout(scr_fs_cb_closure(scr_fs_read_fire, 4, vals), 0);
    scr_dyn_release(nums);
    result = scr_dyn_retain(scr_dyn_undefined());
#endif
  } while (0);
  if (alloc != NULL) scr_dyn_release(alloc);
  return result;
}

/* fs.lchmod(path, mode, cb) — macOS only (the callback form is not even
 * exported elsewhere, so the other platforms answer Node's not-a-function
 * TypeError before any argument is looked at). */
#if defined(__APPLE__) && !defined(SCR_LIB)
static void scr_fs_lchmod_fire(ScrClosure *self);
#endif
ScrDyn *scr_fs_lchmod_cb(const ScrDyn *path, const ScrDyn *mode, const ScrDyn *cb) {
  if (!scr_fs_lchmod_defined("fs.lchmod")) return NULL;
  if (!scr_fs_cb_chk(cb, "cb")) return NULL;
  if (!scr_fs_path_chk(path, "path")) return NULL;
  if (!scr_fs_mode_chk(mode, "mode")) return NULL;
#if defined(__APPLE__) && !defined(SCR_LIB)
  const ScrDyn *vals[3] = {path, mode, cb};
  scr_set_timeout(scr_fs_cb_closure(scr_fs_lchmod_fire, 3, vals), 0);
#endif
  return scr_dyn_retain(scr_dyn_undefined());
}

/* fs.opendirSync(path, options?): getValidatedPath, then getOptions'
 * assertEncoding; the Dir machinery fences. */
void scr_fs_opendir_chk(const ScrDyn *path, const ScrDyn *opts, const ScrStr *fence) {
  if (!scr_fs_path_chk(path, "path")) return;
  if (!scr_fs_encoding_chk(opts)) return;
  scr_throw_lowering_fence(fence);
}

/* fs.watchFile(path, options?, listener): the path first, the listener's
 * function check second (Node's watchFile order); real watching fences. */
void scr_fs_watch_file_chk(const ScrDyn *path, const ScrDyn *listener, const ScrStr *fence) {
  if (!scr_fs_path_chk(path, "path")) return;
  if (listener->kind != SCR_DYN_FUNC) {
    scr_dyn_arg_type_fail("listener", "of type function", listener);
    return;
  }
  scr_throw_lowering_fence(fence);
}

/* fs.lchmod / lchmodSync / fs.promises.lchmod — macOS-only in Node (the
 * callback/sync pair is not even exported elsewhere, so non-APPLE builds
 * answer the not-a-function TypeError; the promise form rejects
 * ERR_METHOD_NOT_IMPLEMENTED, Node's own linux shape). On macOS the
 * validation ladder runs in Node's order and the real lchmod(2) applies
 * where an operation survives it. */
static bool scr_fs_lchmod_defined(const char *api) {
#ifdef __APPLE__
  (void)api;
  return true;
#else
  char msg[64];
  int len = snprintf(msg, sizeof msg, "%s is not a function", api);
  scr_throw_error_msg(SCR_ERR_TYPE, msg, (size_t)len);
  return false;
#endif
}

#ifdef __APPLE__
static void scr_fs_lchmod_apply(const ScrDyn *path, const ScrDyn *mode) {
  ScrStr *p = path->kind == SCR_DYN_STR ? scr_str_retain(path->v.str)
                                        : scr_str_new((const char *)path->v.bytes->data, path->v.bytes->len);
  double m = mode->kind == SCR_DYN_NUM ? mode->v.num : (double)strtol(mode->v.str->data, NULL, 8);
  if (lchmod(p->data, (mode_t)m) != 0) scr_fs_throw(errno, "lchmod", p);
  scr_str_release(p);
}
#endif

#if defined(__APPLE__) && !defined(SCR_LIB)
static void scr_fs_lchmod_fire(ScrClosure *self) {
  ScrDyn *path = scr_box_get_ref(self->caps[0]);
  ScrDyn *mode = scr_box_get_ref(self->caps[1]);
  ScrDyn *cb = scr_box_get_ref(self->caps[2]);
  scr_fs_lchmod_apply(path, mode);
  scr_fs_cb_finish(cb, NULL, 0, "the fs.lchmod callback");
  scr_dyn_release(path);
  scr_dyn_release(mode);
  scr_dyn_release(cb);
}
#endif

/* Answers the dyn undefined (+1) on success — lchmodSync's JS value, so
 * return-position uses lower; NULL with the exception pending. */
ScrDyn *scr_fs_lchmod_sync_chk(const ScrDyn *path, const ScrDyn *mode) {
  if (!scr_fs_lchmod_defined("fs.lchmodSync")) return NULL;
  if (!scr_fs_path_chk(path, "path")) return NULL;
  if (!scr_fs_mode_chk(mode, "mode")) return NULL;
#ifdef __APPLE__
  scr_fs_lchmod_apply(path, mode);
  if (scr_exc_pending()) return NULL;
#endif
  return scr_dyn_retain(scr_dyn_undefined());
}

ScrPromise *scr_fsp_lchmod_chk(const ScrDyn *path, const ScrDyn *mode) {
#ifndef __APPLE__
  (void)path;
  (void)mode;
  static const char ni[] = "The lchmod() method is not implemented";
  scr_throw_error_msg_code(SCR_ERR_ERROR, ni, sizeof ni - 1, "ERR_METHOD_NOT_IMPLEMENTED");
  return scr_promise_settled_void();
#else
  if (scr_fs_path_chk(path, "path") && scr_fs_mode_chk(mode, "mode")) {
    scr_fs_lchmod_apply(path, mode);
  }
  return scr_promise_settled_void();
#endif
}


/* Buffer.concat over a checked-dynamic list (an untyped `chunks` array of
 * Buffers): Node's validateArray / per-element ERR_INVALID_ARG_TYPE ladder,
 * then the same concatenation (and, with a total, the same truncate or
 * zero-pad) the static form runs. */
static ScrBytes *scr_buffer_concat_dyn_impl(const ScrDyn *list, const ScrDyn *total_arg) {
  if (list == NULL || list->kind != SCR_DYN_ARR) {
    scr_dyn_arg_type_fail("list", "an instance of Array", list);
    return NULL;
  }
  size_t n = (size_t)scr_dyn_arr_len(list);
  if (n == 0) return scr_bytes_stamp_buffer(scr_bytes_new(SCR_BYTES_U8, 0));
  bool has_total = total_arg != NULL && total_arg->kind != SCR_DYN_UNDEF;
  double total = 0;
  if (has_total) {
    if (total_arg->kind != SCR_DYN_NUM) {
      scr_dyn_arg_type_fail("length", "of type number", total_arg);
      return NULL;
    }
    total = total_arg->v.num;
    if (!scr_bytes_validate_off("length", total, 9007199254740991.0)) return NULL;
  }
  size_t sum = 0;
  for (size_t i = 0; i < n; i++) {
    ScrDyn *e = scr_dyn_arr_at(list, (double)i);
    if (!has_total && (e->kind == SCR_DYN_NULL || e->kind == SCR_DYN_UNDEF)) {
      char msg[96];
      int ml = snprintf(msg, sizeof msg, "Cannot read properties of %s (reading 'length')",
                        e->kind == SCR_DYN_NULL ? "null" : "undefined");
      scr_throw_error_msg(SCR_ERR_TYPE, msg, (size_t)ml);
      scr_dyn_release(e);
      return NULL;
    }
    if (e->kind == SCR_DYN_BYTES && e->v.bytes != NULL) sum += e->v.bytes->len;
    scr_dyn_release(e);
  }
  for (size_t i = 0; i < n; i++) {
    ScrDyn *e = scr_dyn_arr_at(list, (double)i);
    bool ok = e->kind == SCR_DYN_BYTES && e->v.bytes != NULL && e->v.bytes->elem == SCR_BYTES_U8 &&
              e->v.bytes->flavor != SCR_BF_DATAVIEW;
    if (!ok) {
      char name[40];
      snprintf(name, sizeof name, "list[%zu]", i);
      scr_dyn_arg_type_fail(name, "an instance of Buffer or Uint8Array", e);
      scr_dyn_release(e);
      return NULL;
    }
    scr_dyn_release(e);
  }
  size_t cap = has_total ? (size_t)total : sum;
  ScrBytes *out = scr_bytes_stamp_buffer(scr_bytes_new(SCR_BYTES_U8, (double)cap));
  size_t o = 0;
  for (size_t i = 0; i < n && o < cap; i++) {
    ScrDyn *e = scr_dyn_arr_at(list, (double)i);
    const ScrBytes *part = e->v.bytes;
    size_t take = part->len < cap - o ? part->len : cap - o;
    memcpy(out->data + o, part->data, take);
    o += take;
    scr_dyn_release(e);
  }
  return out;
}

ScrStr *scr_error_message_dyn(const ScrDyn *v) {
  if (v->kind == SCR_DYN_UNDEF) return scr_str_new("", 0);
  return scr_dyn_string_coerce_js(v);
}

/* Buffer.byteLength(value, encoding) over an untyped value (a JS file's
 * implicit-any parameters). A string counts per the encoding, which Node
 * lowercases and which falls back to utf8 when it is unknown or not a
 * string; a Buffer/typed array/ArrayBuffer answers its byteLength; anything
 * else throws the catchable ERR_INVALID_ARG_TYPE. */
static const char *scr_dyn_norm_encoding(const ScrDyn *enc) {
  if (enc == NULL || enc->kind != SCR_DYN_STR) return "utf8";
  const ScrStr *s = enc->v.str;
  if (s->len < 3 || s->len > 9) return "utf8";
  char low[10];
  for (size_t i = 0; i < s->len; i++) {
    char c = s->data[i];
    low[i] = c >= 'A' && c <= 'Z' ? (char)(c + 32) : c;
  }
  low[s->len] = 0;
  static const char *const table[][2] = {
      {"utf8", "utf8"},       {"utf-8", "utf8"},     {"hex", "hex"},          {"base64", "base64"},
      {"base64url", "base64url"}, {"latin1", "latin1"}, {"binary", "latin1"}, {"ascii", "ascii"},
      {"utf16le", "utf16le"}, {"utf-16le", "utf16le"}, {"ucs2", "utf16le"},   {"ucs-2", "utf16le"},
  };
  for (size_t i = 0; i < sizeof table / sizeof table[0]; i++) {
    if (strcmp(low, table[i][0]) == 0) return table[i][1];
  }
  return "utf8";
}

double scr_buffer_byte_length_dyn(const ScrDyn *v, const ScrDyn *enc) {
  if (v->kind == SCR_DYN_STR) {
    const char *name = scr_dyn_norm_encoding(enc);
    ScrStr *e = scr_str_new(name, strlen(name));
    double n = scr_bytes_byte_length_str(v->v.str, e);
    scr_str_release(e);
    return n;
  }
  if (v->kind == SCR_DYN_BYTES || v->kind == SCR_DYN_ARRBUF) {
    return (double)(v->v.bytes->len * scr_bytes_elem_size(v->v.bytes->elem));
  }
  scr_dyn_arg_type_fail("string", "of type string or an instance of Buffer or ArrayBuffer", v);
  return 0.0;
}

/* Buffer.isEncoding(value): false for every non-string, never a throw. */
bool scr_buffer_is_encoding_dyn(const ScrDyn *v) {
  return v->kind == SCR_DYN_STR && scr_bytes_is_encoding(v->v.str);
}

ScrBytes *scr_buffer_concat_dyn(const ScrDyn *list) { return scr_buffer_concat_dyn_impl(list, NULL); }
/* `total` is whatever the program passed: undefined means "no total" (JS
 * treats a missing and an undefined argument alike). */
ScrBytes *scr_buffer_concat_dyn_len(const ScrDyn *list, const ScrDyn *total) {
  return scr_buffer_concat_dyn_impl(list, total);
}


/* One side a NUMBER n, the other any dyn value: 7.2.14 steps 5, 6, 12, 13
 * and (an object) 11/12 again after ToPrimitive. -1 = exception pending. */
static int scr_loose_num(double n, const ScrDyn *o) {
  switch (o->kind) {
  case SCR_DYN_NULL:
  case SCR_DYN_UNDEF: return 0;
  case SCR_DYN_NUM: return n == o->v.num;
  case SCR_DYN_STR: return n == scr_string_to_number(o->v.str);
  case SCR_DYN_BOOL: return n == (o->v.b ? 1.0 : 0.0);
  case SCR_DYN_BIG: return scr_dyn_big_ops()->eq_f64(o->v.big, n);
  default: {
    ScrDyn *p = scr_dyn_to_primitive(o, SCR_TOPRIM_DEFAULT);
    if (!p) return -1;
    int r = scr_loose_num(n, p);
    scr_dyn_release(p);
    return r;
  }
  }
}

static int scr_loose_rec(const ScrDyn *x, const ScrDyn *y) {
  bool xn = x->kind == SCR_DYN_NULL || x->kind == SCR_DYN_UNDEF;
  bool yn = y->kind == SCR_DYN_NULL || y->kind == SCR_DYN_UNDEF;
  if (xn || yn) return xn && yn;
  if (x->kind == y->kind) {
    bool eq = scr_dyn_strict_eq(x, y);
    return scr_exc_pending() ? -1 : eq;
  }
  if (x->kind == SCR_DYN_NUM) return scr_loose_num(x->v.num, y);
  if (y->kind == SCR_DYN_NUM) return scr_loose_num(y->v.num, x);
  if (x->kind == SCR_DYN_BOOL) return scr_loose_num(x->v.b ? 1.0 : 0.0, y);
  if (y->kind == SCR_DYN_BOOL) return scr_loose_num(y->v.b ? 1.0 : 0.0, x);
  if (x->kind == SCR_DYN_STR && y->kind == SCR_DYN_BIG) return scr_dyn_big_ops()->eq_str(y->v.big, x->v.str);
  if (x->kind == SCR_DYN_BIG && y->kind == SCR_DYN_STR) return scr_dyn_big_ops()->eq_str(x->v.big, y->v.str);
  bool xp = x->kind == SCR_DYN_STR || x->kind == SCR_DYN_BIG;
  bool yp = y->kind == SCR_DYN_STR || y->kind == SCR_DYN_BIG;
  if (xp == yp) return 0; /* two different-kind objects */
  const ScrDyn *obj = xp ? y : x;
  const ScrDyn *prim = xp ? x : y;
  ScrDyn *p = scr_dyn_to_primitive(obj, SCR_TOPRIM_DEFAULT);
  if (!p) return -1;
  int r = scr_loose_rec(prim, p);
  scr_dyn_release(p);
  return r;
}

bool scr_dyn_loose_eq(const ScrDyn *a, const ScrDyn *b) {
  if (a == NULL || b == NULL) return false;
  return scr_loose_rec(a, b) == 1;
}

/* `.errno` / `.syscall` / `.path` / `.dest` of an error: the stamped value
 * (+1) or the dyn undefined. */
ScrDyn *scr_error_ext_dyn(ScrError *e, const ScrStr *key) {
  double err_no = 0;
  const ScrStr *sys = NULL, *path = NULL, *dest = NULL;
  if (!scr_error_ext_get(e, &err_no, &sys, &path, &dest)) return scr_dyn_retain(scr_dyn_undefined());
  const char *k = key->data;
  if (strcmp(k, "errno") == 0) return scr_dyn_new_num(err_no);
  const ScrStr *v = strcmp(k, "syscall") == 0 ? sys : strcmp(k, "path") == 0 ? path : strcmp(k, "dest") == 0 ? dest : NULL;
  return v != NULL ? scr_dyn_new_str((ScrStr *)v) : scr_dyn_retain(scr_dyn_undefined());
}

/* Buffer.isBuffer over a checked-dynamic value: only a bytes box can be a
 * Buffer, and its own flavor stamp decides (a DataView answers false, an
 * unclassified producer refuses at the read, exactly like the static form). */
bool scr_dyn_is_buffer(const ScrDyn *d, const ScrStr *why) {
  if (d == NULL || d->kind != SCR_DYN_BYTES || d->v.bytes == NULL) return false;
  return scr_bytes_is_buffer(d->v.bytes, why);
}

/* fs.read's positioned form: a negative position reads from (and advances)
 * the file position, a non-negative one reads there and LEAVES the position
 * unchanged (Node's pread semantics, spelled save/seek/read/restore so the
 * bounds ladder and the read stay in scr_fs_read_sync). */
double scr_fs_read_at(double fd, ScrBytes *buf, double offset, double length, double position) {
  if (position < 0) return scr_fs_read_sync(fd, buf, offset, length);
#ifdef _WIN32
#define SCR_RA_SEEK(f, o, w) _lseeki64((f), (long long)(o), (w))
  long long saved = SCR_RA_SEEK((int)fd, 0, SEEK_CUR);
#else
#define SCR_RA_SEEK(f, o, w) lseek((f), (off_t)(o), (w))
  off_t saved = SCR_RA_SEEK((int)fd, 0, SEEK_CUR);
#endif
  if (saved < 0 || SCR_RA_SEEK((int)fd, position, SEEK_SET) < 0) {
    int e = errno;
    char namebuf[16];
    const char *name = scr_errno_name(e, namebuf, sizeof namebuf);
    const char *text = scr_errno_text(e);
    char msg[160];
    int len = snprintf(msg, sizeof msg, "%s: %s, read", name, text);
    scr_throw_errno_error(e, name, msg, (size_t)len, "read", NULL, NULL);
    return 0;
  }
  double n = scr_fs_read_sync(fd, buf, offset, length);
  int saved_errno = errno;
  SCR_RA_SEEK((int)fd, saved, SEEK_SET);
  errno = saved_errno;
#undef SCR_RA_SEEK
  return n;
}

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
  ScrDyn *td = scr_dyn_new_str(type); /* consumes type */
  scr_dyn_obj_define_hidden_data(obj, SCR_BLOB_KEY_TYPE, 2, td, false, false);
  scr_dyn_release(td);
  if (is_file) {
    ScrDyn *nd = scr_dyn_new_str(name); /* consumes name */
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
  return scr_dyn_new_str(s);
}

static ScrDyn *scr_blob_g_name(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo; (void)args; (void)argc;
  ScrDyn *self = scr_dyn_this_get();
  const ScrDyn *b = scr_blob_this_bytes(self, "name");
  if (b == NULL) { scr_dyn_release(self); return NULL; }
  const ScrDyn *n = scr_dyn_obj_own_data(self, SCR_BLOB_KEY_NAME, 2);
  ScrStr *s = scr_str_new(n != NULL && n->kind == SCR_DYN_STR ? n->v.str->data : "", n != NULL && n->kind == SCR_DYN_STR ? n->v.str->len : 0);
  scr_dyn_release(self);
  return scr_dyn_new_str(s);
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

static ScrDyn *scr_bv_s_from(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  const ScrDyn *v = scr_bv_arg(args, argc, 0);
  ScrBytes *b = (argc >= 2 && !scr_bv_is_undef(args[1]))
                    ? scr_buffer_from_dyn_enc(v, args[1])
                    : scr_buffer_from_dyn(v);
  return scr_bv_wrap_buffer(b);
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
  return scr_dyn_new_str(s);
}

static ScrDyn *scr_bv_m_atob(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  ScrStr *s = scr_atob(scr_bv_arg(args, argc, 0));
  if (s == NULL) return NULL;
  return scr_dyn_new_str(s);
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
  scr_dyn_obj_set(table, "from", 4, scr_bv_new_fn("from", scr_bv_s_from, 2));
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

/* Each member is ONE process value, built on first read and kept (the cache holds
 * the box), so every read of `buffer.<member>` is the same object as Node's:
 * `b.transcode === b.transcode`, `b.constants === b.constants`. */
static ScrDyn *scr_bv_values[15];
static void scr_bv_values_teardown(void) {
  for (size_t i = 0; i < 15; i++) {
    scr_dyn_release(scr_bv_values[i]);
    scr_bv_values[i] = NULL;
  }
}

ScrDyn *scr_dyn_buffer_value(double which) {
  int i = (int)which;
  if (i < 0 || i > 14 || (double)i != which) {
    static const char msg[] = "internal: unknown buffer module member";
    scr_throw_error_msg(SCR_ERR_ERROR, msg, sizeof msg - 1);
    return NULL;
  }
  if (scr_bv_values[i] == NULL) {
    if (i == 0) {
      scr_bv_values[0] = scr_dyn_buffer_ctor(); /* +1 kept by the cache */
    } else if (i == 14) {
      scr_bv_values[14] = scr_dyn_buffer_module();
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
