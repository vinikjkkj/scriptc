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
#include <fcntl.h>
#include <sys/stat.h>
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
  const char *k = key->data;
  if (strcmp(k, "address") == 0) {
    ScrStr *a = scr_error_ext_address(e);
    return a != NULL ? scr_dyn_new_str(a) : scr_dyn_retain(scr_dyn_undefined());
  }
  if (strcmp(k, "port") == 0) {
    double p = 0;
    return scr_error_ext_port(e, &p) ? scr_dyn_new_num(p) : scr_dyn_retain(scr_dyn_undefined());
  }
  if (!scr_error_ext_get(e, &err_no, &sys, &path, &dest)) return scr_dyn_retain(scr_dyn_undefined());
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


/* ── the callback forms of writeFile, appendFile, mkdir, unlink, rename ──
 * Each follows lib/fs.js's order: the callback check, then the options
 * ladder (type, encoding, flush), then the data and path contracts, all
 * synchronous. The operation runs one loop turn later through the sync
 * primitives; a failure rides the callback as the Node-shaped error. The
 * data of a Buffer write is read at fire time (Node writes the buffer it
 * was given, not a snapshot), a string is encoded at call time (Node's
 * Buffer.from). */

#ifdef SCR_LIB
ScrDyn *scr_fs_write_file_cb(const ScrDyn *path, const ScrDyn *data, const ScrDyn *opts, const ScrDyn *cb) {
  (void)path; (void)data; (void)opts; (void)cb;
  scr_trap("scriptc: internal error: fs.writeFile callback reached in a library build — please report this");
  return NULL;
}
ScrDyn *scr_fs_append_file_cb(const ScrDyn *path, const ScrDyn *data, const ScrDyn *opts, const ScrDyn *cb) {
  (void)path; (void)data; (void)opts; (void)cb;
  scr_trap("scriptc: internal error: fs.appendFile callback reached in a library build — please report this");
  return NULL;
}
ScrDyn *scr_fs_mkdir_cb(const ScrDyn *path, const ScrDyn *opts, const ScrDyn *cb) {
  (void)path; (void)opts; (void)cb;
  scr_trap("scriptc: internal error: fs.mkdir callback reached in a library build — please report this");
  return NULL;
}
ScrDyn *scr_fs_unlink_cb(const ScrDyn *path, const ScrDyn *cb) {
  (void)path; (void)cb;
  scr_trap("scriptc: internal error: fs.unlink callback reached in a library build — please report this");
  return NULL;
}
ScrDyn *scr_fs_rename_cb(const ScrDyn *oldp, const ScrDyn *newp, const ScrDyn *cb) {
  (void)oldp; (void)newp; (void)cb;
  scr_trap("scriptc: internal error: fs.rename callback reached in a library build — please report this");
  return NULL;
}
ScrDyn *scr_fs_open_cb(const ScrDyn *path, const ScrDyn *flags, const ScrDyn *mode, const ScrDyn *cb, double argc) {
  (void)path; (void)flags; (void)mode; (void)cb; (void)argc;
  scr_trap("scriptc: internal error: fs.open callback reached in a library build — please report this");
  return NULL;
}
ScrDyn *scr_fs_close_cb(const ScrDyn *fd, const ScrDyn *cb) {
  (void)fd; (void)cb;
  scr_trap("scriptc: internal error: fs.close callback reached in a library build — please report this");
  return NULL;
}
ScrDyn *scr_fs_write_cb(const ScrDyn *fd, const ScrDyn *buffer, const ScrDyn *a2, const ScrDyn *a3, const ScrDyn *a4, const ScrDyn *cb) {
  (void)fd; (void)buffer; (void)a2; (void)a3; (void)a4; (void)cb;
  scr_trap("scriptc: internal error: fs.write callback reached in a library build — please report this");
  return NULL;
}
ScrDyn *scr_fs_chmod_cb(const ScrDyn *path, const ScrDyn *mode, const ScrDyn *cb) {
  (void)path; (void)mode; (void)cb;
  scr_trap("scriptc: internal error: fs.chmod callback reached in a library build — please report this");
  return NULL;
}
#else

#ifndef O_BINARY
#define O_BINARY 0
#endif

/* The bytes a writeFile data slot names, as a Buffer dyn (+1): a string is
 * encoded now with the options' encoding (utf8 by default); a view is
 * retained and read at fire time. NULL with the exception pending. */
static ScrDyn *scr_fs_write_data_dyn(const ScrDyn *data, const ScrDyn *opts) {
  if (data->kind == SCR_DYN_BYTES) return scr_dyn_retain((ScrDyn *)data);
  if (data->kind != SCR_DYN_STR) {
    scr_dyn_arg_type_fail("data", "of type string or an instance of Buffer, TypedArray, or DataView", data);
    return NULL;
  }
  bool isbuf;
  const char *canon = scr_fs_opt_encoding(opts, &isbuf);
  if (isbuf) {
    const char *msg = "Unknown encoding: buffer";
    scr_throw_error_msg_code(SCR_ERR_TYPE, msg, strlen(msg), "ERR_UNKNOWN_ENCODING");
    return NULL;
  }
  if (canon[0] == 0) canon = "utf8";
  ScrStr *enc = scr_str_new(canon, strlen(canon));
  ScrBytes *b = scr_bytes_from_str(data->v.str, enc);
  scr_str_release(enc);
  ScrDyn *d = scr_dyn_new_buffer_copy(b);
  scr_bytes_release(b);
  return d;
}

/* fsync(2) under its Windows name too. */
static int scr_fs_fsync_fd(int fd) {
#ifdef _WIN32
  return _commit(fd);
#else
  return fsync(fd);
#endif
}

/* The write half of writeFile/appendFile, at fire time: open(2) with the
 * resolved flags and mode (a path) or the given descriptor (a fd is never
 * closed), the write(2) loop, fsync(2) when flush is set, close(2). The
 * first failure throws with its syscall; a descriptor failure has no path. */
static void scr_fs_write_run(const ScrDyn *path, const ScrBytes *data, int bits, mode_t mode, bool flush) {
  bool owned = path->kind != SCR_DYN_NUM;
  ScrStr *ps = NULL;
  int fd;
  if (owned) {
    ps = scr_fs_path_str(path);
    fd = open(ps->data, bits | O_BINARY, mode);
    if (fd < 0) {
      scr_fs_throw(errno, "open", ps);
      scr_str_release(ps);
      return;
    }
  } else {
    fd = (int)path->v.num;
  }
  size_t n = data->len * scr_bytes_elem_size(data->elem);
  size_t at = 0;
  const char *op = NULL;
  int err = 0;
  while (at < n) {
    ssize_t w = write(fd, data->data + at, n - at);
    if (w < 0) {
      if (errno == EINTR) continue;
      err = errno;
      op = "write";
      break;
    }
    at += (size_t)w;
  }
  if (op == NULL && flush && scr_fs_fsync_fd(fd) != 0) {
    err = errno;
    op = "fsync";
  }
  if (owned && close(fd) != 0 && op == NULL) {
    err = errno;
    op = "close";
  }
  /* A descriptor failure names no path (NULL), as Node does. */
  if (op != NULL) scr_fs_throw(err, op, ps);
  if (ps != NULL) scr_str_release(ps);
}

static void scr_fs_write_fire_common(ScrClosure *self, const char *what) {
  ScrDyn *path = scr_box_get_ref(self->caps[0]);
  ScrDyn *data = scr_box_get_ref(self->caps[1]);
  ScrDyn *bits = scr_box_get_ref(self->caps[2]);
  ScrDyn *mode = scr_box_get_ref(self->caps[3]);
  ScrDyn *flush = scr_box_get_ref(self->caps[4]);
  ScrDyn *cb = scr_box_get_ref(self->caps[5]);
  scr_fs_write_run(path, data->v.bytes, (int)bits->v.num, (mode_t)mode->v.num, flush->v.b);
  scr_fs_cb_finish(cb, NULL, 0, what);
  scr_dyn_release(path);
  scr_dyn_release(data);
  scr_dyn_release(bits);
  scr_dyn_release(mode);
  scr_dyn_release(flush);
  scr_dyn_release(cb);
}

static void scr_fs_write_file_fire(ScrClosure *self) {
  scr_fs_write_fire_common(self, "the fs.writeFile callback");
}

static void scr_fs_append_file_fire(ScrClosure *self) {
  scr_fs_write_fire_common(self, "the fs.appendFile callback");
}

/* writeFile(file, data, options?, cb) and appendFile (the default flag is
 * 'a'). The ladder: cb (callback || options), getOptions (type, encoding),
 * options.flush (a boolean when present), the data contract, then the
 * descriptor (an int32 >= 0) or the path with fs.open's flags then mode. */
static ScrDyn *scr_fs_write_cb_common(const ScrDyn *path, const ScrDyn *data, const ScrDyn *opts,
                                      const ScrDyn *cb0, bool append) {
  const ScrDyn *cb = scr_dyn_truthy(cb0) ? cb0 : opts;
  if (!scr_fs_cb_chk(cb, "cb")) return NULL;
  if (!scr_fs_get_options(opts)) return NULL;
  bool obj = opts->kind == SCR_DYN_OBJ;
  bool flush = false;
  const ScrDyn *f = obj ? scr_dyn_obj_get(opts, "flush", 5) : NULL;
  if (f != NULL && !scr_fs_dyn_absent(f)) {
    if (f->kind != SCR_DYN_BOOL) {
      scr_dyn_prop_type_fail("options.flush", "of type boolean", f);
      return NULL;
    }
    flush = f->v.b;
  }
  ScrDyn *bytes = scr_fs_write_data_dyn(data, opts);
  if (bytes == NULL) return NULL;
  int bits = append ? (O_APPEND | O_CREAT | O_WRONLY) : (O_TRUNC | O_CREAT | O_WRONLY);
  double mode = 0666;
  if (path->kind == SCR_DYN_NUM) {
    double v = path->v.num;
    if (!(isfinite(v) && trunc(v) == v)) {
      char recv[48], msg[160];
      scr_num_received(v, recv);
      int len = snprintf(msg, sizeof msg, "The value of \"fd\" is out of range. It must be an integer. Received %s", recv);
      scr_throw_error_msg_code(SCR_ERR_RANGE, msg, (size_t)len, "ERR_OUT_OF_RANGE");
      scr_dyn_release(bytes);
      return NULL;
    }
    if (v < 0 || v > 2147483647.0) {
      char recv[48], msg[160];
      scr_num_received(v, recv);
      int len = snprintf(msg, sizeof msg, "The value of \"fd\" is out of range. It must be >= 0 && <= 2147483647. Received %s", recv);
      scr_throw_error_msg_code(SCR_ERR_RANGE, msg, (size_t)len, "ERR_OUT_OF_RANGE");
      scr_dyn_release(bytes);
      return NULL;
    }
  } else {
    if (!scr_fs_path_chk(path, "path")) {
      scr_dyn_release(bytes);
      return NULL;
    }
    const ScrDyn *fl = obj ? scr_dyn_obj_get(opts, "flag", 4) : NULL;
    if (fl != NULL && scr_dyn_truthy(fl)) {
      if (fl->kind == SCR_DYN_NUM) {
        bits = (int)fl->v.num;
      } else if (fl->kind == SCR_DYN_STR && scr_fs_flag_bits(fl->v.str) >= 0) {
        bits = scr_fs_flag_bits(fl->v.str);
      } else {
        scr_dyn_arg_value_fail("flags", "is invalid", fl);
        scr_dyn_release(bytes);
        return NULL;
      }
    }
    const ScrDyn *m = obj ? scr_dyn_obj_get(opts, "mode", 4) : NULL;
    if (m != NULL && !scr_fs_dyn_absent(m)) {
      if (!scr_fs_mode_chk(m, "mode")) {
        scr_dyn_release(bytes);
        return NULL;
      }
      mode = m->kind == SCR_DYN_NUM ? m->v.num : (double)strtol(m->v.str->data, NULL, 8);
    }
  }
  ScrDyn *vals[6];
  vals[0] = (ScrDyn *)path;
  vals[1] = bytes;
  vals[2] = scr_dyn_new_num((double)bits);
  vals[3] = scr_dyn_new_num(mode);
  vals[4] = scr_dyn_new_bool(flush);
  vals[5] = (ScrDyn *)cb;
  ScrClosure *clo = scr_fs_cb_closure(append ? scr_fs_append_file_fire : scr_fs_write_file_fire, 6,
                                      (const ScrDyn *const *)vals);
  scr_dyn_release(vals[2]);
  scr_dyn_release(vals[3]);
  scr_dyn_release(vals[4]);
  scr_dyn_release(bytes);
  scr_set_timeout(clo, 0);
  return scr_dyn_retain(scr_dyn_undefined());
}

ScrDyn *scr_fs_write_file_cb(const ScrDyn *path, const ScrDyn *data, const ScrDyn *opts, const ScrDyn *cb) {
  return scr_fs_write_cb_common(path, data, opts, cb, false);
}

ScrDyn *scr_fs_append_file_cb(const ScrDyn *path, const ScrDyn *data, const ScrDyn *opts, const ScrDyn *cb) {
  return scr_fs_write_cb_common(path, data, opts, cb, true);
}

static void scr_fs_mkdir_fire(ScrClosure *self) {
  ScrDyn *path = scr_box_get_ref(self->caps[0]);
  ScrDyn *mode = scr_box_get_ref(self->caps[1]);
  ScrDyn *recursive = scr_box_get_ref(self->caps[2]);
  ScrDyn *cb = scr_box_get_ref(self->caps[3]);
  ScrDyn *out = NULL;
  ScrStr *p = scr_fs_path_str(path);
  if (recursive->v.b) {
    ScrStr *first = scr_fs_mkdir_recursive_first(p, mode->v.num);
    if (first != NULL) {
      out = scr_dyn_new_str(first);
      scr_str_release(first);
    }
  } else {
    scr_fs_mkdir_mode(p, mode->v.num);
  }
  scr_str_release(p);
  scr_fs_cb_finish(cb, &out, out != NULL ? 1 : 0, "the fs.mkdir callback");
  if (out != NULL) scr_dyn_release(out);
  scr_dyn_release(path);
  scr_dyn_release(mode);
  scr_dyn_release(recursive);
  scr_dyn_release(cb);
}

/* mkdir(path, options?, cb): a function in the options slot is the callback.
 * A number or string options value is the mode; an object reads recursive
 * (a boolean when present) and mode; other truthy values are ignored. */
ScrDyn *scr_fs_mkdir_cb(const ScrDyn *path, const ScrDyn *opts, const ScrDyn *cb0) {
  const ScrDyn *cb = opts->kind == SCR_DYN_FUNC ? opts : cb0;
  if (!scr_fs_cb_chk(cb, "cb")) return NULL;
  if (!scr_fs_path_chk(path, "path")) return NULL;
  double mode = 0777;
  bool recursive = false;
  if (opts->kind == SCR_DYN_NUM || opts->kind == SCR_DYN_STR) {
    if (!scr_fs_mode_chk(opts, "mode")) return NULL;
    mode = opts->kind == SCR_DYN_NUM ? opts->v.num : (double)strtol(opts->v.str->data, NULL, 8);
  } else if (opts->kind == SCR_DYN_OBJ) {
    const ScrDyn *r = scr_dyn_obj_get(opts, "recursive", 9);
    if (r != NULL && !scr_fs_dyn_absent(r)) {
      if (r->kind != SCR_DYN_BOOL) {
        scr_dyn_prop_type_fail("options.recursive", "of type boolean", r);
        return NULL;
      }
      recursive = r->v.b;
    }
    const ScrDyn *m = scr_dyn_obj_get(opts, "mode", 4);
    if (m != NULL && !scr_fs_dyn_absent(m)) {
      if (!scr_fs_mode_chk(m, "options.mode")) return NULL;
      mode = m->kind == SCR_DYN_NUM ? m->v.num : (double)strtol(m->v.str->data, NULL, 8);
    }
  }
  ScrDyn *vals[4];
  vals[0] = (ScrDyn *)path;
  vals[1] = scr_dyn_new_num(mode);
  vals[2] = scr_dyn_new_bool(recursive);
  vals[3] = (ScrDyn *)cb;
  ScrClosure *clo = scr_fs_cb_closure(scr_fs_mkdir_fire, 4, (const ScrDyn *const *)vals);
  scr_dyn_release(vals[1]);
  scr_dyn_release(vals[2]);
  scr_set_timeout(clo, 0);
  return scr_dyn_retain(scr_dyn_undefined());
}

static void scr_fs_unlink_fire(ScrClosure *self) {
  ScrDyn *path = scr_box_get_ref(self->caps[0]);
  ScrDyn *cb = scr_box_get_ref(self->caps[1]);
  ScrStr *p = scr_fs_path_str(path);
  scr_fs_unlink(p);
  scr_str_release(p);
  scr_fs_cb_finish(cb, NULL, 0, "the fs.unlink callback");
  scr_dyn_release(path);
  scr_dyn_release(cb);
}

ScrDyn *scr_fs_unlink_cb(const ScrDyn *path, const ScrDyn *cb) {
  if (!scr_fs_cb_chk(cb, "cb")) return NULL;
  if (!scr_fs_path_chk(path, "path")) return NULL;
  const ScrDyn *vals[2] = {path, cb};
  scr_set_timeout(scr_fs_cb_closure(scr_fs_unlink_fire, 2, vals), 0);
  return scr_dyn_retain(scr_dyn_undefined());
}

static void scr_fs_rename_fire(ScrClosure *self) {
  ScrDyn *oldp = scr_box_get_ref(self->caps[0]);
  ScrDyn *newp = scr_box_get_ref(self->caps[1]);
  ScrDyn *cb = scr_box_get_ref(self->caps[2]);
  ScrStr *a = scr_fs_path_str(oldp);
  ScrStr *b = scr_fs_path_str(newp);
  scr_fs_rename(a, b);
  scr_str_release(a);
  scr_str_release(b);
  scr_fs_cb_finish(cb, NULL, 0, "the fs.rename callback");
  scr_dyn_release(oldp);
  scr_dyn_release(newp);
  scr_dyn_release(cb);
}

ScrDyn *scr_fs_rename_cb(const ScrDyn *oldp, const ScrDyn *newp, const ScrDyn *cb) {
  if (!scr_fs_cb_chk(cb, "cb")) return NULL;
  if (!scr_fs_path_chk(oldp, "oldPath")) return NULL;
  if (!scr_fs_path_chk(newp, "newPath")) return NULL;
  const ScrDyn *vals[3] = {oldp, newp, cb};
  scr_set_timeout(scr_fs_cb_closure(scr_fs_rename_fire, 3, vals), 0);
  return scr_dyn_retain(scr_dyn_undefined());
}

/* ── exact ERR_* renderings for the four callback writers ────────────
 * Node renders a received value with inspect: a string is quoted and
 * escaped (strEscape, quote chosen by content), -0 prints as -0, and a
 * type error truncates a string to 25 characters and "..." (Node's
 * determineSpecificType). The shared inspect-lite does none of that, so the
 * four members render their own values here. The build fences their
 * argument kinds to string, number, null, undefined (functions in callback
 * slots), so only these kinds reach the renderers. Node's C++ binding
 * asserts on a negative zero in an int32, uint32 or length slot: those
 * values abort the process at the binding, after every JS check. */

static bool fs_negzero(double v) { return v == 0 && signbit(v); }

static void fs_abort_negzero(const char *what) {
  fprintf(stderr, "Assertion failed: %s (negative zero reached the binding)\n", what);
  abort();
}

/* A number as Node's ERR_* message shows it. sep: ERR_OUT_OF_RANGE's
 * numeric separators for a large integer (the sites that show them). */
static void fs_num_text(double v, bool sep, char *out, size_t cap) {
  if (fs_negzero(v)) {
    snprintf(out, cap, "-0");
    return;
  }
  if (sep) {
    scr_num_received(v, out);
    return;
  }
  scr_f64_to_str(v, out);
}

/* strEscape: the quote is ' unless the text has one, then " if it has no ",
 * else ` if it has no ` or ${, else ' with \' escapes. Control characters
 * and backslashes escape as Node's meta table does. */
static char *fs_inspect_bytes(const char *d, size_t n, size_t *outn) {
  bool sq = memchr(d, '\'', n) != NULL;
  bool dq = memchr(d, '"', n) != NULL;
  bool bt = memchr(d, '`', n) != NULL;
  bool dollar = false;
  for (size_t i = 0; i + 1 < n && !dollar; i++) dollar = d[i] == '$' && d[i + 1] == '{';
  char q = '\'';
  if (sq) {
    if (!dq) q = '"';
    else if (!bt && !dollar) q = '`';
  }
  char *out = malloc(n * 4 + 4);
  size_t k = 0;
  out[k++] = q;
  for (size_t i = 0; i < n; i++) {
    unsigned char c = (unsigned char)d[i];
    if (c == '\\') {
      out[k++] = '\\';
      out[k++] = '\\';
    } else if (c == '\'' && q == '\'') {
      out[k++] = '\\';
      out[k++] = '\'';
    } else if (c < 0x20 || c == 0x7f) {
      if (c == 8) k += (size_t)sprintf(out + k, "\\b");
      else if (c == 9) k += (size_t)sprintf(out + k, "\\t");
      else if (c == 10) k += (size_t)sprintf(out + k, "\\n");
      else if (c == 12) k += (size_t)sprintf(out + k, "\\f");
      else if (c == 13) k += (size_t)sprintf(out + k, "\\r");
      else k += (size_t)sprintf(out + k, "\\x%02X", c);
    } else if (c == 0xC2 && i + 1 < n && (unsigned char)d[i + 1] >= 0x80 && (unsigned char)d[i + 1] <= 0x9f) {
      k += (size_t)sprintf(out + k, "\\x%02X", (unsigned char)d[i + 1]);
      i++;
    } else {
      out[k++] = (char)c;
    }
  }
  out[k++] = q;
  out[k] = 0;
  *outn = k;
  return out;
}

/* determineSpecificType's string: the quote is chosen as strEscape chooses it,
 * but the text is raw (no escapes): 'a<LF>b' stays raw, "it's" takes double quotes. */
static char *fs_quote_raw(const char *d, size_t n, size_t *outn) {
  bool sq = memchr(d, '\'', n) != NULL;
  bool dq = memchr(d, '"', n) != NULL;
  bool bt = memchr(d, '`', n) != NULL;
  bool dollar = false;
  for (size_t i = 0; i + 1 < n && !dollar; i++) dollar = d[i] == '$' && d[i + 1] == '{';
  char q = '\'';
  if (sq) {
    if (!dq) q = '"';
    else if (!bt && !dollar) q = '`';
  }
  char *out = malloc(n + 3);
  out[0] = q;
  memcpy(out + 1, d, n);
  out[n + 1] = q;
  out[n + 2] = 0;
  *outn = n + 2;
  return out;
}

/* A string value as ERR_INVALID_ARG_VALUE shows it: the whole text, inspected. */
static char *fs_inspect_str(const ScrStr *s, size_t *outn) {
  return fs_inspect_bytes((const char *)s->data, s->len, outn);
}

/* ERR_INVALID_ARG_TYPE for a received value. Strings and numbers render as
 * determineSpecificType does; null and undefined keep the shared text. */
static void fs_type_fail(const char *name, const char *expected, const ScrDyn *v) {
  if (v->kind != SCR_DYN_STR && v->kind != SCR_DYN_NUM) {
    scr_dyn_arg_type_fail(name, expected, v);
    return;
  }
  char detail[200];
  char *inspected = NULL;
  size_t in = 0;
  if (v->kind == SCR_DYN_STR) {
    size_t n = v->v.str->len;
    char tmp[40];
    size_t tl = n;
    if (n > 28) {
      memcpy(tmp, v->v.str->data, 25);
      memcpy(tmp + 25, "...", 3);
      tl = 28;
    } else {
      memcpy(tmp, v->v.str->data, n);
    }
    inspected = fs_quote_raw(tmp, tl, &in);
    snprintf(detail, sizeof detail, "type string (%.*s)", (int)in, inspected);
  } else {
    char num[64];
    fs_num_text(v->v.num, false, num, sizeof num);
    snprintf(detail, sizeof detail, "type number (%s)", num);
  }
  char msg[400];
  int len = snprintf(msg, sizeof msg, "The \"%s\" argument must be %s. Received %s", name, expected, detail);
  if (inspected != NULL) free(inspected);
  scr_throw_error_msg_code(SCR_ERR_TYPE, msg, (size_t)len, "ERR_INVALID_ARG_TYPE");
}

/* ERR_INVALID_ARG_VALUE: "The argument 'x' <reason>. Received <inspected>". */
static void fs_value_fail(const char *name, const char *reason, const ScrDyn *v) {
  if (v->kind != SCR_DYN_STR && v->kind != SCR_DYN_NUM) {
    scr_dyn_arg_value_fail(name, reason, v);
    return;
  }
  char *inspected = NULL;
  size_t in = 0;
  char num[64];
  const char *shown;
  if (v->kind == SCR_DYN_STR) {
    inspected = fs_inspect_str(v->v.str, &in);
    shown = inspected;
  } else {
    fs_num_text(v->v.num, false, num, sizeof num);
    shown = num;
  }
  char *msg = malloc(strlen(shown) + strlen(reason) + strlen(name) + 96);
  int len = sprintf(msg, "The argument '%s' %s. Received %s", name, reason, shown);
  scr_throw_error_msg_code(SCR_ERR_TYPE, msg, (size_t)len, "ERR_INVALID_ARG_VALUE");
  free(msg);
  if (inspected != NULL) free(inspected);
}

/* ERR_OUT_OF_RANGE: "The value of 'x' is out of range. It must be <range>. Received <n>". */
static void fs_range_fail(const char *name, const char *range, double v, bool sep) {
  char recv[96];
  fs_num_text(v, sep, recv, sizeof recv);
  char msg[320];
  int len = snprintf(msg, sizeof msg, "The value of \"%s\" is out of range. It must be %s. Received %s", name, range, recv);
  scr_throw_error_msg_code(SCR_ERR_RANGE, msg, (size_t)len, "ERR_OUT_OF_RANGE");
}

/* validateInt32/validateInteger: type, then an integer, then the range. */
static bool fs_int_chk(const ScrDyn *v, const char *name, double min, double max, const char *range, bool sep) {
  if (v->kind != SCR_DYN_NUM) {
    fs_type_fail(name, "of type number", v);
    return false;
  }
  double n = v->v.num;
  if (!(isfinite(n) && trunc(n) == n)) {
    fs_range_fail(name, "an integer", n, sep);
    return false;
  }
  if (n < min || n > max) {
    fs_range_fail(name, range, n, sep);
    return false;
  }
  return true;
}

/* parseFileMode (no default here: the callers resolve an absent mode). */
static bool fs_mode_chk(const ScrDyn *m, const char *name, bool sep) {
  if (m->kind == SCR_DYN_STR) {
    const ScrStr *s = m->v.str;
    bool octal = s->len > 0;
    for (size_t i = 0; octal && i < s->len; i++) {
      if (s->data[i] < '0' || s->data[i] > '7') octal = false;
    }
    if (octal) return true;
    fs_value_fail(name, "must be a 32-bit unsigned integer or an octal string", m);
    return false;
  }
  if (m->kind != SCR_DYN_NUM) {
    fs_type_fail(name, "of type number", m);
    return false;
  }
  return fs_int_chk(m, name, 0, 4294967295.0, ">= 0 && <= 4294967295", sep);
}

static bool fs_path_chk(const ScrDyn *p, const char *name) {
  if (p->kind == SCR_DYN_STR || p->kind == SCR_DYN_BYTES) return true;
  fs_type_fail(name, "of type string or an instance of Buffer or URL", p);
  return false;
}

static bool fs_cb_chk(const ScrDyn *cb, const char *name) {
  if (cb->kind == SCR_DYN_FUNC) return true;
  fs_type_fail(name, "of type function", cb);
  return false;
}

/* The open flags: a number must be an int32 (validateInt32's shape with
 * Node's separators), a string must be a known flag (checked by the caller). */
static bool fs_flags_num_chk(const ScrDyn *f) {
  return fs_int_chk(f, "flags", -2147483648.0, 2147483647.0, ">= -2147483648 && <= 2147483647", true);
}

/* ── the callback forms of open, close, write and chmod ───────────────
 * Node's ladders (lib/fs.js of v24.15.0, read from the function sources):
 * open's argument count picks the callback slot, the path, the mode and the
 * flags are checked, then the callback; close checks the callback before the
 * descriptor (the binding does the descriptor check); write's buffer and
 * string forms are one ladder over the six positional slots, with Node's
 * `callback ||= position || length || offset` and the typeof tests kept
 * literal. The operation runs one loop turn later. A position the binding
 * cannot use as an offset (a non-integer, or a negative one) is the current
 * file position, as GetOffset and libuv's offset -1 give it. */

static double scr_fs_write_offset_of(const ScrDyn *p) {
  if (p->kind != SCR_DYN_NUM) return -1;
  double v = p->v.num;
  if (!(isfinite(v) && trunc(v) == v && fabs(v) <= 9007199254740991.0)) return -1;
  return v < 0 ? -1 : v;
}

static ssize_t scr_fs_pwrite_at(int fd, const char *p, size_t n, double at) {
#ifdef _WIN32
  long long saved = _lseeki64(fd, 0, SEEK_CUR);
  if (saved < 0 || _lseeki64(fd, (long long)at, SEEK_SET) < 0) return -1;
  int w = _write(fd, p, (unsigned)n);
  int e = errno;
  _lseeki64(fd, saved, SEEK_SET);
  errno = e;
  return (ssize_t)w;
#else
  return pwrite(fd, p, n, (off_t)at);
#endif
}

static void scr_fs_open_fire(ScrClosure *self) {
  ScrDyn *path = scr_box_get_ref(self->caps[0]);
  ScrDyn *flags = scr_box_get_ref(self->caps[1]);
  ScrDyn *mode = scr_box_get_ref(self->caps[2]);
  ScrDyn *cb = scr_box_get_ref(self->caps[3]);
  ScrStr *p = scr_fs_path_str(path);
  int fd = open(p->data, (int)flags->v.num | O_BINARY, (mode_t)mode->v.num);
  if (fd < 0) {
    scr_fs_throw(errno, "open", p);
    scr_fs_cb_finish(cb, NULL, 0, "the fs.open callback");
  } else {
    ScrDyn *v = scr_dyn_new_num((double)fd);
    scr_fs_cb_finish(cb, &v, 1, "the fs.open callback");
    scr_dyn_release(v);
  }
  scr_str_release(p);
  scr_dyn_release(path);
  scr_dyn_release(flags);
  scr_dyn_release(mode);
  scr_dyn_release(cb);
}

static void scr_fs_flags_fail(const ScrDyn *flags) {
  fs_value_fail("flags", "is invalid", flags);
}

/* fs.open(path, flags, mode, callback) with argc the count the caller wrote.
 * argc < 3: the flags slot IS the callback ('r', 0o666). A function in the
 * mode slot is the callback. Otherwise: path, then parseFileMode (mode),
 * then stringToFlags (flags), then the callback. */
ScrDyn *scr_fs_open_cb(const ScrDyn *path, const ScrDyn *flags0, const ScrDyn *mode0, const ScrDyn *cb0,
                       double argc) {
  if (!fs_path_chk(path, "path")) return NULL;
  const ScrDyn *cb = cb0;
  double m = 0666;
  double bits = 0; /* 'r' */
  if (argc < 3) {
    cb = flags0;
  } else {
    if (mode0->kind == SCR_DYN_FUNC) {
      cb = mode0;
    } else if (!scr_fs_dyn_absent(mode0)) {
      if (!fs_mode_chk(mode0, "mode", true)) return NULL;
      m = mode0->kind == SCR_DYN_NUM ? mode0->v.num : (double)strtol(mode0->v.str->data, NULL, 8);
    }
    if (flags0->kind == SCR_DYN_NUM) {
      if (!fs_flags_num_chk(flags0)) return NULL;
      bits = flags0->v.num;
    } else if (!scr_fs_dyn_absent(flags0)) {
      int b = flags0->kind == SCR_DYN_STR ? scr_fs_flag_bits(flags0->v.str) : -1;
      if (b < 0) {
        scr_fs_flags_fail(flags0);
        return NULL;
      }
      bits = (double)b;
    }
  }
  if (!fs_cb_chk(cb, "cb")) return NULL;
  if (argc >= 3 && flags0->kind == SCR_DYN_NUM && fs_negzero(flags0->v.num)) fs_abort_negzero("open flags");
  if (argc >= 3 && mode0->kind == SCR_DYN_NUM && fs_negzero(mode0->v.num)) fs_abort_negzero("open mode");
  ScrDyn *vals[4];
  vals[0] = (ScrDyn *)path;
  vals[1] = scr_dyn_new_num(bits);
  vals[2] = scr_dyn_new_num(m);
  vals[3] = (ScrDyn *)cb;
  ScrClosure *clo = scr_fs_cb_closure(scr_fs_open_fire, 4, (const ScrDyn *const *)vals);
  scr_dyn_release(vals[1]);
  scr_dyn_release(vals[2]);
  scr_set_timeout(clo, 0);
  return scr_dyn_retain(scr_dyn_undefined());
}

/* A close with no callback is Node's defaultCloseCallback: an error is
 * thrown (uncaught) on the loop turn. */
static void scr_fs_close_fire(ScrClosure *self) {
  ScrDyn *fd = scr_box_get_ref(self->caps[0]);
  ScrDyn *cb = scr_box_get_ref(self->caps[1]);
  bool hasCb = cb->kind == SCR_DYN_FUNC;
  scr_fs_close(fd->v.num);
  if (hasCb) scr_fs_cb_finish(cb, NULL, 0, "the fs.close callback");
  scr_dyn_release(fd);
  scr_dyn_release(cb);
}

ScrDyn *scr_fs_close_cb(const ScrDyn *fd, const ScrDyn *cb) {
  bool dflt = cb->kind == SCR_DYN_UNDEF;
  if (!dflt && !fs_cb_chk(cb, "cb")) return NULL;
  if (!fs_int_chk(fd, "fd", 0, 2147483647.0, ">= 0 && <= 2147483647", false)) return NULL;
  const ScrDyn *vals[2] = {fd, cb};
  scr_set_timeout(scr_fs_cb_closure(scr_fs_close_fire, 2, vals), 0);
  return scr_dyn_retain(scr_dyn_undefined());
}

static void scr_fs_write_cb_fire(ScrClosure *self) {
  ScrDyn *fd = scr_box_get_ref(self->caps[0]);
  ScrDyn *data = scr_box_get_ref(self->caps[1]);
  ScrDyn *shown = scr_box_get_ref(self->caps[2]);
  ScrDyn *offv = scr_box_get_ref(self->caps[3]);
  ScrDyn *lenv = scr_box_get_ref(self->caps[4]);
  ScrDyn *posv = scr_box_get_ref(self->caps[5]);
  ScrDyn *cb = scr_box_get_ref(self->caps[6]);
  const char *base = (const char *)data->v.bytes->data;
  size_t off = (size_t)offv->v.num, len = (size_t)lenv->v.num;
  double pos = posv->v.num;
  size_t at = 0;
  int err = 0;
  while (at < len) {
    ssize_t w = pos < 0 ? write((int)fd->v.num, base + off + at, len - at)
                        : scr_fs_pwrite_at((int)fd->v.num, base + off + at, len - at, pos + (double)at);
    if (w < 0) {
      if (errno == EINTR) continue;
      err = errno;
      break;
    }
    if (w == 0) break;
    at += (size_t)w;
  }
  if (err != 0) scr_fs_throw(err, "write", NULL);
  ScrDyn *a[3];
  ScrDyn *r;
  if (scr_exc_pending()) {
    a[0] = scr_fs_take_error_dyn();
    a[1] = scr_dyn_new_num(0);
    a[2] = shown;
    r = scr_dyn_call(cb, a, 3, "the fs.write callback");
    scr_dyn_release(a[0]);
    scr_dyn_release(a[1]);
  } else {
    a[0] = scr_dyn_new_null();
    a[1] = scr_dyn_new_num((double)at);
    a[2] = shown;
    r = scr_dyn_call(cb, a, 3, "the fs.write callback");
    scr_dyn_release(a[0]);
    scr_dyn_release(a[1]);
  }
  if (r != NULL) scr_dyn_release(r);
  scr_dyn_release(fd);
  scr_dyn_release(data);
  scr_dyn_release(shown);
  scr_dyn_release(offv);
  scr_dyn_release(lenv);
  scr_dyn_release(posv);
  scr_dyn_release(cb);
}

/* Node's write ladder over the six positional slots. The buffer form runs
 * the options destructuring, validateInteger(offset), validateOffsetLengthWrite
 * and the binding's position rule; the string form runs the typeof shuffle,
 * validateEncoding and the callback check. The data is read at fire time for
 * a buffer (Node writes the buffer it was given) and encoded now for a string. */
static bool scr_fs_write_buffer_chk(const ScrDyn *fd, const ScrDyn *buffer, const ScrDyn *a2, const ScrDyn *a3,
                                       const ScrDyn *a4, const ScrDyn *cb, ScrDyn **offOut, ScrDyn **lenOut,
                                       ScrDyn **posOut) {
  (void)fd;
  double blen = scr_bytes_byte_len(buffer->v.bytes);
  ScrDyn *offv, *lenv, *posv;
  bool objForm = a2->kind == SCR_DYN_OBJ || a2->kind == SCR_DYN_ARR || a2->kind == SCR_DYN_NULL ||
                 a2->kind == SCR_DYN_BYTES;
  if (objForm) {
    /* ({ offset = 0, length = byteLength - offset, position = null } = a2 ?? {}) */
    const ScrDyn *o = NULL, *l = NULL, *p = NULL;
    if (a2->kind == SCR_DYN_OBJ) {
      o = scr_dyn_obj_get(a2, "offset", 6);
      l = scr_dyn_obj_get(a2, "length", 6);
      p = scr_dyn_obj_get(a2, "position", 8);
    }
    offv = (o != NULL && o->kind != SCR_DYN_UNDEF) ? scr_dyn_retain((ScrDyn *)o) : scr_dyn_new_num(0);
    if (l != NULL && l->kind != SCR_DYN_UNDEF) {
      lenv = scr_dyn_retain((ScrDyn *)l);
    } else if (a2->kind == SCR_DYN_ARR) {
      lenv = scr_dyn_new_num(scr_dyn_arr_len(a2)); /* an array's own length */
    } else if (a2->kind == SCR_DYN_BYTES) {
      lenv = scr_dyn_new_num(blen);
    } else {
      double base = offv->kind == SCR_DYN_NUM ? offv->v.num : 0;
      lenv = scr_dyn_new_num(blen - base);
    }
    posv = (p != NULL && p->kind != SCR_DYN_UNDEF) ? scr_dyn_retain((ScrDyn *)p) : scr_dyn_new_null();
  } else {
    offv = scr_dyn_retain((ScrDyn *)a2);
    lenv = scr_dyn_retain((ScrDyn *)a3);
    posv = scr_dyn_retain((ScrDyn *)a4);
  }
  (void)cb;
  /* offset == null or a function is 0; anything else must be an integer. */
  if (offv->kind == SCR_DYN_NULL || offv->kind == SCR_DYN_UNDEF || offv->kind == SCR_DYN_FUNC) {
    scr_dyn_release(offv);
    offv = scr_dyn_new_num(0);
  } else if (!fs_int_chk(offv, "offset", 0, 9007199254740991.0, ">= 0 && <= 9007199254740991", true)) {
    goto fail;
  }
  double offset = offv->v.num;
  /* typeof length !== 'number' → byteLength - offset */
  double length = lenv->kind == SCR_DYN_NUM ? lenv->v.num : blen - offset;
  char recv[48], msg[192];
  if (offset > blen) {
    fs_num_text(offset, true, recv, sizeof recv);
    int n = snprintf(msg, sizeof msg, "The value of \"offset\" is out of range. It must be <= %.0f. Received %s", blen, recv);
    scr_throw_error_msg_code(SCR_ERR_RANGE, msg, (size_t)n, "ERR_OUT_OF_RANGE");
    goto fail;
  }
  if (length > blen - offset) {
    fs_num_text(length, true, recv, sizeof recv);
    int n = snprintf(msg, sizeof msg, "The value of \"length\" is out of range. It must be <= %.0f. Received %s", blen - offset, recv);
    scr_throw_error_msg_code(SCR_ERR_RANGE, msg, (size_t)n, "ERR_OUT_OF_RANGE");
    goto fail;
  }
  if (length < 0) {
    fs_num_text(length, true, recv, sizeof recv);
    int n = snprintf(msg, sizeof msg, "The value of \"length\" is out of range. It must be >= 0. Received %s", recv);
    scr_throw_error_msg_code(SCR_ERR_RANGE, msg, (size_t)n, "ERR_OUT_OF_RANGE");
    goto fail;
  }
  ScrDyn *ln = scr_dyn_new_num(length);
  bool lenok = fs_int_chk(ln, "length", 0, 2147483647.0, ">= 0 && <= 2147483647", true);
  scr_dyn_release(ln);
  if (!lenok) goto fail;
  if (fs_negzero(length)) fs_abort_negzero("write length");
  double pos = scr_fs_write_offset_of(posv);
  scr_dyn_release(offv);
  scr_dyn_release(lenv);
  scr_dyn_release(posv);
  *offOut = scr_dyn_new_num(offset);
  *lenOut = scr_dyn_new_num(length);
  *posOut = scr_dyn_new_num(pos);
  return true;
fail:
  scr_dyn_release(offv);
  scr_dyn_release(lenv);
  scr_dyn_release(posv);
  return false;
}

/* The six positional slots of fs.write, as Node's parameters. */
ScrDyn *scr_fs_write_cb(const ScrDyn *fd, const ScrDyn *buffer, const ScrDyn *a2, const ScrDyn *a3,
                        const ScrDyn *a4, const ScrDyn *cb0) {
  if (!fs_int_chk(fd, "fd", 0, 2147483647.0, ">= 0 && <= 2147483647", true)) return NULL;
  ScrDyn *data, *offv = NULL, *lenv = NULL, *posv = NULL, *shown;
  const ScrDyn *cb;
  if (buffer->kind == SCR_DYN_BYTES) {
    /* callback ||= position || length || offset */
    cb = cb0;
    if (!scr_dyn_truthy(cb)) cb = scr_dyn_truthy(a4) ? a4 : scr_dyn_truthy(a3) ? a3 : a2;
    if (!fs_cb_chk(cb, "cb")) return NULL;
    if (!scr_fs_write_buffer_chk(fd, buffer, a2, a3, a4, cb, &offv, &lenv, &posv)) return NULL;
    data = scr_dyn_retain((ScrDyn *)buffer);
    shown = scr_dyn_retain((ScrDyn *)buffer);
  } else {
    /* validateStringAfterArrayBufferView */
    if (buffer->kind != SCR_DYN_STR) {
      fs_type_fail("buffer", "of type string or an instance of Buffer, TypedArray, or DataView", buffer);
      return NULL;
    }
    const ScrDyn *offset = a2, *length = a3, *position = a4;
    if (position->kind != SCR_DYN_FUNC) {
      if (offset->kind == SCR_DYN_FUNC) {
        position = offset;
        offset = NULL;
      } else {
        position = length;
      }
      length = NULL; /* 'utf8' */
    }
    /* validateEncoding(str, length): Node's only check is the hex length on UTF-16 units. */
    const char *canon = "utf8";
    if (length != NULL && length->kind == SCR_DYN_STR) {
      const char *c = scr_fs_enc_canon(length->v.str);
      if (c != NULL) canon = c;
    }
    if (strcmp(canon, "hex") == 0) {
      size_t units = 0;
      const ScrStr *s = buffer->v.str;
      for (size_t i = 0; i < s->len; i++) {
        unsigned char c = (unsigned char)s->data[i];
        if ((c & 0xC0) != 0x80) units += c >= 0xF0 ? 2 : 1;
      }
      if (units % 2 != 0) {
        char reason[80];
        snprintf(reason, sizeof reason, "is invalid for data of length %zu", units);
        fs_value_fail("encoding", reason, length);
        return NULL;
      }
    }
    cb = position;
    if (!fs_cb_chk(cb, "cb")) return NULL;
    ScrStr *enc = scr_str_new(canon, strlen(canon));
    ScrBytes *b = scr_bytes_from_str(buffer->v.str, enc);
    scr_str_release(enc);
    data = scr_dyn_new_buffer_copy(b);
    offv = scr_dyn_new_num(0);
    lenv = scr_dyn_new_num(scr_bytes_byte_len(data->v.bytes));
    posv = scr_dyn_new_num(offset != NULL ? scr_fs_write_offset_of(offset) : -1);
    scr_bytes_release(b);
    shown = scr_dyn_retain((ScrDyn *)buffer);
  }
#ifdef SCR_LIB
  scr_trap("scriptc: internal error: fs.write callback reached in a library build — please report this");
  return NULL;
#else
  {
    ScrDyn *vals[7];
    vals[0] = (ScrDyn *)fd;
    vals[1] = data;
    vals[2] = shown;
    vals[3] = offv;
    vals[4] = lenv;
    vals[5] = posv;
    vals[6] = (ScrDyn *)cb;
    ScrClosure *clo = scr_fs_cb_closure(scr_fs_write_cb_fire, 7, (const ScrDyn *const *)vals);
    scr_dyn_release(data);
    scr_dyn_release(shown);
    scr_dyn_release(offv);
    scr_dyn_release(lenv);
    scr_dyn_release(posv);
    scr_set_timeout(clo, 0);
    return scr_dyn_retain(scr_dyn_undefined());
  }
#endif
}

static void scr_fs_chmod_cb_fire(ScrClosure *self) {
  ScrDyn *path = scr_box_get_ref(self->caps[0]);
  ScrDyn *mode = scr_box_get_ref(self->caps[1]);
  ScrDyn *cb = scr_box_get_ref(self->caps[2]);
  ScrStr *p = scr_fs_path_str(path);
  scr_fs_chmod(p, mode->v.num);
  scr_str_release(p);
  scr_fs_cb_finish(cb, NULL, 0, "the fs.chmod callback");
  scr_dyn_release(path);
  scr_dyn_release(mode);
  scr_dyn_release(cb);
}

/* chmod(path, mode, callback): path, then parseFileMode (no default), then
 * the callback. */
ScrDyn *scr_fs_chmod_cb(const ScrDyn *path, const ScrDyn *mode0, const ScrDyn *cb) {
  if (!fs_path_chk(path, "path")) return NULL;
  if (!fs_mode_chk(mode0, "mode", true)) return NULL;
  if (!fs_cb_chk(cb, "cb")) return NULL;
  if (mode0->kind == SCR_DYN_NUM && fs_negzero(mode0->v.num)) fs_abort_negzero("chmod mode");
  ScrDyn *m = scr_dyn_new_num(mode0->kind == SCR_DYN_NUM ? mode0->v.num : (double)strtol(mode0->v.str->data, NULL, 8));
  ScrDyn *vals[3];
  vals[0] = (ScrDyn *)path;
  vals[1] = m;
  vals[2] = (ScrDyn *)cb;
  ScrClosure *clo = scr_fs_cb_closure(scr_fs_chmod_cb_fire, 3, (const ScrDyn *const *)vals);
  scr_dyn_release(m);
  scr_set_timeout(clo, 0);
  return scr_dyn_retain(scr_dyn_undefined());
}
#endif
