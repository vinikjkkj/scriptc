/* The console.log / util.inspect rendering of BigInt64Array and
 * BigUint64Array. Compiled only when the program both uses bigint
 * (scr_bigint.c) and inspects (scr_inspect.c), cc.ts's two-gate pattern:
 * it names the inspect helpers AND the bigint element reader, and neither
 * half may pull the other in. It lives apart from scr_bigint.c because that
 * unit is linked by any program that merely reaches a bigint (dyn invoke,
 * BigInt64Array), and such a program need not inspect; a reference from
 * scr_bigint.c to scr_insp_* is an undefined symbol under lld-link, which
 * does not drop unreferenced sections before it checks undefined symbols. */
#include "scr_runtime.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* A BigInt64Array / BigUint64Array rendering, Node's formatTypedArray with
 * bigint entries: `BigInt64Array(n) [ 1n, -2n ]`. The gated twin of
 * scr_insp_typed (scr_inspect.c) for the bigint views, which live here so
 * the always-linked inspect unit never references this one. A bigint is
 * numeric for the grid's padding, as Node's groupArrayElements treats
 * number and bigint alike. */
ScrStr *scr_insp_typed_big(ScrBytes *b, ScrStr *name) {
  const size_t n = b->len;
  char lenbuf[40];
  const int ln = snprintf(lenbuf, sizeof lenbuf, "(%zu) [", n);
  ScrStr *head = scr_str_new(name->data, name->len);
  ScrStr *tail = scr_str_new(lenbuf, (size_t)ln);
  ScrStr *b0 = scr_str_new("", 0);
  {
    /* b0 = name + "(n) [" */
    const size_t total = head->len + tail->len;
    char *joined = malloc(total ? total : 1);
    if (!joined) abort();
    memcpy(joined, head->data, head->len);
    memcpy(joined + head->len, tail->data, tail->len);
    scr_str_release(b0);
    b0 = scr_str_new(joined, total);
    free(joined);
  }
  scr_str_release(head);
  scr_str_release(tail);
  ScrStr *b1 = scr_str_new("]", 1);
  ScrStr *base = scr_str_new("", 0);
  scr_insp_begin(1);
  const size_t shown = n < 100 ? n : 100;
  for (size_t i = 0; i < shown; i++) {
    ScrBigInt *v = scr_bytes_get_big(b, (double)i);
    ScrStr *digits = scr_big_to_str(v, 10);
    scr_big_release(v);
    char *s = malloc(digits->len + 1);
    if (!s) abort();
    memcpy(s, digits->data, digits->len);
    s[digits->len] = 'n';
    ScrStr *entry = scr_str_new(s, digits->len + 1);
    free(s);
    scr_str_release(digits);
    scr_insp_entry(entry, true);
    scr_str_release(entry);
  }
  const bool more = n > 100;
  if (more) {
    ScrStr *m = scr_insp_more_items((double)(n - 100));
    scr_insp_entry(m, true);
    scr_str_release(m);
  }
  ScrStr *out = scr_insp_end(base, b0, b1, 1, true, shown + (more ? 1 : 0) > 100);
  scr_str_release(base);
  scr_str_release(b0);
  scr_str_release(b1);
  return out;
}

