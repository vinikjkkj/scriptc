/* Error objects: the runtime-provided root of the `extends Error` class
 * hierarchy (layout/vtable contract in scr_runtime.h). Everything here
 * mirrors what the compiler emits for its own hierarchy classes — retain
 * bumps rc (and marks live under the collector), the public release
 * dispatches through the vtable so a base-typed release tears down the
 * derived object, and the direct release in the builtin vtables does the
 * ScrError teardown. The traced/untraced split is a runtime MODE (set by
 * main() from the compiler's cycle fixpoint) because this one compilation
 * unit serves every program.
 */
#include "scr_runtime.h"

#include <errno.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>

static void scr_error_oom(void) {
  scr_trap("scriptc: out of memory\n");
}

static bool scr_error_traced = false;

/* Error.stackTraceLimit — V8's default is 10. */
static double scr_error_stack_limit = 10;
double scr_error_stack_limit_get(void) { return scr_error_stack_limit; }
void scr_error_stack_limit_set(double v) { scr_error_stack_limit = v; }

void scr_error_set_traced(void) { scr_error_traced = true; }

static const char *const scr_error_names[SCR_ERR_KINDS] = {
    "Error", "TypeError", "RangeError", "SyntaxError",
    /* DOMException's DEFAULT name is "Error" too (WebIDL: the name
     * parameter defaults to "Error"); the class identity lives in the
     * vtable, never the name. */
    "Error",
    /* ReferenceError, appended so DOMException keeps index 4. The name
     * lookup below must therefore SKIP index 4 rather than scan a range:
     * scanning through it would map the string "Error" onto the
     * DOMException kind. */
    "ReferenceError"};

/* The kind's BUILTIN name — this table, published. The dyn boundary needs
 * it to tell an error whose `name` is still its constructor's (a prototype
 * property in Node, which `Object.keys` does NOT list) from one whose name
 * was ASSIGNED (`e.name = "Custom"` — an own ENUMERABLE property, which it
 * DOES). Reading the table is the only way to ask that question, and
 * copying its four literals into a second unit is how the two answers
 * drift apart. NULL for a kind out of range (a compiled `extends Error`
 * subclass carries its own vtable). */
const char *scr_error_kind_name(int kind) {
  return kind >= 0 && kind < SCR_ERR_KINDS ? scr_error_names[kind] : NULL;
}

/* Which of the builtin kinds is this error, by VTABLE identity? -1
 * for a compiled subclass, whose vtable is its own. */
int scr_error_kind_of(const ScrError *e) {
  for (int i = 0; i < SCR_ERR_KINDS; i++) {
    if (e->vt == &scr_error_vts[i]) return i;
  }
  return -1;
}

void scr_error_trace(void *e, ScrTraceVisit visit, void *ctx) {
  /* name/message are strings — never collector-headered; nothing to visit. */
  (void)e;
  (void)visit;
  (void)ctx;
}

static size_t scr_err_ext_count;
static void scr_err_ext_drop(ScrError *e);
/* The expando bag's teardown hook: scr_json.c owns the dyn object and
 * installs this before any bag can exist (scr_error_prop_set is the only
 * producer), so a unit that never links the checked-dynamic tree never sees
 * a non-NULL `props`. */
static void (*scr_error_props_drop)(void *obj) = NULL;

void scr_error_install_props_drop(void (*fn)(void *obj)) { scr_error_props_drop = fn; }

static void scr_error_gcfree(void *obj) {
  ScrError *e = (ScrError *)obj;
  if (e->props != NULL && scr_error_props_drop != NULL) scr_error_props_drop(obj);
  scr_str_release(e->name);
  scr_str_release(e->message);
  scr_str_release(e->code); /* NULL-safe: absent on most errors */
  scr_str_release(e->stack); /* NULL-safe: absent until `.stack` is read */
  if (scr_err_ext_count) scr_err_ext_drop(e);
  scr_obj_free_note();
  scr_cyc_free(e);
}

/* DOMException teardown: the ScrError fields plus the owned cause dyn
 * value. The cause is a ScrDyn — scr_json.c territory — and this file
 * must stay linkable WITHOUT the checked-dynamic tree (the runtime C-unit tests link
 * subsets), so the drop goes through a hook scr_json.c installs before
 * any cause can exist (scr_domex_new is the only producer). */
static void (*scr_domex_cause_drop)(void *obj) = NULL;

void scr_domex_install_cause_drop(void (*fn)(void *obj)) {
  scr_domex_cause_drop = fn;
}

static void scr_domex_gcfree(void *obj) {
  ScrDomException *d = (ScrDomException *)obj;
  if (d->cause != NULL && scr_domex_cause_drop != NULL) scr_domex_cause_drop(obj);
  scr_error_gcfree(obj);
}

/* The DIRECT release stored in the builtin vtables (the compiler emits the
 * analogous sc_reld_* for user subclasses). */
static void scr_error_reld(void *obj) {
  ScrError *e = (ScrError *)obj;
  if (--e->rc == 0) {
    if (scr_error_traced) scr_cyc_on_dead(e);
    if (e->props != NULL && scr_error_props_drop != NULL) scr_error_props_drop(obj);
    scr_str_release(e->name);
    scr_str_release(e->message);
    scr_str_release(e->code); /* NULL-safe: absent on most errors */
    scr_str_release(e->stack); /* NULL-safe: absent until `.stack` is read */
    if (scr_err_ext_count) scr_err_ext_drop(e);
    scr_obj_free_note();
    if (scr_error_traced) scr_cyc_free(e);
    else free(e);
  } else if (scr_error_traced) {
    scr_cyc_on_release(e); /* possible cycle root; may collect */
  }
}

/* The DOMException vtable's direct release: the cause drops first, then
 * the shared ScrError teardown (through the hook — see scr_domex_gcfree). */
static void scr_domex_reld(void *obj) {
  ScrDomException *d = (ScrDomException *)obj;
  if (d->rc == 1 && d->cause != NULL && scr_domex_cause_drop != NULL) {
    scr_domex_cause_drop(obj);
  }
  scr_error_reld(obj);
}

/* Defaults cover only the instants before main() stamps the program's real
 * preorder intervals; release is permanent. */
ScrVt scr_error_vts[SCR_ERR_KINDS] = {
    {0, 5, &scr_error_reld}, /* Error */
    {1, 1, &scr_error_reld}, /* TypeError */
    {2, 2, &scr_error_reld}, /* RangeError */
    {3, 3, &scr_error_reld}, /* SyntaxError */
    {4, 4, &scr_domex_reld}, /* DOMException */
    {5, 5, &scr_error_reld}, /* ReferenceError */
};

ScrError *scr_error_retain(ScrError *e) {
  if (e && e->rc != SIZE_MAX) {
    e->rc++;
    if (scr_error_traced) scr_cyc_mark_live(e);
  }
  return e;
}

void scr_error_release(ScrError *e) {
  if (!e || e->rc == SIZE_MAX) return;
  e->vt->release(e); /* the DYNAMIC class's teardown */
}

void *scr_error_retain_v(void *e) { return scr_error_retain((ScrError *)e); }
void scr_error_release_v(void *e) { scr_error_release((ScrError *)e); }

void scr_error_init(void *obj, int kind, ScrStr *message) {
  ScrError *e = (ScrError *)obj;
  const char *n = scr_error_names[kind];
  e->name = scr_str_new(n, strlen(n));
  e->message = message ? scr_str_retain(message) : scr_str_new("", 0);
}

/* The Error hierarchy's trace entry point when the program's cycle fixpoint
 * marked it cycle-capable (NULL otherwise) — the same argument the emitter's
 * throw sites pass. For runtime-side code that stores an Error payload
 * outside a throw (the Promise reject closure in scr_async.c). */
ScrTraceFn scr_error_trace_arg(void) {
  return scr_error_traced ? &scr_error_trace : NULL;
}

/* Mode-aware allocation shared by every runtime-side error creation.
 * DOMException allocates its wider layout (and registers the teardown
 * that drops the cause); calloc/cyc_alloc zeroing covers the extra
 * slots' defaults (code 0, no cause). */
static ScrError *scr_error_alloc(int kind) {
  size_t size = kind == SCR_ERR_DOMEX ? sizeof(ScrDomException) : sizeof(ScrError);
  void (*gcfree)(void *) = kind == SCR_ERR_DOMEX ? &scr_domex_gcfree : &scr_error_gcfree;
  ScrError *e;
  if (scr_error_traced) {
    e = scr_cyc_alloc(size, &scr_error_trace, gcfree);
  } else {
    e = calloc(1, size);
    if (!e) scr_error_oom();
  }
  e->rc = 1;
  e->vt = &scr_error_vts[kind];
  scr_obj_alloc_note();
  return e;
}

ScrError *scr_error_new(int kind, ScrStr *message) {
  ScrError *e = scr_error_alloc(kind);
  scr_error_init(e, kind, message);
  return e;
}

/* Was this error MINTED BY THE RUNTIME, or is it an instance of a user
 * class that extends Error? Runtime-minted errors carry one of the builtin
 * vtables by address (scr_error_alloc: `e->vt = &scr_error_vts[kind]`);
 * an emitted subclass carries its own static vtable, whose pre/post nest
 * INSIDE Error's interval — which is what makes instanceof work and is
 * exactly why the interval test cannot answer this question. Pointer
 * identity can. */
static bool scr_error_runtime_minted(const ScrError *e) {
  for (int i = 0; i < SCR_ERR_KINDS; i++) {
    if (e->vt == &scr_error_vts[i]) return true;
  }
  return false;
}

ScrStr *scr_error_to_string(ScrError *e) {
  /* ECMA-262 Error.prototype.toString over the two fields (no prototype
   * chain exists: constructors always initialize both) — except Node's
   * OWN error classes: AssertionError's toString and the NodeError
   * family's construction-time name both render "name [code]: message".
   * Every ERR_*-coded error this runtime mints IS one of those classes
   * (fs/exec errno codes like ENOENT keep the plain form, like Node), so
   * the code-prefix test is exact for runtime-thrown errors.
   *
   * A USER subclass never brackets in Node — `class Coded extends Error`
   * with `this.code = "ERR_X"` stringifies as "Coded: boom", measured on
   * v25.9.0 — and now that a subclass's own `code` declaration ROUTES
   * into this very slot (one property, one slot, so the `Error` view can
   * answer it), user-assigned ERR_* codes reach here for the first time.
   * The provenance test above is what keeps that from bracketing: it was
   * a documented-unreachable divergence while nothing could write the
   * slot from user code, and closing the read is what made it reachable,
   * so the two land together. */
  ScrStr *name = e->name;
  ScrStr *message = e->message;
  bool assertion = name && e->code && e->code->len >= 4 &&
                   memcmp(e->code->data, "ERR_", 4) == 0 &&
                   scr_error_runtime_minted(e);
  if (!name || name->len == 0) {
    return message ? scr_str_retain(message) : scr_str_new("", 0);
  }
  if (!assertion && (!message || message->len == 0)) return scr_str_retain(name);
  size_t msglen = message ? message->len : 0;
  size_t codelen = assertion ? e->code->len + 3 : 0; /* " [" + code + "]" */
  size_t len = name->len + codelen + 2 + msglen;
  char *buf = malloc(len);
  if (!buf) scr_error_oom();
  size_t n = 0;
  memcpy(buf + n, name->data, name->len);
  n += name->len;
  if (assertion) {
    buf[n++] = ' ';
    buf[n++] = '[';
    memcpy(buf + n, e->code->data, e->code->len);
    n += e->code->len;
    buf[n++] = ']';
  }
  buf[n++] = ':';
  buf[n++] = ' ';
  if (message) memcpy(buf + n, message->data, message->len);
  n += msglen;
  ScrStr *out = scr_str_new(buf, n);
  free(buf);
  return out;
}

bool scr_error_is(const void *obj) {
  const ScrVt *vt = ((const ScrError *)obj)->vt;
  return scr_error_vts[SCR_ERR_ERROR].pre <= vt->pre &&
         vt->pre <= scr_error_vts[SCR_ERR_ERROR].post;
}

void scr_throw_error(int kind, ScrStr *message) {
  ScrError *e = scr_error_new(kind, message);
  scr_str_release(message); /* scr_error_new retained a copy */
  scr_throw_obj(e, &scr_error_retain_v, &scr_error_release_v,
                 scr_error_traced ? &scr_error_trace : NULL);
}

void scr_throw_error_msg(int kind, const char *message, size_t len) {
  scr_throw_error(kind, scr_str_new(message, len));
}

/* ── the errno/syscall/path/dest properties (NodeJS.ErrnoException) ──────
 * The layout prefix of ScrError is fixed by the compiler, so the four extra
 * own properties a fs/uv error carries live in a side table keyed by the
 * error's address (a short chained hash). Only errors a throw site stamped
 * have an entry; the count lets every other error skip the lookup on
 * teardown. */
typedef struct ScrErrExt {
  const ScrError *e;
  double errno_val; /* libuv's NEGATIVE errno */
  ScrStr *syscall;
  ScrStr *path;
  ScrStr *dest;
  ScrStr *hostname; /* the dns failure's hostname (NULL elsewhere) */
  struct ScrErrExt *next;
} ScrErrExt;

static ScrErrExt *scr_err_ext_head = NULL;
static size_t scr_err_ext_count = 0;

static void scr_err_ext_drop(ScrError *e) {
  ScrErrExt **pp = &scr_err_ext_head;
  while (*pp != NULL) {
    if ((*pp)->e == e) {
      ScrErrExt *x = *pp;
      *pp = x->next;
      scr_str_release(x->syscall);
      scr_str_release(x->path);
      scr_str_release(x->dest);
      scr_str_release(x->hostname);
      free(x);
      scr_err_ext_count--;
      return;
    }
    pp = &(*pp)->next;
  }
}

/* The number Node reports in `errno`: libuv's, which is the NEGATED C errno on
 * POSIX hosts and a table of its own on Windows (uv-errno.h's UV__E* values,
 * the same ones Node prints: ENOENT -4058, EBADF -4083, ...). The CRT errno
 * numbers the runtime holds on Windows are translated by name. */
static double scr_uv_errno(int err_no) {
#ifdef _WIN32
  switch (err_no) {
  case EPERM: return -4048;
  case ENOENT: return -4058;
  case EINTR: return -4072;
  case EIO: return -4070;
  case EBADF: return -4083;
  case EAGAIN: return -4088;
  case ENOMEM: return -4057;
  case EACCES: return -4092;
  case EFAULT: return -4074;
  case EBUSY: return -4082;
  case EEXIST: return -4075;
  case EXDEV: return -4037;
  case ENODEV: return -4059;
  case ENOTDIR: return -4052;
  case EISDIR: return -4068;
  case EINVAL: return -4071;
  case ENFILE: return -4061;
  case EMFILE: return -4066;
  case ENOSPC: return -4055;
  case ESPIPE: return -4041;
  case EROFS: return -4043;
  case EPIPE: return -4047;
  case ENAMETOOLONG: return -4064;
  case ENOTEMPTY: return -4051;
  default: break;
  }
#endif
  return -(double)err_no;
}

static void scr_error_set_ext_val(ScrError *e, double errno_val, const char *syscall, const char *path,
                                  const char *dest) {
  scr_err_ext_drop(e);
  ScrErrExt *x = (ScrErrExt *)calloc(1, sizeof *x);
  if (!x) scr_trap("scriptc: out of memory\n");
  x->e = e;
  x->errno_val = errno_val;
  if (syscall) x->syscall = scr_str_new(syscall, strlen(syscall));
  if (path) x->path = scr_str_new(path, strlen(path));
  if (dest) x->dest = scr_str_new(dest, strlen(dest));
  x->next = scr_err_ext_head;
  scr_err_ext_head = x;
  scr_err_ext_count++;
}

void scr_error_set_ext(ScrError *e, int err_no, const char *syscall, const char *path, const char *dest) {
  scr_error_set_ext_val(e, scr_uv_errno(err_no), syscall, path, dest);
}

/* A dns.lookup failure's extension: errno is the libuv value itself
 * (already negative, e.g. UV_EAI_NONAME -3008), syscall "getaddrinfo", and
 * the hostname Node sets as an own property. */
void scr_error_set_ext_dns(ScrError *e, double errno_val, const char *syscall, const char *hostname) {
  scr_error_set_ext_val(e, errno_val, syscall, NULL, NULL);
  scr_err_ext_head->hostname = scr_str_new(hostname, strlen(hostname));
}

/* The hostname extension (borrowed), or NULL. */
const ScrStr *scr_error_ext_hostname(const ScrError *e) {
  if (scr_err_ext_count == 0) return NULL;
  for (ScrErrExt *x = scr_err_ext_head; x != NULL; x = x->next) {
    if (x->e == e) return x->hostname;
  }
  return NULL;
}

/* Borrowed views of the stamped properties; false when the error carries
 * none. */
bool scr_error_ext_get(const ScrError *e, double *err_no, const ScrStr **syscall, const ScrStr **path,
                       const ScrStr **dest) {
  if (scr_err_ext_count == 0) return false;
  for (ScrErrExt *x = scr_err_ext_head; x != NULL; x = x->next) {
    if (x->e == e) {
      *err_no = x->errno_val;
      *syscall = x->syscall;
      *path = x->path;
      *dest = x->dest;
      return true;
    }
  }
  return false;
}

/* The fs/uv throw: message, `code`, and the errno/syscall/path/dest set. */
/* The errno error as a VALUE (+1): the fs callback forms deliver it, the
 * throwing shape below wraps it. */
ScrError *scr_errno_error_build(int err_no, const char *code, const char *message, size_t len, const char *syscall,
                                const char *path, const char *dest) {
  ScrStr *msg = scr_str_new(message, len);
  ScrError *e = scr_error_new(SCR_ERR_ERROR, msg);
  scr_str_release(msg);
  scr_error_set_code(e, code);
  scr_error_set_ext(e, err_no, syscall, path, dest);
  return e;
}

/* Throws a built error value (takes its +1). */
void scr_throw_error_value(ScrError *e) {
  scr_throw_obj(e, &scr_error_retain_v, &scr_error_release_v, scr_error_traced ? &scr_error_trace : NULL);
}

void scr_throw_errno_error(int err_no, const char *code, const char *message, size_t len, const char *syscall,
                           const char *path, const char *dest) {
  scr_throw_error_value(scr_errno_error_build(err_no, code, message, len, syscall, path, dest));
}

/* An error whose `errno` is a value of its own library, not a C errno: zlib's
 * Z_DATA_ERROR is -3 and Z_BUF_ERROR -5 on every host (err.errno), with no
 * Windows translation and no syscall. */
void scr_throw_errno_error_raw(double errno_val, const char *code, const char *message, size_t len) {
  ScrStr *msg = scr_str_new(message, len);
  ScrError *e = scr_error_new(SCR_ERR_ERROR, msg);
  scr_str_release(msg);
  scr_error_set_code(e, code);
  scr_error_set_ext_val(e, errno_val, NULL, NULL, NULL);
  scr_throw_obj(e, &scr_error_retain_v, &scr_error_release_v, scr_error_traced ? &scr_error_trace : NULL);
}

/* ── the `code` slot (NodeJS.ErrnoException's .code) ─────────────────── */

void scr_error_set_code(ScrError *e, const char *code) {
  scr_str_release(e->code); /* NULL-safe; replace is Node's assignment */
  e->code = scr_str_new(code, strlen(code));
}

ScrStr *scr_error_code(ScrError *e) {
  return e->code ? scr_str_retain(e->code) : NULL;
}

/* `e.stack`. This runtime captures no frames, so the value is the header
 * line alone -- exactly what V8 produces under Error.stackTraceLimit = 0,
 * the lane the lowering's comment names as its byte-for-byte reference.
 *
 * WHY THE MEMO, and it is the whole reason this is not just
 * scr_error_to_string: V8 formats ONCE, at the first access, and caches
 * the result inside the accessor. A later write to `name` or `message`
 * therefore cannot change a later read. MEASURED, both runtimes:
 *
 *   const e = new Error('boom');
 *   e.stack             // "Error: boom"
 *   e.name = 'Renamed';
 *   e.stack             // "Error: boom"   <- v22.18.0 AND v25.9.0
 *
 * and the same for a `message` write. Both of those slots ARE writable
 * from compiled code -- they are %Error's two declared fields -- so
 * recomputing per read answered "Renamed: boom" where node answers
 * "Error: boom". The memo closes that.
 *
 * What is still NOT V8: the frame lines, which do not exist here. That
 * divergence is the one surfaces.ts prices out loud.
 *
 * `toString` is deliberately NOT memoised: node recomputes IT on every
 * call ("Renamed: boom" after the rename, measured), so the two readers
 * stay separate functions over the same two slots. */
ScrStr *scr_error_stack(ScrError *e) {
  if (e->stack == NULL) e->stack = scr_error_to_string(e);
  return scr_str_retain(e->stack);
}

/* Error.captureStackTrace(e): a new capture replaces the old one, and V8 formats the
 * header lazily at the FIRST READ of `stack` (MEASURED: a name assigned after the call
 * still heads the stack), so the call only forgets the memoised header — the next read
 * formats it from the then-current name and message, as scr_error_stack does. */
void scr_error_capture_stack(ScrError *e) {
  if (e->stack != NULL) {
    scr_str_release(e->stack);
    e->stack = NULL;
  }
}

#ifdef SCR_TRAP_TRACE
/* Which lowering traps a run actually EXECUTES. Built only when
 * SCRIPTC_TRAP_TRACE is set at build time (cc.ts turns that into
 * -DSCR_TRAP_TRACE, the SCRIPTC_RC_AUDIT contract exactly).
 *
 * A deferred compile fence -- the `runtimeFence` --best-effort emits for a
 * statement whose construct has no static lowering -- is the ONLY throw in
 * the tree whose `code` is SC-numeric: every runtime-parity throw spells
 * Node's ERR_*. So the filter below is exact rather than a heuristic.
 *
 * The line is printed BEFORE the throw unwinds, so a fence the program
 * catches and swallows is still observed; that is the whole point, since a
 * fence that dies uncaught was already visible in the exit code. The cap is
 * a flood guard only: a fence inside a retry loop must not fill the disk,
 * and by the twenty-thousandth fire the run has long since answered the
 * question.
 *
 * Compiled out entirely without the define, so the default binary is
 * byte-identical, not merely the default emitted C. */
static unsigned long scr_trap_trace_fires = 0;

static void scr_trap_trace_note(const char *message, size_t len,
                                const char *code) {
  if (!(code && code[0] == 'S' && code[1] == 'C' && code[2] >= '0' &&
        code[2] <= '9')) {
    return;
  }
  scr_trap_trace_fires++;
  if (scr_trap_trace_fires > 20000UL) {
    if (scr_trap_trace_fires == 20001UL) {
      fprintf(stderr, "SCTRAP TRUNCATED after 20000 fires\n");
      fflush(stderr);
    }
    return;
  }
  fprintf(stderr, "SCTRAP %s %.*s\n", code, (int)len, message);
  fflush(stderr);
}
#endif

/* scr_throw_error_msg with the code stamped on the payload — the fs and
 * exec throwers' one-call spelling. */
void scr_throw_error_msg_code(int kind, const char *message, size_t len,
                               const char *code) {
#ifdef SCR_TRAP_TRACE
  scr_trap_trace_note(message, len, code);
#endif
  ScrStr *msg = scr_str_new(message, len);
  ScrError *e = scr_error_new(kind, msg);
  scr_str_release(msg); /* scr_error_new retained its copy */
  scr_error_set_code(e, code);
  scr_throw_obj(e, &scr_error_retain_v, &scr_error_release_v,
                 scr_error_traced ? &scr_error_trace : NULL);
}

/* scr_trap_fmt's CATCHABLE twin (SC9003): the keyed-read-miss family
 * (emit-walkers.ts recordKeyGetHelper on the C lane, llvm/emitter.ts
 * keyedRecordReadDirectInto on the LLVM one) is SHARED per (shape, result
 * type) or, on the LLVM lane, module-wide -- exactly the plumbing
 * scr_trap_fmt's vararg message already carried (site and why arrive as
 * RUNTIME pointers, because the helper cannot bake one call site's text
 * into its own body). Converting the family's answer from array-OOB's
 * uncatchable abort to strandedUnitTrap/SC9004 and reqabsent/SC9005's
 * already-shipped catchable TypeError (SEMANTICS.md) means the FORMATTING
 * step has to survive the switch unchanged, so this is scr_trap_fmt's own
 * vsnprintf in place of its vfprintf, landing in scr_throw_error_msg_code
 * instead of abort(). A message that would overflow the buffer truncates
 * (vsnprintf's own contract) rather than corrupting anything -- the site
 * and the why are always far short of it. */
void scr_throw_error_fmt_code(int kind, const char *code, const char *fmt, ...) {
  char buf[512];
  va_list ap;
  va_start(ap, fmt);
  int n = vsnprintf(buf, sizeof buf, fmt, ap);
  va_end(ap);
  size_t len = n < 0 ? 0 : ((size_t)n >= sizeof buf ? sizeof buf - 1 : (size_t)n);
  scr_throw_error_msg_code(kind, buf, len, code);
}

/* A compiler-resolved Node-parity throw (the always-throwing lowered
 * arms: ERR_INVALID_THIS receivers, ERR_MISSING_ARGS ladders, the
 * symbol-to-string TypeError): builds the builtin error of `kind` with
 * `code` stamped when non-empty. Borrows both strings; always throws
 * (catchably — call sites are compiler-emitted pending checks). */
void scr_throw_node_coded(double kind, const ScrStr *code, const ScrStr *msg) {
  ScrError *e = scr_error_new((int)kind, (ScrStr *)msg); /* borrowed in */
  if (code->len > 0) {
    scr_str_release(e->code); /* NULL-safe */
    e->code = scr_str_retain((ScrStr *)code);
  }
  scr_throw_obj(e, &scr_error_retain_v, &scr_error_release_v,
                 scr_error_traced ? &scr_error_trace : NULL);
}

/* A read of a `declare`d const nothing defines (the bundler-define
 * pattern — __VERSION__): Node running the source throws ReferenceError
 * "<name> is not defined" at the access. Borrows `name`; always throws
 * (catchably — callers are compiler-emitted pending checks). */
void scr_undef_global_read(ScrStr *name) {
  static const char suffix[] = " is not defined";
  size_t len = name->len + sizeof suffix - 1;
  char *msg = malloc(len + 1);
  if (!msg) {
    scr_trap("scriptc: out of memory\n");
  }
  memcpy(msg, name->data, name->len);
  memcpy(msg + name->len, suffix, sizeof suffix);
  ScrStr *m = scr_str_new(msg, len);
  free(msg);
  scr_throw_error_named(scr_str_new("ReferenceError", 14), m);
}

/* An ES module's `require` read. Node's UNCAUGHT report decorates the message
 * (" in ES module scope, you can use import instead" plus the package note);
 * a caught read does not. The decoration rides with the thrown object: it is
 * registered by pointer (the object is retained, so no other error can take
 * its address) and printed only when that very object escapes uncaught. */
static void *scr_report_obj = NULL;
static ScrStr *scr_report_suffix = NULL;

void scr_undef_global_read_esm(ScrStr *name, ScrStr *suffix) {
  scr_undef_global_read(name);
  void *e = scr_exc_pending_payload();
  if (e == NULL) return;
  if (scr_report_obj != NULL) scr_error_release_v(scr_report_obj);
  scr_report_obj = scr_error_retain_v(e);
  if (scr_report_suffix != NULL) scr_str_release(scr_report_suffix);
  scr_report_suffix = scr_str_new(suffix->data, suffix->len);
}

ScrStr *scr_error_report_suffix(const void *payload) {
  if (scr_report_obj == NULL || payload != scr_report_obj) return NULL;
  return scr_report_suffix->len == 0 ? NULL : scr_report_suffix;
}

/* The record above holds one +1 on the error and one on the suffix string.
 * Drop both when the payload they describe is dropped (caught, or reported
 * by the uncaught exit), so the record never outlives its exception. */
void scr_error_report_forget(const void *payload) {
  if (scr_report_obj == NULL || payload != scr_report_obj) return;
  scr_error_release_v(scr_report_obj);
  scr_report_obj = NULL;
  if (scr_report_suffix != NULL) scr_str_release(scr_report_suffix);
  scr_report_suffix = NULL;
}

/* ── DOMException ─────────────────────────────────────────────────────
 * The web-standard error shape (a Node global since v17): the ScrError
 * prefix plus the WebIDL slots (legacy numeric code, the options form's
 * cause). Construction resolves WebIDL's optionality over borrowed dyn
 * arguments — one place, shared by the compiled `new DOMException(...)`
 * and the runtime's own throw sites (atob/btoa). */

static const struct { const char *name; double code; } scr_domex_codes[] = {
    {"IndexSizeError", 1},             {"DOMStringSizeError", 2},
    {"HierarchyRequestError", 3},      {"WrongDocumentError", 4},
    {"InvalidCharacterError", 5},      {"NoDataAllowedError", 6},
    {"NoModificationAllowedError", 7}, {"NotFoundError", 8},
    {"NotSupportedError", 9},          {"InUseAttributeError", 10},
    {"InvalidStateError", 11},         {"SyntaxError", 12},
    {"InvalidModificationError", 13},  {"NamespaceError", 14},
    {"InvalidAccessError", 15},        {"ValidationError", 16},
    {"TypeMismatchError", 17},         {"SecurityError", 18},
    {"NetworkError", 19},              {"AbortError", 20},
    {"URLMismatchError", 21},          {"QuotaExceededError", 22},
    {"TimeoutError", 23},              {"InvalidNodeTypeError", 24},
    {"DataCloneError", 25},
};

double scr_domex_code_of(const ScrStr *name) {
  for (size_t i = 0; i < sizeof scr_domex_codes / sizeof scr_domex_codes[0]; i++) {
    const char *n = scr_domex_codes[i].name;
    size_t len = strlen(n);
    if (name->len == len && memcmp(name->data, n, len) == 0) {
      return scr_domex_codes[i].code;
    }
  }
  return 0;
}

/* The blank allocation scr_json.c's constructors fill (scr_error_alloc
 * stays private — the mode-aware sizing/teardown selection lives here). */
ScrError *scr_domex_alloc(void) { return scr_error_alloc(SCR_ERR_DOMEX); }

double scr_domex_code(ScrError *e) { return ((ScrDomException *)e)->dom_code; }

bool scr_domex_has_cause(ScrError *e) {
  return ((ScrDomException *)e)->has_cause;
}

void scr_throw_domex(const char *name, const char *message) {
  scr_throw_domex_str(name, scr_str_new(message, strlen(message)));
}

void scr_throw_domex_str(const char *name, ScrStr *message) {
  ScrDomException *d = (ScrDomException *)scr_error_alloc(SCR_ERR_DOMEX);
  d->name = scr_str_new(name, strlen(name));
  d->message = message; /* ownership moves in */
  d->dom_code = scr_domex_code_of(d->name);
  scr_throw_obj(d, &scr_error_retain_v, &scr_error_release_v,
                scr_error_traced ? &scr_error_trace : NULL);
}


void scr_throw_error_named(ScrStr *name, ScrStr *message) {
  /* The name decides the CLASS, which is what makes
   * `<cjs global> is not defined` a real ReferenceError instance rather
   * than an Error wearing the string: `error instanceof ReferenceError`
   * is a vtable-interval test, and it can only answer true if the throw
   * that minted this object picked the ReferenceError kind here.
   *
   * SCR_ERR_DOMEX is skipped, not ranged past: its entry in the name
   * table is "Error" (WebIDL's default), so scanning it would map the
   * plain name onto the DOMException class. */
  int kind = SCR_ERR_ERROR;
  for (int i = 1; i < SCR_ERR_KINDS; i++) {
    if (i == SCR_ERR_DOMEX) continue;
    const char *n = scr_error_names[i];
    if (name->len == strlen(n) && memcmp(name->data, n, name->len) == 0) {
      kind = i;
      break;
    }
  }
  ScrError *e = scr_error_alloc(kind);
  e->name = name;       /* ownership moves in (engine names may be custom) */
  e->message = message; /* ownership moves in */
  scr_throw_obj(e, &scr_error_retain_v, &scr_error_release_v,
                 scr_error_traced ? &scr_error_trace : NULL);
}

/* The stack-depth guard's cold arm (SCR_STACK_CHECK, scr_runtime.h). The
 * emitted prologue branches here when the frame has come within
 * SCR_STACK_MARGIN of the running stack's reservation floor.
 *
 * Node's message verbatim, thrown as a catchable RangeError down the ordinary
 * scr_throw_error_msg path every one of this runtime's other throws uses -- so
 * a typed catch sees it, `e.name` reads "RangeError" out of the kind table
 * above at no cost, and the exception cell is already per-fiber, which is why
 * there is no unwinding machinery here to build.
 *
 * Marked noinline so the caller keeps a load, a compare and a never-taken
 * forward branch, with the throw entirely out of line. */
#if defined(__GNUC__) || defined(__clang__)
__attribute__((noinline))
#endif
void scr_stack_exhausted(void) {
  scr_throw_error_msg(SCR_ERR_RANGE, "Maximum call stack size exceeded",
                      sizeof("Maximum call stack size exceeded") - 1);
}

/* The link-time margin agreement's definition USED TO LIVE HERE; it moved
 * to scr_stack_margin.c. Defining it in this unit made scr_error.c -- and
 * the eight mutually required units behind it -- a link dependency of every
 * TU that includes scr_runtime.h, which four hand-written C unit tests
 * could not pay. The file it moved to carries the rest of the reasoning. */
