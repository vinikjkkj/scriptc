/* The multi-byte WHATWG decoders (gb18030 and gbk, big5, euc-jp, iso-2022-jp, shift_jis, euc-kr): their per-decoder
 * state and the entry points that scr_json.c calls through function pointers. The decoders themselves are in
 * scr_text_mb.c, a LINK-GATED unit: the compiler links it, and the emitted main installs it, only for a program
 * that constructs a multi-byte codec (the scr_zlib_stream.c pattern). */
#ifndef SCR_TEXT_MB_H
#define SCR_TEXT_MB_H
#include <stdint.h>

/* The multi-byte family of a kind-MB encoding (the 4th column of scr_text_tables.h). */
enum { SCR_TXT_FAM_NONE, SCR_TXT_FAM_GB18030, SCR_TXT_FAM_BIG5, SCR_TXT_FAM_EUCJP, SCR_TXT_FAM_ISO2022JP, SCR_TXT_FAM_SJIS, SCR_TXT_FAM_EUCKR };

/* One decoder's multi-byte state (the WHATWG per-decoder variables of its family; all zero at rest). */
typedef struct ScrTcMbSt {
  uint8_t g1, g2, g3;    /* gb18030: first, second, third byte */
  uint8_t lead;          /* big5, euc-jp, shift_jis, euc-kr: the leading byte; iso-2022-jp: its leading byte */
  uint8_t jis0212;       /* euc-jp: the 0x8F three-byte form */
  uint8_t iso_state;     /* iso-2022-jp decoder state: 0 ASCII, 1 Roman, 2 katakana, 3 leading, 4 trailing, 5 escape start, 6 escape */
  uint8_t iso_out_state; /* iso-2022-jp decoder output state (0 ASCII, 1 Roman, 2 katakana) */
  uint8_t iso_out;       /* iso-2022-jp output flag */
  uint8_t iso_skip;      /* iso-2022-jp: the byte after an invalid first byte is dropped when invalid (ICU) */
  uint8_t pend;          /* the ICU-table families: 1 a lead waits for its trail; 2 a three-byte lead waits for its third byte */
  uint8_t lead2;         /* the ICU-table families: the trail of a three-byte lead (pend == 2) */
} ScrTcMbSt;

/* A token sink: a code point out (0), or -1 with a fatal TypeError pending. A failure is one U+FFFD (or -1 fatal). */
typedef int (*ScrTcTokFn)(void *ctx, uint32_t cp);
typedef int (*ScrTcFailFn)(void *ctx);
/* Feed one input byte (the queue of restored bytes is drained inside the call); finish flushes at end of input. */
typedef int (*ScrTcMbFeedFn)(int fam, ScrTcMbSt *st, int b, void *ctx, ScrTcTokFn tok, ScrTcFailFn fail);
typedef int (*ScrTcMbFinishFn)(int fam, ScrTcMbSt *st, void *ctx, ScrTcTokFn tok, ScrTcFailFn fail);

/* scr_json.c: installs the decoders (called by scr_text_mb_install from scr_text_mb.c). */
void scr_txt_mb_set(ScrTcMbFeedFn feed, ScrTcMbFinishFn finish);

#endif
