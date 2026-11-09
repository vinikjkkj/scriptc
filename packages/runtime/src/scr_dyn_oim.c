/* The literal-key class-instance read, a GATED unit: a program links it only when its emitted code names
 * scr_dyn_objinst_member_get_lit (the sc_dyn_key_get_lit helper, which the emitters call for a key that is an emitted string literal).
 * A program that reads class instances only through computed keys, or not at all, does not carry it, nor the memo table below.
 *
 * THE MEMO. (own descriptor, instance position, key literal) -> the row scr_dyn_objinst_row_scan answers (NULL is a proven miss, cached
 * too).
 *
 * Why a stale answer cannot exist: the value is a pointer into a `const` emitted class table that nothing writes, and the answer is a
 * pure function of (class table, key bytes). The key is the ADDRESS of an immortal string (rc == SCR_STR_IMMORTAL: an emitted literal,
 * never freed, never rewritten), so the address names those bytes forever; this entry is reached only for such a key (the emitter calls
 * it for a string literal), and a computed key never touches the memo. The instance position names the class the registry resolves to
 * (scr_dyn_objinst_class_of is a function of (own descriptor, position)). Everything that varies per instance (the own-shadow hook, the
 * getter, the absent datum) stays outside, evaluated on every read. So there is no epoch to bump: the invalidation list is EMPTY, and
 * tests/harness/dyn-ic-accounting.test.ts pins the premise (no writer of a class table) and runs -DSCR_IC_VERIFY (every hit is
 * re-derived by the scan, exit 98 on a mismatch) against -DSCR_IC_PLANT_STALE (the fill stores the wrong row: the verifier must fire).
 *
 * Direct-mapped, 1024 slots of 32 bytes (32 KB of zero-initialized .bss, no file bytes, present only in a program that links this
 * unit). */

#include "scr_runtime.h"

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

#define SCR_OIM_SLOTS 1024u
#ifndef SCR_OIM_POLICY
#define SCR_OIM_POLICY 1
#endif
typedef struct {
  const ScrDynClass *own;
  const ScrStr *key;
  const ScrDynClassMember *row;
  uint32_t pos;  /* the instance position: a class-registry index, far below 2^32 */
  uint32_t miss; /* evictions this slot has seen: the contention memory of the fill policy */
} ScrOimSlot;
static ScrOimSlot scr_oim[SCR_OIM_SLOTS];

/* The miss path, kept out of line so the hit path stays a leaf with no callee-saved register traffic. */
#if defined(__GNUC__) || defined(__clang__)
__attribute__((noinline))
#endif
static const ScrDynClassMember *oim_fill(ScrOimSlot *s, const ScrDyn *d, const ScrDynClass *own, uint32_t pos, const ScrStr *key) {
  const ScrDynClass *c = scr_dyn_objinst_class_of(d);
  const ScrDynClassMember *row = scr_dyn_objinst_row_scan(c, key->data, key->len);
#if SCR_OIM_POLICY
  /* FILL POLICY. An empty slot takes the pair; an occupied slot is evicted freely for its first three evictions and after that only on
   * every 64th miss, so a working set larger than the table (every read a miss) stops paying the stores of a fill and a hot occupant
   * keeps its hits, while a program that changes phase re-learns within 64 misses per slot. A skipped fill only costs a miss: the
   * answer returned is the scan's, as it is for a fill. */
  if (s->key != NULL) {
    const uint32_t m = ++s->miss;
    if (m > 3u && (m & 63u) != 0) return row;
  }
#endif
  s->own = own;
  s->key = key;
  s->pos = pos;
#ifdef SCR_IC_PLANT_STALE
  s->row = (row != NULL && c->nmembers > 1) ? &c->members[((size_t)(row - c->members) + 1) % c->nmembers] : row;
#else
  s->row = row;
#endif
  return row;
}

#if defined(__GNUC__) || defined(__clang__)
__attribute__((noinline))
#endif
static const ScrDynClassMember *oim_visible_slow(const ScrDyn *d, const ScrDynClassMember *m, const char *k, size_t klen) {
  return scr_dyn_objinst_row_visible(d, m, k, klen);
}

ScrDyn *scr_dyn_objinst_member_get_lit(ScrDyn *d, const ScrStr *key) {
  if (d->kind != SCR_DYN_OBJINST) return NULL;
#ifdef SCR_IC_VERIFY
  /* The premise the memo stands on: its key is the address of an immortal interned literal. */
  if (key->rc != SCR_STR_IMMORTAL) {
    fprintf(stderr, "scriptc: IC VERIFY FAILED: a non-literal key reached the memo\n");
    exit(98);
  }
#endif
  const ScrDynClass *own = d->v.inst.cls;
  const uint32_t pos = (uint32_t)(own->vt ? ((const ScrError *)d->v.inst.o)->vt->pre : own->pre);
  ScrOimSlot *s = &scr_oim[(size_t)((((uint64_t)(uintptr_t)own * 0x9E3779B97F4A7C15ull) ^ ((uint64_t)(uintptr_t)key * 0xC2B2AE3D27D4EB4Full) ^
                                     ((uint64_t)pos * 0x165667B19E3779F9ull)) >> 54)];
  const ScrDynClassMember *cm;
  if (s->key == key && s->own == own && s->pos == pos) {
    cm = s->row;
#ifdef SCR_IC_VERIFY
    if (cm != scr_dyn_objinst_row_scan(scr_dyn_objinst_class_of(d), key->data, key->len)) {
      fprintf(stderr, "scriptc: IC VERIFY FAILED: class %s key %.*s\n", own->name, (int)key->len, key->data);
      exit(98);
    }
#endif
  } else {
    cm = oim_fill(s, d, own, pos, key);
  }
  /* A field row, a miss, and a method row of a class with no run-time property table need no per-instance question: the shadow hook is
   * asked only for a method row (call set, get unset), which the slow body decides exactly as scr_dyn_objinst_member does. */
  if (cm != NULL && cm->call != NULL) cm = oim_visible_slow(d, cm, key->data, key->len);
  if (cm == NULL) return NULL;
  /* The common row, a declared FIELD, finishes here: scr_dyn_objinst_member_get reads cm->get(obj) and adds only two things (the
   * datum a row carries in cm->value, and the _eventsCount cell of an enumerable-4 row), so a get row with neither is exactly the
   * field read. Everything else (a method row, a datum row, an enumerable-4 row) takes the dispatch unit's own body. */
  if (cm->get != NULL && cm->value == NULL && cm->enumerable != 4) return cm->get(d->v.inst.o);
  return scr_dyn_objinst_row_get(d, key, cm);
}
