/* scr_str_utf16_len over non-ASCII strings (the 16-byte block classification in scr_utf16_units) against a scalar count of the same bytes, with every
 * width class, lengths up to 9,000 bytes (past the 255-block fold at 4,080 bytes) and ascii-only strings of the same lengths.
 * POSITIVE CONTROL, it must fire: a count that ignores 4-byte leads must disagree with the exact one on 100+ strings, so the population really has astral
 * characters in it. */
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
int main(void) {
  /* scr_str_utf16_len (the vector classification) against a scalar count, over strings up to 9,000 bytes (past the 255-block fold at 4,080 bytes)
   * with every width class, and over ascii-only strings of the same lengths. Control: a count that ignores 4-byte leads must disagree somewhere. */
  long ctl_len = 0;
  static char L[9400];
  for (int it = 0; it < 3000; it++) {
    size_t n = 0;
    size_t want = rnd(2) ? rnd(9000) : rnd(80);
    int ascii_only = rnd(4) == 0;
    while (n + 4 < want) {
      unsigned cp = ascii_only ? 0x20 + rnd(90) : pick_cp();
      n += put_cp(L + n, cp);
    }
    L[n] = 0;
    ScrStr *ls = scr_str_new(L, n);
    size_t exact = 0, noleads = 0;
    for (size_t k = 0; k < n; k++) { unsigned char c = (unsigned char)L[k]; exact += (size_t)((c & 0xC0) != 0x80) + (size_t)((c & 0xF8) == 0xF0); noleads += (size_t)((c & 0xC0) != 0x80); }
    CHECK(scr_str_utf16_len(ls) == (double)exact);
    if (noleads != exact) ctl_len++;
    scr_str_release(ls);
  }
  CHECK(ctl_len > 100);
  if (failures) { fprintf(stderr, "%d failures\n", failures); return 1; }
  fprintf(stderr, "ok ctl_len=%ld\n", ctl_len);
  return 0;
}
