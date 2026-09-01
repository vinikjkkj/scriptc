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
/* The by-KIND split of that same total (scr_closure.c owns the array and
 * prints it): one number for 36997 live dyn values says nothing about
 * what the leaked tree is made of. */
extern long scr_dyn_live_by_kind[];
#endif

static void scr_json_oom(void) {
  scr_trap("scriptc: out of memory\n");
}

/* -- dyn-object KEY storage ------------------------------------------
 * Every own key of a parsed JSON object is a small malloc'd
 * NUL-terminated buffer hanging off ScrDynEntry.key. That is ONE RAW
 * malloc AND ONE RAW free PER PROPERTY, and on the messaging workload it
 * is the single most FREQUENT allocation the process makes: the alloc
 * lane measured 3,906,000 calls at this site, 50.7% of every
 * malloc/calloc/realloc in the binary, at a mean of 8.85 bytes each. It
 * only became the leader because the size-class pool took two thirds off
 * scr_string.c - this site never went through the pool at all.
 *
 * It fits the pool exactly. Every key is far under SCR_POOL_MAX, and its
 * length is ALREADY STORED beside the pointer (ScrDynEntry.key_len), so
 * give() can name the same class take() was handed without a strlen.
 * Routing it through scr_string.c's scr_str_blocks would be wrong - a
 * pool is only self-consistent if every block in it was sized by one
 * rule - so this is its own pool, exactly like scr_string.c's and
 * scr_cycle.c's.
 *
 * EVERY key allocation in this file MUST go through key_alloc and every
 * key free through key_free. A key malloc'd with the UNROUNDED size and
 * then handed to give() would be smaller than the class it lands in, and
 * the next take() of that class would hand out a short block. The three
 * allocation sites and the four free sites below are the complete set
 * (grep for ScrDynEntry .key); scr_exp_tab's key is a different struct
 * and is left on plain malloc/free.
 *
 * SCR_JSON_KEY_POOL=0 restores the raw malloc/free byte for byte, which
 * is what the ablation control is built with. */
#ifndef SCR_JSON_KEY_POOL
#define SCR_JSON_KEY_POOL 1
#endif

#if SCR_JSON_KEY_POOL
static ScrPool scr_json_key_blocks;

#ifdef SCR_POOLSTAT_ON
__attribute__((constructor)) static void scr_poolstat_reg_jsonkey(void) {
  scr_poolstat_name(&scr_json_key_blocks, "jsonkey");
}
#endif
#endif

static char *scr_json_key_alloc(size_t key_len) {
#if SCR_JSON_KEY_POOL
  size_t want = key_len + 1;
  char *k = (char *)scr_pool_take(&scr_json_key_blocks, want);
  /* scr_pool_bytes, not want: a recycled block is a whole class wide and
     the class is what give() will put it back into. */
  if (!k) k = (char *)malloc(scr_pool_bytes(want));
#else
  char *k = (char *)malloc(key_len + 1);
#endif
  if (!k) scr_json_oom();
  return k;
}

static void scr_json_key_free(char *key, size_t key_len) {
#if SCR_JSON_KEY_POOL
  if (!key) return;
  if (scr_pool_give(&scr_json_key_blocks, key, key_len + 1)) return;
#else
  (void)key_len;
#endif
  free(key);
}

/* ── the OBJ arm's rare members ────────────────────────────────────────
 * proto, cname, hidden and slots are non-NULL on 8.73% of the live OBJ
 * dyn values in zapo (tests/perf/dyncensus, at the cycle heap's peak:
 * proto 2.33%, cname 6.62%, hidden 6.07%, slots 0.00%). Inline they were
 * 32 bytes of the payload union, which is as wide as its widest arm and
 * is therefore paid by EVERY ScrDyn in the program whatever kind it is.
 *
 * The block rides the same size-class pool the keys do, and for the same
 * reason: it is 32 bytes, far under SCR_POOL_MAX, and an object that
 * gains and loses a prototype should not be two malloc calls. Its own
 * pool, not the key pool: a pool is only self-consistent if every block
 * in it was sized by one rule.
 */
const ScrDynObjExt scr_dyn_obj_ext_none = {NULL, NULL, NULL, NULL};

#if SCR_JSON_KEY_POOL
static ScrPool scr_dyn_ext_blocks;

#ifdef SCR_POOLSTAT_ON
__attribute__((constructor)) static void scr_poolstat_reg_dynext(void) {
  scr_poolstat_name(&scr_dyn_ext_blocks, "dynext");
}
#endif
#endif

ScrDynObjExt *scr_dyn_ext_w(ScrDyn *d) {
  if (d->v.obj.ext != NULL) return d->v.obj.ext;
  ScrDynObjExt *e = NULL;
#if SCR_JSON_KEY_POOL
  e = (ScrDynObjExt *)scr_pool_take(&scr_dyn_ext_blocks, sizeof *e);
#endif
  if (e == NULL) e = (ScrDynObjExt *)malloc(sizeof *e);
  if (e == NULL) scr_json_oom();
  e->proto = NULL;
  e->cname = NULL;
  e->hidden = NULL;
  e->slots = NULL;
  d->v.obj.ext = e;
  return e;
}

void scr_dyn_ext_drop(ScrDyn *d, bool release) {
  ScrDynObjExt *e = d->v.obj.ext;
  if (e == NULL) return;
  d->v.obj.ext = NULL;
  /* The COLLECTOR's teardown passes false: markGray has already
   * decremented every traced child, and releasing here would be a double
   * free — the trace/teardown complement scr_runtime.h states for every
   * cycle-headered type. The refcount path passes true. `cname` is a
   * static literal and is owned by nobody in either case. */
  if (release) {
    scr_dyn_release(e->proto);
    scr_dyn_release(e->hidden);
    scr_dyn_release(e->slots);
  }
#if SCR_JSON_KEY_POOL
  if (scr_pool_give(&scr_dyn_ext_blocks, e, sizeof *e)) return;
#endif
  free(e);
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
  /* The doubling had no ceiling. With a 32-bit ScrStr::cap it needs one, and
   * the fence belongs HERE rather than in scr_str_regrow: the builder's own
   * len/cap are size_t, so it would otherwise walk past the representable
   * range and hand regrow a number that had already wrapped. */
  while (cap < b->len + need) {
    if (cap > SCR_STR_MAX_LEN / 2) { cap = SCR_STR_MAX_LEN; break; }
    cap *= 2;
  }
  scr_str_size_check(b->len + need);
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

void scr_jb_write(ScrJsonBuf *b, const char *s, size_t n) {
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
#ifdef SCR_ARRCEN_ON
  scr_arrcen_note(SCR_ARRCEN_JSONSTR, (long long)s->len);
#endif
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
  s->len = (uint32_t)b->len;
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

/* ── ScrDyn is a cycle-collector node ─────────────────────────────────
 * Every reference edge OUT of a dyn value used to be invisible to the
 * collector, because the node had no cycle header: `scr_runtime.h`'s
 * SCR_DYN_FUNC arm called that a "documented divergence — a cycle THROUGH
 * a dyn-boxed function is merely never collected". It is not merely
 * never collected. A dyn tree is how every JS-shaped object graph in a
 * compiled program is represented — prototype chains, accessor
 * descriptor tables, and any `unknown`-typed field — so one back-link
 * through a dyn object pins the whole graph reachable from it, and
 * protobufjs's reflection tree (whose entries all carry a `parent`
 * back-link) pinned 8020 closures and 36990 dyn values in zapo.
 *
 * The header costs sizeof(ScrCycHdr) per dyn value and buys the edges
 * below. What is TRACED is exactly the set of children that are
 * themselves guaranteed to carry a header: other ScrDyns (array
 * elements, object member values, the [[Prototype]] link, the
 * non-enumerable/accessor table) and the ScrClosure a FUNC dyn boxes.
 * Immortal children (the interned `undefined`, interned closure
 * literals) have no header at all and the collector's own child filter
 * skips them on `rc == SIZE_MAX` before it touches one.
 *
 * What is deliberately NOT traced, and why each is released by the
 * teardown below instead:
 *   inst.o    a boxed CLASS INSTANCE. Whether a shape carries a header is
 *             the emitter's per-shape grading (traceAdapterC): 1377 of
 *             zapo's 2120 shapes are graded acyclic and are plain
 *             calloc'd, so visiting one would make the collector read and
 *             write 32 bytes BEFORE the allocation. There is no runtime
 *             test that distinguishes the two.
 *   promise   headered, but its release runs through an INSTALLED ops
 *             pointer so this always-linked core never references the
 *             gated fiber unit; tracing the edge without owning its
 *             release would split one edge's accounting across two units.
 *   str/bytes/handle/jsval/big   no header by construction.
 * An incomplete trace is the SAFE direction: a ring through an untraced
 * edge is uncollectable (what the whole tree was before this change),
 * whereas a traced edge the teardown also releases is a double free. */
static void scr_dyn_trace(void *o, ScrTraceVisit visit, void *ctx);
static void scr_dyn_gcfree(void *o);

#ifdef SCR_DYNCEN_ON
/* tests/perf/dyncensus. The -include'd half cannot see ScrDyn (it is read
 * before scr_runtime.h); this is the half that can, and it is where the
 * two hooks below are defined. Absent the -include the symbol is undefined
 * and this file compiles byte-identically. */
#include "scr_dyn_census_walk.h"
#endif

/* The dyn half of the throw unwrap (scr_runtime.h's ScrThrowDynHook).
 *
 * A caught error that crosses into `unknown` and is thrown again -- the
 * everyday `function rethrow(e: unknown): never { throw e }`, and the shape
 * a non-inline `.catch(h)` handler takes -- used to land in the exception
 * cell's REF arm carrying a dyn.  Every question the next catch body asked
 * then answered from the erased arm: `e instanceof Error` was FALSE and
 * `String(e)` was "[object Object]", where Node answers true and "Error: x".
 * Silent, and reachable on any revision: writing the rethrow inline as
 * `.catch((e) => rethrow(e))` emits the identical bytes.
 *
 * Unwrapping at the THROW rather than at the catch-side questions is what
 * makes it safe.  The narrowed EXTRACTION reads `payload` as an ScrError, so
 * a cell that answers `instanceof Error` while still carrying a dyn is a
 * type confusion -- measured, a segfault, not a wrong answer.  One arm
 * decides for every question.  Identity survives: reading the OBJ arm back
 * as a dyn goes through scr_dyn_from_error, whose cache returns the SAME
 * node this dyn is.
 *
 * Only the runtime's own encodings unwrap.  A user object built over
 * Error.prototype has no ScrError behind it, and a composite dyn has no
 * scalar arm, so both keep the REF arm exactly as before. */
void scr_throw_dyn(ScrDyn *v) {
  ScrError *behind = scr_errdyn_err_of(v); /* +1 or NULL */
  if (behind != NULL) {
    scr_dyn_release(v); /* the reference this call took ownership of */
    /* scr_throw_obj takes the +1 the lookup returned. */
    scr_throw_obj(behind, scr_error_retain_v, scr_error_release_v, NULL);
    return;
  }
  /* The SCALAR arms of the same round trip: the caught->dyn adapter maps
   * SCR_EXC_{F64,BOOL,STR} into the matching dyn kinds, and this maps them
   * back, so the cell holds the arm it started in.  Without it a rethrown
   * STRING stringified as "[object Object]". */
  const ScrDyn *d = v;
  if (d->kind == SCR_DYN_STR) {
    ScrStr *s = scr_str_retain(d->v.str);
    scr_dyn_release(v);
    scr_throw_str(s); /* the retained +1 moves in */
    return;
  }
  if (d->kind == SCR_DYN_NUM) {
    const double n = d->v.num;
    scr_dyn_release(v);
    scr_throw_f64(n);
    return;
  }
  if (d->kind == SCR_DYN_BOOL) {
    const bool b = d->v.b;
    scr_dyn_release(v);
    scr_throw_bool(b);
    return;
  }
  /* Every other dyn kind keeps the historical REF arm, byte for byte. */
  scr_throw_ref(v, scr_dyn_retain_v, scr_dyn_release_v, scr_dyn_trace_v);
}

static ScrDyn *scr_dyn_alloc(ScrDynKind kind) {
#ifndef SCR_RC_AUDIT
  ScrDyn **list = kind == SCR_DYN_ARR   ? &scr_dyn_free_arr
                  : kind == SCR_DYN_OBJ ? &scr_dyn_free_obj
                                        : &scr_dyn_free_misc;
  ScrDyn *d = *list;
  if (d) {
#ifdef SCR_CYCEN_ON
    /* tests/perf/cycensus/scr_cyc_census.h. The link lives in `rc` now,
     * so nothing in the payload union is consumed and this read is
     * order-independent. */
    scr_cycen_note_unpark(scr_cyc_hdr(d),
                          kind == SCR_DYN_ARR
                              ? (long long)(d->v.arr.cap * sizeof(ScrDyn *))
                          : kind == SCR_DYN_OBJ
                              ? (long long)(d->v.obj.cap * sizeof(ScrDynEntry))
                              : 0);
#endif
    *list = (ScrDyn *)(size_t)d->rc; /* freelist link, see the release end */
    scr_dyn_free_count--;
    /* A recycled node re-enters the graph BLACK. Its `buffered` flag was
     * already cleared by scr_cyc_on_dead on the way out, but its color is
     * whatever the last life left (PURPLE for anything that was ever a
     * candidate), and markRoots keys on exactly that. */
    scr_cyc_mark_live(d);
    d->rc = 1;
    d->kind = kind;
    d->buffer = false;
    d->null_proto = false;
    /* A recycled node must not inherit the previous life's boundary mark,
     * or an unrelated fresh value would refuse its own writes. */
    d->static_copy = false;
    if (kind == SCR_DYN_ARR) {
      d->v.arr.len = 0; /* cap/items preserved from the node's last life */
    } else if (kind == SCR_DYN_OBJ) {
      d->v.obj.len = 0; /* cap/entries preserved */
      d->v.obj.ext = NULL; /* release already dropped it; belt and braces */
    } else {
      memset(&d->v, 0, sizeof d->v);
    }
#ifdef SCR_DYNCEN_ON
    scr_dyncen_note_alloc(d); /* the RECYCLED path: a node re-entering the
                               * live population is an allocation to any
                               * lane that counts what the program holds */
#endif
    return d;
  }
#endif
  ScrDyn *fresh = scr_cyc_alloc(sizeof *fresh, &scr_dyn_trace, &scr_dyn_gcfree);
  fresh->rc = 1;
  fresh->kind = kind;
#ifdef SCR_DYNCEN_ON
  scr_dyncen_note_alloc(fresh);
#endif
#ifdef SCR_RC_AUDIT
  scr_live_dyns++;
  scr_dyn_live_by_kind[kind]++;
#endif
  return fresh;
}

static void scr_dyn_handle_release(void *h, ScrDynHandleTag tag);

/* The traced children: every one is a ScrDyn or a ScrClosure, so every one
 * carries a header (or is immortal, which the visit filter skips). */
static void scr_dyn_trace(void *o, ScrTraceVisit visit, void *ctx) {
  ScrDyn *d = (ScrDyn *)o;
  switch (d->kind) {
  case SCR_DYN_ARR:
    for (size_t i = 0; i < d->v.arr.len; i++) visit(d->v.arr.items[i], ctx);
    break;
  case SCR_DYN_OBJ:
    for (size_t i = 0; i < d->v.obj.len; i++) visit(d->v.obj.entries[i].value, ctx);
    /* The [[Prototype]] link and the non-enumerable/ACCESSOR table. The
     * table is where a getter/setter pair lives (an OBJ dyn of ARR dyn
     * entries holding two FUNC dyns), which is the edge that makes an
     * accessor descriptor collectible at all. Both are NULL-tolerant. */
    visit(scr_dyn_ext(d)->proto, ctx);
    visit(scr_dyn_ext(d)->hidden, ctx);
    /* scriptc's internal-slot table: an ordinary OBJ dyn holding ordinary
     * dyn values, so a cycle through one collects like any other. */
    visit(scr_dyn_ext(d)->slots, ctx);
    break;
  case SCR_DYN_FUNC:
    visit(d->v.fn.clo, ctx);
    break;
  default:
    break; /* scalars, strings, bytes, handles, promises, jsvals, bigints,
            * boxed class instances: nothing traced (see scr_dyn_alloc) */
  }
}

void scr_dyn_trace_v(void *o, ScrTraceVisit visit, void *ctx) {
  scr_dyn_trace(o, visit, ctx);
}

/* Teardown for the collector: releases exactly the complement of the trace
 * — never an array element, an object member value, a proto link, the
 * hidden table, the INTERNAL-SLOT table or a FUNC's closure, all of which
 * the collector has already accounted for. Buffers and malloc'd keys are this function's, because
 * they are not references at all. */
static void scr_dyn_gcfree(void *o) {
  ScrDyn *d = (ScrDyn *)o;
#ifdef SCR_DYNCEN_ON
  scr_dyncen_note_dead(d); /* the collector's exit from the live set; the
                            * fields are still intact at this point */
#endif
  switch (d->kind) {
  case SCR_DYN_STR:
    scr_str_release(d->v.str);
    break;
  case SCR_DYN_BYTES:
  case SCR_DYN_ARRBUF:
    scr_bytes_release(d->v.bytes);
    break;
  case SCR_DYN_OBJ:
    /* keys only — the values are traced. A STATIC key is a literal in
     * this image and was never allocated, so there is nothing to hand
     * back — and handing one to the pool would put a .rdata address on a
     * freelist that the next take() returns as writable memory. */
    for (size_t i = 0; i < d->v.obj.len; i++)
      if (!d->v.obj.entries[i].key_static)
        scr_json_key_free(d->v.obj.entries[i].key, d->v.obj.entries[i].key_len);
    /* …and the ext BLOCK, whose three dyn children the trace has already
     * accounted for. Releasing them here would be a double free; leaving
     * the block would leak 32 bytes per object that had one. */
    scr_dyn_ext_drop(d, false);
    break;
  case SCR_DYN_HANDLE:
    scr_dyn_handle_release(d->v.handle.ptr, d->v.handle.tag);
    break;
  case SCR_DYN_PROMISE:
    scr_dyn_promise_release_fn(d->v.promise);
    break;
  case SCR_DYN_JSVAL:
    scr_dyn_jsval_ops()->release(d->v.jsval.cell);
    break;
  case SCR_DYN_BIG:
    scr_dyn_big_ops()->release(d->v.big);
    break;
  case SCR_DYN_OBJINST:
    d->v.inst.cls->release(d->v.inst.o);
    break;
  case SCR_DYN_MAP:
    /* Owned, and NOT traced — the dyn→map edge is invisible to the
     * collector (the OBJINST stance and its reason), so the map must be
     * released here rather than left to the trace. `tkey` is a static
     * literal and owns nothing. */
    scr_map_release(d->v.map.m);
    break;
  default:
    break; /* ARR items and FUNC clo are traced; scalars own nothing */
  }
#ifdef SCR_RC_AUDIT
  scr_live_dyns--;
  scr_dyn_live_by_kind[d->kind]--;
#endif
  if (d->kind == SCR_DYN_ARR) free(d->v.arr.items);
  else if (d->kind == SCR_DYN_OBJ) free(d->v.obj.entries);
  scr_cyc_free(d);
}

void scr_dyn_release(ScrDyn *d) {
  if (!d || d->rc == SIZE_MAX) return; /* NULL: an uninitialized `let` local */
  if (--d->rc != 0) {
    /* Candidate-root buffering is restricted to the three kinds that OWN a
     * traced child. A scalar, string, bytes, handle, promise, jsval,
     * bigint or boxed-instance dyn points at nothing the collector walks,
     * so it can never be a MEMBER of a cycle — only reachable from one,
     * which the visit filter handles without it ever being a root.
     * Buffering them would cost a full graph walk per 256 releases of the
     * hottest allocation in the runtime and could never find anything. */
    if (d->kind == SCR_DYN_ARR || d->kind == SCR_DYN_OBJ ||
        d->kind == SCR_DYN_FUNC) {
      scr_cyc_on_release(d); /* may collect — d is done being touched */
    }
    return;
  }
  scr_cyc_on_dead(d); /* drop any candidate-buffer entry before teardown */
#ifdef SCR_DYNCEN_ON
  scr_dyncen_note_dead(d); /* the refcount's exit from the live set. It runs
                            * whether the node is then PARKED on a freelist
                            * or handed to scr_cyc_free: a parked node is
                            * resident but the program no longer holds it,
                            * and that distinction is the whole point of a
                            * lane above scr_json.c rather than below it. */
#endif
  switch (d->kind) {
  case SCR_DYN_STR:
    scr_str_release(d->v.str);
    break;
  case SCR_DYN_BYTES:
  case SCR_DYN_ARRBUF: /* one representation, so one release */
    scr_bytes_release(d->v.bytes);
    break;
  case SCR_DYN_ARR:
    for (size_t i = 0; i < d->v.arr.len; i++) scr_dyn_release(d->v.arr.items[i]);
    break;
  case SCR_DYN_OBJ:
    for (size_t i = 0; i < d->v.obj.len; i++) {
      if (!d->v.obj.entries[i].key_static)
        scr_json_key_free(d->v.obj.entries[i].key, d->v.obj.entries[i].key_len);
      scr_dyn_release(d->v.obj.entries[i].value);
    }
    /* The [[Prototype]] link, the NON-ENUMERABLE table and the slot
     * table are owned; the constructor NAME is a static literal. The
     * whole ext goes because the node may be recycled below with its
     * entries buffer intact — a recycled node must not inherit the chain
     * (or the getters) of its previous life. */
    scr_dyn_ext_drop(d, true);
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
  case SCR_DYN_BIG:
    /* Installed by scr_dyn_from_big (the gated constructor is the only
     * producer) — the jsval arm's story, and the reason this core can
     * hold digits it cannot link against. */
    scr_dyn_big_ops()->release(d->v.big);
    break;
  case SCR_DYN_OBJINST:
    /* The strong reference the box took at construction, given back
     * through the class's own `_v` release — which for a hierarchy class
     * dispatches on the instance's vtable, so a base-typed box still
     * tears down the derived object. */
    d->v.inst.cls->release(d->v.inst.o);
    break;
  case SCR_DYN_MAP:
    /* The strong reference the box took at construction. scr_map.c is in
     * the same always-linked core as this file, so unlike the three arms
     * above there is no installed-ops indirection to go through. */
    scr_map_release(d->v.map.m);
    break;
  default:
    break; /* null/bool/num have no children */
  }
#ifdef SCR_RC_AUDIT
  scr_live_dyns--;
  scr_dyn_live_by_kind[d->kind]--;
#endif
#ifndef SCR_RC_AUDIT
  if (scr_dyn_free_count < SCR_DYN_FREE_MAX) {
    ScrDyn **list = d->kind == SCR_DYN_ARR   ? &scr_dyn_free_arr
                    : d->kind == SCR_DYN_OBJ ? &scr_dyn_free_obj
                                             : &scr_dyn_free_misc;
#ifdef SCR_CYCEN_ON
    /* The node is NOT freed at any level from here: it and its
     * items/entries buffer stay resident until the freelist is full. */
    scr_cycen_note_park(scr_cyc_hdr(d),
                        d->kind == SCR_DYN_ARR
                            ? (long long)(d->v.arr.cap * sizeof(ScrDyn *))
                        : d->kind == SCR_DYN_OBJ
                            ? (long long)(d->v.obj.cap * sizeof(ScrDynEntry))
                            : 0);
#endif
    /* THE LINK LIVES IN `rc`, NOT IN THE PAYLOAD UNION. It used to
     * overlay v.arr.len, which was the union's whole first word while len
     * was a size_t; len and cap are uint32 now, so the same store would
     * eat `cap` and a recycled node would come back holding a live
     * buffer and a capacity read out of the top half of a pointer. `rc`
     * is eight bytes, means nothing for a node nobody references, and is
     * set back to 1 by scr_dyn_alloc on the way out. Nothing walks a
     * parked node: scr_cyc_on_dead has already dropped its candidate
     * buffer entry and every edge it owned has been released. */
    d->rc = (size_t)(void *)*list; /* buffer and capacity survive intact */
    *list = d;
    scr_dyn_free_count++;
    return;
  }
#endif
  if (d->kind == SCR_DYN_ARR) free(d->v.arr.items);
  else if (d->kind == SCR_DYN_OBJ) free(d->v.obj.entries);
  scr_cyc_free(d);
}

ScrDyn *scr_dyn_obj_get(const ScrDyn *d, const char *key, size_t key_len) {
  for (size_t i = 0; i < d->v.obj.len; i++) {
    const ScrDynEntry *e = &d->v.obj.entries[i];
    if (e->key_len == key_len && memcmp(e->key, key, key_len) == 0) {
      /* An accessor SLOT is not a member. It sits in this table to hold
       * the property's CREATION POSITION and carries no value at all, so
       * the one honest answer here is the same NULL a missing key gets —
       * which is what makes scr_dyn_obj_resolve fall through to the
       * descriptor in `hidden`, and with it [[Get]], [[Set]], [[Delete]]
       * and `in`, unchanged. Every builtin that reads an option out of a
       * bag through this function then behaves exactly as it did when an
       * accessor could only be non-enumerable: it sees no option. */
      if (e->value == scr_dyn_acc_slot()) return NULL;
      return e->value;
    }
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
/* The hidden-entry readers, defined with the table they belong to (the
 * NON-ENUMERABLE OWN PROPERTIES section below). */
static bool scr_hid_is_data(const ScrDyn *q);
static ScrDyn *scr_hid_value(const ScrDyn *q);

/* An OWN property whose value can be handed back BORROWED — the member
 * table, then the hidden table's DATA entries. This is what the
 * coercion protocols (toString / valueOf / Symbol.toPrimitive) can ask
 * for: they cannot run a getter, because they hold no exception path
 * for one. The full [[Get]] is scr_dyn_obj_key_get. */
ScrDyn *scr_dyn_obj_own_data(const ScrDyn *d, const char *key, size_t key_len) {
  if (d->kind != SCR_DYN_OBJ) return NULL;
  ScrDyn *m = scr_dyn_obj_get(d, key, key_len);
  if (m != NULL) return m;
  if (scr_dyn_ext(d)->hidden == NULL) return NULL;
  ScrDyn *ent = scr_dyn_obj_get(scr_dyn_ext(d)->hidden, key, key_len);
  return (ent != NULL && scr_hid_is_data(ent)) ? scr_hid_value(ent) : NULL;
}

ScrDyn *scr_dyn_proto_get(const ScrDyn *d, const char *key, size_t key_len) {
  if (d->kind != SCR_DYN_OBJ) return NULL;
  const ScrDyn *p = scr_dyn_ext(d)->proto;
  for (size_t steps = 0; p != NULL && steps < SCR_PROTO_MAX_DEPTH; steps++) {
    if (p->kind != SCR_DYN_OBJ) return NULL;
    ScrDyn *m = scr_dyn_obj_get(p, key, key_len);
    if (m != NULL) return m;
    /* A NON-ENUMERABLE data property is a property: `toString` installed
     * by `Object.create(proto, { toString: { value: fn } })` has to be
     * findable by the coercion protocols that ask this, or String(x)
     * would answer "[object Object]" for an object that has a toString.
     * An ACCESSOR is deliberately not answered here — running a getter
     * needs the +1-and-may-throw entry point (scr_dyn_obj_key_get), and
     * this one is borrow-only by contract. Unchanged limitation: an
     * accessor-provided toString/valueOf was invisible to the coercion
     * protocol before this table held data too. */
    if (scr_dyn_ext(p)->hidden != NULL) {
      ScrDyn *ent = scr_dyn_obj_get(scr_dyn_ext(p)->hidden, key, key_len);
      if (ent != NULL && scr_hid_is_data(ent)) return scr_hid_value(ent);
    }
    p = scr_dyn_ext(p)->proto;
  }
  return NULL;
}

/* JS's [[Get]] minus accessors, in one symbol: own DATA, else the
 * prototype chain. The record walkers (dynMatch's predicate and
 * dynCheck's builder, both backends) read a member through exactly this,
 * so an inherited method — `L.prototype.toNumber = ...`, every JS class,
 * protobufjs's Long — is as visible to a checked cast as JS makes it,
 * while `scr_dyn_obj_get` itself is untouched.
 *
 * The header's list of own-only consumers above is a list of GUARANTEES,
 * not of callers, and the difference was worth measuring before widening
 * anything: of the eight it names, only hasOwn/hasOwnProperty
 * (scr_dyn_obj_has_own_prop) and deepStrictEqual (scr_assert.c) actually
 * read through scr_dyn_obj_get. Object.keys/values/entries, the JSON
 * writer, structuredClone and Object.assign iterate `v.obj.entries`
 * directly and are own-only by ITERATION. `delete` (scr_dyn_key_delete)
 * belongs on the list and is not on it. None of the three is reachable
 * from an emitted record walker.
 *
 * Everything this answers, JS's [[Get]] answers too, so it cannot match
 * where JS would not; the one thing it does NOT answer is an
 * ACCESSOR-provided member, exactly as the two halves it composes do not
 * (a matcher returns bool and a builder runs before the record exists —
 * neither holds an exception path for a throwing getter, and running one
 * twice per cast is not what JS does either). */
ScrDyn *scr_dyn_obj_data_get(const ScrDyn *d, const char *key, size_t key_len) {
  ScrDyn *m = scr_dyn_obj_own_data(d, key, key_len);
  if (m != NULL) return m;
  return scr_dyn_proto_get(d, key, key_len);
}

/* caps[0] the function, caps[1] the receiver it was read from. */
static ScrDyn *scr_bound_method_thunk(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  ScrDyn *fn = scr_box_get_ref(clo->caps[0]);   /* +1 */
  ScrDyn *recv = scr_box_get_ref(clo->caps[1]); /* +1 */
  scr_dyn_this_push_dyn(recv);
  ScrDyn *r = scr_dyn_call(fn, args, argc, "method");
  scr_dyn_this_pop();
  scr_dyn_release(fn);
  scr_dyn_release(recv);
  return r;
}

/* The record BUILDER's read for a member that can hold a function: the
 * same [[Get]]-minus-accessors walk, +1, and an INHERITED callable comes
 * back BOUND to `d`.
 *
 * Binding is what makes reading the prototype worth anything. JS has no
 * materialization step — `x as LongLike` is the identity, so `x.toNumber()`
 * is a method call on the object the method was found through. The record
 * builder DOES materialize: it copies the member into a struct field, and
 * the field is then called with no receiver at all, so `this.high` reads
 * undefined. The link JS keeps implicitly has to be made explicit exactly
 * once, here, at the only point that still knows both halves.
 *
 * OWN function members are deliberately NOT bound: they come back as the
 * very pointer that went in, which is the identity `unbox(box(x)) === x`
 * the func builder's fast path exists to preserve, and an own function
 * property is not a method-dispatch site in the way a prototype entry is
 * (there is no other way to have obtained a prototype method). */
ScrDyn *scr_dyn_obj_member_get(const ScrDyn *d, const char *key, size_t key_len) {
  ScrDyn *own = scr_dyn_obj_own_data(d, key, key_len);
  if (own != NULL) return scr_dyn_retain(own);
  ScrDyn *m = scr_dyn_proto_get(d, key, key_len);
  if (m == NULL) return NULL;
  if (m->kind != SCR_DYN_FUNC) return scr_dyn_retain(m);
  ScrClosure *clo = scr_closure_new((void *)scr_bound_method_thunk, 2);
  clo->caps[0] = scr_box_new_obj(scr_dyn_retain_v, scr_dyn_release_v, NULL);
  scr_box_set_ref(clo->caps[0], scr_dyn_retain(m));
  clo->caps[1] = scr_box_new_obj(scr_dyn_retain_v, scr_dyn_release_v, NULL);
  scr_box_set_ref(clo->caps[1], scr_dyn_retain((ScrDyn *)d));
  /* The signature is deliberately NOT the wrapped function's: a static
   * signature string is a promise about the C CALLING CONVENTION of
   * `clo`, and this closure's is the thunk's. "()" is the same answer
   * every runtime-minted function gives, and it routes every consumer
   * through the adapter path rather than the direct-closure one.
   * SCR_FN_SRC_BOUND with a NULL name is Node's own answer for a bound
   * function's toString. */
  return scr_dyn_new_func_src(clo, scr_bound_method_thunk, m->v.fn.arity, "()", NULL,
                              SCR_FN_SRC_BOUND);
}

/* True when the chain above `d` reaches a prototype object that a
 * FUNCTION value minted (scr_dyn_fn_prototype) — the one place where
 * Node has a `constructor` member and this runtime deliberately does
 * not carry one as a STORED property. Used to turn that read into a loud
 * fence instead of undefined when the registry below cannot name the
 * function either. */
bool scr_dyn_proto_chain_is_fn_pub(const ScrDyn *d) {
  /* From `d` ITSELF, not from its [[Prototype]]: an escaped prototype
   * object whose function is gone is exactly the receiver this fence
   * exists for, and starting one link up answered it a silent
   * `undefined`. A `cname` is carried by a minted prototype, by an
   * INSTANCE of one, and (since scr_dyn_obj_set_ctor_name) by a
   * CONVERTED BUILTIN RECORD such as fs.Dirent's rows. The third is new,
   * and what it does to this fence was MEASURED rather than reasoned
   * about: no TypeScript spelling found reaches the fence with one.
   * A keyed read on an `unknown` receiver has to name a type first, and
   * both `u as Record<string, unknown>` and `u as { [k: string]: unknown }`
   * dynCheck the value INTO a fresh record, after which no cname is left
   * to see -- `typeof o["constructor"]` answers `undefined` and
   * `"constructor" in o` answers `false` on this side exactly as before
   * (four spellings, v25.9.0 answers `function` and `true` to both).
   *
   * So the sentence this replaces -- "only a minted prototype and an
   * INSTANCE of one carry a `cname`, so no plain literal reaches the
   * fence through this" -- stopped being true of the FIRST clause while
   * staying true of the conclusion. A plain object literal still carries
   * no cname either way. */
  const ScrDyn *p = d;
  for (size_t steps = 0; p != NULL && steps <= SCR_PROTO_MAX_DEPTH; steps++) {
    if (p->kind != SCR_DYN_OBJ) return false;
    if (scr_dyn_ext(p)->cname != NULL) return true;
    p = scr_dyn_ext(p)->proto;
  }
  return false;
}

/* ── the `constructor` back-link, without the cycle ────────────────────
 *
 * Node's `F.prototype.constructor` is F. Storing that as a PROPERTY here
 * is what cannot be done: the prototype object would hold a FUNC box
 * holding the closure holding the property table holding the prototype
 * object — a cycle refcounting could not break and, when this was
 * written, the collector could not see either (ScrDyn carried no trace
 * header then, so the dyn→closure edge was an external root by
 * construction). Two agents refused it on exactly that ground and both
 * were right AT THE TIME. Neither half of that parenthesis is true any
 * more: ScrDyn is a cycle node and scr_dyn_trace visits a FUNC node's
 * closure, so the ring IS collectable today — which is what makes a
 * program that writes the back-link EXPLICITLY (the shadowing own member
 * two paragraphs down) stop leaking. The table stays regardless:
 * computing the answer beats storing a ring even when the ring can be
 * collected, and it is what lets `constructor` read back on a prototype
 * nobody assigned one to.
 *
 * What the read actually needs is smaller than a stored property: the
 * IDENTITY of the closure, plus the five STATIC literals a FUNC box is
 * otherwise made of (thunk, sig, name, src, arity). None of those five
 * is owned by anything, so the only edge in question is the closure
 * pointer — and that one is BORROWED here and made safe by construction
 * rather than by counting:
 *
 *   - the closure OWNS its minted prototype object (ScrClosure's
 *     `implicit_proto`, +1 at mint), so the key of this table cannot be
 *     freed and its address cannot be recycled while the entry lives;
 *   - closure teardown — both the refcount path and the collector's —
 *     erases the entry BEFORE anything else (scr_closure_ctor_unlink),
 *     so the borrowed pointer cannot outlive its closure.
 *
 * The direction that would cycle (prototype → function) is therefore the
 * one direction this table does NOT store. Reading `constructor` MINTS a
 * fresh FUNC box over the closure with an ordinary +1, exactly like every
 * other boundary crossing of a function value — and because a FUNC box's
 * own-property table hangs off the CLOSURE, the box a read answers shares
 * `F.alloc` and every other static with the box the program already had.
 * That is the whole of what `this.constructor.alloc(this.len)` needs.
 *
 * An explicitly assigned `constructor` still shadows all of this: it is
 * an ordinary own member found by the walk long before the read gets
 * here.
 *
 * Open addressing with linear probing over power-of-two buckets. Live
 * entries are one per closure that ever had its `prototype` DEMANDED, so
 * the table is small (protobufjs's bundle: tens); erasure is tombstone-
 * free because it re-inserts the probe run behind the hole. */
typedef struct {
  ScrClosure *clo;    /* BORROWED — see above */
  ScrDynThunk thunk;  /* the remaining five are static literals */
  const char *sig;
  const char *name;
  const char *src;
  uint32_t arity;
  /* `delete F.prototype.constructor` ran. The implicit property is
   * CONFIGURABLE in Node, so the delete succeeds and the object stops
   * having an own `constructor` — Object.hasOwn goes false, the
   * own-names list loses the name, and a later assignment creates an
   * ORDINARY enumerable member (all three flags true) instead of
   * re-filling a non-enumerable slot. The registry ENTRY has to survive
   * it either way: it owns the teardown contract with the closure
   * (scr_dyn_ctor_unlink), and `constructor` stays reachable through the
   * chain in Node too — %Object.prototype% carries one — so `in` keeps
   * answering true. Presence and OWNERSHIP stopped being the same
   * question here, and this flag is the difference. */
  bool ctor_gone;
} ScrCtorDesc;

typedef struct {
  const ScrDyn *proto; /* NULL = empty bucket; owned by clo->implicit_proto */
  ScrCtorDesc d;
} ScrCtorSlot;

static ScrCtorSlot *scr_ctor_tab = NULL;
static size_t scr_ctor_cap = 0;  /* power of two, 0 = unallocated */
static size_t scr_ctor_len = 0;

static size_t scr_ctor_hash(const ScrDyn *p) {
  /* Fibonacci hashing of the pointer: the low bits of a heap address are
   * alignment zeros, so the raw value is a poor bucket index. */
  uint64_t h = (uint64_t)(uintptr_t)p;
  h *= 0x9e3779b97f4a7c15ULL;
  return (size_t)(h >> 32);
}

static void scr_ctor_insert(ScrCtorSlot *tab, size_t cap, const ScrDyn *p, ScrCtorDesc d) {
  size_t i = scr_ctor_hash(p) & (cap - 1);
  while (tab[i].proto != NULL) i = (i + 1) & (cap - 1);
  tab[i].proto = p;
  tab[i].d = d;
}

/* The BUCKET ARRAY itself, at exit. It holds no counted references — the
 * entries are a borrowed closure pointer and five static literals — so
 * this is purely so a sanitized lane sees no stray malloc, and so the
 * library lane (scr_atexit is a session reset there) starts each session
 * with an empty table rather than one indexed by freed addresses. */
static void scr_ctor_teardown(void) {
  free(scr_ctor_tab);
  scr_ctor_tab = NULL;
  scr_ctor_cap = 0;
  scr_ctor_len = 0;
}

static void scr_ctor_grow(void) {
  if (scr_ctor_cap == 0) scr_atexit(scr_ctor_teardown);
  size_t cap = scr_ctor_cap ? scr_ctor_cap * 2 : 16;
  ScrCtorSlot *tab = calloc(cap, sizeof *tab);
  if (!tab) scr_json_oom();
  for (size_t i = 0; i < scr_ctor_cap; i++) {
    if (scr_ctor_tab[i].proto != NULL) {
      scr_ctor_insert(tab, cap, scr_ctor_tab[i].proto, scr_ctor_tab[i].d);
    }
  }
  free(scr_ctor_tab);
  scr_ctor_tab = tab;
  scr_ctor_cap = cap;
}

/* The descriptor registered for this exact prototype OBJECT, or NULL.
 * Identity, never shape — two functions with identical bodies are
 * different constructors, the stance scr_dyn_instance_of already takes. */
static const ScrCtorDesc *scr_ctor_find(const ScrDyn *p) {
  if (scr_ctor_cap == 0) return NULL;
  size_t i = scr_ctor_hash(p) & (scr_ctor_cap - 1);
  for (size_t steps = 0; steps < scr_ctor_cap; steps++) {
    if (scr_ctor_tab[i].proto == NULL) return NULL;
    if (scr_ctor_tab[i].proto == p) return &scr_ctor_tab[i].d;
    i = (i + 1) & (scr_ctor_cap - 1);
  }
  return NULL;
}

/* The implicit `constructor` was deleted off this prototype. The ENTRY
 * stays — it carries the closure teardown contract — and only the
 * ownership bit moves; scr_dyn_minted_proto_has_ctor is what reads it.
 * A miss is impossible in practice (every caller tested
 * scr_dyn_is_minted_proto first) and is a silent no-op if it happens. */
static void scr_ctor_mark_gone(const ScrDyn *p) {
  if (scr_ctor_cap == 0) return;
  size_t i = scr_ctor_hash(p) & (scr_ctor_cap - 1);
  for (size_t steps = 0; steps < scr_ctor_cap; steps++) {
    if (scr_ctor_tab[i].proto == NULL) return;
    if (scr_ctor_tab[i].proto == p) {
      scr_ctor_tab[i].d.ctor_gone = true;
      return;
    }
    i = (i + 1) & (scr_ctor_cap - 1);
  }
}

static void scr_ctor_erase(const ScrDyn *p) {
  if (scr_ctor_cap == 0) return;
  size_t i = scr_ctor_hash(p) & (scr_ctor_cap - 1);
  for (size_t steps = 0; steps < scr_ctor_cap; steps++) {
    if (scr_ctor_tab[i].proto == NULL) return;
    if (scr_ctor_tab[i].proto == p) break;
    i = (i + 1) & (scr_ctor_cap - 1);
    if (steps + 1 == scr_ctor_cap) return;
  }
  /* Backward-shift deletion: clear the slot, then re-insert the rest of
   * the probe run so no lookup stops short at the hole. */
  scr_ctor_tab[i].proto = NULL;
  scr_ctor_len--;
  size_t j = (i + 1) & (scr_ctor_cap - 1);
  while (scr_ctor_tab[j].proto != NULL) {
    ScrCtorSlot moved = scr_ctor_tab[j];
    scr_ctor_tab[j].proto = NULL;
    scr_ctor_insert(scr_ctor_tab, scr_ctor_cap, moved.proto, moved.d);
    j = (j + 1) & (scr_ctor_cap - 1);
  }
}

/* Closure teardown's half of the contract (scr_runtime.h): erase the
 * entry, then drop the prototype object the closure owned. Installed as
 * scr_closure_ctor_unlink the first time a prototype is minted, and
 * reached only for a closure that has one. */
static void scr_dyn_ctor_unlink(ScrClosure *c, bool release) {
  ScrDyn *proto = (ScrDyn *)c->implicit_proto;
  c->implicit_proto = NULL;
  /* By ADDRESS only — never dereferenced — which is what makes this
   * correct on the collector's path, where `proto` may already have been
   * freed earlier in the same white-set teardown loop. */
  scr_ctor_erase(proto);
  /* The trace/teardown complement: false from the collector's free_fn,
   * which must not release a traced child. */
  if (release) scr_dyn_release(proto);
}

/* The FUNCTION value `d`'s chain names as its `constructor`, or NULL when
 * no prototype on it was minted by one. +1 — a fresh box over the same
 * closure, so `===` against the program's own box answers true
 * (scr_dyn_strict_eq compares FUNC nodes by closure) and the shared
 * own-property table answers its statics.
 *
 * The walk does not stop at the first object carrying a `cname`: an
 * INSTANCE copies that name for util.inspect, so a chain built by
 * `Object.create(new F())` passes through one on the way to the
 * prototype that was actually minted. */
static ScrDyn *scr_dyn_proto_chain_ctor(const ScrDyn *d) {
  if (d->kind != SCR_DYN_OBJ) return NULL;
  /* The receiver ITSELF first. `F.prototype.constructor` names the
   * prototype object directly — the OWN property in Node — and a walk
   * that started one link up answered a silent `undefined` there while
   * answering the same question exactly for every instance below it. */
  const ScrDyn *p = d;
  for (size_t steps = 0; p != NULL && steps <= SCR_PROTO_MAX_DEPTH; steps++) {
    if (p->kind != SCR_DYN_OBJ) return NULL;
    const ScrCtorDesc *c = scr_ctor_find(p);
    if (c != NULL) {
      return scr_dyn_new_func_src(scr_closure_retain(c->clo), c->thunk, c->arity,
                                  c->sig, c->name, c->src);
    }
    p = scr_dyn_ext(p)->proto;
  }
  return NULL;
}

/* Is this object a minted implicit prototype? `constructor` is an OWN
 * property of one in Node, so `in` and Object.hasOwn must say so even
 * though the value is computed rather than stored.
 *
 * PUBLIC (scr_runtime.h) because three surfaces outside this file's
 * property walks need the same answer, and each of them is a place Node
 * treats a minted prototype UNLIKE every other object: the keyed WRITE
 * (its `constructor` is a pre-existing NON-ENUMERABLE own property, so
 * [[Set]] keeps the attribute), the own-names walk (that property is
 * OWN, and it is the first one the object was born with), and
 * util.inspect (whose constructor-name walk requires
 * `value instanceof descriptor.value`, which a prototype object fails
 * against its OWN constructor). */
bool scr_dyn_is_minted_proto(const ScrDyn *d) {
  return d != NULL && d->kind == SCR_DYN_OBJ && scr_ctor_find(d) != NULL;
}

/* …and the narrower question: does it still HAVE that own `constructor`?
 * The two split at `delete F.prototype.constructor`, which SUCCEEDS in
 * Node (the property is configurable) and leaves the object with no own
 * `constructor` at all — while `constructor` stays READABLE through the
 * chain, so `in` still answers true, and the registry entry still has a
 * teardown contract with the closure to honour. Ownership is what
 * Object.hasOwn, the own-names list and the attribute-preserving [[Set]]
 * actually ask about; mintedness is what the chain walk and inspect ask
 * about. Using one for the other is how a deleted property came back in
 * a list. */
bool scr_dyn_minted_proto_has_ctor(const ScrDyn *d) {
  if (d == NULL || d->kind != SCR_DYN_OBJ) return false;
  const ScrCtorDesc *c = scr_ctor_find(d);
  return c != NULL && !c->ctor_gone;
}

/* The `constructor` fence (see scr_dyn_fn_prototype's header): loud,
 * never a silent undefined. Reached only when the registry above could
 * NOT name the function — which today means the minting closure is
 * already gone, so the prototype object outlived the only value that
 * could answer. Throws; callers return NULL after. */
void scr_dyn_proto_ctor_fence(void) {
  static const char msg[] =
      "reading 'constructor' through a function's implicit prototype object is not supported yet"
      " when the function itself is already unreachable (the prototype object carries no OWNED"
      " back-link — that would retain the function, which retains the prototype, a cycle"
      " reference counting cannot break — and the borrowed one was dropped when the last"
      " reference to the function went away; assign it explicitly,"
      " `F.prototype.constructor = F`, and the read answers exactly)";
  scr_throw_error_msg(SCR_ERR_ERROR, msg, sizeof msg - 1);
}

void scr_dyn_obj_set_proto(ScrDyn *obj, ScrDyn *proto) {
  if (obj->kind != SCR_DYN_OBJ) return;
  ScrDyn *prev = scr_dyn_ext(obj)->proto;
  /* A NULL proto on an object that has no ext is the common case and must
   * not allocate one to store NULL into. */
  if (proto != NULL) scr_dyn_ext_w(obj)->proto = scr_dyn_retain(proto);
  else if (obj->v.obj.ext != NULL) obj->v.obj.ext->proto = NULL;
  /* An object with a LINK does not have a null [[Prototype]], and the two
   * fields are read by different surfaces: util.inspect prints the prefix
   * off null_proto while [[Get]] walks the link, and deepStrictEqual
   * compares BOTH. Leaving the flag set behind a live chain would answer
   * about neither, so installing a chain retracts it here rather than at
   * every call site. Clearing on a NULL proto would be wrong the other
   * way: Object.setPrototypeOf(o, null) is exactly the null case. */
  obj->null_proto = proto ? false : obj->null_proto;
  scr_dyn_release(prev);
}

/* Public: the compiler-emitted static→dyn converters push through this
 * too. Ownership of the item moves in. */
void scr_dyn_arr_push(ScrDyn *arr, ScrDyn *item) {
  if (arr->v.arr.len == arr->v.arr.cap) {
    /* `cap` is a uint32 now (the payload union is 32 bytes instead of 56
     * because of it), so the ceiling is ENFORCED here rather than assumed
     * from the measured maximum of 1,024. It rides the allocation guard
     * that is already on this line instead of adding a second abort call
     * site: 2^31 elements is a 17 GB items buffer, so "out of memory" is
     * both the truthful answer and the one that already exists. */
    /* EXACT first allocation, then double -- scr_dyn_obj_put's reason,
     * measured on this table too: 3,722 of the 6,695 live arrays at
     * zapo's peak sat in the cap-4 class holding 4,523 elements, so
     * 69.6% of that class was capacity nothing filled, and the element
     * histogram says why -- 2,920 arrays hold exactly ONE element and
     * 800 hold two. `new Array(n)` still reserves exactly n in one
     * shot (scr_dyn_new_arr_len); this is the doubling push path. */
    size_t cap = arr->v.arr.cap ? (size_t)arr->v.arr.cap * 2
                                : (size_t)SCR_DYN_ARR_FIRST_CAP;
    ScrDyn **items =
        cap > SCR_DYN_LEN_MAX ? NULL : realloc(arr->v.arr.items, cap * sizeof *items);
    if (!items) scr_json_oom();
#ifdef SCR_DYNCEN_ON
    scr_dyncen_note_grow(0, (long long)arr->v.arr.cap, (long long)cap,
                         (long long)sizeof *items);
#endif
    arr->v.arr.items = items;
    arr->v.arr.cap = (uint32_t)cap;
  }
  arr->v.arr.items[arr->v.arr.len++] = item; /* ownership moves in */
}

/* The value-describing prefix of the "... is not iterable" TypeError —
 * "undefined", "object null", "boolean true", "number 5", "bigint 5n",
 * "function", else "object". Node splices the SOURCE TEXT of the
 * expression here, which a compiled tier does not have, so this word is
 * a documented approximation (SEMANTICS.md). It is ONE function because
 * it was two: the spread path and the iterated destructuring path each
 * spelled the table inline, and the two had already drifted (the second
 * ordered its arms differently and rendered the number through a
 * different formatter). Two copies of a kind table is the shape of bug
 * this tier keeps finding — a kind added to one copy and not the other
 * answers two ways for one value. */
static void scr_dyn_iter_kind_word(ScrJsonBuf *b, const ScrDyn *src) {
  switch (src->kind) {
  case SCR_DYN_UNDEF: scr_jb_puts(b, "undefined"); break;
  case SCR_DYN_NULL: scr_jb_puts(b, "object null"); break;
  case SCR_DYN_BOOL: scr_jb_puts(b, src->v.b ? "boolean true" : "boolean false"); break;
  case SCR_DYN_NUM: {
    char buf[32];
    scr_jb_puts(b, "number ");
    size_t n = scr_f64_to_str(src->v.num, buf);
    scr_jb_write(b, buf, n);
    break;
  }
  case SCR_DYN_BIG: {
    /* The inspect form, suffix included — Node describes a primitive by
     * its literal, and 5n is how a bigint spells itself. */
    ScrStr *s = scr_dyn_big_ops()->to_str(src->v.big, 10);
    scr_jb_puts(b, "bigint ");
    scr_jb_write(b, s->data, s->len);
    scr_jb_putc(b, 'n');
    scr_str_release(s);
    break;
  }
  case SCR_DYN_FUNC: scr_jb_puts(b, "function"); break;
  default: scr_jb_puts(b, "object"); break; /* OBJ/HANDLE/PROMISE/... */
  }
}

/* A DataView rides the SAME SCR_DYN_BYTES kind as a Uint8Array (types.ts
 * maps it to bytes<u8> so the view can alias its owner's storage), and
 * the flavor the payload carries is the only discriminator -- the same
 * one scr_dyn_is_u8array reads. It matters to every walk below because a
 * DataView is NOT ITERABLE in JS: `[...new DataView(b)]` throws where
 * `[...new Uint8Array(b)]` yields the bytes. Walking it would answer the
 * bytes at exit 0 where Node throws. */
static bool dyn_bytes_is_dataview(const ScrDyn *d) {
  return d != NULL && d->kind == SCR_DYN_BYTES && d->v.bytes != NULL &&
         d->v.bytes->flavor == SCR_BF_DATAVIEW;
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
  if (src->kind == SCR_DYN_BYTES && !dyn_bytes_is_dataview(src)) {
    for (size_t i = 0; i < src->v.bytes->len; i++) {
      scr_dyn_arr_push(arr, scr_dyn_new_num((double)src->v.bytes->data[i]));
    }
    return;
  }
  /* A DATAVIEW falls through to the non-iterable text below, which is
   * what Node throws for it. */
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
  if ((src->kind == SCR_DYN_ARR || src->kind == SCR_DYN_BYTES || src->kind == SCR_DYN_STR) &&
      !dyn_bytes_is_dataview(src)) {
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
  scr_dyn_iter_kind_word(&b, src);
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
static void scr_dyn_obj_put_k(ScrDyn *obj, char *key, size_t key_len, ScrDyn *value,
                              uint32_t key_static) {
#ifdef SCR_DYNCEN_ON
  /* tests/perf/dyncensus: EVERY key store, before the duplicate scan, so
   * an overwrite -- which allocated a key buffer and is about to free it
   * again -- is counted like any other allocation of that name. */
  scr_dyncen_key_note(&scr_dyncen_keyrun, key, (long long)key_len);
#endif
  for (size_t i = 0; i < obj->v.obj.len; i++) {
    ScrDynEntry *e = &obj->v.obj.entries[i];
    if (e->key_len == key_len && memcmp(e->key, key, key_len) == 0) {
      /* UNLINK BEFORE RELEASE (scr_cycle.c's second global invariant): the
       * slot must already hold the new value when the old one's release
       * runs, because that release can trigger a collection and the walk
       * must not see an edge whose count was just given up. Harmless while
       * dyn values were invisible to the collector; a double decrement now
       * that they are nodes. */
      ScrDyn *old = e->value;
      e->value = value;
      /* the surviving entry keeps its own, equal key; the loser's bytes
       * go back only if this call owned them */
      if (!key_static) scr_json_key_free(key, key_len);
      scr_dyn_release(old);
      return;
    }
  }
  if (obj->v.obj.len == obj->v.obj.cap) {
    /* FIRST allocation is EXACT, then double. The four-slot floor was
     * the single largest term in this table's spare capacity: at zapo's
     * peak, 7,168 of the 10,104 live objects sat in the cap-4 class
     * holding 14,805 members between them, so 13,867 of their 28,672
     * slots -- 48.4% of that class, and 82.3% of ALL the spare capacity
     * in this table -- were slots nothing had ever written. The member
     * histogram is why: 3,238 objects hold exactly ONE member and 417
     * hold two, and every one of them paid for four.
     *
     * Nothing shrinks a dyn buffer, ever (measured, not read off the
     * source: tests/perf/dyncensus counts a capacity that ever went DOWN
     * and the count is zero), so a slot this policy over-allocates is
     * resident for the life of the object rather than transient.
     *
     * The cost is reallocs on the way up -- an object that reaches three
     * members now grows 1, 2, 4 instead of straight to 4. It is bounded
     * by the same doubling as before: capacity is still under 2x the
     * members it holds, with the constant floor removed.
     *
     * The members' half of the same uint32 ceiling; 2^31 entries is a
     * 51 GB table. */
    size_t cap = obj->v.obj.cap ? (size_t)obj->v.obj.cap * 2
                                : (size_t)SCR_DYN_OBJ_FIRST_CAP;
    ScrDynEntry *entries =
        cap > SCR_DYN_LEN_MAX ? NULL : realloc(obj->v.obj.entries, cap * sizeof *entries);
    if (!entries) scr_json_oom();
#ifdef SCR_DYNCEN_ON
    scr_dyncen_note_grow(1, (long long)obj->v.obj.cap, (long long)cap,
                         (long long)sizeof *entries);
#endif
    obj->v.obj.entries = entries;
    obj->v.obj.cap = (uint32_t)cap;
  }
  ScrDynEntry *e = &obj->v.obj.entries[obj->v.obj.len++];
  e->key = key;
  e->key_len = (uint32_t)key_len;
  e->key_static = key_static;
  e->value = value;
}

/* The copying put, unchanged for every caller that had one. */
static void scr_dyn_obj_put(ScrDyn *obj, char *key, size_t key_len, ScrDyn *value) {
  scr_dyn_obj_put_k(obj, key, key_len, value, 0);
}

/* ── dyn construction (compiler-emitted converters & overflow reads) ───── */

/* THE undefined value: one immortal node (rc == SIZE_MAX skips every
 * retain/release and the freelists never see it). */
ScrDyn *scr_dyn_undefined(void) {
  static ScrDyn undef = { SIZE_MAX, SCR_DYN_UNDEF, { false } };
  return &undef;
}

/* THE accessor SLOT: a second immortal node, distinct from `undefined`
 * by POINTER and by nothing else.
 *
 * An ENUMERABLE accessor has to be two things at once and the two tables
 * each hold one of them. `hidden` holds the descriptor — the getter, the
 * setter, `configurable` — and cannot be enumerated, because it records
 * no creation order (scr_dyn_own_names_fence says so in its own message,
 * and that sentence is what this node answers). `entries` IS the
 * creation order, and holds no attributes and no getter.
 *
 * So the property lives in BOTH: the descriptor in `hidden`, and a SLOT
 * in `entries` that carries the key and nothing else. The slot is what
 * makes `Object.keys` list the name in the position JS puts it in, with
 * scr_dyn_obj_key_order — the one own-key projection — untouched.
 *
 * Two rules keep the split from becoming a wrong answer:
 *   - scr_dyn_obj_get answers NULL for a slot, so every [[Get]], [[Set]],
 *     [[Delete]] and `in` falls through to the descriptor exactly as it
 *     did when the accessor was in `hidden` alone;
 *   - a slot SURVIVES the property going non-enumerable, as a position
 *     tombstone, because ES does not move a property that is redefined.
 *     `hidden`'s `enumerable` element is the live answer; the slot only
 *     says WHERE.
 *
 * Every enumeration surface therefore has to ask two questions per entry
 * — is this a slot, and is it enumerable — and scr_dyn_obj_entry_read
 * answers both in one call. A surface that does NOT ask refuses, loudly,
 * through scr_dyn_obj_acc_fence: a key silently missing from Object.keys
 * is the shape of a bug that surfaces somewhere else. */
ScrDyn *scr_dyn_acc_slot(void) {
  static ScrDyn slot = { SIZE_MAX, SCR_DYN_UNDEF, { false } };
  return &slot;
}

/* The three FUNC literals as callable symbols: the LLVM backend emits
 * calls, not C, so it cannot reach a static inline -- and it used to read
 * `sig` as a plain pointer load at +32, a hardcoded copy of a layout it
 * does not own. That is what made the 16-byte cycle header three bugs
 * instead of one. */
const char *scr_dyn_fn_sig_of(const ScrDyn *d) { return scr_dyn_fn_sig(d); }
const char *scr_dyn_fn_name_of(const ScrDyn *d) { return scr_dyn_fn_name(d); }
const char *scr_dyn_fn_src_of(const ScrDyn *d) { return scr_dyn_fn_src(d); }

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
    /* `new Array(n)` reaches here with n already range-checked against
     * JS's own 2^32-1; the uint32 cap's ceiling is lower and is enforced
     * on the same allocation guard. */
    ScrDyn **items =
        len > SCR_DYN_LEN_MAX ? NULL : realloc(d->v.arr.items, len * sizeof *items);
    if (!items) scr_json_oom();
#ifdef SCR_DYNCEN_ON
    scr_dyncen_note_grow(0, (long long)d->v.arr.cap, (long long)len,
                         (long long)sizeof *items);
#endif
    d->v.arr.items = items;
    d->v.arr.cap = (uint32_t)len;
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

/* The two above, chosen at RUN TIME. A record shape is STRUCTURAL, so
 * whether one of its instances has a null [[Prototype]] is a fact about
 * the INSTANCE and not about the shape: os.userInfo() builds one with
 * Object.create(null) and a value materialised out of a dynamic one
 * carries whatever its source carried. The record->dyn walker asks the
 * instance (the own-key mask's byte 0) and calls this; a shape no
 * crossing arms folds the flag to a constant at compile time and this
 * costs nothing. */
ScrDyn *scr_dyn_new_obj_flavor(int null_proto) {
  return null_proto ? scr_dyn_new_obj_null_proto() : scr_dyn_new_obj();
}

/* Is this value a null-prototype OBJECT? The dyn->record builder's probe:
 * the fact is per-INSTANCE, so it has to be read off the source value and
 * carried, and both backends ask it through this rather than off a byte
 * offset into ScrDyn (the LLVM lane's dyn plumbing is offset-literal, and
 * a flag's offset is not one of the three it already pins). */
int scr_dyn_is_null_proto(const ScrDyn *d) {
  return d != NULL && d->kind == SCR_DYN_OBJ && d->null_proto ? 1 : 0;
}

/* The source object's [[Prototype]], retained (+1), or NULL — the
 * dyn->record builder's probe for IrRecordShape.srcproto. A record is a
 * monomorphic struct with nowhere to hold a chain, which is exactly why a
 * member the source only INHERITED could not be told from an own one on
 * the far side of a crossing; this is the one pointer that fixes it, and
 * it is the SAME object the source carried, so `new A(1)` and `new A(2)`
 * crossed into one shape still share one prototype and deepStrictEqual
 * still answers about their constructors. */
ScrDyn *scr_dyn_obj_proto_ref(const ScrDyn *d) {
  if (d == NULL || d->kind != SCR_DYN_OBJ || scr_dyn_ext(d)->proto == NULL) return NULL;
  return scr_dyn_retain(scr_dyn_ext(d)->proto);
}

/* [[Get]] along a saved [[Prototype]] chain, keyed by a ScrStr — the
 * record's miss path. Borrowed in, +1 out (NULL = the chain does not carry
 * the key). Both backends call it rather than reaching into ScrStr: the
 * LLVM lane pins three ScrDyn offsets and no ScrStr ones. */
ScrDyn *scr_dyn_proto_get_str(const ScrDyn *proto, const ScrStr *k) {
  if (proto == NULL || k == NULL) return NULL;
  ScrDyn *m = (ScrDyn *)scr_dyn_obj_data_get(proto, k->data, k->len);
  return m != NULL ? scr_dyn_retain(m) : NULL;
}

/* ...and the `in` half of the same question. */
int scr_dyn_proto_has_str(const ScrDyn *proto, const ScrStr *k) {
  if (proto == NULL || k == NULL) return 0;
  return scr_dyn_obj_data_get(proto, k->data, k->len) != NULL ? 1 : 0;
}

/* The same question keyed by a compiler-emitted literal: the record->dyn
 * walker asking whether the SOURCE's own chain still answers a member,
 * which is when there is nothing to demote and the chain can simply be
 * LINKED (one object, so [[Prototype]] identity survives the crossing). */
int scr_dyn_proto_has(const ScrDyn *proto, const char *k, size_t n) {
  if (proto == NULL) return 0;
  return scr_dyn_obj_data_get(proto, k, n) != NULL ? 1 : 0;
}

/* Buffer-ness is ONE fact with two homes: the PAYLOAD carries it
 * (ScrBytes.flavor, stamped by whichever constructor made the value) and
 * the dyn node re-asks it (ScrDyn.buffer, which every toString/coercion
 * branch reads). Deriving the second from the first is what keeps a
 * Buffer a Buffer across the boundary.
 *
 * It was NOT derived, and that was a silent wrong answer already on the
 * live path: `function f(b) { return b.toString("hex"); }` called with a
 * real Buffer answered "104,105" — the Uint8Array element join — where
 * Node answers "6869", with no diagnostic anywhere. The static spelling
 * of the same call was always right, so the two disagreed by which side
 * of an untyped parameter the value happened to be read on.
 *
 * SCR_BF_UNKNOWN stays PLAIN here rather than guessing: it is the
 * deliberate default for a producer nobody has classified (see the
 * header), and a guess would turn a named fence into a wrong string. */
static bool dyn_bytes_is_buffer(const ScrBytes *b) {
  return b != NULL && b->flavor == SCR_BF_BUFFER;
}

/* `u instanceof Uint8Array` over a checked-dynamic value.
 *
 * SCR_DYN_BYTES is not the answer on its own: DataView rides the SAME
 * u8 kind (types.ts maps it to bytes<u8> so the view can alias its
 * owner's storage), so a boxed DataView used to answer TRUE here where
 * Node answers false -- silently. The flavor the payload carries is the
 * discriminator, and it survives both boxing constructors (ref retains,
 * copy preserves). Never throws: DATAVIEW has exactly one producer, so
 * anything not stamped with it is not a DataView. */
bool scr_dyn_is_u8array(const ScrDyn *d) {
  return d != NULL && d->kind == SCR_DYN_BYTES && d->v.bytes != NULL &&
         d->v.bytes->flavor != SCR_BF_DATAVIEW;
}

ScrDyn *scr_dyn_new_bytes_copy(const ScrBytes *b) {
  ScrDyn *d = scr_dyn_alloc(SCR_DYN_BYTES);
  d->v.bytes = scr_bytes_copy(b); /* the CLONING constructor (flavor rides along) */
  d->buffer = dyn_bytes_is_buffer(d->v.bytes);
  return d;
}

ScrDyn *scr_dyn_new_bytes_ref(ScrBytes *b) {
  /* The static→dyn BOUNDARY constructor: one refcounted payload, two
   * views of it. Retaining (rather than copying) is what makes a write
   * through an untyped parameter reach the caller's buffer. */
  ScrDyn *d = scr_dyn_alloc(SCR_DYN_BYTES);
  d->v.bytes = scr_bytes_retain(b);
  d->buffer = dyn_bytes_is_buffer(b);
  return d;
}

ScrDyn *scr_dyn_mark_static_copy(ScrDyn *d) {
  /* Only the two kinds the boundary actually copies carry the mark, and
   * the already-marked early exit keeps a shared sub-object from being
   * walked twice. */
  if (d == NULL || d->static_copy) return d;
  if (d->kind == SCR_DYN_ARR) {
    d->static_copy = true;
    for (size_t i = 0; i < d->v.arr.len; i++) scr_dyn_mark_static_copy(d->v.arr.items[i]);
  } else if (d->kind == SCR_DYN_OBJ) {
    d->static_copy = true;
    for (size_t i = 0; i < d->v.obj.len; i++) scr_dyn_mark_static_copy(d->v.obj.entries[i].value);
  }
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

ScrBytes *scr_dyn_bytes_unbox(const ScrDyn *d) {
  /* `u as Uint8Array` / `u as Buffer`: the SAME payload back, retained.
   * This is scr_dyn_arrbuf_unbox's rule asked of the VIEW kind, and the
   * two arms had drifted apart: the static->dyn direction has always
   * aliased (scr_dyn_new_bytes_ref, "one refcounted payload, two views of
   * it"), so copying on the way OUT made the round trip lose the object.
   * `(u as Buffer) === b` answered false where Node answers true, and a
   * write through the recovered value landed on a copy nobody could read
   * while SC1101's hint and scr_dyn_static_copy_refuse's text both
   * promise, unqualified, that "a Uint8Array or Buffer crosses by
   * REFERENCE and its writes do land". They do now.
   *
   * A copy also flattened a VIEW: a subarray/DataView payload keeps its
   * window and its `backing` link, and scr_bytes_copy produced a
   * standalone buffer instead, which is the same silent detach the
   * ArrayBuffer arm above refuses by name. */
  return scr_bytes_retain(d->v.bytes);
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

/* The Function.prototype.toString sentinels. Only their ADDRESSES matter;
 * the contents are documentation for a debugger. */
const char SCR_FN_SRC_NATIVE[] = "<native>";
const char SCR_FN_SRC_BOUND[] = "<bound>";

/* A boxed static function value (the compiler's static→dyn converters).
 * Ownership of the closure MOVES in; sig/name/src are static literals.
 *
 * A NULL `name` is not "no name", it is "this SITE could not name it":
 * the walker-built boxes (a function reaching dyn as a record field, a
 * union arm) hold a bare closure and have nothing to name it from. The
 * closure's entry point does, through the program's emitted name table
 * — which is keyed on exactly that pointer for exactly this reason
 * (scr_runtime.h, ScrFnName). Still NULL after the lookup means the
 * function really is anonymous, and the renderers already say so. */
ScrDyn *scr_dyn_new_func_src(ScrClosure *clo, ScrDynThunk thunk, uint32_t arity, const char *sig, const char *name,
                             const char *src) {
  ScrDyn *d = scr_dyn_alloc(SCR_DYN_FUNC);
  d->v.fn.clo = clo;
  d->v.fn.thunk = thunk;
  /* NEVER NULL, and the box refuses to exist rather than carry one. The
   * emitted dynCheck for a function type reaches straight for
   * `strcmp(scr_dyn_fn_sig(d), "<typeKey>")` -- so a NULL stored here is a
   * segfault inside GENERATED code, naming no unit and no line, which is
   * exactly how it was found and is the worst diagnostic shape this
   * project has.
   *
   * Substituting the empty string here (what this line used to do) makes
   * the crash go away and makes the DEFECT unnameable: a runtime unit
   * that forgot its signature ships a box that silently takes the
   * per-target adapter forever, and nothing ever says so. A missing
   * signature is a violation of THIS function's contract by its CALLER,
   * so it is answered where the Map box already answers the identical
   * question about its missing type key -- a trap, at the mint, naming
   * the box. The trap is uncatchable on purpose: a catchable throw from
   * a boxing conversion has no site to be caught at. */
  /* …and the same trap, widened rather than duplicated, now that the
   * three literals are stored as 32-bit offsets from the cycle anchor.
   * scr_rva_fits is the ROUND TRIP, not a range guess: the contract these
   * three carry is "a static compiler-emitted literal, never freed", and
   * a pointer that is not one is answered here, at the mint, naming the
   * box — rather than by a wild read at the first
   * Function.prototype.toString. Widening the existing condition keeps
   * the count of uncatchable abort CALL SITES exactly where it was. */
  if (sig == NULL || !scr_rva_fits(sig) || !scr_rva_fits(name) || !scr_rva_fits(src)) {
    /* TWO whole format strings, not one with a word spliced in, and ONE
     * call site. dyn-fn-sig-contract.test.ts byte-scans the compiled
     * BINARY for "was minted with no signature", because a literal in
     * the image is the only direct evidence that this guard was linked
     * into that build — a sentence assembled at runtime out of "%s" is
     * invisible to it. And one call site keeps the uncatchable-abort
     * census where it was. */
    scr_trap_fmt(sig == NULL
                     ? "scriptc: internal error: a dyn function box was minted with no signature"
                       " (name=%s)\n"
                     : "scriptc: internal error: a dyn function box was minted with a"
                       " NON-STATIC signature, name or source (name=%s); the three are stored"
                       " as 32-bit offsets from the cycle anchor and only a static literal in"
                       " this image round-trips through one\n",
                 name != NULL ? name : "<anonymous>");
  }
  d->v.fn.sig = scr_rva_of(sig);
  {
    const char *n = (name != NULL || clo == NULL) ? name : scr_fn_name_of(clo->fn);
    /* The name table's entries are static literals too, but this one did
     * not go through the check above — it came out of a lookup. */
    if (!scr_rva_fits(n)) n = NULL;
    d->v.fn.name = scr_rva_of(n);
  }
  d->v.fn.src = scr_rva_of(src);
  d->v.fn.arity = arity;
  return d;
}

/* The RUNTIME's own boxing spelling: every closure minted here is native
 * glue (a stream completion callback, the immediate thunk, the callbackify
 * wrapper), so `[native code]` is the truthful answer and the box says so
 * rather than leaving the slot ambiguous. */
ScrDyn *scr_dyn_new_func(ScrClosure *clo, ScrDynThunk thunk, uint32_t arity, const char *sig, const char *name) {
  /* The SILENT twin of the NULL signature, and the reason this spelling
   * exists separately from _src at all. A box minted HERE holds a dyn
   * thunk in `clo->fn` -- the closure's C entry point takes
   * (ScrClosure *, ScrDyn *const *, size_t) and nothing else. The
   * compiler's exact-signature branch
   *
   *     if (strcmp(scr_dyn_fn_sig(d), "func(f64,dyn)=>void") == 0)
   *         return scr_closure_retain(d->v.fn.clo);
   *
   * UNWRAPS the closure and calls `clo->fn` through the STATIC C
   * signature that type key names. So a runtime sig that happens to
   * equal a compiler type key is a call through the wrong signature: a
   * crash, or worse a silent one, inside emitted code naming no unit --
   * the same shape as the NULL, one strcmp later. `typeKey` spells every
   * function type `func(...)=>...` (ir/nodes.ts), and no human-readable
   * spelling starts that way, which is the convention scr_stream.c,
   * scr_dc.c and scr_ws_dispatch.c already follow in comments. This is
   * that convention made checkable. The COMPILER's boxes carry real type
   * keys and go through _src, which is untouched. */
  if (sig != NULL && strncmp(sig, "func(", 5) == 0) {
    scr_trap_fmt("scriptc: internal error: a runtime-minted dyn function box was given the compiler type "
                 "key '%s' as its signature (name=%s); the emitted dynCheck would unwrap its closure and "
                 "call the dyn thunk through that static C signature\n",
                 sig, name != NULL ? name : "<anonymous>");
  }
  return scr_dyn_new_func_src(clo, thunk, arity, sig, name, SCR_FN_SRC_NATIVE);
}

/* Function.prototype.toString — the ONE renderer (scr_runtime.h). JS
 * answers a function's SOURCE TEXT; `[native code]` is right only for a
 * function that has none, and a box that carries neither has no honest
 * answer at all, so it refuses instead of guessing. Never returns NULL:
 * the refusal is a TRAP, not a catchable throw. A catchable one would be
 * worse than the bug it replaces — the display walkers append the empty
 * string and leave the exception pending, and their call sites are not
 * in the may-throw seed, so `console.log(String(f))` would print a blank
 * line and exit 0. Silent is exactly what this whole item is about. The
 * circular-structure conversion trap two hundred lines up is the same
 * stance for the same reason. */
ScrStr *scr_fn_to_string(const ScrDyn *d) {
  const char *src = scr_dyn_fn_src(d);
  if (src == NULL) {
    /* A compiled user function whose source text this build did not
     * carry. Printing `[native code]` here would be a silent lie about a
     * function that HAS source — name the boundary and stop. */
    ScrJsonBuf b;
    scr_jb_init(&b);
    scr_jb_puts(&b, "scriptc: Function.prototype.toString on '");
    scr_jb_puts(&b, scr_dyn_fn_name(d) ? scr_dyn_fn_name(d) : "(anonymous)");
    scr_jb_puts(&b, "': this build carries no source text for that function value, and JS answers a "
                    "function's source text -- '[native code]' would be a wrong answer for a function "
                    "compiled from one. The text rides along where the value's CREATION SITE is "
                    "provable (a JavaScript function, arrow, class, method, or a binding holding one); "
                    "it does not where the compiler cannot see which function a value is, and a "
                    "TypeScript source carries none at all (Node stringifies a .ts program's functions "
                    "type-STRIPPED, so the file's own text would be the wrong answer there).\n");
    /* scr_jb_finish NUL-terminates, and scr_trap never returns, so the
     * string outliving the call is the point rather than a leak. */
    scr_trap(scr_jb_finish(&b)->data); /* _Noreturn */
  }
  if (src == SCR_FN_SRC_BOUND) {
    /* Node prints a bound function WITHOUT its name: `f.bind(o).name` is
     * "bound f", but its toString is the nameless native form. */
    static const char f[] = "function () { [native code] }";
    return scr_str_new(f, sizeof f - 1);
  }
  if (src == SCR_FN_SRC_NATIVE) {
    ScrJsonBuf b;
    scr_jb_init(&b);
    scr_jb_puts(&b, "function ");
    if (scr_dyn_fn_name(d)) scr_jb_puts(&b, scr_dyn_fn_name(d));
    scr_jb_puts(&b, "() { [native code] }");
    return scr_jb_finish(&b);
  }
  return scr_str_new(src, strlen(src));
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
    snprintf(detail, cap, "function %s", scr_dyn_fn_name(cb) != NULL ? scr_dyn_fn_name(cb) : "");
    break;
  case SCR_DYN_HANDLE:
    snprintf(detail, cap, "an instance of %s", scr_dyn_handle_cls(cb));
    break;
  case SCR_DYN_OBJINST:
    snprintf(detail, cap, "an instance of %s", scr_dyn_objinst_cls(cb));
    break;
  case SCR_DYN_ARRBUF: d = "an instance of ArrayBuffer"; break;
  case SCR_DYN_MAP:
    snprintf(detail, cap, "an instance of %s", scr_dyn_map_cls(cb));
    break;
  case SCR_DYN_BIG: {
    /* "type bigint (5n)" — a PRIMITIVE row, like the boolean and number
     * rows below and unlike every reference kind above. Measured
     * against Node v25.9.0: Buffer.from(5n) says
     * "Received type bigint (5n)". */
    ScrStr *s = scr_dyn_big_ops()->to_str(cb->v.big, 10);
    snprintf(detail, cap, "type bigint (%.*sn)", (int)s->len, s->data);
    scr_str_release(s);
    break;
  }
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
  case SCR_DYN_BIG: {
    /* util.inspect KEEPS the suffix where String() drops it — 5n. */
    ScrStr *s = scr_dyn_big_ops()->to_str(v->v.big, 10);
    snprintf(buf, cap, "%.*sn", (int)s->len, s->data);
    scr_str_release(s);
    return buf;
  }
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

/* ── class instances in the checked-dynamic tree (SCR_DYN_OBJINST) ────
 * The whole kind is five functions, and that is the point: the box
 * CARRIES an instance and hands it back, and every question that would
 * need the instance's LAYOUT is answered by the loud ladder rather than
 * by a fabricated shape. The descriptor is compiler-emitted, so nothing
 * here needs an install hook the way handles do. */

ScrDyn *scr_dyn_new_objinst(void *o, const ScrDynClass *cls) {
  ScrDyn *d = scr_dyn_alloc(SCR_DYN_OBJINST);
  d->v.inst.o = cls->retain(o);
  d->v.inst.cls = cls;
  return d;
}

size_t scr_dyn_objinst_pre(const ScrDyn *d) {
  /* Every hierarchy class shares the rc+vt prefix; ScrError names it —
   * the same reinterpret scr_caught_instanceof does, for the same
   * reason. A standalone class carries no vt word and can have no
   * subclass, so its descriptor's `pre` IS the instance's position. */
  if (!d->v.inst.cls->vt) return d->v.inst.cls->pre;
  return ((const ScrError *)d->v.inst.o)->vt->pre;
}

bool scr_dyn_objinst_is(const ScrDyn *d, size_t pre, size_t post) {
  if (d->kind != SCR_DYN_OBJINST) return false;
  size_t p = scr_dyn_objinst_pre(d);
  return pre <= p && p <= post;
}

void *scr_dyn_objinst_unbox(const ScrDyn *d, size_t pre, size_t post,
                            const ScrDynPath *path, const char *want) {
  if (!scr_dyn_objinst_is(d, pre, post)) {
    scr_dyn_check_fail(path, want, d);
    return NULL;
  }
  /* The SAME pointer, retained — identity survives box/unbox. */
  return d->v.inst.cls->retain(d->v.inst.o);
}

const char *scr_dyn_objinst_cls(const ScrDyn *d) {
  return d->v.inst.cls->name;
}

/* The boxed instance pointer, and only when the instance's OWN class is
 * `cls` or below it. The one thing a compiled walker needs before it may
 * GEP into a class struct through a box, and the reason it lives here
 * rather than as a pair of byte offsets in each backend: the offsets of
 * `o` and `cls` inside the ScrDyn payload union are this file's fact,
 * and the two lanes had already hardcoded three of the FUNC arm's.
 *
 * The test is `scr_dyn_objinst_is`, i.e. the RUN-TIME preorder position
 * against this descriptor's interval -- the very predicate `instanceof`
 * uses, and it is the whole point. This function used to compare
 * `d->v.inst.cls == cls`, which is a test on the box's STATIC descriptor:
 * a Derived instance in a Base-typed slot boxes as Base, so the walker
 * that asked about Derived was told no and every hierarchy class had to
 * be refused an arm. But the descriptor is not the only thing the box
 * carries. A hierarchy instance carries its VTABLE, scr_dyn_objinst_pre
 * reads the class's own position out of it, and that position is a fact
 * about the OBJECT -- never about the declared type of a slot the value
 * happened to pass through, which is the property that made the
 * descriptor test unusable in the first place.
 *
 * The INTERVAL rather than equality because a subclass's layout opens
 * with its base chain's fields as an identical prefix (that is what makes
 * an upcast a reinterpret), so a field at index i in `cls` is at index i
 * in every class below it. Today that buys nothing: the only caller is
 * the emitted [[Get]] arm, and the frontend refuses a run-time property
 * table on a class that has a subclass, so every descriptor reaching here
 * has pre == post. The interval is still the right spelling -- it is the
 * predicate `instanceof` already uses, so this is one shared narrowing
 * rule and not a second one, and it stays correct if that leaf rule
 * lifts. Answers NULL for every other kind, for a position outside the
 * interval, and for a NULL box or descriptor; never throws. */
void *scr_dyn_objinst_ptr_of(const ScrDyn *d, const ScrDynClass *cls) {
  if (d == NULL || cls == NULL) return NULL;
  return scr_dyn_objinst_is(d, cls->pre, cls->post) ? d->v.inst.o : NULL;
}

bool scr_dyn_objinst_fence(const ScrDyn *d, const char *what) {
  ScrJsonBuf b;
  scr_jb_init(&b);
  scr_jb_puts(&b, what);
  scr_jb_puts(&b, " on a dynamic ");
  scr_jb_puts(&b, scr_dyn_objinst_cls(d));
  scr_jb_puts(&b, " is not supported yet");
  scr_throw_error(SCR_ERR_ERROR, scr_jb_finish(&b));
  return false;
}

/* ── maps and sets in the checked-dynamic tree (SCR_DYN_MAP) ──────────
 * Five functions, and the shape is the OBJINST block's exactly: a Map is
 * an OPAQUE box on this side of the boundary. It carries a payload the
 * static side still owns, four questions have constant answers (typeof,
 * truthiness, String(), JSON) and every other one is answered by the
 * loud ladder rather than by a fabricated shape.
 *
 * The one thing that is NOT the OBJINST block's is the identity test.
 * OBJINST has a compiler-emitted descriptor with a preorder interval to
 * check against; ScrMap has nothing — key_kind, val_kind and three RC
 * hooks, none of which names an IR type. So the box carries the interned
 * typeKey, and both `_is` and `_unbox` go through it. See the kind's
 * comment in scr_runtime.h for the Map<string,number> / Set<string>
 * collision that makes that mandatory rather than tidy.
 *
 * scr_map.c sits in the same always-linked RUNTIME_SOURCES core as this
 * file (cc.ts:11), so scr_map_retain/scr_map_release are named directly
 * here — no installed ops table, unlike the bigint and island kinds
 * whose units are gated. */

ScrDyn *scr_dyn_new_map_ref(ScrMap *m, const char *tkey) {
  if (tkey == NULL) {
    /* An untagged box is the ONE shape that turns this kind into the
     * silent wrong answer it exists to prevent: dynMatch and dynCheck
     * would have nothing to compare and would have to fall back to the
     * kind test, which cannot tell a Map from a Set. A compiler that
     * reaches here has a bug, and a loud abort is the only honest
     * response — a fence would let the box escape into a union tag. */
    scr_trap("emitter bug: a dyn Map box with no interned type key");
  }
  ScrDyn *d = scr_dyn_alloc(SCR_DYN_MAP);
  /* The SAME ScrMap, retained — a write through either side is seen by
   * the other, the reference stance the shared representation forces. */
  d->v.map.m = scr_map_retain(m);
  d->v.map.tkey = tkey; /* a static emitted literal; never owned */
  return d;
}

bool scr_dyn_map_is(const ScrDyn *d, const char *tkey) {
  if (d->kind != SCR_DYN_MAP) return false;
  return strcmp(d->v.map.tkey, tkey) == 0;
}

ScrMap *scr_dyn_map_unbox(const ScrDyn *d, const char *tkey,
                          const ScrDynPath *path, const char *want) {
  if (!scr_dyn_map_is(d, tkey)) {
    scr_dyn_check_fail(path, want, d);
    return NULL;
  }
  /* The SAME pointer, retained — identity survives box/unbox. */
  return scr_map_retain(d->v.map.m);
}

const char *scr_dyn_map_cls(const ScrDyn *d) {
  /* The typeKey's own spelling decides the word: nodes.ts renders a map
   * as "map<K,V>" and a set as "set<E>", so the first byte separates
   * them and no second field is needed. */
  return d->v.map.tkey[0] == 's' ? "Set" : "Map";
}

bool scr_dyn_map_fence(const ScrDyn *d, const char *what) {
  ScrJsonBuf b;
  scr_jb_init(&b);
  scr_jb_puts(&b, what);
  scr_jb_puts(&b, " on a dynamic ");
  scr_jb_puts(&b, scr_dyn_map_cls(d));
  scr_jb_puts(&b, " is not supported yet");
  scr_throw_error(SCR_ERR_ERROR, scr_jb_finish(&b));
  return false;
}

/* ── bigints in the checked-dynamic tree (SCR_DYN_BIG) ────────────────
 *
 * The ops table is installed by the GATED constructor (scr_dyn_from_big,
 * scr_bigint.c) exactly as scr_dyn_alloc_jsval installs the island's, and
 * for the identical link-time reason: this file is always linked and
 * scr_bigint.c is not, so a direct scr_big_release() here would leave an
 * undefined symbol in every bigint-free binary. The gating is exact
 * rather than lucky — a program cannot hold a BIG node without having
 * produced a bigint, and producing one links the unit that installs the
 * table.
 *
 * Every entry routes to an existing scr_big_* entry point, so the dyn
 * answers and the static answers are the same code and cannot drift. */
static const ScrDynBigOps *scr_dynbig_ops = NULL;

ScrDyn *scr_dyn_alloc_big(ScrBigInt *b, const ScrDynBigOps *ops) {
  scr_dynbig_ops = ops;
  ScrDyn *d = scr_dyn_alloc(SCR_DYN_BIG);
  d->v.big = ops->retain(b); /* the box owns a strong reference */
  return d;
}

const ScrDynBigOps *scr_dyn_big_ops(void) {
  if (!scr_dynbig_ops) {
    scr_trap("scriptc: internal error: dyn bigint ops not installed\n");
  }
  return scr_dynbig_ops;
}

ScrBigInt *scr_dyn_big_of(const ScrDyn *d) {
  return d != NULL && d->kind == SCR_DYN_BIG ? d->v.big : NULL;
}

ScrBigInt *scr_dyn_big_unbox(const ScrDyn *d, const ScrDynPath *path, const char *want) {
  if (d == NULL || d->kind != SCR_DYN_BIG) {
    scr_dyn_check_fail(path, want, d);
    return NULL;
  }
  /* +1, and the SAME digits: a bigint is immutable, so sharing them is
   * unobservable and `unbox(box(x))` compares === to x either way. */
  return scr_dyn_big_ops()->retain(d->v.big);
}

/* V8's own wording, and a TypeError rather than a scriptc fence: this is
 * the ANSWER JSON.stringify gives a bigint, not a gap in the tier. */
void scr_dyn_big_json_throw(void) {
  static const char msg[] = "Do not know how to serialize a BigInt";
  scr_throw_error_msg(SCR_ERR_TYPE, msg, sizeof msg - 1);
}

bool scr_dyn_big_fence(const ScrDyn *d, const char *what) {
  ScrJsonBuf b;
  scr_jb_init(&b);
  scr_jb_puts(&b, what);
  scr_jb_puts(&b, " on a dynamic bigint is not supported yet");
  (void)d;
  scr_throw_error(SCR_ERR_ERROR, scr_jb_finish(&b));
  return false;
}

/* ── ArrayBuffer in the checked-dynamic tree (SCR_DYN_ARRBUF) ──────────
 * Three functions, because an ArrayBuffer is an OPAQUE box of bytes in
 * JS too: it carries a payload and answers `byteLength`, and every other
 * question either has a constant answer (typeof, truthiness, String(),
 * JSON) or is genuinely undefined in Node (length, indices). The arms
 * for those live beside their SCR_DYN_BYTES neighbours so the two kinds'
 * answers can be read against each other.
 *
 * The payload is the SAME ScrBytes the static side holds. That is not an
 * optimisation, it is the semantics: `new Uint8Array(buf)` taken on
 * either side of the boundary must see the other's writes, and Node has
 * no copy here at all. */

ScrDyn *scr_dyn_new_arrbuf_ref(ScrBytes *b) {
  ScrDyn *d = scr_dyn_alloc(SCR_DYN_ARRBUF);
  d->v.bytes = scr_bytes_retain(b);
  return d;
}

ScrBytes *scr_dyn_arrbuf_unbox(const ScrDyn *d, const ScrDynPath *path, const char *want) {
  if (d->kind != SCR_DYN_ARRBUF) {
    scr_dyn_check_fail(path, want, d);
    return NULL;
  }
  /* The SAME payload, retained — a view taken after the round trip still
   * aliases the buffer that went in. */
  return scr_bytes_retain(d->v.bytes);
}

ScrDyn *scr_dyn_arrbuf_key_get(const ScrDyn *d, const ScrStr *k) {
  if (k->len == 10 && memcmp(k->data, "byteLength", 10) == 0) {
    return scr_dyn_new_num((double)d->v.bytes->len);
  }
  /* `length`, every index, and every other name: undefined, and that is
   * Node's real answer rather than a fence standing in for one. An
   * ArrayBuffer has no index signature and no length — the typed-array
   * arm's `.length` and canonical-index reads would each have been a
   * confident wrong number here, which is exactly why this kind is not
   * SCR_DYN_BYTES with a flag. */
  return scr_dyn_retain(scr_dyn_undefined());
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
#ifdef SCR_DYNCEN_ON
  scr_dyncen_note_korigin(SCR_DYNCEN_KO_SET);
#endif
  /* `key_len` is a uint32 in the entry now. The ceiling is ENFORCED here
   * rather than assumed from the measured maximum of 62, and it rides the
   * allocation that is already on this line instead of adding an abort
   * call site: a 4 GB property name is out of memory, which is both the
   * truthful answer and the one this path already had. */
  if (key_len > SCR_DYN_KEY_MAX) scr_json_oom();
  char *copy = scr_json_key_alloc(key_len);
  memcpy(copy, key, key_len);
  copy[key_len] = '\0';
  scr_dyn_obj_put(obj, copy, key_len, value);
}

/* The same store for a key the COMPILER already put in the image: the
 * bytes are pointed at, not copied, and no free site will ever hand them
 * back. scr_runtime.h states what `key` must outlive. */
void scr_dyn_obj_set_lit(ScrDyn *obj, const char *key, size_t key_len, ScrDyn *value) {
  if (key_len > SCR_DYN_KEY_MAX) scr_json_oom();
  scr_dyn_obj_put_k(obj, (char *)key, key_len, value, 1);
}

/* scr_dyn_obj_set_present's literal twin: the same presence gate, and the
 * same spelled-out skip of the release on the immortal undefined. */
void scr_dyn_obj_set_present_lit(ScrDyn *obj, const char *key, size_t key_len,
                                 ScrDyn *value) {
  if (value != NULL && value->kind == SCR_DYN_UNDEF) {
    scr_dyn_release(value);
    return;
  }
  scr_dyn_obj_set_lit(obj, key, key_len, value);
}

/* The PRESENCE-GATED member store: the same set, except that an UNDEFINED
 * value does not create a key at all. The compiler's record→dyn converters
 * call this for a field whose static type carries an undefined arm, which
 * is the only way a record can hold "this key is not there".
 *
 * A record struct has one slot per declared field and a per-instance tag
 * saying which arm that slot holds, so the ABSENCE of an optional field is
 * a run-time fact the value really carries. Setting the key anyway threw
 * that fact away and answered the shape's declared field list instead:
 * `Object.keys` of `{a: 1}` widened to `object` said "a,b,c" while the SAME
 * value read as its own record said "a", and Object.values/entries walked
 * into the boundary validator and aborted on the undefined. Skipping the
 * store is the same rule the frontend's interned keys helper already writes
 * for a record receiver (recordKeysArrayCall's tag test), applied at the
 * one boundary that was answering it from the static table.
 *
 * It is NOT a rule about undefined values in general: a checked-dynamic
 * object really can hold an undefined-valued key (`{a: undefined}` built
 * dynamically lists "a" in JS, exactly as scr_dyn_obj_set leaves it). Only
 * the static→dyn record converter routes here, because only there is
 * "undefined" the representation of an absent key.
 *
 * MOVES the value like scr_dyn_obj_set — the skipped release is a no-op on
 * the immortal undefined singleton, and is spelled out rather than assumed
 * so a future non-immortal undefined cannot leak here. */
void scr_dyn_obj_set_present(ScrDyn *obj, const char *key, size_t key_len, ScrDyn *value) {
  if (value != NULL && value->kind == SCR_DYN_UNDEF) {
    scr_dyn_release(value);
    return;
  }
  scr_dyn_obj_set(obj, key, key_len, value);
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
  case SCR_DYN_ARRBUF: /* an ArrayBuffer is a JS object — a zero-byte one too */
  case SCR_DYN_FUNC:
  case SCR_DYN_HANDLE:
  case SCR_DYN_OBJINST: /* a class instance is a JS object: always truthy */
  case SCR_DYN_MAP: /* a Map/Set is a JS object — an EMPTY one too */
  case SCR_DYN_PROMISE: return true;
  case SCR_DYN_BIG:
    /* The ONE non-scalar kind whose truthiness is not constant: 0n is
     * FALSE. Inheriting the reference kinds' unconditional true — or the
     * default's unconditional false, which is what an unadded kind gets
     * here — is a wrong branch in silence, not a fence. */
    return scr_dyn_big_ops()->truthy(d->v.big);
  case SCR_DYN_JSVAL:
    /* Route to the engine's ToBoolean: objects/arrays/functions are
     * true, but the symbol/bigint edge (0n is falsy) needs the engine. */
    return scr_dyn_jsval_ops()->truthy(d->v.jsval.cell);
  default: return false; /* undefined, null */
  }
}

/* ── JS operator semantics over checked-dynamic operands ───────────────── */

/* True for the dyn kinds whose ToPrimitive is the IDENTITY and whose
 * operator semantics are the NUMBER-or-STRING pair below. The reference
 * kinds answer false: their ToPrimitive calls a user valueOf/toString,
 * and the dyn model holds no prototype chain to call one from, so the
 * operators below refuse them loudly instead of guessing (a guess there
 * would be the silent wrong value the whole checked-dynamic tier exists
 * to avoid).
 *
 * SCR_DYN_BIG is a primitive and is deliberately NOT here. A bigint's
 * ToPrimitive is the identity, but its OPERATORS are a third algebra
 * this pair does not implement: 5n + 1 is a TypeError in JS ("Cannot mix
 * BigInt and other types"), 5n + 5n is bigint addition rather than
 * double addition, and 5n < 6 compares exactly rather than through
 * ToNumber. Admitting the kind here would route all three into the
 * double path and answer a wrong NUMBER; leaving it out routes them into
 * scr_dyn_check_fail, which is a loud catchable refusal. A refusal is a
 * gap; a wrong number is a bug. (String concatenation, "x" + 5n, is the
 * one case the refusal costs a real answer — spelled String(u) it works,
 * because scr_dyn_string_coerce has the arm.) */
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
    case SCR_DYN_BIG: break; /* the documented BigInt refusal, unchanged */
    default: {
      /* A REFERENCE kind. ToNumber's first step is ToPrimitive with the
       * NUMBER hint (7.1.4 step 1), which runs a user valueOf/toString;
       * only an object that answers neither still takes the loud
       * dynCheck throw that names the site. */
      ScrDyn *p = scr_dyn_to_primitive(d, SCR_TOPRIM_NUMBER);
      if (!p) return (double)NAN; /* pending */
      double out;
      if (scr_dyn_is_prim(p)) {
        out = scr_dyn_to_number(p); /* depth 1: p is primitive */
      } else {
        scr_dyn_check_fail(NULL, "number", p);
        out = (double)NAN;
      }
      scr_dyn_release(p);
      return out;
    }
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
ScrDyn *scr_dyn_add(const ScrDyn *pa_in, const ScrDyn *pb_in) {
  /* ToPrimitive BOTH with no hint, which is what the doc above always
   * said the operator does and what the refusal below used to stand in
   * for. A bigint survives ToPrimitive unchanged and is still not
   * scr_dyn_is_prim, so `"x" + 5n` keeps its documented refusal. */
  ScrDyn *a = scr_dyn_to_primitive(pa_in, SCR_TOPRIM_DEFAULT);
  if (!a) return NULL;
  ScrDyn *b = scr_dyn_to_primitive(pb_in, SCR_TOPRIM_DEFAULT);
  if (!b) {
    scr_dyn_release(a);
    return NULL;
  }
  ScrDyn *scr_add_out = NULL;
  if (!scr_dyn_is_prim(a)) {
    scr_dyn_check_fail(NULL, "a number or a string", a);
    goto scr_add_done;
  }
  if (!scr_dyn_is_prim(b)) {
    scr_dyn_check_fail(NULL, "a number or a string", b);
    goto scr_add_done;
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
    scr_add_out = scr_dyn_new_str(cat); /* retains cat into the node */
    scr_str_release(cat);
    goto scr_add_done;
  }
  scr_add_out = scr_dyn_new_num(scr_dyn_to_number(a) + scr_dyn_to_number(b));
scr_add_done:
  scr_dyn_release(a);
  scr_dyn_release(b);
  return scr_add_out;
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
static bool scr_dyn_rel(const ScrDyn *pa_in, const ScrDyn *pb_in, int op) {
  int c;
  /* Both sides ToPrimitive with the NUMBER hint, as 7.2.13 step 1 says.
   * A bigint is still not scr_dyn_is_prim, so it keeps its refusal. */
  ScrDyn *a = scr_dyn_to_primitive(pa_in, SCR_TOPRIM_NUMBER);
  if (!a) return false;
  ScrDyn *b = scr_dyn_to_primitive(pb_in, SCR_TOPRIM_NUMBER);
  if (!b) {
    scr_dyn_release(a);
    return false;
  }
  bool scr_rel_out = false;
  if (!scr_dyn_is_prim(a)) {
    scr_dyn_check_fail(NULL, "a number or a string", a);
    goto scr_rel_done;
  }
  if (!scr_dyn_is_prim(b)) {
    scr_dyn_check_fail(NULL, "a number or a string", b);
    goto scr_rel_done;
  }
  if (a->kind == SCR_DYN_STR && b->kind == SCR_DYN_STR) {
    c = scr_str_cmp(a->v.str, b->v.str);
    c = c < 0 ? -1 : (c > 0 ? 1 : 0);
  } else {
    double x = scr_dyn_to_number(a);
    double y = scr_dyn_to_number(b);
    if (x != x || y != y) goto scr_rel_done; /* NaN: every relational op is false */
    c = x < y ? -1 : (x > y ? 1 : 0);   /* ±0 compare equal, like JS */
  }
  switch (op) {
  case 0: scr_rel_out = c < 0; break;   /* <  */
  case 1: scr_rel_out = c <= 0; break;  /* <= */
  case 2: scr_rel_out = c > 0; break;   /* >  */
  default: scr_rel_out = c >= 0; break; /* >= */
  }
scr_rel_done:
  scr_dyn_release(a);
  scr_dyn_release(b);
  return scr_rel_out;
}

/* One entry point per operator, so the emitted call needs no synthesized
 * constant argument and both backends map it by name alone. */
bool scr_dyn_lt(const ScrDyn *a, const ScrDyn *b) { return scr_dyn_rel(a, b, 0); }
bool scr_dyn_le(const ScrDyn *a, const ScrDyn *b) { return scr_dyn_rel(a, b, 1); }
bool scr_dyn_gt(const ScrDyn *a, const ScrDyn *b) { return scr_dyn_rel(a, b, 2); }
bool scr_dyn_ge(const ScrDyn *a, const ScrDyn *b) { return scr_dyn_rel(a, b, 3); }

/* THE typeof table for the native dyn kinds — one list, no allocation.
 * `typeof v` and `typeof v === "object"` are the same question asked two
 * ways, and both emitters ask the second one constantly (every predicate
 * that probes an unknown value opens with it). Before this they each
 * spelled their own kind list inline, three copies of the table below,
 * and adding SCR_DYN_OBJINST to two of them left the third answering
 * "string" for a boxed class instance. Now there is one list. JSVAL is
 * absent on purpose: an island value's answer is the ENGINE's, which
 * needs the ops call the two callers below make. */
static const char *scr_dyn_typeof_native(const ScrDyn *d) {
  switch (d->kind) {
  case SCR_DYN_UNDEF: return "undefined";
  case SCR_DYN_NULL:      /* JS's oldest wart, preserved */
  case SCR_DYN_OBJ:
  case SCR_DYN_ARR:
  case SCR_DYN_BYTES:
  case SCR_DYN_ARRBUF:
  case SCR_DYN_HANDLE:
  case SCR_DYN_OBJINST:
  case SCR_DYN_MAP:
  case SCR_DYN_PROMISE: return "object";
  case SCR_DYN_BOOL: return "boolean";
  case SCR_DYN_NUM: return "number";
  case SCR_DYN_STR: return "string";
  case SCR_DYN_FUNC: return "function";
  case SCR_DYN_BIG: return "bigint"; /* its own answer, shared with no
    * other kind — the whole reason this is a kind and not a flag. The
    * "starts with 'o'" test in scr_dyn_typeof_is_object below still
    * holds: "bigint" starts with 'b', like "boolean", and only "object"
    * starts with 'o'. */
  default: return "undefined";
  }
}

/* Bare `typeof v` on a dyn value: the dyn kind's JS answer (+1 string). */
ScrStr *scr_dyn_typeof(const ScrDyn *d) {
  /* An island value answers the ENGINE's typeof — "object" for the
   * wrapped objects/arrays, "function" for engine functions (row 1 of
   * the jsval→dyn op table; scalars normalized away at wrap time). */
  if (d->kind == SCR_DYN_JSVAL) return scr_dyn_jsval_ops()->type_of(d->v.jsval.cell);
  const char *s = scr_dyn_typeof_native(d);
  return scr_str_new(s, strlen(s));
}

/* `typeof v === "object"` — the emitted form both backends call, reading
 * the one table above. Borrowed; never throws, never allocates. */
bool scr_dyn_typeof_is_object(const ScrDyn *d) {
  if (d->kind == SCR_DYN_JSVAL) return scr_dyn_isl_typeof_is(d, "object");
  return scr_dyn_typeof_native(d)[0] == 'o'; /* only "object" starts with 'o' */
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

/* ── the toJSON protocol over a dyn value ─────────────────────────────
 * SerializeJSONProperty's FIRST step, before anything else looks at the
 * value: an OBJECT whose [[Get]] of "toJSON" answers a CALLABLE runs it
 * with the value as the receiver and the property key as its one
 * argument, and the RESULT is what serializes from there on.
 *
 * Three spec details this encodes, each observable:
 *  - the lookup is a [[Get]], so an inherited toJSON counts (the
 *    `F.prototype.toJSON = ...` pre-class shape scr_dyn_invoke already
 *    dispatches);
 *  - a toJSON that is NOT callable is an ordinary member and serializes
 *    as one (`{a:1, toJSON:5}` is `{"a":1,"toJSON":5}`, not `5`);
 *  - the hook runs ONCE per position. The result is serialized RAW — its
 *    own toJSON is not consulted again — while its MEMBERS get their own
 *    hook, exactly the spec's recursion.
 * The key is JS's: a property name, an array index as a decimal string,
 * and the EMPTY string at the root.
 *
 * Only SCR_DYN_OBJ can carry the member; every other kind answers NULL
 * after one comparison, so the walk pays nothing for scalars and arrays.
 * Buffer's toJSON is not this — SCR_DYN_BYTES spells Node's
 * {"type":"Buffer","data":[...]} shape directly below.
 *
 * Returns the hook's result (+1, the CALLER releases) or NULL. NULL is
 * two answers — "no hook ran, serialize `d` itself" and "the hook THREW"
 * — which scr_exc_pending() separates; every caller already runs a
 * pending check, so a throwing toJSON propagates instead of being
 * swallowed into a `{}`.
 *
 * ── SCR_JSON_REENTRANCY ───────────────────────────────────────────────
 * This is the first thing in either dyn walker that runs USER CODE mid-
 * walk, so both walks now have to survive their own callee mutating the
 * tree they are standing on (a hook closed over an ancestor doing
 * `delete parent.k` or `arr.pop()`). Every member/slot loop therefore:
 *  - COPIES the key bytes into a ScrStr and RETAINS the value BEFORE
 *    calling, and never touches the ScrDynEntry again — a delete frees
 *    both, and the entry table itself reallocates;
 *  - re-bounds against the CURRENT entry count each iteration, because
 *    the key-order array was sized to the old one.
 * ARRAYS are exact under this: the length is read ONCE and a slot past
 * the shrunk end reads undefined, which is `null` — V8's
 * SerializeJSONArray to the letter. OBJECTS are not: V8 snapshots the
 * key list and re-[[Get]]s each key, so a member added mid-walk is
 * absent and one deleted drops, while this walk stops at the resize.
 * Matching that costs a key snapshot plus an O(n) lookup per key —
 * O(n^2) on a walk that is otherwise linear — to buy a case that needs a
 * toJSON closed over an ancestor. Declared, not silent. MEMORY safety is
 * claimed in both. */
static ScrDyn *scr_dyn_json_tojson(const ScrDyn *d, const char *key, size_t key_len) {
  if (d->kind != SCR_DYN_OBJ) return NULL;
  static const char name[] = "toJSON";
  const size_t name_len = sizeof name - 1;
  /* BORROWED both — own member first, then the prototype chain: JS's
   * [[Get]], and scr_dyn_invoke's OBJ dispatch order. Open-coded rather
   * than delegated to scr_dyn_invoke so that (a) a missing or
   * non-callable toJSON stays an ordinary member instead of taking
   * invoke's "is not a function" throw, and (b) scr_json.c — which every
   * binary links — does not acquire an edge to scr_dyn_invoke.c and drag
   * the whole prototype-dispatch module into programs that never call a
   * dyn method. Everything used below already lives in this file. */
  const ScrDyn *m = scr_dyn_obj_get(d, name, name_len);
  if (m == NULL) m = scr_dyn_proto_get(d, name, name_len);
  if (m == NULL) return NULL;
  if (m->kind != SCR_DYN_FUNC &&
      !(m->kind == SCR_DYN_JSVAL && scr_dyn_isl_typeof_is(m, "function"))) {
    return NULL; /* a non-callable toJSON is data, like JS */
  }
  /* The key argument is built only now that the hook is known to run —
   * scalars and hookless objects allocate nothing. */
  ScrStr *ks = scr_str_new(key, key_len); /* +1 */
  ScrDyn *karg = scr_dyn_new_str(ks);     /* +1; RETAINS ks */
  scr_str_release(ks);                    /* karg holds the only reference now */
  /* JS binds the receiver for `v.toJSON(key)` — the ambient-receiver
   * window, exactly scr_dyn_invoke's OBJ arm. args are BORROWED by the
   * call; the result is +1, or NULL with the exception pending. */
  scr_dyn_this_push_dyn(d);
  ScrDyn *r = scr_dyn_call(m, &karg, 1, "toJSON");
  scr_dyn_this_pop();
  scr_dyn_release(karg);
  return r;
}

/* Is this dyn value ABSENT under stringify — the undefined/function rule
 * that drops an object member and prints null in an array slot? Decided
 * from the KIND alone, so the answer is available BEFORE anything is
 * written and the two walkers below need no speculative buffer. */
static bool scr_dyn_json_absent(const ScrDyn *d) {
  return d->kind == SCR_DYN_UNDEF || d->kind == SCR_DYN_FUNC ||
         (d->kind == SCR_DYN_JSVAL && scr_dyn_isl_typeof_is(d, "function"));
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
 * "undefined" there, Node's tryStringify tail).
 *
 * `_raw` is the walk with the toJSON protocol ALREADY applied at this
 * position (so a hook's result is not re-hooked); scr_dyn_json_write is
 * the keyed entry every recursion goes through. */
static bool scr_dyn_json_write(ScrJsonBuf *b, const ScrDyn *d, const char *key, size_t key_len);

static bool scr_dyn_json_write_raw(ScrJsonBuf *b, const ScrDyn *d) {
  switch (d->kind) {
  case SCR_DYN_UNDEF:
  case SCR_DYN_FUNC:
    return false;
  case SCR_DYN_NULL: scr_jb_puts(b, "null"); return true;
  case SCR_DYN_BOOL: scr_jb_puts(b, d->v.b ? "true" : "false"); return true;
  case SCR_DYN_NUM: scr_jb_put_f64(b, d->v.num); return true;
  case SCR_DYN_STR: scr_jb_put_json_str(b, d->v.str); return true;
  case SCR_DYN_ARR: {
    /* SCR_JSON_REENTRANCY: the length is read ONCE, like V8's
     * SerializeJSONArray — a hook that shrinks the array mid-walk leaves
     * the remaining slots reading undefined, which is `null`. */
    const size_t alen = d->v.arr.len;
    scr_jb_putc(b, '[');
    for (size_t i = 0; i < alen; i++) {
      if (i > 0) scr_jb_putc(b, ',');
      if (i >= d->v.arr.len) { /* the walk's own user code shrank it */
        scr_jb_puts(b, "null");
        continue;
      }
      /* The slot's toJSON key is its INDEX as a decimal string. */
      char ik[24];
      int ikn = snprintf(ik, sizeof ik, "%zu", i);
      /* PINNED across the hook: the hook is user code and can reach this
       * array through a closure, and a splice/pop would release the slot
       * out from under the walk. */
      ScrDyn *el = scr_dyn_retain(d->v.arr.items[i]);
      bool present = scr_dyn_json_write(b, el, ik, (size_t)ikn);
      scr_dyn_release(el);
      if (!present) scr_jb_puts(b, "null");
      if (scr_exc_pending()) return true; /* a slot threw; the caller unwinds */
    }
    scr_jb_putc(b, ']');
    return true;
  }
  case SCR_DYN_OBJ: {
    scr_jb_putc(b, '{');
    bool first = true;
    size_t *ord = scr_dyn_obj_key_order(d); /* JS own-key order, NULL when stored order is it */
    const size_t n = d->v.obj.len;          /* SCR_JSON_REENTRANCY: `ord` is sized to this */
    for (size_t oi = 0; oi < n; oi++) {
      if (d->v.obj.len != n) break; /* the walk's own user code resized the table */
      const ScrDynEntry *ent = &d->v.obj.entries[ord ? ord[oi] : oi];
      /* SNAPSHOT before any user code runs: the hook below can reach this
       * object through a closure, and a `delete` of this key frees both
       * the key bytes and the value. `ent` is not read again after this
       * pair. */
      ScrStr *k = scr_str_new(ent->key, ent->key_len); /* +1 */
      /* An ENUMERABLE ACCESSOR is read by RUNNING its getter, here, in
       * this position — SerializeJSONProperty is a [[Get]], and Node
       * calls the getter once per stringify. A tombstone is not an own
       * enumerable key and is stepped over. */
      bool sl_skip = false;
      ScrDyn *mv = scr_dyn_obj_entry_read((ScrDyn *)d, ent, &sl_skip); /* +1 or NULL */
      if (mv == NULL) {
        scr_str_release(k);
        if (sl_skip) continue;
        free(ord);
        return true; /* the getter threw; the caller checks the pending exception */
      }
      /* The toJSON protocol runs BEFORE the drop test — an omitted member
       * is decided by what toJSON ANSWERED, not by the raw member (a hook
       * returning undefined drops the key; a hook on an undefined-looking
       * member cannot exist, since only objects carry one). */
      ScrDyn *sub = scr_dyn_json_tojson(mv, k->data, k->len); /* +1 or NULL */
      if (scr_exc_pending()) { /* the hook threw: propagate, do not swallow */
        if (sub) scr_dyn_release(sub);
        scr_dyn_release(mv);
        scr_str_release(k);
        free(ord);
        return true; /* pending exception; caller checks */
      }
      const ScrDyn *val = sub ? sub : mv;
      if (scr_dyn_json_absent(val)) {
        if (sub) scr_dyn_release(sub);
        scr_dyn_release(mv);
        scr_str_release(k);
        continue; /* undefined/function members drop, like Node */
      }
      if (!first) scr_jb_putc(b, ',');
      first = false;
      scr_jb_put_json_str(b, k);
      scr_jb_putc(b, ':');
      scr_dyn_json_write_raw(b, val); /* absence already decided above */
      if (sub) scr_dyn_release(sub);
      scr_dyn_release(mv);
      scr_str_release(k);
      if (scr_exc_pending()) { /* a nested member threw */
        free(ord);
        return true;
      }
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
  case SCR_DYN_ARRBUF:
    /* An ArrayBuffer has no own enumerable properties, so Node writes
     * {} — a real answer, not an approximation, and NOT the typed
     * array's index-keyed form. */
    scr_jb_puts(b, "{}");
    return true;
  case SCR_DYN_MAP:
    /* A Map's and a Set's entries live in internal slots, not in own
     * enumerable properties, so Node writes {} here as well —
     * JSON.stringify(new Map([["a",1]])) really is "{}". A real answer,
     * measured against v25.9.0, and the ONE place the "husk" shape that
     * keeps a Map out of isJsonSafeType is exactly what JS asks for. */
    scr_jb_puts(b, "{}");
    return true;
  case SCR_DYN_BIG:
    /* Node THROWS here, and the throw IS the answer rather than a fence
     * standing in for one: JSON has no bigint and JSON.stringify(5n) is
     * a TypeError in V8. This is also why bigint is absent from
     * isJsonSafeType and must stay absent. */
    scr_dyn_big_json_throw();
    return true; /* pending exception; caller checks */
  case SCR_DYN_OBJINST:
    /* Named by its class, like every other OBJINST refusal. */
    scr_dyn_objinst_fence(d, "JSON.stringify");
    return true; /* pending exception; caller checks */
  case SCR_DYN_HANDLE:
  default: {
    const char *msg = "JSON.stringify of a runtime handle is not supported yet";
    scr_throw_error_msg(SCR_ERR_ERROR, msg, strlen(msg));
    return true; /* pending exception; caller checks */
  }
  }
}

/* The keyed entry: apply the position's toJSON hook, then serialize what
 * it answered. A hook that answers undefined (or a function) makes THIS
 * POSITION absent — the object member drops, the array slot prints null,
 * and the root spells "undefined" — which is the whole point of running
 * the drop test on the hook's RESULT rather than on the raw value. */
static bool scr_dyn_json_write(ScrJsonBuf *b, const ScrDyn *d, const char *key, size_t key_len) {
  ScrDyn *sub = scr_dyn_json_tojson(d, key, key_len); /* +1 or NULL */
  if (sub == NULL) {
    if (scr_exc_pending()) return true; /* the hook threw; caller checks */
    return scr_dyn_json_write_raw(b, d);
  }
  bool present = !scr_dyn_json_absent(sub) && scr_dyn_json_write_raw(b, sub);
  scr_dyn_release(sub);
  return present;
}

/* util.format's %j argument (+1): the stringify text, "undefined" for a
 * root the stringify drops, or NULL with a pending exception (a handle
 * inside the tree, or a throwing toJSON). */
ScrStr *scr_dyn_format_j(const ScrDyn *d) {
  ScrJsonBuf b;
  scr_jb_init(&b);
  /* JSON's root key is the empty string — what a root toJSON receives. */
  bool present = scr_dyn_json_write(&b, d, "", 0);
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

/* The per-KIND prototype (%TypeError.prototype% and friends) — declared
 * here because the error encoding below is built before the singletons
 * are defined. */
static ScrDyn *scr_dyn_error_kind_prototype(int kind);

/* Install one own NON-ENUMERABLE data property, taking the caller's +1 on
 * the value (define_hidden_data borrows, and every caller here has a fresh
 * node to hand over). */
static void scr_err_hide(ScrDyn *d, const char *key, size_t key_len, ScrDyn *v) {
  scr_dyn_obj_define_hidden_data(d, key, key_len, v, true, true);
  scr_dyn_release(v);
}

ScrDyn *scr_dyn_from_error(const ScrError *e) {
  for (size_t i = 0; i < scr_errdyn_n; i++) {
    if (scr_errdyn_cache[i].err == e) return scr_dyn_retain(scr_errdyn_cache[i].dyn);
  }
  /* NODE'S SHAPE, built out of machinery that was already here and that
   * this encoding did not use: the %Error.prototype% chain, and the
   * `hidden` table of own NON-ENUMERABLE properties.
   *
   * What it replaces is three ENUMERABLE members — a reserved "%error"
   * marker plus `name` and `message` — sitting in `entries`, which is the
   * one table Object.keys / getOwnPropertyNames / for-in / spread /
   * Object.assign / Object.entries / JSON.stringify / structuredClone and
   * the index-signature capture all read. `Object.keys(caught)` answered
   * ["%error","name","message"] where Node answers [], `JSON.stringify`
   * answered the marker, `"%error" in e` answered true, and the capture
   * threw `expected string at $.%error, got boolean`. One encoding, ten
   * wrong surfaces, all of them the same fact: a COMPILER-RESERVED key
   * was an own enumerable property of a value the program can enumerate.
   *
   * Node's own shape is the fix, member for member:
   *   [[Prototype]]  %<Kind>.prototype% -> %Error.prototype%
   *   message        own, NON-ENUMERABLE (Node: own, non-enumerable)
   *   name           on the PROTOTYPE unless it was ASSIGNED (below)
   *   code           own ENUMERABLE — Node's system errors set it by
   *                  assignment, so Object.keys(fsErr) DOES list it
   *   stack          absent; compiled binaries carry no stack, which is
   *                  the documented divergence Object.getOwnPropertyNames
   *                  already fences on (scr_dyn_own_names_fence)
   * and there is no marker at all: `instanceof Error`, the dynCheck and
   * every other consumer ask scr_dyn_is_error_encoding, which reads the
   * [[Prototype]] chain. That is also what makes a USER'S OWN "%error"
   * key an ordinary property again — it used to be read as the compiler's
   * marker, so `JSON.parse('{"%error":true}') instanceof Error` answered
   * true and `String(...)` answered "Error: ...". */
  ScrDyn *d = scr_dyn_new_obj();
  const int kind = scr_error_kind_of(e);
  ScrDyn *proto = scr_dyn_error_kind_prototype(kind); /* +1 */
  scr_dyn_obj_set_proto(d, proto);
  scr_dyn_release(proto);
  scr_err_hide(d, "message", 7, scr_dyn_new_str(e->message));
  /* `name`, and WHERE it goes is the whole question. The kind's own name
   * ("TypeError") is TypeError.prototype.name in Node — non-enumerable,
   * inherited, invisible to Object.keys — and the per-kind prototype above
   * already carries it. Anything ELSE was assigned (`e.name = "Custom"`),
   * and an assignment in JS makes an own ENUMERABLE property that
   * Object.keys DOES list. DOMException is the one exception: its name is
   * a prototype GETTER in Node however far it is from the default, so
   * `Object.keys(new DOMException(m, "NotFoundError"))` is still []. */
  {
    const char *canon = scr_error_kind_name(kind < 0 ? SCR_ERR_ERROR : kind);
    const size_t cl = strlen(canon);
    const bool assigned = e->name->len != cl || memcmp(e->name->data, canon, cl) != 0;
    if (assigned) {
      if (kind == SCR_ERR_DOMEX) scr_err_hide(d, "name", 4, scr_dyn_new_str(e->name));
      else scr_dyn_obj_set(d, "name", 4, scr_dyn_new_str(e->name));
    }
  }
  if (e->code) scr_dyn_obj_set(d, "code", 4, scr_dyn_new_str(e->code));
  /* DOMException: `code` is the WebIDL legacy NUMBER (never the errno
   * string slot), and the options form's cause crosses as itself. Both are
   * NON-ENUMERABLE in Node — `code` is a prototype getter and `cause` is
   * what `new Error(m, { cause })` installs — so Object.keys is []. */
  if (e->vt == &scr_error_vts[SCR_ERR_DOMEX]) {
    scr_err_hide(d, "code", 4, scr_dyn_new_num(scr_domex_code((ScrError *)e)));
    if (scr_domex_has_cause((ScrError *)e)) {
      scr_err_hide(d, "cause", 5, scr_domex_cause((ScrError *)e));
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
 * suite's shape); an alien error-shaped object rebuilds a runtime error
 * from its name/message/code (the vtable kind resolves from the name so a
 * later `instanceof TypeError` still answers) and ENTERS the cache, so
 * its next boxing answers the same dyn node. The dyn node is borrowed. */
/* One own-or-inherited DATA read over an error-encoded dyn object, BORROW
 * only (NULL when absent). The full [[Get]] would be +1 and could throw a
 * getter's exception; every caller here is a diagnostic or a rebuild that
 * holds no exception path, which is the same trade scr_dyn_obj_own_data
 * and scr_dyn_proto_get already document. */
const ScrDyn *scr_dyn_err_read(const ScrDyn *d, const char *key, size_t key_len) {
  if (d == NULL || d->kind != SCR_DYN_OBJ) return NULL;
  const ScrDyn *v = scr_dyn_obj_own_data(d, key, key_len);
  return v != NULL ? v : scr_dyn_proto_get(d, key, key_len);
}

ScrError *scr_error_from_dyn(const ScrDyn *d) {
  ScrError *hit = scr_errdyn_err_of(d);
  if (hit) return hit;
  /* name/message/code live wherever the encoding put them: an ASSIGNED
   * name is an own enumerable member, the kind's name is on the
   * prototype, and `message` is an own hidden one. own_data covers the
   * first two tables and proto_get the chain — both borrow-only, which
   * is what this function's contract can pay for. */
  const ScrDyn *en = scr_dyn_err_read(d, "name", 4);
  const ScrDyn *em = scr_dyn_err_read(d, "message", 7);
  const ScrDyn *ec = scr_dyn_err_read(d, "code", 4);
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

/* ── %Error.prototype% ─────────────────────────────────────────────────
 *
 * The one prototype object this tier holds by NAME. `Error.prototype` is
 * the FIRST argument of protobufjs's `util.newError`
 * (`CustomError.prototype = Object.create(Error.prototype, { … })`), and
 * a prototype argument has to be a real dyn OBJ for the link to exist —
 * the own-copy stand-in the frontend refuses would answer `Object.keys`,
 * delegation and `instanceof` wrong.
 *
 * A PROCESS SINGLETON, because JS has exactly one: two expressions that
 * both say `Error.prototype` must answer the SAME node, or `===`, the
 * chain walk and `Object.getPrototypeOf` would all disagree with Node.
 *
 * Its shape is Node's, minus one member, and the difference is LOUD:
 *
 *   name      "Error"   own, non-enumerable, writable, configurable
 *   message   ""        own, non-enumerable, writable, configurable
 *   toString  <native>  own, non-enumerable, writable, configurable
 *   constructor         ABSENT — scr_dyn_error_ctor_fence, never undefined
 *
 * `Object.keys(Error.prototype)` is `[]` in Node, and all three live in
 * the `hidden` table, so it is `[]` here for the same REASON rather than
 * by luck. `cname` is deliberately left NULL: Node's
 * `util.inspect(Error.prototype)` is `{}`, and a constructor name would
 * make it print `Error {}` and infect every descendant.
 *
 * REFCOUNTS, by hand (ASan does not link on the Windows/zig lane):
 *   - `scr_error_proto` holds one reference for the process; the atexit
 *     teardown drops it, and re-entry after teardown rebuilds.
 *   - Each call hands out +1; the emitted code releases it like any
 *     other dyn temporary.
 *   - The three members are owned by the singleton's hidden table and
 *     die with it. The `toString` closure captures NOTHING (0 caps), so
 *     it holds no reference back to the prototype.
 *   - A descendant (`Object.create(Error.prototype, …)`) retains the
 *     singleton through its [[Prototype]] link; the singleton holds no
 *     reference to any descendant. The graph is a TREE rooted at one
 *     immortal node — there is no cycle to break, which is exactly why
 *     `constructor` (the one edge that WOULD close one, and which has no
 *     value to point at in this tier anyway) is a fence instead.
 */
static ScrDyn *scr_error_proto;

static void scr_error_proto_teardown(void) {
  scr_dyn_release(scr_error_proto);
  scr_error_proto = NULL;
}

/* %TypeError.prototype% / %RangeError.prototype% / %SyntaxError.prototype%
 * - one object per kind, each carrying its own NON-ENUMERABLE `name` and
 * linked to %Error.prototype%. They exist for one reason: in Node the
 * constructor's name is a property of the CONSTRUCTOR'S prototype, so
 * `Object.hasOwn(new TypeError("x"), "name")` is FALSE and `e.name` is
 * still "TypeError". Hanging the name on the instance would answer the
 * second question right and the first one wrong.
 *
 * The other three kinds need none. SCR_ERR_ERROR's name IS
 * %Error.prototype%'s; DOMException's DEFAULT name is "Error" too (WebIDL)
 * and its resolved name is per-INSTANCE, so it rides an own hidden
 * property; and a compiled `extends Error` subclass (kind -1) has no
 * builtin name at all.
 *
 * Refcounts follow %Error.prototype%'s: one process reference each,
 * dropped by an atexit registered ONCE, and each holds a reference to the
 * base through its [[Prototype]] link - a tree, no cycle. The base is
 * created first (this function asks for it), so its teardown is registered
 * first and runs LAST. */
static ScrDyn *scr_error_kind_proto[5];
static bool scr_error_kind_proto_registered;

static void scr_error_kind_proto_teardown(void) {
  for (int i = 0; i < 5; i++) {
    scr_dyn_release(scr_error_kind_proto[i]);
    scr_error_kind_proto[i] = NULL;
  }
  scr_error_kind_proto_registered = false;
}

static ScrDyn *scr_dyn_error_kind_prototype(int kind) {
  if (kind < SCR_ERR_TYPE || kind > SCR_ERR_SYNTAX) return scr_dyn_error_prototype();
  if (scr_error_kind_proto[kind] == NULL) {
    ScrDyn *p = scr_dyn_new_obj(); /* +1, the process's */
    ScrDyn *base = scr_dyn_error_prototype(); /* +1 */
    scr_dyn_obj_set_proto(p, base);
    scr_dyn_release(base);
    const char *nm = scr_error_kind_name(kind);
    ScrStr *ns = scr_str_new(nm, strlen(nm));
    ScrDyn *n = scr_dyn_new_str(ns); /* retains ns */
    scr_str_release(ns);
    scr_dyn_obj_define_hidden_data(p, "name", 4, n, true, true);
    scr_dyn_release(n);
    scr_error_kind_proto[kind] = p;
    if (!scr_error_kind_proto_registered) {
      scr_error_kind_proto_registered = true;
      scr_atexit(scr_error_kind_proto_teardown);
    }
  }
  return scr_dyn_retain(scr_error_kind_proto[kind]);
}

/* `Error.prototype.toString()` — ES's Error.prototype.toString, whole:
 * ToString(this.name, defaulting to "Error"), ToString(this.message,
 * defaulting to ""), joined with ": " unless one side is empty. Reads
 * through the FULL [[Get]] (scr_dyn_obj_key_get) because a descendant's
 * `name` is routinely an ACCESSOR — that is exactly how protobufjs
 * spells it — and a borrow-only read would miss it and answer "Error"
 * for every custom error type. Both reads and both coercions can throw
 * (a getter's own exception); each is checked and propagated with the
 * exception left pending. */
static ScrDyn *scr_error_proto_to_string_thunk(ScrClosure *clo, ScrDyn *const *args,
                                               size_t argc) {
  (void)clo;
  (void)args;
  (void)argc;
  ScrStr *name = NULL;
  ScrStr *message = NULL;
  ScrDyn *self = scr_dyn_this_get(); /* +1; the undefined singleton with no binding */
  if (self->kind != SCR_DYN_OBJ) {
    scr_dyn_release(self);
    static const char msg[] = "Error.prototype.toString called on non-object";
    scr_throw_error_msg(SCR_ERR_TYPE, msg, sizeof msg - 1);
    return NULL;
  }
  ScrDyn *nv = scr_dyn_obj_key_get(self, "name", 4); /* +1, or NULL pending */
  if (nv == NULL) goto fail;
  name = nv->kind == SCR_DYN_UNDEF ? scr_str_new("Error", 5) : scr_dyn_string_coerce_js(nv);
  scr_dyn_release(nv);
  if (name == NULL) goto fail;
  ScrDyn *mv = scr_dyn_obj_key_get(self, "message", 7); /* +1, or NULL pending */
  if (mv == NULL) goto fail;
  message = mv->kind == SCR_DYN_UNDEF ? scr_str_new("", 0) : scr_dyn_string_coerce_js(mv);
  scr_dyn_release(mv);
  if (message == NULL) goto fail;
  scr_dyn_release(self);
  /* scr_dyn_new_str RETAINS its argument, so every string built here is
   * released after the box is made — the box holds the reference it
   * needs and these locals hold their own. */
  ScrStr *out;
  if (name->len == 0) {
    out = scr_str_retain(message);
  } else if (message->len == 0) {
    out = scr_str_retain(name);
  } else {
    ScrJsonBuf b;
    scr_jb_init(&b);
    scr_jb_write(&b, name->data, name->len);
    scr_jb_puts(&b, ": ");
    scr_jb_write(&b, message->data, message->len);
    out = scr_jb_finish(&b); /* +1 */
  }
  scr_str_release(name);
  scr_str_release(message);
  ScrDyn *r = scr_dyn_new_str(out);
  scr_str_release(out);
  return r;
fail:
  scr_str_release(name);
  scr_str_release(message);
  scr_dyn_release(self);
  return NULL; /* the getter's / the coercion's own exception is pending */
}

ScrDyn *scr_dyn_error_prototype(void) {
  if (scr_error_proto == NULL) {
    ScrDyn *p = scr_dyn_new_obj(); /* +1, the process's */
    ScrStr *ns = scr_str_new("Error", 5);
    ScrDyn *n = scr_dyn_new_str(ns); /* retains ns */
    scr_str_release(ns);
    scr_dyn_obj_define_hidden_data(p, "name", 4, n, true, true);
    scr_dyn_release(n);
    ScrStr *ms = scr_str_new("", 0);
    ScrDyn *m = scr_dyn_new_str(ms);
    scr_str_release(ms);
    scr_dyn_obj_define_hidden_data(p, "message", 7, m, true, true);
    scr_dyn_release(m);
    ScrDyn *ts = scr_dyn_new_func(scr_closure_new((void *)scr_error_proto_to_string_thunk, 0),
                                  scr_error_proto_to_string_thunk, 0, "()", "toString");
    scr_dyn_obj_define_hidden_data(p, "toString", 8, ts, true, true);
    scr_dyn_release(ts);
    scr_error_proto = p;
    scr_atexit(scr_error_proto_teardown);
  }
  return scr_dyn_retain(scr_error_proto);
}

/* Is %Error.prototype% this value, or anywhere above it? IDENTITY, not
 * shape — the singleton is the only node that can answer true, so a
 * hand-built `{ name: "Error" }` never does. Bounded like every other
 * chain walk here, so a hand-made cycle cannot hang the program. */
bool scr_dyn_error_proto_in_chain(const ScrDyn *d) {
  if (scr_error_proto == NULL) return false;
  for (size_t steps = 0; d != NULL && steps <= SCR_PROTO_MAX_DEPTH; steps++) {
    if (d == scr_error_proto) return true;
    if (d->kind != SCR_DYN_OBJ) return false;
    d = scr_dyn_ext(d)->proto;
  }
  return false;
}

/* Is this dyn value the runtime's ERROR ENCODING? The one question every
 * consumer used to open-code as `scr_dyn_obj_get(d, "%error", 6) != NULL`
 * — in three runtime units and in emitted C and emitted LLVM from both
 * backends.
 *
 * A reserved KEY could never answer it, and that is the defect rather
 * than a detail of it: "%" is a legal first character of a JavaScript
 * property name, so `JSON.parse('{"%error":true,"name":"Error"}')`
 * satisfied the test and became an Error — `instanceof Error` true,
 * `String(...)` "Error: ...", both silently wrong — while the marker
 * itself was an own enumerable property of every real error the program
 * could enumerate. The two halves are one fact seen from two sides.
 *
 * The [[Prototype]] chain answers it and cannot be spelled by accident:
 * %Error.prototype% is a process SINGLETON compared by IDENTITY, so a
 * hand-built `{ name: "Error" }` never reaches it however it is spelled.
 * The walk starts at the PROTOTYPE, so %Error.prototype% itself answers
 * false — Node's answer, since it is an ordinary object. */
bool scr_dyn_is_error_encoding(const ScrDyn *d) {
  return d != NULL && d->kind == SCR_DYN_OBJ &&
         scr_dyn_error_proto_in_chain(scr_dyn_ext(d)->proto);
}

/* `v instanceof Error` over a checked-dynamic value — the ONE predicate
 * both backends call, so the C and LLVM lanes cannot answer differently
 * (the split estado-protochain.md §2e found the hard way).
 *
 * Two ways to be an Error here:
 *   - the encoding above, which is %Error.prototype% on the [[Prototype]]
 *     chain — the same thing a custom error type built by
 *     `Object.create(Error.prototype, …)` is, so scr_dyn_from_error's
 *     product and a user's custom error answer through ONE test;
 *   - the engine's own answer for an island-held value. */
bool scr_dyn_instanceof_error(const ScrDyn *d) {
  if (scr_dyn_is_error_encoding(d)) return true;
  return scr_dyn_isl_is_error(d);
}

/* The `Error.prototype.constructor` fence. Node's answers the `Error`
 * CONSTRUCTOR; this tier has no such value at all — `Error` in a value
 * position is itself the SC2020 lib fence, and `new Error(...)` compiles
 * to a static runtime error rather than a call through a function
 * object. So the back-link has nothing to point at, and answering
 * `undefined` would be the silent kind of wrong. Loud instead, like the
 * function-prototype fence beside it. */
void scr_dyn_error_ctor_fence(void) {
  static const char msg[] =
      "reading 'constructor' through Error.prototype is not supported yet"
      " (the Error CONSTRUCTOR is not a value in a static build — `new Error(...)` compiles"
      " to a runtime error object, not a call through a function object — so the back-link"
      " has nothing to point at; define it yourself, Object.create(Error.prototype,"
      " { constructor: { value: MyError } }), and the read answers exactly)";
  scr_throw_error_msg(SCR_ERR_ERROR, msg, sizeof msg - 1);
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
/* caps[0] = the SOURCE object the record was materialized from.  Its
 * ToString is scr_dyn_to_string's OBJ arm exactly -- the own-or-inherited
 * `toString` protocol (Error.prototype's included, reached through the
 * encoding's chain), the constant -- so the record
 * answers what the object it was copied from answers.
 *
 * The copy is what makes this necessary and also what bounds it: a record
 * field written AFTER the materialization is not visible to the source
 * object's toString, because there are two objects where JS has one.  That
 * divergence is the materialization's, not this slot's, and it predates
 * it; before the slot the answer was "[object Object]" whether or not
 * anything had been written. */
static ScrStr *scr_rec_tostr_dyn_fn(ScrClosure *clo) {
  ScrDyn *d = scr_box_get_ref(clo->caps[0]); /* +1 */
  ScrStr *s = scr_dyn_to_string(d, NULL);
  scr_dyn_release(d);
  return s;
}

ScrClosure *scr_dyn_tostr_closure(const ScrDyn *d) {
  if (d == NULL || d->kind != SCR_DYN_OBJ) return NULL;
  /* An own-or-inherited valueOf means the DEFAULT hint (`r + ""`) and the
   * STRING hint (String(r)) disagree, and one slot cannot answer both --
   * see the header.  Decline rather than answer one spelling wrong. */
  if (scr_dyn_obj_own_data(d, "valueOf", 7) != NULL) return NULL;
  if (scr_dyn_proto_get(d, "valueOf", 7) != NULL) return NULL;
  ScrDyn *m = scr_dyn_obj_own_data(d, "toString", 8);
  if (m == NULL) m = scr_dyn_proto_get(d, "toString", 8);
  if (m == NULL || m->kind != SCR_DYN_FUNC) return NULL;
  ScrClosure *clo = scr_closure_new((void *)scr_rec_tostr_dyn_fn, 1);
  /* A TRACED capture.  The box holds a dyn, dyn values are collector nodes
   * with headers of their own, and the object can reach the record holding
   * this closure (its members are arbitrary) -- an untraced edge here is
   * exactly the ring trial deletion calls externally referenced, which is
   * how the dyn func adapter leaked before it took the same three-argument
   * box. */
  clo->caps[0] = scr_box_new_obj(scr_dyn_retain_v, scr_dyn_release_v, scr_dyn_trace_v);
  scr_box_set_ref(clo->caps[0], scr_dyn_retain((ScrDyn *)d));
  return clo;
}

ScrStr *scr_rec_tostr(ScrClosure *slot) {
  /* NULL = nothing carried a toString into this record, which is exactly
   * when Object.prototype.toString's constant IS Node's answer. */
  if (slot == NULL) return scr_str_new("[object Object]", 15);
  ScrStr *s = ((ScrStr * (*)(ScrClosure *))slot->fn)(slot);
  /* The call is user code; a throw leaves the exception pending and the
   * emitted call site checks it.  Never hand back NULL -- every caller of
   * a ToString treats the result as an owned string. */
  return s != NULL ? s : scr_str_new("", 0);
}

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
    ScrDyn *m = scr_dyn_obj_own_data(d, "toString", 8);
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
    /* No callable toString and no error encoding: "[object Object]".
     *
     * The special case that used to stand here — a reserved "%error"
     * marker whose presence meant "render name: message" — is GONE, and
     * the reason is that the protocol above now finds Error.prototype's
     * OWN toString through the encoding's [[Prototype]] link, which is
     * how JS reaches it too. A hand-built object carrying a "%error" key
     * therefore renders "[object Object]" again, which is Node's answer;
     * it used to render "Error: <its own name field>". */
    return scr_str_new("[object Object]", 15);
  }
  case SCR_DYN_HANDLE:
    /* IncomingMessage/ServerResponse/Socket inherit
     * Object.prototype.toString — Node's String() answer exactly.
     *
     * RegExp does NOT: it owns RegExp.prototype.toString, whose answer is
     * `/source/flags`. Admitting the kind into the tree without saying so
     * here would make `String(u)` answer "[object Object]" for a value
     * whose static twin answers "/x/" — the same value, two answers,
     * decided by whether it crossed the boundary. Only the tag that
     * differs asks its ops: routing the whole set through invoke would
     * change the I/O tags, whose invoke has no toString arm to answer
     * with, into a "not a function" throw. */
    if (d->v.handle.tag == SCR_DYNH_REGEX) {
      const ScrDynHandleOps *ops = scr_dyn_handle_ops_of(d);
      ScrDyn *r = ops->invoke(d->v.handle.ptr, (ScrDyn *)d, "toString", NULL, 0, "toString");
      if (r == NULL) return scr_str_new("", 0); /* threw — pending */
      ScrStr *s = r->kind == SCR_DYN_STR ? scr_str_retain(r->v.str) : scr_str_new("", 0);
      scr_dyn_release(r);
      return s;
    }
    return scr_str_new("[object Object]", 15);
  case SCR_DYN_OBJINST:
    /* NOT "[object Object]". A class instance may override toString, and
     * its static twin calls the override — answering the default here
     * would make one value render two ways depending on whether it
     * crossed the boundary, which is the wrong-answer shape this tree
     * refuses. The box carries no member table to dispatch the override
     * through, so the honest answer is the loud ladder. */
    scr_dyn_objinst_fence(d, "String()");
    return scr_str_new("", 0); /* the pending throw wins */
  case SCR_DYN_BIG:
    /* The DIGITS, with no suffix: String(5n) is "5" and only
     * util.inspect prints 5n. A bigint has a real BigInt.prototype
     * .toString, so unlike the OBJINST arm above this is an ANSWER
     * rather than a fence standing in for one. */
    return scr_dyn_big_ops()->to_str(d->v.big, 10);
  case SCR_DYN_ARRBUF:
    /* Object.prototype.toString with the ArrayBuffer @@toStringTag —
     * measured, not assumed: ArrayBuffer has no own toString, so
     * String(buf) really is "[object ArrayBuffer]" and NOT the element
     * join a typed array gives. */
    return scr_str_new("[object ArrayBuffer]", 20);
  case SCR_DYN_MAP:
    /* Object.prototype.toString with the Map / Set @@toStringTag —
     * measured against v25.9.0: neither has an own toString, so
     * String(new Map()) is "[object Map]" and String(new Set()) is
     * "[object Set]". An ANSWER, like the ArrayBuffer arm above and
     * unlike the OBJINST arm, because the shape is known and constant. */
    return d->v.map.tkey[0] == 's' ? scr_str_new("[object Set]", 12)
                                   : scr_str_new("[object Map]", 12);
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
      /* An element's own toString threw: JS's join stops there, so the
       * REMAINING elements' toStrings — user code with side effects Node
       * never runs — must not run either. The caller's pending check
       * turns the dummy below into the real unwind. */
      if (scr_exc_pending()) return out;
    }
    return out;
  }
  case SCR_DYN_FUNC:
    /* Function.prototype.toString, through the ONE renderer — this arm
     * used to print a nameless native stub while the emitted display
     * walker printed a NAMED one, so a single value answered two ways
     * depending on which spelling reached it. */
    return scr_fn_to_string(d);
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

/* The RANGE spelling `d.toString(enc, start[, end])` — Buffer's
 * decode-a-window form, and the one protobufjs's BufferReader reads every
 * string field through (`this.buf.utf8Slice ? … : this.buf.toString(
 * "utf-8", start, end)`).
 *
 * The extra arguments belong to exactly ONE receiver kind. Measured
 * against Node v25.9.0 rather than assumed:
 *
 *   Buffer            decodes the clamped [start, end) window;
 *   plain Uint8Array  toString is ARRAY's — the element join, arguments
 *                     ignored ((new Uint8Array([104,105])).toString(
 *                     "utf8", 0, 1) is "104,105", not "h");
 *   string/boolean/   the arguments are ignored ("abc".toString("utf8",
 *   array/object/…    1, 2) is "abc", [1,2,3].toString(…) is "1,2,3");
 *   NUMBER            argument 0 is a RADIX, not an encoding. Every
 *                     spelling that reaches here is one of the nine
 *                     literal Buffer encodings (the frontend's
 *                     bufEncoding fences the rest), and ToIntegerOrInfinity
 *                     of any of them is 0 — so a number receiver in this
 *                     form is always V8's RangeError, never a digit
 *                     string.
 *
 * start/end stay DYN and take ToIntegerOrInfinity here (JS coerces them;
 * a static f64 conversion would throw where Node converts). */
ScrStr *scr_dyn_to_string_range(const ScrDyn *d, const ScrStr *enc, ScrDyn *start,
                                ScrDyn *end, const ScrStr *what) {
  if (d->kind == SCR_DYN_BYTES && d->buffer) {
    ScrDyn *a[2] = { start, end };
    double s = scr_dyn_index_arg(a, 2, 0, 0, "toString");
    if (scr_exc_pending()) return scr_str_new("", 0);
    double e = scr_dyn_index_arg(a, 2, 1, (double)d->v.bytes->len, "toString");
    if (scr_exc_pending()) return scr_str_new("", 0);
    return scr_bytes_to_str_range(d->v.bytes, enc, s, e);
  }
  if (d->kind == SCR_DYN_NUM) {
    static const char msg[] = "toString() radix argument must be between 2 and 36";
    scr_throw_error_msg(SCR_ERR_RANGE, msg, sizeof msg - 1);
    return scr_str_new("", 0);
  }
  /* Every remaining kind ignores the extra arguments — and ignores the
   * ENCODING with them, which is why NULL goes down rather than `enc`:
   * [buf].toString("hex", 0, 1) is the array join of String(buf), not a
   * hex render of the element. */
  return scr_dyn_to_string_method(d, NULL, what);
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
      ScrDyn *m = scr_dyn_obj_own_data(d, hint[i], strlen(hint[i])); /* borrowed */
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
          r->kind == SCR_DYN_ARRBUF || r->kind == SCR_DYN_MAP ||
          r->kind == SCR_DYN_OBJINST || r->kind == SCR_DYN_PROMISE) {
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

/* ToPrimitive with the DEFAULT hint, then ToString — which is what `+`
 * does to an untyped operand when the other side is a string, and it is
 * the OPPOSITE ORDER from String(v).
 *
 * OrdinaryToPrimitive runs "valueOf" then "toString" for hints `number`
 * and `default`, and "toString" then "valueOf" for hint `string`; `+`
 * (ApplyStringOrNumericBinaryOperator) passes no hint, which IS default.
 * So one object answers two different strings depending on which
 * conversion reached it, and that is not a bug to be smoothed over — it
 * is the language. Measured, Node v25.9.0:
 *
 *   var o = {valueOf(){return 42}, toString(){return "TS"}};
 *   "" + o    ->  "42"        String(o)  ->  "TS"      `${o}` -> "TS"
 *
 * A template literal is ToString, hint string — the same order as
 * String(v) — so only `+` takes this entry point.
 *
 * Only a USER valueOf is modelled, and that is not an approximation: JS's
 * Object.prototype.valueOf answers the OBJECT, which is not a primitive,
 * so ToPrimitive falls through it every time. Its absence here means the
 * same thing. The toString half is then exactly scr_dyn_to_string's OBJ
 * arm — the user toString, Error.prototype's encoded form, and the
 * "[object Object]" constant, in that order — so this DELEGATES rather
 * than growing another copy of the ToString table. Measured: `"" + {a:1}`
 * is "[object Object]" and `"" + caughtError` is "TypeError: kaboom",
 * both of which an "exhausted the protocol" TypeError would have broken.
 *
 * Borrows; +1, or NULL with the exception pending (a method's throw
 * propagates, and a null-prototype object — which really does have no
 * toString to fall back to — raises the spec's TypeError). */
/* ToPrimitive (ECMA-262 7.1.1) over a dyn value, returning a PRIMITIVE
 * dyn rather than a string. This is the conversion every one of the JS
 * operators below performs on an untyped operand BEFORE it decides what
 * kind of operation it is, and the reason it cannot be spelled as
 * scr_dyn_to_primitive_string is that the primitive's own KIND is
 * load-bearing: `0 == {valueOf(){return false}}` is TRUE in JS, because
 * ToPrimitive answers the BOOLEAN false and ToNumber(false) is 0, while
 * String(false) is "false", whose ToNumber is NaN. Stringifying first
 * answers the wrong boolean.
 *
 * OrdinaryToPrimitive runs "valueOf" then "toString" for hints `number`
 * and `default`, and "toString" then "valueOf" for hint `string`. Only a
 * USER method participates: JS's Object.prototype.valueOf answers the
 * OBJECT, which is not a primitive, so ToPrimitive falls through it every
 * time, and its absence from the member table means the same thing. That
 * fall-through is not a corner - protobufjs's `Long` (the live consumer
 * in zapo's bundle) defines toString and NO valueOf, so `long == 0` is
 * decided entirely by the second method. A valueOf-only implementation
 * would refuse it.
 *
 * The toString HALF, when no user method answered, is the built-in table
 * scr_dyn_to_string already owns (Array#toString's comma join,
 * Error.prototype's encoded form, the "[object Object]" constant), so
 * this DELEGATES instead of growing a third copy. The one arm where JS
 * really throws is a null-prototype object, which inherits neither
 * method: measured on Node v25.9.0, `0 == Object.create(null)` is a
 * TypeError, not false.
 *
 * Symbol.toPrimitive is not consulted: the dyn model has no symbol kind,
 * so no dyn value can carry one.
 *
 * hint: SCR_TOPRIM_DEFAULT / _NUMBER / _STRING. A primitive (and a
 * bigint, whose ToPrimitive is the identity) answers itself. Borrows;
 * +1, or NULL with the exception pending. */
static ScrDyn *scr_toprim_try(const ScrDyn *d, const char *name, size_t len) {
  ScrDyn *m = scr_dyn_obj_own_data(d, name, len); /* borrowed */
  if (!m) m = scr_dyn_proto_get(d, name, len);
  if (m == NULL || m->kind != SCR_DYN_FUNC) return NULL;
  /* JS calls it with the OBJECT as the receiver. */
  scr_dyn_this_push_dyn(d);
  ScrDyn *r = scr_dyn_call(m, NULL, 0, name);
  scr_dyn_this_pop();
  if (!r) return NULL; /* threw - pending, and the caller must not continue */
  if (scr_dyn_is_prim(r) || r->kind == SCR_DYN_BIG) return r; /* +1 */
  scr_dyn_release(r); /* non-primitive answer: try the next method */
  return NULL;
}

ScrDyn *scr_dyn_to_primitive(const ScrDyn *d, int hint) {
  if (d == NULL) {
    scr_dyn_check_fail(NULL, "a primitive value", d);
    return NULL;
  }
  if (scr_dyn_is_prim(d) || d->kind == SCR_DYN_BIG) return scr_dyn_retain((ScrDyn *)d);
  /* Only SCR_DYN_OBJ carries a member table a user valueOf/toString can
   * live in; every other reference kind takes the built-in table below. */
  if (d->kind == SCR_DYN_OBJ) {
    ScrDyn *r;
    if (hint == SCR_TOPRIM_STRING) {
      r = scr_toprim_try(d, "toString", 8);
      if (r) return r;
      if (scr_exc_pending()) return NULL;
      r = scr_toprim_try(d, "valueOf", 7);
      if (r) return r;
      if (scr_exc_pending()) return NULL;
    } else {
      r = scr_toprim_try(d, "valueOf", 7);
      if (r) return r;
      if (scr_exc_pending()) return NULL;
      r = scr_toprim_try(d, "toString", 8);
      if (r) return r;
      if (scr_exc_pending()) return NULL;
    }
    if (d->null_proto && scr_dyn_obj_get(d, "toString", 8) == NULL) {
      /* Object.create(null) inherits neither method, so the protocol
       * really is exhausted - this is the one arm where JS throws. */
      static const char msg[] = "Cannot convert object to primitive value";
      scr_throw_error_msg(SCR_ERR_TYPE, msg, sizeof msg - 1);
      return NULL;
    }
  }
  /* A compiled class instance has no member table to dispatch a user
   * valueOf/toString through, so the built-in table below cannot answer for
   * it and its arm there is a fence -- a fence whose wording names String().
   * That wording is wrong HERE: every caller of this function is an operator
   * that wanted a PRIMITIVE (`+`, `<`, ToNumber, `==`), and none of them
   * asked for a string. Refuse in this function's own terms instead, which
   * also gets the error CLASS right: JS's own failure to convert an object
   * to a primitive is a TypeError, and scr_dyn_check_fail throws one.
   * Refusal before, refusal after -- only the message changes. */
  if (d->kind == SCR_DYN_OBJINST) {
    scr_dyn_check_fail(NULL, "a primitive value", d);
    return NULL;
  }
  {
    ScrStr *s = scr_dyn_to_string(d, NULL);
    if (!s) return NULL; /* pending (an OBJINST fence, a throwing member) */
    ScrDyn *out = scr_dyn_new_str(s); /* retains s into the node */
    scr_str_release(s);
    return out;
  }
}

/* IsLooselyEqual (ECMA-262 7.2.14) with a NUMBER on one side and an
 * untyped value on the other - the operand pair `n == v` lowers to, and
 * the one the census's two SC1040 traps are.
 *
 * The spec compares TYPES before it converts, and that ordering is the
 * whole content of this function:
 *
 *   null / undefined   FALSE, and it must be answered BEFORE any
 *                      conversion: Number(null) is 0, but `0 == null` is
 *                      false. Measured on Node v25.9.0.
 *   an object          ToPrimitive with NO hint (which is `default`),
 *                      then the comparison runs again on the result -
 *                      including the null/undefined answer above, since
 *                      `0 == {valueOf(){return null}}` is false too.
 *   anything else      ToNumber, and NaN makes every comparison false.
 *
 * Borrowed; never allocates for the number side. Answers false with the
 * exception pending when a user method throws or the operand is a kind
 * ToNumber refuses (a bigint keeps the documented refusal). */
bool scr_dyn_loose_eq_num(double n, const ScrDyn *d) {
  if (d == NULL) return false;
  if (d->kind == SCR_DYN_NULL || d->kind == SCR_DYN_UNDEF) return false;
  ScrDyn *p = scr_dyn_to_primitive(d, SCR_TOPRIM_DEFAULT);
  if (!p) return false; /* pending */
  bool eq = false;
  if (p->kind != SCR_DYN_NULL && p->kind != SCR_DYN_UNDEF) {
    double m = scr_dyn_to_number(p);
    eq = !scr_exc_pending() && n == m; /* NaN compares false, as JS does */
  }
  scr_dyn_release(p);
  return eq;
}

ScrStr *scr_dyn_to_primitive_string(const ScrDyn *d) {
  if (d->kind != SCR_DYN_OBJ) return scr_dyn_string_coerce(d);
  ScrDyn *m = scr_dyn_obj_own_data(d, "valueOf", 7); /* borrowed */
  if (!m) m = scr_dyn_proto_get(d, "valueOf", 7);
  if (m != NULL && m->kind == SCR_DYN_FUNC) {
    /* JS calls it with the OBJECT as the receiver. */
    scr_dyn_this_push_dyn(d);
    ScrDyn *r = scr_dyn_call(m, NULL, 0, "valueOf");
    scr_dyn_this_pop();
    if (!r) return NULL; /* threw — pending */
    if (r->kind != SCR_DYN_OBJ && r->kind != SCR_DYN_ARR && r->kind != SCR_DYN_FUNC &&
        r->kind != SCR_DYN_HANDLE && r->kind != SCR_DYN_OBJINST &&
        r->kind != SCR_DYN_ARRBUF && r->kind != SCR_DYN_MAP &&
        r->kind != SCR_DYN_PROMISE) {
      ScrStr *s = scr_dyn_string_coerce(r);
      scr_dyn_release(r);
      return s;
    }
    scr_dyn_release(r); /* non-primitive answer: OrdinaryToPrimitive tries toString */
  }
  if (d->null_proto && scr_dyn_obj_get(d, "toString", 8) == NULL) {
    /* Object.create(null) inherits neither method, so the protocol
     * really is exhausted — this is the one arm where JS throws. */
    static const char msg[] = "Cannot convert object to primitive value";
    scr_throw_error_msg(SCR_ERR_TYPE, msg, sizeof msg - 1);
    return NULL;
  }
  return scr_dyn_to_string(d, NULL);
}

/* ── NON-ENUMERABLE OWN PROPERTIES ─────────────────────────────────────
 *
 * `Object.defineProperty(o, k, { get, set })` and its DATA twin
 * `Object.defineProperty(o, k, { value })` — which means non-enumerable
 * too, because defineProperty defaults every flag to FALSE. Both live in
 * the OBJ node's SEPARATE `hidden` table (scr_runtime.h says why), which
 * is what keeps them off Object.keys / JSON / assign / structuredClone /
 * deepStrictEqual by construction: every one of those reads `entries`,
 * and a hidden property is never in `entries`.
 *
 * One table, one walk, two families, told apart by the entry's first
 * element:
 *
 *     [false, getter, setter,   configurable]
 *     [true,  value,  writable, configurable]
 *
 * Only four operations consult it, and they are exactly JS's four:
 * [[Get]], [[Set]], [[Delete]] and `in` (plus Object.hasOwn, which is
 * own-presence and therefore the same question `in` asks minus the
 * chain). The getter runs with `this` bound to the RECEIVER the read
 * started from, not to the object the accessor was found on — which is
 * the whole reason the idiom works: pbjs defines the `_field` oneof
 * accessor ONCE on `Message.prototype`, and each instance's read has to
 * run it against its own members. */

typedef enum {
  SCR_PROP_ABSENT,
  SCR_PROP_DATA,        /* an own ENUMERABLE member, in `entries` */
  SCR_PROP_ACCESSOR,    /* a hidden [false, get, set, cfg] entry */
  SCR_PROP_HIDDEN_DATA, /* a hidden [true, value, writable, cfg] entry */
} ScrPropKind;

/* The four accessors over a hidden entry. `configurable` is the last
 * element in BOTH families, so the delete/redefine gate can ask without
 * knowing which one it holds. */
static bool scr_hid_is_data(const ScrDyn *q) { return scr_dyn_truthy(q->v.arr.items[0]); }
static ScrDyn *scr_hid_getter(const ScrDyn *q) { return q->v.arr.items[1]; }
static ScrDyn *scr_hid_setter(const ScrDyn *q) { return q->v.arr.items[2]; }
static ScrDyn *scr_hid_value(const ScrDyn *q) { return q->v.arr.items[1]; }
static bool scr_hid_writable(const ScrDyn *q) { return scr_dyn_truthy(q->v.arr.items[2]); }
static bool scr_hid_configurable(const ScrDyn *q) { return scr_dyn_truthy(q->v.arr.items[3]); }
/* The FIFTH element, and the one this table could not hold. It is read
 * defensively rather than by index alone because the class instance's
 * run-time property table (scr_cls_props_*) shares these readers and
 * already carries five, and because a four-element entry written before
 * this element existed means exactly what a `false` here means. */
static bool scr_hid_enumerable(const ScrDyn *q) {
  return q->v.arr.len >= 5 && scr_dyn_truthy(q->v.arr.items[4]);
}

/* Is this key's member-table entry an accessor SLOT rather than a value?
 * Pointer identity against the one immortal node, and nothing else — no
 * kind test, no sentinel value a program could forge. */
bool scr_dyn_obj_entry_is_slot(const ScrDyn *d, const char *key, size_t key_len) {
  if (d == NULL || d->kind != SCR_DYN_OBJ) return false;
  for (size_t i = 0; i < d->v.obj.len; i++) {
    const ScrDynEntry *e = &d->v.obj.entries[i];
    if (e->key_len == key_len && memcmp(e->key, key, key_len) == 0) {
      return e->value == scr_dyn_acc_slot();
    }
  }
  return false;
}

/* Does this object carry an own property that is BOTH an accessor and
 * currently ENUMERABLE? The question every entries-walking surface has
 * to be able to ask, and the reason it is cheap: an object with no
 * hidden table at all — which is nearly every object in a program —
 * answers on one NULL test and never touches the member table. */
bool scr_dyn_obj_has_enum_acc(const ScrDyn *d) {
  if (d == NULL || d->kind != SCR_DYN_OBJ || scr_dyn_ext(d)->hidden == NULL) return false;
  const ScrDyn *h = scr_dyn_ext(d)->hidden;
  for (size_t i = 0; i < h->v.obj.len; i++) {
    const ScrDyn *ent = h->v.obj.entries[i].value;
    if (ent->kind == SCR_DYN_ARR && !scr_hid_is_data(ent) && scr_hid_enumerable(ent)) return true;
  }
  return false;
}

/* The fence for an entries-walking surface that has NOT been taught the
 * slot. Reading a slot as a value answers `undefined` — a key silently
 * missing from a JSON document, a header quietly unset, a marshalled
 * value short by a field — and this project ranks a silent wrong answer
 * below a refusal every time. `surface` is the JS spelling the message
 * names, so the refusal says which call to change. */
void scr_dyn_obj_acc_fence(const ScrDyn *d, const char *surface) {
  if (!scr_dyn_obj_has_enum_acc(d)) return;
  ScrJsonBuf b;
  scr_jb_init(&b);
  scr_jb_puts(&b, surface);
  scr_jb_puts(&b, " over a dynamic object carrying an ENUMERABLE ACCESSOR property is not"
                  " supported yet (");
  size_t shown = 0;
  const ScrDyn *h = scr_dyn_ext(d)->hidden;
  for (size_t i = 0; i < h->v.obj.len; i++) {
    const ScrDyn *ent = h->v.obj.entries[i].value;
    if (ent->kind != SCR_DYN_ARR || scr_hid_is_data(ent) || !scr_hid_enumerable(ent)) continue;
    if (shown++ > 0) scr_jb_puts(&b, ", ");
    scr_jb_putc(&b, '\'');
    scr_jb_write(&b, h->v.obj.entries[i].key, h->v.obj.entries[i].key_len);
    scr_jb_putc(&b, '\'');
  }
  scr_jb_puts(&b, " — this walk reads the member table directly, where such a property"
                  " keeps only its POSITION, so the value it would carry across is the"
                  " getter's, uncalled. Object.keys, Object.values, Object.entries,"
                  " JSON.stringify, Object.assign, structuredClone, util.inspect and"
                  " assert.deepStrictEqual all call the getter and are exact)");
  scr_throw_error(SCR_ERR_ERROR, scr_jb_finish(&b));
}

/* ONE own entry, resolved for an ENUMERATION surface. Three outcomes,
 * and a caller that collapses two of them is a wrong answer waiting:
 *
 *   +1 value, *skip = false     an ordinary member (retained), or an
 *                               enumerable accessor whose getter has
 *                               just RUN — with `this` bound to `recv`,
 *                               once per read and never cached, which is
 *                               what JS promises and what a snapshot
 *                               would break
 *   NULL, *skip = true          a TOMBSTONE: the entry holds a position
 *                               for a property that is not currently
 *                               enumerable, so it is not an own
 *                               enumerable key and the surface steps
 *                               over it
 *   NULL, *skip = false         the getter threw; the exception is
 *                               pending and the surface unwinds
 *
 * `e` must be an entry of `recv`. Borrowed in, +1 out. */
ScrDyn *scr_dyn_obj_entry_read(ScrDyn *recv, const ScrDynEntry *e, bool *skip) {
  *skip = false;
  if (e->value != scr_dyn_acc_slot()) return scr_dyn_retain(e->value);
  ScrDyn *ent = scr_dyn_ext(recv)->hidden != NULL
                    ? scr_dyn_obj_get(scr_dyn_ext(recv)->hidden, e->key, e->key_len)
                    : NULL;
  if (ent == NULL || ent->kind != SCR_DYN_ARR || !scr_hid_enumerable(ent)) {
    /* A tombstone, or — the case that cannot happen but must not answer
     * `undefined` if it does — a slot whose descriptor is gone. */
    *skip = true;
    return NULL;
  }
  ScrDyn *getter = scr_hid_getter(ent);
  /* A set-only accessor READS as undefined in JS. It is still an own
   * enumerable key, so it is NOT skipped: Object.keys lists it and
   * JSON.stringify drops it for being undefined, both of which Node
   * does. */
  if (getter->kind != SCR_DYN_FUNC) return scr_dyn_retain(scr_dyn_undefined());
  scr_dyn_this_push_dyn(recv);
  ScrDyn *r = scr_dyn_call(getter, NULL, 0, "getter");
  scr_dyn_this_pop();
  return r; /* +1, or NULL with the getter's own exception pending */
}

/* The same question WITHOUT running anything: is this entry an own
 * enumerable KEY? Object.keys and `for…in` ask only this — Node lists
 * an accessor's name without calling its getter, and calling one here
 * would be an observable side effect JS does not have. */
bool scr_dyn_obj_entry_listed(const ScrDyn *recv, const ScrDynEntry *e) {
  if (e->value != scr_dyn_acc_slot()) return true;
  if (scr_dyn_ext(recv)->hidden == NULL) return false;
  const ScrDyn *ent = scr_dyn_obj_get(scr_dyn_ext(recv)->hidden, e->key, e->key_len);
  return ent != NULL && ent->kind == SCR_DYN_ARR && scr_hid_enumerable(ent);
}

/* How many own ENUMERABLE string keys the object has — `entries` length
 * MINUS its tombstones. Anything that compares two objects by key count
 * has to ask this rather than read `len`, or an object that once had an
 * enumerable getter compares unequal to one that never did. Costs a scan
 * only for an object that has a hidden table at all. */
size_t scr_dyn_obj_enum_key_count(const ScrDyn *d) {
  if (d == NULL || d->kind != SCR_DYN_OBJ) return 0;
  if (scr_dyn_ext(d)->hidden == NULL) return d->v.obj.len; /* no slots are possible */
  size_t n = 0;
  for (size_t i = 0; i < d->v.obj.len; i++) {
    if (scr_dyn_obj_entry_listed(d, &d->v.obj.entries[i])) n++;
  }
  return n;
}

/* The own ENUMERABLE property named `key`, READ — the getter runs for an
 * accessor. NULL when there is no such own enumerable property (a
 * tombstone, a non-enumerable one, or nothing), and NULL with a pending
 * exception when the getter threw; a caller that has to tell those apart
 * asks scr_exc_pending. +1 on success. Deliberately own-only and
 * enumerable-only: it is the other half of an own-key WALK, not a
 * [[Get]] (scr_dyn_obj_key_get is that, and it walks the chain). */
ScrDyn *scr_dyn_obj_own_enum_read(ScrDyn *recv, const char *key, size_t key_len) {
  if (recv == NULL || recv->kind != SCR_DYN_OBJ) return NULL;
  for (size_t i = 0; i < recv->v.obj.len; i++) {
    const ScrDynEntry *e = &recv->v.obj.entries[i];
    if (e->key_len != key_len || memcmp(e->key, key, key_len) != 0) continue;
    bool skip = false;
    ScrDyn *v = scr_dyn_obj_entry_read(recv, e, &skip);
    return v; /* NULL for a tombstone, or with the getter's throw pending */
  }
  return NULL;
}

/* One property lookup over the receiver and its [[Prototype]] chain,
 * shared by [[Get]], [[Set]], [[Delete]] and `in` so they can never
 * disagree about where a property lives. At any ONE level a key is in
 * `entries` or in `hidden` and never both — every definer drops the
 * entry of the other kind it replaces, and scr_dyn_key_set updates a
 * hidden data slot in place instead of writing a shadowing member — so
 * the per-level order below is a fast path, not a tie-break.
 *
 * `*out` is BORROWED: the enumerable member, or the hidden entry's
 * four-element ARR. `*holder`, when asked for, is the object the
 * property was found ON — [[Set]] needs it, because JS treats an
 * INHERITED writable data property differently from an own one (the
 * write creates a fresh ordinary own property instead of updating). */
static ScrPropKind scr_dyn_obj_resolve(const ScrDyn *d, const char *key, size_t key_len,
                                       ScrDyn **out, const ScrDyn **holder) {
  const ScrDyn *o = d;
  for (size_t steps = 0; o != NULL && steps <= SCR_PROTO_MAX_DEPTH; steps++) {
    if (o->kind != SCR_DYN_OBJ) break;
    ScrDyn *m = scr_dyn_obj_get(o, key, key_len);
    if (m != NULL) {
      *out = m;
      if (holder != NULL) *holder = o;
      return SCR_PROP_DATA;
    }
    if (scr_dyn_ext(o)->hidden != NULL) {
      ScrDyn *ent = scr_dyn_obj_get(scr_dyn_ext(o)->hidden, key, key_len);
      if (ent != NULL) {
        *out = ent;
        if (holder != NULL) *holder = o;
        return scr_hid_is_data(ent) ? SCR_PROP_HIDDEN_DATA : SCR_PROP_ACCESSOR;
      }
    }
    o = scr_dyn_ext(o)->proto;
  }
  *out = NULL;
  if (holder != NULL) *holder = NULL;
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
  ScrPropKind k = scr_dyn_obj_resolve(recv, key, key_len, &found, NULL);
  if (k == SCR_PROP_DATA) return scr_dyn_retain(found);
  /* A non-enumerable DATA property reads exactly like an enumerable one
   * — `enumerable` is about ENUMERATION, never about [[Get]]. */
  if (k == SCR_PROP_HIDDEN_DATA) return scr_dyn_retain(scr_hid_value(found));
  if (k == SCR_PROP_ACCESSOR) {
    /* A set-only accessor READS as undefined in JS — absence of a getter
     * is not an error, and answering one here would be a wrong throw. */
    ScrDyn *getter = scr_hid_getter(found);
    if (getter->kind != SCR_DYN_FUNC) return scr_dyn_retain(scr_dyn_undefined());
    scr_dyn_this_push_dyn(recv);
    ScrDyn *r = scr_dyn_call(getter, NULL, 0, "getter");
    scr_dyn_this_pop();
    return r; /* +1, or NULL with the getter's own exception pending */
  }
  if (key_len == 11 && memcmp(key, "constructor", 11) == 0) {
    /* %Error.prototype% first: it is REACHED from the receiver (or IS
     * it), and its reason is its own — there is no `Error` function
     * value in a static build for the back-link to name, where the
     * function-prototype case has one and refuses the cycle. Both are
     * loud; neither is a silent undefined. */
    if (scr_dyn_error_proto_in_chain(recv)) {
      scr_dyn_error_ctor_fence();
      return NULL;
    }
    /* The one member Node's implicit prototype has and this one does not
     * STORE (the stored back-link would be an uncollectable cycle): the
     * registry answers it from a borrowed closure pointer instead, and
     * mints the box on the spot. */
    ScrDyn *ctor = scr_dyn_proto_chain_ctor(recv);
    if (ctor != NULL) return ctor;
    /* Reached only when the minting closure is already gone: loud, never
     * a silent undefined. */
    if (scr_dyn_proto_chain_is_fn_pub(recv)) {
      scr_dyn_proto_ctor_fence();
      return NULL;
    }
  }
  return scr_dyn_retain(scr_dyn_undefined());
}

/* The ACCESSOR half of JS's [[Get]] on an OBJ receiver, and only that
 * half.  scr_dyn_obj_data_get answers own/inherited DATA and stops there
 * on purpose (it is borrow-only, and a getter needs +1 and an exception
 * path); this is the other half, so the dynCheck record BUILDER -- which
 * does hold both -- can ask for it on the MISS path and stop refusing a
 * field JavaScript answers.  A required field provided by a getter read
 * as absent and threw `expected string at $.a, got undefined` where Node
 * answers the getter's value; an OPTIONAL one built the undefined arm,
 * silently.
 *
 * +1 on success; NULL and NOTHING pending when the chain holds no
 * accessor for the key (a genuine absence, which is what the caller then
 * reports); NULL with the getter's exception pending when it threw.
 * Deliberately NOT the whole [[Get]]: the DATA half already ran, and
 * asking for it again would double an observable read. */
ScrDyn *scr_dyn_obj_accessor_get(const ScrDyn *d, const char *key, size_t key_len) {
  if (d == NULL || d->kind != SCR_DYN_OBJ) return NULL;
  ScrDyn *found = NULL;
  if (scr_dyn_obj_resolve(d, key, key_len, &found, NULL) != SCR_PROP_ACCESSOR) return NULL;
  /* A set-only accessor READS as undefined in JS -- the absence of a
   * getter is not an error, and it is not an absence of the property. */
  ScrDyn *getter = scr_hid_getter(found);
  if (getter->kind != SCR_DYN_FUNC) return scr_dyn_retain(scr_dyn_undefined());
  scr_dyn_this_push_dyn(d);
  ScrDyn *r = scr_dyn_call(getter, NULL, 0, "getter");
  scr_dyn_this_pop();
  return r; /* +1, or NULL with the getter's own exception pending */
}

/* `key in obj` over an OBJ receiver: own member, own hidden property,
 * then the chain — a non-enumerable property IS a property, so `in` sees
 * it even though Object.keys does not. Never throws (no getter runs). */
bool scr_dyn_obj_key_present(const ScrDyn *d, const char *key, size_t key_len) {
  ScrDyn *found = NULL;
  if (scr_dyn_obj_resolve(d, key, key_len, &found, NULL) != SCR_PROP_ABSENT) return true;
  /* %Error.prototype% HAS a `constructor` in Node, and the fact that
   * this tier cannot produce its VALUE (scr_dyn_error_ctor_fence) is no
   * reason to claim the property does not exist: `in` asks about
   * existence, and answering false would be a silent wrong answer where
   * the read is a loud refusal. A function's minted prototype has one
   * too — computed rather than stored, but `in` asks about existence and
   * the read now answers. Own-or-inherited, like the rest of the walk. */
  if (key_len != 11 || memcmp(key, "constructor", 11) != 0) return false;
  if (scr_dyn_error_proto_in_chain(d)) return true;
  if (d->kind != SCR_DYN_OBJ) return false;
  if (scr_dyn_is_minted_proto(d)) return true;
  const ScrDyn *p = scr_dyn_ext(d)->proto;
  for (size_t steps = 0; p != NULL && steps < SCR_PROTO_MAX_DEPTH; steps++) {
    if (p->kind != SCR_DYN_OBJ) return false;
    if (scr_dyn_is_minted_proto(p)) return true;
    p = scr_dyn_ext(p)->proto;
  }
  return false;
}

/* OWN presence, hidden table included — Object.hasOwn's question. Node
 * answers TRUE for an own non-enumerable property (that is the whole
 * difference between hasOwn and Object.keys), so this must too. */
bool scr_dyn_obj_has_own_prop(const ScrDyn *d, const char *key, size_t key_len) {
  if (d->kind != SCR_DYN_OBJ) return false;
  if (scr_dyn_obj_get(d, key, key_len) != NULL) return true;
  if (scr_dyn_ext(d)->hidden != NULL && scr_dyn_obj_get(scr_dyn_ext(d)->hidden, key, key_len) != NULL) {
    return true;
  }
  /* `constructor` is an OWN property of %Error.prototype% in Node — of
   * that object and of no descendant — and of a function's minted
   * prototype OBJECT, again of that object and of no instance below it.
   * The Error one's value is a loud refusal and the function one's is
   * computed; both EXIST (scr_dyn_obj_key_present's note). */
  return key_len == 11 && memcmp(key, "constructor", 11) == 0 &&
         (d == scr_error_proto || scr_dyn_minted_proto_has_ctor(d));
}

/* The one hidden property whose CREATION POSITION this walk does know:
 * a minted prototype is BORN carrying `constructor`, before any member a
 * program can add, so it is own-key index 0 and every enumerable member
 * follows in insertion order. Both halves of the fence's argument fail
 * for it — the name is not missing (scr_dyn_own_names_ctor puts it back)
 * and its order is not unrecorded — so it is not a reason to refuse.
 * Every OTHER hidden property still is. */
static bool scr_dyn_own_names_skip(const ScrDyn *d, const char *key, size_t key_len) {
  if (key_len == 11 && memcmp(key, "constructor", 11) == 0 &&
      scr_dyn_minted_proto_has_ctor(d)) {
    return true;
  }
  /* An ENUMERABLE ACCESSOR is the second property both halves of the
   * fence's argument fail for, and for the same two reasons: the name is
   * not missing — the keys walk finds its SLOT in the member table and
   * lists it — and its order is not unrecorded, because the slot is
   * exactly the record. It is not a reason to refuse.
   *
   * A TOMBSTONE still is. Its position is known but it is not an own
   * enumerable key, so the keys walk skips it and the list this fence
   * guards would be short by it. Loud, as before. */
  if (!scr_dyn_obj_entry_is_slot(d, key, key_len)) return false;
  const ScrDyn *ent = scr_dyn_ext(d)->hidden != NULL
                          ? scr_dyn_obj_get(scr_dyn_ext(d)->hidden, key, key_len)
                          : NULL;
  return ent != NULL && ent->kind == SCR_DYN_ARR && scr_hid_enumerable(ent);
}

/* `Object.getOwnPropertyNames`'s other half: put back the own name the
 * keys walk cannot see because it is not stored as a member at all. A
 * minted prototype's `constructor` is an OWN property in Node
 * (Object.hasOwn already says so) and the FIRST one in creation order,
 * so it goes at index 0 of the list the keys walk produced. Borrowed
 * both ways; a no-op for every other receiver. */
void scr_dyn_own_names_ctor(ScrDyn *names, const ScrDyn *o) {
  if (names == NULL || names->kind != SCR_DYN_ARR) return;
  if (!scr_dyn_minted_proto_has_ctor(o)) return;
  ScrStr *s = scr_str_new("constructor", 11);
  ScrDyn *v = scr_dyn_new_str(s); /* retains */
  scr_str_release(s);
  scr_dyn_arr_push(names, v); /* ownership moves in; grows the vector */
  /* …then rotate it to the front. The push is what guarantees capacity;
   * own-key order is creation order and this name was created first. */
  for (size_t i = names->v.arr.len - 1; i > 0; i--) {
    names->v.arr.items[i] = names->v.arr.items[i - 1];
  }
  names->v.arr.items[0] = v;
}

/* `Object.getOwnPropertyNames`'s guard. The emitted own-names walk is
 * `Object.keys` plus `length` for the two kinds that carry it, which is
 * exact for a receiver whose own properties are ALL enumerable — and
 * wrong for one that carries non-enumerable ones, because those are
 * exactly the names the two functions disagree about and exactly what
 * the keys walk cannot see.
 *
 * Membership alone would not be enough to fix it either: JS lists own
 * string keys in PROPERTY CREATION order, and the two tables here record
 * their own insertion orders separately, not a shared one. So a receiver
 * with a hidden property refuses by name rather than answering a list
 * Node disagrees with — the answer would be silently SHORT, which is the
 * shape of a bug that surfaces somewhere else. Every other receiver pays
 * one NULL test.
 *
 * ONE hidden property is exempt, and only because BOTH halves of that
 * argument fail for it: scr_dyn_own_names_skip. */
void scr_dyn_own_names_fence(const ScrDyn *d) {
  if (d == NULL || d->kind != SCR_DYN_OBJ || scr_dyn_ext(d)->hidden == NULL) return;
  if (scr_dyn_ext(d)->hidden->v.obj.len == 0) return;
  size_t refusing = 0;
  for (size_t i = 0; i < scr_dyn_ext(d)->hidden->v.obj.len; i++) {
    const ScrDynEntry *e = &scr_dyn_ext(d)->hidden->v.obj.entries[i];
    if (!scr_dyn_own_names_skip(d, e->key, e->key_len)) refusing++;
  }
  if (refusing == 0) return;
  ScrJsonBuf b;
  scr_jb_init(&b);
  scr_jb_puts(&b, "Object.getOwnPropertyNames over a dynamic object carrying NON-ENUMERABLE"
                  " own properties is not supported yet (");
  size_t shown = 0;
  for (size_t i = 0; i < scr_dyn_ext(d)->hidden->v.obj.len; i++) {
    const ScrDynEntry *e = &scr_dyn_ext(d)->hidden->v.obj.entries[i];
    if (scr_dyn_own_names_skip(d, e->key, e->key_len)) continue;
    if (shown++ > 0) scr_jb_puts(&b, ", ");
    scr_jb_putc(&b, '\'');
    scr_jb_write(&b, e->key, e->key_len);
    scr_jb_putc(&b, '\'');
  }
  scr_jb_puts(&b, " — the walk behind this answers Object.keys plus 'length', so those"
                  " names would be MISSING from the list, and JS orders own keys by"
                  " creation, which the separate table does not record. Object.keys is"
                  " exact; so is a read, a write, `in` and Object.hasOwn)");
  scr_throw_error(SCR_ERR_ERROR, scr_jb_finish(&b));
}

/* Drop one OWN data member, preserving the insertion order of the rest
 * (JS own-key order is insertion order, and defineProperty replacing a
 * data property with an accessor must not reshuffle its neighbours). */
static void scr_dyn_obj_unset(ScrDyn *obj, const char *key, size_t key_len) {
  for (size_t i = 0; i < obj->v.obj.len; i++) {
    ScrDynEntry *e = &obj->v.obj.entries[i];
    if (e->key_len == key_len && memcmp(e->key, key, key_len) == 0) {
      /* unlink before release: the entry must be out of the table before
       * the value's release can trigger a collection */
      ScrDyn *old = e->value;
      if (!e->key_static) scr_json_key_free(e->key, e->key_len);
      memmove(&obj->v.obj.entries[i], &obj->v.obj.entries[i + 1],
              (obj->v.obj.len - i - 1) * sizeof *obj->v.obj.entries);
      obj->v.obj.len--;
      scr_dyn_release(old);
      return;
    }
  }
}

/* The one allocator for a hidden entry, so the two families cannot end
 * up with different shapes. `a`/`b` are BORROWED (the entry retains
 * them). Any own ENUMERABLE member of the same name is dropped — a
 * define CONVERTS a property, it does not layer one over the other. */
static void scr_dyn_obj_put_hidden(ScrDyn *recv, const char *key, size_t key_len,
                                   bool is_data, ScrDyn *a, ScrDyn *b, bool configurable,
                                   bool enumerable) {
  if (recv->kind != SCR_DYN_OBJ) return;
#ifdef SCR_DYNCEN_ON
  scr_dyncen_note_korigin(SCR_DYNCEN_KO_HIDDEN);
#endif
  if (scr_dyn_ext(recv)->hidden == NULL) scr_dyn_ext_w(recv)->hidden = scr_dyn_new_obj();
  /* RETAIN BEFORE DROP, and the order is not cosmetic. `a` may BE the
   * member table's current value for this key — that is what a
   * redefinition which names only attributes means, `{ writable: false }`
   * over `o.k = 1`, where ES keeps the value — so unsetting the member
   * first would release the last reference to the very node about to be
   * stored, and the freelist would hand the recycled node straight back
   * as one of the bools below. (Measured: `o.k` answered `true`, the
   * `writable` flag, read out of a node that had been a 1.) Building the
   * entry first makes both halves +1 before anything is given up. */
  ScrDyn *ent = scr_dyn_new_arr();
  scr_dyn_arr_push(ent, scr_dyn_new_bool(is_data));
  scr_dyn_arr_push(ent, scr_dyn_retain(a));
  scr_dyn_arr_push(ent, scr_dyn_retain(b));
  scr_dyn_arr_push(ent, scr_dyn_new_bool(configurable));
  scr_dyn_arr_push(ent, scr_dyn_new_bool(enumerable));
  /* A SLOT already standing for this key keeps its place. ES redefines a
   * property where it is — `Object.keys` does not move a name because
   * its `enumerable` flipped — and the slot IS the recorded position, so
   * dropping and re-adding it would put the key back at the END of the
   * order. Anything else of this name in the member table is a real
   * member, and a define CONVERTS a property rather than layering one
   * over the other, so that one goes. */
  bool slot_held = scr_dyn_obj_entry_is_slot(recv, key, key_len);
  if (!slot_held) scr_dyn_obj_unset(recv, key, key_len);
  scr_dyn_obj_set(scr_dyn_ext(recv)->hidden, key, key_len, ent); /* ownership moves in */
  /* …and CLAIM a position for a property that is enumerable and has none
   * yet. The claim is made at the end of the member table, which is
   * where a property created now belongs. A slot is never withdrawn when
   * `enumerable` goes false: it becomes a tombstone, so a later
   * redefinition back to true restores the key to the position it had
   * rather than to a new one. */
  if (enumerable && !slot_held) {
    scr_dyn_obj_set(recv, key, key_len, scr_dyn_retain(scr_dyn_acc_slot()));
  }
}

/* Install `key` as an accessor property of `recv`. Both halves are
 * BORROWED; either may be the undefined singleton for a one-sided
 * accessor. `configurable` rides in the entry so a second define can
 * answer JS's "Cannot redefine property" instead of silently replacing a
 * sealed getter. */
void scr_dyn_obj_define_accessor(ScrDyn *recv, const char *key, size_t key_len,
                                 ScrDyn *getter, ScrDyn *setter, bool configurable,
                                 bool enumerable) {
  scr_dyn_obj_put_hidden(recv, key, key_len, false, getter, setter, configurable, enumerable);
}

/* Install `key` as a NON-ENUMERABLE data property — what
 * `Object.defineProperty(o, k, { value })` means, since defineProperty
 * defaults every flag to false, and what `Object.create(p, descs)`
 * installs for every `{ value }` descriptor in its map. `writable` is
 * real here: [[Set]] refuses a write to a non-writable slot with V8's
 * text rather than quietly accepting one JS rejects. */
void scr_dyn_obj_define_hidden_data(ScrDyn *recv, const char *key, size_t key_len,
                                    ScrDyn *value, bool writable, bool configurable) {
  ScrDyn *w = scr_dyn_new_bool(writable); /* +1 */
  /* Always NON-enumerable: an enumerable data property is an ordinary
   * member and is stored as one, so this family never needs the slot.
   * The element is written anyway so that both families in this table
   * have the same five, which is what lets the scr_hid_* readers stay
   * one set. */
  scr_dyn_obj_put_hidden(recv, key, key_len, true, value, w, configurable, false);
  scr_dyn_release(w);
}

/* The attributes of an OWN hidden property, for the redefinition rule
 * (ES keeps every field a descriptor OMITS). False when there is none.
 * Any out-pointer may be NULL. */
bool scr_dyn_obj_hidden_attrs(const ScrDyn *recv, const char *key, size_t key_len,
                              bool *is_data, bool *writable, bool *configurable,
                              bool *enumerable) {
  if (recv->kind != SCR_DYN_OBJ || scr_dyn_ext(recv)->hidden == NULL) return false;
  ScrDyn *ent = scr_dyn_obj_get(scr_dyn_ext(recv)->hidden, key, key_len);
  if (ent == NULL || ent->v.arr.len < 4) return false;
  if (is_data) *is_data = scr_hid_is_data(ent);
  /* An accessor has no `writable` at all; false is the answer a data
   * redefinition over one should inherit (ES's conversion defaults it). */
  if (writable) *writable = scr_hid_is_data(ent) && scr_hid_writable(ent);
  if (configurable) *configurable = scr_hid_configurable(ent);
  /* And the element this table could not hold until the slot existed.
   * It is what makes a bare `{ get }` REDEFINITION over an enumerable
   * accessor keep the flag ES says it keeps, instead of quietly
   * demoting the key out of Object.keys. */
  if (enumerable) *enumerable = scr_hid_enumerable(ent);
  return true;
}

/* True when `recv` already carries an OWN hidden property for `key` that
 * was NOT declared configurable — the case a second define is a
 * TypeError in JS, whichever family it is. OWN only: shadowing an
 * inherited one with a define is legal. */
bool scr_dyn_obj_hidden_sealed(const ScrDyn *recv, const char *key, size_t key_len) {
  if (recv->kind != SCR_DYN_OBJ || scr_dyn_ext(recv)->hidden == NULL) return false;
  ScrDyn *ent = scr_dyn_obj_get(scr_dyn_ext(recv)->hidden, key, key_len);
  if (ent == NULL || ent->v.arr.len < 4) return false;
  return !scr_hid_configurable(ent);
}

/* The other direction: redefining a hidden property as an ordinary
 * enumerable member drops the entry, so the two tables never both claim
 * one key and any getter/setter closures are released at the
 * redefinition rather than at the object's death. */
void scr_dyn_obj_drop_hidden(ScrDyn *recv, const char *key, size_t key_len) {
  if (recv->kind != SCR_DYN_OBJ || scr_dyn_ext(recv)->hidden == NULL) return;
  scr_dyn_obj_unset(scr_dyn_ext(recv)->hidden, key, key_len);
  /* The SLOT is deliberately LEFT STANDING. Every caller of this
   * function is converting the property into an ordinary enumerable
   * MEMBER and writes one immediately after, and scr_dyn_obj_put
   * replaces an existing entry's value IN PLACE — so the member inherits
   * the accessor's position, which is what ES says (a redefinition does
   * not move a property) and what Node answers: after
   * `Object.defineProperty(o, "g", {get})` between `o.a` and `o.z`, a
   * redefinition of `g` to a data property keeps `["a","g","z"]`.
   * Unsetting the slot here moved it to `["a","z","g"]`. */
}

/* The spec's array-index test, public because util.inspect has to
 * interleave two key sources on a compiled class instance and
 * OrdinaryOwnPropertyKeys puts every index key ahead of every string key
 * across the WHOLE object. The predicate itself is the one the entry
 * table's own ordering uses (scr_dyn_obj_key_order), so there is one
 * definition of "array index" in the runtime and not two. */
bool scr_dyn_obj_key_is_index(const char *key, size_t len) {
  double ignored = 0;
  return scr_dyn_key_is_index(key, len, &ignored);
}

/* scriptc's INTERNAL-SLOT table — contract in scr_runtime.h. Note what is
 * NOT here: no accessor family, no prototype walk, no `in`/hasOwn/delete
 * arm, and no reader anywhere else in this file. That absence IS the
 * mechanism — a table nothing else consults cannot leak into an answer,
 * and a key nothing else writes cannot be forged by spelling it. */
void scr_dyn_obj_set_slot(ScrDyn *recv, const char *key, size_t key_len, ScrDyn *v) {
  if (recv == NULL || recv->kind != SCR_DYN_OBJ) {
    scr_dyn_release(v);
    return;
  }
  if (scr_dyn_ext(recv)->slots == NULL) scr_dyn_ext_w(recv)->slots = scr_dyn_new_obj();
  scr_dyn_obj_set(scr_dyn_ext(recv)->slots, key, key_len, v); /* ownership moves in */
}

ScrDyn *scr_dyn_obj_slot_get(const ScrDyn *d, const char *key, size_t key_len) {
  if (d == NULL || d->kind != SCR_DYN_OBJ || scr_dyn_ext(d)->slots == NULL) return NULL;
  return scr_dyn_obj_get(scr_dyn_ext(d)->slots, key, key_len);
}

/* The CONSTRUCTOR NAME a converted BUILTIN record shows under. `name` is
 * a static literal the emitter spells (no ownership, like the one a
 * minted prototype carries), so this is a pointer store and nothing
 * else.
 *
 * It is the same field `new F()` fills, deliberately: util.inspect
 * already prints it as the `F { ... }` prefix and the property-refusal
 * texts already spell it as `#<F>`, which is what Node does for a Dirent
 * too. Those two are the whole of what it changes, MEASURED rather than
 * assumed: `Object.defineProperty` has no lowering, so the `#<F>` texts
 * are unreachable from a compiled program at all, and the third reader
 * (scr_dyn_proto_chain_is_fn_pub, behind the `constructor` read) is not
 * reachable with one either -- every keyed read on an `unknown` receiver
 * dynChecks into a fresh record first, and the name does not survive
 * that. The comment on that predicate carries the four spellings. */
void scr_dyn_obj_set_ctor_name(ScrDyn *d, const char *name) {
  if (d == NULL || d->kind != SCR_DYN_OBJ) return;
  /* A NULL name is what every object already answers without an ext, so
   * storing one would buy a 32-byte block to hold the default. */
  if (name != NULL) scr_dyn_ext_w(d)->cname = name;
  else if (d->v.obj.ext != NULL) d->v.obj.ext->cname = NULL;
}

/* Node spells the offending RECEIVER into the three V8 property-refusal
 * texts below, and it spells it from the receiver's CONSTRUCTOR, not from
 * a fixed word. Measured against v25.9.0, with
 * `Object.defineProperty(x, "p", { value: 1 })` and then a write, a
 * delete, or a write against a getter-only accessor:
 *
 *     {}                   Cannot delete property 'p' of #<Object>
 *     new F()              Cannot delete property 'p' of #<F>
 *     new Weird$Name()     Cannot delete property 'p' of #<Weird$Name>
 *     class Klass          Cannot delete property 'p' of #<Klass>
 *     Object.create(null)  Cannot delete property 'p' of [object Object]
 *
 * `cname` is exactly that constructor name -- the field util.inspect
 * already prints as the `F { x: 1 }` prefix, so an object that inspects
 * as `F { ... }` and refuses as `#<Object>` was disagreeing with itself
 * about what it is. A null-prototype dictionary has NO constructor to
 * name and V8 falls back to the ToString form; `null_proto` is that
 * object exactly.
 *
 * One case stays as it stands, and cannot be reached: an object whose
 * prototype was REPLACED after construction (Object.setPrototypeOf(o,
 * null)) reads `[object Object]` in Node while this representation still
 * remembers cname. setPrototypeOf has no lowering, so no compiled program
 * can spell it. */
static void scr_jb_put_recv_ctor(ScrJsonBuf *b, const ScrDyn *recv) {
  if (recv->kind == SCR_DYN_OBJ && recv->null_proto) {
    scr_jb_puts(b, "[object Object]");
    return;
  }
  const char *cname = recv->kind == SCR_DYN_OBJ ? scr_dyn_ext(recv)->cname : NULL;
  scr_jb_puts(b, "#<");
  scr_jb_puts(b, cname != NULL ? cname : "Object");
  scr_jb_puts(b, ">");
}

/* `delete recv[key]` over a dyn receiver — JS's [[Delete]], which is an
 * OWN-property operation and an ANSWER, not a void statement.
 *
 * The three outcomes, in the spec's order:
 *   - no own property of that name (the chain is irrelevant — deleting
 *     through an object never touches its prototype) → true, nothing
 *     removed. `delete {}.x` is true in JS.
 *   - an own DATA member → removed, true. Order-preserving, because own
 *     key order is insertion order and the survivors keep theirs.
 *   - an own HIDDEN property, accessor or non-enumerable data → removed
 *     if it was defined CONFIGURABLE, else V8's strict-mode TypeError,
 *     verbatim. The properties Object.defineProperty installs here
 *     default to non-configurable, so this path is reachable; sloppy
 *     mode would answer a quiet `false` instead, and this runtime does
 *     not do quiet (the stance scr_dyn_key_set already takes for the
 *     setter-less write).
 *
 * The two tables are consulted separately on purpose: `entries` and
 * `hidden` never both hold one key (define converts, and this drops
 * from whichever holds it), so "delete from the right one" is a lookup,
 * not a policy.
 *
 * ARR: a canonical index becomes a HOLE, which this representation has
 * no way to spell — it would have to shorten the array and renumber
 * every later element, which is not what JS does. Refused loudly rather
 * than answered wrongly. Other kinds carry no own properties a delete
 * could remove, so they answer true like JS. Both borrowed. */
bool scr_dyn_key_delete(ScrDyn *recv, ScrStr *key) {
  if (recv == NULL || recv->kind == SCR_DYN_UNDEF || recv->kind == SCR_DYN_NULL) {
    ScrJsonBuf sb;
    scr_jb_init(&sb);
    scr_jb_puts(&sb, "Cannot convert undefined or null to object");
    scr_throw_error(SCR_ERR_TYPE, scr_jb_finish(&sb));
    return false;
  }
  if (recv->static_copy) {
    scr_dyn_static_copy_refuse("deleting a property");
    return false;
  }
  if (recv->kind == SCR_DYN_OBJ) {
    /* The implicit own `constructor` of a function's minted prototype
     * (scr_dyn_fn_prototype) is CONFIGURABLE in Node, so this delete
     * succeeds — and it has to be RECORDED, because the property's
     * existence is answered by the registry rather than by either table.
     * Without the mark, Object.hasOwn and Object.getOwnPropertyNames
     * went on reporting a name the program had just removed. Marked
     * BEFORE the two table walks below, which then remove the stored
     * value if `F.prototype.constructor = F` ever put one there. */
    if (key->len == 11 && memcmp(key->data, "constructor", 11) == 0 &&
        scr_dyn_is_minted_proto(recv)) {
      scr_ctor_mark_gone(recv);
    }
    if (scr_dyn_obj_get(recv, key->data, key->len) != NULL) {
      scr_dyn_obj_unset(recv, key->data, key->len);
      return true;
    }
    if (scr_dyn_ext(recv)->hidden != NULL &&
        scr_dyn_obj_get(scr_dyn_ext(recv)->hidden, key->data, key->len) != NULL) {
      if (scr_dyn_obj_hidden_sealed(recv, key->data, key->len)) {
        ScrJsonBuf sb;
        scr_jb_init(&sb);
        scr_jb_puts(&sb, "Cannot delete property '");
        scr_jb_write(&sb, key->data, key->len);
        scr_jb_puts(&sb, "' of ");
        scr_jb_put_recv_ctor(&sb, recv);
        scr_throw_error(SCR_ERR_TYPE, scr_jb_finish(&sb));
        return false;
      }
      scr_dyn_obj_unset(scr_dyn_ext(recv)->hidden, key->data, key->len);
      /* An enumerable accessor is TWO table entries and a delete removes
       * the property, not one half of it. The slot has to go with the
       * descriptor or the key would stay in Object.keys with nothing
       * behind it. */
      if (scr_dyn_obj_entry_is_slot(recv, key->data, key->len)) {
        scr_dyn_obj_unset(recv, key->data, key->len);
      }
      return true;
    }
    return true;
  }
  if (recv->kind == SCR_DYN_ARR) {
    size_t idx = 0;
    int is_index = key->len > 0 && key->len < 16 && !(key->len > 1 && key->data[0] == '0');
    for (size_t i = 0; is_index && i < key->len; i++) {
      if (key->data[i] < '0' || key->data[i] > '9') is_index = 0;
      else idx = idx * 10 + (size_t)(key->data[i] - '0');
    }
    if (is_index && idx < recv->v.arr.len) {
      ScrJsonBuf sb;
      scr_jb_init(&sb);
      scr_jb_puts(&sb, "'delete' of an array element leaves a hole, which this runtime cannot represent (assign undefined, or splice)");
      scr_throw_error(SCR_ERR_TYPE, scr_jb_finish(&sb));
      return false;
    }
    return true;
  }
  return true;
}

/* The checked-dynamic keyed WRITE (`h.k = v` on a dyn receiver): OBJ sets
 * the member (later writes win, insertion order — JS); undefined/null
 * throws Node's "Cannot set properties of ..."; every other kind throws
 * Node's strict-mode "Cannot create property ..." (sloppy mode would
 * ignore silently — the loud choice, SEMANTICS.md). Receiver, key, and
 * value are all BORROWED (the member retains the value in). */
static const char *scr_dyn_kind_name(const ScrDyn *d);
/* Is this box the %Uint8Array% singleton? Defined with it, below. */
static bool scr_u8_is_ctor(const ScrDyn *d);
/* `Uint8Array.from` / `Uint8Array.of`, the two STATIC methods a keyed
 * read on the %Uint8Array% box must answer. +1, or NULL for every other
 * name. Defined with the singletons, below; declared here because
 * scr_dyn_fn_get is the one place the read arrives and it comes first in
 * the file. */
static ScrDyn *scr_u8_static_member(const char *key, size_t key_len);
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
/* The OWN half of the same question, which is NOT the same answer for
 * one receiver: `Uint8Array.from` and `Uint8Array.of` are INHERITED from
 * %TypedArray% in Node, so `Object.hasOwn(Uint8Array, "from")` is FALSE
 * there while `"from" in Uint8Array` stays true. It is the split
 * %Uint8Array.prototype% models with a real [[Prototype]] link, spelled
 * out here instead because a FUNC box walks no chain. `name`, `length`
 * and `BYTES_PER_ELEMENT` are all genuinely OWN in Node and keep
 * answering true through both. */
bool scr_dyn_fn_has_own(const ScrDyn *v, const char *key, size_t key_len) {
  if (scr_u8_is_ctor(v)) {
    ScrDyn *st = scr_u8_static_member(key, key_len); /* +1, or NULL */
    if (st != NULL) {
      scr_dyn_release(st);
      return false;
    }
  }
  return scr_dyn_fn_has(v, key, key_len);
}
/* A CANONICAL array-index key — the one question `in`, Object.hasOwn and
 * the index arms of every indexable dyn kind all ask, written ONCE. ES's
 * rule: the key must be the decimal spelling of the integer it names, so
 * "01", "1.0", "-1" and " 1" are ORDINARY string keys, not indices. The
 * digit cap keeps the accumulator inside size_t; a longer run of digits
 * cannot be a valid index of anything this runtime can hold. */
static bool dyn_canonical_index(const ScrStr *key, size_t *out) {
  if (key->len == 0 || key->len > 15) return false;
  if (key->len > 1 && key->data[0] == '0') return false;
  size_t idx = 0;
  for (size_t i = 0; i < key->len; i++) {
    char c = key->data[i];
    if (c < '0' || c > '9') return false;
    idx = idx * 10 + (size_t)(c - '0');
  }
  *out = idx;
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
    size_t idx = 0;
    return dyn_canonical_index(key, &idx) && idx < v->v.arr.len;
  }
  /* A function value carries own properties (assignment and
   * defineProperties both land in one table), so `k in f` answers from
   * the same place the read does. */
  if (v->kind == SCR_DYN_FUNC) return scr_dyn_fn_has(v, key->data, key->len);
  return false;
}

/* The one refusal every mutating dyn entry point shares: this receiver is
 * a copy the static→dyn boundary made of a value the caller still names,
 * so the write cannot reach what Node would write. Loud beats lost. */
void scr_dyn_static_copy_refuse(const char *what) {
  ScrJsonBuf b;
  scr_jb_init(&b);
  scr_jb_puts(&b, what);
  scr_jb_puts(&b, " through a value that crossed into an 'unknown' (dynamic) slot"
                  " is not supported yet for arrays and records: the crossing COPIES"
                  " them (their static and dynamic representations are different"
                  " memory), so this write would land on the copy and never reach the"
                  " object the caller still holds — where Node writes that object"
                  " itself. A Uint8Array or Buffer crosses by REFERENCE and its writes"
                  " do land; giving the parameter a static type keeps the write static");
  scr_throw_error(SCR_ERR_ERROR, scr_jb_finish(&b));
}

void scr_dyn_key_set(ScrDyn *recv, ScrStr *key, ScrDyn *value) {
#ifdef SCR_DYNCEN_ON
  scr_dyncen_note_korigin(SCR_DYNCEN_KO_KEYSET);
#endif
  if (recv->static_copy) {
    scr_dyn_static_copy_refuse("assigning a property");
    return;
  }
  if (recv->kind == SCR_DYN_BYTES) {
    /* A typed-array element write. The payload is SHARED with the static
     * source (scr_dyn_new_bytes_ref), so this lands where Node's does.
     *
     * JS's integer-indexed exotic objects: a canonical index inside the
     * bounds stores the value through the element's own coercion
     * (ToNumber, then the width's modular truncation — scr_bytes_set is
     * the same routine the static tier uses), and an index OUT of bounds
     * is a SILENT no-op that creates no property and throws even in
     * strict mode never. A non-index key would create an ordinary expando
     * property, which a dyn bytes value has no table for — that keeps the
     * loud "Cannot create property" fence below. */
    size_t idx = 0;
    int is_index = key->len > 0 && !(key->len > 1 && key->data[0] == '0');
    for (size_t i = 0; is_index && i < key->len; i++) {
      if (key->data[i] < '0' || key->data[i] > '9') is_index = 0;
      else idx = idx * 10 + (size_t)(key->data[i] - '0');
    }
    if (is_index) {
      double num = scr_dyn_to_number(value);
      if (scr_exc_pending()) return; /* ToNumber of a Symbol, a throwing valueOf */
      if (idx < recv->v.bytes->len) scr_bytes_set(recv->v.bytes, (double)idx, num);
      return;
    }
  }
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
     * A NON-ENUMERABLE data property is the other thing the walk can
     * find, and JS distinguishes two cases that look alike:
     *   - OWN and writable: [[Set]] updates the VALUE and keeps every
     *     attribute, so the key must stay non-enumerable. Falling
     *     through to obj_set would quietly promote it into Object.keys.
     *   - INHERITED and writable: JS creates a FRESH ordinary own
     *     property (all three flags true) and leaves the prototype's
     *     alone — which is what obj_set below already does.
     * Non-writable refuses either way, with V8's strict-mode text.
     *
     * Only reached when the receiver's chain carries hidden properties
     * at all — the common object pays one NULL test per write. */
    ScrDyn *found = NULL;
    const ScrDyn *holder = NULL;
    if (scr_dyn_ext(recv)->hidden != NULL || scr_dyn_ext(recv)->proto != NULL) {
      ScrPropKind pk = scr_dyn_obj_resolve(recv, key->data, key->len, &found, &holder);
      if (pk == SCR_PROP_HIDDEN_DATA) {
        if (!scr_hid_writable(found)) {
          ScrJsonBuf sb;
          scr_jb_init(&sb);
          scr_jb_puts(&sb, "Cannot assign to read only property '");
          scr_jb_write(&sb, key->data, key->len);
          scr_jb_puts(&sb, "' of object '");
          scr_jb_put_recv_ctor(&sb, recv);
          scr_jb_puts(&sb, "'");
          scr_throw_error(SCR_ERR_TYPE, scr_jb_finish(&sb));
          return;
        }
        if (holder == recv) {
          ScrDyn *old = found->v.arr.items[1];
          found->v.arr.items[1] = scr_dyn_retain(value);
          scr_dyn_release(old); /* after the retain: value may BE old */
          return;
        }
        /* inherited and writable — fall through to the shadowing write */
      } else if (pk == SCR_PROP_ACCESSOR) {
        ScrDyn *setter = scr_hid_setter(found);
        if (setter->kind != SCR_DYN_FUNC) {
          /* V8's strict-mode text. Sloppy mode ignores the write
           * silently; this runtime does not do silent. */
          ScrJsonBuf sb;
          scr_jb_init(&sb);
          scr_jb_puts(&sb, "Cannot set property ");
          scr_jb_write(&sb, key->data, key->len);
          scr_jb_puts(&sb, " of ");
          scr_jb_put_recv_ctor(&sb, recv);
          scr_jb_puts(&sb, " which has only a getter");
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
    /* The ONE own property this representation knows Node has and does
     * not STORE: a function's minted prototype is born carrying
     * `constructor`, a data property { writable, NON-enumerable,
     * configurable } (scr_dyn_fn_prototype answers its value out of the
     * registry rather than holding it, so no cycle is created by the
     * mint). `F.prototype.constructor = F` is therefore a [[Set]] over
     * an EXISTING non-enumerable own property, and ES keeps every
     * attribute and changes only [[Value]] — exactly the rule the
     * SCR_PROP_HIDDEN_DATA arm above applies to the properties this
     * runtime does store. Falling through to obj_set instead promoted
     * the key into `entries`, which IS every enumeration surface at
     * once: Object.keys/values/entries, Object.assign, util.inspect and
     * deepStrictEqual all reported a `constructor` Node does not show.
     *
     * The narrowness is the point. On any OTHER receiver — a plain
     * literal, or the `Object.create(Parent.prototype)` object the ES5
     * inheritance idiom assigns through — Node has NO own
     * `constructor` to preserve, so the assignment creates an ordinary
     * enumerable one and `Object.keys` DOES list it. Both were measured
     * against v25.9.0 before this arm was written; widening it to every
     * receiver would trade one wrong answer for another. */
    if (key->len == 11 && memcmp(key->data, "constructor", 11) == 0 &&
        scr_dyn_minted_proto_has_ctor(recv)) {
      scr_dyn_obj_define_hidden_data(recv, key->data, key->len, value, true, true);
      return;
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
      /* unlink before release, and retain before either: `value` may BE
       * the element already stored here */
      ScrDyn *old = recv->v.arr.items[idx];
      recv->v.arr.items[idx] = scr_dyn_retain(value);
      scr_dyn_release(old);
      return;
    }
  }
  if (recv->kind == SCR_DYN_HANDLE) {
    scr_dyn_handle_key_set(recv, key, value);
    return;
  }
  if (recv->kind == SCR_DYN_OBJINST) {
    /* Node writes the instance's real field. The box has no member table
     * to reach it, and a write that silently went nowhere is the one
     * answer worse than a refusal (the static_copy stance). */
    scr_dyn_objinst_fence(recv, "a property write");
    return;
  }
  if (recv->kind == SCR_DYN_BIG) {
    /* A primitive takes no properties at all: (5n).x = 1 is a silent
     * no-op in sloppy mode and a TypeError under strict. Neither of
     * those is "the write landed", so refuse loudly rather than let it
     * vanish — the static_copy stance. */
    scr_dyn_big_fence(recv, "a property write");
    return;
  }
  if (recv->kind == SCR_DYN_MAP) {
    /* Node takes an EXPANDO here too (a Map is an ordinary extensible
     * object), and this tier has nowhere to keep one. A write that goes
     * nowhere is the static_copy stance's forbidden answer, so refuse. */
    scr_dyn_map_fence(recv, "assigning a property");
    return;
  }
  if (recv->kind == SCR_DYN_ARRBUF) {
    /* Node takes an EXPANDO here (an ArrayBuffer is an ordinary
     * extensible object), and `buf[0] = 1` is a silent no-op because
     * there is no index signature to write through. This tier has
     * nowhere to keep an expando and no index to write, so both
     * spellings would go nowhere — the refusal the static_copy stance
     * asks for rather than a write that quietly vanished. */
    const char *msg = "assigning a property on a dynamic ArrayBuffer is not supported yet";
    scr_throw_error_msg(SCR_ERR_ERROR, msg, strlen(msg));
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
    /* A LIFTED member (scr_dyn_expando_bind): the storage is the module
     * global the name-spelled read and write already use, so the write
     * goes THERE and not into the table beside it. Without this the two
     * spellings would each keep their own answer — which is exactly the
     * split this registry exists to close, and the worse half of it: a
     * write nothing static could ever see. */
    if (scr_dyn_expando_set(recv->v.fn.clo, key->data, key->len, value)) return;
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
 * (the record serializer drops the entry first); print null defensively.
 *
 * The nested twin of scr_dyn_json_write above — this one is reached only
 * from an emitted record serializer's OVERFLOW entries (an `unknown` index
 * signature), so it writes into an already-open object and answers void
 * instead of a presence flag. `_raw` is the walk with this position's
 * toJSON already applied; _keyed is the entry every recursion goes
 * through.
 *
 * DECLARED RESIDUAL: an overflow entry whose own toJSON answers undefined
 * prints `"k":null` where Node DROPS the key. The emitted walker writes
 * the key and colon before calling (its drop test is the raw entry's
 * SCR_DYN_UNDEF kind, which a hook's answer cannot reach from here), so
 * closing it means threading a presence flag back through two backends'
 * refcounted overflow loops. Nested positions INSIDE the entry are exact;
 * only the entry itself, only when it carries a toJSON, and only when that
 * toJSON answers undefined. */
static void scr_jb_put_dyn_raw(ScrJsonBuf *b, const ScrDyn *d);

static void scr_jb_put_dyn_keyed(ScrJsonBuf *b, const ScrDyn *d, const char *key, size_t key_len) {
  ScrDyn *sub = scr_dyn_json_tojson(d, key, key_len); /* +1 or NULL */
  if (sub == NULL) {
    if (scr_exc_pending()) return; /* the hook threw; the caller's check wins */
    scr_jb_put_dyn_raw(b, d);
    return;
  }
  /* Absent here is nested-position absent: null, the array-slot spelling
   * (see the DECLARED RESIDUAL above for the object-member spelling). */
  if (scr_dyn_json_absent(sub)) scr_jb_puts(b, "null");
  else scr_jb_put_dyn_raw(b, sub);
  scr_dyn_release(sub);
}

void scr_jb_put_dyn(ScrJsonBuf *b, const ScrDyn *d) {
  scr_jb_put_dyn_keyed(b, d, "", 0); /* JSON's root key */
}

static void scr_jb_put_dyn_raw(ScrJsonBuf *b, const ScrDyn *d) {
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
  case SCR_DYN_ARR: {
    /* SCR_JSON_REENTRANCY: length read once, like V8 — as above. */
    const size_t alen = d->v.arr.len;
    scr_jb_putc(b, '[');
    for (size_t i = 0; i < alen; i++) {
      if (i > 0) scr_jb_putc(b, ',');
      if (i >= d->v.arr.len) { /* the walk's own user code shrank it */
        scr_jb_puts(b, "null");
        continue;
      }
      /* The slot's toJSON key is its INDEX as a decimal string. */
      char ik[24];
      int ikn = snprintf(ik, sizeof ik, "%zu", i);
      /* PINNED across the hook — SCR_JSON_REENTRANCY, as above. */
      ScrDyn *el = scr_dyn_retain(d->v.arr.items[i]);
      scr_jb_put_dyn_keyed(b, el, ik, (size_t)ikn);
      scr_dyn_release(el);
      if (scr_exc_pending()) return; /* a slot threw; the caller unwinds */
    }
    scr_jb_putc(b, ']');
    return;
  }
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
  case SCR_DYN_ARRBUF:
    /* {} — an ArrayBuffer's own enumerable properties, of which there
     * are none. Unlike the OBJINST arm below this is not a fence
     * standing in for an unknown shape: the shape is known and empty. */
    scr_jb_puts(b, "{}");
    return;
  case SCR_DYN_MAP:
    /* {} — a Map's and a Set's own enumerable properties, of which there
     * are none either. The sibling writer's arm, same measurement. */
    scr_jb_puts(b, "{}");
    return;
  case SCR_DYN_BIG:
    /* V8's own TypeError, not a scriptc fence — see the sibling writer. */
    scr_dyn_big_json_throw();
    scr_jb_puts(b, "null"); /* the buffer never surfaces: the throw wins */
    return;
  case SCR_DYN_OBJINST: {
    /* Node serializes an instance's own enumerable properties; the box
     * has no member table to enumerate, so a fabricated {} would be a
     * silent wrong shape. Loud fence, like the handle arm above. */
    scr_dyn_objinst_fence(d, "JSON.stringify");
    scr_jb_puts(b, "null"); /* the buffer never surfaces: the throw wins */
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
    const size_t n = d->v.obj.len; /* SCR_JSON_REENTRANCY: `ord` is sized to this */
    for (size_t oi = 0; oi < n; oi++) {
      if (d->v.obj.len != n) break; /* the walk's own user code resized the table */
      const ScrDynEntry *e = &d->v.obj.entries[ord ? ord[oi] : oi];
      /* SNAPSHOT before any user code runs — `e` is not read again.
       * Keys escape exactly like string values (put_json_str quotes). */
      ScrStr *k = scr_str_new(e->key, e->key_len); /* +1 */
      /* The getter runs here too — util.format's `%j` is JSON.stringify
       * and cannot answer a different key set from it. */
      bool sl_skip = false;
      ScrDyn *mv = scr_dyn_obj_entry_read((ScrDyn *)d, e, &sl_skip); /* +1 or NULL */
      if (mv == NULL) {
        scr_str_release(k);
        if (sl_skip) continue;
        free(ord);
        return;
      }
      /* toJSON first, then the drop test on what it ANSWERED. */
      ScrDyn *sub = scr_dyn_json_tojson(mv, k->data, k->len); /* +1 or NULL */
      if (scr_exc_pending()) { /* the hook threw: propagate, do not swallow */
        if (sub) scr_dyn_release(sub);
        scr_dyn_release(mv);
        scr_str_release(k);
        free(ord);
        return;
      }
      const ScrDyn *val = sub ? sub : mv;
      if (scr_dyn_json_absent(val)) { /* undefined/function members drop, like Node */
        if (sub) scr_dyn_release(sub);
        scr_dyn_release(mv);
        scr_str_release(k);
        continue;
      }
      if (!first) scr_jb_putc(b, ',');
      first = false;
      scr_jb_put_json_str(b, k);
      scr_jb_putc(b, ':');
      scr_jb_put_dyn_raw(b, val); /* absence already decided above */
      if (sub) scr_dyn_release(sub);
      scr_dyn_release(mv);
      scr_str_release(k);
      if (scr_exc_pending()) { /* a nested member threw */
        free(ord);
        return;
      }
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
  case SCR_DYN_ARRBUF: return "ArrayBuffer"; /* "got ArrayBuffer" */
  case SCR_DYN_BIG: return "bigint"; /* "got bigint" — the typeof word,
    * because a bigint is a primitive with no class to name */
  case SCR_DYN_HANDLE: return scr_dyn_handle_cls(d); /* "got IncomingMessage" */
  case SCR_DYN_OBJINST: return scr_dyn_objinst_cls(d); /* "got Readable" */
  case SCR_DYN_MAP: return scr_dyn_map_cls(d); /* "got Map" / "got Set" —
    * and this is the arm that makes the kind's whole point READABLE:
    * `u as Map<string,number>` over a boxed Set<string> fails with
    * "expected Map at $, got Set" instead of unwrapping into the wrong
    * slot. Two DIFFERENT map types still both say "Map", which is what
    * Node's own vocabulary has to offer; the path names the site. */
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
#ifdef SCR_DYNCEN_ON
        scr_dyncen_note_korigin(SCR_DYNCEN_KO_PARSE);
#endif
        key = scr_json_key_alloc(span_len);
        memcpy(key, span, span_len);
        key[span_len] = '\0';
        key_len = span_len;
      } else {
        ScrStr *ks = scr_json_string_slow(p);
        if (!ks) {
          scr_dyn_release(obj);
          return NULL;
        }
#ifdef SCR_DYNCEN_ON
        scr_dyncen_note_korigin(SCR_DYNCEN_KO_PARSE);
#endif
        key = scr_json_key_alloc(ks->len);
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
     * listeners is still one JS object.
     *
     * REGEX is the exception, and the reason is the emitter, not the
     * tree: regex literals are INTERNED one static per (pattern, flags)
     * pair, so two distinct `/x/` literals arrive as one pointer where
     * JS has two objects. Pointer identity would answer true for them —
     * a wrong boolean, not an approximate one — and the frontend keeps
     * the matching `===` on two static regexes fenced (SC1043) for the
     * same reason. Refuse loudly here rather than let the dynamic
     * spelling answer what the static spelling refuses to. */
    if (a->v.handle.tag == SCR_DYNH_REGEX && b->v.handle.tag == SCR_DYNH_REGEX) {
      const char *msg =
          "'===' on two dynamic RegExp values is not supported yet (regex literals sharing a "
          "pattern and flags are interned, so reference identity cannot answer JS-exactly)";
      scr_throw_error_msg(SCR_ERR_ERROR, msg, strlen(msg));
      return false;
    }
    return a->v.handle.tag == b->v.handle.tag && a->v.handle.ptr == b->v.handle.ptr;
  case SCR_DYN_PROMISE:
    /* And the PROMISE: one promise crossing twice is one JS value. */
    return a->v.promise == b->v.promise;
  case SCR_DYN_OBJINST:
    /* And the class INSTANCE: the box is a boundary artifact, the object
     * is the JS value. Two boxes of one instance compare ===-equal, and
     * `unbox(box(x)) == x` holds by the same pointer. */
    return a->v.inst.o == b->v.inst.o;
  case SCR_DYN_BYTES:
    /* And the typed-array VIEW: the ScrBytes payload is the JS value and
     * the box is a boundary artifact, exactly as for the ArrayBuffer
     * below. This arm was missing and the kind fell through to the
     * pointer tail, so one Buffer boxed twice compared FALSE against
     * itself: `xs.indexOf(b)` over an `unknown[]` holding `b` answered
     * -1 where Node answers 0, because the array element and the
     * searched-for argument are two boxes of one payload.
     *
     * Payload identity is sound here in a way it is not for REGEX above:
     * ScrBytes are never interned. scr_bytes_alloc mallocs a fresh
     * header per construction, so two distinct Buffers hold two
     * pointers however equal their contents, and a VIEW carries its own
     * header (with a `backing` link) rather than its parent's -- which
     * is what makes `whole !== whole.subarray(0, n)` still answer the
     * way Node does. */
    return a->v.bytes == b->v.bytes;
  case SCR_DYN_ARRBUF:
    /* And the ARRAYBUFFER: the payload is the JS value, so two boxes of
     * one buffer compare ===-equal — the same stance the shared
     * representation already forces on aliasing. */
    return a->v.bytes == b->v.bytes;
  case SCR_DYN_MAP:
    /* And the MAP: the ScrMap is the JS value, the box is a boundary
     * artifact, so two boxes of one map compare ===-equal and
     * `unbox(box(m)) === m` holds by the same pointer. The typeKey is
     * NOT compared: two boxes of the same map necessarily carry the same
     * key, and comparing it would only add a way to answer false for a
     * value that IS itself. */
    return a->v.map.m == b->v.map.m;
  case SCR_DYN_BIG:
    /* And NOT the bigint: it is a PRIMITIVE, so === compares the VALUE.
     * The four kinds above answer with a pointer and the default tail
     * below answers with a pointer too, so an unadded kind would make
     * box(1n) === box(1n) FALSE where Node says true — a wrong boolean,
     * not an approximate one. */
    return scr_dyn_big_ops()->eq(a->v.big, b->v.big);
  case SCR_DYN_JSVAL:
    /* Identity is the ENGINE VALUE, not the box or even the cell: two
     * wraps of one engine value compare ===-equal (the engine's own
     * strict equality answers). Mixed kinds already answered false above
     * — a dyn copy is a different object, which is Node's answer too. */
    return a == b || scr_dyn_jsval_ops()->strict_eq(a->v.jsval.cell, b->v.jsval.cell);
  default: return a == b;
  }
}

/* ── the LIFTED-member accessor registry (see scr_runtime.h) ──────────
 *
 * Open addressing over (closure, key), the ctor table's shape and for the
 * same reasons: the key is a BORROWED module-lifetime closure pointer, so
 * nothing here owns a function, and the only counted references are the
 * two accessor boxes — which wrap immortal accessor closures and can
 * therefore never take part in a cycle.
 *
 * Borrowing is safe by construction rather than by counting, in both
 * shapes the compiler binds: a top-level function declaration's closure
 * is the INTERNED IMMORTAL one (it can never be freed), and a
 * module-level callable const's lives in a global released only at exit.
 * The teardown below never dereferences a key, so the window between
 * global release and teardown holds nothing that could be read.
 *
 * One entry per lifted member that a box can reach; the bind calls are
 * emitted once each into the declaring module's %init, so the table is
 * sized by the program's expando members (tens), not by uses. */
typedef struct {
  ScrClosure *clo; /* NULL = empty bucket; BORROWED */
  char *key;       /* owned copy — the emitted key string is a literal, but
                    * the library lane resets between sessions */
  size_t key_len;
  ScrDyn *get; /* owned +1 */
  ScrDyn *set; /* owned +1 */
} ScrExpSlot;

static ScrExpSlot *scr_exp_tab = NULL;
static size_t scr_exp_cap = 0; /* power of two, 0 = unallocated */
static size_t scr_exp_len = 0;

static size_t scr_exp_hash(const ScrClosure *c, const char *key, size_t key_len) {
  /* The closure pointer through the ctor table's Fibonacci mix, then the
   * key bytes folded in: two members of ONE function must land in
   * different buckets or every read walks the whole probe run. */
  uint64_t h = (uint64_t)(uintptr_t)c;
  h *= 0x9e3779b97f4a7c15ULL;
  for (size_t i = 0; i < key_len; i++) {
    h ^= (unsigned char)key[i];
    h *= 0x100000001b3ULL;
  }
  return (size_t)(h >> 32);
}

static void scr_exp_place(ScrExpSlot *tab, size_t cap, ScrExpSlot s) {
  size_t i = scr_exp_hash(s.clo, s.key, s.key_len) & (cap - 1);
  while (tab[i].clo != NULL) i = (i + 1) & (cap - 1);
  tab[i] = s;
}

/* At exit: drop the two accessor boxes per entry (the closure key is
 * borrowed, the key string is ours) and free the bucket array. Registered
 * through scr_atexit, which is LIFO against scr_init's three — so this
 * runs BEFORE the cycle collection and the RC audit, and a bound program
 * audits exactly like an unbound one. */
static void scr_exp_teardown(void) {
  for (size_t i = 0; i < scr_exp_cap; i++) {
    if (scr_exp_tab[i].clo == NULL) continue;
    free(scr_exp_tab[i].key);
    scr_dyn_release(scr_exp_tab[i].get);
    scr_dyn_release(scr_exp_tab[i].set);
  }
  free(scr_exp_tab);
  scr_exp_tab = NULL;
  scr_exp_cap = 0;
  scr_exp_len = 0;
}

static void scr_exp_grow(void) {
  if (scr_exp_cap == 0) scr_atexit(scr_exp_teardown);
  size_t cap = scr_exp_cap ? scr_exp_cap * 2 : 16;
  ScrExpSlot *tab = calloc(cap, sizeof *tab);
  if (!tab) scr_json_oom();
  for (size_t i = 0; i < scr_exp_cap; i++) {
    if (scr_exp_tab[i].clo != NULL) scr_exp_place(tab, cap, scr_exp_tab[i]);
  }
  free(scr_exp_tab);
  scr_exp_tab = tab;
  scr_exp_cap = cap;
}

static ScrExpSlot *scr_exp_find(const ScrClosure *clo, const char *key, size_t key_len) {
  if (scr_exp_cap == 0) return NULL;
  size_t i = scr_exp_hash(clo, key, key_len) & (scr_exp_cap - 1);
  for (size_t steps = 0; steps < scr_exp_cap; steps++) {
    if (scr_exp_tab[i].clo == NULL) return NULL;
    if (scr_exp_tab[i].clo == clo && scr_exp_tab[i].key_len == key_len &&
        memcmp(scr_exp_tab[i].key, key, key_len) == 0) {
      return &scr_exp_tab[i];
    }
    i = (i + 1) & (scr_exp_cap - 1);
  }
  return NULL;
}

void scr_dyn_expando_bind(ScrDyn *fn, ScrStr *key, ScrDyn *get, ScrDyn *set) {
  if (fn->kind != SCR_DYN_FUNC) return; /* unreachable from the emitted call */
  const char *kd = key->data;
  size_t kl = key->len;
  ScrClosure *clo = fn->v.fn.clo;
  ScrExpSlot *existing = scr_exp_find(clo, kd, kl);
  if (existing != NULL) {
    /* Re-binding one member is a module %init that ran twice; the run-once
     * guard makes that impossible, but keeping the FIRST pair costs a
     * branch and removes a leak from the answer. */
    return;
  }
  if ((scr_exp_len + 1) * 4 >= scr_exp_cap * 3) scr_exp_grow();
  char *copy = malloc(kl + 1);
  if (!copy) scr_json_oom();
  memcpy(copy, kd, kl);
  copy[kl] = '\0';
  ScrExpSlot s = {clo, copy, kl, scr_dyn_retain(get), scr_dyn_retain(set)};
  scr_exp_place(scr_exp_tab, scr_exp_cap, s);
  scr_exp_len++;
}

bool scr_dyn_expando_get(const ScrClosure *clo, const char *key, size_t key_len, ScrDyn **out) {
  ScrExpSlot *s = scr_exp_find(clo, key, key_len);
  if (s == NULL) return false;
  /* The answer is reported through `out` and the RETURN says only whether
   * an accessor existed. A bool "did the getter run" cannot be recovered
   * from the result: NULL-with-an-exception is what a throwing accessor
   * answers, and `scr_dyn_fn_get`'s caller may already have had one
   * pending — reading scr_exc_pending() to tell those apart would make an
   * unrelated in-flight throw silently swallow `name`/`length`. */
  *out = scr_dyn_call(s->get, NULL, 0, "expando getter"); /* +1, may throw */
  return true;
}

bool scr_dyn_expando_set(ScrClosure *clo, const char *key, size_t key_len, ScrDyn *value) {
  ScrExpSlot *s = scr_exp_find(clo, key, key_len);
  if (s == NULL) return false;
  ScrDyn *args[1] = {value};
  ScrDyn *r = scr_dyn_call(s->set, args, 1, "expando setter"); /* +1, may throw */
  scr_dyn_release(r);
  return true;
}

/* Keyed read on a FUNC node (see scr_runtime.h): own props first, then
 * the lifted-member accessors, then the function-instance built-ins
 * name/length. +1 or NULL. */
ScrDyn *scr_dyn_fn_get(const ScrDyn *d, const char *key, size_t key_len) {
  if (d->v.fn.clo->props) {
    ScrDyn *table = (ScrDyn *)scr_box_get_ref(d->v.fn.clo->props); /* +1 */
    ScrDyn *m = table ? scr_dyn_obj_get(table, key, key_len) : NULL;
    ScrDyn *r = m ? scr_dyn_retain(m) : NULL;
    scr_dyn_release(table);
    if (r) return r;
  }
  /* The LIFTED members. After the table so a `defineProperty` write still
   * shadows (the table is where every OTHER member of a function value
   * lives), before name/length so a member spelled `name` cannot be eaten
   * by the built-in — the compiler fences that write anyway. */
  {
    ScrDyn *lifted = NULL; /* +1 when an accessor answered */
    if (scr_dyn_expando_get(d->v.fn.clo, key, key_len, &lifted)) return lifted;
  }
  if (key_len == 4 && memcmp(key, "name", 4) == 0) {
    const char *n = scr_dyn_fn_name(d) ? scr_dyn_fn_name(d) : "";
    ScrStr *s = scr_str_new(n, strlen(n));
    ScrDyn *r = scr_dyn_new_str(s); /* retains */
    scr_str_release(s);
    return r;
  }
  if (key_len == 6 && memcmp(key, "length", 6) == 0) {
    return scr_dyn_new_num((double)d->v.fn.arity);
  }
  /* `Uint8Array.BYTES_PER_ELEMENT`. Answered off the BOX rather than out
   * of the property table because a FUNC box's table has no
   * non-enumerable half: a table entry would put the key into
   * `Object.keys(Uint8Array)`, where Node answers []. */
  if (key_len == 17 && memcmp(key, "BYTES_PER_ELEMENT", 17) == 0 && scr_u8_is_ctor(d)) {
    return scr_dyn_new_num(1);
  }
  /* `Uint8Array.from` and `Uint8Array.of`. Off the BOX for the same
   * reason BYTES_PER_ELEMENT is, and for a second one Node states
   * itself: both are INHERITED from %TypedArray%, so `Object.hasOwn(
   * Uint8Array, "from")` is FALSE there and a table entry would make it
   * true. One box each for the process, so `Uint8Array.from ===
   * Uint8Array.from` is JS identity. */
  if (scr_u8_is_ctor(d)) {
    ScrDyn *st = scr_u8_static_member(key, key_len); /* +1, or NULL */
    if (st != NULL) return st;
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
    /* TRACED: the table can hold a function value that captures the very
     * closure this table belongs to (`Foo.create = () => new Foo()`), which
     * is a ring, and scr_closure_trace visits this box for exactly that
     * reason. Safe because ScrDyn carries a header of its own. */
    ScrBox *box = scr_box_new_obj(&scr_dyn_retain_v, &scr_dyn_release_v, &scr_dyn_trace_v);
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
  scr_dyn_ext_w(proto)->cname = scr_dyn_fn_name(fn);
  scr_dyn_obj_set(table, "prototype", 9, scr_dyn_retain(proto)); /* table owns one */
  scr_dyn_release(table);
  /* Register the `constructor` answer (see the registry's header). The
   * CLOSURE takes its own +1 on the prototype so the registry's key can
   * never be freed or its address recycled underneath the entry, and the
   * teardown hook that drops both is installed here — it can only be
   * reached by a closure that got this far. */
  ScrClosure *clo = fn->v.fn.clo;
  if (clo->implicit_proto == NULL) {
    if (scr_ctor_len * 2 >= scr_ctor_cap) scr_ctor_grow();
    ScrCtorDesc d = {clo, fn->v.fn.thunk, scr_dyn_fn_sig(fn), scr_dyn_fn_name(fn), scr_dyn_fn_src(fn),
                     fn->v.fn.arity};
    scr_ctor_insert(scr_ctor_tab, scr_ctor_cap, proto, d);
    scr_ctor_len++;
    clo->implicit_proto = scr_dyn_retain(proto);
    scr_closure_ctor_unlink = &scr_dyn_ctor_unlink;
  }
  return proto; /* the caller's +1 */
}

/* Is this dyn value an OBJECT to JavaScript? DERIVED from the typeof
 * table rather than spelled as a second list of scalar kinds, and the
 * derivation is the point: an Object is exactly a value whose typeof is
 * "object" or "function", minus JS's null wart. Written as its own list
 * this was the THIRD copy of "which kinds are primitive" in the file,
 * and the only one whose default answered TRUE — so a newly added scalar
 * kind did not merely miss an arm here, it was actively classified as an
 * Object. SCR_DYN_BIG is what proved it: `5n instanceof F` must be false
 * at step 3 of OrdinaryHasInstance BEFORE the step-4 throw for a
 * non-object prototype, and an Object-classified bigint reversed those
 * two and threw where Node answers false.
 *
 * `instanceof` asks the question three times, in three different places,
 * and gets a different wrong answer each time if it guesses. */
static bool scr_dyn_is_object_kind(const ScrDyn *d) {
  /* typeof null is "object" and Type(null) is Null — the one row where
   * the derivation cannot follow typeof. */
  if (d->kind == SCR_DYN_NULL) return false;
  /* An island value is an engine OBJECT by construction: the wrapping
   * constructor scalar-normalizes every primitive away, which is also
   * why JSVAL is absent from the typeof table below. */
  if (d->kind == SCR_DYN_JSVAL) return true;
  const char *t = scr_dyn_typeof_native(d);
  return t[0] == 'o' || t[0] == 'f'; /* "object" | "function" */
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
  const ScrDyn *p = v->kind == SCR_DYN_OBJ ? scr_dyn_ext(v)->proto : NULL;
  for (size_t steps = 0; p != NULL && steps < SCR_PROTO_MAX_DEPTH; steps++) {
    if (p == proto) { found = true; break; }
    if (p->kind != SCR_DYN_OBJ) break;
    p = scr_dyn_ext(p)->proto;
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
  scr_dyn_obj_set_ctor_name(o, scr_dyn_ext(proto)->cname);
  return o;
}

/* ToIntegerOrInfinity over an OPTIONAL index argument: missing or
 * undefined answers dflt; a NUM truncates toward zero (NaN -> 0, like
 * JS); any other kind throws the loud fence (Node would ToNumber-coerce
 * — a documented gap, never a silent misread).
 *
 * The ONE body, here rather than in scr_dyn_invoke.c, because the
 * typed-array dispatch below is shared with that unit and an OPTIONAL
 * unit cannot be called from this always-linked one. */
double scr_dyn_index_arg(ScrDyn *const *args, size_t argc, size_t i, double dflt,
                         const char *what) {
  if (i >= argc || args[i]->kind == SCR_DYN_UNDEF) return dflt;
  if (args[i]->kind == SCR_DYN_NUM) {
    double n = args[i]->v.num;
    if (n != n) return 0;
    return trunc(n);
  }
  ScrJsonBuf b;
  scr_jb_init(&b);
  scr_jb_puts(&b, what);
  scr_jb_puts(&b, ": non-number index arguments on a dynamic receiver are not supported yet");
  scr_throw_error(SCR_ERR_TYPE, scr_jb_finish(&b));
  return 0;
}

/* Names Uint8Array.prototype and %TypedArray%.prototype declare BEYOND
 * what scr_dyn_bytes_method implements — these fence loudly instead of
 * mis-answering Node's is-not-a-function for a method Node HAS. */
static bool scr_dyn_bytes_proto_name(const char *m) {
  static const char *names[] = { "slice", "at", "indexOf", "lastIndexOf", "includes", "join",
    "forEach", "map", "filter", "some", "every", "find", "findIndex", "findLast",
    "findLastIndex", "reverse", "fill", "set", "subarray", "sort", "keys", "values", "entries",
    "reduce", "reduceRight", "copyWithin", "toReversed", "toSorted", "with", "toString",
    "toLocaleString", "toBase64", "setFromBase64", "toHex", "setFromHex", NULL };
  for (size_t i = 0; names[i]; i++) if (strcmp(m, names[i]) == 0) return true;
  return false;
}

/* `new Uint8Array(v)` where v is a CHECKED-DYNAMIC value: the runtime tag
 * dispatch the constructor's own overload set is, and the one the frontend
 * cannot make because only the runtime knows the kind.
 *
 * protobufjs's util.newBuffer is the site that needs it:
 *
 *   return "number"==typeof e ? (t.Buffer?t._Buffer_allocUnsafe(e):new t.Array(e))
 *                             : (t.Buffer?t._Buffer_from(e):new Uint8Array(e))
 *
 * The `typeof e === "number"` test has already been taken the OTHER way on
 * the branch that reaches here, so `e` is array-like and Node COPIES it.
 * Coercing the operand to a LENGTH instead would make every protobuf
 * `bytes` field decode as an empty buffer, which is why this dispatches
 * rather than picking one overload.
 *
 * NUM is Node's length form (ToIndex, with Node's RangeError); BYTES is
 * the element copy -- CROSS-kind, unlike the static spelling, because a
 * runtime value carries no static elem to match against; ARR reads each
 * element through ToNumber, exactly scr_bytes_from_arr; and every other
 * kind is Node's ToObject-with-no-length, which is the EMPTY array. NULL
 * with the exception pending only on the length form's RangeError.
 * Borrows d; returns +1. */
ScrBytes *scr_bytes_from_dyn(ScrBytesElem elem, const ScrDyn *d) {
  if (d->kind == SCR_DYN_NUM) return scr_bytes_new(elem, d->v.num); /* may throw */
  if (d->kind == SCR_DYN_BYTES || d->kind == SCR_DYN_ARRBUF) {
    const ScrBytes *src = d->v.bytes;
    /* Same element kind: the byte-for-byte copy, which is what Node's
     * typed-array copy constructor is. The copy takes the CONSTRUCTOR's
     * flavor, not the source's (scr_bytes_copy keeps the source's, so the
     * plain mark rides at the call site exactly as the static spelling's
     * markFlavor does). */
    if (src->elem == elem) return scr_bytes_copy(src);
    /* Cross-kind, and the ONLY source width the checked-dynamic tree
     * carries is u8 (Buffer / Uint8Array): read each ELEMENT and store it
     * through the destination's own conversion, which is Node's
     * %TypedArray%(typedArray). Anything else is unmeasured and stays a
     * LOUD refusal rather than a guess. */
    if (src->elem != SCR_BYTES_U8) {
      scr_throw_error_msg(SCR_ERR_ERROR,
                          "cross-kind typed-array construction over a dynamic value is not supported yet",
                          strlen("cross-kind typed-array construction over a dynamic value is not supported yet"));
      return NULL;
    }
    ScrBytes *b = scr_bytes_new(elem, (double)src->len);
    if (b == NULL) return NULL;
    for (size_t i = 0; i < src->len; i++) scr_bytes_set(b, (double)i, (double)src->data[i]);
    return b;
  }
  if (d->kind == SCR_DYN_ARR) {
    size_t n = d->v.arr.len;
    ScrBytes *b = scr_bytes_new(elem, (double)n);
    if (b == NULL) return NULL;
    for (size_t i = 0; i < n; i++) {
      double v = scr_dyn_to_number(d->v.arr.items[i]);
      if (scr_exc_pending()) { scr_bytes_release(b); return NULL; }
      scr_bytes_set(b, (double)i, v);
    }
    return b;
  }
  /* PRIMITIVES are not objects, so Node's constructor never takes the
   * array-like path for them: it takes ToIndex(ToNumber(v)). MEASURED
   * against Node v25.9.0 rather than assumed, because the difference is
   * invisible for three of the four spellings and decides the fourth:
   *   new Uint8Array(undefined) -> length 0   (ToNumber NaN -> ToIndex 0)
   *   new Uint8Array(null)      -> length 0
   *   new Uint8Array("hi")      -> length 0   (NaN again)
   *   new Uint8Array("3")       -> length 3   <- and this one
   *   new Uint8Array(true)      -> length 1   <- and this one
   * An "everything else is empty" rule gets the first three right and
   * both of the last two wrong; the corpus fixture's `boolean` row is
   * what caught it. */
  if (d->kind == SCR_DYN_UNDEF || d->kind == SCR_DYN_NULL ||
      d->kind == SCR_DYN_BOOL || d->kind == SCR_DYN_STR) {
    double n = scr_dyn_to_number(d);
    if (scr_exc_pending()) return NULL;
    return scr_bytes_new(elem, n); /* may throw Node's RangeError */
  }
  /* Every remaining kind IS an object. Without a `length` property Node's
   * ToObject-with-no-length answers the EMPTY typed array; WITH one it is
   * an array-like whose indexed reads this tier has not measured, so that
   * shape keeps a loud refusal rather than a guess. */
  if (d->kind == SCR_DYN_OBJ && scr_dyn_obj_get(d, "length", 6) != NULL) {
    scr_throw_error_msg(SCR_ERR_ERROR,
                        "new Uint8Array over an array-LIKE object (a 'length' property with indexed reads) is not supported yet",
                        strlen("new Uint8Array over an array-LIKE object (a 'length' property with indexed reads) is not supported yet"));
    return NULL;
  }
  return scr_bytes_new(elem, 0);
}

/* The runtime twin of the frontend's literal-encoding fold
 * (BUF_ENCODINGS, lower-containers.ts) for a RUNTIME-valued encoding:
 * canonicalizes, or throws Node's ERR_UNKNOWN_ENCODING TypeError. The
 * same table scr_stream.c's scr_stream_dynopt_encoding carries — it is
 * static there and this unit is always linked while that one is not, so
 * the copy is deliberate; the two must stay in step with the frontend's
 * table, which is the single source both mirror. Returns +1, or NULL with
 * the exception pending. */
static ScrStr *scr_dyn_bytes_enc_canon(const ScrStr *raw) {
  static const struct { const char *from; const char *to; } map[] = {
    {"utf8", "utf8"}, {"utf-8", "utf8"}, {"hex", "hex"}, {"base64", "base64"},
    {"base64url", "base64url"}, {"latin1", "latin1"}, {"binary", "latin1"},
    {"ascii", "ascii"}, {"utf16le", "utf16le"}, {"utf-16le", "utf16le"},
    {"ucs2", "utf16le"}, {"ucs-2", "utf16le"},
  };
  for (size_t i = 0; i < sizeof map / sizeof map[0]; i++) {
    size_t n = strlen(map[i].from);
    if (raw->len == n && memcmp(raw->data, map[i].from, n) == 0) {
      return scr_str_new(map[i].to, strlen(map[i].to));
    }
  }
  char msg[128];
  int len = snprintf(msg, sizeof msg, "Unknown encoding: %.*s",
                     (int)(raw->len < 64 ? raw->len : 64), raw->data);
  scr_throw_error_msg_code(SCR_ERR_TYPE, msg, (size_t)(len < 0 ? 0 : len), "ERR_UNKNOWN_ENCODING");
  return NULL;
}

/* Every typed-array METHOD, over a BYTES receiver — the ONE body, and
 * the reason it lives in this unit rather than in scr_dyn_invoke.c: the
 * %TypedArray%.prototype thunks below are reachable from an
 * always-linked object, and an edge into an OPTIONAL unit would drag
 * scr_dyn_invoke.c into every binary that has a dyn keyed read.
 *
 * `b.m(...)` (scr_dyn_invoke's BYTES arm) and
 * `Uint8Array.prototype.m.call(b, ...)` both land here, so the two
 * spellings cannot answer differently. `*known` reports whether the name
 * is a method of this kind at ALL — false leaves the caller its own
 * is-not-a-function answer, which is JS's for a name no prototype
 * declares. */
ScrDyn *scr_dyn_bytes_method(ScrDyn *recv, const char *method, ScrDyn *const *args,
                             size_t argc, const char *what, bool *known) {
  ScrBytes *bytes = recv->v.bytes;
  size_t blen = bytes->len;
  *known = true;
  if (strcmp(method, "at") == 0) {
    double iD = scr_dyn_index_arg(args, argc, 0, 0, what);
    if (scr_exc_pending()) return NULL;
    double idx = iD < 0 ? (double)blen + iD : iD;
    if (idx < 0 || idx >= (double)blen) return scr_dyn_retain(scr_dyn_undefined());
    return scr_dyn_new_num((double)bytes->data[(size_t)idx]);
  }
  if (strcmp(method, "slice") == 0 || strcmp(method, "subarray") == 0) {
    /* slice COPIES and subarray is a VIEW — JS's own split, and the one
     * the STATIC spelling has always taken (scr_bytes_subarray, chain
     * depth 1). The dyn arm used to copy for BOTH, so
     * `q.v.subarray(2, 4)[0] = 77` was lost while `b.subarray(2, 4)[0] =
     * 77` landed: one silent wrong answer per spelling, from the same
     * source text. Both results keep the receiver's Buffer flavor
     * (Buffer sets no Symbol.species, so a Buffer's slice IS a Buffer,
     * verified against Node both ways). */
    double startD = scr_dyn_index_arg(args, argc, 0, 0, what);
    if (scr_exc_pending()) return NULL;
    double endD = scr_dyn_index_arg(args, argc, 1, (double)blen, what);
    if (scr_exc_pending()) return NULL;
    if (method[0] == 's' && method[1] == 'u') {
      ScrBytes *view = scr_bytes_subarray(bytes, startD, endD); /* +1, aliasing */
      ScrDyn *d = scr_dyn_new_bytes_ref(view);                  /* +1 on view */
      d->buffer = recv->buffer;
      scr_bytes_release(view);
      return d;
    }
    ScrBytes *out = scr_bytes_slice(bytes, startD, endD);
    ScrDyn *d = recv->buffer ? scr_dyn_new_buffer_copy(out) : scr_dyn_new_bytes_copy(out);
    scr_bytes_release(out);
    return d;
  }
  if (strcmp(method, "set") == 0 && bytes->elem != SCR_BYTES_BUF) {
    /* %TypedArray%.prototype.set(source[, offset]) — the BULK WRITE, and
     * the one protobufjs's Writer cannot do without: its `writeBytes`
     * chunk is literally `function (val, buf, pos) { buf.set(val, pos); }`,
     * run once per bytes field, so every `encode` of a message carrying
     * bytes lands here. Nothing else in the typed-array surface copies a
     * whole run in.
     *
     * ES 23.2.3.26 in the two shapes that exist here: a TYPED-ARRAY
     * source, and an ARRAY-LIKE one (which for this tier means a dyn
     * array — the only other indexable dyn kind). Both take the same
     * bounds rule, and it is a RangeError BEFORE any element moves, so a
     * short target is never left half-written.
     *
     * An ArrayBuffer receiver is excluded above rather than handled: it
     * declares no `set` in Node either, so it keeps the loud refusal
     * below instead of silently gaining a method. */
    double offD = scr_dyn_index_arg(args, argc, 1, 0, what);
    if (scr_exc_pending()) return NULL;
    ScrDyn *src = argc > 0 ? args[0] : scr_dyn_undefined(); /* borrowed */
    bool srcIsBytes = src->kind == SCR_DYN_BYTES && src->v.bytes->elem != SCR_BYTES_BUF;
    bool srcIsArr = src->kind == SCR_DYN_ARR;
    if (srcIsBytes || srcIsArr) {
      double srcLen = srcIsBytes ? (double)src->v.bytes->len : scr_dyn_arr_len(src);
      /* Node checks the offset and the fit together, and reports both as
       * "offset is out of bounds" — a negative offset included. */
      if (offD < 0 || srcLen + offD > (double)blen) {
        scr_throw_error_msg(SCR_ERR_RANGE, "offset is out of bounds", 23);
        return NULL;
      }
      size_t off = (size_t)offD;
      size_t n = (size_t)srcLen;
      if (srcIsBytes && src->v.bytes->elem == bytes->elem) {
        /* Same element type: a byte move, and memmove rather than memcpy
         * because ES clones an overlapping source first — `b.set(b.subarray(1))`
         * has to read what was there, not what this loop just wrote. */
        size_t esz = scr_bytes_elem_size(bytes->elem);
        if (n > 0) memmove(bytes->data + off * esz, src->v.bytes->data, n * esz);
      } else if (srcIsBytes) {
        /* Different element types over possibly the SAME buffer: read the
         * whole source out before writing anything, for the same reason. */
        double *tmp = n > 0 ? (double *)malloc(n * sizeof(double)) : NULL;
        if (n > 0 && tmp == NULL) scr_json_oom();
        for (size_t i = 0; i < n; i++) tmp[i] = scr_bytes_get(src->v.bytes, (double)i);
        for (size_t i = 0; i < n; i++) scr_bytes_set(bytes, (double)(off + i), tmp[i]);
        free(tmp);
      } else {
        /* An array source cannot alias the target's storage, so it reads
         * and writes in one pass. Each element takes ToNumber, which is
         * what makes `set(["1", null, undefined])` write 1, 0, 0. */
        for (size_t i = 0; i < n; i++) {
          ScrDyn *e = scr_dyn_arr_at(src, (double)i); /* +1 */
          double v = scr_dyn_to_number(e);
          scr_dyn_release(e);
          scr_bytes_set(bytes, (double)(off + i), v);
          if (scr_exc_pending()) return NULL;
        }
      }
      return scr_dyn_retain(scr_dyn_undefined());
    }
    /* Every other source kind (undefined, null, a plain object with a
     * `length`, a string) falls through to the refusal below rather than
     * guessing: Node converts them through ToObject and reads a `length`
     * property, and answering that from here would be a shape claim this
     * tier has not measured. */
  }
  if (strcmp(method, "toString") == 0) {
    /* A dyn receiver reaching `toString(enc)` through the METHOD spelling
     * — the frontend routes here when the argument is not a literal
     * encoding, because the same call on a NUM or OBJ receiver is a radix
     * or a user toString and only the runtime knows which. Without this
     * arm the name fell into the proto_name fence below, which would have
     * relocated the frontend's compile-time refusal into a runtime one
     * rather than answering.
     *
     * Buffer decodes; a PLAIN Uint8Array inherits Array.prototype
     * .toString (the element join), which takes no encoding at all —
     * scr_dyn_to_string already spells that split and is reused so the
     * two cannot drift. */
    if (!recv->buffer) {
      ScrStr *s = scr_dyn_to_string(recv, NULL);
      if (scr_exc_pending()) { if (s) scr_str_release(s); return NULL; }
      ScrDyn *d = scr_dyn_new_str(s);
      scr_str_release(s);
      return d;
    }
    ScrStr *enc = NULL;
    if (argc >= 1 && args[0]->kind != SCR_DYN_UNDEF) {
      /* Node ToString's the argument and then validates it. */
      ScrStr *raw = scr_dyn_to_string(args[0], NULL);
      if (scr_exc_pending()) { if (raw) scr_str_release(raw); return NULL; }
      enc = scr_dyn_bytes_enc_canon(raw);
      scr_str_release(raw);
      if (enc == NULL) return NULL; /* ERR_UNKNOWN_ENCODING pending */
    }
    ScrStr *s;
    if (argc >= 2) {
      double st = scr_dyn_index_arg(args, argc, 1, 0, what);
      if (scr_exc_pending()) { if (enc) scr_str_release(enc); return NULL; }
      double en = scr_dyn_index_arg(args, argc, 2, (double)blen, what);
      if (scr_exc_pending()) { if (enc) scr_str_release(enc); return NULL; }
      s = scr_bytes_to_str_range(bytes, enc, st, en);
    } else {
      s = scr_bytes_to_str(bytes, enc);
    }
    if (enc) scr_str_release(enc);
    if (scr_exc_pending()) { if (s) scr_str_release(s); return NULL; }
    ScrDyn *d = scr_dyn_new_str(s);
    scr_str_release(s);
    return d;
  }
  if (scr_dyn_bytes_proto_name(method)) {
    ScrJsonBuf b;
    scr_jb_init(&b);
    scr_jb_puts(&b, "'Uint8Array.prototype.");
    scr_jb_puts(&b, method);
    scr_jb_puts(&b, "' on a dynamic value is not supported yet");
    scr_throw_error(SCR_ERR_ERROR, scr_jb_finish(&b));
    return NULL;
  }
  *known = false;
  return NULL;
}

/* ── %Uint8Array%, %Uint8Array.prototype% and %TypedArray%.prototype ───
 *
 * `Uint8Array` in a VALUE position. It used to be the identifier
 * chokepoint's opaque IDENTITY TOKEN — the interned string "[builtin
 * Uint8Array]" — and a string has no `prototype`, so the read answered
 * `undefined` with no diagnostic at all. protobufjs stores the
 * constructor in a property and then reads THROUGH it, at module init,
 * in both halves of the codec:
 *
 *     util.Array = typeof Uint8Array !== "undefined" ? Uint8Array : Array;
 *     Writer.alloc = util.pool(Writer.alloc, util.Array.prototype.subarray);
 *     Reader.prototype._slice = util.Array.prototype.subarray
 *                            || util.Array.prototype.slice;
 *
 * By the time `.prototype` is asked for, `util.Array` is a RUNTIME dyn
 * value: no frontend lift can see the access, which is why this is a
 * value the runtime HOLDS rather than a lowered member like
 * `String.prototype.charCodeAt`.
 *
 * THREE process singletons, mirroring Node's own three objects, because
 * `===`, the [[Prototype]] chain and `Object.hasOwn` all read IDENTITY:
 *
 *   %Uint8Array%              a FUNC box — typeof "function", `name`
 *                             "Uint8Array", `length` 3, `prototype`
 *                             PINNED to the object below, and
 *                             Function.prototype.toString answering
 *                             Node's "function Uint8Array() { [native
 *                             code] }". Calling it WITHOUT `new` throws
 *                             Node's "Constructor Uint8Array requires
 *                             'new'"; `new` is routed by pointer
 *                             identity in scr_dyn_construct.
 *   %Uint8Array.prototype%    Node's OWN members and no others:
 *                             `constructor`, `BYTES_PER_ELEMENT` 1, and
 *                             the four base64/hex methods v25 added.
 *   %TypedArray%.prototype    where every other METHOD actually lives,
 *                             reached by delegation.
 *
 * The split is not decoration. `Object.hasOwn(Uint8Array.prototype,
 * "subarray")` is FALSE in Node while `"subarray" in Uint8Array
 * .prototype` is true, and one flat object would have to answer one of
 * those two wrongly.
 *
 * Every method is ONE generic thunk: it takes its receiver from the
 * ambient-receiver window (which `f.call(recv, …)` opens — scr_dyn_invoke
 * .c's FUNC arm) and forwards to `scr_dyn_invoke`, the very dispatch the
 * ordinary `b.m(…)` spelling lands on. So `Uint8Array.prototype.subarray
 * .call(b, 1, 3)` and `b.subarray(1, 3)` cannot drift: the implemented
 * names do the same work, and the ones this runtime does not implement
 * raise the same loud "Uint8Array.<m> is not supported yet" they already
 * raise in call position — a member Node HAS answers a function here
 * too, and the refusal happens where the work would.
 *
 * REFCOUNTS, by hand. Unlike %Error.prototype%, this graph has a CYCLE:
 * `%Uint8Array.prototype%.constructor` points at the FUNC box and the
 * box's own-property table points back at the prototype. Both nodes are
 * immortal for the process, so the cycle costs nothing while running;
 * the teardown DROPS the back-link first so the two really die instead
 * of merely becoming unreachable. Each method and accessor box is a
 * ZERO-capture closure, so none of them holds a reference back to the
 * object it is defined on. */
static ScrDyn *scr_u8_ctor;    /* %Uint8Array% */
static ScrDyn *scr_u8_proto;   /* %Uint8Array.prototype% */
static ScrDyn *scr_ta_proto;   /* %TypedArray%.prototype */
static ScrDyn *scr_u8_from_fn; /* %TypedArray%.from — see below */
static ScrDyn *scr_u8_of_fn;   /* %TypedArray%.of   — see below */

static void scr_u8_teardown(void) {
  if (scr_u8_proto != NULL) scr_dyn_obj_drop_hidden(scr_u8_proto, "constructor", 11);
  /* The two statics hang off nothing but these two roots (they are
   * answered off the BOX, never stored in its property table), so
   * releasing them here is the whole of their teardown — no cycle to
   * break, unlike the prototype's `constructor` back-link above. */
  scr_dyn_release(scr_u8_from_fn);
  scr_u8_from_fn = NULL;
  scr_dyn_release(scr_u8_of_fn);
  scr_u8_of_fn = NULL;
  scr_dyn_release(scr_u8_ctor);
  scr_u8_ctor = NULL;
  scr_dyn_release(scr_u8_proto);
  scr_u8_proto = NULL;
  scr_dyn_release(scr_ta_proto);
  scr_ta_proto = NULL;
}

/* Node spells the offending receiver into the message. Two renderings,
 * both V8's and both verified against v25: the METHOD form says
 * `#<Object>` for a plain object, the ACCESSOR form says `[object
 * Object]`, and both spell the scalars with the plain string coercion
 * (`undefined`, `null`, `5`, `ab`, a function's source). Only the
 * coercions that CANNOT throw are taken — a receiver's own valueOf must
 * not run while an exception is being built. */
static void scr_u8_put_recv(ScrJsonBuf *b, const ScrDyn *self, bool accessor) {
  switch (self->kind) {
  case SCR_DYN_UNDEF:
    scr_jb_puts(b, "undefined");
    return;
  case SCR_DYN_NULL:
    scr_jb_puts(b, "null");
    return;
  case SCR_DYN_ARR:
    scr_jb_puts(b, "[object Array]");
    return;
  case SCR_DYN_NUM:
  case SCR_DYN_BOOL:
  case SCR_DYN_STR:
  case SCR_DYN_BIG: /* measured: "incompatible receiver 5", the digits */
  case SCR_DYN_FUNC: {
    ScrStr *s = scr_dyn_string_coerce_js(self); /* +1; never throws for these */
    if (s == NULL) break;
    scr_jb_write(b, s->data, s->len);
    scr_str_release(s);
    return;
  }
  default:
    break;
  }
  scr_jb_puts(b, accessor ? "[object Object]" : "#<Object>");
}

/* The one method body. `this` comes from the ambient-receiver window,
 * resolved per call — a detached method remembers no receiver, exactly
 * as in Node, where `Uint8Array.prototype.subarray` and `b.subarray` are
 * the same function object and neither is bound. */
static ScrDyn *scr_u8_proto_forward(const char *method, ScrDyn *const *args, size_t argc) {
  ScrDyn *self = scr_dyn_this_get(); /* +1; the undefined singleton with no binding */
  if (self->kind != SCR_DYN_BYTES) {
    ScrJsonBuf b;
    scr_jb_init(&b);
    scr_jb_puts(&b, "Method %TypedArray%.prototype.");
    scr_jb_puts(&b, method);
    scr_jb_puts(&b, " called on incompatible receiver ");
    scr_u8_put_recv(&b, self, false);
    scr_dyn_release(self);
    scr_throw_error(SCR_ERR_TYPE, scr_jb_finish(&b));
    return NULL;
  }
  bool known = false;
  ScrDyn *r = scr_dyn_bytes_method(self, method, args, argc, method, &known);
  scr_dyn_release(self);
  if (known) return r; /* +1, or NULL with the exception pending */
  /* A name %TypedArray%.prototype declares that scr_dyn_bytes_method
   * does not know at all cannot reach here — the two lists are the same
   * list. Kept as a real answer rather than an assert so a future member
   * added to one and not the other refuses loudly. */
  {
    ScrJsonBuf b;
    scr_jb_init(&b);
    scr_jb_puts(&b, "'Uint8Array.prototype.");
    scr_jb_puts(&b, method);
    scr_jb_puts(&b, "' on a dynamic value is not supported yet");
    scr_throw_error(SCR_ERR_ERROR, scr_jb_finish(&b));
  }
  return NULL;
}

/* The names %TypedArray%.prototype declares, with Node's arity for each
 * (`Uint8Array.prototype.subarray.length` is 2), and the four v25 added
 * to Uint8Array.prototype itself. Implemented-ness is NOT this list's
 * business — scr_dyn_invoke owns that, and owning it in one place is
 * what keeps the two spellings from disagreeing. */
#define SCR_TA_PROTO_METHODS(X)                                                             \
  X(entries, 0) X(keys, 0) X(values, 0) X(at, 1) X(copyWithin, 2) X(every, 1) X(fill, 1)    \
  X(filter, 1) X(find, 1) X(findIndex, 1) X(findLast, 1) X(findLastIndex, 1)                \
  X(forEach, 1) X(includes, 1) X(indexOf, 1) X(join, 1) X(lastIndexOf, 1) X(map, 1)         \
  X(reverse, 0) X(reduce, 1) X(reduceRight, 1) X(set, 1) X(slice, 2) X(some, 1) X(sort, 1)  \
  X(subarray, 2) X(toReversed, 0) X(toSorted, 1) X(with, 2) X(toLocaleString, 0)            \
  X(toString, 0)
#define SCR_U8_PROTO_METHODS(X) X(toBase64, 0) X(setFromBase64, 1) X(toHex, 0) X(setFromHex, 1)

#define SCR_U8_THUNK(m, n)                                                         \
  static ScrDyn *scr_u8_m_##m(ScrClosure *clo, ScrDyn *const *args, size_t argc) { \
    (void)clo;                                                                     \
    return scr_u8_proto_forward(#m, args, argc);                                   \
  }
SCR_TA_PROTO_METHODS(SCR_U8_THUNK)
SCR_U8_PROTO_METHODS(SCR_U8_THUNK)
#undef SCR_U8_THUNK

/* The four ACCESSORS %TypedArray%.prototype declares. They matter for
 * the same reason the methods do: read off the PROTOTYPE — the only
 * receiver that can reach them here, since a typed array is a BYTES
 * value and walks no chain — Node THROWS, and a plain undefined would be
 * the silent kind of wrong. A BYTES receiver, which only an explicit
 * `.call` can supply, gets the real answer. */
static ScrDyn *scr_u8_accessor(const char *name, int which) {
  ScrDyn *self = scr_dyn_this_get(); /* +1 */
  if (self->kind != SCR_DYN_BYTES) {
    ScrJsonBuf b;
    scr_jb_init(&b);
    scr_jb_puts(&b, "Method get TypedArray.prototype.");
    scr_jb_puts(&b, name);
    scr_jb_puts(&b, " called on incompatible receiver ");
    scr_u8_put_recv(&b, self, true);
    scr_dyn_release(self);
    scr_throw_error(SCR_ERR_TYPE, scr_jb_finish(&b));
    return NULL;
  }
  ScrBytes *bytes = self->v.bytes;
  ScrDyn *r;
  switch (which) {
  case 0:
    r = scr_dyn_new_num((double)bytes->len);
    break;
  case 1:
    r = scr_dyn_new_num((double)(bytes->len * scr_bytes_elem_size(bytes->elem)));
    break;
  case 2:
    r = scr_dyn_new_num(scr_bytes_byte_offset(bytes));
    break;
  default:
    /* `.buffer`: there is no free-standing ArrayBuffer VALUE in a static
     * build — typed arrays own their storage — which is the refusal the
     * static spelling already gives, in the same words. */
    scr_dyn_release(self);
    {
      static const char msg[] =
          "reading 'buffer' off a typed array is not supported yet"
          " (no free-standing ArrayBuffer value exists here; typed arrays own their"
          " storage, and subarray() answers an aliasing view directly)";
      scr_throw_error_msg(SCR_ERR_ERROR, msg, sizeof msg - 1);
    }
    return NULL;
  }
  scr_dyn_release(self);
  return r;
}

#define SCR_U8_ACCESSOR(m, w)                                                      \
  static ScrDyn *scr_u8_g_##m(ScrClosure *clo, ScrDyn *const *args, size_t argc) { \
    (void)clo;                                                                     \
    (void)args;                                                                    \
    (void)argc;                                                                    \
    return scr_u8_accessor(#m, w);                                                 \
  }
SCR_U8_ACCESSOR(length, 0)
SCR_U8_ACCESSOR(byteLength, 1)
SCR_U8_ACCESSOR(byteOffset, 2)
SCR_U8_ACCESSOR(buffer, 3)
#undef SCR_U8_ACCESSOR

/* ── %TypedArray%.from and %TypedArray%.of ─────────────────────────────
 * The two STATIC methods on the constructor. protobufjs reads the first
 * one as a VALUE and never calls it —
 *
 *   util._Buffer_from = Buffer.from !== Uint8Array.from && Buffer.from || …
 *
 * — but a value that cannot be called is not a function, so both are
 * real: Node's names, Node's arities, Node's algorithm.
 *
 * They live on %TypedArray%, the constructor Uint8Array INHERITS from,
 * which is why they are answered off the box instead of out of its
 * property table (scr_dyn_fn_get): `Object.hasOwn(Uint8Array, "from")`
 * is false in Node, and `Object.getOwnPropertyNames(Uint8Array)` lists
 * length/name/prototype/BYTES_PER_ELEMENT/fromBase64/fromHex — not
 * these. One box each for the process, so `===` is identity. The two
 * boxes are declared with the other three singletons above, because the
 * teardown that releases them comes first in the file. */

/* `C = this`. Node builds the result through the RECEIVER constructor,
 * so a receiver that is not one throws before the source is even looked
 * at. Two V8 renderings, both verified against v25: a NON-callable
 * receiver is "<recv> is not a constructor" (`5`, `undefined`, `null`,
 * `[object Array]`, `#<Object>` — scr_u8_put_recv's spellings, which are
 * V8's), and a callable one that is not a typed-array constructor gets
 * past IsConstructor and fails inside TypedArrayCreate with "Method
 * %TypedArray%.<name> called on incompatible receiver #<F>". */
static bool scr_u8_static_recv(const char *name) {
  ScrDyn *self = scr_dyn_this_get(); /* +1; the undefined singleton with no binding */
  if (self == scr_u8_ctor) {
    scr_dyn_release(self);
    return true;
  }
  ScrJsonBuf b;
  scr_jb_init(&b);
  if (self->kind == SCR_DYN_FUNC) {
    scr_jb_puts(&b, "Method %TypedArray%.");
    scr_jb_puts(&b, name);
    scr_jb_puts(&b, " called on incompatible receiver #<");
    scr_jb_puts(&b, scr_dyn_fn_name(self) != NULL ? scr_dyn_fn_name(self) : "Function");
    scr_jb_puts(&b, ">");
  } else {
    scr_u8_put_recv(&b, self, false);
    scr_jb_puts(&b, " is not a constructor");
  }
  scr_dyn_release(self);
  scr_throw_error(SCR_ERR_TYPE, scr_jb_finish(&b));
  return false;
}

/* The mapfn that is present and not callable. V8 spells the value into
 * this one and spells it by TYPE: `number 5`, `string "x"`, `object
 * null`, and a bare `object` for everything else (it prints no value for
 * an ordinary object). */
static void scr_u8_throw_not_fn(const ScrDyn *f) {
  ScrJsonBuf b;
  scr_jb_init(&b);
  switch (f->kind) {
  case SCR_DYN_NULL:
    scr_jb_puts(&b, "object null");
    break;
  case SCR_DYN_NUM:
  case SCR_DYN_BOOL:
  case SCR_DYN_STR: {
    scr_jb_puts(&b, f->kind == SCR_DYN_NUM      ? "number "
                    : f->kind == SCR_DYN_BOOL   ? "boolean "
                                                : "string ");
    ScrStr *s = scr_dyn_string_coerce_js(f); /* +1; never throws for these */
    if (f->kind == SCR_DYN_STR) scr_jb_puts(&b, "\"");
    if (s != NULL) {
      scr_jb_write(&b, s->data, s->len);
      scr_str_release(s);
    }
    if (f->kind == SCR_DYN_STR) scr_jb_puts(&b, "\"");
    break;
  }
  case SCR_DYN_BIG:
    /* Measured against Node v25.9.0: `Uint8Array.from([1], 5n)` says
     * "bigint is not a function" — the bare TYPE word, where a number
     * gets "number 5" and a string gets 'string "x"'. Guessing the
     * symmetric "bigint 5n" would have been wrong. */
    scr_jb_puts(&b, "bigint");
    break;
  default:
    scr_jb_puts(&b, "object");
    break;
  }
  scr_jb_puts(&b, " is not a function");
  scr_throw_error(SCR_ERR_TYPE, scr_jb_finish(&b));
}

/* ToLength: NaN and anything <= 0 are 0, a fraction truncates. The upper
 * clamp is scr_bytes_new's RangeError, which is the one a real
 * allocation of that size would hit anyway. */
static double scr_u8_to_length(double n) {
  if (n != n || n <= 0) return 0;
  return floor(n);
}

/* Is `d` a source %TypedArray%.from can read exactly here? The four
 * kinds with a real answer are ARR, BYTES, STR (iterated by CODE POINT,
 * like Node) and the array-like walk over OBJ/FUNC; NUM and BOOL have no
 * `length` at all and are Node's empty result. A handle, a promise or an
 * engine value could be iterable in Node and is not readable here, so it
 * refuses by name rather than answering an empty typed array. */
static bool scr_u8_from_source_ok(const ScrDyn *d) {
  switch (d->kind) {
  case SCR_DYN_ARR:
  case SCR_DYN_BYTES:
  case SCR_DYN_STR:
  case SCR_DYN_OBJ:
  case SCR_DYN_FUNC:
  case SCR_DYN_NUM:
  case SCR_DYN_BOOL:
  case SCR_DYN_BIG:
    /* Measured: Uint8Array.from(5n) is [], exactly Uint8Array.from(5).
     * A bigint has no `length`, so the length switch's zero default is
     * already Node's answer and the element loop never runs. */
    return true;
  default:
    return false;
  }
}

static ScrDyn *scr_u8_from_impl(ScrDyn *const *args, size_t argc) {
  if (!scr_u8_static_recv("from")) return NULL;
  const ScrDyn *src = argc > 0 ? args[0] : scr_dyn_undefined();
  const ScrDyn *mapfn = argc > 1 ? args[1] : scr_dyn_undefined();
  const ScrDyn *this_arg = argc > 2 ? args[2] : scr_dyn_undefined();
  /* The mapfn check comes BEFORE the source is touched (the spec's step
   * order — `Uint8Array.from(null, 5)` blames the 5, not the null). */
  bool mapping = mapfn->kind != SCR_DYN_UNDEF;
  if (mapping && mapfn->kind != SCR_DYN_FUNC) {
    scr_u8_throw_not_fn(mapfn);
    return NULL;
  }
  if (src->kind == SCR_DYN_UNDEF || src->kind == SCR_DYN_NULL) {
    ScrJsonBuf b;
    scr_jb_init(&b);
    scr_jb_puts(&b, src->kind == SCR_DYN_NULL ? "object null" : "undefined");
    scr_jb_puts(&b, " is not iterable (cannot read property Symbol(Symbol.iterator))");
    scr_throw_error(SCR_ERR_TYPE, scr_jb_finish(&b));
    return NULL;
  }
  if (!scr_u8_from_source_ok(src)) {
    ScrJsonBuf b;
    scr_jb_init(&b);
    scr_jb_puts(&b, "Uint8Array.from over a ");
    scr_jb_puts(&b, scr_dyn_kind_name(src));
    scr_jb_puts(&b, " is not supported yet"
                    " (an array, another typed array, a string, or an array-like object with a"
                    " 'length' — this tier cannot run a value's own iterator)");
    scr_throw_error(SCR_ERR_ERROR, scr_jb_finish(&b));
    return NULL;
  }
  /* A STRING iterates by CODE POINT, so a surrogate pair is ONE element
   * (and, being a two-unit string, coerces to NaN → 0 — Node's answer).
   * The boundaries are computed once; `len` is the count. */
  size_t *cp = NULL;
  double len = 0;
  switch (src->kind) {
  case SCR_DYN_ARR:
    len = (double)src->v.arr.len;
    break;
  case SCR_DYN_BYTES:
    len = scr_bytes_len(src->v.bytes);
    break;
  case SCR_DYN_STR: {
    size_t units = (size_t)scr_str_utf16_len(src->v.str);
    cp = (size_t *)malloc((units + 1) * sizeof *cp);
    if (cp == NULL) return NULL;
    size_t n = 0;
    for (size_t i = 0; i < units;) {
      double u = scr_str_char_code_at(src->v.str, (double)i);
      size_t w = 1;
      if (u >= 0xD800 && u <= 0xDBFF && i + 1 < units) {
        double lo = scr_str_char_code_at(src->v.str, (double)(i + 1));
        if (lo >= 0xDC00 && lo <= 0xDFFF) w = 2;
      }
      cp[n++] = i;
      i += w;
    }
    cp[n] = units;
    len = (double)n;
    break;
  }
  case SCR_DYN_OBJ: {
    ScrDyn *lv = scr_dyn_obj_key_get((ScrDyn *)src, "length", 6); /* +1, or NULL */
    if (lv == NULL) return NULL;                                  /* a getter threw */
    double n = scr_dyn_to_number(lv);
    scr_dyn_release(lv);
    if (scr_exc_pending()) return NULL;
    len = scr_u8_to_length(n);
    break;
  }
  default: {
    /* FUNC (its arity IS its `length`), NUM and BOOL (no `length` at
     * all, so zero elements — Node's answer for `Uint8Array.from(5)`). */
    ScrDyn *lv = src->kind == SCR_DYN_FUNC ? scr_dyn_fn_get(src, "length", 6) : NULL;
    double n = lv != NULL ? scr_dyn_to_number(lv) : 0;
    scr_dyn_release(lv);
    if (scr_exc_pending()) return NULL;
    len = scr_u8_to_length(n);
    break;
  }
  }
  ScrBytes *out = scr_bytes_new(SCR_BYTES_U8, len); /* +1, or NULL pending */
  if (out == NULL) {
    free(cp);
    return NULL;
  }
  scr_bytes_stamp_plain(out);
  for (double k = 0; k < len; k += 1) {
    ScrDyn *v = NULL; /* +1 */
    switch (src->kind) {
    case SCR_DYN_ARR:
      v = scr_dyn_retain(src->v.arr.items[(size_t)k]);
      break;
    case SCR_DYN_BYTES:
      v = scr_dyn_new_num(scr_bytes_get(src->v.bytes, k));
      break;
    case SCR_DYN_STR: {
      size_t i = (size_t)k;
      ScrStr *piece = scr_str_slice(src->v.str, (double)cp[i], (double)cp[i + 1]); /* +1 */
      v = scr_dyn_new_str(piece);                                                  /* retains */
      scr_str_release(piece);
      break;
    }
    default: {
      char key[32];
      int kl = snprintf(key, sizeof key, "%.0f", k);
      v = src->kind == SCR_DYN_OBJ ? scr_dyn_obj_key_get((ScrDyn *)src, key, (size_t)kl)
                                   : scr_dyn_fn_get(src, key, (size_t)kl);
      if (v == NULL && !scr_exc_pending()) v = scr_dyn_retain(scr_dyn_undefined());
      break;
    }
    }
    if (v == NULL) { /* a getter threw */
      free(cp);
      scr_bytes_release(out);
      return NULL;
    }
    if (mapping) {
      ScrDyn *kv = scr_dyn_new_num(k); /* +1 */
      ScrDyn *cargs[2] = {v, kv};
      scr_dyn_this_push_dyn(this_arg);
      ScrDyn *m = scr_dyn_call(mapfn, cargs, 2, "mapfn"); /* +1, or NULL pending */
      scr_dyn_this_pop();
      scr_dyn_release(kv);
      scr_dyn_release(v);
      v = m;
      if (v == NULL) {
        free(cp);
        scr_bytes_release(out);
        return NULL;
      }
    }
    double num = scr_dyn_to_number(v);
    scr_dyn_release(v);
    if (scr_exc_pending()) { /* a Symbol element, a BigInt, a throwing valueOf */
      free(cp);
      scr_bytes_release(out);
      return NULL;
    }
    scr_bytes_set(out, k, num); /* the ToUint8 wrap — 300 is 44, like Node */
  }
  free(cp);
  ScrDyn *d = scr_dyn_new_bytes_ref(out); /* +1 on out */
  scr_bytes_release(out);
  return d;
}

static ScrDyn *scr_u8_of_impl(ScrDyn *const *args, size_t argc) {
  if (!scr_u8_static_recv("of")) return NULL;
  ScrBytes *out = scr_bytes_new(SCR_BYTES_U8, (double)argc); /* +1, or NULL pending */
  if (out == NULL) return NULL;
  scr_bytes_stamp_plain(out);
  for (size_t i = 0; i < argc; i++) {
    double v = scr_dyn_to_number(args[i]);
    if (scr_exc_pending()) {
      scr_bytes_release(out);
      return NULL;
    }
    scr_bytes_set(out, (double)i, v);
  }
  ScrDyn *d = scr_dyn_new_bytes_ref(out);
  scr_bytes_release(out);
  return d;
}

static ScrDyn *scr_u8_s_from(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  return scr_u8_from_impl(args, argc);
}

static ScrDyn *scr_u8_s_of(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  return scr_u8_of_impl(args, argc);
}

static ScrDyn *scr_u8_static_member(const char *key, size_t key_len) {
  if (key_len == 4 && memcmp(key, "from", 4) == 0 && scr_u8_from_fn != NULL) {
    return scr_dyn_retain(scr_u8_from_fn);
  }
  if (key_len == 2 && memcmp(key, "of", 2) == 0 && scr_u8_of_fn != NULL) {
    return scr_dyn_retain(scr_u8_of_fn);
  }
  return NULL;
}

/* Calling %Uint8Array% without `new`. `new` never reaches this thunk —
 * scr_dyn_construct routes on pointer identity — so the throw is the
 * body's whole job, and it is Node's. */
static ScrDyn *scr_u8_ctor_thunk(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  (void)args;
  (void)argc;
  static const char msg[] = "Constructor Uint8Array requires 'new'";
  scr_throw_error_msg(SCR_ERR_TYPE, msg, sizeof msg - 1);
  return NULL;
}

static ScrDyn *scr_u8_new_func(const char *name, ScrDynThunk thunk, uint32_t arity) {
  /* ZERO captures — the box holds no reference back to the object it is
   * about to be defined on. `name` is a static literal, which is what
   * scr_dyn_new_func's contract requires (the box never frees it). */
  return scr_dyn_new_func(scr_closure_new((void *)thunk, 0), thunk, arity, "()", name);
}

static void scr_u8_define_method(ScrDyn *target, const char *name, ScrDynThunk thunk,
                                 uint32_t arity) {
  ScrDyn *f = scr_u8_new_func(name, thunk, arity); /* +1 */
  /* Non-enumerable, writable, configurable — the attributes every one of
   * these has in Node, so `Object.keys(Uint8Array.prototype)` is `[]`
   * for the REASON Node's is rather than by luck. */
  scr_dyn_obj_define_hidden_data(target, name, strlen(name), f, true, true);
  scr_dyn_release(f);
}

static void scr_u8_define_getter(ScrDyn *target, const char *name, ScrDynThunk thunk) {
  ScrDyn *g = scr_u8_new_func(name, thunk, 0); /* +1 */
  /* NON-enumerable, like every accessor on a builtin prototype in Node —
   * `Object.keys(Uint8Array.prototype)` is `[]` there, and this getter
   * must not be the one thing that puts a name in it. */
  scr_dyn_obj_define_accessor(target, name, strlen(name), g, scr_dyn_undefined(), true, false);
  scr_dyn_release(g);
}

static void scr_u8_build(void) {
  if (scr_u8_ctor != NULL) return;
  ScrDyn *ta = scr_dyn_new_obj(); /* %TypedArray%.prototype */
#define X(m, n) scr_u8_define_method(ta, #m, scr_u8_m_##m, n);
  SCR_TA_PROTO_METHODS(X)
#undef X
  scr_u8_define_getter(ta, "buffer", scr_u8_g_buffer);
  scr_u8_define_getter(ta, "byteLength", scr_u8_g_byteLength);
  scr_u8_define_getter(ta, "byteOffset", scr_u8_g_byteOffset);
  scr_u8_define_getter(ta, "length", scr_u8_g_length);

  ScrDyn *p = scr_dyn_new_obj(); /* %Uint8Array.prototype% */
  scr_dyn_obj_set_proto(p, ta);
#define X(m, n) scr_u8_define_method(p, #m, scr_u8_m_##m, n);
  SCR_U8_PROTO_METHODS(X)
#undef X
  ScrDyn *bpe = scr_dyn_new_num(1);
  scr_dyn_obj_define_hidden_data(p, "BYTES_PER_ELEMENT", 17, bpe, false, false);
  scr_dyn_release(bpe);

  ScrDyn *c = scr_u8_new_func("Uint8Array", scr_u8_ctor_thunk, 3); /* +1 */
  /* PINNED before anything can read it, so scr_dyn_fn_prototype answers
   * this object instead of minting the anonymous one it makes for a user
   * function on first demand. `Uint8Array.prototype === Uint8Array
   * .prototype` and the chain `new` installs both depend on it. The key
   * is skipped by the own-keys walk (like `name` and `length`), so
   * `Object.keys(Uint8Array)` stays Node's `[]`. */
  ScrDyn *table = scr_dyn_fn_props(c); /* +1 */
  scr_dyn_obj_set(table, "prototype", 9, scr_dyn_retain(p));
  scr_dyn_release(table);
  scr_dyn_obj_define_hidden_data(p, "constructor", 11, c, true, true);

  /* The two statics. Built LAST because scr_u8_static_recv compares the
   * ambient receiver against `scr_u8_ctor`, and the assignment below is
   * what makes that pointer real. */
  scr_ta_proto = ta;
  scr_u8_proto = p;
  scr_u8_ctor = c;
  scr_u8_from_fn = scr_u8_new_func("from", scr_u8_s_from, 1); /* +1 */
  scr_u8_of_fn = scr_u8_new_func("of", scr_u8_s_of, 0);       /* +1 */
  scr_atexit(scr_u8_teardown);
}

ScrDyn *scr_dyn_uint8array_ctor(void) {
  scr_u8_build();
  return scr_dyn_retain(scr_u8_ctor);
}

static bool scr_u8_is_ctor(const ScrDyn *d) {
  return scr_u8_ctor != NULL && d == scr_u8_ctor;
}

ScrDyn *scr_dyn_uint8array_prototype(void) {
  scr_u8_build();
  return scr_dyn_retain(scr_u8_proto);
}

/* `Uint8Array.from` / `Uint8Array.of` written STATICALLY. The same two
 * boxes a keyed read off the constructor answers (scr_u8_static_member),
 * so the two spellings are one function object and `Uint8Array.from ===
 * Uint8Array.from` holds through either. */
ScrDyn *scr_dyn_uint8array_from(void) {
  scr_u8_build();
  return scr_dyn_retain(scr_u8_from_fn);
}

ScrDyn *scr_dyn_uint8array_of(void) {
  scr_u8_build();
  return scr_dyn_retain(scr_u8_of_fn);
}

/* `b.constructor` on a typed array. Node answers the constructor
 * FUNCTION, and protobufjs's `Reader.prototype.raw` builds through it
 * (`new this.buf.constructor(0)`); undefined would be the silent kind of
 * wrong. A BUFFER-flavored value's constructor is `Buffer`, a different
 * function this tier does not hold, so it refuses by name rather than
 * answering the Uint8Array one — the two disagree about `toString`,
 * `inspect` and their own `.constructor`. */
ScrDyn *scr_dyn_bytes_constructor(const ScrDyn *d) {
  /* A DataView's constructor is DataView, which is no more a value in
   * this tier than Buffer is. It used to answer the Uint8Array one --
   * the wrong function, silently. Refuse by name instead. */
  if (d->v.bytes != NULL && d->v.bytes->flavor == SCR_BF_DATAVIEW) {
    static const char dvmsg[] =
        "reading 'constructor' off a DataView is not supported yet"
        " (the DataView constructor is not a value in a static build; answering the"
        " Uint8Array one would be wrong -- a DataView is not one of its instances)";
    scr_throw_error_msg(SCR_ERR_ERROR, dvmsg, sizeof dvmsg - 1);
    return NULL;
  }
  if (d->buffer || d->v.bytes->flavor == SCR_BF_BUFFER) {
    static const char msg[] =
        "reading 'constructor' off a Buffer is not supported yet"
        " (the Buffer constructor is not a value in a static build; the Uint8Array one"
        " is, and a Buffer is not one of its instances — Buffer.alloc/Buffer.from build"
        " the flavored value this tier can make)";
    scr_throw_error_msg(SCR_ERR_ERROR, msg, sizeof msg - 1);
    return NULL;
  }
  if (d->v.bytes->elem != SCR_BYTES_U8) {
    ScrJsonBuf b;
    scr_jb_init(&b);
    scr_jb_puts(&b, "reading 'constructor' off a ");
    scr_jb_puts(&b, scr_dyn_kind_name(d));
    scr_jb_puts(&b, " is not supported yet"
                    " (only the Uint8Array constructor is a value in this tier — the other"
                    " typed-array constructors have no object to point at)");
    scr_throw_error(SCR_ERR_ERROR, scr_jb_finish(&b));
    return NULL;
  }
  return scr_dyn_uint8array_ctor();
}

/* `new Uint8Array(…)` through the singleton. scr_dyn_construct routes
 * here by POINTER IDENTITY instead of running the thunk, whose only job
 * is the requires-'new' throw. The argument forms are Node's, minus the
 * two with no representation here (an ArrayBuffer, and the (buffer,
 * byteOffset, length) triple), which refuse by name. */
static ScrDyn *scr_u8_construct(const ScrDyn *args) {
  size_t argc = (args != NULL && args->kind == SCR_DYN_ARR) ? args->v.arr.len : 0;
  const ScrDyn *a0 = argc > 0 ? args->v.arr.items[0] : NULL;
  if (a0 == NULL || a0->kind == SCR_DYN_UNDEF || a0->kind == SCR_DYN_NULL ||
      a0->kind == SCR_DYN_NUM || a0->kind == SCR_DYN_BOOL || a0->kind == SCR_DYN_STR) {
    /* ToIndex — NaN and a non-numeric string are 0, a negative or
     * oversized length throws Node's RangeError (scr_bytes_new's). */
    double n = a0 == NULL ? 0 : scr_dyn_to_number(a0);
    if (scr_exc_pending()) return NULL;
    ScrBytes *b = scr_bytes_new(SCR_BYTES_U8, n != n ? 0 : n); /* +1, or NULL pending */
    if (b == NULL) return NULL;
    scr_bytes_stamp_plain(b);
    ScrDyn *d = scr_dyn_new_bytes_ref(b); /* +1 on b */
    scr_bytes_release(b);
    return d;
  }
  if (a0->kind == SCR_DYN_BYTES) {
    ScrBytes *b = scr_bytes_copy(a0->v.bytes); /* +1; a same-elem copy, like Node */
    scr_bytes_stamp_plain(b);
    ScrDyn *d = scr_dyn_new_bytes_ref(b);
    scr_bytes_release(b);
    return d;
  }
  if (a0->kind == SCR_DYN_ARR) {
    ScrBytes *b = scr_bytes_new(SCR_BYTES_U8, (double)a0->v.arr.len);
    if (b == NULL) return NULL;
    scr_bytes_stamp_plain(b);
    for (size_t i = 0; i < a0->v.arr.len; i++) {
      double v = scr_dyn_to_number(a0->v.arr.items[i]);
      if (scr_exc_pending()) { /* a Symbol element, a throwing valueOf */
        scr_bytes_release(b);
        return NULL;
      }
      scr_bytes_set(b, (double)i, v);
    }
    ScrDyn *d = scr_dyn_new_bytes_ref(b);
    scr_bytes_release(b);
    return d;
  }
  {
    ScrJsonBuf b;
    scr_jb_init(&b);
    scr_jb_puts(&b, "new Uint8Array(<");
    scr_jb_puts(&b, scr_dyn_kind_name(a0));
    scr_jb_puts(&b, ">) is not supported yet"
                    " (a length, an array of numbers, or another typed array — there is no"
                    " free-standing ArrayBuffer value here to build a view over)");
    scr_throw_error(SCR_ERR_ERROR, scr_jb_finish(&b));
  }
  return NULL;
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
  /* %Uint8Array%: routed by POINTER IDENTITY rather than through the
   * ordinary [[Construct]] below, because the value it must answer is a
   * BYTES payload rather than an OBJ linked to a prototype — and because
   * its thunk's only job is the requires-'new' throw the plain call form
   * needs. Every other function keeps the ordinary path. */
  if (fn == scr_u8_ctor) return scr_u8_construct(args);
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
   * Reading `scr_dyn_ext(proto)->cname` unconditionally, as this did before,
   * read the `cname` slot out of a NUM/STR node's union: a stale pointer
   * left by whatever OBJ last occupied that freelist cell, handed
   * straight to util.inspect. */
  if (proto->kind == SCR_DYN_OBJ) {
    scr_dyn_obj_set_proto(inst, proto);
    scr_dyn_obj_set_ctor_name(inst, scr_dyn_ext(proto)->cname);
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
                    r->kind == SCR_DYN_ARRBUF || r->kind == SCR_DYN_MAP ||
                    r->kind == SCR_DYN_HANDLE || r->kind == SCR_DYN_PROMISE ||
                    r->kind == SCR_DYN_JSVAL || r->kind == SCR_DYN_OBJINST)) {
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
      /* StructuredSerialize reads each own enumerable property with
       * [[Get]], so an ENUMERABLE ACCESSOR's getter RUNS and its value is
       * what crosses — the clone is a plain data object either way, which
       * is Node's answer too. A tombstone is not an own enumerable key.
       * The key bytes are snapshotted before the getter can delete them. */
      ScrStr *k = scr_str_new(e->key, e->key_len); /* +1 */
      bool sl_skip = false;
      ScrDyn *mv = scr_dyn_obj_entry_read((ScrDyn *)v, e, &sl_skip); /* +1 or NULL */
      if (mv == NULL) {
        scr_str_release(k);
        if (sl_skip) continue;
        scr_dyn_release(out);
        return NULL; /* the getter threw */
      }
      ScrDyn *c = scr_sc_clone(mv, &self);
      scr_dyn_release(mv);
      if (c == NULL) {
        scr_str_release(k);
        scr_dyn_release(out);
        return NULL;
      }
#ifdef SCR_DYNCEN_ON
      scr_dyncen_note_korigin(SCR_DYNCEN_KO_COPY);
#endif
      scr_dyn_obj_set(out, k->data, k->len, c); /* ownership moves */
      scr_str_release(k);
    }
    return out;
  }
  case SCR_DYN_JSVAL:
    /* Node CLONES a plain engine object — the DataCloneError default
     * below would be a wrong claim, and fabricating a shape would be a
     * silent wrong answer. Loud fence (lane dom-jsval-long-tail). */
    scr_dyn_isl_fence(v, "structuredClone");
    return NULL;
  case SCR_DYN_OBJINST:
    /* Node clones an instance's own properties as a PLAIN object; the box
     * cannot enumerate them, and a fabricated {} would be a silent wrong
     * answer (the JSVAL arm's reasoning). */
    scr_dyn_objinst_fence(v, "structuredClone");
    return NULL;
  case SCR_DYN_MAP:
    /* Node CLONES a Map or Set, entry by entry (both are on the
     * structured-clone list), so the DataCloneError default below would
     * be a wrong claim — but the box cannot walk the entries: it holds
     * the interned typeKey, not the per-element retain/copy the walk
     * would need to rebuild a value of the same static type. A fabricated
     * empty map would be a silent wrong answer of exactly the shape
     * estado-dynfunc.md 3.5 warns about. Loud fence. */
    scr_dyn_map_fence(v, "structuredClone");
    return NULL;
  case SCR_DYN_BIG:
    /* Bigints ARE cloneable (measured: structuredClone(5n) is 5n), so
     * the DataCloneError default below would be a wrong claim. The
     * digits are immutable, so "copy" and "retain" are the same
     * observation.
     *
     * scr_dyn_alloc_big with the ALREADY-INSTALLED table, not the gated
     * scr_dyn_from_big: this file is always linked, so naming the
     * constructor here left `undefined symbol: scr_dyn_from_big` in
     * every bigint-free binary — a hello-world caught it. Reaching this
     * arm means a BIG node exists, which means the table is installed. */
    return scr_dyn_alloc_big(v->v.big, scr_dyn_big_ops());
  case SCR_DYN_ARRBUF: {
    /* An ArrayBuffer is a transferable, and structuredClone COPIES it —
     * the one place this kind must not share its payload, since the
     * whole point of the call is a buffer the caller can mutate
     * independently. */
    ScrBytes *cp = scr_bytes_copy(v->v.bytes);
    ScrDyn *out = scr_dyn_new_arrbuf_ref(cp);
    scr_bytes_release(cp);
    return out;
  }
  case SCR_DYN_FUNC:
  case SCR_DYN_HANDLE:
  default: {
    /* Node names the value by its String() rendering ("function f() {}
     * could not be cloned."), which for a function IS its source text.
     * A box that carries none must not turn this DIAGNOSTIC into a
     * different exception — the message falls back to the native form
     * and the DataCloneError below still fires, which is the failure the
     * caller asked about. */
    if (v->kind == SCR_DYN_FUNC && scr_dyn_fn_src(v) == NULL) {
      ScrJsonBuf nb;
      scr_jb_init(&nb);
      scr_jb_puts(&nb, "function ");
      if (scr_dyn_fn_name(v)) scr_jb_puts(&nb, scr_dyn_fn_name(v));
      scr_jb_puts(&nb, "() { [native code] } could not be cloned.");
      scr_throw_domex_str("DataCloneError", scr_jb_finish(&nb)); /* takes ownership */
      return NULL;
    }
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
    const size_t n = v->v.obj.len;
    for (size_t oi = 0; oi < n; oi++) {
      if (v->v.obj.len != n) break; /* a getter below resized the table */
      const ScrDynEntry *e = &v->v.obj.entries[ord ? ord[oi] : oi];
      /* KEYS runs nothing: Node lists an accessor's name without calling
       * its getter, and a call here would be an observable side effect
       * JS does not have. VALUES and ENTRIES do call it, once, in this
       * position. */
      if (mode == SCR_OBJWALK_KEYS) {
        if (!scr_dyn_obj_entry_listed(v, e)) continue;
        scr_dyn_objwalk_push(out, mode, e->key, e->key_len, e->value);
        continue;
      }
      /* SNAPSHOT the key before any user code runs: a getter can reach
       * this object through its closure and delete the key, which frees
       * the bytes `e` points at. */
      ScrStr *k = scr_str_new(e->key, e->key_len); /* +1 */
      bool skip = false;
      ScrDyn *val = scr_dyn_obj_entry_read((ScrDyn *)v, e, &skip); /* +1 or NULL */
      if (val == NULL) {
        scr_str_release(k);
        if (skip) continue;
        free(ord);
        scr_dyn_release(out);
        return NULL; /* the getter threw; the exception is pending */
      }
      scr_dyn_objwalk_push(out, mode, k->data, k->len, val);
      scr_dyn_release(val);
      scr_str_release(k);
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
    const size_t n = src->v.obj.len;
    for (size_t i = 0; i < n; i++) {
      if (src->v.obj.len != n) break; /* a getter below resized the source */
      const ScrDynEntry *e = &src->v.obj.entries[i];
      /* CopyDataProperties is a [[Get]] per key, so an ENUMERABLE
       * ACCESSOR's getter runs and the TARGET receives an ordinary data
       * property — Object.assign copies values, never descriptors, which
       * is why `Object.keys(Object.assign({}, o))` and `Object.keys(o)`
       * agree while the target has no accessor at all. */
      ScrStr *k = scr_str_new(e->key, e->key_len); /* +1 */
      bool sl_skip = false;
      ScrDyn *mv = scr_dyn_obj_entry_read((ScrDyn *)src, e, &sl_skip); /* +1 or NULL */
      if (mv == NULL) {
        scr_str_release(k);
        if (sl_skip) continue;
        return; /* the getter threw; the pending exception unwinds */
      }
#ifdef SCR_DYNCEN_ON
      scr_dyncen_note_korigin(SCR_DYNCEN_KO_COPY);
#endif
      scr_dyn_obj_set(target, k->data, k->len, mv); /* ownership moves */
      scr_str_release(k);
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
#ifdef SCR_DYNCEN_ON
      scr_dyncen_note_korigin(SCR_DYNCEN_KO_COPY);
#endif
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
#ifdef SCR_DYNCEN_ON
        scr_dyncen_note_korigin(SCR_DYNCEN_KO_COPY);
#endif
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
  if ((src->kind == SCR_DYN_ARR || src->kind == SCR_DYN_BYTES ||
       src->kind == SCR_DYN_STR) && !dyn_bytes_is_dataview(src)) {
    scr_dyn_arr_push_spread(pack, src, ""); /* iterable kinds never throw */
    return;
  }
  /* A DATAVIEW is not one of them: it falls to the kind-word text
   * below, and "object" is exactly what Node calls it there. */
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
  scr_dyn_iter_kind_word(&b, src);
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
    /* Own presence, hidden table included: `hasOwn` differs from
     * Object.keys by ENUMERABILITY, not by which table a property is
     * filed in, and Node answers true for an own non-enumerable one. */
    return scr_dyn_obj_has_own_prop(v, key->data, key->len);
  }
  if (v->kind == SCR_DYN_ARR) {
    if (key->len == 6 && memcmp(key->data, "length", 6) == 0) return true;
    size_t idx = 0;
    return dyn_canonical_index(key, &idx) && idx < v->v.arr.len;
  }
  /* A STRING exotic object's own properties are its INDICES plus a
   * non-writable own `length` — measured, not assumed:
   * Object.hasOwn("abc", "1") and Object.hasOwn("abc", "length") are both
   * true in Node. The index is a UTF-16 code-unit position, which is the
   * same unit the keyed read uses. */
  if (v->kind == SCR_DYN_STR) {
    if (key->len == 6 && memcmp(key->data, "length", 6) == 0) return true;
    size_t idx = 0;
    return dyn_canonical_index(key, &idx) && idx < scr_str_utf16_len(v->v.str);
  }
  /* A TYPED ARRAY's indices are own; its `length` is NOT — that one is an
   * accessor on %TypedArray%.prototype, so Object.hasOwn(u8, "length") is
   * FALSE in Node where the string above answers true. The two kinds
   * really do differ, which is why they are separate arms. */
  if (v->kind == SCR_DYN_BYTES) {
    size_t idx = 0;
    return dyn_canonical_index(key, &idx) && idx < v->v.bytes->len;
  }
  if (v->kind == SCR_DYN_FUNC) return scr_dyn_fn_has_own(v, key->data, key->len);
  /* A CLASS INSTANCE box carries no member table — the whole kind is a
   * pointer plus a descriptor, and every OTHER property question on it
   * takes the loud ladder (a read, a write, JSON.stringify). Answering
   * false here would be the one that did not: an instance field IS own in
   * Node, so false is a wrong ANSWER where the neighbours refuse. The
   * method spelling `inst.hasOwnProperty(k)` lands here too. */
  if (v->kind == SCR_DYN_OBJINST) return scr_dyn_objinst_fence(v, "Object.hasOwn");
  /* A MAP box is exact in the OTHER direction and it is worth saying why
   * it does NOT join the OBJINST arm: a Map's entries are internal slots,
   * not own properties, so `Object.hasOwn(new Map([["a",1]]), "a")` is
   * FALSE in Node (measured) — the same answer BIG, ARRBUF and PROMISE
   * get from the default tail below, and for the same reason. Fencing
   * here would refuse a question this tier can answer correctly. */
  /* HANDLE keeps FALSE, and it is the answer `in` already gives over the
   * same value: which members a native handle OWNS rather than inherits
   * is a distinction this tier has not measured, and the two spellings
   * agreeing is worth more than one of them guessing. BIG, ARRBUF and
   * PROMISE are exact — none of the three has an own property of any name
   * in Node. */
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
  /* The WebIDL ToString ran the value's OWN toString, which can throw:
   * the empty-string dummy must not be decoded, or the argument's
   * exception is REPLACED by an InvalidCharacterError about a string the
   * program never produced. NULL is this function's throw shape and the
   * seeded call site checks it. */
  if (scr_exc_pending()) { scr_str_release(s); return NULL; }
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
  /* The coercion's own throw wins over any encoding complaint about the
   * empty-string dummy (scr_atob carries the same bail). */
  if (scr_exc_pending()) { scr_str_release(s); return NULL; }
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
