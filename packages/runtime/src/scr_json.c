/* JSON + dynamic values (see scr_runtime.h for the API contract).
 *
 * - The ScrDyn dyn is the runtime shape of `unknown`: refcounted, owning
 *   its children; releasing the root frees the tree recursively.
 * - scr_json_parse is a full RFC 8259 recursive-descent parser: null/
 *   true/false, numbers (strtod after a strict grammar check — doubles
 *   only, like JS), strings with every escape including \uXXXX (encoded to
 *   UTF-8; surrogate pairs combine, lone surrogates become U+FFFD per house
 *   policy), arrays, objects (later duplicate keys win, like JS), and the
 *   four JSON whitespace characters. Syntax errors THROW catchable
 *   SyntaxError instances (the depth cap a RangeError, like V8's) whose
 *   messages are shaped like Node's V8 texts ("Unexpected end of JSON
 *   input", "Unexpected token 'x', \"...\" is not valid JSON") —
 *   APPROXIMATE message fidelity by design (SEMANTICS.md; e.name is exact,
 *   e.message is ours), pinned by the runtime C tests.
 * - scr_dyn_check_fail is the shared failure path of the compiler-emitted
 *   dynCheck builders: a TypeError instance carrying "expected <want> at
 *   <path>, got <kind>", thrown through the exception cell.
 *   scriptc-specific — JS `as` never checks anything (the headline
 *   divergence in SEMANTICS.md).
 * - ScrJsonBuf backs the compiler-emitted type-directed stringify
 *   serializers (and the error messages here).
 */
#include "scr_runtime.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* Live dyn-node count for the RC audit lane (-DSCR_RC_AUDIT); same contract
 * as scr_str_live_count in scr_string.c. */
#ifdef SCR_RC_AUDIT
static long scr_live_dyns = 0;
long scr_dyn_live_count(void) { return scr_live_dyns; }
#endif

static void scr_json_oom(void) {
  scr_trap("scriptc: out of memory\n");
}

/* ── output buffer ─────────────────────────────────────────────────────
 * The buffer IS a growing ScrStr allocation (data points at its data[]),
 * so scr_jb_finish hands the bytes over without a copy. A size hint
 * remembers the last finished capacity: a stringify loop allocates once
 * per document instead of doubling its way up every round.
 */

/* The ScrStr block behind a non-empty buffer. */
#define SCR_JB_STR(b) ((ScrStr *)((char *)(b)->data - offsetof(ScrStr, data)))

static size_t scr_jb_hint = 64;

void scr_jb_init(ScrJsonBuf *b) {
  b->data = NULL;
  b->len = 0;
  b->cap = 0;
  b->seen = NULL;
  b->seen_len = 0;
  b->seen_cap = 0;
}

static void scr_jb_grow(ScrJsonBuf *b, size_t need) {
  if (b->len + need <= b->cap) return;
  if (!b->data) { /* first allocation: len == 0 */
    size_t cap = scr_jb_hint >= need ? scr_jb_hint : need;
    ScrStr *s = scr_str_alloc_raw(0, cap);
    b->data = s->data;
    b->cap = s->cap; /* a reused spare block may be larger */
    return;
  }
  size_t cap = b->cap;
  while (cap < b->len + need) cap *= 2;
  ScrStr *s = scr_str_regrow(SCR_JB_STR(b), cap);
  b->data = s->data;
  b->cap = cap;
}

/* Abandon a buffer (parser error paths). */
static void scr_jb_dispose(ScrJsonBuf *b) {
  if (b->data) scr_str_release(SCR_JB_STR(b));
  free(b->seen);
  scr_jb_init(b);
}

void scr_jb_putc(ScrJsonBuf *b, char c) {
  scr_jb_grow(b, 1);
  b->data[b->len++] = c;
}

static void scr_jb_write(ScrJsonBuf *b, const char *s, size_t n) {
  scr_jb_grow(b, n);
  memcpy(b->data + b->len, s, n);
  b->len += n;
}

void scr_jb_puts(ScrJsonBuf *b, const char *s) { scr_jb_write(b, s, strlen(s)); }

void scr_jb_put_f64(ScrJsonBuf *b, double v) {
  /* JSON.stringify number rules: non-finite → null, -0 → "0" (String(-0)
   * is "0" too, so scr_f64_to_str would agree — the zero test just makes
   * the rule explicit), else shortest-roundtrip digits. */
  if (!isfinite(v)) {
    scr_jb_puts(b, "null");
    return;
  }
  if (v == 0) {
    scr_jb_putc(b, '0');
    return;
  }
  char buf[32];
  size_t n = scr_f64_to_str(v, buf);
  scr_jb_write(b, buf, n);
}

void scr_jb_put_json_str(ScrJsonBuf *b, const ScrStr *s) {
  scr_jb_putc(b, '"');
  /* Bulk-copy runs of unescaped bytes (UTF-8 passes through verbatim,
   * like JS); escapes interrupt the run. */
  size_t i = 0, run = 0;
  while (i + run < s->len) {
    unsigned char c = (unsigned char)s->data[i + run];
    if (c != '"' && c != '\\' && c >= 0x20) {
      run++;
      continue;
    }
    scr_jb_write(b, s->data + i, run);
    switch (c) {
    case '"': scr_jb_puts(b, "\\\""); break;
    case '\\': scr_jb_puts(b, "\\\\"); break;
    case '\n': scr_jb_puts(b, "\\n"); break;
    case '\r': scr_jb_puts(b, "\\r"); break;
    case '\t': scr_jb_puts(b, "\\t"); break;
    case '\b': scr_jb_puts(b, "\\b"); break;
    case '\f': scr_jb_puts(b, "\\f"); break;
    default: {
      char esc[8];
      snprintf(esc, sizeof esc, "\\u%04x", c);
      scr_jb_puts(b, esc);
    }
    }
    i += run + 1;
    run = 0;
  }
  scr_jb_write(b, s->data + i, run);
  scr_jb_putc(b, '"');
}

ScrStr *scr_jb_finish(ScrJsonBuf *b) {
  free(b->seen);
  b->seen = NULL;
  b->seen_len = 0;
  b->seen_cap = 0;
  if (!b->data) return scr_str_new("", 0);
  ScrStr *s = SCR_JB_STR(b);
  s->len = b->len;
  s->data[b->len] = '\0';
  /* Remember the size class for the next buffer (bounded so one giant
   * document cannot pin big allocations forever). */
  if (s->cap > scr_jb_hint) scr_jb_hint = s->cap < (1 << 16) ? s->cap : (1 << 16);
  scr_jb_init(b);
  return s;
}

/* ── circular-structure detection ──────────────────────────────────────
 * RECURSIVE record types permit runtime reference cycles; JSON.stringify
 * of a cyclic value throws V8's exact TypeError. The compiler-emitted
 * walkers over cycle-CAPABLE containers (records whose shape carries a
 * collector header, arrays of them, tuple shapes alike) bracket their
 * bodies with enter/leave and stamp the current member edge before each
 * cycle-capable member write; everything acyclic pays nothing. Detection
 * is STACK membership (a DAG serializes the shared subtree twice, exactly
 * like Node — only a path back to an ancestor is circular).
 *
 * The message mirrors V8's ConstructCircularStructureErrorMessage byte
 * for byte: the starting object (where the repeat lands), one line per
 * hop from it to the top of the stack ("property 'x' -> object with
 * constructor 'Y'" / "index N -> ..."), the middle elided as "..." when
 * there are more than three hops (first two + last one shown), and the
 * closing edge. Constructor names are exactly 'Object'/'Array' — the only
 * containers JSON-safe types admit. */
typedef struct ScrJsonSeenEnt {
  const void *ptr;
  bool is_array;
  const char *prop;       /* static property edge (emitted C literal) */
  const ScrStr *prop_str; /* overflow-key edge (borrowed for the write) */
  size_t index;           /* array/tuple index edge */
} ScrJsonSeenEnt;

static void scr_jb_put_edge(ScrJsonBuf *m, const ScrJsonSeenEnt *e) {
  if (e->prop || e->prop_str) {
    scr_jb_puts(m, "property '");
    if (e->prop) scr_jb_puts(m, e->prop);
    else scr_jb_write(m, e->prop_str->data, e->prop_str->len);
    scr_jb_putc(m, '\'');
    return;
  }
  scr_jb_puts(m, "index ");
  scr_jb_put_f64(m, (double)e->index);
}

static void scr_jb_put_ctor(ScrJsonBuf *m, bool is_array) {
  scr_jb_puts(m, is_array ? "object with constructor 'Array'" : "object with constructor 'Object'");
}

bool scr_jb_enter(ScrJsonBuf *b, const void *v, bool is_array) {
  for (size_t i = 0; i < b->seen_len; i++) {
    if (b->seen[i].ptr != v) continue;
    ScrJsonBuf m;
    scr_jb_init(&m);
    scr_jb_puts(&m, "Converting circular structure to JSON\n    --> starting at ");
    scr_jb_put_ctor(&m, b->seen[i].is_array);
    const size_t n = b->seen_len;
    const size_t hops = n - 1 - i; /* intermediate lines (j = i+1 .. n-1) */
    for (size_t j = i + 1; j < n; j++) {
      if (hops > 3 && j - (i + 1) == 2) {
        scr_jb_puts(&m, "\n    |     ...");
        j = n - 2; /* the loop increment lands on the LAST hop */
        continue;
      }
      scr_jb_puts(&m, "\n    |     ");
      scr_jb_put_edge(&m, &b->seen[j - 1]);
      scr_jb_puts(&m, " -> ");
      scr_jb_put_ctor(&m, b->seen[j].is_array);
    }
    scr_jb_puts(&m, "\n    --- ");
    scr_jb_put_edge(&m, &b->seen[n - 1]);
    scr_jb_puts(&m, " closes the circle");
    scr_throw_error(SCR_ERR_TYPE, scr_jb_finish(&m));
    return false;
  }
  if (b->seen_len == b->seen_cap) {
    size_t cap = b->seen_cap ? b->seen_cap * 2 : 8;
    ScrJsonSeenEnt *grown = realloc(b->seen, cap * sizeof *grown);
    if (!grown) scr_json_oom();
    b->seen = grown;
    b->seen_cap = cap;
  }
  ScrJsonSeenEnt *e = &b->seen[b->seen_len++];
  e->ptr = v;
  e->is_array = is_array;
  e->prop = NULL;
  e->prop_str = NULL;
  e->index = 0;
  return true;
}

void scr_jb_leave(ScrJsonBuf *b) {
  if (b->seen_len > 0) b->seen_len--;
}

void scr_jb_edge_prop(ScrJsonBuf *b, const char *name) {
  ScrJsonSeenEnt *e = &b->seen[b->seen_len - 1];
  e->prop = name;
  e->prop_str = NULL;
}

void scr_jb_edge_key(ScrJsonBuf *b, const ScrStr *key) {
  ScrJsonSeenEnt *e = &b->seen[b->seen_len - 1];
  e->prop = NULL;
  e->prop_str = key;
}

void scr_jb_edge_idx(ScrJsonBuf *b, size_t i) {
  ScrJsonSeenEnt *e = &b->seen[b->seen_len - 1];
  e->prop = NULL;
  e->prop_str = NULL;
  e->index = i;
}

/* ── circular guard for the typed→dyn converters (sc_td_*) ────────────
 * A recursive-typed value crossing into a checked-dynamic slot DEEP-
 * COPIES into the checked-dynamic tree; a cyclic value has no finite copy. Node never
 * copies (an unknown-typed binding shares the reference), so there is no
 * Node-exact error to throw — the conversion TRAPS loudly instead
 * (SEMANTICS.md documents the divergence). The emitted converters over
 * cycle-capable containers bracket their walks with enter/leave; the
 * stack is global (conversions never interleave). */
static const void **g_td_seen;
static size_t g_td_nseen;
static size_t g_td_cap;

void scr_dyn_from_enter(const void *v) {
  for (size_t i = 0; i < g_td_nseen; i++) {
    if (g_td_seen[i] == v) {
      scr_trap("scriptc: cannot convert a circular structure into a checked-dynamic value "
               "(unknown-typed slots deep-copy; break the cycle first)\n");
    }
  }
  if (g_td_nseen == g_td_cap) {
    g_td_cap = g_td_cap ? g_td_cap * 2 : 8;
    const void **grown = realloc(g_td_seen, g_td_cap * sizeof *grown);
    if (!grown) scr_json_oom();
    g_td_seen = grown;
  }
  g_td_seen[g_td_nseen++] = v;
}

void scr_dyn_from_leave(void) {
  if (g_td_nseen > 0) g_td_nseen--;
}

/* ── dyn lifecycle ─────────────────────────────────────────────────────
 * Parse/release churn (a JSON round-trip loop allocates and frees every
 * node each iteration) runs on freelists instead of calloc/free: one list
 * per shape so arr/obj nodes keep their items/entries buffer across
 * reuse — a loop re-parsing the same document shape stops calling malloc
 * altogether. The freelist link overlays v.arr.len (first union word), so
 * a recycled arr/obj node's buffer and capacity survive intact. Disabled
 * in the audit lane so ASan sees real frees and the live count stays a
 * strict alloc/free balance.
 */
#ifndef SCR_RC_AUDIT
static ScrDyn *scr_dyn_free_arr, *scr_dyn_free_obj, *scr_dyn_free_misc;
static size_t scr_dyn_free_count;
#define SCR_DYN_FREE_MAX 8192
#endif

static ScrDyn *scr_dyn_alloc(ScrDynKind kind) {
#ifndef SCR_RC_AUDIT
  ScrDyn **list = kind == SCR_DYN_ARR   ? &scr_dyn_free_arr
                  : kind == SCR_DYN_OBJ ? &scr_dyn_free_obj
                                        : &scr_dyn_free_misc;
  ScrDyn *d = *list;
  if (d) {
    *list = (ScrDyn *)d->v.str; /* freelist link */
    scr_dyn_free_count--;
    d->rc = 1;
    d->kind = kind;
    d->buffer = false;
    d->null_proto = false;
    if (kind == SCR_DYN_ARR) {
      d->v.arr.len = 0; /* cap/items preserved from the node's last life */
    } else if (kind == SCR_DYN_OBJ) {
      d->v.obj.len = 0; /* cap/entries preserved */
      d->v.obj.proto = NULL; /* release already cleared all three; belt and braces */
      d->v.obj.cname = NULL;
      d->v.obj.accessors = NULL;
    } else {
      memset(&d->v, 0, sizeof d->v);
    }
    return d;
  }
#endif
  ScrDyn *fresh = calloc(1, sizeof *fresh);
  if (!fresh) scr_json_oom();
  fresh->rc = 1;
  fresh->kind = kind;
#ifdef SCR_RC_AUDIT
  scr_live_dyns++;
#endif
  return fresh;
}

static void scr_dyn_handle_release(void *h, ScrDynHandleTag tag);

void scr_dyn_release(ScrDyn *d) {
  if (!d || d->rc == SIZE_MAX) return; /* NULL: an uninitialized `let` local */
  if (--d->rc != 0) return;
  switch (d->kind) {
  case SCR_DYN_STR:
    scr_str_release(d->v.str);
    break;
  case SCR_DYN_BYTES:
    scr_bytes_release(d->v.bytes);
    break;
  case SCR_DYN_ARR:
    for (size_t i = 0; i < d->v.arr.len; i++) scr_dyn_release(d->v.arr.items[i]);
    break;
  case SCR_DYN_OBJ:
    for (size_t i = 0; i < d->v.obj.len; i++) {
      free(d->v.obj.entries[i].key);
      scr_dyn_release(d->v.obj.entries[i].value);
    }
    /* The [[Prototype]] link and the ACCESSOR table are owned; the
     * constructor NAME is a static literal. All three are cleared because
     * the node may be recycled below with its entries buffer intact — a
     * recycled node must not inherit the chain (or the getters) of its
     * previous life. */
    scr_dyn_release(d->v.obj.proto);
    d->v.obj.proto = NULL;
    d->v.obj.cname = NULL;
    scr_dyn_release(d->v.obj.accessors);
    d->v.obj.accessors = NULL;
    break;
  case SCR_DYN_FUNC:
    scr_closure_release(d->v.fn.clo); /* sig/name are static literals */
    break;
  case SCR_DYN_HANDLE:
    scr_dyn_handle_release(d->v.handle.ptr, d->v.handle.tag);
    break;
  case SCR_DYN_PROMISE:
    /* Installed by scr_dyn_alloc_promise (the gated boxes are the only
     * constructors) — a promise-free link (the runtime unit tests bind
     * scr_json.c without the fiber machinery) never references it. */
    scr_dyn_promise_release_fn(d->v.promise);
    break;
  case SCR_DYN_JSVAL:
    /* Installed by scr_dyn_alloc_jsval (the gated constructor is the
     * only producer) — same story as the promise arm. */
    scr_dyn_jsval_ops()->release(d->v.jsval.cell);
    break;
  default:
    break; /* null/bool/num have no children */
  }
#ifdef SCR_RC_AUDIT
  scr_live_dyns--;
#endif
#ifndef SCR_RC_AUDIT
  if (scr_dyn_free_count < SCR_DYN_FREE_MAX) {
    ScrDyn **list = d->kind == SCR_DYN_ARR   ? &scr_dyn_free_arr
                    : d->kind == SCR_DYN_OBJ ? &scr_dyn_free_obj
                                             : &scr_dyn_free_misc;
    d->v.str = (ScrStr *)*list; /* overlays arr/obj len; buffer survives */
    *list = d;
    scr_dyn_free_count++;
    return;
  }
#endif
  if (d->kind == SCR_DYN_ARR) free(d->v.arr.items);
  else if (d->kind == SCR_DYN_OBJ) free(d->v.obj.entries);
  free(d);
}

ScrDyn *scr_dyn_obj_get(const ScrDyn *d, const char *key, size_t key_len) {
  for (size_t i = 0; i < d->v.obj.len; i++) {
    const ScrDynEntry *e = &d->v.obj.entries[i];
    if (e->key_len == key_len && memcmp(e->key, key, key_len) == 0) return e->value;
  }
  return NULL;
}

/* The rest of JS's [[Get]]: the caller has already missed on `d`'s OWN
 * members, so continue up the [[Prototype]] links. BORROWED, or NULL when
 * the chain runs out.
 *
 * The step limit is not a policy, it is a liveness guarantee: nothing in
 * the compiled surface can build a cyclic chain today (only `new` sets a
 * link, and it links to a prototype object that cannot be an instance of
 * itself), but a lookup is not the place to discover that assumption
 * broke — a bounded walk answers "absent" where an unbounded one hangs. */
#define SCR_PROTO_MAX_DEPTH 1000
ScrDyn *scr_dyn_proto_get(const ScrDyn *d, const char *key, size_t key_len) {
  if (d->kind != SCR_DYN_OBJ) return NULL;
  const ScrDyn *p = d->v.obj.proto;
  for (size_t steps = 0; p != NULL && steps < SCR_PROTO_MAX_DEPTH; steps++) {
    if (p->kind != SCR_DYN_OBJ) return NULL;
    ScrDyn *m = scr_dyn_obj_get(p, key, key_len);
    if (m != NULL) return m;
    p = p->v.obj.proto;
  }
  return NULL;
}

/* True when the chain above `d` reaches a prototype object that a
 * FUNCTION value minted (scr_dyn_fn_prototype) — the one place where
 * Node has a `constructor` member and this runtime deliberately does
 * not. Used to turn that read into a loud fence instead of undefined. */
bool scr_dyn_proto_chain_is_fn_pub(const ScrDyn *d) {
  if (d->kind != SCR_DYN_OBJ) return false;
  const ScrDyn *p = d->v.obj.proto;
  for (size_t steps = 0; p != NULL && steps < SCR_PROTO_MAX_DEPTH; steps++) {
    if (p->kind != SCR_DYN_OBJ) return false;
    if (p->v.obj.cname != NULL) return true;
    p = p->v.obj.proto;
  }
  return false;
}

/* The `constructor` fence (see scr_dyn_fn_prototype's header): loud,
 * never a silent undefined. Throws; callers return NULL after. */
void scr_dyn_proto_ctor_fence(void) {
  static const char msg[] =
      "reading 'constructor' through a function's implicit prototype object is not supported yet"
      " (the implicit prototype carries no constructor back-link here: it would retain the"
      " function, which retains the prototype — a cycle reference counting cannot break;"
      " assign it explicitly, `F.prototype.constructor = F`, and the read answers exactly)";
  scr_throw_error_msg(SCR_ERR_ERROR, msg, sizeof msg - 1);
}

void scr_dyn_obj_set_proto(ScrDyn *obj, ScrDyn *proto) {
  if (obj->kind != SCR_DYN_OBJ) return;
  ScrDyn *prev = obj->v.obj.proto;
  obj->v.obj.proto = proto ? scr_dyn_retain(proto) : NULL;
  scr_dyn_release(prev);
}

/* Public: the compiler-emitted static→dyn converters push through this
 * too. Ownership of the item moves in. */
void scr_dyn_arr_push(ScrDyn *arr, ScrDyn *item) {
  if (arr->v.arr.len == arr->v.arr.cap) {
    size_t cap = arr->v.arr.cap ? arr->v.arr.cap * 2 : 4;
    ScrDyn **items = realloc(arr->v.arr.items, cap * sizeof *items);
    if (!items) scr_json_oom();
    arr->v.arr.items = items;
    arr->v.arr.cap = cap;
  }
  arr->v.arr.items[arr->v.arr.len++] = item; /* ownership moves in */
}

/* Spread completion for a runtime-arity argument list (`f(...xs)` in the
 * checked-dynamic tier): JS's spread over the checked-dynamic tree's iterable kinds —
 * arrays element-by-element (retained), strings by code POINT (the string
 * iterator; astral chars arrive unsplit), bytes by byte; every other kind
 * throws V8's exact SPREAD-CALL TypeError (catchable, pending — callers
 * check): nullish sources spell the spread expression (`what`) — "v is
 * not iterable (cannot read property undefined)" — and everything else is
 * the generic "Spread syntax requires ...iterable[Symbol.iterator] to be
 * a function". Borrows src. */
void scr_dyn_arr_push_spread(ScrDyn *arr, const ScrDyn *src, const char *what) {
  if (src->kind == SCR_DYN_ARR) {
    for (size_t i = 0; i < src->v.arr.len; i++) {
      scr_dyn_arr_push(arr, scr_dyn_retain(src->v.arr.items[i]));
    }
    return;
  }
  if (src->kind == SCR_DYN_BYTES) {
    for (size_t i = 0; i < src->v.bytes->len; i++) {
      scr_dyn_arr_push(arr, scr_dyn_new_num((double)src->v.bytes->data[i]));
    }
    return;
  }
  if (src->kind == SCR_DYN_STR) {
    double len = scr_str_utf16_len(src->v.str);
    for (double at = 0; at < len;) {
      ScrStr *cp = scr_str_cp_at(src->v.str, at);
      at += scr_str_utf16_len(cp);
      scr_dyn_arr_push(arr, scr_dyn_new_str(cp));
      scr_str_release(cp);
    }
    return;
  }
  if (src->kind == SCR_DYN_UNDEF || src->kind == SCR_DYN_NULL) {
    ScrJsonBuf b;
    scr_jb_init(&b);
    scr_jb_puts(&b, what);
    scr_jb_puts(&b, " is not iterable (cannot read property ");
    scr_jb_puts(&b, src->kind == SCR_DYN_UNDEF ? "undefined" : "null");
    scr_jb_puts(&b, ")");
    scr_throw_error(SCR_ERR_TYPE, scr_jb_finish(&b));
    return;
  }
  if (src->kind == SCR_DYN_JSVAL) {
    /* A wrapped engine value spreads through the ENGINE's own iterator
     * protocol (the routed iter_drain — Symbol.iterator implementations,
     * generators, Maps step exactly as Node runs them); a non-iterable
     * throws V8's spread-call text from the guard, an iterating throw
     * bridges with the engine's message. */
    ScrDyn *pack = scr_dyn_jsval_ops()->iter_drain(src->v.jsval.cell, true, NULL);
    if (!pack) return; /* pending */
    for (size_t i = 0; i < pack->v.arr.len; i++) {
      scr_dyn_arr_push(arr, scr_dyn_retain(pack->v.arr.items[i]));
    }
    scr_dyn_release(pack);
    return;
  }
  static const char msg[] = "Spread syntax requires ...iterable[Symbol.iterator] to be a function";
  scr_throw_error_msg(SCR_ERR_TYPE, msg, sizeof msg - 1);
}

/* Destructuring pack over a dyn source (`const [a, b] = d`, a destructured
 * dyn callback param): the spread walk's iterable kinds collect into a
 * FRESH array — arrays element-by-element (retained), strings by code
 * point, bytes by byte — and every other kind throws V8's DESTRUCTURING
 * TypeError: `msg` verbatim when non-empty (the compile-time spelling —
 * "v is not iterable" for identifier sources, "f is not a function or its
 * return value is not iterable" for identifier-callee calls), else the
 * runtime kind wording ("number 5 is not iterable (cannot read property
 * Symbol(Symbol.iterator))"; objects and functions carry no value text,
 * undefined no kind prefix, null V8's "object null"). Borrows both; +1 or
 * NULL with the TypeError pending. */
ScrDyn *scr_dyn_iter_pack(const ScrDyn *src, const ScrStr *msg) {
  if (src->kind == SCR_DYN_ARR || src->kind == SCR_DYN_BYTES || src->kind == SCR_DYN_STR) {
    ScrDyn *out = scr_dyn_new_arr();
    scr_dyn_arr_push_spread(out, src, ""); /* iterable kinds never consult `what` */
    return out;
  }
  /* A wrapped engine value packs through the ENGINE's own iterator
   * protocol (the routed iter_drain): elements wrap back scalar-
   * normalized; a non-iterable throws the destructuring kind wording
   * from the engine-side guard, an iterating throw bridges with the
   * engine's message. The compile-time spelling is not threaded through
   * (the engine's wording names the value's own kind). */
  if (src->kind == SCR_DYN_JSVAL) {
    return scr_dyn_jsval_ops()->iter_drain(src->v.jsval.cell, false, msg);
  }
  if (msg != NULL && msg->len > 0) {
    scr_throw_error(SCR_ERR_TYPE, scr_str_new(msg->data, msg->len));
    return NULL;
  }
  ScrJsonBuf b;
  scr_jb_init(&b);
  switch (src->kind) {
  case SCR_DYN_UNDEF: scr_jb_puts(&b, "undefined"); break;
  case SCR_DYN_NULL: scr_jb_puts(&b, "object null"); break;
  case SCR_DYN_BOOL: scr_jb_puts(&b, src->v.b ? "boolean true" : "boolean false"); break;
  case SCR_DYN_NUM: {
    char buf[32];
    scr_jb_puts(&b, "number ");
    size_t n = scr_f64_to_str(src->v.num, buf);
    scr_jb_write(&b, buf, n);
    break;
  }
  case SCR_DYN_FUNC: scr_jb_puts(&b, "function"); break;
  default: scr_jb_puts(&b, "object"); break;
  }
  scr_jb_puts(&b, " is not iterable (cannot read property Symbol(Symbol.iterator))");
  scr_throw_error(SCR_ERR_TYPE, scr_jb_finish(&b));
  return NULL;
}

/* The for-of-over-dyn pack accessors: the emitted index loop drives them
 * over a scr_dyn_iter_pack result (ARR by construction — the defensive
 * arms cover nothing reachable from that lowering). Never throw. */
double scr_dyn_arr_len(const ScrDyn *d) {
  return d->kind == SCR_DYN_ARR ? (double)d->v.arr.len : 0;
}
ScrDyn *scr_dyn_arr_at(const ScrDyn *d, double i) {
  if (d->kind != SCR_DYN_ARR || i < 0 || i >= (double)d->v.arr.len) {
    return scr_dyn_retain(scr_dyn_undefined());
  }
  return scr_dyn_retain(d->v.arr.items[(size_t)i]);
}

/* Takes ownership of key (malloc'd) and value. Duplicate keys: the LATER
 * value wins (like JS JSON.parse) — the old value is released and the new
 * key buffer freed (the surviving entry keeps its original, equal key). */
static void scr_dyn_obj_put(ScrDyn *obj, char *key, size_t key_len, ScrDyn *value) {
  for (size_t i = 0; i < obj->v.obj.len; i++) {
    ScrDynEntry *e = &obj->v.obj.entries[i];
    if (e->key_len == key_len && memcmp(e->key, key, key_len) == 0) {
      scr_dyn_release(e->value);
      e->value = value;
      free(key);
      return;
    }
  }
  if (obj->v.obj.len == obj->v.obj.cap) {
    size_t cap = obj->v.obj.cap ? obj->v.obj.cap * 2 : 4;
    ScrDynEntry *entries = realloc(obj->v.obj.entries, cap * sizeof *entries);
    if (!entries) scr_json_oom();
    obj->v.obj.entries = entries;
    obj->v.obj.cap = cap;
  }
  ScrDynEntry *e = &obj->v.obj.entries[obj->v.obj.len++];
  e->key = key;
  e->key_len = key_len;
  e->value = value;
}

/* ── dyn construction (compiler-emitted converters & overflow reads) ───── */

/* THE undefined value: one immortal node (rc == SIZE_MAX skips every
 * retain/release and the freelists never see it). */
ScrDyn *scr_dyn_undefined(void) {
  static ScrDyn undef = { SIZE_MAX, SCR_DYN_UNDEF, { false } };
  return &undef;
}

ScrDyn *scr_dyn_new_null(void) { return scr_dyn_alloc(SCR_DYN_NULL); }

ScrDyn *scr_dyn_new_bool(bool b) {
  ScrDyn *d = scr_dyn_alloc(SCR_DYN_BOOL);
  d->v.b = b;
  return d;
}

ScrDyn *scr_dyn_new_num(double n) {
  ScrDyn *d = scr_dyn_alloc(SCR_DYN_NUM);
  d->v.num = n;
  return d;
}

ScrDyn *scr_dyn_new_str(ScrStr *s) {
  ScrDyn *d = scr_dyn_alloc(SCR_DYN_STR);
  d->v.str = scr_str_retain(s);
  return d;
}

ScrDyn *scr_dyn_new_arr(void) { return scr_dyn_alloc(SCR_DYN_ARR); }

/* `new Array(n)` in the checked-dynamic tier — the spec's ArrayCreate. `n`
 * must be a valid array LENGTH (a non-negative integer below 2^32); NaN, a
 * fraction, a negative and 2^32 itself all throw V8's exact
 * `RangeError: Invalid array length`, which is catchable and pending on
 * return (callers check for NULL).
 *
 * The n slots read undefined. JS makes them HOLES and this tree makes them
 * the undefined value: the same stance scr_dyn_key_set's index growth
 * already took ("holes padding with undefined exactly like JS length
 * growth"), so length / index reads / join / JSON.stringify all answer
 * exactly and only the hole-vs-undefined observers (`i in a`,
 * Object.keys, forEach/map's skip) can tell. Returns +1. */
ScrDyn *scr_dyn_new_arr_len(double n) {
  if (!(n >= 0) || n > 4294967295.0 || n != (double)(uint32_t)n) {
    static const char msg[] = "Invalid array length";
    scr_throw_error_msg(SCR_ERR_RANGE, msg, sizeof msg - 1);
    return NULL;
  }
  ScrDyn *d = scr_dyn_alloc(SCR_DYN_ARR);
  size_t len = (size_t)n;
  /* One reservation instead of len doubling pushes: the length is known. */
  if (len > d->v.arr.cap) {
    ScrDyn **items = realloc(d->v.arr.items, len * sizeof *items);
    if (!items) scr_json_oom();
    d->v.arr.items = items;
    d->v.arr.cap = len;
  }
  for (size_t i = 0; i < len; i++) d->v.arr.items[i] = scr_dyn_retain(scr_dyn_undefined());
  d->v.arr.len = len;
  return d;
}

/* The ONE-argument `new Array(v)` dispatch. JS reads a single argument as a
 * LENGTH when it is a number and as the array's one ELEMENT otherwise
 * (`new Array('3')` is `['3']`, not three holes) — a fact about the runtime
 * VALUE, so a static type that does not decide it (an implicit-any binding)
 * has to ask here rather than guess. Borrows v (NULL is the absent
 * argument, i.e. undefined — the element form). +1, NULL with the
 * RangeError pending. */
ScrDyn *scr_dyn_new_arr_ctor1(ScrDyn *v) {
  if (v != NULL && v->kind == SCR_DYN_NUM) return scr_dyn_new_arr_len(v->v.num);
  ScrDyn *d = scr_dyn_alloc(SCR_DYN_ARR);
  scr_dyn_arr_push(d, scr_dyn_retain(v != NULL ? v : scr_dyn_undefined()));
  return d;
}

ScrDyn *scr_dyn_new_obj(void) { return scr_dyn_alloc(SCR_DYN_OBJ); }
ScrDyn *scr_dyn_new_obj_null_proto(void) {
  ScrDyn *d = scr_dyn_alloc(SCR_DYN_OBJ);
  d->null_proto = true;
  return d;
}

ScrDyn *scr_dyn_new_bytes_copy(const ScrBytes *b) {
  ScrDyn *d = scr_dyn_alloc(SCR_DYN_BYTES);
  d->v.bytes = scr_bytes_copy(b); /* the static→dyn boundary copies */
  return d;
}

ScrDyn *scr_dyn_new_buffer_copy(const ScrBytes *b) {
  ScrDyn *d = scr_dyn_new_bytes_copy(b);
  d->buffer = true;
  return d;
}

ScrBytes *scr_dyn_bytes_copy_out(const ScrDyn *d) {
  return scr_bytes_copy(d->v.bytes); /* extraction copies too (+1) */
}

/* ── the data-chunk encoding window (setEncoding) ─────────────────────
 * Node's readable setEncoding turns 'data' payloads into strings. The
 * delivery ABI carries bytes; the FIRING site (which owns the handle and
 * its encoding flag) opens a window around the listener pass and the
 * boxing helpers below answer string-flavored chunks inside it — the
 * ambient-receiver pattern, one flag instead of a threaded parameter.
 * Per-chunk utf8 decode: a multibyte character split across chunks does
 * not re-join (Node's StringDecoder holds the partial byte); ASCII-clean
 * bodies — the overwhelming test shape — are exact. */
static bool scr_dyn_chunk_utf8;
void scr_dyn_chunk_enc(bool utf8) { scr_dyn_chunk_utf8 = utf8; }

/* One 'data' payload as the dyn value the current window dictates:
 * a Buffer-flavored bytes box, or a string inside a setEncoding window. */
ScrDyn *scr_dyn_new_chunk(const ScrBytes *b) {
  if (scr_dyn_chunk_utf8) {
    ScrStr *s = scr_str_new((const char *)b->data, b->len);
    ScrDyn *d = scr_dyn_new_str(s);
    scr_str_release(s);
    return d;
  }
  return scr_dyn_new_buffer_copy(b);
}

/* A boxed static function value (the compiler's static→dyn converters).
 * Ownership of the closure MOVES in; sig/name are static literals. */
ScrDyn *scr_dyn_new_func(ScrClosure *clo, ScrDynThunk thunk, uint32_t arity, const char *sig, const char *name) {
  ScrDyn *d = scr_dyn_alloc(SCR_DYN_FUNC);
  d->v.fn.clo = clo;
  d->v.fn.thunk = thunk;
  d->v.fn.sig = sig;
  d->v.fn.name = name;
  d->v.fn.arity = arity;
  return d;
}

/* Calling a dyn value: kind check (Node's "<what> is not a function"
 * TypeError, catchable), then the boxed thunk — per-argument validation
 * into the closure's declared parameter types lives THERE (the thunk is
 * compiled per signature). Args borrowed; result owned (+1) or NULL with
 * the exception pending. */
ScrDyn *scr_dyn_call(const ScrDyn *d, ScrDyn *const *args, size_t argc, const char *what) {
  if (d->kind == SCR_DYN_JSVAL) {
    /* An ENGINE callee: the call routes through scr_jsval_call with the
     * uniform argument conversion (wrapped cells by reference, dyn data
     * deep-copied, FUNC boxes through the host shim); a non-callable
     * engine value throws the ENGINE's own TypeError, bridged catchably.
     * `what` is unused — the engine's message names the failure. */
    (void)what;
    return scr_dyn_jsval_ops()->call(d->v.jsval.cell, args, argc);
  }
  if (d->kind != SCR_DYN_FUNC) {
    ScrJsonBuf b;
    scr_jb_init(&b);
    scr_jb_puts(&b, what);
    scr_jb_puts(&b, " is not a function");
    scr_throw_error(SCR_ERR_TYPE, scr_jb_finish(&b));
    return NULL;
  }
  return d->v.fn.thunk(d->v.fn.clo, args, argc);
}

/* scr_dyn_call over a dyn ARRAY's elements — the spread-application form
 * (`f(...args)` after the emitted argument array is built). Borrows both;
 * result owned (+1), or NULL with the exception pending. */
ScrDyn *scr_dyn_apply(const ScrDyn *d, const ScrDyn *args, const char *what) {
  return scr_dyn_call(d, args->v.arr.items, args->v.arr.len, what);
}

/* ── native handles in the checked-dynamic tree (SCR_DYN_HANDLE) ───────────────────────
 * Per-tag ops stamped by the owning units at main() (scr_http_dyn_install
 * / scr_net_dyn_install — the scr_net_install hook story), so this
 * always-linked core never references gated units. A missing tag at use
 * is an internal error: emitted programs install a unit's ops whenever
 * they can box its handles. */
static const ScrDynHandleOps *scr_dynh_ops[SCR_DYNH_COUNT];

void scr_dyn_handle_install(ScrDynHandleTag tag, const ScrDynHandleOps *ops) {
  scr_dynh_ops[tag] = ops;
}

static const ScrDynHandleOps *scr_dyn_handle_ops(ScrDynHandleTag tag) {
  const ScrDynHandleOps *ops = scr_dynh_ops[tag];
  if (!ops) {
    scr_trap("scriptc: internal error: dyn handle ops not installed\n");
  }
  return ops;
}

/* The class display name for error texts ("IncomingMessage"); safe on
 * uninstalled tags (error paths render before anyone dispatches). */
const char *scr_dyn_handle_cls(const ScrDyn *d) {
  const ScrDynHandleOps *ops = scr_dynh_ops[d->v.handle.tag];
  return ops ? ops->cls : "object";
}

const ScrDynHandleOps *scr_dyn_handle_ops_of(const ScrDyn *d) {
  return scr_dyn_handle_ops(d->v.handle.tag);
}

/* errors.js's determineSpecificType over a dyn value — the "Received
 * ..." tail of Node's ERR_INVALID_ARG_TYPE messages. Renders into buf
 * when the shape needs a payload; returns the text either way. Lives
 * beside the dyn core (not the gated handle unit) because the always-
 * linked argument validators (bytes, fs) render through it too. */
const char *scr_dyn_specific_type(const ScrDyn *cb, char *detail, size_t cap) {
  const char *d = detail;
  switch (cb->kind) {
  case SCR_DYN_NULL: d = "null"; break;
  case SCR_DYN_UNDEF: d = "undefined"; break;
  case SCR_DYN_OBJ: d = "an instance of Object"; break;
  case SCR_DYN_ARR: d = "an instance of Array"; break;
  case SCR_DYN_BYTES: d = "an instance of Uint8Array"; break;
  case SCR_DYN_FUNC:
    /* determineSpecificType: `function ${value.name}` — anonymous
     * functions keep Node's trailing space. */
    snprintf(detail, cap, "function %s", cb->v.fn.name != NULL ? cb->v.fn.name : "");
    break;
  case SCR_DYN_HANDLE:
    snprintf(detail, cap, "an instance of %s", scr_dyn_handle_cls(cb));
    break;
  case SCR_DYN_PROMISE: d = "an instance of Promise"; break;
  case SCR_DYN_JSVAL:
    /* Engine-held: only objects/arrays/functions survive wrap-time scalar
     * normalization — pick by the engine's typeof. */
    d = scr_dyn_isl_typeof_is(cb, "function") ? "function" : "an instance of Object";
    break;
  case SCR_DYN_BOOL:
    snprintf(detail, cap, "type boolean (%s)", cb->v.b ? "true" : "false");
    break;
  case SCR_DYN_NUM: {
    char num[32];
    size_t n = scr_f64_to_str(cb->v.num, num);
    snprintf(detail, cap, "type number (%.*s)", (int)n, num);
    break;
  }
  case SCR_DYN_STR: {
    const ScrStr *sv = cb->v.str;
    char insp[32];
    size_t n = 0;
    insp[n++] = '\'';
    for (size_t i = 0; i < sv->len && n < 28; i++) insp[n++] = sv->data[i];
    if (sv->len + 2 > 28) {
      n = 25;
      memcpy(insp + n, "...", 3);
      n += 3;
    } else {
      insp[n++] = '\'';
    }
    snprintf(detail, cap, "type string (%.*s)", (int)n, insp);
    break;
  }
  default: d = "an instance of Object"; break;
  }
  return d;
}

/* Node's ERR_INVALID_ARG_TYPE thrower ("The \"chunk\" argument must be
 * of type string or an instance of Buffer or Uint8Array. Received type
 * number (5)") — the handle dispatchers' and argument validators'
 * per-arg gates. `expected` is the full "of type ..."/"an instance of
 * ..." clause. */
/* The compiler-resolved ERR_INVALID_ARG_TYPE throw with a RUNTIME-
 * rendered Received tail (error.argTypeThrow — the always-throwing
 * lowered arms whose offending value is not a literal). Borrows all
 * three; always throws catchably. */
void scr_throw_arg_type(const ScrStr *argname, const ScrStr *expected, const ScrDyn *got) {
  scr_dyn_arg_type_fail(argname->data, expected->data, got);
}

void scr_dyn_arg_type_fail(const char *argname, const char *expected, const ScrDyn *got) {
  char detail[64];
  const char *d = scr_dyn_specific_type(got, detail, sizeof detail);
  char msg[224];
  int len = snprintf(msg, sizeof msg,
                     "The \"%s\" argument must be %s. Received %s", argname, expected, d);
  scr_throw_error_msg_code(SCR_ERR_TYPE, msg, (size_t)len, "ERR_INVALID_ARG_TYPE");
}

/* The property flavor of the same ladder — Node renders option-bag
 * members as "The \"options.x\" property must be ..." (errors.js keys the
 * wording on the name, but every property-path caller here knows it is
 * one). Same runtime-rendered Received tail; always throws catchably. */
void scr_dyn_prop_type_fail(const char *name, const char *expected, const ScrDyn *got) {
  char detail[64];
  const char *d = scr_dyn_specific_type(got, detail, sizeof detail);
  char msg[224];
  int len = snprintf(msg, sizeof msg,
                     "The \"%s\" property must be %s. Received %s", name, expected, d);
  scr_throw_error_msg_code(SCR_ERR_TYPE, msg, (size_t)len, "ERR_INVALID_ARG_TYPE");
}

/* The compiler-resolved property-typed throw (error.propTypeThrow —
 * argTypeThrow's option-bag sibling). Borrows all three; always throws. */
void scr_throw_prop_type(const ScrStr *name, const ScrStr *expected, const ScrDyn *got) {
  scr_dyn_prop_type_fail(name->data, expected->data, got);
}

/* ERR_INVALID_ARG_VALUE's "Received" tail — util.inspect where ARG_TYPE
 * renders determineSpecificType: strings quote, scalars print plain.
 * Deep shapes render their bracket sketch (enough for the validators'
 * ladders; nothing observable pins the deep forms). */
const char *scr_dyn_inspect_lite(const ScrDyn *v, char *buf, size_t cap) {
  switch (v->kind) {
  case SCR_DYN_NULL: return "null";
  case SCR_DYN_UNDEF: return "undefined";
  case SCR_DYN_BOOL: return v->v.b ? "true" : "false";
  case SCR_DYN_NUM: {
    scr_f64_to_str(v->v.num, buf);
    return buf;
  }
  case SCR_DYN_STR: {
    const ScrStr *s = v->v.str;
    size_t n = 0;
    buf[n++] = '\'';
    for (size_t i = 0; i < s->len && n + 5 < cap; i++) buf[n++] = s->data[i];
    if (s->len + 2 + 5 > cap) {
      memcpy(buf + n, "...", 3);
      n += 3;
    }
    buf[n++] = '\'';
    buf[n] = 0;
    return buf;
  }
  case SCR_DYN_ARR: return "[ ... ]";
  case SCR_DYN_OBJ: return "{ ... }";
  case SCR_DYN_BYTES: return "<Buffer ...>";
  default: return "[object]";
  }
}

/* Node's ERR_INVALID_ARG_VALUE thrower: "The <argument|property> '<name>'
 * <reason>. Received <inspected>" — the argument/property choice follows
 * errors.js (a dotted name is a property path). `reason` defaults to
 * "is invalid" when NULL. TypeError, like Node's default. */
void scr_dyn_arg_value_fail(const char *name, const char *reason, const ScrDyn *got) {
  char insp[64];
  const char *d = scr_dyn_inspect_lite(got, insp, sizeof insp);
  char msg[256];
  int len = snprintf(msg, sizeof msg, "The %s '%s' %s. Received %s",
                     strchr(name, '.') != NULL ? "property" : "argument", name,
                     reason != NULL ? reason : "is invalid", d);
  scr_throw_error_msg_code(SCR_ERR_TYPE, msg, (size_t)len, "ERR_INVALID_ARG_VALUE");
}

/* The deferred JS lowering fence, thrown from a ladder's post-validation
 * tail: the compiler renders the message (the statement fence's own text,
 * "[SC2020 at file:line]" included) and the ladder throws it verbatim
 * AFTER its Node-order validations pass — Node's validation errors come
 * first, the honest refuse second. Borrowed; always throws catchably. */
void scr_throw_lowering_fence(const ScrStr *msg) {
  scr_throw_error_msg_code(SCR_ERR_ERROR, msg->data, msg->len, "SC2020");
}

static void scr_dyn_handle_release(void *h, ScrDynHandleTag tag) {
  scr_dyn_handle_ops(tag)->release(h);
}

ScrDyn *scr_dyn_new_handle(void *h, ScrDynHandleTag tag) {
  ScrDyn *d = scr_dyn_alloc(SCR_DYN_HANDLE);
  d->v.handle.ptr = scr_dyn_handle_ops(tag)->retain(h);
  d->v.handle.tag = tag;
  return d;
}

/* The gated promise boxes (scr_async_dyn.c) build through this thin
 * allocator view; the freelist stays private, and the release arm's
 * scr_promise_release edge installs HERE — a promise-free link never
 * references the fiber machinery (the unit-test subset links). */
void (*scr_dyn_promise_release_fn)(ScrPromise *p) = NULL;

ScrDyn *scr_dyn_alloc_promise(void (*release_fn)(ScrPromise *p)) {
  scr_dyn_promise_release_fn = release_fn;
  return scr_dyn_alloc(SCR_DYN_PROMISE);
}

/* ── island values in the checked-dynamic tree (SCR_DYN_JSVAL) ─────────────────────────
 * The gated constructor (scr_dyn_from_jsval, scr_island.c) builds through
 * this allocator view and installs the engine-routing ops — the
 * scr_dyn_alloc_promise story: a dynamic-free link never references
 * engine symbols, and JSVAL nodes exist only after an install. */
static const ScrDynJsvalOps *scr_dynjs_ops = NULL;

ScrDyn *scr_dyn_alloc_jsval(ScrJsval *cell, const ScrDynJsvalOps *ops) {
  scr_dynjs_ops = ops;
  ScrDyn *d = scr_dyn_alloc(SCR_DYN_JSVAL);
  d->v.jsval.cell = cell; /* ownership moves in */
  return d;
}

const ScrDynJsvalOps *scr_dyn_jsval_ops(void) {
  if (!scr_dynjs_ops) {
    scr_trap("scriptc: internal error: dyn jsval ops not installed\n");
  }
  return scr_dynjs_ops;
}

bool scr_dyn_isl_typeof_is(const ScrDyn *d, const char *name) {
  if (d->kind != SCR_DYN_JSVAL) return false;
  ScrStr *t = scr_dyn_jsval_ops()->type_of(d->v.jsval.cell);
  size_t n = strlen(name);
  bool r = t->len == n && memcmp(t->data, name, n) == 0;
  scr_str_release(t);
  return r;
}

bool scr_dyn_isl_is_array(const ScrDyn *d) {
  return d->kind == SCR_DYN_JSVAL && scr_dyn_jsval_ops()->is_array(d->v.jsval.cell);
}

bool scr_dyn_isl_is_error(const ScrDyn *d) {
  return d->kind == SCR_DYN_JSVAL && scr_dyn_jsval_ops()->is_error(d->v.jsval.cell);
}

bool scr_dyn_isl_fence(const ScrDyn *d, const char *what) {
  if (d->kind != SCR_DYN_JSVAL) return false;
  ScrJsonBuf b;
  scr_jb_init(&b);
  scr_jb_puts(&b, what);
  scr_jb_puts(&b, " on an island value held in 'unknown' is not supported yet");
  scr_throw_error(SCR_ERR_ERROR, scr_jb_finish(&b));
  return false;
}

ScrDyn *scr_dyn_isl_key_get(const ScrDyn *d, const ScrStr *k) {
  /* The emitted keyed read's JSVAL arm: o[k] runs in the ENGINE (getters
   * included, their throws bridged) and the result wraps back scalar-
   * normalized — the retired `.length -> fence` row (and before that,
   * the fence box's silent `.length -> 0`). */
  return scr_dyn_jsval_ops()->key_get(d->v.jsval.cell, k);
}

bool scr_dyn_is_nullish(const ScrDyn *d) {
  if (d->kind == SCR_DYN_UNDEF || d->kind == SCR_DYN_NULL) return true;
  /* JSVAL defensively routes to the engine's own test — the wrap
   * constructor scalar-normalizes engine null/undefined away, so this
   * arm answers false unless a producer bypassed it. */
  if (d->kind == SCR_DYN_JSVAL) return scr_dyn_jsval_ops()->is_nullish(d->v.jsval.cell);
  return false;
}

void scr_dyn_isl_tostr_buf(ScrJsonBuf *b, const ScrDyn *d) {
  ScrStr *s = scr_dyn_jsval_ops()->to_str(d->v.jsval.cell);
  if (!s) return; /* bridged — the exception is pending, append nothing */
  for (size_t i = 0; i < s->len; i++) scr_jb_putc(b, s->data[i]);
  scr_str_release(s);
}

void *scr_dyn_handle_unbox(const ScrDyn *d, ScrDynHandleTag tag, const ScrDynPath *path, const char *want) {
  if (d->kind != SCR_DYN_HANDLE || d->v.handle.tag != tag) {
    scr_dyn_check_fail(path, want, d);
    return NULL;
  }
  return scr_dyn_handle_ops(tag)->retain(d->v.handle.ptr);
}

ScrDyn *scr_dyn_handle_key_get(const ScrDyn *d, const ScrStr *k) {
  const ScrDynHandleOps *ops = scr_dyn_handle_ops(d->v.handle.tag);
  ScrDyn *r = ops->get(d->v.handle.ptr, k->data, k->len);
  if (scr_exc_pending()) {
    scr_dyn_release(r);
    return NULL;
  }
  /* Unmodeled names answer undefined — the checked-dynamic tree's own-property stance
   * (real-but-unmodeled members fence loudly inside ops->get instead;
   * SEMANTICS.md documents the remainder). */
  return r ? r : scr_dyn_retain(scr_dyn_undefined());
}

/* ── the ambient receiver (scr_runtime.h's design note) ───────────────
 * A strictly nested push/pop stack: firing sites bind the owner around
 * each listener call, dyn OBJ method dispatch binds the object, and the
 * emitted dyn.this read answers the innermost binding. Handle entries
 * are BORROWED (the firing site retains the owner across the call);
 * dyn entries are retained for the window. */
typedef struct {
  void *ptr;            /* handle entry (borrowed); NULL when dv or undefined */
  ScrDynHandleTag tag;
  ScrDyn *dv;           /* dyn entry (+1); NULL for handle/undefined entries */
} ScrDynThisEnt;

static ScrDynThisEnt *scr_dyn_this_stack;
static size_t scr_dyn_this_n, scr_dyn_this_cap;

static ScrDynThisEnt *scr_dyn_this_grow(void) {
  if (scr_dyn_this_n == scr_dyn_this_cap) {
    size_t cap = scr_dyn_this_cap ? scr_dyn_this_cap * 2 : 8;
    ScrDynThisEnt *s = realloc(scr_dyn_this_stack, cap * sizeof *s);
    if (!s) {
      scr_trap("scriptc: out of memory\n");
    }
    scr_dyn_this_stack = s;
    scr_dyn_this_cap = cap;
  }
  return &scr_dyn_this_stack[scr_dyn_this_n++];
}

void scr_dyn_this_push(void *h, ScrDynHandleTag tag) {
  ScrDynThisEnt *e = scr_dyn_this_grow();
  e->ptr = h;
  e->tag = tag;
  e->dv = NULL;
}

void scr_dyn_this_push_dyn(const ScrDyn *v) {
  ScrDynThisEnt *e = scr_dyn_this_grow();
  e->ptr = NULL;
  e->tag = 0;
  e->dv = scr_dyn_retain((ScrDyn *)v);
}

void scr_dyn_this_pop(void) {
  if (scr_dyn_this_n == 0) {
    scr_trap("scriptc: internal error: receiver stack underflow\n");
  }
  ScrDynThisEnt *e = &scr_dyn_this_stack[--scr_dyn_this_n];
  if (e->dv) scr_dyn_release(e->dv);
}

ScrDyn *scr_dyn_this_get(void) {
  if (scr_dyn_this_n > 0) {
    ScrDynThisEnt *e = &scr_dyn_this_stack[scr_dyn_this_n - 1];
    if (e->dv) return scr_dyn_retain(e->dv);
    /* An uninstalled tag never binds: a unit that fires without its dyn
     * half (no boxes can exist there) keeps the undefined answer. */
    if (e->ptr && scr_dynh_ops[e->tag]) return scr_dyn_new_handle(e->ptr, e->tag);
  }
  return scr_dyn_retain(scr_dyn_undefined());
}

/* The keyed-write arm (see scr_dyn_key_set): modeled setters land on the
 * handle; everything else fences loudly — Node would take a silent
 * expando, but expandos per BOX would break handle identity. */
static void scr_dyn_handle_key_set(ScrDyn *recv, ScrStr *key, ScrDyn *value) {
  const ScrDynHandleOps *ops = scr_dyn_handle_ops(recv->v.handle.tag);
  if (ops->set(recv->v.handle.ptr, key->data, key->len, value)) return;
  ScrJsonBuf b;
  scr_jb_init(&b);
  scr_jb_puts(&b, "setting '");
  for (size_t i = 0; i < key->len; i++) scr_jb_putc(&b, key->data[i]);
  scr_jb_puts(&b, "' on a dynamic ");
  scr_jb_puts(&b, ops->cls);
  scr_jb_puts(&b, " is not supported yet");
  scr_throw_error(SCR_ERR_ERROR, scr_jb_finish(&b));
}

/* Public obj insertion: COPIES the key bytes (the internal put takes a
 * malloc'd buffer), owns the value, later duplicate keys win. */
void scr_dyn_obj_set(ScrDyn *obj, const char *key, size_t key_len, ScrDyn *value) {
  char *copy = malloc(key_len + 1);
  if (!copy) scr_json_oom();
  memcpy(copy, key, key_len);
  copy[key_len] = '\0';
  scr_dyn_obj_put(obj, copy, key_len, value);
}

/* ToBoolean over a dyn value (`v || dflt`, `if (v)` on a dyn operand):
 * bool by value; number falsy exactly for 0, -0, and NaN; string falsy
 * exactly when empty; obj/arr/bytes/func always true; undefined and null
 * always false — JS-exact for every kind. Borrowed; never throws. */
bool scr_dyn_truthy(const ScrDyn *d) {
  switch (d->kind) {
  case SCR_DYN_BOOL: return d->v.b;
  case SCR_DYN_NUM: return d->v.num == d->v.num && d->v.num != 0;
  case SCR_DYN_STR: return d->v.str->len != 0;
  case SCR_DYN_OBJ:
  case SCR_DYN_ARR:
  case SCR_DYN_BYTES:
  case SCR_DYN_FUNC:
  case SCR_DYN_HANDLE:
  case SCR_DYN_PROMISE: return true;
  case SCR_DYN_JSVAL:
    /* Route to the engine's ToBoolean: objects/arrays/functions are
     * true, but the symbol/bigint edge (0n is falsy) needs the engine. */
    return scr_dyn_jsval_ops()->truthy(d->v.jsval.cell);
  default: return false; /* undefined, null */
  }
}

/* ── JS operator semantics over checked-dynamic operands ───────────────── */

/* True for the dyn kinds whose ToPrimitive is the IDENTITY — every
 * primitive. The reference kinds answer false: their ToPrimitive calls a
 * user valueOf/toString, and the dyn model holds no prototype chain to
 * call one from, so the operators below refuse them loudly instead of
 * guessing (a guess there would be the silent wrong value the whole
 * checked-dynamic tier exists to avoid). */
static bool scr_dyn_is_prim(const ScrDyn *d) {
  if (!d) return false;
  switch (d->kind) {
  case SCR_DYN_NUM:
  case SCR_DYN_STR:
  case SCR_DYN_BOOL:
  case SCR_DYN_NULL:
  case SCR_DYN_UNDEF: return true;
  default: return false;
  }
}

/* ToNumber (ECMA-262 7.1.4) over a dyn value — the numeric sibling of
 * scr_dyn_truthy (ToBoolean) and scr_dyn_string_coerce (ToString), and the
 * conversion every arithmetic, bitwise and relational operator performs on
 * an untyped operand before it computes:
 *
 *   number     itself                      string     StringToNumber
 *   boolean    1 / 0                       null       +0
 *   undefined  NaN
 *
 * ToInt32/ToUint32 (the bitwise six) are this followed by the truncating
 * wrap the f64 nodes already perform, so they need nothing further.
 * Borrowed; throws (scr_exc_pending) only on the reference kinds, with the
 * same "expected number at $, got <kind>" text as the checked cast this
 * replaces — the loud half of the old behaviour, kept exactly where the
 * value really is unknowable. */
double scr_dyn_to_number(const ScrDyn *d) {
  if (d) {
    switch (d->kind) {
    case SCR_DYN_NUM: return d->v.num;
    case SCR_DYN_STR: return scr_string_to_number(d->v.str);
    case SCR_DYN_BOOL: return d->v.b ? 1.0 : 0.0;
    case SCR_DYN_NULL: return 0.0;
    case SCR_DYN_UNDEF: return (double)NAN;
    default: break;
    }
  }
  scr_dyn_check_fail(NULL, "number", d);
  return (double)NAN;
}

/* JS `+` over two dyn operands (ECMA-262 13.15.3,
 * ApplyStringOrNumericBinaryOperator with opText "+"): ToPrimitive both
 * with no hint, then EITHER side being a String makes the operator
 * CONCATENATION of the two ToString results, and only otherwise is it
 * ToNumber addition. `+` is the one arithmetic operator that is not a
 * number context, which is why it cannot be a checked cast to number and
 * why its result KIND is decided here rather than by the compiler.
 * Borrows both; +1 result, or NULL with the exception pending when either
 * side is a reference kind. */
ScrDyn *scr_dyn_add(const ScrDyn *a, const ScrDyn *b) {
  if (!scr_dyn_is_prim(a)) {
    scr_dyn_check_fail(NULL, "a number or a string", a);
    return NULL;
  }
  if (!scr_dyn_is_prim(b)) {
    scr_dyn_check_fail(NULL, "a number or a string", b);
    return NULL;
  }
  if (a->kind == SCR_DYN_STR || b->kind == SCR_DYN_STR) {
    /* scr_dyn_string_coerce is String() over the kind — the units render
     * "null"/"undefined" instead of throwing, which is exactly what `+`
     * asks for ('' + undefined is 'undefined'). */
    ScrStr *ls = scr_dyn_string_coerce(a);
    ScrStr *rs = scr_dyn_string_coerce(b);
    ScrStr *cat = scr_str_concat(ls, rs);
    scr_str_release(ls);
    scr_str_release(rs);
    ScrDyn *out = scr_dyn_new_str(cat); /* retains cat into the node */
    scr_str_release(cat);
    return out;
  }
  return scr_dyn_new_num(scr_dyn_to_number(a) + scr_dyn_to_number(b));
}

/* Abstract relational comparison (ECMA-262 7.2.13 IsLessThan) over two dyn
 * operands: both sides ToPrimitive with the number hint, and when BOTH
 * results are strings the answer is the STRING ordering — `'a' < 'b'` is
 * not a number question — otherwise both go through ToNumber and an
 * unordered (NaN) result answers false for all four operators.
 *
 * String ordering is scr_str_cmp, scriptc's documented code-point order:
 * the same order the statically-typed `<` on strings already uses (the
 * strCmp node without `utf16`), so the two spellings of one comparison
 * agree with each other and carry one documented divergence between them,
 * not two. Borrows; throws only on the reference kinds. */
static bool scr_dyn_rel(const ScrDyn *a, const ScrDyn *b, int op) {
  int c;
  if (!scr_dyn_is_prim(a)) {
    scr_dyn_check_fail(NULL, "a number or a string", a);
    return false;
  }
  if (!scr_dyn_is_prim(b)) {
    scr_dyn_check_fail(NULL, "a number or a string", b);
    return false;
  }
  if (a->kind == SCR_DYN_STR && b->kind == SCR_DYN_STR) {
    c = scr_str_cmp(a->v.str, b->v.str);
    c = c < 0 ? -1 : (c > 0 ? 1 : 0);
  } else {
    double x = scr_dyn_to_number(a);
    double y = scr_dyn_to_number(b);
    if (x != x || y != y) return false; /* NaN: every relational op is false */
    c = x < y ? -1 : (x > y ? 1 : 0);   /* ±0 compare equal, like JS */
  }
  switch (op) {
  case 0: return c < 0;   /* <  */
  case 1: return c <= 0;  /* <= */
  case 2: return c > 0;   /* >  */
  default: return c >= 0; /* >= */
  }
}

/* One entry point per operator, so the emitted call needs no synthesized
 * constant argument and both backends map it by name alone. */
bool scr_dyn_lt(const ScrDyn *a, const ScrDyn *b) { return scr_dyn_rel(a, b, 0); }
bool scr_dyn_le(const ScrDyn *a, const ScrDyn *b) { return scr_dyn_rel(a, b, 1); }
bool scr_dyn_gt(const ScrDyn *a, const ScrDyn *b) { return scr_dyn_rel(a, b, 2); }
bool scr_dyn_ge(const ScrDyn *a, const ScrDyn *b) { return scr_dyn_rel(a, b, 3); }

/* Bare `typeof v` on a dyn value: the dyn kind's JS answer (+1 string).
 * null answers "object" — JS's oldest wart, preserved. */
ScrStr *scr_dyn_typeof(const ScrDyn *d) {
  const char *s;
  /* An island value answers the ENGINE's typeof — "object" for the
   * wrapped objects/arrays, "function" for engine functions (row 1 of
   * the jsval→dyn op table; scalars normalized away at wrap time). */
  if (d->kind == SCR_DYN_JSVAL) return scr_dyn_jsval_ops()->type_of(d->v.jsval.cell);
  switch (d->kind) {
  case SCR_DYN_UNDEF: s = "undefined"; break;
  case SCR_DYN_NULL:
  case SCR_DYN_OBJ:
  case SCR_DYN_ARR:
  case SCR_DYN_BYTES:
  case SCR_DYN_HANDLE:
  case SCR_DYN_PROMISE: s = "object"; break;
  case SCR_DYN_BOOL: s = "boolean"; break;
  case SCR_DYN_NUM: s = "number"; break;
  case SCR_DYN_STR: s = "string"; break;
  case SCR_DYN_FUNC: s = "function"; break;
  default: s = "undefined"; break;
  }
  return scr_str_new(s, strlen(s));
}

/* ── JS own-key order over a checked-dynamic object ───────────────────
 *
 * OrdinaryOwnPropertyKeys (ECMA-262 10.1.11.1) is not insertion order.
 * The ARRAY-INDEX keys come first, ascending by numeric value; every
 * other string key follows in insertion order. The entry table stores
 * pure insertion order, so JS's order is a PROJECTION of it, computed
 * here — once, in one helper, so that every own-key enumeration in this
 * runtime answers the same order.
 *
 * It did not used to be one helper. `Object.keys` carried a private copy
 * of this walk and `JSON.stringify`, `util.format`'s `%j` and
 * `util.inspect` carried none, so three of them disagreed with the
 * fourth about the same object inside the same process — silently, on
 * exactly the shape protobufjs builds its enum tables out of
 * (`{0:"E2EE",1:"HOSTED"}`).
 *
 * The array-index test is the spec's, not "looks numeric": a canonical
 * decimal string with no leading zero, strictly BELOW 2^32-1. So "0" and
 * "4294967294" sort ahead; "4294967295" (the boundary itself), "01",
 * "-1", "1.5" and "4294967296" are ordinary string keys and hold their
 * insertion slot. Verified against Node v25.9.0.
 *
 * Answers NULL when the stored order ALREADY IS the JS order — no index
 * keys, or they lead the table and ascend. That is the overwhelmingly
 * common case and it costs one scan and no allocation. Otherwise the
 * result is a malloc'd permutation of `len` entry indices that the
 * caller frees. */
static bool scr_dyn_key_is_index(const char *key, size_t len, double *out);

typedef struct {
  double idx;
  size_t pos;
  bool is_index;
} ScrKeyOrd;

/* A total order: index keys before string keys, index keys by value,
 * string keys by insertion slot. Both index values and slots are
 * distinct by construction (an entry table cannot hold a duplicate key),
 * so no two elements compare equal and qsort needs no stability. */
static int scr_key_ord_cmp(const void *a, const void *b) {
  const ScrKeyOrd *x = (const ScrKeyOrd *)a;
  const ScrKeyOrd *y = (const ScrKeyOrd *)b;
  if (x->is_index != y->is_index) return x->is_index ? -1 : 1;
  if (x->is_index) return x->idx < y->idx ? -1 : 1;
  return x->pos < y->pos ? -1 : 1;
}

size_t *scr_dyn_obj_key_order(const ScrDyn *v) {
  if (v->kind != SCR_DYN_OBJ) return NULL;
  size_t n = v->v.obj.len;
  if (n < 2) return NULL;
  /* Pass 1 — allocation-free: does the stored order need reordering at
   * all? It does exactly when an index key follows a string key, or when
   * two index keys are out of ascending order. */
  bool seen_string = false, need = false;
  double last = -1, idx = 0;
  for (size_t i = 0; i < n; i++) {
    const ScrDynEntry *e = &v->v.obj.entries[i];
    if (!scr_dyn_key_is_index(e->key, e->key_len, &idx)) {
      seen_string = true;
      continue;
    }
    if (seen_string || idx < last) need = true;
    last = idx;
  }
  if (!need) return NULL;
  ScrKeyOrd *k = (ScrKeyOrd *)malloc(n * sizeof *k);
  if (!k) scr_json_oom();
  for (size_t i = 0; i < n; i++) {
    const ScrDynEntry *e = &v->v.obj.entries[i];
    k[i].pos = i;
    k[i].idx = 0;
    k[i].is_index = scr_dyn_key_is_index(e->key, e->key_len, &k[i].idx);
  }
  qsort(k, n, sizeof *k, scr_key_ord_cmp);
  size_t *order = (size_t *)malloc(n * sizeof *order);
  if (!order) scr_json_oom();
  for (size_t i = 0; i < n; i++) order[i] = k[i].pos;
  free(k);
  return order;
}

/* ── JSON.stringify over a dyn value (util.format's %j) ───────────────
 * The RUNTIME walk the type-directed serializers deliberately avoid for
 * static values — a dyn value has no static type, so the checked-dynamic tree's own kinds
 * drive it, JS-exactly: objects in JS OWN-KEY order (scr_dyn_obj_key_order —
 * index keys first, not insertion order) with undefined/function
 * members OMITTED, arrays rendering those as null, Buffer's toJSON shape
 * ({"type":"Buffer","data":[...]}), shortest-roundtrip numbers, escaped
 * strings. HANDLE values fence loudly (Node walks own enumerable props
 * this runtime does not model). Returns false when the VALUE ITSELF is
 * absent under stringify (root undefined/function — %j prints
 * "undefined" there, Node's tryStringify tail). */
static bool scr_dyn_json_write(ScrJsonBuf *b, const ScrDyn *d) {
  switch (d->kind) {
  case SCR_DYN_UNDEF:
  case SCR_DYN_FUNC:
    return false;
  case SCR_DYN_NULL: scr_jb_puts(b, "null"); return true;
  case SCR_DYN_BOOL: scr_jb_puts(b, d->v.b ? "true" : "false"); return true;
  case SCR_DYN_NUM: scr_jb_put_f64(b, d->v.num); return true;
  case SCR_DYN_STR: scr_jb_put_json_str(b, d->v.str); return true;
  case SCR_DYN_ARR: {
    scr_jb_putc(b, '[');
    for (size_t i = 0; i < d->v.arr.len; i++) {
      if (i > 0) scr_jb_putc(b, ',');
      if (!scr_dyn_json_write(b, d->v.arr.items[i])) scr_jb_puts(b, "null");
    }
    scr_jb_putc(b, ']');
    return true;
  }
  case SCR_DYN_OBJ: {
    scr_jb_putc(b, '{');
    bool first = true;
    size_t *ord = scr_dyn_obj_key_order(d); /* JS own-key order, NULL when stored order is it */
    for (size_t oi = 0; oi < d->v.obj.len; oi++) {
      const ScrDynEntry *ent = &d->v.obj.entries[ord ? ord[oi] : oi];
      ScrJsonBuf probe;
      scr_jb_init(&probe);
      if (!scr_dyn_json_write(&probe, ent->value)) {
        scr_jb_dispose(&probe);
        continue; /* undefined/function members drop, like Node */
      }
      if (!first) scr_jb_putc(b, ',');
      first = false;
      ScrStr *k = scr_str_new(ent->key, ent->key_len);
      scr_jb_put_json_str(b, k);
      scr_str_release(k);
      scr_jb_putc(b, ':');
      ScrStr *body = scr_jb_finish(&probe);
      scr_jb_write(b, body->data, body->len);
      scr_str_release(body);
    }
    free(ord);
    scr_jb_putc(b, '}');
    return true;
  }
  case SCR_DYN_BYTES: {
    /* Buffer/typed-array toJSON — Node's {"type":"Buffer","data":[...]}
     * for the Buffer flavor; a plain Uint8Array stringifies index-keyed
     * ({"0":1,...}), also Node. */
    const ScrBytes *bytes = d->v.bytes;
    if (d->buffer) scr_jb_puts(b, "{\"type\":\"Buffer\",\"data\":[");
    else scr_jb_putc(b, '{');
    for (size_t i = 0; i < bytes->len; i++) {
      if (i > 0) scr_jb_putc(b, ',');
      if (!d->buffer) {
        char idx[32];
        int n = snprintf(idx, sizeof idx, "\"%zu\":", i);
        scr_jb_write(b, idx, (size_t)n);
      }
      scr_jb_put_f64(b, scr_bytes_get(bytes, (double)i));
    }
    scr_jb_puts(b, d->buffer ? "]}" : "}");
    return true;
  }
  case SCR_DYN_PROMISE:
    /* No own enumerable properties — Node stringifies a promise as {}. */
    scr_jb_puts(b, "{}");
    return true;
  case SCR_DYN_JSVAL: {
    /* The ENGINE's own JSON.stringify text splices in (toJSON protocols,
     * cycle TypeErrors — the engine's, bridged catchably). An engine
     * FUNCTION is absent under stringify, like the checked-dynamic tree's FUNC kind. */
    if (scr_dyn_isl_typeof_is(d, "function")) return false;
    ScrStr *j = scr_dyn_jsval_ops()->to_json(d->v.jsval.cell);
    if (!j) return true; /* pending exception; caller checks */
    scr_jb_write(b, j->data, j->len);
    scr_str_release(j);
    return true;
  }
  case SCR_DYN_HANDLE:
  default: {
    const char *msg = "JSON.stringify of a runtime handle is not supported yet";
    scr_throw_error_msg(SCR_ERR_ERROR, msg, strlen(msg));
    return true; /* pending exception; caller checks */
  }
  }
}

/* util.format's %j argument (+1): the stringify text, "undefined" for a
 * root the stringify drops, or NULL with a pending exception (a handle
 * inside the tree). */
ScrStr *scr_dyn_format_j(const ScrDyn *d) {
  ScrJsonBuf b;
  scr_jb_init(&b);
  bool present = scr_dyn_json_write(&b, d);
  if (scr_exc_pending()) {
    scr_jb_dispose(&b);
    return NULL;
  }
  if (!present) {
    scr_jb_dispose(&b);
    return scr_str_new("undefined", 9);
  }
  return scr_jb_finish(&b);
}

/* An %Error instance as a dyn object ({name, message[, code]}) — the
 * checked-dynamic boundary's error shape (the exception-snapshot
 * convention emit-walkers uses). Borrows e; +1 result.
 *
 * IDENTITY-CACHED: one error instance boxes to ONE dyn node, however many
 * times it crosses (Node passes the error OBJECT through, so `found.error
 * === thrown` and re-crossings compare reference-equal — the tracing
 * suite's shape). The cache retains both sides for the process (like the
 * dc registry; released atexit before the RC audit) and the node
 * SNAPSHOTS name/message/code at first crossing — a later mutation of the
 * error is invisible through it (SEMANTICS.md). Linear scan: error
 * crossings are test/reporting paths, not hot loops. */
typedef struct {
  ScrError *err; /* retained (pins the address — no pointer reuse) */
  ScrDyn *dyn;   /* retained */
} ScrErrDynEnt;

static ScrErrDynEnt *scr_errdyn_cache = NULL;
static size_t scr_errdyn_n = 0, scr_errdyn_cap = 0;
static bool scr_errdyn_teardown_registered = false;

static void scr_errdyn_teardown(void) {
  for (size_t i = 0; i < scr_errdyn_n; i++) {
    scr_error_release(scr_errdyn_cache[i].err);
    scr_dyn_release(scr_errdyn_cache[i].dyn);
  }
  free(scr_errdyn_cache);
  scr_errdyn_cache = NULL;
  scr_errdyn_n = scr_errdyn_cap = 0;
}

ScrDyn *scr_dyn_from_error(const ScrError *e) {
  for (size_t i = 0; i < scr_errdyn_n; i++) {
    if (scr_errdyn_cache[i].err == e) return scr_dyn_retain(scr_errdyn_cache[i].dyn);
  }
  ScrDyn *d = scr_dyn_new_obj();
  scr_dyn_obj_set(d, "%error", 6, scr_dyn_new_bool(true)); /* the checked-dynamic tree's error marker */
  scr_dyn_obj_set(d, "name", 4, scr_dyn_new_str(e->name));
  scr_dyn_obj_set(d, "message", 7, scr_dyn_new_str(e->message));
  if (e->code) scr_dyn_obj_set(d, "code", 4, scr_dyn_new_str(e->code));
  /* DOMException: `code` is the WebIDL legacy NUMBER (never the errno
   * string slot), and the options form's cause crosses as itself. */
  if (e->vt == &scr_error_vts[SCR_ERR_DOMEX]) {
    scr_dyn_obj_set(d, "code", 4, scr_dyn_new_num(scr_domex_code(( ScrError *)e)));
    if (scr_domex_has_cause((ScrError *)e)) {
      scr_dyn_obj_set(d, "cause", 5, scr_domex_cause((ScrError *)e));
    }
  }
  if (scr_errdyn_n == scr_errdyn_cap) {
    scr_errdyn_cap = scr_errdyn_cap ? scr_errdyn_cap * 2 : 8;
    scr_errdyn_cache = realloc(scr_errdyn_cache, scr_errdyn_cap * sizeof *scr_errdyn_cache);
    if (!scr_errdyn_cache) {
      scr_trap("scriptc: out of memory\n");
    }
  }
  if (!scr_errdyn_teardown_registered) {
    scr_errdyn_teardown_registered = true;
    scr_atexit(scr_errdyn_teardown);
  }
  scr_errdyn_cache[scr_errdyn_n].err = scr_error_retain((ScrError *)e);
  scr_errdyn_cache[scr_errdyn_n].dyn = scr_dyn_retain(d);
  scr_errdyn_n++;
  return d;
}

/* The %Error EXTRACTION (dynCheck of `u as Error` / an instanceof-Error
 * narrow, and the dyn-boxed thunk's Error-typed parameters): the REVERSE
 * of scr_dyn_from_error, riding the same identity cache — a dyn error
 * that came from a runtime ScrError answers THAT instance (+1), so an
 * error crossing out and back compares reference-equal (the tracing
 * suite's shape); an alien %error object rebuilds a runtime error from
 * its name/message/code (the vtable kind resolves from the name so a
 * later `instanceof TypeError` still answers) and ENTERS the cache, so
 * its next boxing answers the same dyn node. The dyn node is borrowed. */
ScrError *scr_error_from_dyn(const ScrDyn *d) {
  ScrError *hit = scr_errdyn_err_of(d);
  if (hit) return hit;
  const ScrDyn *en = scr_dyn_obj_get(d, "name", 4);
  const ScrDyn *em = scr_dyn_obj_get(d, "message", 7);
  const ScrDyn *ec = scr_dyn_obj_get(d, "code", 4);
  int k = SCR_ERR_ERROR;
  if (en && en->kind == SCR_DYN_STR) {
    const ScrStr *n = en->v.str;
    if (n->len == 9 && memcmp(n->data, "TypeError", 9) == 0) k = SCR_ERR_TYPE;
    else if (n->len == 10 && memcmp(n->data, "RangeError", 10) == 0) k = SCR_ERR_RANGE;
    else if (n->len == 11 && memcmp(n->data, "SyntaxError", 11) == 0) k = SCR_ERR_SYNTAX;
  }
  ScrError *e = scr_error_new(k, (em && em->kind == SCR_DYN_STR) ? em->v.str : NULL);
  if (en && en->kind == SCR_DYN_STR) {
    scr_str_release(e->name);
    e->name = scr_str_retain(en->v.str);
  }
  if (ec && ec->kind == SCR_DYN_STR) e->code = scr_str_retain(ec->v.str);
  scr_errdyn_put(e, (ScrDyn *)d);
  return e;
}

/* Identity-cache access for the tracing/dc surfaces (the cache storage
 * stays private here). Reverse lookup answers +1 or NULL; put retains
 * both sides for the process. */
ScrError *scr_errdyn_err_of(const ScrDyn *d) {
  for (size_t i = 0; i < scr_errdyn_n; i++) {
    if (scr_errdyn_cache[i].dyn == d) return scr_error_retain(scr_errdyn_cache[i].err);
  }
  return NULL;
}

void scr_errdyn_put(ScrError *e, ScrDyn *d) {
  if (scr_errdyn_n == scr_errdyn_cap) {
    scr_errdyn_cap = scr_errdyn_cap ? scr_errdyn_cap * 2 : 8;
    scr_errdyn_cache = realloc(scr_errdyn_cache, scr_errdyn_cap * sizeof *scr_errdyn_cache);
    if (!scr_errdyn_cache) {
      scr_trap("scriptc: out of memory\n");
    }
  }
  if (!scr_errdyn_teardown_registered) {
    scr_errdyn_teardown_registered = true;
    scr_atexit(scr_errdyn_teardown);
  }
  scr_errdyn_cache[scr_errdyn_n].err = scr_error_retain(e);
  scr_errdyn_cache[scr_errdyn_n].dyn = scr_dyn_retain(d);
  scr_errdyn_n++;
}


/* Receiver-kind-dispatched toString() on a checked-dynamic value (the
 * dyn method surface — a stream's 'data'/for-await chunk is the common
 * receiver): bytes decode per the encoding (Node's Buffer.toString,
 * utf8 default), strings answer themselves, numbers/booleans format
 * JS-exactly, arrays join their dyn elements with ',' (recursively via
 * JS's Array.prototype.toString), plain objects answer
 * "[object Object]", and undefined/null throw Node's TypeError. Borrows
 * both; +1 result. */
ScrStr *scr_dyn_to_string(const ScrDyn *d, const ScrStr *enc) {
  switch (d->kind) {
  case SCR_DYN_BYTES:
    if (d->buffer) return scr_bytes_to_str(d->v.bytes, enc);
    /* Uint8Array.prototype.toString is Array's: elements joined */
    {
      ScrStr *out = scr_str_new("", 0);
      for (size_t i = 0; i < d->v.bytes->len; i++) {
        char n[16];
        int w = snprintf(n, sizeof n, i > 0 ? ",%u" : "%u", (unsigned)d->v.bytes->data[i]);
        ScrStr *piece = scr_str_new(n, (size_t)w);
        ScrStr *joined = scr_str_concat(out, piece);
        scr_str_release(out);
        scr_str_release(piece);
        out = joined;
      }
      return out;
    }
  case SCR_DYN_STR:
    return scr_str_retain(d->v.str);
  case SCR_DYN_NUM:
    return scr_f64_to_scrstr(d->v.num);
  case SCR_DYN_BOOL:
    return d->v.b ? scr_str_new("true", 4) : scr_str_new("false", 5);
  case SCR_DYN_OBJ: {
    /* An OWN or INHERITED `toString` shadows Object.prototype's — the
     * whole point of writing `K.prototype.toString = fn`. Only a
     * callable one counts, and only a PRIMITIVE answer (a toString
     * returning an object is a TypeError in JS, which the ToPrimitive
     * path spells; here the constant stands rather than guessing). */
    ScrDyn *m = scr_dyn_obj_get(d, "toString", 8);
    if (m == NULL) m = scr_dyn_proto_get(d, "toString", 8);
    if (m != NULL && m->kind == SCR_DYN_FUNC) {
      scr_dyn_this_push_dyn(d);
      ScrDyn *r = scr_dyn_call(m, NULL, 0, "toString");
      scr_dyn_this_pop();
      if (r == NULL) return scr_str_new("", 0); /* threw — pending */
      if (r->kind == SCR_DYN_STR || r->kind == SCR_DYN_NUM ||
          r->kind == SCR_DYN_BOOL || r->kind == SCR_DYN_NULL ||
          r->kind == SCR_DYN_UNDEF) {
        ScrStr *s = scr_dyn_string_coerce(r);
        scr_dyn_release(r);
        return s;
      }
      scr_dyn_release(r);
    }
    return scr_str_new("[object Object]", 15);
  }
  case SCR_DYN_HANDLE:
    /* IncomingMessage/ServerResponse/Socket inherit
     * Object.prototype.toString — Node's String() answer exactly. */
    return scr_str_new("[object Object]", 15);
  case SCR_DYN_PROMISE:
    /* Object.prototype.toString with the Promise @@toStringTag. */
    return scr_str_new("[object Promise]", 16);
  case SCR_DYN_ARR: {
    ScrStr *out = scr_str_new("", 0);
    for (size_t i = 0; i < d->v.arr.len; i++) {
      if (i > 0) {
        ScrStr *comma = scr_str_new(",", 1);
        ScrStr *joined = scr_str_concat(out, comma);
        scr_str_release(out);
        scr_str_release(comma);
        out = joined;
      }
      const ScrDyn *e = d->v.arr.items[i];
      if (e->kind == SCR_DYN_UNDEF || e->kind == SCR_DYN_NULL) continue; /* JS join: empty */
      ScrStr *piece = scr_dyn_to_string(e, enc);
      ScrStr *joined = scr_str_concat(out, piece);
      scr_str_release(out);
      scr_str_release(piece);
      out = joined;
    }
    return out;
  }
  case SCR_DYN_FUNC: {
    static const char f[] = "function () { [native code] }";
    return scr_str_new(f, sizeof f - 1);
  }
  case SCR_DYN_JSVAL: {
    /* The engine's own ToString (row 2 of the jsval→dyn op table): the
     * real prototype chain runs — user toString included, its throw
     * bridging. A bridged failure follows this function's existing
     * throw shape (pending exception + the empty-string dummy). */
    ScrStr *s = scr_dyn_jsval_ops()->to_str(d->v.jsval.cell);
    return s ? s : scr_str_new("", 0);
  }
  case SCR_DYN_UNDEF:
  case SCR_DYN_NULL:
  default: {
    static const char msg[] = "Cannot read properties of undefined (reading 'toString')";
    static const char msgn[] = "Cannot read properties of null (reading 'toString')";
    if (d->kind == SCR_DYN_NULL) scr_throw_error_msg(SCR_ERR_TYPE, msgn, sizeof msgn - 1);
    else scr_throw_error_msg(SCR_ERR_TYPE, msg, sizeof msg - 1);
    return scr_str_new("", 0);
  }
  }
}

/* The METHOD-CALL spelling `d.toString(enc?)` — scr_dyn_to_string with
 * the one receiver whose prototype LACKS the method carved out: a
 * null-prototype dictionary (Object.create(null)) has no toString at
 * all, so Node throws "<spelling> is not a function" where every other
 * OBJ answers "[object Object]". `what` carries the source spelling. */
ScrStr *scr_dyn_to_string_method(const ScrDyn *d, const ScrStr *enc, const ScrStr *what) {
  if (d->kind == SCR_DYN_OBJ && d->null_proto) {
    ScrJsonBuf b;
    scr_jb_init(&b);
    for (size_t i = 0; i < what->len; i++) scr_jb_putc(&b, what->data[i]);
    scr_jb_puts(&b, " is not a function");
    scr_throw_error(SCR_ERR_TYPE, scr_jb_finish(&b));
    return scr_str_new("", 0);
  }
  return scr_dyn_to_string(d, enc);
}

/* JS String() over the dyn kind — the WebIDL ToString the web globals
 * (atob/btoa, DOMException's name resolution) run on their arguments:
 * the unit kinds RENDER ("null"/"undefined") where the .toString() twin
 * above throws Node's property-read TypeError; every other kind matches
 * scr_dyn_to_string. Borrows d; returns +1. */
ScrStr *scr_dyn_string_coerce(const ScrDyn *d) {
  if (d->kind == SCR_DYN_NULL) return scr_str_new("null", 4);
  if (d->kind == SCR_DYN_UNDEF) return scr_str_new("undefined", 9);
  return scr_dyn_to_string(d, NULL);
}

/* JS ToString over a dyn value WITH the object protocol (the WHATWG
 * USVString conversions — URLSearchParams names/values): an OBJ whose
 * own 'toString' member is callable is invoked with zero arguments (its
 * throw propagates, catchably); a non-primitive answer falls through to
 * 'valueOf' (ToPrimitive's string hint); exhaustion is the spec's
 * "Cannot convert object to primitive value" TypeError. Every other
 * kind matches scr_dyn_string_coerce (units RENDER — ToString(null) is
 * "null"). Borrows; +1, or NULL with the exception pending. */
ScrStr *scr_dyn_string_coerce_js(const ScrDyn *d) {
  if (d->kind == SCR_DYN_OBJ) {
    static const char *const hint[2] = { "toString", "valueOf" };
    for (int i = 0; i < 2; i++) {
      /* ToPrimitive is a [[Get]], so it walks the PROTOTYPE CHAIN — a
       * `K.prototype.toString = fn` is exactly where JS programs put
       * one, and reading own-only would answer the spec's "cannot
       * convert" TypeError for an object that HAS the method. */
      ScrDyn *m = scr_dyn_obj_get(d, hint[i], strlen(hint[i])); /* borrowed */
      if (!m) m = scr_dyn_proto_get(d, hint[i], strlen(hint[i]));
      if (!m || m->kind != SCR_DYN_FUNC) continue;
      /* JS calls it with the OBJECT as the receiver — a toString that
       * reads `this` is the only interesting kind. */
      scr_dyn_this_push_dyn(d);
      ScrDyn *r = scr_dyn_call(m, NULL, 0, hint[i]);
      scr_dyn_this_pop();
      if (!r) return NULL; /* the method threw — pending */
      if (r->kind == SCR_DYN_OBJ || r->kind == SCR_DYN_ARR ||
          r->kind == SCR_DYN_FUNC || r->kind == SCR_DYN_HANDLE ||
          r->kind == SCR_DYN_PROMISE) {
        scr_dyn_release(r); /* non-primitive answer: try the next method */
        continue;
      }
      ScrStr *s = scr_dyn_string_coerce(r);
      scr_dyn_release(r);
      return s;
    }
    static const char msg[] = "Cannot convert object to primitive value";
    scr_throw_error_msg(SCR_ERR_TYPE, msg, sizeof msg - 1);
    return NULL;
  }
  return scr_dyn_string_coerce(d);
}

/* ── ACCESSOR PROPERTIES ───────────────────────────────────────────────
 *
 * `Object.defineProperty(o, k, { get, set })`. The pair lives in the OBJ
 * node's SEPARATE `accessors` table (scr_runtime.h says why), which is
 * what keeps a non-enumerable accessor off Object.keys / JSON / assign /
 * structuredClone / deepStrictEqual by construction: every one of those
 * reads `entries`, and an accessor is never in `entries`.
 *
 * Only three operations consult the table, and they are exactly JS's
 * three: [[Get]], [[Set]] and `in`. The getter runs with `this` bound to
 * the RECEIVER the read started from, not to the object the accessor was
 * found on — which is the whole reason the idiom works: pbjs defines the
 * `_field` oneof accessor ONCE on `Message.prototype`, and each
 * instance's read has to run it against its own members. */

typedef enum { SCR_PROP_ABSENT, SCR_PROP_DATA, SCR_PROP_ACCESSOR } ScrPropKind;

/* One property lookup over the receiver and its [[Prototype]] chain,
 * shared by [[Get]], [[Set]] and `in` so the three can never disagree
 * about where a property lives. At any ONE level a key is either a data
 * member or an accessor and never both — scr_dyn_obj_define_accessor
 * drops the data entry it replaces, and scr_dyn_key_set routes to the
 * setter instead of writing a shadowing data entry — so the per-level
 * order below is a fast path, not a tie-break. `*out` is BORROWED: the
 * data member, or the accessor's `[getter, setter, configurable]` ARR. */
static ScrPropKind scr_dyn_obj_resolve(const ScrDyn *d, const char *key, size_t key_len,
                                       ScrDyn **out) {
  const ScrDyn *o = d;
  for (size_t steps = 0; o != NULL && steps <= SCR_PROTO_MAX_DEPTH; steps++) {
    if (o->kind != SCR_DYN_OBJ) break;
    ScrDyn *m = scr_dyn_obj_get(o, key, key_len);
    if (m != NULL) {
      *out = m;
      return SCR_PROP_DATA;
    }
    if (o->v.obj.accessors != NULL) {
      ScrDyn *pair = scr_dyn_obj_get(o->v.obj.accessors, key, key_len);
      if (pair != NULL) {
        *out = pair;
        return SCR_PROP_ACCESSOR;
      }
    }
    o = o->v.obj.proto;
  }
  *out = NULL;
  return SCR_PROP_ABSENT;
}

/* JS's [[Get]] on an OBJ receiver, whole: own member, own accessor, the
 * prototype chain, then the `constructor` fence. ALWAYS +1 on success;
 * NULL only with a pending exception (a throwing getter, or the fence).
 *
 * BOTH backends' keyed-read walkers call exactly this rather than
 * reimplementing the walk, so neither can answer a property the other
 * cannot — the split estado-protochain.md §2e found the hard way. */
ScrDyn *scr_dyn_obj_key_get(ScrDyn *recv, const char *key, size_t key_len) {
  ScrDyn *found = NULL;
  ScrPropKind k = scr_dyn_obj_resolve(recv, key, key_len, &found);
  if (k == SCR_PROP_DATA) return scr_dyn_retain(found);
  if (k == SCR_PROP_ACCESSOR) {
    /* A set-only accessor READS as undefined in JS — absence of a getter
     * is not an error, and answering one here would be a wrong throw. */
    ScrDyn *getter = found->v.arr.items[0];
    if (getter->kind != SCR_DYN_FUNC) return scr_dyn_retain(scr_dyn_undefined());
    scr_dyn_this_push_dyn(recv);
    ScrDyn *r = scr_dyn_call(getter, NULL, 0, "getter");
    scr_dyn_this_pop();
    return r; /* +1, or NULL with the getter's own exception pending */
  }
  if (key_len == 11 && memcmp(key, "constructor", 11) == 0 &&
      scr_dyn_proto_chain_is_fn_pub(recv)) {
    /* The one member Node's implicit prototype has and this one
     * deliberately does not (the back-link would be an uncollectable
     * cycle): loud, never a silent undefined. */
    scr_dyn_proto_ctor_fence();
    return NULL;
  }
  return scr_dyn_retain(scr_dyn_undefined());
}

/* `key in obj` over an OBJ receiver: own member, own accessor, then the
 * chain — an accessor IS a property, so `in` sees it even though
 * Object.keys does not. Never throws (no getter runs). */
bool scr_dyn_obj_key_present(const ScrDyn *d, const char *key, size_t key_len) {
  ScrDyn *found = NULL;
  return scr_dyn_obj_resolve(d, key, key_len, &found) != SCR_PROP_ABSENT;
}

/* Drop one OWN data member, preserving the insertion order of the rest
 * (JS own-key order is insertion order, and defineProperty replacing a
 * data property with an accessor must not reshuffle its neighbours). */
static void scr_dyn_obj_unset(ScrDyn *obj, const char *key, size_t key_len) {
  for (size_t i = 0; i < obj->v.obj.len; i++) {
    ScrDynEntry *e = &obj->v.obj.entries[i];
    if (e->key_len == key_len && memcmp(e->key, key, key_len) == 0) {
      free(e->key);
      scr_dyn_release(e->value);
      memmove(&obj->v.obj.entries[i], &obj->v.obj.entries[i + 1],
              (obj->v.obj.len - i - 1) * sizeof *obj->v.obj.entries);
      obj->v.obj.len--;
      return;
    }
  }
}

/* Install `key` as an accessor property of `recv`. Both halves are
 * BORROWED (the pair retains them); either may be the undefined
 * singleton for a one-sided accessor. Any own DATA member of the same
 * name is dropped — defineProperty CONVERTS a data property into an
 * accessor property, it does not layer one over the other. `configurable`
 * rides in the triple so a second define can answer JS's "Cannot redefine
 * property" instead of silently replacing a sealed getter. */
void scr_dyn_obj_define_accessor(ScrDyn *recv, const char *key, size_t key_len,
                                 ScrDyn *getter, ScrDyn *setter, bool configurable) {
  if (recv->kind != SCR_DYN_OBJ) return;
  if (recv->v.obj.accessors == NULL) recv->v.obj.accessors = scr_dyn_new_obj();
  scr_dyn_obj_unset(recv, key, key_len);
  ScrDyn *triple = scr_dyn_new_arr();
  scr_dyn_arr_push(triple, scr_dyn_retain(getter));
  scr_dyn_arr_push(triple, scr_dyn_retain(setter));
  scr_dyn_arr_push(triple, scr_dyn_new_bool(configurable));
  scr_dyn_obj_set(recv->v.obj.accessors, key, key_len, triple); /* ownership moves in */
}

/* True when `recv` already carries an OWN accessor for `key` that was NOT
 * declared configurable — the case a second define is a TypeError in JS.
 * OWN only: shadowing an inherited accessor with a define is legal. */
bool scr_dyn_obj_accessor_sealed(const ScrDyn *recv, const char *key, size_t key_len) {
  if (recv->kind != SCR_DYN_OBJ || recv->v.obj.accessors == NULL) return false;
  ScrDyn *triple = scr_dyn_obj_get(recv->v.obj.accessors, key, key_len);
  if (triple == NULL || triple->v.arr.len < 3) return false;
  return !scr_dyn_truthy(triple->v.arr.items[2]);
}

/* The other direction: redefining an accessor property as a DATA property
 * drops the pair, so the two tables never both claim one key and the
 * getter/setter closures are released at the redefinition rather than at
 * the object's death. */
void scr_dyn_obj_drop_accessor(ScrDyn *recv, const char *key, size_t key_len) {
  if (recv->kind != SCR_DYN_OBJ || recv->v.obj.accessors == NULL) return;
  scr_dyn_obj_unset(recv->v.obj.accessors, key, key_len);
}

/* The checked-dynamic keyed WRITE (`h.k = v` on a dyn receiver): OBJ sets
 * the member (later writes win, insertion order — JS); undefined/null
 * throws Node's "Cannot set properties of ..."; every other kind throws
 * Node's strict-mode "Cannot create property ..." (sloppy mode would
 * ignore silently — the loud choice, SEMANTICS.md). Receiver, key, and
 * value are all BORROWED (the member retains the value in). */
static const char *scr_dyn_kind_name(const ScrDyn *d);
/* Own-property presence on a FUNC node, for `in` and Object.hasOwn. It
 * asks scr_dyn_fn_get, so presence can never disagree with what the READ
 * answers: the property table first, then the name/length built-ins.
 *
 * Declared divergence: Node's `in` also walks Function.prototype, so
 * `"call" in f` is true there and false here. That is the missing
 * prototype chain, not this arm — it answered false before the table was
 * writable too. Object.hasOwn is exact. */
bool scr_dyn_fn_has(const ScrDyn *v, const char *key, size_t key_len) {
  ScrDyn *m = scr_dyn_fn_get(v, key, key_len); /* +1 or NULL */
  if (m == NULL) return false;
  scr_dyn_release(m);
  return true;
}
/* `key in v` with a RUNTIME key (the compile-time dynHasKey fold, per
 * value): OBJ answers own-member presence AND the prototype chain (`in`
 * is one of the two JS operators that walks it — `"m" in new F()` is
 * true where Object.hasOwn is false), ARR answers 'length' or a valid
 * dense index, every other kind false (tsc admits `in` only on
 * object-typed operands). Borrows both; never throws.
 *
 * Still false for the members no chain here HAS: `"toString" in {}` is
 * true in Node (Object.prototype) and false here, because this runtime
 * models no Object.prototype — the pre-existing divergence
 * estado-objmodel.md §4d named, unchanged. */
bool scr_dyn_has_key(const ScrDyn *v, const ScrStr *key) {
  if (v->kind == SCR_DYN_OBJ) {
    /* One walk, accessors included: an accessor IS a property, so `in`
     * answers true for it even though Object.keys skips it. */
    return scr_dyn_obj_key_present(v, key->data, key->len);
  }
  if (v->kind == SCR_DYN_ARR) {
    if (key->len == 6 && memcmp(key->data, "length", 6) == 0) return true;
    if (key->len == 0 || key->len > 15) return false;
    size_t idx = 0;
    for (size_t i = 0; i < key->len; i++) {
      char c = key->data[i];
      if (c < '0' || c > '9') return false;
      if (i > 0 && idx == 0) return false; /* a leading zero is no canonical index */
      idx = idx * 10 + (size_t)(c - '0');
    }
    return idx < v->v.arr.len;
  }
  /* A function value carries own properties (assignment and
   * defineProperties both land in one table), so `k in f` answers from
   * the same place the read does. */
  if (v->kind == SCR_DYN_FUNC) return scr_dyn_fn_has(v, key->data, key->len);
  return false;
}

void scr_dyn_key_set(ScrDyn *recv, ScrStr *key, ScrDyn *value) {
  if (recv->kind == SCR_DYN_OBJ) {
    /* JS's OrdinarySet is not "write the own member": it walks the chain
     * looking for an ACCESSOR first, and a setter found anywhere on it
     * takes the write with `this` bound to the RECEIVER — no own data
     * property appears. That is the half of the oneof idiom that makes
     * `msg._field = "x"` run pbjs's setter instead of creating a member
     * `Object.keys(msg)` would then report. A data property found on the
     * chain still SHADOWS (an own member is created), which is what the
     * plain obj_set below does.
     *
     * Only reached when the receiver's chain carries accessors at all —
     * the common object pays one NULL test per write. */
    ScrDyn *found = NULL;
    if (recv->v.obj.accessors != NULL || recv->v.obj.proto != NULL) {
      if (scr_dyn_obj_resolve(recv, key->data, key->len, &found) == SCR_PROP_ACCESSOR) {
        ScrDyn *setter = found->v.arr.items[1];
        if (setter->kind != SCR_DYN_FUNC) {
          /* V8's strict-mode text. Sloppy mode ignores the write
           * silently; this runtime does not do silent. */
          ScrJsonBuf sb;
          scr_jb_init(&sb);
          scr_jb_puts(&sb, "Cannot set property ");
          scr_jb_write(&sb, key->data, key->len);
          scr_jb_puts(&sb, " of #<Object> which has only a getter");
          scr_throw_error(SCR_ERR_TYPE, scr_jb_finish(&sb));
          return;
        }
        ScrDyn *argv[1] = { value };
        scr_dyn_this_push_dyn(recv);
        ScrDyn *r = scr_dyn_call(setter, argv, 1, "setter");
        scr_dyn_this_pop();
        scr_dyn_release(r); /* NULL-tolerant: a throwing setter leaves it pending */
        return;
      }
    }
    scr_dyn_obj_set(recv, key->data, key->len, scr_dyn_retain(value));
    return;
  }
  if (recv->kind == SCR_DYN_ARR) {
    /* An INDEX write on a dyn array (`args[i] = v` — the variadic-rest
     * rebuild): a canonical numeric key sets/extends the element, holes
     * padding with undefined exactly like JS length growth. Non-index
     * keys keep the throw below (dyn arrays carry no expando table). */
    size_t idx = 0;
    int is_index = key->len > 0 && !(key->len > 1 && key->data[0] == '0');
    for (size_t i = 0; is_index && i < key->len; i++) {
      if (key->data[i] < '0' || key->data[i] > '9') is_index = 0;
      else idx = idx * 10 + (size_t)(key->data[i] - '0');
    }
    if (is_index) {
      while (recv->v.arr.len <= idx) {
        scr_dyn_arr_push(recv, scr_dyn_retain(scr_dyn_undefined()));
      }
      scr_dyn_release(recv->v.arr.items[idx]);
      recv->v.arr.items[idx] = scr_dyn_retain(value);
      return;
    }
  }
  if (recv->kind == SCR_DYN_HANDLE) {
    scr_dyn_handle_key_set(recv, key, value);
    return;
  }
  if (recv->kind == SCR_DYN_JSVAL) {
    /* The write lands on the REAL engine object (aliasing preserved —
     * island-side readers see it); the value crosses through the uniform
     * from_dyn conversion, and engine refusals bridge catchably. */
    scr_dyn_jsval_ops()->key_set(recv->v.jsval.cell, key, value);
    return;
  }
  if (recv->kind == SCR_DYN_FUNC) {
    /* `f.k = v` on a function value — the namespace-object idiom
     * (`Codec.encode = fn`) untyped CommonJS is written in. It lands in
     * the SAME own-property table Object.defineProperties writes and
     * scr_dyn_fn_get / scr_dyn_invoke already read: the read side shipped
     * first, so before this the two disagreed — defineProperty(f,'x',…)
     * then `f.x` answered, but `f.x = 1` threw. The table hangs off the
     * closure, so a per-USE box is correct (see scr_dyn_fn_props).
     *
     * Which keys store is Node's own answer to "does plain assignment
     * create an own DATA property here":
     *   name/length  non-writable own properties — strict mode throws,
     *                sloppy silently ignores; either way no own data
     *                property appears, so storing would be a wrong read
     *                afterwards. LOUD fence.
     *   caller/args  poisoned accessors on a strict function — assignment
     *                throws TypeError. LOUD fence.
     *   prototype    a WRITABLE own data property on a function
     *                declaration; assignment succeeds in Node, so it
     *                stores. Nothing consumes it as a prototype CHAIN yet
     *                — `new`/`instanceof` over non-program values and
     *                Object.create(<proto>) all still refuse at compile
     *                time — so this is a plain own property and answers
     *                no differently than Node until that lands.
     *   everything   a fresh own data property. Stores. */
    if ((key->len == 4 && memcmp(key->data, "name", 4) == 0) ||
        (key->len == 6 && memcmp(key->data, "length", 6) == 0) ||
        (key->len == 6 && memcmp(key->data, "caller", 6) == 0) ||
        (key->len == 9 && memcmp(key->data, "arguments", 9) == 0)) {
      ScrJsonBuf fb;
      scr_jb_init(&fb);
      scr_jb_puts(&fb, "assigning the read-only function member '");
      for (size_t i = 0; i < key->len; i++) scr_jb_putc(&fb, key->data[i]);
      scr_jb_puts(&fb, "' on a dynamic function value is not supported yet"
                       " (JS creates no own data property there: strict mode throws,"
                       " sloppy mode ignores — Object.defineProperty is the spelling that lands)");
      scr_throw_error(SCR_ERR_ERROR, scr_jb_finish(&fb));
      return;
    }
    ScrDyn *table = scr_dyn_fn_props(recv); /* +1 */
    scr_dyn_obj_set(table, key->data, key->len, scr_dyn_retain(value));
    scr_dyn_release(table);
    return;
  }
  ScrJsonBuf b;
  scr_jb_init(&b);
  if (recv->kind == SCR_DYN_UNDEF || recv->kind == SCR_DYN_NULL) {
    scr_jb_puts(&b, "Cannot set properties of ");
    scr_jb_puts(&b, recv->kind == SCR_DYN_UNDEF ? "undefined" : "null");
    scr_jb_puts(&b, " (setting '");
    for (size_t i = 0; i < key->len; i++) scr_jb_putc(&b, key->data[i]);
    scr_jb_puts(&b, "')");
  } else {
    scr_jb_puts(&b, "Cannot create property '");
    for (size_t i = 0; i < key->len; i++) scr_jb_putc(&b, key->data[i]);
    scr_jb_puts(&b, "' on ");
    scr_jb_puts(&b, scr_dyn_kind_name(recv));
    /* V8 quotes the primitive's own rendering after the kind — "on number
     * '5'", "on string 'abc'", "on boolean 'true'". Other kinds stop at
     * the kind word. */
    if (recv->kind == SCR_DYN_NUM) {
      char buf[32];
      size_t n = scr_f64_to_str(recv->v.num, buf);
      scr_jb_puts(&b, " '");
      scr_jb_write(&b, buf, n);
      scr_jb_putc(&b, '\'');
    } else if (recv->kind == SCR_DYN_STR) {
      scr_jb_puts(&b, " '");
      scr_jb_write(&b, recv->v.str->data, recv->v.str->len);
      scr_jb_putc(&b, '\'');
    } else if (recv->kind == SCR_DYN_BOOL) {
      scr_jb_puts(&b, recv->v.b ? " 'true'" : " 'false'");
    }
  }
  scr_throw_error(SCR_ERR_TYPE, scr_jb_finish(&b));
}

/* Node's JSON.stringify over a dyn: object members holding undefined DROP,
 * array slots holding undefined print null. A bare undefined never arrives
 * (the record serializer drops the entry first); print null defensively. */
void scr_jb_put_dyn(ScrJsonBuf *b, const ScrDyn *d) {
  switch (d->kind) {
  case SCR_DYN_NULL:
  case SCR_DYN_UNDEF:
  case SCR_DYN_FUNC: /* JSON.stringify: functions serialize like undefined */
    scr_jb_puts(b, "null");
    return;
  case SCR_DYN_BOOL:
    scr_jb_puts(b, d->v.b ? "true" : "false");
    return;
  case SCR_DYN_NUM:
    scr_jb_put_f64(b, d->v.num);
    return;
  case SCR_DYN_STR:
    scr_jb_put_json_str(b, d->v.str);
    return;
  case SCR_DYN_BYTES: {
    /* Node's JSON.stringify over a typed array: the index-keyed object
     * form — {"0":1,"1":2}. u8 payloads only reach the checked-dynamic tree today. */
    scr_jb_putc(b, '{');
    for (size_t i = 0; i < d->v.bytes->len; i++) {
      if (i > 0) scr_jb_putc(b, ',');
      char idx[32];
      snprintf(idx, sizeof idx, "\"%zu\":%u", i, (unsigned)d->v.bytes->data[i]);
      scr_jb_puts(b, idx);
    }
    scr_jb_putc(b, '}');
    return;
  }
  case SCR_DYN_ARR:
    scr_jb_putc(b, '[');
    for (size_t i = 0; i < d->v.arr.len; i++) {
      if (i > 0) scr_jb_putc(b, ',');
      scr_jb_put_dyn(b, d->v.arr.items[i]);
    }
    scr_jb_putc(b, ']');
    return;
  case SCR_DYN_PROMISE:
    /* No own enumerable properties — Node stringifies a promise as {}. */
    scr_jb_puts(b, "{}");
    return;
  case SCR_DYN_HANDLE: {
    /* Node's JSON.stringify over these classes throws the circular-
     * structure TypeError with a V8 path dump we cannot reproduce —
     * fence loudly instead of a silent-wrong shape (SEMANTICS.md). */
    ScrJsonBuf m;
    scr_jb_init(&m);
    scr_jb_puts(&m, "JSON.stringify of a dynamic ");
    scr_jb_puts(&m, scr_dyn_handle_cls(d));
    scr_jb_puts(&m, " is not supported yet");
    scr_throw_error(SCR_ERR_ERROR, scr_jb_finish(&m));
    scr_jb_puts(b, "null"); /* the buffer never surfaces: the pending throw wins */
    return;
  }
  case SCR_DYN_JSVAL: {
    /* The ENGINE's own JSON.stringify text splices in (toJSON protocols,
     * cycle TypeErrors — all the engine's, bridged catchably). An engine
     * FUNCTION serializes like the checked-dynamic tree's FUNC kind (dropped from objects
     * by the member loop below; null defensively elsewhere). */
    if (scr_dyn_isl_typeof_is(d, "function")) {
      scr_jb_puts(b, "null");
      return;
    }
    ScrStr *j = scr_dyn_jsval_ops()->to_json(d->v.jsval.cell);
    if (!j) return; /* bridged — the pending throw wins */
    for (size_t i = 0; i < j->len; i++) scr_jb_putc(b, j->data[i]);
    scr_str_release(j);
    return;
  }
  case SCR_DYN_OBJ: {
    scr_jb_putc(b, '{');
    bool first = true;
    /* JS own-key order, not the entry table's insertion order: an enum
     * table's integer keys serialize first, ascending, exactly as Node
     * does (scr_dyn_obj_key_order). */
    size_t *ord = scr_dyn_obj_key_order(d);
    for (size_t oi = 0; oi < d->v.obj.len; oi++) {
      const ScrDynEntry *e = &d->v.obj.entries[ord ? ord[oi] : oi];
      if (e->value->kind == SCR_DYN_UNDEF || e->value->kind == SCR_DYN_FUNC) continue; /* dropped, like Node */
      if (e->value->kind == SCR_DYN_JSVAL && scr_dyn_isl_typeof_is(e->value, "function")) continue; /* engine functions drop too */
      if (!first) scr_jb_putc(b, ',');
      first = false;
      /* Keys escape exactly like string values (put_json_str quotes). */
      ScrStr *k = scr_str_new(e->key, e->key_len);
      scr_jb_put_json_str(b, k);
      scr_str_release(k);
      scr_jb_putc(b, ':');
      scr_jb_put_dyn(b, e->value);
    }
    free(ord);
    scr_jb_putc(b, '}');
    return;
  }
  }
  scr_trap("scriptc: internal error: invalid dyn kind\n");
}

/* ── dynCheck failure path ─────────────────────────────────────────────── */

static void scr_dyn_path_render(ScrJsonBuf *b, const ScrDynPath *p) {
  if (!p) {
    scr_jb_putc(b, '$');
    return;
  }
  scr_dyn_path_render(b, p->parent);
  if (p->key) {
    scr_jb_putc(b, '.');
    scr_jb_puts(b, p->key);
  } else {
    char idx[32];
    snprintf(idx, sizeof idx, "[%zu]", p->index);
    scr_jb_puts(b, idx);
  }
}

static const char *scr_dyn_kind_name(const ScrDyn *d) {
  if (!d) return "undefined"; /* a missing object member */
  switch (d->kind) {
  case SCR_DYN_NULL: return "null";
  case SCR_DYN_BOOL: return "boolean";
  case SCR_DYN_NUM: return "number";
  case SCR_DYN_STR: return "string";
  case SCR_DYN_ARR: return "array";
  case SCR_DYN_OBJ: return "object";
  case SCR_DYN_UNDEF: return "undefined";
  case SCR_DYN_BYTES: return "Uint8Array";
  case SCR_DYN_FUNC: return "function";
  case SCR_DYN_HANDLE: return scr_dyn_handle_cls(d); /* "got IncomingMessage" */
  case SCR_DYN_PROMISE: return "Promise"; /* "got Promise" */
  case SCR_DYN_JSVAL: return "an island value"; /* "got an island value" — validated
    * extraction of engine-held values has no armed route yet (lane
    * dom-jsval-long-tail); the failure names the world honestly. */
  }
  return "unknown";
}

void scr_dyn_check_fail(const ScrDynPath *path, const char *want, const ScrDyn *got) {
  ScrJsonBuf b;
  scr_jb_init(&b);
  scr_jb_puts(&b, "expected ");
  scr_jb_puts(&b, want);
  scr_jb_puts(&b, " at ");
  scr_dyn_path_render(&b, path);
  scr_jb_puts(&b, ", got ");
  scr_jb_puts(&b, scr_dyn_kind_name(got));
  /* A real TypeError instance: catch bindings narrow it with instanceof
   * and read the path off e.message; the uncaught line ("Uncaught
   * TypeError: expected ...") is byte-identical to the old string form. */
  scr_throw_error(SCR_ERR_TYPE, scr_jb_finish(&b));
}

/* ── parser ────────────────────────────────────────────────────────────── */

#define SCR_JSON_MAX_DEPTH 1000

typedef struct {
  const char *s;
  size_t len;
  size_t pos;
  int depth;
} ScrJsonP;

static void scr_json_throw(const char *msg) {
  scr_throw_error_msg(SCR_ERR_SYNTAX, msg, strlen(msg));
}

static void scr_json_throw_pos(const char *what, size_t pos) {
  char buf[128];
  int n = snprintf(buf, sizeof buf, "%s in JSON at position %zu", what, pos);
  scr_throw_error_msg(SCR_ERR_SYNTAX, buf, (size_t)n);
}

/* V8-flavored bad-token message with a short snippet of the input around
 * the offending character. Approximate fidelity (documented). */
static void scr_json_throw_token(const ScrJsonP *p) {
  size_t start = p->pos > 8 ? p->pos - 8 : 0;
  size_t take = p->len - start < 16 ? p->len - start : 16;
  char buf[192];
  int n = snprintf(buf, sizeof buf, "Unexpected token '%c', %s\"%.*s\"%s is not valid JSON",
                   p->s[p->pos], start > 0 ? "..." : "", (int)take, p->s + start,
                   start + take < p->len ? "..." : "");
  scr_throw_error_msg(SCR_ERR_SYNTAX, buf, (size_t)n);
}

static void scr_json_ws(ScrJsonP *p) {
  while (p->pos < p->len) {
    char c = p->s[p->pos];
    if (c == ' ' || c == '\t' || c == '\n' || c == '\r') p->pos++;
    else break;
  }
}

/* Append the UTF-8 encoding of cp (valid scalar values only — callers map
 * lone surrogates to U+FFFD first). */
static void scr_json_put_cp(ScrJsonBuf *b, uint32_t cp) {
  if (cp < 0x80) {
    scr_jb_putc(b, (char)cp);
  } else if (cp < 0x800) {
    scr_jb_putc(b, (char)(0xC0 | (cp >> 6)));
    scr_jb_putc(b, (char)(0x80 | (cp & 0x3F)));
  } else if (cp < 0x10000) {
    scr_jb_putc(b, (char)(0xE0 | (cp >> 12)));
    scr_jb_putc(b, (char)(0x80 | ((cp >> 6) & 0x3F)));
    scr_jb_putc(b, (char)(0x80 | (cp & 0x3F)));
  } else {
    scr_jb_putc(b, (char)(0xF0 | (cp >> 18)));
    scr_jb_putc(b, (char)(0x80 | ((cp >> 12) & 0x3F)));
    scr_jb_putc(b, (char)(0x80 | ((cp >> 6) & 0x3F)));
    scr_jb_putc(b, (char)(0x80 | (cp & 0x3F)));
  }
}

/* Four hex digits at pos, or -1 (throws). */
static int32_t scr_json_hex4(ScrJsonP *p) {
  if (p->len - p->pos < 4) {
    scr_json_throw("Unexpected end of JSON input");
    return -1;
  }
  uint32_t v = 0;
  for (int i = 0; i < 4; i++) {
    char c = p->s[p->pos + (size_t)i];
    uint32_t digit;
    if (c >= '0' && c <= '9') digit = (uint32_t)(c - '0');
    else if (c >= 'a' && c <= 'f') digit = (uint32_t)(c - 'a' + 10);
    else if (c >= 'A' && c <= 'F') digit = (uint32_t)(c - 'A' + 10);
    else {
      scr_json_throw_pos("Bad Unicode escape", p->pos + (size_t)i);
      return -1;
    }
    v = v * 16 + digit;
  }
  p->pos += 4;
  return (int32_t)v;
}

/* Fast scan of the string literal at p->pos (the opening quote): when it
 * contains no escapes, sets *span and *span_len to the raw bytes inside the
 * quotes, consumes the literal and returns 1. An escape returns 0 with
 * p->pos still at the opening quote (the slow path re-parses). A control
 * character or missing close quote throws (same message and position the
 * slow path would produce) and returns -1. */
static int scr_json_string_span(ScrJsonP *p, const char **span,
                                 size_t *span_len) {
  size_t i = p->pos + 1;
  while (i < p->len) {
    unsigned char c = (unsigned char)p->s[i];
    if (c == '"') {
      *span = p->s + p->pos + 1;
      *span_len = i - (p->pos + 1);
      p->pos = i + 1;
      return 1;
    }
    if (c == '\\') return 0;
    if (c < 0x20) {
      scr_json_throw_pos("Bad control character in string literal", i);
      return -1;
    }
    i++;
  }
  scr_json_throw_pos("Unterminated string", p->pos);
  return -1;
}

/* Slow path: parses the string literal at p->pos (the opening quote),
 * decoding escapes, into a +1 ScrStr. NULL on error (thrown). */
static ScrStr *scr_json_string_slow(ScrJsonP *p) {
  size_t open = p->pos;
  p->pos++; /* opening quote */
  ScrJsonBuf b;
  scr_jb_init(&b);
  for (;;) {
    if (p->pos >= p->len) {
      scr_jb_dispose(&b);
      scr_json_throw_pos("Unterminated string", open);
      return NULL;
    }
    unsigned char c = (unsigned char)p->s[p->pos];
    if (c == '"') {
      p->pos++;
      return scr_jb_finish(&b);
    }
    if (c < 0x20) {
      scr_jb_dispose(&b);
      scr_json_throw_pos("Bad control character in string literal", p->pos);
      return NULL;
    }
    if (c != '\\') {
      scr_jb_putc(&b, (char)c); /* raw UTF-8 passes through */
      p->pos++;
      continue;
    }
    p->pos++; /* backslash */
    if (p->pos >= p->len) {
      scr_jb_dispose(&b);
      scr_json_throw("Unexpected end of JSON input");
      return NULL;
    }
    char e = p->s[p->pos];
    switch (e) {
    case '"': scr_jb_putc(&b, '"'); p->pos++; break;
    case '\\': scr_jb_putc(&b, '\\'); p->pos++; break;
    case '/': scr_jb_putc(&b, '/'); p->pos++; break;
    case 'b': scr_jb_putc(&b, '\b'); p->pos++; break;
    case 'f': scr_jb_putc(&b, '\f'); p->pos++; break;
    case 'n': scr_jb_putc(&b, '\n'); p->pos++; break;
    case 'r': scr_jb_putc(&b, '\r'); p->pos++; break;
    case 't': scr_jb_putc(&b, '\t'); p->pos++; break;
    case 'u': {
      p->pos++;
      int32_t cp = scr_json_hex4(p);
      if (cp < 0) {
        scr_jb_dispose(&b);
        return NULL;
      }
      if (cp >= 0xD800 && cp <= 0xDBFF) {
        /* High surrogate: combine with a following \uDC00-\uDFFF; a lone
         * surrogate becomes U+FFFD (house policy: strings stay well-formed
         * UTF-8 — JS would keep the lone surrogate; see SEMANTICS.md). */
        if (p->len - p->pos >= 2 && p->s[p->pos] == '\\' && p->s[p->pos + 1] == 'u') {
          size_t save = p->pos;
          p->pos += 2;
          int32_t lo = scr_json_hex4(p);
          if (lo < 0) {
            scr_jb_dispose(&b);
            return NULL;
          }
          if (lo >= 0xDC00 && lo <= 0xDFFF) {
            uint32_t combined =
                0x10000 + (((uint32_t)cp - 0xD800) << 10) + ((uint32_t)lo - 0xDC00);
            scr_json_put_cp(&b, combined);
            break;
          }
          /* Not a low surrogate: emit U+FFFD, reparse the escape normally. */
          p->pos = save;
          scr_json_put_cp(&b, 0xFFFD);
          break;
        }
        scr_json_put_cp(&b, 0xFFFD);
        break;
      }
      if (cp >= 0xDC00 && cp <= 0xDFFF) {
        scr_json_put_cp(&b, 0xFFFD); /* lone low surrogate */
        break;
      }
      scr_json_put_cp(&b, (uint32_t)cp);
      break;
    }
    default:
      scr_jb_dispose(&b);
      scr_json_throw_pos("Bad escaped character", p->pos);
      return NULL;
    }
  }
}

/* String literal at p->pos as a +1 ScrStr (span fast path, escapes via the
 * slow path). NULL on error (thrown). */
static ScrStr *scr_json_string_scr(ScrJsonP *p) {
  const char *span;
  size_t span_len;
  int r = scr_json_string_span(p, &span, &span_len);
  if (r < 0) return NULL;
  if (r > 0) return scr_str_new(span, span_len);
  return scr_json_string_slow(p);
}

static ScrDyn *scr_json_value(ScrJsonP *p);

/* Exact powers of ten: 10^k is an exact double for k <= 22. */
static const double scr_json_pow10[23] = {
    1e0,  1e1,  1e2,  1e3,  1e4,  1e5,  1e6,  1e7,  1e8,  1e9,  1e10, 1e11,
    1e12, 1e13, 1e14, 1e15, 1e16, 1e17, 1e18, 1e19, 1e20, 1e21, 1e22};

static ScrDyn *scr_json_number(ScrJsonP *p) {
  size_t start = p->pos;
  /* Grammar validation and value accumulation in one pass. Clinger's fast
   * path: with at most 15 significant digits the mantissa is exact in a
   * double, and scaling by an exact power of ten (|exp| <= 22) rounds
   * once — bit-identical to strtod. Everything else falls back. */
  uint64_t mant = 0;
  int ndig = 0;   /* significant digits folded into mant */
  int exp10 = 0;  /* decimal exponent (fraction shift + explicit exponent) */
  bool neg = false, precise = true;
  if (p->s[p->pos] == '-') {
    neg = true;
    p->pos++;
    if (p->pos >= p->len || p->s[p->pos] < '0' || p->s[p->pos] > '9') {
      scr_json_throw_pos("No number after minus sign", p->pos);
      return NULL;
    }
  }
  if (p->s[p->pos] == '0') {
    p->pos++;
  } else {
    while (p->pos < p->len && p->s[p->pos] >= '0' && p->s[p->pos] <= '9') {
      if (ndig < 15) {
        mant = mant * 10 + (uint64_t)(p->s[p->pos] - '0');
        ndig++;
      } else {
        precise = false;
      }
      p->pos++;
    }
  }
  if (p->pos < p->len && p->s[p->pos] == '.') {
    p->pos++;
    if (p->pos >= p->len || p->s[p->pos] < '0' || p->s[p->pos] > '9') {
      scr_json_throw_pos("Unterminated fractional number", p->pos);
      return NULL;
    }
    while (p->pos < p->len && p->s[p->pos] >= '0' && p->s[p->pos] <= '9') {
      unsigned digit = (unsigned)(p->s[p->pos] - '0');
      if (mant == 0 && digit == 0) {
        exp10--; /* leading fractional zeros scale without a digit */
      } else if (ndig < 15) {
        mant = mant * 10 + digit;
        ndig++;
        exp10--;
      } else {
        precise = false;
      }
      p->pos++;
    }
  }
  if (p->pos < p->len && (p->s[p->pos] == 'e' || p->s[p->pos] == 'E')) {
    p->pos++;
    bool eneg = false;
    if (p->pos < p->len && (p->s[p->pos] == '+' || p->s[p->pos] == '-')) {
      eneg = p->s[p->pos] == '-';
      p->pos++;
    }
    if (p->pos >= p->len || p->s[p->pos] < '0' || p->s[p->pos] > '9') {
      scr_json_throw_pos("Exponent part is missing a number", p->pos);
      return NULL;
    }
    int ev = 0;
    while (p->pos < p->len && p->s[p->pos] >= '0' && p->s[p->pos] <= '9') {
      if (ev < 100000) ev = ev * 10 + (p->s[p->pos] - '0');
      p->pos++;
    }
    exp10 += eneg ? -ev : ev;
  }
  ScrDyn *d = scr_dyn_alloc(SCR_DYN_NUM);
  if (precise && exp10 >= -22 && exp10 <= 22) {
    double v = (double)mant; /* exact: mant < 10^15 < 2^53 */
    if (exp10 > 0) v *= scr_json_pow10[exp10];
    else if (exp10 < 0) v /= scr_json_pow10[-exp10];
    d->v.num = neg ? -v : v;
    return d;
  }
  /* The validated span re-parses with strtod (correctly rounded, and the
   * grammar above is a strict subset of what strtod accepts). The ScrStr
   * data is NUL-terminated, and strtod stops at the first non-number char,
   * so parsing from `start` reads exactly the validated token. */
  d->v.num = strtod(p->s + start, NULL);
  return d;
}

static bool scr_json_lit(ScrJsonP *p, const char *word, size_t n) {
  if (p->len - p->pos >= n && memcmp(p->s + p->pos, word, n) == 0) {
    p->pos += n;
    return true;
  }
  scr_json_throw_token(p);
  return false;
}

static ScrDyn *scr_json_array(ScrJsonP *p) {
  p->pos++; /* '[' */
  ScrDyn *arr = scr_dyn_alloc(SCR_DYN_ARR);
  scr_json_ws(p);
  if (p->pos < p->len && p->s[p->pos] == ']') {
    p->pos++;
    return arr;
  }
  for (;;) {
    ScrDyn *item = scr_json_value(p);
    if (!item) {
      scr_dyn_release(arr);
      return NULL;
    }
    scr_dyn_arr_push(arr, item);
    scr_json_ws(p);
    if (p->pos >= p->len) {
      scr_dyn_release(arr);
      scr_json_throw("Unexpected end of JSON input");
      return NULL;
    }
    if (p->s[p->pos] == ',') {
      p->pos++;
      continue;
    }
    if (p->s[p->pos] == ']') {
      p->pos++;
      return arr;
    }
    scr_dyn_release(arr);
    scr_json_throw_pos("Expected ',' or ']' after array element", p->pos);
    return NULL;
  }
}

static ScrDyn *scr_json_object(ScrJsonP *p) {
  p->pos++; /* '{' */
  ScrDyn *obj = scr_dyn_alloc(SCR_DYN_OBJ);
  scr_json_ws(p);
  if (p->pos < p->len && p->s[p->pos] == '}') {
    p->pos++;
    return obj;
  }
  for (;;) {
    scr_json_ws(p);
    if (p->pos >= p->len) {
      scr_dyn_release(obj);
      scr_json_throw("Unexpected end of JSON input");
      return NULL;
    }
    if (p->s[p->pos] != '"') {
      scr_dyn_release(obj);
      scr_json_throw_pos("Expected property name or '}'", p->pos);
      return NULL;
    }
    /* Key: fast span path (no escapes) copies straight into the malloc'd
     * key buffer; the slow path decodes into a ScrStr first. */
    size_t key_len = 0;
    char *key;
    {
      const char *span;
      size_t span_len;
      int r = scr_json_string_span(p, &span, &span_len);
      if (r < 0) {
        scr_dyn_release(obj);
        return NULL;
      }
      if (r > 0) {
        key = malloc(span_len + 1);
        if (!key) scr_json_oom();
        memcpy(key, span, span_len);
        key[span_len] = '\0';
        key_len = span_len;
      } else {
        ScrStr *ks = scr_json_string_slow(p);
        if (!ks) {
          scr_dyn_release(obj);
          return NULL;
        }
        key = malloc(ks->len + 1);
        if (!key) scr_json_oom();
        memcpy(key, ks->data, ks->len + 1);
        key_len = ks->len;
        scr_str_release(ks);
      }
    }
    scr_json_ws(p);
    if (p->pos >= p->len || p->s[p->pos] != ':') {
      free(key);
      scr_dyn_release(obj);
      if (p->pos >= p->len) scr_json_throw("Unexpected end of JSON input");
      else scr_json_throw_pos("Expected ':' after property name", p->pos);
      return NULL;
    }
    p->pos++; /* ':' */
    ScrDyn *value = scr_json_value(p);
    if (!value) {
      free(key);
      scr_dyn_release(obj);
      return NULL;
    }
    scr_dyn_obj_put(obj, key, key_len, value); /* later duplicate keys win */
    scr_json_ws(p);
    if (p->pos >= p->len) {
      scr_dyn_release(obj);
      scr_json_throw("Unexpected end of JSON input");
      return NULL;
    }
    if (p->s[p->pos] == ',') {
      p->pos++;
      continue;
    }
    if (p->s[p->pos] == '}') {
      p->pos++;
      return obj;
    }
    scr_dyn_release(obj);
    scr_json_throw_pos("Expected ',' or '}' after property value", p->pos);
    return NULL;
  }
}

static ScrDyn *scr_json_value(ScrJsonP *p) {
  scr_json_ws(p);
  if (p->pos >= p->len) {
    scr_json_throw("Unexpected end of JSON input");
    return NULL;
  }
  char c = p->s[p->pos];
  if (c == '{' || c == '[') {
    if (++p->depth > SCR_JSON_MAX_DEPTH) {
      /* JS overflows the engine stack here (RangeError); a native recursive
       * descent must cap instead. Same message and kind, catchable. */
      const char msg[] = "Maximum call stack size exceeded";
      scr_throw_error_msg(SCR_ERR_RANGE, msg, sizeof msg - 1);
      return NULL;
    }
    ScrDyn *d = c == '{' ? scr_json_object(p) : scr_json_array(p);
    p->depth--;
    return d;
  }
  if (c == '"') {
    ScrStr *sv = scr_json_string_scr(p);
    if (!sv) return NULL;
    ScrDyn *d = scr_dyn_alloc(SCR_DYN_STR);
    d->v.str = sv;
    return d;
  }
  if (c == 't') {
    if (!scr_json_lit(p, "true", 4)) return NULL;
    ScrDyn *d = scr_dyn_alloc(SCR_DYN_BOOL);
    d->v.b = true;
    return d;
  }
  if (c == 'f') {
    if (!scr_json_lit(p, "false", 5)) return NULL;
    ScrDyn *d = scr_dyn_alloc(SCR_DYN_BOOL);
    d->v.b = false;
    return d;
  }
  if (c == 'n') {
    if (!scr_json_lit(p, "null", 4)) return NULL;
    return scr_dyn_alloc(SCR_DYN_NULL);
  }
  if (c == '-' || (c >= '0' && c <= '9')) return scr_json_number(p);
  scr_json_throw_token(p);
  return NULL;
}

ScrDyn *scr_json_parse(ScrStr *text) {
  ScrJsonP p = { text->data, text->len, 0, 0 };
  scr_json_ws(&p);
  if (p.pos >= p.len) {
    scr_json_throw("Unexpected end of JSON input");
    return NULL;
  }
  ScrDyn *d = scr_json_value(&p);
  if (!d) return NULL;
  scr_json_ws(&p);
  if (p.pos < p.len) {
    scr_dyn_release(d);
    char buf[96];
    int n = snprintf(buf, sizeof buf,
                     "Unexpected non-whitespace character after JSON at position %zu", p.pos);
    scr_throw_error_msg(SCR_ERR_SYNTAX, buf, (size_t)n);
    return NULL;
  }
  return d;
}

/* Untyped RC adapters (box/promise/exception-cell currency). */
void *scr_dyn_retain_v(void *d) { return scr_dyn_retain((ScrDyn *)d); }
void scr_dyn_release_v(void *d) { scr_dyn_release((ScrDyn *)d); }

/* JS === over two dyn values: scalars by value (NaN false, ±0 equal via
 * C ==; strings bytewise), units by kind, everything reference-shaped by
 * node IDENTITY (the checked-dynamic tree's object identity). Never throws. */
bool scr_dyn_strict_eq(const ScrDyn *a, const ScrDyn *b) {
  if (a->kind != b->kind) return false;
  switch (a->kind) {
  case SCR_DYN_UNDEF:
  case SCR_DYN_NULL: return true;
  case SCR_DYN_BOOL: return a->v.b == b->v.b;
  case SCR_DYN_NUM: return a->v.num == b->v.num;
  case SCR_DYN_STR:
    return a->v.str->len == b->v.str->len &&
           memcmp(a->v.str->data, b->v.str->data, a->v.str->len) == 0;
  case SCR_DYN_FUNC:
    /* The ScrDyn box is a boundary artifact — one closure crossing the
     * dyn boundary twice is still ONE JS function value, so identity
     * lives in the boxed closure, not the box. */
    return a == b || a->v.fn.clo == b->v.fn.clo;
  case SCR_DYN_HANDLE:
    /* Same story: identity is the HANDLE — one req boxed into two
     * listeners is still one JS object. */
    return a->v.handle.tag == b->v.handle.tag && a->v.handle.ptr == b->v.handle.ptr;
  case SCR_DYN_PROMISE:
    /* And the PROMISE: one promise crossing twice is one JS value. */
    return a->v.promise == b->v.promise;
  case SCR_DYN_JSVAL:
    /* Identity is the ENGINE VALUE, not the box or even the cell: two
     * wraps of one engine value compare ===-equal (the engine's own
     * strict equality answers). Mixed kinds already answered false above
     * — a dyn copy is a different object, which is Node's answer too. */
    return a == b || scr_dyn_jsval_ops()->strict_eq(a->v.jsval.cell, b->v.jsval.cell);
  default: return a == b;
  }
}

/* Keyed read on a FUNC node (see scr_runtime.h): own props first, then
 * the function-instance built-ins name/length. +1 or NULL. */
ScrDyn *scr_dyn_fn_get(const ScrDyn *d, const char *key, size_t key_len) {
  if (d->v.fn.clo->props) {
    ScrDyn *table = (ScrDyn *)scr_box_get_ref(d->v.fn.clo->props); /* +1 */
    ScrDyn *m = table ? scr_dyn_obj_get(table, key, key_len) : NULL;
    ScrDyn *r = m ? scr_dyn_retain(m) : NULL;
    scr_dyn_release(table);
    if (r) return r;
  }
  if (key_len == 4 && memcmp(key, "name", 4) == 0) {
    const char *n = d->v.fn.name ? d->v.fn.name : "";
    ScrStr *s = scr_str_new(n, strlen(n));
    ScrDyn *r = scr_dyn_new_str(s); /* retains */
    scr_str_release(s);
    return r;
  }
  if (key_len == 6 && memcmp(key, "length", 6) == 0) {
    return scr_dyn_new_num((double)d->v.fn.arity);
  }
  /* `F.prototype` on a function that never assigned one: JS has ALREADY
   * created that object (a function declaration owns a writable
   * `prototype` own property from the moment it exists), so answering
   * undefined here would make `F.prototype.m = fn` — the whole pre-class
   * method idiom — a TypeError where Node succeeds. Mint it on demand
   * into the same table an explicit assignment writes to. */
  if (key_len == 9 && memcmp(key, "prototype", 9) == 0) {
    return scr_dyn_fn_prototype((ScrDyn *)d);
  }
  return NULL;
}

/* The FUNC node's own-property table, allocated on first write (see
 * scr_runtime.h). It hangs off the CLOSURE, so every box of one function
 * value shares it — which is what makes a per-USE box correct: JS has one
 * function object per closure, not one per boundary crossing. +1. */
ScrDyn *scr_dyn_fn_props(ScrDyn *d) {
  if (!d->v.fn.clo->props) {
    ScrBox *box = scr_box_new_obj(&scr_dyn_retain_v, &scr_dyn_release_v, NULL);
    ScrDyn *table = scr_dyn_new_obj();
    scr_box_set_ref(box, table); /* the box owns the fresh table */
    d->v.fn.clo->props = box;
  }
  return (ScrDyn *)scr_box_get_ref(d->v.fn.clo->props); /* +1 */
}

/* The FUNC node's `prototype` OBJECT, minted on first demand and stored
 * in the own-property table (see scr_runtime.h for why it carries no
 * `constructor`). One object per CLOSURE, like every other member. +1. */
ScrDyn *scr_dyn_fn_prototype(ScrDyn *fn) {
  ScrDyn *table = scr_dyn_fn_props(fn); /* +1 */
  ScrDyn *existing = scr_dyn_obj_get(table, "prototype", 9); /* borrowed */
  if (existing != NULL) {
    ScrDyn *r = scr_dyn_retain(existing);
    scr_dyn_release(table);
    return r;
  }
  ScrDyn *proto = scr_dyn_new_obj(); /* +1 */
  /* The constructor NAME rides on the prototype object so instances can
   * copy it for util.inspect ("F { a: 1 }"). It is the FUNC box's static
   * literal — no ownership, so no cycle. */
  proto->v.obj.cname = fn->v.fn.name;
  scr_dyn_obj_set(table, "prototype", 9, scr_dyn_retain(proto)); /* table owns one */
  scr_dyn_release(table);
  return proto; /* the caller's +1 */
}

/* Is this dyn value an OBJECT to JavaScript? The five scalar kinds are
 * not; everything else is (a function, an array, a Buffer, a native
 * handle, a promise and an engine value all answer "object" or
 * "function" to typeof, and all are Objects to the spec's Type()).
 * `instanceof` asks the question three times, in three different places,
 * and gets a different wrong answer each time if it guesses. */
static bool scr_dyn_is_object_kind(const ScrDyn *d) {
  switch (d->kind) {
    case SCR_DYN_NULL:
    case SCR_DYN_BOOL:
    case SCR_DYN_NUM:
    case SCR_DYN_STR:
    case SCR_DYN_UNDEF:
      return false;
    default:
      return true;
  }
}

/* JS's OrdinaryHasInstance, `v instanceof f`: walk v's [[Prototype]]
 * chain looking for the SAME object f.prototype answers. Pointer
 * identity, not a name or shape match — two functions with identical
 * bodies are different constructors, exactly Node.
 *
 * The THREE throws are the operator's, not decoration, and their ORDER
 * is observable — the spec interleaves them with the answer:
 *
 *   1. a non-object right operand   → "…is not an object"
 *   2. an object that is not callable → "…is not callable"
 *   3. a non-object LEFT operand      → false, before anything else is
 *      asked (`7 instanceof F` is false even when F.prototype is 5)
 *   4. a right operand whose `prototype` is not an object
 *                                     → "Function has non-object
 *                                        prototype 'X' in instanceof
 *                                        check"
 *
 * Answering false for 1, 2 and 4 — which is what this did before — is a
 * silent wrong answer at exactly the sites a program writes the operator
 * to find out. Only step 3 is a false.
 *
 * The right operand's prototype object is DEMANDED (minted if this is
 * the first time anyone asked), because otherwise the answer would
 * depend on whether some earlier read happened to mint it. */
bool scr_dyn_instance_of(const ScrDyn *v, ScrDyn *fn) {
  /* An engine-held right operand IS callable to the engine — answering
   * false, or claiming it is not an object, would both be wrong. The
   * island route (lowerInstanceOf's jsOp arm) is where that operator
   * belongs; reaching here means it did not, so: loud. */
  if (fn->kind == SCR_DYN_JSVAL) {
    scr_dyn_isl_fence(fn, "'instanceof' against an engine value");
    return false;
  }
  if (!scr_dyn_is_object_kind(fn)) {
    static const char msg[] = "Right-hand side of 'instanceof' is not an object";
    scr_throw_error_msg(SCR_ERR_TYPE, msg, sizeof msg - 1);
    return false;
  }
  if (fn->kind != SCR_DYN_FUNC) {
    static const char msg[] = "Right-hand side of 'instanceof' is not callable";
    scr_throw_error_msg(SCR_ERR_TYPE, msg, sizeof msg - 1);
    return false;
  }
  /* Step 3: a primitive left operand is false and asks no further
   * question — the prototype check below never runs for it. */
  if (!scr_dyn_is_object_kind(v)) return false;
  ScrDyn *proto = scr_dyn_fn_prototype(fn); /* +1 */
  if (!scr_dyn_is_object_kind(proto)) {
    /* V8 renders the offending value with String() — 'null',
     * 'undefined', '5', 'NaN', 'true', the string itself. */
    ScrStr *shown = scr_dyn_string_coerce(proto); /* +1 */
    ScrJsonBuf b;
    scr_jb_init(&b);
    scr_jb_puts(&b, "Function has non-object prototype '");
    if (shown != NULL) scr_jb_write(&b, shown->data, shown->len);
    scr_jb_puts(&b, "' in instanceof check");
    scr_str_release(shown);
    scr_dyn_release(proto);
    scr_throw_error(SCR_ERR_TYPE, scr_jb_finish(&b));
    return false;
  }
  bool found = false;
  /* Only an OBJ carries a [[Prototype]] link here, so every other object
   * kind has an empty chain and answers false — which is the right
   * answer for the constructors this route can name (a user function),
   * since nothing links an array or a Buffer to one. */
  const ScrDyn *p = v->kind == SCR_DYN_OBJ ? v->v.obj.proto : NULL;
  for (size_t steps = 0; p != NULL && steps < SCR_PROTO_MAX_DEPTH; steps++) {
    if (p == proto) { found = true; break; }
    if (p->kind != SCR_DYN_OBJ) break;
    p = p->v.obj.proto;
  }
  scr_dyn_release(proto);
  return found;
}

/* Object.create(<proto>): a fresh object whose [[Prototype]] is the
 * argument — the SAME link `new` installs, so everything already true of
 * a constructed instance is true of this one (reads delegate live,
 * writes shadow, own-key walks list nothing).
 *
 * The argument must be an Object or null; a primitive takes V8's
 * catchable "Object prototype may only be an Object or null: X", which
 * renders the offending value. null goes to the null-prototype
 * dictionary, which is where `Object.create(null)` has always landed —
 * a runtime-valued null reaches here too (the compile-time literal is
 * folded to objCreateNullProto at the call site).
 *
 * Only an OBJ can BE a link here (the field is on the OBJ arm), so the
 * other object kinds take the loud fence rather than a chain that
 * silently ends one step early. */
ScrDyn *scr_dyn_obj_create_proto(const ScrDyn *proto) {
  if (proto->kind == SCR_DYN_NULL) return scr_dyn_new_obj_null_proto();
  if (!scr_dyn_is_object_kind(proto)) {
    ScrStr *shown = scr_dyn_string_coerce(proto); /* +1 */
    ScrJsonBuf b;
    scr_jb_init(&b);
    scr_jb_puts(&b, "Object prototype may only be an Object or null: ");
    if (shown != NULL) scr_jb_write(&b, shown->data, shown->len);
    scr_str_release(shown);
    scr_throw_error(SCR_ERR_TYPE, scr_jb_finish(&b));
    return NULL;
  }
  if (proto->kind != SCR_DYN_OBJ) {
    ScrJsonBuf fb;
    scr_jb_init(&fb);
    scr_jb_puts(&fb, "Object.create over a '");
    scr_jb_puts(&fb, scr_dyn_kind_name(proto));
    scr_jb_puts(&fb, "' prototype is not supported yet"
                     " (the [[Prototype]] link holds a plain object here — pass a plain"
                     " object, or null)");
    scr_throw_error(SCR_ERR_ERROR, scr_jb_finish(&fb));
    return NULL;
  }
  ScrDyn *o = scr_dyn_new_obj(); /* +1 */
  scr_dyn_obj_set_proto(o, (ScrDyn *)proto);
  /* The created object shows under the constructor NAME its prototype
   * carries, exactly as an instance does — `Object.create(P.prototype)`
   * IS the object a `new P()` would have linked to. */
  o->v.obj.cname = proto->v.obj.cname;
  return o;
}

ScrDyn *scr_dyn_construct(const ScrDyn *fn, const ScrDyn *args, const ScrStr *what) {
  if (fn->kind != SCR_DYN_FUNC) {
    ScrJsonBuf b;
    scr_jb_init(&b);
    scr_jb_puts(&b, what && what->len ? what->data : "value");
    scr_jb_puts(&b, " is not a constructor");
    scr_throw_error(SCR_ERR_TYPE, scr_jb_finish(&b));
    return NULL;
  }
  ScrDyn *proto = scr_dyn_fn_prototype((ScrDyn *)fn); /* +1 */
  ScrDyn *inst = scr_dyn_new_obj();                   /* +1 */
  /* OrdinaryCreateFromConstructor: a `prototype` that is not an OBJECT
   * is IGNORED and the instance gets %Object.prototype% instead
   * (`F.prototype = 5; new F()` is a plain object in Node, and inspect
   * prints `{}` rather than `F {}` because the name rides the prototype
   * that was replaced). A plain literal's NULL link IS that object here
   * — own-only lookup is what %Object.prototype% contributes to this
   * tier — so the link and the name both simply stay unset.
   *
   * Reading `proto->v.obj.cname` unconditionally, as this did before,
   * read the `cname` slot out of a NUM/STR node's union: a stale pointer
   * left by whatever OBJ last occupied that freelist cell, handed
   * straight to util.inspect. */
  if (proto->kind == SCR_DYN_OBJ) {
    scr_dyn_obj_set_proto(inst, proto);
    inst->v.obj.cname = proto->v.obj.cname;
  } else if (scr_dyn_is_object_kind(proto)) {
    /* An OBJECT that is not a plain one — `F.prototype = []`, a Buffer,
     * another function. JS links the instance to it and inherited reads
     * walk into it; nothing here can hold such a link, and silently
     * falling back to %Object.prototype% would make `instanceof` answer
     * false where Node answers true. Loud. */
    ScrJsonBuf fb;
    scr_jb_init(&fb);
    scr_jb_puts(&fb, "constructing with a '");
    scr_jb_puts(&fb, scr_dyn_kind_name(proto));
    scr_jb_puts(&fb, "' as the function's 'prototype' is not supported yet"
                     " (the instance's [[Prototype]] link holds a plain object here;"
                     " assign a plain object, or Object.create(<proto>), to '.prototype')");
    scr_dyn_release(proto);
    scr_dyn_release(inst);
    scr_throw_error(SCR_ERR_ERROR, scr_jb_finish(&fb));
    return NULL;
  }
  scr_dyn_release(proto);

  /* JS binds the fresh object as the constructor's `this` — the body's
   * `this.x = v` writes are plain keyed writes onto it (the ambient
   * receiver window `this` in a plain JS function already reads). */
  scr_dyn_this_push_dyn(inst);
  ScrDyn *r = scr_dyn_call(fn, args->kind == SCR_DYN_ARR ? args->v.arr.items : NULL,
                           args->kind == SCR_DYN_ARR ? args->v.arr.len : 0,
                           what && what->len ? what->data : "value");
  scr_dyn_this_pop();
  if (scr_exc_pending()) {
    scr_dyn_release(r); /* NULL-tolerant */
    scr_dyn_release(inst);
    return NULL;
  }
  /* [[Construct]]'s return rule: an OBJECT result replaces the instance,
   * anything else (the overwhelmingly common `return;`) is discarded. */
  if (r != NULL && (r->kind == SCR_DYN_OBJ || r->kind == SCR_DYN_ARR ||
                    r->kind == SCR_DYN_FUNC || r->kind == SCR_DYN_BYTES ||
                    r->kind == SCR_DYN_HANDLE || r->kind == SCR_DYN_PROMISE ||
                    r->kind == SCR_DYN_JSVAL)) {
    scr_dyn_release(inst);
    return r;
  }
  scr_dyn_release(r);
  return inst;
}

/* ── structuredClone over the checked-dynamic tree ─────────────────────────────────────
 * The JSON-safe subset plus bytes, deep. Functions and handle kinds
 * throw the spec's catchable DataCloneError; cycles throw the scriptc
 * fence (the checked-dynamic tree cannot represent them — Node clones cycles; documented
 * divergence). Option validation throws Node's exact TypeErrors and is
 * shared with scr_domex_clone. */

void scr_sc_validate_options(const ScrDyn *options) {
  if (options == NULL || options->kind == SCR_DYN_UNDEF || options->kind == SCR_DYN_NULL) return;
  /* An engine-held options bag IS a dictionary to Node — the "cannot be
   * converted" TypeError would be a wrong claim. Loud fence. */
  if (options->kind == SCR_DYN_JSVAL) {
    scr_dyn_isl_fence(options, "structuredClone options");
    return;
  }
  if (options->kind != SCR_DYN_OBJ) {
    static const char msg[] =
        "Failed to execute 'structuredClone': Options cannot be converted to a dictionary";
    scr_throw_error_msg_code(SCR_ERR_TYPE, msg, sizeof msg - 1, "ERR_INVALID_ARG_TYPE");
    return;
  }
  ScrDyn *tr = scr_dyn_obj_get(options, "transfer", 8); /* borrowed */
  if (tr == NULL || tr->kind == SCR_DYN_UNDEF) return;
  if (tr->kind != SCR_DYN_ARR) {
    static const char msg[] =
        "Failed to execute 'structuredClone': transfer in Options can not be converted to sequence.";
    scr_throw_error_msg_code(SCR_ERR_TYPE, msg, sizeof msg - 1, "ERR_INVALID_ARG_TYPE");
    return;
  }
  if (tr->v.arr.len > 0) {
    /* Nothing in the static world is transferable — Node's own error for
     * a non-transferable list member. */
    scr_throw_domex("DataCloneError", "Found invalid value in transferList.");
  }
}

/* The parent chain rides the C stack: a revisit is a cycle. */
typedef struct ScrScParent {
  const ScrDyn *node;
  const struct ScrScParent *up;
} ScrScParent;

static ScrDyn *scr_sc_clone(const ScrDyn *v, const ScrScParent *up) {
  switch (v->kind) {
  case SCR_DYN_UNDEF:
    return scr_dyn_retain(scr_dyn_undefined());
  case SCR_DYN_NULL:
    return scr_dyn_new_null();
  case SCR_DYN_BOOL:
    return scr_dyn_new_bool(v->v.b);
  case SCR_DYN_NUM:
    return scr_dyn_new_num(v->v.num);
  case SCR_DYN_STR:
    return scr_dyn_new_str(v->v.str);
  case SCR_DYN_BYTES:
    /* A fresh byte copy; the Buffer flavor drops (Node: structuredClone
     * of a Buffer answers a plain Uint8Array). */
    return scr_dyn_new_bytes_copy(v->v.bytes);
  case SCR_DYN_ARR:
  case SCR_DYN_OBJ: {
    for (const ScrScParent *p = up; p != NULL; p = p->up) {
      if (p->node == v) {
        static const char msg[] =
            "structuredClone of cyclic values (the checked-dynamic tree cannot represent cycles) is not supported yet";
        scr_throw_error_msg(SCR_ERR_ERROR, msg, sizeof msg - 1);
        return NULL;
      }
    }
    ScrScParent self = {v, up};
    if (v->kind == SCR_DYN_ARR) {
      ScrDyn *out = scr_dyn_new_arr();
      for (size_t i = 0; i < v->v.arr.len; i++) {
        ScrDyn *c = scr_sc_clone(v->v.arr.items[i], &self);
        if (c == NULL) { /* threw */
          scr_dyn_release(out);
          return NULL;
        }
        scr_dyn_arr_push(out, c); /* ownership moves */
      }
      return out;
    }
    ScrDyn *out = scr_dyn_new_obj();
    for (size_t i = 0; i < v->v.obj.len; i++) {
      const ScrDynEntry *e = &v->v.obj.entries[i];
      ScrDyn *c = scr_sc_clone(e->value, &self);
      if (c == NULL) {
        scr_dyn_release(out);
        return NULL;
      }
      scr_dyn_obj_set(out, e->key, e->key_len, c); /* ownership moves */
    }
    return out;
  }
  case SCR_DYN_JSVAL:
    /* Node CLONES a plain engine object — the DataCloneError default
     * below would be a wrong claim, and fabricating a shape would be a
     * silent wrong answer. Loud fence (lane dom-jsval-long-tail). */
    scr_dyn_isl_fence(v, "structuredClone");
    return NULL;
  case SCR_DYN_FUNC:
  case SCR_DYN_HANDLE:
  default: {
    /* Node renders the value's source text; the checked-dynamic tree has none — the
     * String() rendering stands in ("function () { [native code] } could
     * not be cloned."). */
    ScrStr *what = scr_dyn_string_coerce(v);
    static const char suffix[] = " could not be cloned.";
    size_t len = what->len + sizeof suffix - 1;
    char *msg = malloc(len + 1);
    if (!msg) {
      scr_trap("scriptc: out of memory\n");
    }
    memcpy(msg, what->data, what->len);
    memcpy(msg + what->len, suffix, sizeof suffix);
    scr_str_release(what);
    ScrStr *m = scr_str_new(msg, len);
    free(msg);
    scr_throw_domex_str("DataCloneError", m); /* takes ownership of m */
    return NULL;
  }
  }
}

ScrDyn *scr_structured_clone(const ScrDyn *value, const ScrDyn *options) {
  scr_sc_validate_options(options);
  if (scr_exc_pending()) return NULL;
  return scr_sc_clone(value, NULL);
}

ScrDyn *scr_structured_clone_transfer_fail(void) {
  scr_throw_domex("DataCloneError", "Found invalid value in transferList.");
  return NULL;
}

ScrDyn *scr_structured_clone_missing(void) {
  /* Node's message, verbatim (its own template double-wraps the text). */
  static const char msg[] =
      "The \"The value argument must be specified\" argument must be specified";
  scr_throw_error_msg_code(SCR_ERR_TYPE, msg, sizeof msg - 1, "ERR_MISSING_ARGS");
  return NULL;
}

bool scr_dyn_err_instanceof(const ScrDyn *d, double kind) {
  /* A JSVAL node never came from a runtime ScrError, so the cache miss
   * below answers false — the documented contract ("a dyn value that
   * never came from an error answers false"). An ENGINE TypeError held
   * in 'unknown' thus answers false where Node answers true: covered by
   * lane dom-jsval-long-tail (needs the engine's class instanceof). */
  for (size_t i = 0; i < scr_errdyn_n; i++) {
    if (scr_errdyn_cache[i].dyn == d) {
      const ScrVt *vt = scr_errdyn_cache[i].err->vt;
      int k = (int)kind;
      return scr_error_vts[k].pre <= vt->pre && vt->pre <= scr_error_vts[k].post;
    }
  }
  return false;
}

/* ── Object.keys/values/entries over the checked-dynamic tree ──────────────────────────
 * JS own-key order: array-index keys ascending first, then the rest in
 * insertion order. entries answers [key, value] pairs; values RETAIN
 * the member nodes (reference semantics, like JS). Strings/arrays/bytes
 * answer their index keys; other scalars an empty array; null/undefined
 * throw Node's catchable TypeError. */

/* The array-index test (ECMA: a canonical numeric string < 2^32-1).
 * Forward-declared above scr_dyn_obj_key_order, the single own-key-order
 * projection this runtime enumerates through. */
static bool scr_dyn_key_is_index(const char *key, size_t len, double *out) {
  if (len == 0 || len > 10) return false;
  if (key[0] == '0' && len > 1) return false;
  double v = 0;
  for (size_t i = 0; i < len; i++) {
    if (key[i] < '0' || key[i] > '9') return false;
    v = v * 10 + (key[i] - '0');
  }
  if (v > 4294967294.0) return false;
  *out = v;
  return true;
}

typedef enum { SCR_OBJWALK_KEYS, SCR_OBJWALK_VALUES, SCR_OBJWALK_ENTRIES } ScrObjWalk;

/* A fresh key string boxed into the checked-dynamic tree: scr_dyn_new_str RETAINS its
 * argument, so the local +1 drops right after. */
static ScrDyn *scr_dyn_objwalk_key(const char *key, size_t key_len) {
  ScrStr *k = scr_str_new(key, key_len);
  ScrDyn *d = scr_dyn_new_str(k);
  scr_str_release(k);
  return d;
}

static void scr_dyn_objwalk_push(ScrDyn *out, ScrObjWalk mode, const char *key,
                                 size_t key_len, ScrDyn *value /* borrowed */) {
  switch (mode) {
  case SCR_OBJWALK_KEYS:
    scr_dyn_arr_push(out, scr_dyn_objwalk_key(key, key_len));
    break;
  case SCR_OBJWALK_VALUES:
    scr_dyn_arr_push(out, scr_dyn_retain(value));
    break;
  case SCR_OBJWALK_ENTRIES: {
    ScrDyn *pair = scr_dyn_new_arr();
    scr_dyn_arr_push(pair, scr_dyn_objwalk_key(key, key_len));
    scr_dyn_arr_push(pair, scr_dyn_retain(value));
    scr_dyn_arr_push(out, pair);
    break;
  }
  }
}

static ScrDyn *scr_dyn_objwalk(const ScrDyn *v, ScrObjWalk mode) {
  if (v->kind == SCR_DYN_UNDEF || v->kind == SCR_DYN_NULL) {
    static const char msg[] = "Cannot convert undefined or null to object";
    scr_throw_error_msg(SCR_ERR_TYPE, msg, sizeof msg - 1);
    return NULL;
  }
  if (v->kind == SCR_DYN_JSVAL) {
    /* The ENGINE walks its own object (own-key order, getters running,
     * Object.entries' pairs) and the results come back as a NATIVE dyn
     * array — keys are dyn strings, values wrap per element. */
    return scr_dyn_jsval_ops()->obj_walk(v->v.jsval.cell, (int)mode);
  }
  ScrDyn *out = scr_dyn_new_arr();
  if (v->kind == SCR_DYN_OBJ) {
    /* JS's own-key order, from the shared projection. This used to be a
     * private two-pass selection scan living only here, which is how
     * Object.keys ended up right while JSON.stringify, util.format's %j
     * and util.inspect were all wrong about the same object. */
    size_t *ord = scr_dyn_obj_key_order(v);
    for (size_t oi = 0; oi < v->v.obj.len; oi++) {
      const ScrDynEntry *e = &v->v.obj.entries[ord ? ord[oi] : oi];
      scr_dyn_objwalk_push(out, mode, e->key, e->key_len, e->value);
    }
    free(ord);
    return out;
  }
  if (v->kind == SCR_DYN_ARR || v->kind == SCR_DYN_BYTES) {
    size_t n = v->kind == SCR_DYN_ARR ? v->v.arr.len : v->v.bytes->len;
    for (size_t i = 0; i < n; i++) {
      char key[24];
      int klen = snprintf(key, sizeof key, "%zu", i);
      ScrDyn *val = NULL;
      if (mode != SCR_OBJWALK_KEYS) {
        val = v->kind == SCR_DYN_ARR ? scr_dyn_retain(v->v.arr.items[i])
                                     : scr_dyn_new_num((double)v->v.bytes->data[i]);
      }
      if (mode == SCR_OBJWALK_KEYS) {
        scr_dyn_arr_push(out, scr_dyn_objwalk_key(key, (size_t)klen));
      } else if (mode == SCR_OBJWALK_VALUES) {
        scr_dyn_arr_push(out, val);
      } else {
        ScrDyn *pair = scr_dyn_new_arr();
        scr_dyn_arr_push(pair, scr_dyn_objwalk_key(key, (size_t)klen));
        scr_dyn_arr_push(pair, val);
        scr_dyn_arr_push(out, pair);
      }
    }
    return out;
  }
  if (v->kind == SCR_DYN_STR) {
    /* JS indexes strings by UTF-16 code units; the checked-dynamic tree stores UTF-8.
     * Code points walk one at a time — an astral code point stays WHOLE
     * (one entry where JS lists two lone surrogates; documented
     * approximation, the keys stay dense). */
    const ScrStr *s = v->v.str;
    size_t unit = 0;
    for (size_t i = 0; i < s->len;) {
      unsigned char c = (unsigned char)s->data[i];
      size_t step = c < 0x80 ? 1 : c < 0xe0 ? 2 : c < 0xf0 ? 3 : 4;
      char key[24];
      int klen = snprintf(key, sizeof key, "%zu", unit);
      if (mode == SCR_OBJWALK_KEYS) {
        scr_dyn_arr_push(out, scr_dyn_objwalk_key(key, (size_t)klen));
      } else {
        ScrDyn *val = scr_dyn_objwalk_key(s->data + i, step);
        if (mode == SCR_OBJWALK_VALUES) {
          scr_dyn_arr_push(out, val);
        } else {
          ScrDyn *pair = scr_dyn_new_arr();
          scr_dyn_arr_push(pair, scr_dyn_objwalk_key(key, (size_t)klen));
          scr_dyn_arr_push(pair, val);
          scr_dyn_arr_push(out, pair);
        }
      }
      unit++;
      i += step;
    }
    return out;
  }
  if (v->kind == SCR_DYN_FUNC && v->v.fn.clo->props) {
    /* A function value's own ENUMERABLE keys — the property table, minus
     * the two built-ins. Without this arm the keyed WRITE would create a
     * new wrong answer of its own (`f.x = 1; Object.keys(f)` answering
     * [] where Node answers ["x"]), which is why it lands in the same
     * commit as the write rather than after it.
     *
     * `name`/`length` are skipped because they are the only keys that can
     * be in the table while Node calls them non-enumerable: the keyed
     * write REFUSES them (see scr_dyn_key_set), so the only way in is
     * Object.defineProperties, whose bare `{value: …}` descriptor is
     * non-enumerable in Node too. Every OTHER table key is enumerable in
     * Node when it got there by assignment; a defineProperties-written
     * one is listed here where Node hides it, which is the runtime's
     * already-documented "dyn properties are plain data properties"
     * divergence (SEMANTICS.md), not a new one. */
    ScrDyn *table = (ScrDyn *)scr_box_get_ref(v->v.fn.clo->props); /* +1 */
    if (table != NULL && table->kind == SCR_DYN_OBJ) {
      /* A function's own keys take the same projection as an object's —
       * `f.a = 1; f[0] = 2` lists ["0","a"] in Node too. */
      size_t *ford = scr_dyn_obj_key_order(table);
      for (size_t oi = 0; oi < table->v.obj.len; oi++) {
        const ScrDynEntry *e = &table->v.obj.entries[ford ? ford[oi] : oi];
        if ((e->key_len == 4 && memcmp(e->key, "name", 4) == 0) ||
            (e->key_len == 6 && memcmp(e->key, "length", 6) == 0) ||
            /* `prototype` joins them for the same reason and with the
             * same force: Node makes it non-enumerable, and it is now in
             * the table for every function whose prototype object has
             * been demanded — without this line `Object.keys(F)` would
             * answer ["prototype"] where Node answers [], and it would
             * do so as a side effect of an unrelated read. */
            (e->key_len == 9 && memcmp(e->key, "prototype", 9) == 0)) {
          continue;
        }
        scr_dyn_objwalk_push(out, mode, e->key, e->key_len, e->value);
      }
      free(ford);
    }
    scr_dyn_release(table);
    return out;
  }
  /* Scalars (numbers, booleans, handles) and a function with no property
   * table: no own enumerable string keys. */
  return out;
}

ScrDyn *scr_dyn_obj_keys(const ScrDyn *v) { return scr_dyn_objwalk(v, SCR_OBJWALK_KEYS); }

/* One source's own enumerable members onto an OBJ target — the
 * CopyDataProperties walk Object.assign runs per source. OBJ sources copy
 * their members directly (last write wins); the index-keyed kinds
 * (arrays, strings, bytes) ride the entries walk, so the copied key set
 * is EXACTLY what Object.keys answers for that kind (string sources per
 * UTF-16 code unit, like Node's String exotic object); nullish sources
 * copy nothing (Node skips them) and the scalar/function/handle kinds
 * have no own enumerable string keys. Non-OBJ targets copy nothing (the
 * existing two-arg stance — a dyn array target has no property table). */
static void scr_dyn_assign_from(ScrDyn *target, const ScrDyn *src) {
  if (target->kind != SCR_DYN_OBJ) return;
  if (src->kind == SCR_DYN_UNDEF || src->kind == SCR_DYN_NULL) return;
  if (src->kind == SCR_DYN_OBJ) {
    for (size_t i = 0; i < src->v.obj.len; i++) {
      scr_dyn_obj_set(target, src->v.obj.entries[i].key,
                      src->v.obj.entries[i].key_len,
                      scr_dyn_retain(src->v.obj.entries[i].value));
    }
    return;
  }
  /* FUNC rides the entries walk too, for the same reason Object.keys
   * does: once a function value can CARRY own properties, "a function
   * source copies nothing" stops being Node's answer. The walk lists
   * exactly the enumerable set (built-ins skipped), so this arm and
   * Object.keys can never disagree. */
  if (src->kind != SCR_DYN_ARR && src->kind != SCR_DYN_STR &&
      src->kind != SCR_DYN_BYTES && src->kind != SCR_DYN_FUNC) {
    return;
  }
  ScrDyn *pairs = scr_dyn_obj_entries(src); /* +1; never throws here */
  if (pairs == NULL) return;
  if (pairs->kind == SCR_DYN_ARR) {
    for (size_t i = 0; i < pairs->v.arr.len; i++) {
      const ScrDyn *pair = pairs->v.arr.items[i];
      if (pair->kind != SCR_DYN_ARR || pair->v.arr.len != 2) continue;
      const ScrDyn *k = pair->v.arr.items[0];
      if (k->kind != SCR_DYN_STR) continue;
      scr_dyn_obj_set(target, k->v.str->data, k->v.str->len,
                      scr_dyn_retain(pair->v.arr.items[1]));
    }
  }
  scr_dyn_release(pairs);
}

/* Object.assign over dyn values: copies `src`'s own members onto `target`
 * (last write wins) and answers the target retained (+1). Nullish
 * receivers throw Node's ToObject TypeError; nullish sources copy
 * nothing; index-keyed sources (arrays/strings/bytes) copy their index
 * keys like Node; the remaining kinds have no own enumerable keys. */
ScrDyn *scr_dyn_assign(ScrDyn *target, const ScrDyn *src) {
  if (target->kind == SCR_DYN_UNDEF || target->kind == SCR_DYN_NULL) {
    const char *m = "Cannot convert undefined or null to object";
    scr_throw_error_msg(SCR_ERR_TYPE, m, strlen(m));
    return NULL;
  }
  if (target->kind == SCR_DYN_JSVAL) {
    /* An ENGINE target: the copy runs in the engine (Object.assign's own
     * semantics — setters fire, own-enumerable order); the source enters
     * per the uniform conversion (a wrapped source spreads by reference,
     * dyn data as the usual member deep copy). */
    if (!scr_dyn_jsval_ops()->assign(target->v.jsval.cell, src)) return NULL;
    return scr_dyn_retain(target);
  }
  if (src->kind == SCR_DYN_JSVAL) {
    /* A wrapped SOURCE onto a dyn target: the engine lists its own
     * [key, value] pairs (getters running) and each lands as a dyn
     * member — values wrap per element, scalars normalized. */
    if (target->kind == SCR_DYN_OBJ) {
      ScrDyn *entries = scr_dyn_jsval_ops()->obj_walk(src->v.jsval.cell, 2);
      if (!entries) return NULL;
      for (size_t i = 0; i < entries->v.arr.len; i++) {
        const ScrDyn *pair = entries->v.arr.items[i];
        const ScrDyn *k = pair->v.arr.items[0];
        scr_dyn_obj_set(target, k->v.str->data, k->v.str->len,
                        scr_dyn_retain(pair->v.arr.items[1]));
      }
      scr_dyn_release(entries);
    }
    return scr_dyn_retain(target);
  }
  scr_dyn_assign_from(target, src);
  return scr_dyn_retain(target);
}

/* Variadic Object.assign's argument pack (the `Object.assign({},
 * ...arr.map(f), tail)` shape): the compiler builds one fresh dyn array
 * of sources — plain arguments push borrowed (+1 in), spread arguments
 * flatten through the spread-call walk (scr_dyn_arr_push_spread's V8
 * TypeError texts, `what` spelling the spread expression for the nullish
 * form) — so every source evaluates and flattens BEFORE any copying,
 * exactly JS's ArgumentListEvaluation. */
void scr_dyn_pack_push(ScrDyn *pack, ScrDyn *v) {
  scr_dyn_arr_push(pack, scr_dyn_retain(v));
}

void scr_dyn_pack_push_spread(ScrDyn *pack, const ScrDyn *src, const ScrStr *what) {
  scr_dyn_arr_push_spread(pack, src, what->data);
}

/* The ITERATED-path spread completion: V8 only takes the optimized
 * apply-path texts (scr_dyn_arr_push_spread's — the expression spelled
 * for nullish sources) when the spread is the SINGLE LAST argument; a spread
 * followed by more arguments, or one of several spreads, drives the real
 * iterator protocol, whose failure text describes the VALUE instead —
 * "undefined", "object null", "number 5", "boolean true", "function",
 * bare "object" — + " is not iterable (cannot read property
 * Symbol(Symbol.iterator))". The compiler picks the variant by the
 * spread's syntactic position. MAY THROW (pending). Borrows src. */
void scr_dyn_pack_push_spread_iter(ScrDyn *pack, const ScrDyn *src) {
  if (src->kind == SCR_DYN_ARR || src->kind == SCR_DYN_BYTES ||
      src->kind == SCR_DYN_STR) {
    scr_dyn_arr_push_spread(pack, src, ""); /* iterable kinds never throw */
    return;
  }
  if (src->kind == SCR_DYN_JSVAL) {
    /* A wrapped engine value on the ITERATED path: the engine's own
     * protocol drains (the kind wording on a non-iterable — the
     * iterated path's value-describing texts, engine-side). */
    ScrDyn *drained = scr_dyn_jsval_ops()->iter_drain(src->v.jsval.cell, false, NULL);
    if (!drained) return; /* pending */
    for (size_t i = 0; i < drained->v.arr.len; i++) {
      scr_dyn_arr_push(pack, scr_dyn_retain(drained->v.arr.items[i]));
    }
    scr_dyn_release(drained);
    return;
  }
  ScrJsonBuf b;
  scr_jb_init(&b);
  switch (src->kind) {
  case SCR_DYN_UNDEF: scr_jb_puts(&b, "undefined"); break;
  case SCR_DYN_NULL: scr_jb_puts(&b, "object null"); break;
  case SCR_DYN_NUM: {
    scr_jb_puts(&b, "number ");
    ScrStr *s = scr_f64_to_scrstr(src->v.num);
    for (size_t i = 0; i < s->len; i++) scr_jb_putc(&b, s->data[i]);
    scr_str_release(s);
    break;
  }
  case SCR_DYN_BOOL: scr_jb_puts(&b, src->v.b ? "boolean true" : "boolean false"); break;
  case SCR_DYN_FUNC: scr_jb_puts(&b, "function"); break;
  default: scr_jb_puts(&b, "object"); break; /* OBJ/HANDLE/PROMISE */
  }
  scr_jb_puts(&b, " is not iterable (cannot read property Symbol(Symbol.iterator))");
  scr_throw_error(SCR_ERR_TYPE, scr_jb_finish(&b));
}

/* Object.assign(target, ...sources) over the flattened pack: the nullish
 * ToObject TypeError first (Node throws before looking at sources), then
 * each source's own-member copy left to right, answering the target
 * retained (+1) — identity, like JS. */
ScrDyn *scr_dyn_assign_all(ScrDyn *target, const ScrDyn *sources) {
  if (target->kind == SCR_DYN_UNDEF || target->kind == SCR_DYN_NULL) {
    const char *m = "Cannot convert undefined or null to object";
    scr_throw_error_msg(SCR_ERR_TYPE, m, strlen(m));
    return NULL;
  }
  if (sources->kind == SCR_DYN_ARR) {
    for (size_t i = 0; i < sources->v.arr.len; i++) {
      ScrDyn *r = scr_dyn_assign(target, sources->v.arr.items[i]);
      if (!r) return NULL;
      scr_dyn_release(r);
    }
  }
  return scr_dyn_retain(target);
}

bool scr_dyn_has_own(const ScrDyn *v, const ScrStr *key) {
  if (v->kind == SCR_DYN_UNDEF || v->kind == SCR_DYN_NULL) {
    const char *m = "Cannot convert undefined or null to object";
    scr_throw_error_msg(SCR_ERR_TYPE, m, strlen(m));
    return false;
  }
  /* Engine-held: the ENGINE's own Object.hasOwn answers (a bridged
   * surprise leaves the exception pending and answers false — callers
   * check pending like every fallible dyn op). */
  if (v->kind == SCR_DYN_JSVAL) {
    return scr_dyn_jsval_ops()->has_own(v->v.jsval.cell, key) == 1;
  }
  if (v->kind == SCR_DYN_OBJ) {
    return scr_dyn_obj_get(v, key->data, key->len) != NULL;
  }
  if (v->kind == SCR_DYN_ARR) {
    if (key->len == 6 && memcmp(key->data, "length", 6) == 0) return true;
    size_t idx = 0;
    int is_index = key->len > 0 && !(key->len > 1 && key->data[0] == '0');
    for (size_t i = 0; is_index && i < key->len; i++) {
      if (key->data[i] < '0' || key->data[i] > '9') is_index = 0;
      else idx = idx * 10 + (size_t)(key->data[i] - '0');
    }
    return is_index != 0 && idx < v->v.arr.len;
  }
  if (v->kind == SCR_DYN_FUNC) return scr_dyn_fn_has(v, key->data, key->len);
  return false;
}
ScrDyn *scr_dyn_obj_values(const ScrDyn *v) { return scr_dyn_objwalk(v, SCR_OBJWALK_VALUES); }
ScrDyn *scr_dyn_obj_entries(const ScrDyn *v) { return scr_dyn_objwalk(v, SCR_OBJWALK_ENTRIES); }

/* ── DOMException's dyn-touching half ─────────────────────────────────
 * Construction/cause/clone live HERE (not scr_error.c) so the error unit
 * stays linkable without the checked-dynamic tree (the runtime C-unit tests link
 * subsets). The cause teardown installs through scr_error.c's hook
 * before any cause can exist. */

static void scr_domex_cause_drop_impl(void *obj) {
  ScrDomException *d = (ScrDomException *)obj;
  scr_dyn_release(d->cause);
  d->cause = NULL;
}

ScrError *scr_domex_new(const ScrDyn *message, const ScrDyn *name_or_options) {
  scr_domex_install_cause_drop(&scr_domex_cause_drop_impl);
  ScrDomException *d = (ScrDomException *)scr_domex_alloc();
  d->message = (message == NULL || message->kind == SCR_DYN_UNDEF)
                   ? scr_str_new("", 0)
                   : scr_dyn_string_coerce(message);
  const ScrDyn *no = name_or_options;
  if (no == NULL || no->kind == SCR_DYN_UNDEF) {
    d->name = scr_str_new("Error", 5);
  } else if (no->kind == SCR_DYN_OBJ) {
    /* The options form (Node's extension): name is ToString of the `name`
     * member — String(undefined) is "undefined" when absent, exactly
     * Node — and `cause` records own-property PRESENCE (undefined-valued
     * members count, like `'cause' in options`). */
    ScrDyn *nm = scr_dyn_obj_get(no, "name", 4);
    d->name = nm ? scr_dyn_string_coerce(nm) : scr_str_new("undefined", 9);
    ScrDyn *cause = scr_dyn_obj_get(no, "cause", 5); /* borrowed; NULL = absent */
    if (cause) {
      d->has_cause = true;
      d->cause = scr_dyn_retain(cause);
    }
  } else {
    /* Everything else ToStrings (Node: new DOMException('m', null) has
     * name "null", a number names its decimal rendering). */
    d->name = scr_dyn_string_coerce(no);
  }
  d->dom_code = scr_domex_code_of(d->name);
  return (ScrError *)d;
}

ScrDyn *scr_domex_cause(ScrError *e) {
  ScrDomException *d = (ScrDomException *)e;
  return d->cause ? scr_dyn_retain(d->cause) : scr_dyn_undefined();
}

ScrError *scr_domex_clone(ScrError *e, const ScrDyn *options) {
  scr_sc_validate_options(options);
  if (scr_exc_pending()) return NULL;
  ScrDomException *src = (ScrDomException *)e;
  ScrDomException *d = (ScrDomException *)scr_domex_alloc();
  d->name = scr_str_retain(src->name);
  d->message = scr_str_retain(src->message);
  /* The legacy code re-derives from the name (spec: serialization carries
   * name + message; cause does not serialize). */
  d->dom_code = scr_domex_code_of(d->name);
  return (ScrError *)d;
}

/* ── atob/btoa — the WHATWG base64 globals (Node globals since v16) ───
 * They live HERE (not scr_string.c) because the argument is a dyn value:
 * WebIDL ToString runs over the dyn kind (Node's atob(null) decodes the
 * string "null"), and the string unit must stay linkable without the
 * dyn. atob is forgiving-base64 exactly — ASCII whitespace stripped, a
 * %4==0 input sheds up to two trailing '=', %4==1 refuses, leftover
 * bits discard — decoding to the latin1 code points as a UTF-8 string;
 * btoa refuses any code point over U+00FF. Malformed input throws the
 * catchable DOMException InvalidCharacterError with Node's exact
 * message. */

static int scr_b64_val(unsigned char c) {
  if (c >= 'A' && c <= 'Z') return c - 'A';
  if (c >= 'a' && c <= 'z') return c - 'a' + 26;
  if (c >= '0' && c <= '9') return c - '0' + 52;
  if (c == '+') return 62;
  if (c == '/') return 63;
  return -1;
}

ScrStr *scr_atob(const ScrDyn *data) {
  ScrStr *s = scr_dyn_string_coerce(data);
  /* Strip ASCII whitespace (the forgiving step). */
  char *buf = malloc(s->len ? s->len : 1);
  if (!buf) scr_json_oom();
  size_t n = 0;
  for (size_t i = 0; i < s->len; i++) {
    unsigned char c = (unsigned char)s->data[i];
    if (c == 0x09 || c == 0x0a || c == 0x0c || c == 0x0d || c == 0x20) continue;
    buf[n++] = (char)c;
  }
  scr_str_release(s);
  /* A %4==0 input sheds one or two trailing '='. */
  if (n % 4 == 0 && n > 0) {
    if (buf[n - 1] == '=') n--;
    if (n > 0 && buf[n - 1] == '=') n--;
  }
  if (n % 4 == 1) goto invalid;
  /* Decode 6-bit groups; latin1 code points expand to UTF-8 (bytes over
   * 0x7F become two-byte sequences). */
  {
    size_t outBytes = (n / 4) * 3 + (n % 4 == 2 ? 1 : n % 4 == 3 ? 2 : 0);
    char *out = malloc(outBytes * 2 ? outBytes * 2 : 1);
    if (!out) scr_json_oom();
    size_t w = 0;
    unsigned acc = 0;
    int bits = 0;
    for (size_t i = 0; i < n; i++) {
      int v = scr_b64_val((unsigned char)buf[i]);
      if (v < 0) {
        free(out);
        goto invalid;
      }
      acc = (acc << 6) | (unsigned)v;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        unsigned char b = (unsigned char)((acc >> bits) & 0xff);
        if (b < 0x80) {
          out[w++] = (char)b;
        } else {
          out[w++] = (char)(0xc0 | (b >> 6));
          out[w++] = (char)(0x80 | (b & 0x3f));
        }
      }
    }
    /* Leftover bits discard (forgiving-base64's final step). */
    free(buf);
    ScrStr *result = scr_str_new(out, w);
    free(out);
    return result;
  }
invalid:
  free(buf);
  scr_throw_domex("InvalidCharacterError",
                  "The string to be decoded is not correctly encoded.");
  return NULL;
}

ScrStr *scr_btoa(const ScrDyn *data) {
  static const char alphabet[] =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  ScrStr *s = scr_dyn_string_coerce(data);
  /* UTF-8 → code points, each must fit latin1 (one byte). The runtime's
   * strings are well-formed UTF-8, so only C2/C3 leads can stay in
   * range; every other lead byte names a code point over U+00FF. */
  char *bytes = malloc(s->len ? s->len : 1);
  if (!bytes) scr_json_oom();
  size_t n = 0;
  for (size_t i = 0; i < s->len;) {
    unsigned char c = (unsigned char)s->data[i];
    if (c < 0x80) {
      bytes[n++] = (char)c;
      i += 1;
    } else if ((c == 0xc2 || c == 0xc3) && i + 1 < s->len) {
      unsigned char c1 = (unsigned char)s->data[i + 1];
      bytes[n++] = (char)(((c & 0x1f) << 6) | (c1 & 0x3f));
      i += 2;
    } else {
      free(bytes);
      scr_str_release(s);
      scr_throw_domex("InvalidCharacterError", "Invalid character");
      return NULL;
    }
  }
  scr_str_release(s);
  {
    size_t cap = ((n + 2) / 3) * 4;
    char *out = malloc(cap ? cap : 1);
    if (!out) scr_json_oom();
    size_t w = 0;
    for (size_t i = 0; i < n; i += 3) {
      unsigned b0 = (unsigned char)bytes[i];
      unsigned b1 = i + 1 < n ? (unsigned char)bytes[i + 1] : 0;
      unsigned b2 = i + 2 < n ? (unsigned char)bytes[i + 2] : 0;
      unsigned triple = (b0 << 16) | (b1 << 8) | b2;
      out[w++] = alphabet[(triple >> 18) & 0x3f];
      out[w++] = alphabet[(triple >> 12) & 0x3f];
      out[w++] = i + 1 < n ? alphabet[(triple >> 6) & 0x3f] : '=';
      out[w++] = i + 2 < n ? alphabet[triple & 0x3f] : '=';
    }
    free(bytes);
    ScrStr *result = scr_str_new(out, w);
    free(out);
    return result;
  }
}

ScrStr *scr_b64_missing_arg(void) {
  static const char msg[] = "The \"input\" argument must be specified";
  scr_throw_error_msg_code(SCR_ERR_TYPE, msg, sizeof msg - 1,
                           "ERR_MISSING_ARGS");
  return NULL;
}
