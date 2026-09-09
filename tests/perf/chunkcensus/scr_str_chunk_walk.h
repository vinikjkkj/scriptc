/* scr_str_chunk_walk.h - the STRING arena's half of the chunk census.
 *
 * #include'd BY packages/runtime/src/scr_string.c from inside its own
 * #ifdef SCR_CHUNKCEN_ON, after scr_str_ar_free/_cur/_lim are declared and
 * before scr_str_ar_take, which calls the note function below.
 *
 * WHY THIS ARENA NEEDS A REGISTRY MORE THAN THE CYCLE ARENA DOES.
 *
 * The cycle arena cannot ENUMERATE its chunks (a full chunk is on no
 * list), but it can free one: it keeps `raw` per chunk and a chunk-local
 * free list, so it knows when a chunk has emptied and what pointer to hand
 * to free(). The string arena has neither. Read scr_str_ar_take:
 *
 *     unsigned char *k = (unsigned char *)malloc(SCR_STR_ARENA_CHUNK);
 *     if (k == NULL) return NULL;
 *     scr_str_ar_cur = k;
 *     scr_str_ar_lim = k + SCR_STR_ARENA_CHUNK;
 *
 * `k` is stored in two globals and both are overwritten by the next chunk.
 * The pointer malloc returned does not survive anywhere in the process, so
 * free() can never be called on it -- not "is not", cannot be. And
 * scr_str_ar_give pushes onto scr_str_ar_free[class], which is GLOBAL
 * rather than chunk-local, so even with the pointer kept there would be no
 * way to know a chunk had emptied. cycstat's counter set records the same
 * fact by omission: the cycle arena has `arfree`, this one has no
 * `sarfree`, because there is no free path to count.
 *
 * Every 64 KiB this arena takes is therefore held until the process exits,
 * at whatever occupancy it happens to have. The registry here is what
 * makes that occupancy measurable, and it is also -- exactly as in the
 * cycle arena's case -- the structure any future fix would have to add.
 *
 * THE TAIL IS ABANDONED, and it is counted separately because it is a
 * different kind of waste. When a request does not fit in `lim - cur` a
 * whole new chunk is taken and the remainder of the old one is never
 * carved and never reachable: it is not on a free list, it is not live,
 * and no later allocation can reach it. Up to SCR_POOL_MAX - 1 bytes per
 * chunk switch.
 *
 * HOW OCCUPANCY IS RECOVERED WITHOUT PER-CHUNK BOOKKEEPING. The carved
 * region of a chunk is a gapless partition into blocks (a bump carve), so
 * every carved byte is either in a live block or in a block on some class
 * free list. The free lists are walkable and each list's class fixes its
 * block size, so walking them and charging each block's bytes to the page
 * it lands in gives free bytes per page; a page whose free bytes plus its
 * uncarved bytes fill it is a page holding nothing live. Live bytes are
 * the carved length minus the free bytes.
 *
 * FOREIGN BLOCKS ARE COUNTED, NOT ASSUMED AWAY. scr_str_ar_take falls back
 * to malloc when a chunk cannot be had, and scr_string.c's own comment
 * says such a block "still reaches scr_str_ar_give at death". Those blocks
 * sit on the same global free lists and are NOT inside any chunk. A walk
 * that assumed every free block was in a chunk would either crash or
 * silently mis-attribute them, so each is checked against the registry and
 * the misses are reported as `freeForeign`.
 */
#ifndef SCR_STR_CHUNK_WALK_H
#define SCR_STR_CHUNK_WALK_H

/* 4096 chunks is 256 MiB of string arena. Overflow is COUNTED and printed,
 * never silently clipped -- tests/perf/memmap records SCR_MM_MAXREG
 * clipping silently as a defect, and a census that quietly stops counting
 * reports a floor as a total. */
#define SCR_KC_STR_MAXCHUNK 4096
#define SCR_KC_STR_PAGES ((size_t)((64u << 10) / 4096u)) /* 16 */

/* Kept SORTED BY BASE so a free block can be placed by binary search. The
 * insert costs one memmove per 64 KiB of arena and buys an O(log n) lookup
 * for each of the (many) free blocks at walk time. */
static unsigned char *scr_kc_sb[SCR_KC_STR_MAXCHUNK];
static unsigned char *scr_kc_se[SCR_KC_STR_MAXCHUNK];
static size_t scr_kc_sn = 0;
static unsigned long long scr_kc_sover = 0;
static uint16_t scr_kc_spg[SCR_KC_STR_MAXCHUNK * SCR_KC_STR_PAGES];

/* Called from scr_str_ar_take immediately after a successful malloc and
 * BEFORE scr_str_ar_cur/_lim are reassigned, so the chunk being retired
 * can have its final carve position recorded. */
SCR_KC_FN void scr_kc_str_note(unsigned char *k) {
  size_t lo = 0, hi = scr_kc_sn, mid;
  if (scr_kc_sn > 0 && scr_str_ar_cur != 0) {
    /* close out the outgoing chunk: whatever it had carved is final */
    size_t i;
    for (i = 0; i < scr_kc_sn; i++)
      if (scr_str_ar_cur >= scr_kc_sb[i] && scr_str_ar_cur <= scr_kc_sb[i] + (64u << 10)) {
        scr_kc_se[i] = scr_str_ar_cur;
        break;
      }
  }
  if (scr_kc_sn >= SCR_KC_STR_MAXCHUNK) { scr_kc_sover++; return; }
  while (lo < hi) { mid = (lo + hi) / 2; if (scr_kc_sb[mid] < k) lo = mid + 1; else hi = mid; }
  if (lo < scr_kc_sn) {
    __builtin_memmove(&scr_kc_sb[lo + 1], &scr_kc_sb[lo], (scr_kc_sn - lo) * sizeof scr_kc_sb[0]);
    __builtin_memmove(&scr_kc_se[lo + 1], &scr_kc_se[lo], (scr_kc_sn - lo) * sizeof scr_kc_se[0]);
  }
  scr_kc_sb[lo] = k;
  scr_kc_se[lo] = k; /* nothing carved yet */
  scr_kc_sn++;
}

SCR_KC_FN long scr_kc_str_find(const unsigned char *b) {
  size_t lo = 0, hi = scr_kc_sn;
  while (lo < hi) {
    size_t mid = (lo + hi) / 2;
    if (scr_kc_sb[mid] <= b) lo = mid + 1; else hi = mid;
  }
  if (lo == 0) return -1;
  lo--;
  if (b >= scr_kc_sb[lo] && b < scr_kc_sb[lo] + (64u << 10)) return (long)lo;
  return -1;
}

SCR_KC_FN void scr_kc_str_walk_impl(FILE *out, int rows) {
  size_t i, c;
  unsigned long long freeBlocks = 0, freeBytes = 0, freeForeign = 0, freeForeignBytes = 0;
  unsigned long long carvedBytes = 0, liveBytes = 0, tailBytes = 0;
  unsigned long long idealFree = 0, idealCand = 0, wholeEmpty = 0, misaligned = 0;
  unsigned long long bucket[SCR_KC_NBUCKET];

  for (i = 0; i < SCR_KC_NBUCKET; i++) bucket[i] = 0;
  if (scr_kc_sn == 0) {
    fprintf(out, "CHUNKCEN-STR chunks=0 over=%llu NO-CHUNKS\n", scr_kc_sover);
    return;
  }
  /* the live chunk's carve position is only final at walk time */
  {
    long cur = scr_kc_str_find(scr_str_ar_cur - (scr_str_ar_cur > scr_kc_sb[0] ? 1 : 0));
    if (cur >= 0 && scr_str_ar_cur >= scr_kc_sb[cur]) scr_kc_se[cur] = scr_str_ar_cur;
  }
  for (i = 0; i < scr_kc_sn * SCR_KC_STR_PAGES; i++) scr_kc_spg[i] = 0;

  /* Charge every free block's bytes to the pages it lands in. */
  for (c = 1; c <= (size_t)SCR_POOL_CLASSES; c++) {
    size_t r = c * SCR_POOL_GRAIN;
    void *b = scr_str_ar_free[c];
    size_t guard = 0;
    for (; b != NULL && guard < (size_t)(SCR_KC_STR_MAXCHUNK * 4096); guard++) {
      long idx = scr_kc_str_find((const unsigned char *)b);
      if (idx < 0) { freeForeign++; freeForeignBytes += r; }
      else {
        size_t off = (size_t)((unsigned char *)b - scr_kc_sb[idx]);
        size_t end = off + r, p;
        freeBlocks++;
        freeBytes += r;
        for (p = off / 4096u; p * 4096u < end && p < SCR_KC_STR_PAGES; p++) {
          size_t lo = p * 4096u > off ? p * 4096u : off;
          size_t hi = (p + 1) * 4096u < end ? (p + 1) * 4096u : end;
          scr_kc_spg[(size_t)idx * SCR_KC_STR_PAGES + p] += (uint16_t)(hi - lo);
        }
      }
      __builtin_memcpy(&b, b, sizeof(void *));
    }
  }

  for (i = 0; i < scr_kc_sn; i++) {
    size_t carved = (size_t)(scr_kc_se[i] - scr_kc_sb[i]);
    unsigned long long chunkFree = 0;
    unsigned long chFreePg = 0;
    size_t p;
    if (((uintptr_t)(void *)scr_kc_sb[i] & 4095u) != 0) misaligned++;
    for (p = 0; p < SCR_KC_STR_PAGES; p++) {
      size_t pgFree = scr_kc_spg[i * SCR_KC_STR_PAGES + p];
      size_t pgLo = p * 4096u, pgHi = pgLo + 4096u;
      size_t uncarved = pgHi > carved ? (pgHi - (pgLo > carved ? pgHi : carved)) : 0;
      if (pgLo >= carved) uncarved = 4096u;
      chunkFree += pgFree;
      idealCand++;
      if (pgFree + uncarved >= 4096u) { idealFree++; chFreePg++; }
    }
    carvedBytes += carved;
    tailBytes += (64u << 10) - carved;
    liveBytes += (unsigned long long)carved - chunkFree;
    if ((unsigned long long)carved == chunkFree) wholeEmpty++;
    bucket[scr_kc_bucket((size_t)(carved - chunkFree), 64u << 10)]++;
    if (rows)
      fprintf(out,
              "CHUNKCEN-STRCHUNK %llu carved=%llu freeBytes=%llu liveBytes=%llu "
              "tail=%llu idealFreePg=%lu base=%p\n",
              (unsigned long long)i + 1, (unsigned long long)carved, chunkFree,
              (unsigned long long)carved - chunkFree,
              (unsigned long long)((64u << 10) - carved), chFreePg,
              (void *)scr_kc_sb[i]);
  }

  fprintf(out,
          "CHUNKCEN-STR chunks=%llu over=%llu heldBytes=%llu carvedBytes=%llu "
          "liveBytes=%llu freelistBlocks=%llu freelistBytes=%llu "
          "abandonedTailBytes=%llu freeForeign=%llu freeForeignBytes=%llu "
          "emptyHeld=%llu misalignedChunks=%llu releasable=NEVER\n",
          (unsigned long long)scr_kc_sn, scr_kc_sover,
          (unsigned long long)scr_kc_sn * (64u << 10), carvedBytes, liveBytes,
          freeBlocks, freeBytes, tailBytes, freeForeign, freeForeignBytes,
          wholeEmpty, misaligned);
  fprintf(out,
          "CHUNKCEN-STRPAGE idealFreePg=%llu idealFreeBytes=%llu idealCandPg=%llu\n",
          idealFree, idealFree * 4096ull, idealCand);
  for (i = 0; i < SCR_KC_NBUCKET; i++)
    if (bucket[i])
      fprintf(out, "CHUNKCEN-STROCC %s %llu\n", scr_kc_bucket_name[i], bucket[i]);
}

SCR_KC_SHARED int scr_kc_str_reg_ran = 0;
__attribute__((constructor)) SCR_KC_FN void scr_kc_str_register(void) {
  if (scr_kc_str_reg_ran) return;
  scr_kc_str_reg_ran = 1;
  scr_kc_str_walk = scr_kc_str_walk_impl;
}

#endif /* SCR_STR_CHUNK_WALK_H */
