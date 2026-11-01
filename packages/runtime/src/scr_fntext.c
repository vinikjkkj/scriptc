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

static const char *scr_fn_text_row(const ScrClosure *c);

void scr_fn_texts_install(const ScrFnText *tbl, size_t n) {
  scr_fn_text_row_hook = scr_fn_text_row;
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

/* An adapter closure (a row with a NULL text: the lowerer's %fn.adapt.N.impl,
 * which wraps the function a slot's signature converts) answers the text of
 * the closure it captured at slot 0, so `String(f)` of a function held in a
 * converted slot is the text of f. Bounded: an adapter chain is finite. */
#define SCR_FNTEXT_MAX_HOPS 64

/* The table's text for a closure's entry point, or NULL when the table has none (no
 * default: a caller that needs an exact answer must not print a guessed one). */
static const char *scr_fn_text_row(const ScrClosure *c) {
  if (scr_fntext_idx == NULL || c == NULL || c->fn == NULL) return NULL;
  size_t i = scr_fntext_probe(scr_fntext_idx, scr_fntext_idx_cap, c->fn);
  const ScrFnText *row = scr_fntext_idx[i];
  return (row != NULL && row->fn == c->fn) ? row->text : NULL;
}

ScrStr *scr_fn_text(const ScrClosure *c) {
  const char *text = "function () { [native code] }";
  ScrClosure *held = NULL; /* +1 on the wrapped closure of the last adapter hop */
  for (int hop = 0; hop < SCR_FNTEXT_MAX_HOPS && scr_fntext_idx != NULL && c != NULL && c->fn != NULL; hop++) {
    size_t i = scr_fntext_probe(scr_fntext_idx, scr_fntext_idx_cap, c->fn);
    const ScrFnText *row = scr_fntext_idx[i];
    if (row == NULL || row->fn != c->fn) break;
    if (row->text != NULL) {
      text = row->text;
      break;
    }
    if (c->ncaps < 1 || c->caps[0] == NULL) break;
    ScrClosure *next = (ScrClosure *)scr_box_get_ref(c->caps[0]);
    if (held != NULL) scr_closure_release(held);
    held = next;
    c = next;
  }
  ScrStr *out = scr_str_new(text, strlen(text));
  if (held != NULL) scr_closure_release(held);
  return out;
}
