/* Function.prototype.toString of a function value (fn-srctext.ts on the
 * compiler side). A closure's entry point keys the program's text table,
 * installed by main() from the rows the compiler emits when the program uses
 * fn.text; this unit is linked only then (moduleUsesFnText), so a program that
 * never turns a function into a string keeps its exact .text.
 *
 * The lookup mirrors scr_closure.c's name table: an open-addressed index built
 * once at install, probed by the entry pointer. A closure with no row was made
 * by the runtime itself (a bound or promise-adapter callback), and Node prints
 * that native form for it. */
#include <stdlib.h>
#include <string.h>
#include "scr_runtime.h"

static const ScrFnText **scr_fntext_idx = NULL;
static size_t scr_fntext_idx_cap = 0;

static size_t scr_fntext_probe(const ScrFnText **tab, size_t cap, const void *fn) {
  uintptr_t x = (uintptr_t)fn;
  x ^= x >> 33;
  x *= (uintptr_t)0xff51afd7ed558ccdULL;
  x ^= x >> 29;
  size_t mask = cap - 1, i = (size_t)x & mask;
  while (tab[i] != NULL && tab[i]->fn != fn) i = (i + 1) & mask;
  return i;
}

void scr_fn_texts_install(const ScrFnText *tbl, size_t n) {
  free(scr_fntext_idx);
  scr_fntext_idx = NULL;
  scr_fntext_idx_cap = 0;
  if (tbl == NULL || n == 0) return;
  size_t cap = 16;
  while (cap < n * 2) cap *= 2;
  const ScrFnText **idx = (const ScrFnText **)calloc(cap, sizeof *idx);
  if (idx == NULL) return;
  for (size_t i = 0; i < n; i++) {
    if (tbl[i].fn == NULL) continue;
    size_t k = scr_fntext_probe(idx, cap, tbl[i].fn);
    if (idx[k] == NULL) idx[k] = &tbl[i];
  }
  scr_fntext_idx = idx;
  scr_fntext_idx_cap = cap;
}

ScrStr *scr_fn_text(const ScrClosure *c) {
  const char *text = "function () { [native code] }";
  if (scr_fntext_idx != NULL && c != NULL && c->fn != NULL) {
    size_t i = scr_fntext_probe(scr_fntext_idx, scr_fntext_idx_cap, c->fn);
    const ScrFnText *row = scr_fntext_idx[i];
    if (row != NULL && row->fn == c->fn) text = row->text;
  }
  return scr_str_new(text, strlen(text));
}
