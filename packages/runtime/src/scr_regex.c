/* Regular expressions (see scr_runtime.h for the API contract).
 *
 * The engine is quickjs-ng's libregexp — the exact ECMAScript regex
 * implementation the dynamic island uses — compiled standalone (libregexp.c
 * + libunicode.c; cutils is header-only) and linked ONLY into programs that
 * contain a regex literal. This file is likewise regex-only: it is NOT in
 * the always-compiled runtime source list (see cc.ts), so regex-free
 * programs keep a byte-identical link line.
 *
 * - Every ScrRegex today is an immortal interned literal (the compiler
 *   emits one static per distinct (pattern, flags) pair, like string
 *   literals). The pattern is compiled to bytecode LAZILY on first use and
 *   cached on the struct; a pattern lre_compile rejects aborts with a clear
 *   message (Node throws SyntaxError at parse time — documented divergence;
 *   rare, since tsc's parser has already syntax-checked the literal).
 * - Subjects are matched as UTF-16: lre_exec runs over a per-call
 *   conversion of the UTF-8 subject (cbuf_type 1), so every index libregexp
 *   reports is a UTF-16 code-unit index — .length/slice/charCodeAt exact,
 *   like Node. Correctness-first: the conversion is O(n) per call.
 * - Match loops mirror quickjs.c's own (JS_RegExpDelete /
 *   js_regexp_Symbol_replace): capture buffers are sized by
 *   lre_get_alloc_count (NOT capture_count*2 — the executor writes
 *   temporary registers past the capture slots), unmatched groups leave
 *   NULL pointers, and zero-length matches advance by one code unit — or by
 *   a whole surrogate pair under /u (AdvanceStringIndex).
 * - Statefulness: lastIndex lives on the ScrRegex. exec/test on a /g or /y
 *   regex read and write it (scr_regex_run); a /g or /y LITERAL is cloned per
 *   evaluation so two evaluations never share one. match() on a /g regex
 *   answers every match's text and leaves lastIndex 0; replace/replaceAll
 *   follow Symbol.replace (g: reset to 0 and leave 0; sticky non-g: one
 *   exec from lastIndex); matchAll starts at the receiver's lastIndex and
 *   never writes it; split never touches it.
 */
#include "scr_runtime.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "libregexp.h"

static void scr_regex_oom(void) {
  scr_trap("scriptc: out of memory\n");
}

/* ── libregexp host hooks ─────────────────────────────────────────────
 * Static builds provide the minimal hooks (malloc-backed, no interrupt,
 * no stack guard — patterns come from source literals and the executor's
 * backtrack stack is heap-allocated). --dynamic builds MUST NOT define
 * them: the engine archive's quickjs.c already does, with the opaque
 * interpreted as the island's JSContext — so under SCR_DYNAMIC every
 * lre_compile/lre_exec call here passes the island's context instead
 * (forcing lazy engine init on first regex use).
 */
#ifdef SCR_DYNAMIC
static void *lre_opaque(void) { return scr_island_lre_opaque(); }
#else
static void *lre_opaque(void) { return NULL; }

bool lre_check_stack_overflow(void *opaque, size_t alloca_size) {
  (void)opaque;
  (void)alloca_size;
  return false;
}

int lre_check_timeout(void *opaque) {
  (void)opaque;
  return 0;
}

void *lre_realloc(void *opaque, void *ptr, size_t size) {
  (void)opaque;
  if (size == 0) {
    free(ptr);
    return NULL;
  }
  return realloc(ptr, size);
}
#endif /* SCR_DYNAMIC */

/* ── lazy compilation ─────────────────────────────────────────────────
 * Compiled bytecodes are cached on the immortal ScrRegex statics and freed
 * at exit through lre_realloc (registered AFTER the first compile, so under
 * --dynamic it runs before the LIFO-later island teardown and the island's
 * allocation audit sees the bytecode gone).
 */

static ScrRegex **scr_compiled = NULL;
static size_t scr_compiled_len = 0, scr_compiled_cap = 0;

static void scr_regex_free_bytecodes(void) {
  for (size_t i = 0; i < scr_compiled_len; i++) {
    lre_realloc(lre_opaque(), scr_compiled[i]->bc, 0);
    scr_compiled[i]->bc = NULL;
  }
  free(scr_compiled);
  scr_compiled = NULL;
  scr_compiled_len = scr_compiled_cap = 0;
}

static void scr_note_compiled(ScrRegex *re) {
  if (scr_compiled_len == scr_compiled_cap) {
    scr_compiled_cap = scr_compiled_cap ? scr_compiled_cap * 2 : 8;
    scr_compiled = realloc(scr_compiled, scr_compiled_cap * sizeof *scr_compiled);
    if (!scr_compiled) scr_regex_oom();
  }
  if (scr_compiled_len == 0) scr_atexit(scr_regex_free_bytecodes);
  scr_compiled[scr_compiled_len++] = re;
}

/* Flags string → LRE_FLAG_* mask. The frontend fences the LITERAL flag
 * alphabet to g/i/m/s/u/v/y and scr_regex_new validates the RUNTIME string
 * against the same alphabet, so the two agree and 'v' arrives here from
 * either. ('d' reaches neither: lowerRegexLiteral refuses the literal and
 * scr_regex_new refuses the string.) Anything else here is a compiler
 * bug. */
static int scr_lre_flags(const ScrStr *flags) {
  int mask = 0;
  for (size_t i = 0; i < flags->len; i++) {
    switch (flags->data[i]) {
      case 'g': mask |= LRE_FLAG_GLOBAL; break;
      case 'i': mask |= LRE_FLAG_IGNORECASE; break;
      case 'm': mask |= LRE_FLAG_MULTILINE; break;
      case 's': mask |= LRE_FLAG_DOTALL; break;
      case 'u': mask |= LRE_FLAG_UNICODE; break;
      case 'v': mask |= LRE_FLAG_UNICODE_SETS; break;
      case 'y': mask |= LRE_FLAG_STICKY; break;
      case 'd': mask |= LRE_FLAG_INDICES; break; /* recorded only: exec builds `indices` itself */
      default:
        scr_trap_fmt("scriptc: internal error: unexpected regex flag '%c'\n",
                     flags->data[i]);
    }
  }
  return mask;
}

/* Without /u OR /v, JS treats the pattern itself as UTF-16 code units: an
 * astral character in the pattern SOURCE is two separate surrogate units.
 * /v is a unicode-mode grammar exactly as /u is, so BOTH callers gate this
 * re-encoding on the pair — running it under /v would corrupt an astral
 * pattern into two lone surrogates.
 * libregexp expects that spelled as CESU-8 (quickjs feeds it
 * JS_ToCStringLen2(cesu8=true) for non-unicode patterns), so a non-/u
 * pattern containing a 4-byte UTF-8 sequence is re-encoded: each astral
 * code point becomes two 3-byte surrogate encodings. Returns NULL when the
 * pattern needs no re-encoding (the common case — no copy). */
static char *scr_pattern_cesu8(const ScrStr *src, size_t *plen) {
  bool has_astral = false;
  for (size_t i = 0; i < src->len; i++) {
    if ((unsigned char)src->data[i] >= 0xF0) {
      has_astral = true;
      break;
    }
  }
  if (!has_astral) return NULL;
  char *out = malloc(src->len / 2 * 3 + src->len + 1); /* 4 bytes → 6 worst case */
  if (!out) scr_regex_oom();
  size_t o = 0;
  for (size_t i = 0; i < src->len;) {
    unsigned char c = (unsigned char)src->data[i];
    if (c < 0xF0) {
      out[o++] = src->data[i++];
      continue;
    }
    uint32_t cp = ((uint32_t)(c & 0x07) << 18) |
                  ((uint32_t)((unsigned char)src->data[i + 1] & 0x3F) << 12) |
                  ((uint32_t)((unsigned char)src->data[i + 2] & 0x3F) << 6) |
                  ((unsigned char)src->data[i + 3] & 0x3F);
    i += 4;
    uint32_t hi = 0xD800 + ((cp - 0x10000) >> 10);
    uint32_t lo = 0xDC00 + ((cp - 0x10000) & 0x3FF);
    out[o++] = (char)(0xE0 | (hi >> 12));
    out[o++] = (char)(0x80 | ((hi >> 6) & 0x3F));
    out[o++] = (char)(0x80 | (hi & 0x3F));
    out[o++] = (char)(0xE0 | (lo >> 12));
    out[o++] = (char)(0x80 | ((lo >> 6) & 0x3F));
    out[o++] = (char)(0x80 | (lo & 0x3F));
  }
  /* lre_compile needs the NUL sentinel in ADDITION to buf_len: quickjs
   * always hands it NUL-terminated C strings, and the parser reads *p
   * against '\0' at end-of-pattern (found the hard way — an unterminated
   * buffer reports "extraneous characters at the end"). */
  out[o] = '\0';
  *plen = o;
  return out;
}

/* The compiled bytecode, compiling (and caching) on first use. */
static uint8_t *scr_regex_bc(ScrRegex *re) {
  if (re->proto) return scr_regex_bc(re->proto); /* a clone borrows its literal's */
  if (re->bc) return re->bc;
  int flags = scr_lre_flags(re->flags);
  const char *pat = re->source->data;
  size_t pat_len = re->source->len;
  char *cesu = NULL;
  if (!(flags & (LRE_FLAG_UNICODE | LRE_FLAG_UNICODE_SETS))) {
    cesu = scr_pattern_cesu8(re->source, &pat_len);
    if (cesu) pat = cesu;
  }
  char error_msg[64];
  int bc_len;
  uint8_t *bc = lre_compile(&bc_len, error_msg, sizeof error_msg, pat, pat_len,
                            flags, lre_opaque());
  free(cesu);
  if (!bc) {
    /* Node rejects the pattern with a SyntaxError at PARSE time; scriptc
     * compiles lazily, so the failure lands here (documented divergence —
     * tsc's parser has already caught plain syntax errors, so this is
     * rare). */
    fflush(stdout);
    scr_trap_fmt("scriptc: SyntaxError: Invalid regular expression: /%s/%s: %s\n",
                 re->source->data, re->flags->data, error_msg);
  }
  re->bc = bc;
  scr_note_compiled(re);
  return bc;
}

/* ── RC entry points ──────────────────────────────────────────────────
 * Dead paths today (every regex value is an immortal interned literal);
 * correct anyway so dynamic construction can arrive without surprises. */

void scr_regex_release(ScrRegex *re) {
  if (!re || re->rc == SIZE_MAX) return;
  if (--re->rc == 0) {
    scr_str_release(re->source);
    scr_str_release(re->flags);
    if (re->proto) scr_regex_release(re->proto);
    else if (re->bc) lre_realloc(lre_opaque(), re->bc, 0);
    free(re);
  }
}

ScrRegex *scr_regex_clone(ScrRegex *proto) {
  ScrRegex *re = calloc(1, sizeof *re);
  if (!re) scr_regex_oom();
  re->rc = 1;
  re->source = scr_str_retain(proto->source);
  re->flags = scr_str_retain(proto->flags);
  re->proto = proto->proto ? proto->proto : proto;
  if (re->proto->rc != SIZE_MAX) re->proto->rc++;
  return re;
}

double scr_regex_get_last_index(ScrRegex *re) { return re->last_index; }
void scr_regex_set_last_index(ScrRegex *re, double v) { re->last_index = v; }

void *scr_regex_retain_v(void *re) { return scr_regex_retain(re); }
void scr_regex_release_v(void *re) { scr_regex_release(re); }

ScrStr *scr_regex_source(ScrRegex *re) { return scr_str_retain(re->source); }
ScrStr *scr_regex_flags(ScrRegex *re) { return scr_str_retain(re->flags); }

/* ── UTF-8 ⇄ UTF-16 (the exec buffer strategy) ──────────────────────── */

/* Subject as freshly-malloc'd UTF-16 code units (strings are well-formed
 * UTF-8, so no validation). Unit count ≤ byte count. */
static uint16_t *scr_to_utf16(const ScrStr *s, int *plen) {
  uint16_t *u = malloc((s->len ? s->len : 1) * sizeof(uint16_t));
  if (!u) scr_regex_oom();
  int n = 0;
  for (size_t i = 0; i < s->len;) {
    unsigned char c = (unsigned char)s->data[i];
    uint32_t cp;
    if (c < 0x80) {
      cp = c;
      i += 1;
    } else if (c < 0xE0) {
      cp = ((uint32_t)(c & 0x1F) << 6) | ((unsigned char)s->data[i + 1] & 0x3F);
      i += 2;
    } else if (c < 0xF0) {
      cp = ((uint32_t)(c & 0x0F) << 12) |
           ((uint32_t)((unsigned char)s->data[i + 1] & 0x3F) << 6) |
           ((unsigned char)s->data[i + 2] & 0x3F);
      i += 3;
    } else {
      cp = ((uint32_t)(c & 0x07) << 18) |
           ((uint32_t)((unsigned char)s->data[i + 1] & 0x3F) << 12) |
           ((uint32_t)((unsigned char)s->data[i + 2] & 0x3F) << 6) |
           ((unsigned char)s->data[i + 3] & 0x3F);
      i += 4;
    }
    if (cp >= 0x10000) {
      u[n++] = (uint16_t)(0xD800 + ((cp - 0x10000) >> 10));
      u[n++] = (uint16_t)(0xDC00 + ((cp - 0x10000) & 0x3FF));
    } else {
      u[n++] = (uint16_t)cp;
    }
  }
  *plen = n;
  return u;
}

/* Append u[start..end) as UTF-8. A lone surrogate (a non-/u match boundary
 * split an astral pair) becomes U+FFFD — the house rule for JS results that
 * are not well-formed UTF-16 (same divergence class as charAt/slice,
 * SEMANTICS.md). */
static void scr_jb_put_utf16(ScrJsonBuf *b, const uint16_t *u, int start, int end) {
  for (int i = start; i < end; i++) {
    uint32_t cp = u[i];
    if (cp >= 0xD800 && cp < 0xDC00 && i + 1 < end && u[i + 1] >= 0xDC00 &&
        u[i + 1] < 0xE000) {
      cp = 0x10000 + ((cp - 0xD800) << 10) + (u[i + 1] - 0xDC00);
      i++;
    } else if (cp >= 0xD800 && cp < 0xE000) {
      cp = 0xFFFD;
    }
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
}

static ScrStr *scr_str_from_utf16(const uint16_t *u, int start, int end) {
  ScrJsonBuf b;
  scr_jb_init(&b);
  scr_jb_put_utf16(&b, u, start, end);
  return scr_jb_finish(&b);
}

/* ── exec plumbing ────────────────────────────────────────────────────── */

/* One lre_exec over the UTF-16 subject. Returns 1 (match), 0 (no match);
 * engine-level failures (OOM, corrupt bytecode — no timeout handler is
 * installed) abort like every runtime OOM. */
static int scr_exec(uint8_t **capture, const uint8_t *bc, const uint16_t *u,
                     int index, int len) {
  int rc = lre_exec(capture, bc, (const uint8_t *)u, index, len, 1, lre_opaque());
  if (rc < 0) {
    fflush(stdout);
    scr_trap("scriptc: regular expression execution failed\n");
  }
  return rc;
}

/* Capture buffer sized by lre_get_alloc_count: the register-based executor
 * writes temporary registers past the capture pairs (quickjs.c documents
 * sizing by capture_count*2 as a silent heap overflow). */
static uint8_t **scr_capture_alloc(const uint8_t *bc) {
  int n = lre_get_alloc_count(bc);
  uint8_t **cap = malloc((n > 0 ? (size_t)n : 1) * sizeof *cap);
  if (!cap) scr_regex_oom();
  return cap;
}

/* ECMA-262 AdvanceStringIndex: past a whole surrogate pair under /u, one
 * code unit otherwise — the rule that keeps zero-length matches from
 * looping forever. */
static int scr_advance(const uint16_t *u, int len, int i, bool unicode) {
  if (unicode && i + 1 < len && u[i] >= 0xD800 && u[i] < 0xDC00 &&
      u[i + 1] >= 0xDC00 && u[i + 1] < 0xE000) {
    return i + 2;
  }
  return i + 1;
}

/* ── test ─────────────────────────────────────────────────────────────── */

/* ToLength(lastIndex) for exec/test on a /g or /y regex. */
static double scr_regex_to_length(double v) {
  if (v != v || v <= 0) return 0;
  if (v > 9007199254740991.0) return 9007199254740991.0;
  return floor(v);
}

static double scr_last_exec_idx = -1;
double scr_regex_last_exec_index(void) { return scr_last_exec_idx; }

/* RegExpBuiltinExec's core. On a match fills `capture` (caller-allocated) and
 * answers 1; the caller owns `u`. Stateful regexes read and write lastIndex. */
static int scr_regex_run(ScrRegex *re, const uint8_t *bc, const uint16_t *u, int len,
                         uint8_t **capture) {
  const bool stateful = (lre_get_flags(bc) & (LRE_FLAG_GLOBAL | LRE_FLAG_STICKY)) != 0;
  int start = 0;
  if (stateful) {
    double li = scr_regex_to_length(re->last_index);
    if (li > (double)len) {
      re->last_index = 0;
      scr_last_exec_idx = -1;
      return 0;
    }
    start = (int)li;
  }
  int rc = scr_exec(capture, bc, u, start, len);
  if (rc == 1) {
    const uint8_t *ubase = (const uint8_t *)u;
    scr_last_exec_idx = (double)((capture[0] - ubase) >> 1);
    if (stateful) re->last_index = (double)((capture[1] - ubase) >> 1);
  } else {
    scr_last_exec_idx = -1;
    if (stateful) re->last_index = 0;
  }
  return rc;
}

bool scr_regex_test(ScrRegex *re, ScrStr *s) {
  uint8_t *bc = scr_regex_bc(re);
  int len;
  uint16_t *u = scr_to_utf16(s, &len);
  uint8_t **capture = scr_capture_alloc(bc);
  int rc = scr_regex_run(re, bc, u, len, capture);
  free(capture);
  free(u);
  return rc == 1;
}

/* ── the `.index` side table ──────────────────────────────────────────────
 * A match result is a plain string[]; its `.index` is recorded here, keyed by
 * the array's address, so it survives every binding form (module-level, field,
 * element, return value). The array's `execidx` byte makes scr_arr_release
 * call scr_regex_idx_died, so an address is never reused with a stale entry.
 * Open addressing, linear probing, backward-shift deletion. */
typedef struct { ScrArr *key; double idx; } ScrIdxEnt;
static ScrIdxEnt *scr_idx_tab = NULL;
static size_t scr_idx_cap = 0, scr_idx_n = 0;

static size_t scr_idx_hash(const void *p) {
  uintptr_t x = (uintptr_t)p;
  x ^= x >> 17; x *= 0x9E3779B97F4A7C15ull; x ^= x >> 29;
  return (size_t)x;
}

static void scr_idx_insert_raw(ScrArr *k, double v) {
  size_t i = scr_idx_hash(k) & (scr_idx_cap - 1);
  while (scr_idx_tab[i].key != NULL && scr_idx_tab[i].key != k) i = (i + 1) & (scr_idx_cap - 1);
  if (scr_idx_tab[i].key == NULL) scr_idx_n++;
  scr_idx_tab[i].key = k;
  scr_idx_tab[i].idx = v;
}

static void scr_regex_idx_died(void *arr) {
  if (scr_idx_cap == 0) return;
  size_t i = scr_idx_hash(arr) & (scr_idx_cap - 1);
  while (scr_idx_tab[i].key != NULL && scr_idx_tab[i].key != arr) i = (i + 1) & (scr_idx_cap - 1);
  if (scr_idx_tab[i].key == NULL) return;
  scr_idx_tab[i].key = NULL;
  scr_idx_n--;
  size_t j = (i + 1) & (scr_idx_cap - 1);
  while (scr_idx_tab[j].key != NULL) { /* re-insert the cluster tail */
    ScrArr *k = scr_idx_tab[j].key;
    double v = scr_idx_tab[j].idx;
    scr_idx_tab[j].key = NULL;
    scr_idx_n--;
    scr_idx_insert_raw(k, v);
    j = (j + 1) & (scr_idx_cap - 1);
  }
}

static void scr_regex_note_index(ScrArr *m, double idx) {
  if (scr_idx_n * 2 >= scr_idx_cap) {
    size_t ncap = scr_idx_cap ? scr_idx_cap * 2 : 64;
    ScrIdxEnt *old = scr_idx_tab;
    size_t ocap = scr_idx_cap;
    scr_idx_tab = calloc(ncap, sizeof *scr_idx_tab);
    if (!scr_idx_tab) scr_regex_oom();
    scr_idx_cap = ncap;
    scr_idx_n = 0;
    for (size_t i = 0; i < ocap; i++) if (old[i].key) scr_idx_insert_raw(old[i].key, old[i].idx);
    free(old);
  }
  scr_arr_idx_died_hook = scr_regex_idx_died;
  m->execidx = 1;
  scr_idx_insert_raw(m, idx);
}

double scr_regex_index_of(ScrArr *m) {
  if (m == NULL || scr_idx_cap == 0) return NAN;
  size_t i = scr_idx_hash(m) & (scr_idx_cap - 1);
  while (scr_idx_tab[i].key != NULL) {
    if (scr_idx_tab[i].key == m) return scr_idx_tab[i].idx;
    i = (i + 1) & (scr_idx_cap - 1);
  }
  return NAN;
}

/* re.exec(s): the honest string[] slice of the match (match()'s rule:
 * nonparticipating captures are ""), or NULL. */
ScrArr *scr_regex_exec(ScrStr *s, ScrRegex *re) {
  uint8_t *bc = scr_regex_bc(re);
  int len;
  uint16_t *u = scr_to_utf16(s, &len);
  uint8_t **capture = scr_capture_alloc(bc);
  int rc = scr_regex_run(re, bc, u, len, capture);
  ScrArr *out = NULL;
  if (rc == 1) {
    const uint8_t *ubase = (const uint8_t *)u;
    int count = lre_get_capture_count(bc);
    out = scr_arr_new(SCR_ELEM_STR, (size_t)count);
    for (int k = 0; k < count; k++) {
      const uint8_t *cs = capture[2 * k], *ce = capture[2 * k + 1];
      if (cs == NULL || ce == NULL) {
        scr_arr_push_ref(out, scr_str_new("", 0));
      } else {
        scr_arr_push_ref(
            out, scr_str_from_utf16(u, (int)((cs - ubase) >> 1), (int)((ce - ubase) >> 1)));
      }
    }
    scr_regex_note_index(out, scr_last_exec_idx);
  }
  free(capture);
  free(u);
  return out;
}

/* ── match ────────────────────────────────────────────────────────────── */

/* s.match(re): without g, Node's exec-shaped result reduced to
 * the honest slice — a fresh string[] of [whole match, ...captures], or
 * NULL for no match (the compiler wraps the `string[] | null` union). A
 * NONPARTICIPATING capture holds "" where Node's slot is undefined
 * (truthiness tests agree; SEMANTICS.md documents the divergence). With g
 * it is the array of every match's text (below). */
ScrArr *scr_regex_match(ScrStr *s, ScrRegex *re) {
  uint8_t *bc = scr_regex_bc(re);
  const int re_flags = lre_get_flags(bc);
  if (!(re_flags & LRE_FLAG_GLOBAL)) {
    /* RegExp.prototype[Symbol.match] without g is RegExpExec: stateless for
     * a plain regex, lastIndex-driven for /y (scr_regex_run's rule). */
    return scr_regex_exec(s, re);
  }
  /* The g branch: lastIndex := 0, then every match's text (never the
   * captures, never `.index`), zero-length matches stepping one unit
   * (AdvanceStringIndex, unicode-aware). The loop ends on a failed exec,
   * which leaves lastIndex 0 — the value Node leaves. Under gy each probe
   * is anchored at lastIndex by the bytecode's sticky flag. */
  const bool unicode = (re_flags & (LRE_FLAG_UNICODE | LRE_FLAG_UNICODE_SETS)) != 0;
  int len;
  uint16_t *u = scr_to_utf16(s, &len);
  uint8_t **capture = scr_capture_alloc(bc);
  const uint8_t *ubase = (const uint8_t *)u;
  ScrArr *out = NULL;
  int pos = 0;
  while (pos <= len) {
    if (scr_exec(capture, bc, u, pos, len) != 1) break;
    const int start = (int)((capture[0] - ubase) >> 1);
    const int end = (int)((capture[1] - ubase) >> 1);
    if (out == NULL) out = scr_arr_new(SCR_ELEM_STR, 4);
    scr_arr_push_ref(out, scr_str_from_utf16(u, start, end));
    pos = end == start ? scr_advance(u, len, end, unicode) : end;
  }
  re->last_index = 0;
  scr_last_exec_idx = -1;
  free(capture);
  free(u);
  return out; /* +1, or NULL (no match): a g-match array carries no .index */
}

/* ── search ───────────────────────────────────────────────────────────── */

/* s.search(re): the first match's UTF-16 index, or -1 — Symbol.search's
 * fresh exec from position 0. lastIndex is neither read nor written in JS
 * (the spec saves and restores it), so no flag fence applies here, unlike
 * test/match: /g is irrelevant and /y anchors at 0 (libregexp's sticky
 * bytecode omits the implicit forward scan) — exactly Node. */
double scr_regex_search(ScrStr *s, ScrRegex *re) {
  uint8_t *bc = scr_regex_bc(re);
  int len;
  uint16_t *u = scr_to_utf16(s, &len);
  uint8_t **capture = scr_capture_alloc(bc);
  int rc = scr_exec(capture, bc, u, 0, len);
  double out = -1;
  if (rc == 1) out = (double)((capture[0] - (const uint8_t *)u) >> 1);
  free(capture);
  free(u);
  return out;
}

/* matchAll(re): every match as its honest slice string[] (whole match +
 * captures, nonparticipating = "" — match()'s rule) drained EAGERLY into
 * a fresh string[][]. The lazy iterator is unobservable across the
 * lowered surface: strings are immutable and the spec clones the regex at
 * the call, so nothing can perturb the drain. Non-global regexes throw
 * Node's exact TypeError (catchable — replaceAll's stance). Empty matches
 * advance one unit, unicode-aware (AdvanceStringIndex). `indices`, when
 * non-NULL, receives each match's UTF-16 start index (the row's .index —
 * the companion array the for-of-over-matchAll desugar reads). */
static ScrArr *scr_regex_match_all_core(ScrStr *s, ScrRegex *re, ScrArr *indices,
                                        bool for_replace) {
  uint8_t *bc = scr_regex_bc(re);
  int re_flags = lre_get_flags(bc);
  if (!for_replace && !(re_flags & LRE_FLAG_GLOBAL)) {
    static const char msg[] =
        "String.prototype.matchAll called with a non-global RegExp argument";
    scr_throw_error_msg(SCR_ERR_TYPE, msg, sizeof msg - 1);
    return NULL; /* callers are compiler-emitted pending checks */
  }
  bool unicode = (re_flags & (LRE_FLAG_UNICODE | LRE_FLAG_UNICODE_SETS)) != 0;
  int capture_count = lre_get_capture_count(bc);
  int len;
  uint16_t *u = scr_to_utf16(s, &len);
  uint8_t **capture = scr_capture_alloc(bc);
  const uint8_t *ubase = (const uint8_t *)u;
  ScrArr *out = scr_arr_new(SCR_ELEM_ARR, 4);
  /* The spec clones the regex WITH its lastIndex (the original is neither
   * read afterwards nor written), so the drain starts there. */
  double li = scr_regex_to_length(re->last_index);
  const bool global = (re_flags & LRE_FLAG_GLOBAL) != 0;
  const bool sticky = (re_flags & LRE_FLAG_STICKY) != 0;
  /* The replace drain (Symbol.replace): g starts at 0; non-g /y at
   * lastIndex; a plain regex at 0 and neither state nor loop. */
  if (for_replace && global) li = 0;
  if (for_replace && !global && !sticky) li = 0;
  int pos = li > (double)len ? len + 1 : (int)li;
  if (for_replace && !global && sticky && li > (double)len) re->last_index = 0;
  while (pos <= len) {
    if (scr_exec(capture, bc, u, pos, len) != 1) {
      if (for_replace && !global && sticky) re->last_index = 0;
      break;
    }
    int start = (int)((capture[0] - ubase) >> 1);
    int end = (int)((capture[1] - ubase) >> 1);
    ScrArr *row = scr_arr_new(SCR_ELEM_STR, (size_t)capture_count);
    for (int k = 0; k < capture_count; k++) {
      const uint8_t *cs = capture[2 * k], *ce = capture[2 * k + 1];
      if (cs == NULL || ce == NULL) {
        scr_arr_push_ref(row, scr_str_new("", 0));
      } else {
        scr_arr_push_ref(
            row, scr_str_from_utf16(u, (int)((cs - ubase) >> 1), (int)((ce - ubase) >> 1)));
      }
    }
    scr_regex_note_index(row, (double)start);
    scr_arr_push_ref(out, row);
    if (indices != NULL) scr_arr_push_f64(indices, (double)start);
    if (for_replace && !global) {
      if (sticky) re->last_index = (double)end;
      break;
    }
    pos = end == start ? scr_advance(u, len, end, unicode) : end;
  }
  if (for_replace && global) re->last_index = 0;
  free(capture);
  free(u);
  return out; /* +1 (possibly empty — Node's no-match drain is []) */
}

ScrArr *scr_regex_match_all(ScrStr *s, ScrRegex *re) {
  return scr_regex_match_all_core(s, re, NULL, false);
}

ScrArr *scr_regex_match_all_into(ScrStr *s, ScrRegex *re, ScrArr *indices) {
  return scr_regex_match_all_core(s, re, indices, false);
}

ScrArr *scr_regex_replace_rows_into(ScrStr *s, ScrRegex *re, ScrArr *indices) {
  return scr_regex_match_all_core(s, re, indices, true);
}

/* ── replace / replaceAll ─────────────────────────────────────────────── */

/* ECMA-262 GetSubstitution over the replacement TEMPLATE (function
 * replacements are frontend-fenced): $$, $&, $` and $', $1..$99 (two digits
 * win when in range — the refined ES2019 rule quickjs implements), with
 * out-of-range references left literal and unmatched groups substituting
 * empty. $<name> resolves against the pattern's named capture groups
 * (lre_get_groupnames — one NUL-terminated name per capture, "" for
 * unnamed): the first PARTICIPATING capture with that name substitutes
 * (ES2025 duplicates live in distinct alternatives, so at most one
 * participates); a nonexistent or nonparticipating name substitutes
 * empty (the spec's Get→undefined→"" path, Node-exact). When the pattern
 * has NO named groups, namedCaptures is undefined and '$<' stays literal
 * — also Node's unterminated-'$<name' answer either way. The template is
 * scanned byte-wise: every '$' directive is ASCII, and UTF-8 continuation
 * bytes can never alias it. */
static void scr_put_substitution(ScrJsonBuf *b, const uint16_t *u, int len,
                                  int start, int end, uint8_t **capture,
                                  int capture_count, const char *groupnames,
                                  const ScrStr *rep) {
  const uint8_t *ubase = (const uint8_t *)u;
  size_t i = 0;
  while (i < rep->len) {
    char c = rep->data[i];
    if (c != '$' || i + 1 >= rep->len) {
      scr_jb_putc(b, c);
      i++;
      continue;
    }
    char c1 = rep->data[i + 1];
    if (c1 == '$') {
      scr_jb_putc(b, '$');
      i += 2;
    } else if (c1 == '&') {
      scr_jb_put_utf16(b, u, start, end);
      i += 2;
    } else if (c1 == '`') {
      scr_jb_put_utf16(b, u, 0, start);
      i += 2;
    } else if (c1 == '\'') {
      scr_jb_put_utf16(b, u, end, len);
      i += 2;
    } else if (c1 >= '0' && c1 <= '9') {
      int k = c1 - '0';
      size_t adv = 2;
      if (i + 2 < rep->len && rep->data[i + 2] >= '0' && rep->data[i + 2] <= '9') {
        int k1 = k * 10 + (rep->data[i + 2] - '0');
        if (k1 >= 1 && k1 < capture_count) {
          k = k1;
          adv = 3;
        }
      }
      if (k >= 1 && k < capture_count) {
        const uint8_t *cs = capture[2 * k], *ce = capture[2 * k + 1];
        if (cs && ce) {
          scr_jb_put_utf16(b, u, (int)((cs - ubase) >> 1), (int)((ce - ubase) >> 1));
        }
        i += adv;
      } else {
        /* Out of range: the '$' is literal (the digits re-scan verbatim). */
        scr_jb_putc(b, '$');
        i++;
      }
    } else if (c1 == '<' && groupnames != NULL) {
      /* $<name>: scan for '>'; absent, the '$' is literal (the rest
       * re-scans verbatim — GetSubstitution's not-found answer). */
      size_t gt = i + 2;
      while (gt < rep->len && rep->data[gt] != '>') gt++;
      if (gt >= rep->len) {
        scr_jb_putc(b, '$');
        i++;
        continue;
      }
      const char *name = rep->data + i + 2;
      size_t name_len = gt - (i + 2);
      const char *p = groupnames; /* capture_count-1 entries: name NUL scope */
      for (int k = 1; k < capture_count; k++) {
        size_t glen = strlen(p);
        if (glen == name_len && memcmp(p, name, name_len) == 0) {
          const uint8_t *cs = capture[2 * k], *ce = capture[2 * k + 1];
          if (cs && ce) {
            scr_jb_put_utf16(b, u, (int)((cs - ubase) >> 1), (int)((ce - ubase) >> 1));
            break; /* at most one duplicate participates */
          }
        }
        p += glen + LRE_GROUP_NAME_TRAILER_LEN;
      }
      i = gt + 1;
    } else {
      scr_jb_putc(b, '$');
      i++;
    }
  }
}

/* The shared match loop (the shape of quickjs's JS_RegExpDelete): search
 * from `pos`, copy the gap, emit the substitution, continue from the match
 * end when global — advancing zero-length matches per AdvanceStringIndex. */
static ScrStr *scr_replace_impl(ScrStr *s, ScrRegex *re, ScrStr *rep) {
  uint8_t *bc = scr_regex_bc(re);
  int re_flags = lre_get_flags(bc);
  bool global = (re_flags & LRE_FLAG_GLOBAL) != 0;
  bool unicode = (re_flags & (LRE_FLAG_UNICODE | LRE_FLAG_UNICODE_SETS)) != 0;
  int capture_count = lre_get_capture_count(bc);
  const char *groupnames = lre_get_groupnames(bc);
  int len;
  uint16_t *u = scr_to_utf16(s, &len);
  uint8_t **capture = scr_capture_alloc(bc);
  const uint8_t *ubase = (const uint8_t *)u;
  ScrJsonBuf b;
  scr_jb_init(&b);
  const bool sticky = (re_flags & LRE_FLAG_STICKY) != 0;
  int next = 0, pos = 0;
  /* RegExp.prototype[Symbol.replace]: g resets lastIndex to 0 and leaves it
   * 0 (the final failed exec); a sticky non-global regex runs ONE exec from
   * lastIndex and stores the match end (0 on failure) — scr_regex_run's
   * rule. A plain regex never touches lastIndex. */
  if (!global && sticky) {
    double li = scr_regex_to_length(re->last_index);
    if (li > (double)len) {
      re->last_index = 0;
      pos = len + 1;
    } else {
      pos = (int)li;
    }
  }
  while (pos <= len) {
    if (scr_exec(capture, bc, u, pos, len) != 1) {
      if (!global && sticky) re->last_index = 0;
      break;
    }
    int start = (int)((capture[0] - ubase) >> 1);
    int end = (int)((capture[1] - ubase) >> 1);
    scr_jb_put_utf16(&b, u, next, start);
    scr_put_substitution(&b, u, len, start, end, capture, capture_count, groupnames, rep);
    next = end;
    if (!global) {
      if (sticky) re->last_index = (double)end;
      break;
    }
    pos = end == start ? scr_advance(u, len, end, unicode) : end;
  }
  if (global) re->last_index = 0;
  scr_jb_put_utf16(&b, u, next, len);
  free(capture);
  free(u);
  return scr_jb_finish(&b);
}

ScrStr *scr_regex_replace(ScrStr *s, ScrRegex *re, ScrStr *rep) {
  return scr_replace_impl(s, re, rep);
}

ScrStr *scr_regex_replace_all(ScrStr *s, ScrRegex *re, ScrStr *rep) {
  if (!(lre_get_flags(scr_regex_bc(re)) & LRE_FLAG_GLOBAL)) {
    /* Node's exact TypeError — a real instance now: catch bindings narrow
     * it and e.message carries V8's text byte-for-byte. */
    static const char msg[] =
        "String.prototype.replaceAll called with a non-global RegExp argument";
    scr_throw_error_msg(SCR_ERR_TYPE, msg, sizeof msg - 1);
    return NULL; /* callers are compiler-emitted pending checks */
  }
  return scr_replace_impl(s, re, rep);
}

/* ── split ────────────────────────────────────────────────────────────── */

ScrArr *scr_regex_split(ScrStr *s, ScrRegex *re) {
  uint8_t *bc = scr_regex_bc(re);
  /* JS splices every capture group's value into the result after each
   * piece. A nonparticipating group is the ABSENT string (empty, but its
   * identity is Node's undefined: scr_str_absent). */
  const int capture_count = lre_get_capture_count(bc);
  int re_flags = lre_get_flags(bc);
  bool unicode = (re_flags & (LRE_FLAG_UNICODE | LRE_FLAG_UNICODE_SETS)) != 0;
  bool sticky = (re_flags & LRE_FLAG_STICKY) != 0;
  int len;
  uint16_t *u = scr_to_utf16(s, &len);
  uint8_t **capture = scr_capture_alloc(bc);
  const uint8_t *ubase = (const uint8_t *)u;
  ScrArr *out = scr_arr_new(SCR_ELEM_STR, 0);

  /* ECMA-262 22.2.6.14 (Symbol.split, no limit). The spec probes every
   * position with a sticky matcher; for non-sticky patterns a forward
   * SEARCH from q is equivalent (the earliest match position >= q is the
   * first probe that would succeed) and one exec replaces the per-position
   * loop. A genuinely sticky pattern keeps the spec's probe-and-advance. */
  if (len == 0) {
    /* Empty subject: one probe — a match yields [], no match yields [""]. */
    if (scr_exec(capture, bc, u, 0, len) != 1) {
      scr_arr_push_ref(out, scr_str_new("", 0));
    }
    free(capture);
    free(u);
    return out;
  }
  int p = 0, q = 0;
  while (q < len) {
    if (scr_exec(capture, bc, u, q, len) != 1) {
      if (!sticky) break; /* no match anywhere right of q */
      q = scr_advance(u, len, q, unicode);
      continue;
    }
    int start = (int)((capture[0] - ubase) >> 1);
    int end = (int)((capture[1] - ubase) >> 1);
    if (start >= len) break; /* the spec never probes position len */
    if (end == p) {
      /* Zero-length match adjacent to the previous split point: advance
       * (start == q == p here — the search cannot skip a match). */
      q = scr_advance(u, len, start, unicode);
    } else {
      scr_arr_push_ref(out, scr_str_from_utf16(u, p, start));
      for (int k = 1; k < capture_count; k++) {
        const uint8_t *cs = capture[2 * k], *ce = capture[2 * k + 1];
        if (cs == NULL || ce == NULL) {
          scr_arr_push_ref(out, scr_str_absent());
        } else {
          scr_arr_push_ref(
              out, scr_str_from_utf16(u, (int)((cs - ubase) >> 1), (int)((ce - ubase) >> 1)));
        }
      }
      p = end;
      q = p;
    }
  }
  scr_arr_push_ref(out, scr_str_from_utf16(u, p, len));
  free(capture);
  free(u);
  return out;
}

/* ── String.prototype.toLowerCase / toUpperCase (the static path) ──────
 * ECMA-262 Default Case Conversion via the vendored libunicode's
 * lre_case_conv — the exact tables and algorithm the engine's own
 * String.prototype methods run (quickjs.c's js_string_toLowerCase), the
 * context-sensitive Greek final-sigma rule included. Lives HERE, not in
 * scr_string.c, because it needs libunicode: the compiler sets the lre
 * link flag for case-conversion sites exactly like regex nodes, so
 * case-free (and regex-free) programs keep their historical link line.
 * Node runs full ICU case mapping, but for the locale-independent
 * toLowerCase/toUpperCase the two agree — ICU's locale tailorings
 * (Turkish/Azeri dotted I, Lithuanian accent handling) apply only to
 * toLocaleLowerCase with an explicit locale, which stays fenced. The
 * receiver is BORROWED; the result is a fresh +1 string. */

/* Decode the code point at p (well-formed UTF-8); *adv gets the length. */
static uint32_t scr_case_decode(const char *p, size_t *adv) {
  unsigned char c = (unsigned char)p[0];
  if (c < 0x80) {
    *adv = 1;
    return c;
  }
  if (c < 0xE0) {
    *adv = 2;
    return ((uint32_t)(c & 0x1F) << 6) | ((unsigned char)p[1] & 0x3F);
  }
  if (c < 0xF0) {
    *adv = 3;
    return ((uint32_t)(c & 0x0F) << 12) |
           ((uint32_t)((unsigned char)p[1] & 0x3F) << 6) |
           ((unsigned char)p[2] & 0x3F);
  }
  *adv = 4;
  return ((uint32_t)(c & 0x07) << 18) |
         ((uint32_t)((unsigned char)p[1] & 0x3F) << 12) |
         ((uint32_t)((unsigned char)p[2] & 0x3F) << 6) |
         ((unsigned char)p[3] & 0x3F);
}

/* Step back one code point from *off (> 0) and decode it. */
static uint32_t scr_case_prev(const ScrStr *s, size_t *off) {
  size_t i = *off;
  do {
    i--;
  } while (i > 0 && ((unsigned char)s->data[i] & 0xC0) == 0x80);
  *off = i;
  size_t adv;
  return scr_case_decode(s->data + i, &adv);
}

/* Unicode Final_Sigma: Σ is preceded by a cased letter (after skipping
 * case-ignorable characters) and NOT followed by one — quickjs.c's
 * test_final_sigma over the UTF-8 storage. `next_off` is the byte offset
 * just past the sigma. */
static bool scr_final_sigma(const ScrStr *s, size_t sigma_off, size_t next_off) {
  size_t k = sigma_off;
  uint32_t c1;
  for (;;) {
    if (k == 0) return false; /* nothing cased before C */
    c1 = scr_case_prev(s, &k);
    if (!lre_is_case_ignorable(c1)) break;
  }
  if (!lre_is_cased(c1)) return false;
  k = next_off;
  for (;;) {
    if (k >= s->len) return true;
    size_t adv;
    c1 = scr_case_decode(s->data + k, &adv);
    k += adv;
    if (!lre_is_case_ignorable(c1)) break;
  }
  return !lre_is_cased(c1);
}

/* Append one code point as UTF-8 (case results never mint surrogates). */
static void scr_case_put_cp(ScrJsonBuf *b, uint32_t cp) {
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

static ScrStr *scr_str_case_conv(const ScrStr *s, int to_lower) {
  ScrJsonBuf b;
  scr_jb_init(&b);
  uint32_t res[LRE_CC_RES_LEN_MAX];
  for (size_t i = 0; i < s->len;) {
    size_t adv;
    uint32_t c = scr_case_decode(s->data + i, &adv);
    int l;
    if (c == 0x3a3 && to_lower && scr_final_sigma(s, i, i + adv)) {
      res[0] = 0x3c2; /* final sigma */
      l = 1;
    } else {
      l = lre_case_conv(res, c, to_lower);
    }
    i += adv;
    for (int j = 0; j < l; j++) scr_case_put_cp(&b, res[j]);
  }
  return scr_jb_finish(&b);
}

ScrStr *scr_str_to_lower(const ScrStr *s) { return scr_str_case_conv(s, 1); }
ScrStr *scr_str_to_upper(const ScrStr *s) { return scr_str_case_conv(s, 0); }

/* ── String.prototype.normalize (the static path) ────────────────────────
 * ECMA-262 String.prototype.normalize over the vendored libunicode's
 * unicode_normalize (the same decomposition, combining-class and
 * composition tables quickjs.c's own normalize runs). Lives here for the
 * same reason as the case conversion above: it needs libunicode, and the
 * compiler sets the lre link flag for normalize sites. The form is
 * validated at runtime (Node's RangeError message; scr_trap is this
 * runtime's uncatchable RangeError convention, as repeat's count check).
 * Borrows s and form; the result is a fresh +1 string. */
static void *scr_norm_realloc(void *opaque, void *ptr, size_t size) {
  (void)opaque;
  if (size == 0) {
    free(ptr);
    return NULL;
  }
  void *p = realloc(ptr, size);
  if (!p) abort();
  return p;
}

static int scr_norm_form_is(const ScrStr *form, const char *name) {
  size_t n = strlen(name);
  return form->len == n && memcmp(form->data, name, n) == 0;
}

ScrStr *scr_str_normalize(const ScrStr *s, const ScrStr *form) {
  int nt;
  if (scr_norm_form_is(form, "NFC")) nt = UNICODE_NFC;
  else if (scr_norm_form_is(form, "NFD")) nt = UNICODE_NFD;
  else if (scr_norm_form_is(form, "NFKC")) nt = UNICODE_NFKC;
  else if (scr_norm_form_is(form, "NFKD")) nt = UNICODE_NFKD;
  else scr_trap("scriptc: RangeError: The normalization form should be one of NFC, NFD, NFKC, NFKD.\n");
  uint32_t *src = malloc(sizeof(uint32_t) * (s->len ? s->len : 1));
  if (!src) abort();
  size_t n = 0;
  for (size_t i = 0; i < s->len;) {
    size_t adv;
    src[n++] = scr_case_decode(s->data + i, &adv);
    i += adv;
  }
  uint32_t *dst = NULL;
  int out = unicode_normalize(&dst, src, (int)n, nt, NULL, scr_norm_realloc);
  free(src);
  if (out < 0) abort();
  ScrJsonBuf b;
  scr_jb_init(&b);
  for (int j = 0; j < out; j++) scr_case_put_cp(&b, dst[j]);
  free(dst);
  return scr_jb_finish(&b);
}

/* ── assert.match / assert.doesNotMatch ──────────────────────────────────
 * Lives here (not scr_assert.c) because it needs the matcher, and every
 * call site carries a regex value — the regex link switch is already on,
 * so assert-only binaries never pull libregexp. A fresh exec from index 0:
 * Node's exec on a fresh regex literal; lastIndex statefulness is not
 * modeled anywhere in this runtime, so g/y-flagged regexes test like
 * their flag-free twins here instead of aborting (assert.match(s, /x/g)
 * works in Node — matching that beats scr_regex_test's fence;
 * SEMANTICS.md 107 covers reused stateful regexes). */
/* A fresh exec from index 0 (assert.match's stance: g/y-flagged regexes
 * test like their flag-free twins here — SEMANTICS.md 107 covers reused
 * stateful regexes). */
static bool scr_assert_regex_hits(ScrRegex *re, ScrStr *s) {
  uint8_t *bc = scr_regex_bc(re);
  int len;
  uint16_t *u = scr_to_utf16(s, &len);
  uint8_t **capture = scr_capture_alloc(bc);
  bool matched = scr_exec(capture, bc, u, 0, len) == 1;
  free(capture);
  free(u);
  return matched;
}

/* The regex's own inspection — /source/ + FLAGS IN GETTER ORDER
 * (dgimsuvy), not source order. +1. */
static ScrStr *scr_assert_regex_render(ScrRegex *re) {
  size_t cap = re->source->len + re->flags->len + 2;
  char *buf = malloc(cap);
  if (!buf) scr_trap("scriptc: out of memory\n");
  size_t n = 0;
  buf[n++] = '/';
  memcpy(buf + n, re->source->data, re->source->len);
  n += re->source->len;
  buf[n++] = '/';
  for (const char *f = "dgimsuvy"; *f; f++) {
    for (size_t i = 0; i < re->flags->len; i++) {
      if (re->flags->data[i] == *f) buf[n++] = *f;
    }
  }
  ScrStr *out = scr_str_new(buf, n);
  free(buf);
  return out;
}

/* Node's regex-mismatch AssertionError: 'The input did not match the
 * regular expression /re/flags. Input:\n\n<inspect(input)>\n' (the
 * was-expected-to-not-match head when negated). Always throws. */
static void scr_assert_regex_input_fail(bool negated, ScrRegex *re, ScrStr *input) {
  ScrStr *insp = scr_assert_inspect_str(input);
  ScrStr *rre = scr_assert_regex_render(re);
  const char *head = negated
      ? "The input was expected to not match the regular expression "
      : "The input did not match the regular expression ";
  const char *mid = ". Input:\n\n";
  size_t cap = strlen(head) + rre->len + strlen(mid) + insp->len + 1;
  char *buf = malloc(cap);
  if (!buf) scr_trap("scriptc: out of memory\n");
  size_t n = 0;
  memcpy(buf + n, head, strlen(head));
  n += strlen(head);
  memcpy(buf + n, rre->data, rre->len);
  n += rre->len;
  memcpy(buf + n, mid, strlen(mid));
  n += strlen(mid);
  memcpy(buf + n, insp->data, insp->len);
  n += insp->len;
  buf[n++] = '\n';
  scr_str_release(insp);
  scr_str_release(rre);
  ScrStr *message = scr_str_new(buf, n);
  free(buf);
  scr_assert_fail_msg(message);
}

void scr_assert_match(ScrStr *s, ScrRegex *re, bool negated, ScrStr *msg,
                      bool has_msg) {
  bool matched = scr_assert_regex_hits(re, s);
  if (negated ? !matched : matched) return;
  if (has_msg) {
    scr_assert_fail_msg(scr_str_retain(msg));
    return;
  }
  scr_assert_regex_input_fail(negated, re, s);
}

/* assert.throws(fn, /re/) whose thrown Error did not satisfy the regex:
 * Node tests String(actual) — Error.prototype.toString's "Name: message"
 * — and reports the mismatch with that string inspected. */
void scr_assert_throws_regex(ScrRegex *re, ScrError *err, ScrStr *msg, bool has_msg) {
  ScrStr *str = scr_error_to_string(err);
  bool matched = scr_assert_regex_hits(re, str);
  if (matched) {
    scr_str_release(str);
    return;
  }
  if (has_msg) {
    scr_str_release(str);
    scr_assert_fail_msg(scr_str_retain(msg));
    return;
  }
  scr_assert_regex_input_fail(false, re, str);
  scr_str_release(str);
}

/* assert.doesNotReject's regex predicate: does String(error) satisfy the
 * regex? Never throws — the caller inverts the verdict into either the
 * unwanted-rejection AssertionError or a rethrow of the original. */
bool scr_assert_regex_err_test(ScrRegex *re, ScrError *err) {
  ScrStr *str = scr_error_to_string(err);
  bool matched = scr_assert_regex_hits(re, str);
  scr_str_release(str);
  return matched;
}

/* The regex-valued shape slot (assert.throws(fn, {message: /re/})):
 * test the stashed actual key eagerly and store verdict + rendering, so
 * scr_assert.c's comparison and diff stay libregexp-free. An absent
 * actual key (NULL code) is a mismatch — Node's `key in actual` test. */
void scr_assert_shape_re(int key, ScrRegex *re) {
  ScrStr *actual = scr_assert_shape_actual(key);
  bool matched = actual != NULL && scr_assert_regex_hits(re, actual);
  scr_assert_shape_slot_re(key, matched, scr_assert_regex_render(re));
}

/* ── new RegExp(pattern, flags) — runtime construction ────────────────
 * A heap ScrRegex (rc 1) over the same engine the literals use. The
 * pattern compiles EAGERLY so an invalid pattern throws Node's catchable
 * SyntaxError at construction (Node: "Invalid regular expression:
 * /pat/: detail" — the detail text is libregexp's, approximate fidelity
 * by design; e.name is exact). A bad flag string throws Node's
 * "Invalid flags supplied to RegExp constructor '<flags>'". An empty
 * pattern stores the spec's "(?:)" source, like Node. Borrows both; +1.
 *
 * The flag string is validated WHOLE before the pattern is looked at,
 * because Node does: three separate things are the same SyntaxError, and
 * measuring them against node v25.9.0 rather than reading one of them out
 * of the old code is what found the second and third.
 *
 *   an unknown letter   new RegExp("a", "x")   -> SyntaxError
 *   a REPEATED letter   new RegExp("a", "gg")  -> SyntaxError
 *   'u' AND 'v'         new RegExp("a", "uv")  -> SyntaxError
 *
 * and the message quotes the flags in full — node prints all forty of a
 * forty-character string, where this used to print twenty.
 *
 * 'v' (unicodeSets) IS accepted: it is LRE_FLAG_UNICODE_SETS, which the
 * vendored libregexp implements and which three sites in this file
 * already read beside LRE_FLAG_UNICODE.
 *
 * 'd' (hasIndices) is deliberately NOT accepted, and this is the one
 * letter where the SyntaxError above is not Node's answer — node builds
 * the regex. There is no LRE flag for it and a match result here carries
 * no `indices`, so admitting the letter would answer the question wrongly
 * instead of refusing it. Taking 'd' means taking the whole `indices`
 * surface. */
ScrRegex *scr_regex_new(ScrStr *pattern, ScrStr *flags) {
  /* 'd' is LAST so the u/v bit positions below keep their indices. */
  static const char kFlagAlphabet[] = "gimsuvyd";
  static const char kFlagAlphabetOrder[] = "dgimsuvy"; /* the GETTER order */
  unsigned seen = 0;
  bool bad_flags = false;
  for (size_t i = 0; i < flags->len; i++) {
    const char c = flags->data[i];
    const char *at = c ? strchr(kFlagAlphabet, c) : NULL;
    if (!at) { bad_flags = true; break; }
    const unsigned bit = 1u << (unsigned)(at - kFlagAlphabet);
    if (seen & bit) { bad_flags = true; break; } /* a repeat is an error */
    seen |= bit;
  }
  /* /u and /v are two different pattern grammars, not two switches. */
  if ((seen & (1u << 4)) && (seen & (1u << 5))) bad_flags = true;
  if (bad_flags) {
    const size_t cap = flags->len + 64; /* the fixed text is 47 bytes */
    char *msg = malloc(cap);
    if (!msg) scr_trap("scriptc: out of memory\n");
    int n = snprintf(msg, cap,
                     "Invalid flags supplied to RegExp constructor '%.*s'",
                     (int)flags->len, flags->data);
    if (n < 0) n = 0;
    if ((size_t)n >= cap) n = (int)(cap - 1);
    scr_throw_error_msg(SCR_ERR_SYNTAX, msg, (size_t)n);
    free(msg);
    return NULL;
  }
  /* The flag string is OBSERVABLE — re.flags, String(re), inspect and the
   * invalid-pattern SyntaxError all quote it — and JS reports it in GETTER
   * order (dgimsuvy), never the order it was passed: node answers
   * new RegExp("a","yg").flags with "gy". Store it normalised ONCE here, so
   * every reader downstream is right without knowing about it. (Literals
   * are normalised in the frontend, at lowerRegexLiteral — the two
   * constructors are the only two places a flag string is born.) The
   * VALIDATION above deliberately ran on the string as passed, because the
   * error message quotes what the caller wrote. */
  char ordered[8];
  size_t olen = 0;
  for (const char *f = kFlagAlphabetOrder; *f; f++) {
    for (size_t i = 0; i < flags->len; i++) {
      if (flags->data[i] == *f) { ordered[olen++] = *f; break; }
    }
  }
  ScrRegex *re = calloc(1, sizeof *re);
  if (!re) {
    scr_trap("scriptc: out of memory\n");
  }
  re->rc = 1;
  re->source = pattern->len > 0 ? scr_str_retain(pattern) : scr_str_new("(?:)", 4);
  re->flags = scr_str_new(ordered, olen);
  /* Eager compile — the literal path stays lazy (its failure is an
   * abort; tsc already parsed those patterns). */
  int lre_flags = scr_lre_flags(re->flags);
  const char *pat = re->source->data;
  size_t pat_len = re->source->len;
  char *cesu = NULL;
  if (!(lre_flags & (LRE_FLAG_UNICODE | LRE_FLAG_UNICODE_SETS))) {
    cesu = scr_pattern_cesu8(re->source, &pat_len);
    if (cesu) pat = cesu;
  }
  char error_msg[64];
  int bc_len;
  uint8_t *bc = lre_compile(&bc_len, error_msg, sizeof error_msg, pat, pat_len,
                            lre_flags, lre_opaque());
  free(cesu);
  if (!bc) {
    char msg[192];
    int n = snprintf(msg, sizeof msg, "Invalid regular expression: /%.64s/%.8s: %s",
                     re->source->data, re->flags->data, error_msg);
    scr_str_release(re->source);
    scr_str_release(re->flags);
    free(re);
    scr_throw_error_msg(SCR_ERR_SYNTAX, msg, (size_t)n);
    return NULL;
  }
  re->bc = bc;
  return re;
}

/* Decode the code point at p (well-formed UTF-8 by the string
 * invariant); *adv gets the byte length of the sequence. */
static uint32_t scr_re_utf8_decode(const char *p, size_t *adv) {
  unsigned char c = (unsigned char)p[0];
  if (c < 0x80) { *adv = 1; return c; }
  if (c < 0xE0) { *adv = 2; return ((uint32_t)(c & 0x1F) << 6) | ((unsigned char)p[1] & 0x3F); }
  if (c < 0xF0) {
    *adv = 3;
    return ((uint32_t)(c & 0x0F) << 12) | ((uint32_t)((unsigned char)p[1] & 0x3F) << 6) | ((unsigned char)p[2] & 0x3F);
  }
  *adv = 4;
  return ((uint32_t)(c & 0x07) << 18) | ((uint32_t)((unsigned char)p[1] & 0x3F) << 12) |
         ((uint32_t)((unsigned char)p[2] & 0x3F) << 6) | ((unsigned char)p[3] & 0x3F);
}

/* ── RegExp.escape ────────────────────────────────────────────────────
 * ECMA-262 (ES2025) RegExp.escape over the UTF-8 storage. Per-code-point
 * EncodeForRegExpEscape: a LEADING ASCII letter/digit hex-escapes (so a
 * concatenation can't extend a token), SyntaxCharacters and '/' take a
 * backslash, the "other punctuators" ∪ WhiteSpace ∪ LineTerminator set
 * hex-escapes (\xNN below U+0100, \uNNNN above — lowercase hex, per
 * spec), and everything else passes through. The spec's surrogate arm is
 * unreachable over well-formed storage (SEMANTICS.md 2). Borrows s;
 * result +1. */
static bool scr_regexp_syntax_char(uint32_t cp) {
  switch (cp) {
    case '^': case '$': case '\\': case '.': case '*': case '+': case '?':
    case '(': case ')': case '[': case ']': case '{': case '}': case '|':
    case '/':
      return true;
    default:
      return false;
  }
}

/* The ControlEscape arm: TAB/LF/VT/FF/CR escape as \t \n \v \f \r (the
 * spec maps them through ControlEscape before the hex arm). Returns the
 * escape letter, or 0 when cp isn't one of the five. */
static char scr_regexp_control_escape(uint32_t cp) {
  switch (cp) {
    case 0x09: return 't';
    case 0x0A: return 'n';
    case 0x0B: return 'v';
    case 0x0C: return 'f';
    case 0x0D: return 'r';
    default: return 0;
  }
}

static bool scr_regexp_hex_escaped(uint32_t cp) {
  switch (cp) {
    /* other punctuators */
    case ',': case '-': case '=': case '<': case '>': case '#': case '&':
    case '!': case '%': case ':': case ';': case '@': case '~': case '\'':
    case '`': case '"':
      return true;
    /* WhiteSpace ∪ LineTerminator less the ControlEscape five */
    case 0x20: case 0xA0: case 0x1680: case 0x2028: case 0x2029:
    case 0x202F: case 0x205F: case 0x3000: case 0xFEFF:
      return true;
    default:
      return cp >= 0x2000 && cp <= 0x200A;
  }
}

/* Encoded byte length of cp at position `first` (raw = its UTF-8 length). */
static size_t scr_regexp_escape_len(uint32_t cp, bool first, size_t raw) {
  if (first && ((cp >= '0' && cp <= '9') || (cp >= 'A' && cp <= 'Z') || (cp >= 'a' && cp <= 'z'))) return 4;
  if (scr_regexp_syntax_char(cp) || scr_regexp_control_escape(cp) != 0) return 2;
  if (scr_regexp_hex_escaped(cp)) return cp < 0x100 ? 4 : 6;
  return raw;
}

ScrStr *scr_regexp_escape(ScrStr *s) {
  static const char hex[] = "0123456789abcdef";
  size_t out_len = 0;
  bool first = true;
  for (size_t i = 0; i < s->len;) {
    size_t adv;
    uint32_t cp = scr_re_utf8_decode(s->data + i, &adv);
    out_len += scr_regexp_escape_len(cp, first, adv);
    first = false;
    i += adv;
  }
  if (out_len == s->len) return scr_str_retain(s); /* nothing escapes — share */
  ScrStr *out = scr_str_alloc_raw(out_len, out_len);
  char *w = out->data;
  first = true;
  for (size_t i = 0; i < s->len;) {
    size_t adv;
    uint32_t cp = scr_re_utf8_decode(s->data + i, &adv);
    size_t enc = scr_regexp_escape_len(cp, first, adv);
    if (enc == adv) { /* pass-through: an escape's length never matches raw */
      memcpy(w, s->data + i, adv);
      w += adv;
    } else if (enc == 2) {
      char ctl = scr_regexp_control_escape(cp);
      *w++ = '\\';
      *w++ = ctl != 0 ? ctl : (char)cp;
    } else if (enc == 4) {
      *w++ = '\\';
      *w++ = 'x';
      *w++ = hex[(cp >> 4) & 0xF];
      *w++ = hex[cp & 0xF];
    } else {
      *w++ = '\\';
      *w++ = 'u';
      *w++ = hex[(cp >> 12) & 0xF];
      *w++ = hex[(cp >> 8) & 0xF];
      *w++ = hex[(cp >> 4) & 0xF];
      *w++ = hex[cp & 0xF];
    }
    first = false;
    i += adv;
  }
  out->len = (uint32_t)out_len;
  out->data[out_len] = '\0';
  return out;
}

/* ── the checked-dynamic RegExp handle (SCR_DYNH_REGEX) ─────────────────
 * A regex crosses into the checked-dynamic tree BY REFERENCE, like the
 * socket/stream handles: the value is an immutable (pattern, flags) pair
 * — no lastIndex state is modeled here at all — so boxing is a retain and
 * identity survives the round trip with nothing to copy and nothing to
 * alias.
 *
 * The MODELED surface is the part with a complete static lowering:
 * `test`, `toString`, and the read-only literal properties (source,
 * flags, and the flag booleans, which are derived from the flags text
 * exactly as the static reads derive them). Everything else — `exec`
 * (Node's result is an array carrying `index`/`input`/`groups`, which the
 * dyn tree's plain arrays cannot carry), `compile`, and `lastIndex` in
 * either direction — throws the loud not-supported ladder rather than
 * answering approximately. A regex reached through a dyn value must not
 * be able to say something a regex reached statically would not.
 *
 * `test` on a /g or /y regex is the one place this matters for safety:
 * the static entry point ABORTS the process there (stateful lastIndex is
 * out of the slice), and an abort behind a dynamic member call is a
 * process death with no stack the program could have caught. The flags
 * are checked here first so the dynamic spelling throws the same
 * catchable refusal the frontend gives the static one. */

static bool scr_regex_dynh_has_flag(const ScrRegex *re, char f) {
  for (size_t i = 0; i < re->flags->len; i++) {
    if (re->flags->data[i] == f) return true;
  }
  return false;
}

static void scr_regex_dynh_unsupported(const char *member, const char *why) {
  char msg[240];
  const int n = snprintf(msg, sizeof msg,
                         "'RegExp.prototype.%s' on a dynamic value is not supported yet%s%s",
                         member, why ? " — " : "", why ? why : "");
  scr_throw_error_msg(SCR_ERR_ERROR, msg, (size_t)n);
}

/* `/source/flags` — the spec's RegExp.prototype.toString, which is the
 * source text verbatim (already the spec's escaped form: scr_regex_new
 * stores "(?:)" for an empty pattern) between slashes. */
static ScrDyn *scr_regex_dynh_to_string(const ScrRegex *re) {
  const size_t len = re->source->len + re->flags->len + 2;
  ScrStr *out = scr_str_alloc_raw(len, len);
  char *w = out->data;
  *w++ = '/';
  memcpy(w, re->source->data, re->source->len);
  w += re->source->len;
  *w++ = '/';
  memcpy(w, re->flags->data, re->flags->len);
  out->len = (uint32_t)len;
  out->data[len] = '\0';
  ScrDyn *d = scr_dyn_new_str(out);
  scr_str_release(out);
  return d;
}

/* ── RegExp.prototype.exec on a dynamic receiver ───────────────────────
 *
 * The static `exec` answers the honest `string[]` slice (nonparticipating
 * captures read "", and `.index` / `.input` / `.groups` are fenced per
 * member); a dynamic receiver has no static type to fence against, so its
 * answer is the REAL result: an array whose elements are the match and its
 * captures (a capture that did not participate is `undefined`) and whose
 * own enumerable properties are `index`, `input`, `groups` and — under /d —
 * `indices`, in that order (RegExpBuiltinExec steps 33-38, ES2025). The
 * array carries them in its named-property table (scr_dyn_arr_extra_set),
 * which is what a dyn array could not do before.
 *
 * The match itself is scr_regex_run — the SAME routine test and the static
 * exec use, so lastIndex (read as ToLength for /g and /y, advanced on a
 * hit, reset on a miss) cannot differ between the spellings. */

/* A UTF-16 slice [start, end) of the subject as a dyn string. */
static ScrDyn *scr_regex_dyn_slice(const uint16_t *u, int start, int end) {
  ScrStr *s = scr_str_from_utf16(u, start, end);
  ScrDyn *d = scr_dyn_new_str(s);
  scr_str_release(s);
  return d;
}

static ScrDyn *scr_regex_dyn_pair(int start, int end) {
  ScrDyn *p = scr_dyn_new_arr();
  scr_dyn_arr_push(p, scr_dyn_new_num((double)start));
  scr_dyn_arr_push(p, scr_dyn_new_num((double)end));
  return p;
}

/* The `groups` object: null-prototype, one property per NAMED capture in
 * group order, undefined for a group that did not participate. A name that
 * appears in several alternatives (ES2025 duplicate named groups) holds the
 * participating one. `as_indices` fills it with [start, end] pairs instead
 * of substrings. Answers undefined when the pattern has no named group. */
static ScrDyn *scr_regex_dyn_groups(const uint8_t *bc, const uint16_t *u, uint8_t **capture,
                                    int capture_count, bool as_indices) {
  if (!(lre_get_flags(bc) & LRE_FLAG_NAMED_GROUPS)) return scr_dyn_retain(scr_dyn_undefined());
  const uint8_t *ubase = (const uint8_t *)u;
  ScrDyn *g = scr_dyn_new_obj();
  g->null_proto = true;
  const char *p = lre_get_groupnames(bc);
  for (int k = 1; k < capture_count; k++) {
    const size_t glen = strlen(p);
    if (glen > 0) {
      const uint8_t *cs = capture[2 * k], *ce = capture[2 * k + 1];
      const bool part = cs != NULL && ce != NULL;
      ScrDyn *existing = scr_dyn_obj_get(g, p, glen); /* borrowed */
      if (existing == NULL || (existing->kind == SCR_DYN_UNDEF && part)) {
        const int s0 = part ? (int)((cs - ubase) >> 1) : 0;
        const int e0 = part ? (int)((ce - ubase) >> 1) : 0;
        ScrDyn *v = !part ? scr_dyn_retain(scr_dyn_undefined())
                          : as_indices ? scr_regex_dyn_pair(s0, e0) : scr_regex_dyn_slice(u, s0, e0);
        scr_dyn_obj_set(g, p, glen, v); /* ownership moves; overwrites in place */
      }
    }
    p += glen + LRE_GROUP_NAME_TRAILER_LEN;
  }
  return g;
}

static ScrDyn *scr_regex_dynh_exec(ScrRegex *re, ScrDyn *const *args, size_t argc) {
  /* ToString(argument): a missing argument is the string "undefined". */
  ScrStr *s = scr_dyn_string_coerce_js(argc > 0 ? args[0] : scr_dyn_undefined());
  if (s == NULL) return NULL; /* ToString threw: pending */
  uint8_t *bc = scr_regex_bc(re);
  int len;
  uint16_t *u = scr_to_utf16(s, &len);
  uint8_t **capture = scr_capture_alloc(bc);
  const int rc = scr_regex_run(re, bc, u, len, capture);
  ScrDyn *out;
  if (rc != 1) {
    out = scr_dyn_new_null();
  } else {
    const uint8_t *ubase = (const uint8_t *)u;
    const int count = lre_get_capture_count(bc);
    out = scr_dyn_new_arr();
    for (int k = 0; k < count; k++) {
      const uint8_t *cs = capture[2 * k], *ce = capture[2 * k + 1];
      if (cs == NULL || ce == NULL) {
        scr_dyn_arr_push(out, scr_dyn_retain(scr_dyn_undefined()));
      } else {
        scr_dyn_arr_push(out, scr_regex_dyn_slice(u, (int)((cs - ubase) >> 1), (int)((ce - ubase) >> 1)));
      }
    }
    scr_dyn_arr_extra_set(out, "index", 5, scr_dyn_new_num((double)((capture[0] - ubase) >> 1)));
    ScrDyn *input = scr_dyn_new_str(s);
    scr_dyn_arr_extra_set(out, "input", 5, input);
    scr_dyn_arr_extra_set(out, "groups", 6, scr_regex_dyn_groups(bc, u, capture, count, false));
    if (scr_regex_dynh_has_flag(re, 'd')) {
      ScrDyn *ind = scr_dyn_new_arr();
      for (int k = 0; k < count; k++) {
        const uint8_t *cs = capture[2 * k], *ce = capture[2 * k + 1];
        if (cs == NULL || ce == NULL) {
          scr_dyn_arr_push(ind, scr_dyn_retain(scr_dyn_undefined()));
        } else {
          scr_dyn_arr_push(ind, scr_regex_dyn_pair((int)((cs - ubase) >> 1), (int)((ce - ubase) >> 1)));
        }
      }
      scr_dyn_arr_extra_set(ind, "groups", 6, scr_regex_dyn_groups(bc, u, capture, count, true));
      scr_dyn_arr_extra_set(out, "indices", 7, ind);
    }
  }
  free(capture);
  free(u);
  scr_str_release(s);
  return out;
}

/* exec is reachable ONLY through the dyn dispatch unit (scr_dyn_invoke.c's
 * handle arm), so its body — the array and object machinery the result is
 * built from — is pulled in by an install the emitted main() performs only
 * for a program that links both the regex unit and the dispatch unit. Naming
 * scr_regex_dynh_exec straight from the ops' invoke would pin all of it into
 * every regex program (measured +12.6 KB .text in a plain static one). */
/* Deliberately NOT static: a file-local pointer with one constant store lets the
 * optimizer turn it into a flag and a direct call, which links exec back in. */
ScrDyn *(*scr_regex_exec_dyn_fn)(ScrRegex *re, ScrDyn *const *args, size_t argc) = NULL;
void scr_regex_dyn_exec_install(void) { scr_regex_exec_dyn_fn = &scr_regex_dynh_exec; }

static ScrDyn *scr_regex_dynh_invoke(void *h, ScrDyn *self, const char *method,
                                     ScrDyn *const *args, size_t argc, const char *what) {
  ScrRegex *re = (ScrRegex *)h;
  (void)self;
  if (strcmp(method, "test") == 0) {
    const ScrDyn *a = argc > 0 ? args[0] : scr_dyn_undefined();
    ScrStr *s = scr_dyn_string_coerce_js(a); /* JS ToString, throws propagate */
    if (!s) return NULL;
    const bool r = scr_regex_test(re, s);
    scr_str_release(s);
    if (scr_exc_pending()) return NULL;
    return scr_dyn_new_bool(r);
  }
  if (strcmp(method, "toString") == 0) return scr_regex_dynh_to_string(re);
  if (strcmp(method, "exec") == 0) {
    if (scr_regex_exec_dyn_fn == NULL) {
      /* Unreachable when the link gate held: only the dispatch unit calls
       * this, and a program that links it installs exec. A real answer
       * rather than an assert, so a gate that ever misses fails loudly. */
      static const char msg[] =
          "internal error: RegExp.prototype.exec on a dynamic receiver reached a binary without the dispatch unit";
      scr_throw_error_msg(SCR_ERR_ERROR, msg, sizeof msg - 1);
      return NULL;
    }
    return scr_regex_exec_dyn_fn(re, args, argc);
  }
  if (strcmp(method, "compile") == 0) {
    /* RegExp.prototype.compile re-initializes the regex IN PLACE. A regex
     * literal without g/y is one interned immortal static shared by every
     * evaluation of that literal (and of any equal one), so mutating the
     * receiver would change every other holder — a wrong answer where this
     * refuses. The one member of the class left loud, and for a
     * representation reason, not a missing algorithm. */
    scr_regex_dynh_unsupported(method, "a regex literal is one shared immutable value here, so re-initializing it in place would change every other evaluation of the same literal");
    return NULL;
  }
  {
    char msg[160];
    const int n = snprintf(msg, sizeof msg, "%s is not a function", what);
    scr_throw_error_msg(SCR_ERR_TYPE, msg, (size_t)n);
  }
  return NULL;
}

static ScrDyn *scr_regex_dynh_get(void *h, const char *key, size_t key_len) {
  ScrRegex *re = (ScrRegex *)h;
  (void)key_len;
  if (strcmp(key, "source") == 0) {
    ScrStr *s = scr_regex_source(re); /* +1 */
    ScrDyn *d = scr_dyn_new_str(s);
    scr_str_release(s);
    return d;
  }
  if (strcmp(key, "flags") == 0) {
    ScrStr *s = scr_regex_flags(re); /* +1 */
    ScrDyn *d = scr_dyn_new_str(s);
    scr_str_release(s);
    return d;
  }
  /* The flag booleans are derived from the flags text, exactly as the
   * static property reads derive them. */
  if (strcmp(key, "global") == 0) return scr_dyn_new_bool(scr_regex_dynh_has_flag(re, 'g'));
  if (strcmp(key, "ignoreCase") == 0) return scr_dyn_new_bool(scr_regex_dynh_has_flag(re, 'i'));
  if (strcmp(key, "multiline") == 0) return scr_dyn_new_bool(scr_regex_dynh_has_flag(re, 'm'));
  if (strcmp(key, "dotAll") == 0) return scr_dyn_new_bool(scr_regex_dynh_has_flag(re, 's'));
  if (strcmp(key, "unicode") == 0) return scr_dyn_new_bool(scr_regex_dynh_has_flag(re, 'u'));
  if (strcmp(key, "sticky") == 0) return scr_dyn_new_bool(scr_regex_dynh_has_flag(re, 'y'));
  if (strcmp(key, "hasIndices") == 0) return scr_dyn_new_bool(scr_regex_dynh_has_flag(re, 'd'));
  if (strcmp(key, "unicodeSets") == 0) return scr_dyn_new_bool(scr_regex_dynh_has_flag(re, 'v'));
  if (strcmp(key, "lastIndex") == 0) return scr_dyn_new_num(scr_regex_get_last_index(re));
  return NULL; /* not a modeled property — the caller answers undefined */
}

static bool scr_regex_dynh_set(void *h, const char *key, size_t key_len, const ScrDyn *value) {
  (void)key_len;
  if (strcmp(key, "lastIndex") == 0) {
    if (value->kind != SCR_DYN_NUM) {
      scr_regex_dynh_unsupported("lastIndex", "only a number can be stored (ToNumber of other kinds is not modeled)");
      return true; /* handled, with the exception pending */
    }
    scr_regex_set_last_index((ScrRegex *)h, value->v.num);
    return true;
  }
  return false; /* the caller throws the loud ladder */
}

static const ScrDynHandleOps scr_regex_dynh_ops = {
  "RegExp",
  &scr_regex_retain_v,
  &scr_regex_release_v,
  &scr_regex_dynh_invoke,
  &scr_regex_dynh_get,
  &scr_regex_dynh_set,
  NULL, /* no pipe destination */
};

void scr_regex_dyn_install(void) {
  scr_dyn_handle_install(SCR_DYNH_REGEX, &scr_regex_dynh_ops);
}
