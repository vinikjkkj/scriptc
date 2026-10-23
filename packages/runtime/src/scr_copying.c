#include "scr_runtime.h"

#include <math.h>
#include <stdio.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

/* ES2023 Array/TypedArray copying methods and the typed-array-to-number[]
 * bridge live in their own archive member. Programs that do not use this
 * surface therefore pull in none of it — the static binary size contract. */

static uint64_t copying_slot_from_ptr(void *p) {
  return (uint64_t)(uintptr_t)p;
}

static void *copying_slot_to_ptr(uint64_t slot) {
  return (void *)(uintptr_t)slot;
}

static bool copying_elem_is_ref(ScrElemKind kind) {
  return kind == SCR_ELEM_STR || kind == SCR_ELEM_ARR ||
         kind == SCR_ELEM_BYTES || kind == SCR_ELEM_REF;
}

static ScrArr *copying_arr_new_like(const ScrArr *a, size_t cap) {
  return a->elem == SCR_ELEM_REF
             ? scr_arr_new_ref(a->elem_retain, a->elem_release,
                               a->elem_trace, cap ? cap : 1)
             : scr_arr_new(a->elem, cap ? cap : 1);
}

static uint64_t copying_arr_retain_slot(const ScrArr *a, uint64_t slot) {
  if (!copying_elem_is_ref(a->elem)) return slot;
  void *p = copying_slot_to_ptr(slot);
  /* An ABSENT slot copies through as absent (scr_array.c's
   * scr_elem_retain_p rule): toReversed/toSpliced/toSorted/with are copies,
   * and every retain below dereferences its operand. */
  if (p == NULL) return slot;
  if (a->elem == SCR_ELEM_STR) p = scr_str_retain((ScrStr *)p);
  else if (a->elem == SCR_ELEM_ARR) p = scr_arr_retain((ScrArr *)p);
  else if (a->elem == SCR_ELEM_BYTES) p = scr_bytes_retain((ScrBytes *)p);
  else p = a->elem_retain(p);
  return copying_slot_from_ptr(p);
}

static void copying_arr_copy_slot(ScrArr *out, const ScrArr *src, size_t i) {
  out->data[out->len++] = copying_arr_retain_slot(src, src->data[i]);
}

ScrArr *scr_arr_to_reversed(const ScrArr *a) {
  ScrArr *out = copying_arr_new_like(a, a->len);
  for (size_t i = a->len; i > 0; i--) {
    copying_arr_copy_slot(out, a, i - 1);
  }
  return out;
}

ScrArr *scr_arr_to_spliced(const ScrArr *a, double start,
                           double delete_count, const ScrArr *items) {
  double len = (double)a->len;
  double s0 = isnan(start) ? 0 : trunc(start);
  if (s0 < 0) s0 += len;
  size_t from = s0 <= 0 ? 0 : s0 >= len ? a->len : (size_t)s0;
  double avail = len - (double)from;
  double d0 = isnan(delete_count) ? 0 : trunc(delete_count);
  size_t ndelete =
      d0 <= 0 ? 0 : d0 >= avail ? (size_t)avail : (size_t)d0;
  if (items->len > SIZE_MAX - (a->len - ndelete)) {
    scr_trap("scriptc: out of memory\n");
  }
  size_t out_len = a->len - ndelete + items->len;
  ScrArr *out = copying_arr_new_like(a, out_len);
  for (size_t i = 0; i < from; i++) copying_arr_copy_slot(out, a, i);
  for (size_t i = 0; i < items->len; i++) {
    out->data[out->len++] =
        copying_arr_retain_slot(a, items->data[i]);
  }
  for (size_t i = from + ndelete; i < a->len; i++) {
    copying_arr_copy_slot(out, a, i);
  }
  return out;
}

static bool copying_arr_with_index(const ScrArr *a, double index,
                                   size_t *out) {
  double rel = isnan(index) ? 0 : trunc(index);
  double actual = rel >= 0 ? rel : (double)a->len + rel;
  if (!(actual >= 0) || actual >= (double)a->len) {
    char num[32];
    size_t numlen = scr_f64_to_str(index, num);
    char msg[80];
    int mlen = snprintf(msg, sizeof msg, "Invalid index : %.*s",
                        (int)numlen, num);
    scr_throw_error_msg(SCR_ERR_RANGE, msg, (size_t)mlen);
    return false;
  }
  *out = (size_t)actual;
  return true;
}

ScrArr *scr_arr_with_f64(ScrArr *a, double index, double value) {
  size_t i;
  if (!copying_arr_with_index(a, index, &i)) return NULL;
  ScrArr *out = scr_arr_slice(a, 0, INFINITY);
  scr_arr_set_f64(out, (double)i, value);
  return out;
}

ScrArr *scr_arr_with_bool(ScrArr *a, double index, bool value) {
  size_t i;
  if (!copying_arr_with_index(a, index, &i)) return NULL;
  ScrArr *out = scr_arr_slice(a, 0, INFINITY);
  scr_arr_set_bool(out, (double)i, value);
  return out;
}

ScrArr *scr_arr_with_ref(ScrArr *a, double index, void *value) {
  size_t i;
  if (!copying_arr_with_index(a, index, &i)) return NULL;
  ScrArr *out = scr_arr_slice(a, 0, INFINITY);
  uint64_t retained =
      copying_arr_retain_slot(a, copying_slot_from_ptr(value));
  scr_arr_set_ref(out, (double)i, copying_slot_to_ptr(retained));
  return out;
}

/* toReversed and with build through TypedArrayCreateSameType, which
 * takes the INTRINSIC default constructor rather than the species one —
 * so a Buffer's toReversed()/with() answer a plain Uint8Array, unlike
 * slice/subarray/fill/sort, which propagate. Checked against Node. */
ScrBytes *scr_bytes_to_reversed(const ScrBytes *b) {
  ScrBytes *out = scr_bytes_new(b->elem, (double)b->len);
  for (size_t i = 0; i < b->len; i++) {
    scr_bytes_set(out, (double)i,
                  scr_bytes_get(b, (double)(b->len - i - 1)));
  }
  return scr_bytes_stamp_plain(out);
}

ScrBytes *scr_bytes_with(const ScrBytes *b, double index, double value) {
  double rel = isnan(index) ? 0 : trunc(index);
  double actual = rel >= 0 ? rel : (double)b->len + rel;
  if (!(actual >= 0) || actual >= (double)b->len) {
    static const char msg[] = "Invalid typed array index";
    scr_throw_error_msg(SCR_ERR_RANGE, msg, sizeof msg - 1);
    return NULL;
  }
  ScrBytes *out = scr_bytes_copy(b);
  scr_bytes_set(out, actual, value);
  return scr_bytes_stamp_plain(out);
}

ScrArr *scr_bytes_to_arr(const ScrBytes *b) {
  ScrArr *out = scr_arr_new(SCR_ELEM_F64, b->len ? b->len : 1);
  for (size_t i = 0; i < b->len; i++) {
    scr_arr_push_f64(out, scr_bytes_get(b, (double)i));
  }
  return out;
}

ScrStr *scr_bytes_join(const ScrBytes *b, const ScrStr *separator) {
  ScrArr *values = scr_bytes_to_arr(b);
  ScrStr *out = scr_arr_join(values, (ScrStr *)separator);
  scr_arr_release(values);
  return out;
}

/* String(bytes) by flavor -- lives beside scr_bytes_join, which it calls, and
 * links on the same moduleUsesCopying gate (the bytes.jsString libCall). */
ScrStr *scr_bytes_js_string(const ScrBytes *b) {
  switch (b->flavor) {
    case SCR_BF_BUFFER: {
      ScrStr *enc = scr_str_new("utf8", 4);
      ScrStr *r = scr_bytes_to_str(b, enc);
      scr_str_release(enc);
      return r;
    }
    case SCR_BF_PLAIN: {
      ScrStr *sep = scr_str_new(",", 1);
      ScrStr *r = scr_bytes_join(b, sep);
      scr_str_release(sep);
      return r;
    }
    case SCR_BF_DATAVIEW: return scr_str_new("[object DataView]", 17);
    default: {
      static const char msg[] = "String() of a byte array whose Buffer-ness is unknown "
                                "(its producer stamps no flavor)";
      scr_throw_error_msg(SCR_ERR_ERROR, msg, sizeof msg - 1);
      return NULL;
    }
  }
}

/* ── string-pattern replace (the string.replaceStr libCall) ─ gated with this
 * unit, like bytes.jsString above, so a program that never uses it does not
 * carry it. */
/* s.replace(pat, rep) / s.replaceAll(pat, rep) with STRING pattern and STRING
 * replacement. The match is a byte search (valid UTF-8 is self-synchronising,
 * so a match always lies on code point boundaries); the replacement text goes
 * through GetSubstitution with no captures: `$$` -> `$`, `$&` -> the match,
 * `$\`` -> the text before it, `$'` -> the text after it, and every other `$`
 * (including `$1`, `$<name>`) stays literal. An empty pattern matches at every
 * code point boundary for replaceAll (`"abc".replaceAll("", "-")` is
 * "-a-b-c-") and at 0 for replace. KNOWN DIVERGENCE: JS positions are UTF-16
 * units, so for an astral character V8 would also insert between its two
 * surrogate halves; a lone surrogate is unrepresentable in this runtime's
 * UTF-8 strings, so insertion happens at code point boundaries only.
 * Borrows all three; +1. */
static void scr_repl_put(char **buf, size_t *len, size_t *cap, const char *p, size_t n) {
  if (*len + n + 1 > *cap) {
    size_t nc = *cap ? *cap : 64;
    while (nc < *len + n + 1) nc *= 2;
    char *nb = (char *)realloc(*buf, nc);
    if (!nb) scr_trap("scriptc: out of memory\n");
    *buf = nb;
    *cap = nc;
  }
  if (n) memcpy(*buf + *len, p, n);
  *len += n;
}

static void scr_repl_substitute(char **buf, size_t *len, size_t *cap, const ScrStr *s, size_t pos,
                                size_t mlen, const ScrStr *rep) {
  const char *r = rep->data;
  size_t rl = rep->len;
  for (size_t i = 0; i < rl; i++) {
    if (r[i] == '$' && i + 1 < rl) {
      char c = r[i + 1];
      if (c == '$') { scr_repl_put(buf, len, cap, "$", 1); i++; continue; }
      if (c == '&') { scr_repl_put(buf, len, cap, s->data + pos, mlen); i++; continue; }
      if (c == '`') { scr_repl_put(buf, len, cap, s->data, pos); i++; continue; }
      if (c == '\'') { scr_repl_put(buf, len, cap, s->data + pos + mlen, s->len - pos - mlen); i++; continue; }
    }
    scr_repl_put(buf, len, cap, r + i, 1);
  }
}

ScrStr *scr_str_replace_str(ScrStr *s, ScrStr *pat, ScrStr *rep, bool all) {
  char *buf = NULL;
  size_t len = 0, cap = 0;
  size_t from = 0; /* bytes of s already copied */
  size_t plen = pat->len;
  if (plen == 0) {
    size_t i = 0;
    for (;;) {
      scr_repl_put(&buf, &len, &cap, s->data + from, i - from);
      from = i;
      scr_repl_substitute(&buf, &len, &cap, s, i, 0, rep);
      if (!all || i >= s->len) break;
      /* copy one whole code point, then the next boundary */
      size_t step = 1;
      unsigned char c = (unsigned char)s->data[i];
      if (c >= 0xF0) step = 4; else if (c >= 0xE0) step = 3; else if (c >= 0xC0) step = 2;
      if (i + step > s->len) step = s->len - i;
      i += step;
    }
    scr_repl_put(&buf, &len, &cap, s->data + from, s->len - from);
  } else {
    size_t i = 0;
    while (i + plen <= s->len) {
      const char *hit = (const char *)memchr(s->data + i, pat->data[0], s->len - i - plen + 1);
      if (!hit) break;
      size_t at = (size_t)(hit - s->data);
      if (memcmp(s->data + at, pat->data, plen) != 0) { i = at + 1; continue; }
      scr_repl_put(&buf, &len, &cap, s->data + from, at - from);
      scr_repl_substitute(&buf, &len, &cap, s, at, plen, rep);
      from = at + plen;
      i = from;
      if (!all) break;
    }
    scr_repl_put(&buf, &len, &cap, s->data + from, s->len - from);
  }
  ScrStr *out = scr_str_new(buf ? buf : "", len);
  free(buf);
  return out;
}

/* ── Object.prototype.toString.call over a dyn (the dyn.objectToString libCall) ─ gated
 * with this unit for the same reason. */
/* Object.prototype.toString.call(v) over a dyn value: "[object Tag]".
 * Builtin tags by kind (Buffer and Uint8Array both answer Uint8Array, an
 * error encoding answers Error); an OBJ whose own string member is keyed by
 * the well-known Symbol.toStringTag (the compiler spells that key
 * "__@toStringTag@<id>") answers its value. Borrowed; +1; never throws. */
ScrStr *scr_dyn_object_to_string(const ScrDyn *d) {
  const char *tag = "Object";
  switch (d->kind) {
  case SCR_DYN_NULL: tag = "Null"; break;
  case SCR_DYN_UNDEF: tag = "Undefined"; break;
  case SCR_DYN_BOOL: tag = "Boolean"; break;
  case SCR_DYN_NUM: tag = "Number"; break;
  case SCR_DYN_STR: tag = "String"; break;
  case SCR_DYN_ARR: tag = "Array"; break;
  case SCR_DYN_BYTES: tag = "Uint8Array"; break;
  case SCR_DYN_ARRBUF: tag = "ArrayBuffer"; break;
  case SCR_DYN_FUNC: tag = "Function"; break;
  case SCR_DYN_PROMISE: tag = "Promise"; break;
  case SCR_DYN_BIG: tag = "BigInt"; break;
  case SCR_DYN_MAP: tag = scr_dyn_map_cls(d); break;
  case SCR_DYN_HANDLE:
    if (d->v.handle.tag == SCR_DYNH_DATE) tag = "Date";
    else if (d->v.handle.tag == SCR_DYNH_REGEX) tag = "RegExp";
    break;
  case SCR_DYN_OBJ:
    if (scr_dyn_is_error_encoding(d)) { tag = "Error"; break; }
    for (int pass = 0; pass < 2; pass++) {
     /* pass 1 reads the HIDDEN table: a symbol-keyed member of a converted record is non-enumerable
      * (scr_dyn_obj_set_symkey), so the tag lives there as a [value, ...] descriptor. */
     const ScrDyn *src = d;
     if (pass == 1) {
       if (scr_dyn_ext(d)->hidden == NULL) break;
       src = scr_dyn_ext(d)->hidden;
     }
     for (size_t i = 0; i < src->v.obj.len; i++) {
      const ScrDynEntry *e = &src->v.obj.entries[i];
      const ScrDyn *val = e->value;
      if (pass == 1) {
        if (val->kind != SCR_DYN_ARR || val->v.arr.len < 2) continue;
        val = val->v.arr.items[1];
      }
      if (e->key_len > 15 && memcmp(e->key, "__@toStringTag@", 15) == 0 && val->kind == SCR_DYN_STR) {
        const ScrStr *t = val->v.str;
        ScrStr *out = scr_str_alloc_raw(t->len + 9, t->len + 9);
        memcpy(out->data, "[object ", 8);
        memcpy(out->data + 8, t->data, t->len);
        out->data[8 + t->len] = ']';
        out->len = (uint32_t)(t->len + 9);
        out->data[out->len] = '\0';
        return out;
      }
     }
    }
    break;
  default: break;
  }
  char buf[48];
  int n = snprintf(buf, sizeof buf, "[object %s]", tag);
  return scr_str_new(buf, (size_t)n);
}
