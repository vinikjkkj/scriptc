/* The literal-key class-instance read, a GATED unit: a program links it only when its emitted code names
 * scr_dyn_objinst_member_get_lit (the sc_dyn_key_get_lit helper, which the emitters call for a key that is an emitted string literal).
 * A program that reads class instances only through computed keys, or not at all, does not carry it. */

#include "scr_runtime.h"

ScrDyn *scr_dyn_objinst_member_get_lit(ScrDyn *d, const ScrStr *key) {
  const ScrDynClassMember *cm = scr_dyn_objinst_member(d, key->data, key->len);
  if (cm == NULL) return NULL;
  /* The common row, a declared FIELD, finishes here: scr_dyn_objinst_member_get reads cm->get(obj) and adds only two things (the
   * datum a row carries in cm->value, and the _eventsCount cell of an enumerable-4 row), so a get row with neither is exactly the
   * field read. Everything else (a method row, a datum row, an enumerable-4 row) takes the dispatch unit's own body. */
  if (cm->get != NULL && cm->value == NULL && cm->enumerable != 4) return cm->get(d->v.inst.o);
  return scr_dyn_objinst_row_get(d, key, cm);
}
