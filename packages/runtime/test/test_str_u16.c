/* scr_str_cmp_u16 (first-difference scan) against the per-code-point decoder it replaced, and the UTF-16 length that a copying concat hands to its
 * result against a from-scratch count of the same bytes.
 *
 * POSITIVE CONTROLS, both must fire: the oracle with the surrogate rule inverted must DISAGREE with the runtime on the generated population (so the
 * population really contains the U+E000..U+FFFF vs supplementary pairs the rule is about), and a length computed WITHOUT adding the tail must
 * disagree with the handed-over one (so the handoff really ran). */
#include "../src/scr_runtime.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int failures = 0;
#define CHECK(cond)                                                            \
  do {                                                                         \
    if (!(cond)) {                                                             \
      failures++;                                                              \
      fprintf(stderr, "FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond);          \
    }                                                                          \
  } while (0)

static unsigned long long rng = 88172645463325252ull;
static unsigned rnd(unsigned n) {
  rng ^= rng << 13; rng ^= rng >> 7; rng ^= rng << 17;
  return (unsigned)(rng % n);
}

/* One code point drawn from every width class and from the boundaries the rule is about. */
static unsigned pick_cp(void) {
  static const unsigned edge[] = {0x41, 0x7f, 0x80, 0x7ff, 0x800, 0xd7ff, 0xe000, 0xfffd, 0xffff, 0x10000, 0x1f600, 0x10ffff};
  switch (rnd(4)) {
    case 0: return 0x61 + rnd(3);
    case 1: return edge[rnd(sizeof edge / sizeof edge[0])];
    case 2: return 0xe000 + rnd(0x2000);
    default: return 0x10000 + rnd(0x400);
  }
}
static size_t put_cp(char *d, unsigned cp) {
  if (cp < 0x80) { d[0] = (char)cp; return 1; }
  if (cp < 0x800) { d[0] = (char)(0xc0 | (cp >> 6)); d[1] = (char)(0x80 | (cp & 0x3f)); return 2; }
  if (cp < 0x10000) { d[0] = (char)(0xe0 | (cp >> 12)); d[1] = (char)(0x80 | ((cp >> 6) & 0x3f)); d[2] = (char)(0x80 | (cp & 0x3f)); return 3; }
  d[0] = (char)(0xf0 | (cp >> 18)); d[1] = (char)(0x80 | ((cp >> 12) & 0x3f)); d[2] = (char)(0x80 | ((cp >> 6) & 0x3f)); d[3] = (char)(0x80 | (cp & 0x3f));
  return 4;
}
static size_t gen(char *buf, size_t maxcp, const char *prefix, size_t plen) {
  size_t n = plen;
  memcpy(buf, prefix, plen);
  size_t k = rnd((unsigned)maxcp + 1);
  for (size_t i = 0; i < k; i++) n += put_cp(buf + n, pick_cp());
  buf[n] = 0;
  return n;
}

/* The decoder the runtime used before: leading UTF-16 unit of each code point, then whole code point when both are astral. */
static unsigned lead_u16(const unsigned char *s, size_t len, size_t *adv) {
  unsigned char b = s[0];
  unsigned cp; size_t n;
  if (b < 0x80) { cp = b; n = 1; }
  else if ((b & 0xe0) == 0xc0) { cp = b & 0x1fu; n = 2; }
  else if ((b & 0xf0) == 0xe0) { cp = b & 0x0fu; n = 3; }
  else { cp = b & 0x07u; n = 4; }
  if (n > len) n = len;
  for (size_t i = 1; i < n; i++) cp = (cp << 6) | (s[i] & 0x3fu);
  *adv = n;
  if (cp >= 0x10000) return 0xd800 + ((cp - 0x10000) >> 10);
  return cp;
}
static int oracle(const char *a, size_t al, const char *b, size_t bl, int invert) {
  size_t ia = 0, ib = 0;
  while (ia < al && ib < bl) {
    size_t na, nb;
    unsigned ua = lead_u16((const unsigned char *)a + ia, al - ia, &na);
    unsigned ub = lead_u16((const unsigned char *)b + ib, bl - ib, &nb);
    if (invert) { if (ua >= 0xd800 && ua < 0xdc00) ua += 0x10000; if (ub >= 0xd800 && ub < 0xdc00) ub += 0x10000; } /* code point order: what a byte compare would answer */
    if (ua != ub) return ua < ub ? -1 : 1;
    if (na == 4 && nb == 4) {
      unsigned ca = 0, cb = 0;
      for (size_t i = 0; i < 4; i++) {
        ca = (ca << 6) | (i == 0 ? (unsigned char)a[ia] & 0x07u : (unsigned char)a[ia + i] & 0x3fu);
        cb = (cb << 6) | (i == 0 ? (unsigned char)b[ib] & 0x07u : (unsigned char)b[ib + i] & 0x3fu);
      }
      if (ca != cb) return ca < cb ? -1 : 1;
    }
    ia += na; ib += nb;
  }
  if (ia < al) return 1;
  if (ib < bl) return -1;
  return 0;
}
static int sgn(int v) { return v < 0 ? -1 : v > 0 ? 1 : 0; }

static size_t units_of(const char *d, size_t n) {
  size_t u = 0;
  for (size_t i = 0; i < n; i++) { unsigned char c = (unsigned char)d[i]; u += (size_t)((c & 0xC0) != 0x80) + (size_t)((c & 0xF8) == 0xF0); }
  return u;
}

int main(void) {
  static char A[4096], B[4096], P[1024];
  long pairs = 0, ctl_disagree = 0;
  for (int it = 0; it < 200000; it++) {
    size_t pl = rnd(3) == 0 ? rnd(40) : 0; /* a shared prefix, so the first difference is deep */
    size_t plen = gen(P, pl, "", 0);
    size_t al = gen(A, 6, P, plen), bl = gen(B, 6, P, plen);
    ScrStr *a = scr_str_new(A, al), *b = scr_str_new(B, bl);
    int got = sgn(scr_str_cmp_u16(a, b));
    CHECK(got == oracle(A, al, B, bl, 0));
    CHECK(sgn(scr_str_cmp(a, b)) == got); /* the relational operators' entry point is the same order */
    if (oracle(A, al, B, bl, 1) != got) ctl_disagree++;
    CHECK(sgn(scr_str_cmp_u16(b, a)) == -got);
    pairs++;
    scr_str_release(a); scr_str_release(b);
  }
  CHECK(pairs == 200000);
  CHECK(ctl_disagree > 100); /* the control must fire: the population holds the pairs the rule is about */

  /* The handoff: grow an accumulator past 128 bytes with a length query after every append (so the entry is cached and moved), mixed widths. */
  long mismatches_wrong = 0;
  for (int round = 0; round < 300; round++) {
    ScrStr *acc = scr_str_new("seed", 4);
    for (int i = 0; i < 80; i++) {
      char T[64]; size_t tl = gen(T, 5, "", 0);
      if (rnd(2)) { memset(T, 'k', 20); tl = 20; T[tl] = 0; }
      ScrStr *t = scr_str_new(T, tl);
      ScrStr *keep = rnd(3) == 0 ? scr_str_retain(acc) : NULL; /* a second owner: the append must COPY */
      ScrStr *next = scr_str_concat(acc, t);
      double want = (double)units_of(next->data, next->len);
      CHECK(scr_str_utf16_len(next) == want);
      size_t from_scratch = units_of(next->data, next->len);
      size_t wrong = (size_t)want - units_of(t->data, t->len); /* what a handoff that forgot the tail would answer */
      if (wrong != from_scratch && tl > 0) mismatches_wrong++;
      if (keep) { CHECK(scr_str_utf16_len(keep) == (double)units_of(keep->data, keep->len)); scr_str_release(keep); }
      scr_str_release(t);
      if (next != acc) scr_str_release(acc);
      else scr_str_release(acc); /* rc 2 -> 1 */
      acc = next;
    }
    CHECK(scr_str_utf16_len(acc) == (double)units_of(acc->data, acc->len));
    scr_str_release(acc);
  }
  CHECK(mismatches_wrong > 1000); /* the control must fire */
  if (failures) { fprintf(stderr, "%d failures\n", failures); return 1; }
  fprintf(stderr, "ok pairs=%ld ctl_disagree=%ld ctl_len=%ld\n", pairs, ctl_disagree, mismatches_wrong);
  return 0;
}
