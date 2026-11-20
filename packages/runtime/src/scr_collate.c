/* scr_collate.c: the CLDR root collation (what Node's String.prototype.localeCompare and Intl.Collator answer for the
 * default locale and for every language without a tailoring), Unicode 17 / ICU 78.2.
 *
 * Link-gated: only a program that calls localeCompare (or reads an Intl.Collator result) compiles and links this unit
 * and its generated tables (scr_collate_data.h). It needs the lre normalizer (scr_regex.c's unit and libunicode), which
 * the same switch links.
 *
 * The algorithm is UCA over ICU's root collation elements: both strings are decoded to code points (NFD when any code
 * point can carry a combining class), mapped to (primary, secondary, tertiary) collation elements by longest
 * contraction / prefix context / single entry / Han radical-stroke rank / algorithmic Hangul / implicit weights, and
 * compared level by level the way ICU's CollationCompare::compareUpToQuaternary does (non-ignorable alternate by
 * default; shifted for ignorePunctuation; the case level and the caseFirst tertiary swap; numeric collation). */
#include "scr_runtime.h"
#include "scr_collate_data.h"
#include "libunicode.h"
#include <stdlib.h>
#include <string.h>

typedef struct { uint32_t p; uint16_t s, t; } Ce;
typedef struct { Ce *v; size_t n, cap; Ce inl[96]; } CeVec;

static void cev_init(CeVec *c) { c->v = c->inl; c->n = 0; c->cap = sizeof c->inl / sizeof c->inl[0]; }
static void cev_free(CeVec *c) { if (c->v != c->inl) free(c->v); }
static void cev_push(CeVec *c, uint32_t p, uint16_t s, uint16_t t) {
  if (c->n == c->cap) {
    size_t nc = c->cap * 2;
    Ce *nv = malloc(nc * sizeof(Ce));
    if (!nv) abort();
    memcpy(nv, c->v, c->n * sizeof(Ce));
    if (c->v != c->inl) free(c->v);
    c->v = nv;
    c->cap = nc;
  }
  c->v[c->n].p = p;
  c->v[c->n].s = s;
  c->v[c->n].t = t;
  c->n++;
}
static void cev_push_ref(CeVec *c, uint32_t ref) {
  const ScrCollCe *e = &scr_coll_ces[ref >> 8];
  for (uint32_t k = ref & 0xFFu; k > 0; k--, e++) cev_push(c, e->p, e->s, e->t);
}

/* the sorted-array searches */
static long find_single(uint32_t cp) {
  long lo = 0, hi = SCR_COLL_NSINGLE - 1;
  while (lo <= hi) {
    long mid = (lo + hi) >> 1;
    uint32_t k = scr_coll_single_cp[mid];
    if (k == cp) return mid;
    if (k < cp) lo = mid + 1; else hi = mid - 1;
  }
  return -1;
}
/* the small-code-point cache: a Latin string never reaches the binary search */
#define SMALL_N 0x250u
static uint32_t small_ref[SMALL_N];
static bool small_ready = false;
static void small_init(void) {
  for (uint32_t c = 0; c < SMALL_N; c++) {
    long i = find_single(c);
    small_ref[c] = i < 0 ? 0xFFFFFFFFu : scr_coll_single_ref[i];
  }
  small_ready = true;
}

static long han_run(uint32_t cp) {
  long lo = 0, hi = SCR_COLL_NHANRUN - 1, best = -1;
  while (lo <= hi) {
    long mid = (lo + hi) >> 1;
    if (scr_coll_han_start[mid] <= cp) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (best >= 0 && cp < scr_coll_han_start[best] + scr_coll_han_len[best]) return best;
  return -1;
}

static long contr_lower_bound(uint32_t first) {
  long lo = 0, hi = SCR_COLL_NCONTR;
  while (lo < hi) {
    long mid = (lo + hi) >> 1;
    if (scr_coll_contr_key[mid][0] < first) lo = mid + 1; else hi = mid;
  }
  return lo;
}

static int decimal_digit(uint32_t cp) {
  long lo = 0, hi = SCR_COLL_NND - 1, best = -1;
  while (lo <= hi) {
    long mid = (lo + hi) >> 1;
    if (scr_coll_nd_start[mid] <= cp) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (best >= 0 && cp < scr_coll_nd_start[best] + 10) return (int)(cp - scr_coll_nd_start[best]);
  return -1;
}

#define COMMON 0x0500u
/* U+AC00..U+D7A3 as jamo (UAX 15 arithmetic) */
static void hangul(CeVec *out, uint32_t cp);

/* One single code point: its elements. */
static void emit_single(CeVec *out, uint32_t cp) {
  if (cp < SMALL_N) {
    if (!small_ready) small_init();
    if (small_ref[cp] != 0xFFFFFFFFu) { cev_push_ref(out, small_ref[cp]); return; }
  } else {
    if (cp >= 0xAC00 && cp <= 0xD7A3) { hangul(out, cp); return; }
    long h = han_run(cp);
    if (h >= 0) { cev_push(out, SCR_COLL_HAN_BASE + scr_coll_han_rank[h] + (cp - scr_coll_han_start[h]), COMMON, COMMON); return; }
    long i = find_single(cp);
    if (i >= 0) { cev_push_ref(out, scr_coll_single_ref[i]); return; }
  }
  /* implicit: monotone in the code point, after every listed script, before the trailing weights */
  cev_push(out, 0xE0000000u + cp, COMMON, COMMON);
}
static void hangul(CeVec *out, uint32_t cp) {
  uint32_t s = cp - 0xAC00, l = 0x1100 + s / 588, v = 0x1161 + (s % 588) / 28, t = 0x11A7 + s % 28;
  emit_single(out, l);
  emit_single(out, v);
  if (t != 0x11A7) emit_single(out, t);
}

static int ccc_of(uint32_t cp) {
  if (cp < 0x300) return 0;
  long lo = 0, hi = SCR_COLL_NCCC - 1, best = -1;
  while (lo <= hi) {
    long mid = (lo + hi) >> 1;
    if (scr_coll_ccc_start[mid] <= cp) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return best >= 0 && cp <= scr_coll_ccc_end[best] ? scr_coll_ccc_val[best] : 0;
}

/* Does contraction key c (length kl) match at cps[i], skipping unblocked combining marks between its elements (UCA S2.1)?
 * Matched positions go to idx[1..kl-1] (idx[0] is i). */
static bool contraction_matches(const uint32_t *cps, size_t n, const uint8_t *used, size_t i, long c, size_t kl, size_t *idx) {
  size_t pos = i + 1;
  idx[0] = i;
  for (size_t k = 1; k < kl; k++) {
    int max_skipped = 0;
    size_t j = pos;
    for (;;) {
      if (j >= n) return false;
      uint32_t x = cps[j];
      if (used != NULL && used[j]) { j++; continue; } /* consumed by an earlier contraction */
      if (x == scr_coll_contr_key[c][k]) {
        if (j == pos || (ccc_of(x) != 0 && max_skipped < ccc_of(x))) break;
        return false; /* blocked */
      }
      int cc = ccc_of(x);
      if (cc == 0) return false;
      if (cc > max_skipped) max_skipped = cc;
      j++;
    }
    idx[k] = j;
    pos = j + 1;
  }
  return true;
}

/* Elements of cps[0..n): the numeric flag turns a run of decimal digits into one number. */
static void gen_ces(CeVec *out, const uint32_t *cps, size_t n, bool numeric) {
  uint8_t *used = NULL;
  for (size_t i = 0; i < n;) {
    uint32_t cp = cps[i];
    if (used != NULL && used[i]) { i++; continue; }
    if (numeric && decimal_digit(cp) >= 0) {
      size_t j = i;
      while (j < n && decimal_digit(cps[j]) >= 0) j++;
      size_t z = i;
      while (z + 1 < j && decimal_digit(cps[z]) == 0) z++; /* leading zeros do not count (a lone zero stays) */
      uint32_t len = (uint32_t)(j - z);
      /* the lead byte ICU reserves for numeric sorting (FractionalUCA "FDD0 0034"), the length, then the digits */
      cev_push(out, 0x10000000u | (((len >> 16) & 0xFFFFu) << 8), COMMON, COMMON);
      cev_push(out, 0x10000000u | ((len & 0xFFFFu) << 8), COMMON, COMMON);
      for (size_t k = z; k < j; k++) cev_push(out, 0x10000000u | ((uint32_t)(decimal_digit(cps[k]) + 1) << 8), COMMON, COMMON);
      i = j;
      continue;
    }
    /* a prefix context: cp directly after a given code point */
    if (i > 0 && (cp == 0xB7 || cp == 0x387)) {
      bool hit = false;
      for (int k = 0; k < SCR_COLL_NPREFIX; k++)
        if (scr_coll_prefix_cp[k] == cp && scr_coll_prefix_pre[k] == cps[i - 1]) { cev_push_ref(out, scr_coll_prefix_ref[k]); hit = true; break; }
      if (hit) { i++; continue; }
    }
    /* the longest contraction starting here */
    long c0 = contr_lower_bound(cp);
    size_t best_len = 0;
    long best = -1;
    size_t best_idx[SCR_COLL_MAXKEY], idx[SCR_COLL_MAXKEY];
    for (long c = c0; c < SCR_COLL_NCONTR && scr_coll_contr_key[c][0] == cp; c++) {
      size_t kl = 1;
      while (kl < SCR_COLL_MAXKEY && scr_coll_contr_key[c][kl] != 0) kl++;
      if (kl > best_len && contraction_matches(cps, n, used, i, c, kl, idx)) {
        best_len = kl;
        best = c;
        memcpy(best_idx, idx, kl * sizeof(size_t));
      }
    }
    if (best >= 0) {
      cev_push_ref(out, scr_coll_contr_ref[best]);
      bool contiguous = true;
      for (size_t k = 1; k < best_len; k++) if (best_idx[k] != i + k) contiguous = false;
      if (contiguous) { i += best_len; continue; }
      if (used == NULL) { used = calloc(n, 1); if (!used) abort(); }
      for (size_t k = 1; k < best_len; k++) used[best_idx[k]] = 1;
      i++;
      continue;
    }
    emit_single(out, cp);
    i++;
  }
  free(used);
}

/* UTF-8 (well formed) to code points. */
static size_t decode_utf8(const ScrStr *s, uint32_t *dst) {
  size_t n = 0;
  const unsigned char *p = (const unsigned char *)s->data, *e = p + s->len;
  while (p < e) {
    uint32_t c = *p;
    if (c < 0x80) { p += 1; }
    else if (c < 0xE0) { c = ((c & 0x1Fu) << 6) | (p[1] & 0x3Fu); p += 2; }
    else if (c < 0xF0) { c = ((c & 0x0Fu) << 12) | ((p[1] & 0x3Fu) << 6) | (p[2] & 0x3Fu); p += 3; }
    else { c = ((c & 0x07u) << 18) | ((p[1] & 0x3Fu) << 12) | ((p[2] & 0x3Fu) << 6) | (p[3] & 0x3Fu); p += 4; }
    dst[n++] = c;
  }
  return n;
}
static void *norm_realloc(void *opaque, void *ptr, size_t size) { (void)opaque; return realloc(ptr, size); }

/* Elements of cps[0..n): NFD first when any code point is at or above U+0300 (below it no combining class exists). */
static void cps_ces(CeVec *out, const uint32_t *cps, size_t n, bool numeric) {
  bool wide = false;
  for (size_t i = 0; i < n; i++) if (cps[i] >= 0x300) { wide = true; break; }
  if (wide) {
    uint32_t *dst = NULL;
    int m = unicode_normalize(&dst, (uint32_t *)cps, (int)n, UNICODE_NFD, NULL, norm_realloc);
    if (m < 0) abort();
    gen_ces(out, dst, (size_t)m, numeric);
    free(dst);
  } else {
    gen_ces(out, cps, n, numeric);
  }
}

/* Can ICU's identical-prefix skip stop before this code point (RuleBasedCollator::doCompare's isUnsafeBackward, which tests
 * the first UTF-16 unit)? Unsafe: a BMP decimal digit (numeric), a code point with a combining class, a contraction
 * continuation, the main character of a prefix context, a Hangul vowel or trailing jamo. An astral code point is safe (its lead
 * surrogate is), which splits a digit run in numeric collation. */
static uint8_t unsafe_bits[8192];
static bool unsafe_ready = false;
static void unsafe_set(uint32_t c) { unsafe_bits[c >> 3] |= (uint8_t)(1u << (c & 7)); }
static void unsafe_init(void) {
  for (long r = 0; r < SCR_COLL_NCCC; r++)
    for (uint32_t c = scr_coll_ccc_start[r]; c <= scr_coll_ccc_end[r] && c <= 0xFFFF; c++) unsafe_set(c);
  for (uint32_t c = 0x1161; c <= 0x1175; c++) unsafe_set(c);
  for (uint32_t c = 0x11A8; c <= 0x11C2; c++) unsafe_set(c);
  for (int k = 0; k < SCR_COLL_NPREFIX; k++) if (scr_coll_prefix_cp[k] <= 0xFFFF) unsafe_set(scr_coll_prefix_cp[k]);
  for (long k = 0; k < SCR_COLL_NCONTR; k++)
    for (size_t e = 1; e < SCR_COLL_MAXKEY && scr_coll_contr_key[k][e] != 0; e++)
      if (scr_coll_contr_key[k][e] <= 0xFFFF) unsafe_set(scr_coll_contr_key[k][e]);
  unsafe_ready = true;
}
static bool unsafe_backward(uint32_t c, bool numeric) {
  if (c > 0xFFFF) return false;
  if (!unsafe_ready) unsafe_init();
  if (unsafe_bits[c >> 3] & (1u << (c & 7))) return true;
  return numeric && decimal_digit(c) >= 0;
}

/* ignorePunctuation (alternate shifted, maxVariable punct): variable elements, and the ignorables that follow one, vanish. */
static void shift_variable(CeVec *c) {
  size_t o = 0;
  bool after = false;
  for (size_t i = 0; i < c->n; i++) {
    Ce e = c->v[i];
    if (e.p > 0x02000000u && e.p <= 0x0BFFFFFFu) { after = true; continue; }
    if (e.p == 0 && after) continue;
    if (e.p != 0) after = false;
    c->v[o++] = e;
  }
  c->n = o;
}

/* The default-option comparison of two ASCII strings: every ASCII character is one element with the common secondary weight (or
 * none, for the controls), so the secondary level can never differ once the primaries agree; one pass compares the primaries and
 * remembers the first tertiary difference. Returns 2 for "not ASCII (or the tables disagree)": the caller runs the general path. */
static uint32_t ascii_prim[128];
static uint16_t ascii_ter[128];
static int ascii_state = 0; /* 0 unset, 1 usable, -1 not usable */
static void ascii_init(void) {
  ascii_state = 1;
  for (uint32_t c = 0; c < 128; c++) {
    long i = find_single(c);
    ascii_prim[c] = 0;
    ascii_ter[c] = 0;
    if (i < 0) { ascii_state = -1; return; }
    uint32_t ref = scr_coll_single_ref[i], n = ref & 0xFFu;
    const ScrCollCe *e = &scr_coll_ces[ref >> 8];
    if (n == 0 || (n == 1 && e->p == 0 && e->s == 0 && e->t == 0)) continue; /* completely ignorable */
    if (n != 1 || e->p == 0 || e->s != COMMON) { ascii_state = -1; return; }
    ascii_prim[c] = e->p;
    ascii_ter[c] = (uint16_t)(e->t & 0x3F3Fu);
  }
}
static int ascii_compare(const ScrStr *a, const ScrStr *b) {
  if (ascii_state == 0) ascii_init();
  if (ascii_state < 0) return 2;
  const unsigned char *p = (const unsigned char *)a->data, *pe = p + a->len, *q = (const unsigned char *)b->data, *qe = q + b->len;
  int tdiff = 0;
  for (;;) {
    while (p < pe) { if (*p >= 0x80) return 2; if (ascii_prim[*p] != 0) break; p++; }
    while (q < qe) { if (*q >= 0x80) return 2; if (ascii_prim[*q] != 0) break; q++; }
    if (p == pe || q == qe) {
      if (p == pe && q == qe) break;
      /* one string has an element left: it is longer at the primary level, whatever follows */
      const unsigned char *r = p == pe ? q : p;
      const unsigned char *re = p == pe ? qe : pe;
      for (const unsigned char *t = r; t < re; t++) if (*t >= 0x80) return 2;
      return p == pe ? -1 : 1;
    }
    uint32_t x = ascii_prim[*p], y = ascii_prim[*q];
    if (x != y) {
      for (const unsigned char *t = p; t < pe; t++) if (*t >= 0x80) return 2;
      for (const unsigned char *t = q; t < qe; t++) if (*t >= 0x80) return 2;
      return x < y ? -1 : 1;
    }
    if (tdiff == 0 && ascii_ter[*p] != ascii_ter[*q]) tdiff = ascii_ter[*p] < ascii_ter[*q] ? -1 : 1;
    p++;
    q++;
  }
  return tdiff;
}

int scr_collate_compare(const ScrStr *a, const ScrStr *b, int strength, bool case_level, int case_first, bool numeric, bool ignore_punct) {
  /* every well-formed pair of equal strings is equal at every level */
  if (a->len == b->len && memcmp(a->data, b->data, a->len) == 0) return 0;
  if (strength == 3 && !case_level && case_first == 0 && !numeric && !ignore_punct) {
    int fast = ascii_compare(a, b);
    if (fast != 2) return fast;
  }
  CeVec A, B;
  cev_init(&A);
  cev_init(&B);
  uint32_t inl_a[128], inl_b[128];
  uint32_t *ca = a->len <= 128 ? inl_a : malloc(sizeof(uint32_t) * (a->len ? a->len : 1));
  uint32_t *cb = b->len <= 128 ? inl_b : malloc(sizeof(uint32_t) * (b->len ? b->len : 1));
  if (!ca || !cb) abort();
  size_t na = decode_utf8(a, ca), nb = decode_utf8(b, cb), off;
  /* ICU skips the identical prefix before comparing; it backs up to the start of the unsafe run the prefix ends in */
  size_t eq = 0;
  while (eq < na && eq < nb && ca[eq] == cb[eq]) eq++;
  if (eq > 0 && ((eq < na && unsafe_backward(ca[eq], numeric)) || (eq < nb && unsafe_backward(cb[eq], numeric)))) {
    while (--eq > 0 && unsafe_backward(ca[eq], numeric)) {}
  }
  off = eq;
  cps_ces(&A, ca + off, na - off, numeric);
  cps_ces(&B, cb + off, nb - off, numeric);
  if (ca != inl_a) free(ca);
  if (cb != inl_b) free(cb);
  if (ignore_punct) { shift_variable(&A); shift_variable(&B); }
  int r = 0;
  size_t i, j;
  /* primary */
  i = j = 0;
  for (;;) {
    while (i < A.n && A.v[i].p == 0) i++;
    while (j < B.n && B.v[j].p == 0) j++;
    uint32_t pa = i < A.n ? A.v[i].p : 0, pb = j < B.n ? B.v[j].p : 0;
    if (pa != pb) { r = pa < pb ? -1 : 1; goto done; }
    if (pa == 0) break;
    i++; j++;
  }
  /* secondary */
  if (strength >= 2) {
    i = j = 0;
    for (;;) {
      while (i < A.n && A.v[i].s == 0) i++;
      while (j < B.n && B.v[j].s == 0) j++;
      uint32_t sa = i < A.n ? A.v[i].s : 0, sb = j < B.n ? B.v[j].s : 0;
      if (sa != sb) { r = sa < sb ? -1 : 1; goto done; }
      if (sa == 0) break;
      i++; j++;
    }
  }
  /* case level: the case bits of the elements that count at this strength */
  if (case_level) {
    i = j = 0;
    for (;;) {
      if (strength == 1) {
        while (i < A.n && A.v[i].p == 0) i++;
        while (j < B.n && B.v[j].p == 0) j++;
      } else {
        while (i < A.n && A.v[i].s == 0) i++;
        while (j < B.n && B.v[j].s == 0) j++;
      }
      uint32_t ca = i < A.n ? (A.v[i].t & 0xC000u) : 0, cb = j < B.n ? (B.v[j].t & 0xC000u) : 0;
      bool ea = i >= A.n, eb = j >= B.n;
      if (ea || eb) { if (ea && eb) break; r = ea ? -1 : 1; goto done; }
      if (ca != cb) { r = (ca < cb) != (case_first == 1) ? -1 : 1; goto done; }
      i++; j++;
    }
  }
  /* tertiary */
  if (strength >= 3) {
    uint32_t mask = (!case_level && case_first != 0) ? 0xFF3Fu : 0x3F3Fu;
    i = j = 0;
    for (;;) {
      uint32_t ta, tb, sa = 0, sb = 0;
      for (;;) { if (i >= A.n) { ta = 0; break; } ta = A.v[i].t & mask; sa = A.v[i].s; i++; if (ta != 0) break; }
      for (;;) { if (j >= B.n) { tb = 0; break; } tb = B.v[j].t & mask; sb = B.v[j].s; j++; if (tb != 0) break; }
      if (ta != tb) {
        if (case_first == 1 && !case_level) {
          /* upper first: flip the case bits of every element that carries a secondary weight; add 0x4000 to the rest */
          if (ta != 0) ta = sa != 0 ? (ta ^ 0xC000u) : ta + 0x4000u;
          if (tb != 0) tb = sb != 0 ? (tb ^ 0xC000u) : tb + 0x4000u;
        }
        r = ta < tb ? -1 : 1;
        goto done;
      }
      if (ta == 0) break;
    }
  }
done:
  cev_free(&A);
  cev_free(&B);
  return r;
}

/* String.prototype.localeCompare(b) in the default locale (CLDR root): -1, 0 or 1. */
double scr_str_locale_compare(const ScrStr *a, const ScrStr *b) {
  /* ASCII letters, digits and punctuation never reach the generic path's allocations (the CE vectors are inline) */
  return (double)scr_collate_compare(a, b, 3, false, 0, false, false);
}

/* The dyn String extension (scr_regex.c) reaches the comparison through this hook, installed only where this unit links. */
extern double (*scr_str_collate_hook)(const ScrStr *a, const ScrStr *b);
__attribute__((constructor)) static void scr_collate_install_hook(void) { scr_str_collate_hook = scr_str_locale_compare; }
