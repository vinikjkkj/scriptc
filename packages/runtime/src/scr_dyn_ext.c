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
  const char *canon = scr_bytes_enc_canon(enc->v.str);
  return canon != NULL ? canon : "utf8";
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
  const ScrStr *v = strcmp(k, "syscall") == 0 ? sys : strcmp(k, "path") == 0 ? path : strcmp(k, "dest") == 0 ? dest
                    : strcmp(k, "hostname") == 0 ? scr_error_ext_hostname(e) : NULL;
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

