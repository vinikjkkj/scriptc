/* The multi-byte WHATWG Encoding Standard decoders, transcribed from the standard's decoder algorithms
 * (gb18030 and GBK, Big5, EUC-JP, ISO-2022-JP, Shift_JIS, EUC-KR) over the generated index tables
 * (scr_text_mb_tables.h). A link-gated unit: the emitted main calls scr_text_mb_install on the same predicate the
 * compiler links this file on (ir/nodes.ts moduleUsesTextMb). Each handler step reads one byte (-1: the end of the
 * input) and answers: continue, emit one or two code points, error (one U+FFFD), or finished (end of input). A
 * step may restore bytes to the input, exactly as the standard's ioQueue does; the driver reads them again, in order,
 * before anything after them. */
#include <stddef.h>
#include <stdint.h>
#include "scr_text_mb.h"
#include "scr_text_mb_tables.h"
#include "scr_text_mb_icu.h"

#define EOS_B (-1)
enum { ST_CONT = 0, ST_CP = 1, ST_ERR = 2, ST_FIN = 3 };
enum { ISO_ASCII = 0, ISO_ROMAN = 1, ISO_KATA = 2, ISO_LEAD = 3, ISO_TRAIL = 4, ISO_ESCSTART = 5, ISO_ESCAPE = 6 };

typedef struct Step {
  int st;
  uint32_t cp[2];
  int ncp;
  uint8_t rb[3]; /* bytes restored to the input, in reading order */
  int rn;
} Step;

static void s_cp1(Step *r, uint32_t c) { r->st = ST_CP; r->cp[0] = c; r->ncp = 1; }
static void s_cp2(Step *r, uint32_t a, uint32_t b) { r->st = ST_CP; r->cp[0] = a; r->cp[1] = b; r->ncp = 2; }
static void s_err(Step *r) { r->st = ST_ERR; }
static void s_cont(Step *r) { r->st = ST_CONT; }
static void s_fin(Step *r) { r->st = ST_FIN; }

static int lookup16(const uint16_t *t, size_t n, int64_t ptr, uint32_t *out) {
  if (ptr < 0 || (uint64_t)ptr >= n || t[ptr] == SCR_MB_NONE16) return 0;
  *out = t[ptr];
  return 1;
}
static int lookup32(const uint32_t *t, size_t n, int64_t ptr, uint32_t *out) {
  if (ptr < 0 || (uint64_t)ptr >= n || t[ptr] == SCR_MB_NONE32) return 0;
  *out = t[ptr];
  return 1;
}

/* The index gb18030 ranges code point for a pointer (the standard's algorithm). */
static int gb_range_cp(int64_t ptr, uint32_t *out) {
  if ((ptr > 39419 && ptr < 189000) || ptr > 1237575) return 0;
  if (ptr == 7457) {
    *out = 0xE7C7u;
    return 1;
  }
  /* the last range whose pointer is <= ptr (the ranges are sorted by pointer) */
  size_t lo = 0, hi = SCR_MB_GB_RANGES_LEN; /* find the first > ptr, then step back */
  while (lo < hi) {
    const size_t mid = lo + (hi - lo) / 2;
    if ((int64_t)scr_mb_gb_range_ptr[mid] <= ptr) lo = mid + 1;
    else hi = mid;
  }
  if (lo == 0) return 0;
  const size_t i = lo - 1;
  *out = (uint32_t)(scr_mb_gb_range_cp[i] + (uint64_t)(ptr - (int64_t)scr_mb_gb_range_ptr[i]));
  return 1;
}

/* ── gb18030 (and GBK, the same decoder) ── */
static void step_gb18030(ScrTcMbSt *s, int b, Step *r) {
  if (b == EOS_B) {
    if (s->g1 || s->g2 || s->g3) {
      s->g1 = s->g2 = s->g3 = 0;
      s_err(r);
    } else {
      s_fin(r);
    }
    return;
  }
  if (s->g3) {
    if (b < 0x30 || b > 0x39) {
      r->rb[0] = s->g2;
      r->rb[1] = s->g3;
      r->rb[2] = (uint8_t)b;
      r->rn = 3;
      s->g1 = s->g2 = s->g3 = 0;
      s_err(r);
      return;
    }
    const int64_t ptr = (int64_t)(s->g1 - 0x81) * (10 * 126 * 10) + (int64_t)(s->g2 - 0x30) * (10 * 126) +
                        (int64_t)(s->g3 - 0x81) * 10 + (b - 0x30);
    s->g1 = s->g2 = s->g3 = 0;
    uint32_t cp;
    if (!gb_range_cp(ptr, &cp)) s_err(r);
    else s_cp1(r, cp);
    return;
  }
  if (s->g2) {
    if (b >= 0x81 && b <= 0xFE) {
      s->g3 = (uint8_t)b;
      s_cont(r);
      return;
    }
    r->rb[0] = s->g2;
    r->rb[1] = (uint8_t)b;
    r->rn = 2;
    s->g1 = s->g2 = 0;
    s_err(r);
    return;
  }
  if (s->g1) {
    if (b >= 0x30 && b <= 0x39) {
      s->g2 = (uint8_t)b;
      s_cont(r);
      return;
    }
    const uint8_t leading = s->g1;
    s->g1 = 0;
    if ((b >= 0x40 && b <= 0x7E) || (b >= 0x80 && b <= 0xFE)) {
      const int64_t offset = b < 0x7F ? 0x40 : 0x41;
      const int64_t ptr = (int64_t)(leading - 0x81) * 190 + (b - offset);
      uint32_t cp;
      if (lookup16(scr_mb_gb18030, SCR_MB_GB18030_LEN, ptr, &cp)) {
        s_cp1(r, cp);
        return;
      }
    }
    if (b < 0x80) {
      r->rb[0] = (uint8_t)b;
      r->rn = 1;
    }
    s_err(r);
    return;
  }
  if (b < 0x80) {
    s_cp1(r, (uint32_t)b);
    return;
  }
  if (b == 0x80) {
    s_cp1(r, 0x20AC);
    return;
  }
  if (b >= 0x81 && b <= 0xFE) {
    s->g1 = (uint8_t)b;
    s_cont(r);
    return;
  }
  s_err(r);
}

/* ── ISO-2022-JP (the escape-driven state machine of the standard, with its output flag) ── */
static void step_iso2022jp(ScrTcMbSt *s, int b, Step *r) {
  /* ICU (measured on Node): after an invalid first byte of a two-byte character, an invalid second byte is dropped
   * silently (one U+FFFD for the pair); the escape and a valid lead are read as usual. */
  if (s->iso_skip) {
    s->iso_skip = 0;
    if (b != EOS_B && b != 0x1B && b != 0x0E && b != 0x0F && !(b >= 0x21 && b <= 0x7E)) {
      s_cont(r);
      return;
    }
  }
  switch (s->iso_state) {
    case ISO_ASCII:
      if (b == 0x1B) { s->iso_state = ISO_ESCSTART; s_cont(r); return; }
      if (b == EOS_B) { s_fin(r); return; }
      if (b >= 0 && b <= 0x7F && b != 0x0E && b != 0x0F) { s->iso_out = 0; s_cp1(r, (uint32_t)b); return; }
      s->iso_out = 0;
      s_err(r);
      return;
    case ISO_ROMAN:
      if (b == 0x1B) { s->iso_state = ISO_ESCSTART; s_cont(r); return; }
      if (b == EOS_B) { s_fin(r); return; }
      if (b == 0x5C) { s->iso_out = 0; s_cp1(r, 0x00A5); return; }
      if (b == 0x7E) { s->iso_out = 0; s_cp1(r, 0x203E); return; }
      if (b >= 0 && b <= 0x7F && b != 0x0E && b != 0x0F) { s->iso_out = 0; s_cp1(r, (uint32_t)b); return; }
      s->iso_out = 0;
      s_err(r);
      return;
    case ISO_KATA:
      if (b == 0x1B) { s->iso_state = ISO_ESCSTART; s_cont(r); return; }
      if (b == EOS_B) { s_fin(r); return; }
      if (b == 0x0A || b == 0x0D) { /* ICU (measured): a line break ends the katakana mode too */
        s->iso_out = 0;
        s->iso_state = ISO_ASCII;
        s->iso_out_state = ISO_ASCII;
        s_cp1(r, (uint32_t)b);
        return;
      }
      if (b >= 0x21 && b <= 0x5F) { s->iso_out = 0; s_cp1(r, 0xFF61 - 0x21 + (uint32_t)b); return; }
      s->iso_out = 0;
      s_err(r);
      return;
    case ISO_LEAD:
      if (b == 0x1B) { s->iso_state = ISO_ESCSTART; s_cont(r); return; }
      if (b == EOS_B) { s_fin(r); return; }
      /* ICU (measured): a line feed or carriage return ends the two-byte mode: it is output, and the mode is ASCII */
      if (b == 0x0A || b == 0x0D) {
        s->iso_out = 0;
        s->iso_state = ISO_ASCII;
        s->iso_out_state = ISO_ASCII;
        s_cp1(r, (uint32_t)b);
        return;
      }
      if (b >= 0x21 && b <= 0x7E) {
        s->iso_out = 0;
        s->lead = (uint8_t)b;
        s->iso_state = ISO_TRAIL;
        s_cont(r);
        return;
      }
      s->iso_out = 0;
      s->iso_skip = (uint8_t)(b != 0x0E && b != 0x0F); /* SO and SI are not dropped with their pair (measured) */
      s_err(r);
      return;
    case ISO_TRAIL:
      if (b == 0x1B) { s->iso_state = ISO_ESCSTART; s_err(r); return; }
      /* ICU (measured): SO and SI are not part of the pair; the pair is one error and the shift byte is read again */
      if (b == 0x0E || b == 0x0F) {
        s->iso_state = ISO_LEAD;
        r->rb[0] = (uint8_t)b;
        r->rn = 1;
        s_err(r);
        return;
      }
      if (b >= 0x21 && b <= 0x7E) {
        s->iso_state = ISO_LEAD;
        const int64_t ptr = (int64_t)(s->lead - 0x21) * 94 + (b - 0x21);
        uint32_t cp;
        if (lookup16(scr_mb_jis0208, SCR_MB_JIS0208_LEN, ptr, &cp)) s_cp1(r, cp);
        else s_err(r);
        return;
      }
      s->iso_state = ISO_LEAD; /* end of input, or anything else: one error, back to the leading state */
      s_err(r);
      return;
    case ISO_ESCSTART:
      if (b == 0x24 || b == 0x28) {
        s->lead = (uint8_t)b;
        s->iso_state = ISO_ESCAPE;
        s_cont(r);
        return;
      }
      if (b != EOS_B) {
        r->rb[0] = (uint8_t)b;
        r->rn = 1;
      }
      s->iso_out = 0;
      s->iso_state = s->iso_out_state;
      s_err(r);
      return;
    case ISO_ESCAPE: {
      const uint8_t leading = s->lead;
      s->lead = 0;
      int next = -1;
      if (leading == 0x28 && b == 0x42) next = ISO_ASCII;
      if (leading == 0x28 && b == 0x4A) next = ISO_ROMAN;
      if (leading == 0x28 && b == 0x49) next = ISO_KATA;
      if (leading == 0x24 && (b == 0x40 || b == 0x42)) next = ISO_LEAD;
      if (next >= 0) {
        s->iso_state = (uint8_t)next;
        s->iso_out_state = (uint8_t)next;
        const uint8_t o = s->iso_out;
        s->iso_out = 1;
        if (o) s_err(r);
        else s_cont(r);
        return;
      }
      r->rb[0] = leading;
      r->rn = 1;
      if (b != EOS_B) {
        r->rb[1] = (uint8_t)b;
        r->rn = 2;
      }
      s->iso_out = 0;
      s->iso_state = s->iso_out_state;
      s_err(r);
      return;
    }
    default:
      s_err(r);
      return;
  }
}

/* ── Big5, EUC-KR, Shift_JIS and EUC-JP: the ICU-measured tables (scr_text_mb_icu.h, from Node's ICU) ──
 * A lead byte waits for its trail; the cell of (lead, trail) is a valid pair, or CONS (the error consumes both
 * bytes), or REPROC (the error emits U+FFFD and the trail is read again as a fresh byte). A byte that is not a
 * lead is its single-byte output. The end of the input with a lead pending is one U+FFFD. */
static int icu_emit(const uint32_t cp, void *ctx, ScrTcTokFn tok, ScrTcFailFn fail) {
  return cp == 0xFFFDu ? fail(ctx) : tok(ctx, cp);
}
static int icu_fresh(const ScrIcuFam *f, ScrTcMbSt *st, int b, void *ctx, ScrTcTokFn tok, ScrTcFailFn fail) {
  if (f->lead_index[b] != 0xFF) {
    st->pend = 1;
    st->lead = (uint8_t)b;
    return 0;
  }
  return icu_emit(f->sb[b], ctx, tok, fail);
}
static int icu_feed(const ScrIcuFam *f, ScrTcMbSt *st, int b, void *ctx, ScrTcTokFn tok, ScrTcFailFn fail) {
  if (st->pend == 2) { /* EUC-JP's three-byte form: the trail is in lead2, the third byte is b */
    st->pend = 0;
    const uint16_t c3 = f->cells3[(uint32_t)(st->lead2 - 0xA1) * 256 + (uint32_t)b];
    if (c3 == SCR_ICU_CONS) return fail(ctx);
    if (c3 == SCR_ICU_REPROC || c3 == SCR_ICU_REPROC2) {
      if (fail(ctx) < 0) return -1;
      if (c3 == SCR_ICU_REPROC2 && fail(ctx) < 0) return -1;
      return icu_fresh(f, st, b, ctx, tok, fail);
    }
    return tok(ctx, c3);
  }
  if (!st->pend) return icu_fresh(f, st, b, ctx, tok, fail);
  st->pend = 0;
  const uint32_t row = f->lead_index[st->lead];
  const uint16_t c = f->cells[row * 256 + (uint32_t)b];
  if (c == SCR_ICU_PEND2) {
    st->pend = 2;
    st->lead2 = (uint8_t)b;
    return 0;
  }
  if (c == SCR_ICU_CONS) return fail(ctx);
  if (c == SCR_ICU_REPROC) {
    if (fail(ctx) < 0) return -1;
    return icu_fresh(f, st, b, ctx, tok, fail);
  }
  if (c == SCR_ICU_MULTI) {
    const uint32_t pos = row * 256 + (uint32_t)b;
    size_t lo = 0, hi = f->nmulti;
    while (lo < hi) {
      const size_t mid = lo + (hi - lo) / 2;
      if (f->multi[mid].pos < pos) lo = mid + 1;
      else hi = mid;
    }
    if (lo >= f->nmulti || f->multi[lo].pos != pos) return fail(ctx); /* a table invariant: unreachable */
    for (int i = 0; i < f->multi[lo].n; i++) {
      if (tok(ctx, f->multi[lo].cp[i]) < 0) return -1;
    }
    return 0;
  }
  return tok(ctx, c);
}
static int icu_finish(const ScrIcuFam *f, ScrTcMbSt *st, void *ctx, ScrTcFailFn fail) {
  (void)f;
  if (!st->pend) return 0;
  st->pend = 0; /* a lead, or a three-byte lead's trail, pending at the end: one U+FFFD */
  return fail(ctx);
}
static const ScrIcuFam *icu_family(int fam) {
  switch (fam) {
    case SCR_TXT_FAM_BIG5: return &scr_icu_big5_fam;
    case SCR_TXT_FAM_EUCKR: return &scr_icu_euckr_fam;
    case SCR_TXT_FAM_SJIS: return &scr_icu_sjis_fam;
    case SCR_TXT_FAM_EUCJP: return &scr_icu_eucjp_fam;
    default: return NULL;
  }
}

static void run_step(int fam, ScrTcMbSt *s, int b, Step *r) {
  switch (fam) {
    case SCR_TXT_FAM_GB18030: step_gb18030(s, b, r); return;
    case SCR_TXT_FAM_ISO2022JP: step_iso2022jp(s, b, r); return;
    default: s_err(r); return;
  }
}

/* Emit a step's result and queue its restored bytes IN FRONT of the queue (q[0] is read next). */
static int apply_step(Step *r, void *ctx, ScrTcTokFn tok, ScrTcFailFn fail, int *q, int *qn) {
  if (r->st == ST_CP) {
    for (int i = 0; i < r->ncp; i++) {
      if (tok(ctx, r->cp[i]) < 0) return -1;
    }
  } else if (r->st == ST_ERR) {
    if (fail(ctx) < 0) return -1;
  }
  if (r->rn > 0) {
    for (int k = *qn - 1; k >= 0; k--) q[k + r->rn] = q[k];
    for (int j = 0; j < r->rn; j++) q[j] = r->rb[j];
    *qn += r->rn;
  }
  return 0;
}

int scr_txt_mb_feed(int fam, ScrTcMbSt *st, int b, void *ctx, ScrTcTokFn tok, ScrTcFailFn fail) {
  const ScrIcuFam *icu = icu_family(fam);
  if (icu != NULL) return icu_feed(icu, st, b, ctx, tok, fail);
  int q[8];
  int qn = 0;
  q[qn++] = b;
  while (qn > 0) {
    const int x = q[0];
    for (int i = 1; i < qn; i++) q[i - 1] = q[i];
    qn--;
    Step r = {0};
    run_step(fam, st, x, &r);
    if (apply_step(&r, ctx, tok, fail, q, &qn) < 0) return -1;
  }
  return 0;
}

int scr_txt_mb_finish(int fam, ScrTcMbSt *st, void *ctx, ScrTcTokFn tok, ScrTcFailFn fail) {
  const ScrIcuFam *icu = icu_family(fam);
  if (icu != NULL) return icu_finish(icu, st, ctx, fail);
  int q[8];
  int qn = 0;
  for (;;) {
    int x = EOS_B; /* an empty queue is the end of the input */
    if (qn > 0) {
      x = q[0];
      for (int i = 1; i < qn; i++) q[i - 1] = q[i];
      qn--;
    }
    Step r = {0};
    run_step(fam, st, x, &r);
    if (r.st == ST_FIN) return 0;
    if (apply_step(&r, ctx, tok, fail, q, &qn) < 0) return -1;
  }
}

/* Called by the emitted main when the program constructs a multi-byte codec (ir/nodes.ts moduleUsesTextMb). */
void scr_text_mb_install(void) { scr_txt_mb_set(&scr_txt_mb_feed, &scr_txt_mb_finish); }
