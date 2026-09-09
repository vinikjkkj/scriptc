/* scr_chunk_census_walk.h - the cycle arena's half of the chunk census.
 *
 * #include'd BY packages/runtime/src/scr_cycle.c, from inside that file's
 * own #ifdef SCR_CHUNKCEN_ON, at a point where ScrCycChunk, the class
 * tables and scr_cyc_ar_held are all declared. It cannot be -include'd:
 * scr_chunk_census.h is processed before scr_runtime.h and none of those
 * types exist yet when it is read. That is the split tests/perf/dyncensus
 * established between scr_dyn_census.h and scr_dyn_census_walk.h.
 *
 * WHAT IT COMPUTES, per chunk, and where each quantity comes from -- the
 * point being that no two of them come from the same place:
 *
 *   capacity   (lim - carveBase) / stride        geometry
 *   carved     (bump - carveBase) / stride       the bump pointer
 *   freeN      walked, off the chunk's own list  the free list
 *   used       read from the chunk               the allocator's counter
 *
 * and then asserts the identity `used == carved - freeN`. `used` is
 * maintained by the two allocation sites and the one free site; `carved`
 * and `freeN` are recovered here by two different routes that touch none
 * of that. A walk that agreed only with itself could be confidently wrong;
 * this one cannot be wrong without the disagreement printing.
 *
 * THE LIVE-SLOT BITMAP is what turns a per-chunk occupancy into a page
 * answer. Carved slot i lies at carveBase + i*stride. The free list names
 * the carved slots that are NOT live, so marking those and inverting gives
 * every live block's exact byte range -- and a page holding no live byte
 * is a page a decommit could take. The alternative (walking live objects
 * and mapping each back to its chunk) would need the whole cycle graph and
 * would miss anything the collector cannot reach.
 *
 * THE FREE-LIST WALK IS BOUNDED. A corrupt or cyclic list would otherwise
 * hang the process inside the instrument, at the loop seam, with no output
 * -- indistinguishable from the workload simply being slow. It stops after
 * `capacity` steps and reports LISTOVERRUN for that chunk, and the chunk is
 * excluded from the totals rather than silently truncating them.
 */
#ifndef SCR_CHUNK_CENSUS_WALK_H
#define SCR_CHUNK_CENSUS_WALK_H

/* Carved slots per chunk cannot exceed (65536 - 256) / 16: the stride is
 * `(phys + 15) & ~15` and phys is at least sizeof(ScrCycHdr) + 1. Static,
 * because this runs at a seam in a process whose heap is the subject. */
#define SCR_KC_MAXSLOT 4096
#define SCR_KC_MAXPAGE 32

static unsigned char scr_kc_slotfree[SCR_KC_MAXSLOT];

/* Which class table, if any, still points at this chunk. Reported per
 * chunk because the three states have different reclaim stories: a CURRENT
 * chunk is deliberately never released even when empty (it is the class's
 * one-chunk cache), a PARTIAL one is reachable for allocation, and a FULL
 * one is on no list at all -- the state that makes the registry necessary
 * in the first place. */
SCR_KC_FN const char *scr_kc_chunk_state(const ScrCycChunk *c) {
  if (c->blk < (uint8_t)(sizeof scr_cyc_ar_cur / sizeof scr_cyc_ar_cur[0]) &&
      scr_cyc_ar_cur[c->blk] == c)
    return "cur";
  return c->avail ? "part" : "full";
}

SCR_KC_FN void scr_kc_cyc_walk_impl(FILE *out, int rows) {
  ScrCycChunk *c;
  unsigned long long nchunk = 0, nbad = 0;
  unsigned long long liveBlocks = 0, carvedBlocks = 0, freeBlocks = 0, capBlocks = 0;
  unsigned long long liveBytes = 0, carvedBytes = 0, freeBytes = 0, uncarvedBytes = 0;
  unsigned long long idealFree = 0, realFree = 0, idealPages = 0, realPages = 0;
  unsigned long long nCur = 0, nPart = 0, nFull = 0, wholeEmpty = 0;
  unsigned long long bucket[SCR_KC_NBUCKET];
  /* Per class: chunks, live blocks, capacity, ideal free pages. */
  unsigned long long clsChunk[33], clsLive[33], clsCap[33], clsPage[33];
  size_t i;

  for (i = 0; i < SCR_KC_NBUCKET; i++) bucket[i] = 0;
  for (i = 0; i < 33; i++) { clsChunk[i] = clsLive[i] = clsCap[i] = clsPage[i] = 0; }

  for (c = scr_cyc_ar_all; c != NULL; c = c->allnext) {
    unsigned char *base = (unsigned char *)(void *)c;
    unsigned char *carveBase = base + SCR_CYC_ARENA_GRAN;
    unsigned char *raw = (unsigned char *)c->raw;
    size_t stride = c->stride;
    size_t cap, carved, freeN = 0, live;
    unsigned long ideal = 0, real = 0, idealCand = 0, realCand = 0;
    unsigned long imask = 0, rmask = 0;
    void *b;
    size_t guard;
    int bad = 0;
    const char *state = scr_kc_chunk_state(c);

    nchunk++;
    if (stride == 0 || c->lim <= carveBase) {
      fprintf(out, "CHUNKCEN-CYCBAD %llu reason=geometry stride=%llu\n",
              nchunk, (unsigned long long)stride);
      nbad++;
      continue;
    }
    cap = (size_t)(c->lim - carveBase) / stride;
    carved = (size_t)(c->bump - carveBase) / stride;
    if (cap > SCR_KC_MAXSLOT || carved > cap) {
      fprintf(out, "CHUNKCEN-CYCBAD %llu reason=slots cap=%llu carved=%llu\n",
              nchunk, (unsigned long long)cap, (unsigned long long)carved);
      nbad++;
      continue;
    }

    for (i = 0; i < carved; i++) scr_kc_slotfree[i] = 0;
    /* Bounded: a cyclic list would otherwise spin here forever. */
    b = c->freelist;
    for (guard = 0; b != NULL && guard <= cap; guard++) {
      size_t off = (size_t)((unsigned char *)b - carveBase);
      size_t idx = off / stride;
      if (off % stride != 0 || idx >= carved || scr_kc_slotfree[idx]) { bad = 1; break; }
      scr_kc_slotfree[idx] = 1;
      freeN++;
      __builtin_memcpy(&b, b, sizeof(void *));
    }
    if (bad || (b != NULL && guard > cap)) {
      fprintf(out, "CHUNKCEN-CYCBAD %llu reason=LISTOVERRUN freeN=%llu cap=%llu\n",
              nchunk, (unsigned long long)freeN, (unsigned long long)cap);
      nbad++;
      continue;
    }
    live = carved - freeN;
    /* The identity. Three independent quantities; one of them is the
     * allocator's own counter and it is not consulted to compute the other
     * two. A mismatch is an instrument fault, not a workload property. */
    if (live != (size_t)c->used) {
      fprintf(out,
              "CHUNKCEN-CYCBAD %llu reason=USED-MISMATCH used=%llu "
              "carved=%llu freeN=%llu\n",
              nchunk, (unsigned long long)c->used,
              (unsigned long long)carved, (unsigned long long)freeN);
      nbad++;
      continue;
    }

    /* Page maps. `ideal` treats the chunk as 16 aligned pages from `base`,
     * which is what it would get from VirtualAlloc; `real` uses the actual
     * addresses, where a 16-byte-aligned 64 KiB malloc block straddles 17
     * pages and only those wholly inside it are candidates at all. Page 0
     * of the ideal map always carries the chunk header, so it can never be
     * free -- that is a structural cost of one page in sixteen. */
    {
      size_t chunkBytes = (size_t)(c->lim - base);
      size_t p;
      /* header zone pins its pages in both maps */
      for (p = 0; p * SCR_KC_PAGE < SCR_CYC_ARENA_GRAN; p++) imask |= 1ul << p;
      for (i = 0; i < carved; i++) {
        size_t lo, hi;
        if (scr_kc_slotfree[i]) continue;
        lo = SCR_CYC_ARENA_GRAN + i * stride;
        hi = lo + stride;
        for (p = lo / SCR_KC_PAGE; p * SCR_KC_PAGE < hi && p < SCR_KC_MAXPAGE; p++)
          imask |= 1ul << p;
      }
      for (p = 0; p < SCR_KC_MAXPAGE; p++) {
        if ((p + 1) * SCR_KC_PAGE > chunkBytes) break;
        idealCand++;
        if (!(imask & (1ul << p))) ideal++;
      }
      /* Real: absolute pages wholly inside [raw, raw + CHUNK). */
      {
        uintptr_t lo0 = ((uintptr_t)(void *)raw + SCR_KC_PAGE - 1) & ~(uintptr_t)(SCR_KC_PAGE - 1);
        uintptr_t hi0 = ((uintptr_t)(void *)raw + SCR_CYC_ARENA_CHUNK) & ~(uintptr_t)(SCR_KC_PAGE - 1);
        uintptr_t a;
        unsigned long pi = 0;
        for (a = lo0; a + SCR_KC_PAGE <= hi0 && pi < SCR_KC_MAXPAGE; a += SCR_KC_PAGE, pi++) {
          int pinned = 0;
          /* the chunk header */
          if (a < (uintptr_t)(void *)(base + SCR_CYC_ARENA_GRAN) &&
              a + SCR_KC_PAGE > (uintptr_t)(void *)base) pinned = 1;
          if (!pinned) {
            for (i = 0; i < carved; i++) {
              uintptr_t lo, hi;
              if (scr_kc_slotfree[i]) continue;
              lo = (uintptr_t)(void *)(carveBase + i * stride);
              hi = lo + stride;
              if (lo < a + SCR_KC_PAGE && hi > a) { pinned = 1; break; }
            }
          }
          realCand++;
          if (!pinned) { real++; rmask |= 1ul << pi; }
        }
      }
    }

    if (live == 0) wholeEmpty++;
    if (state[0] == 'c') nCur++; else if (state[0] == 'p') nPart++; else nFull++;
    liveBlocks += live;
    carvedBlocks += carved;
    freeBlocks += freeN;
    capBlocks += cap;
    liveBytes += (unsigned long long)live * stride;
    carvedBytes += (unsigned long long)carved * stride;
    freeBytes += (unsigned long long)freeN * stride;
    uncarvedBytes += (unsigned long long)(cap - carved) * stride;
    idealFree += ideal;
    realFree += real;
    idealPages += idealCand;
    realPages += realCand;
    bucket[scr_kc_bucket(live, cap)]++;
    if (c->blk < 33) {
      clsChunk[c->blk]++;
      clsLive[c->blk] += live;
      clsCap[c->blk] += cap;
      clsPage[c->blk] += ideal;
    }

    if (rows)
      fprintf(out,
              "CHUNKCEN-CYCCHUNK %llu blk=%u stride=%llu state=%s used=%llu "
              "carved=%llu cap=%llu freeN=%llu idealFreePg=%lu realFreePg=%lu "
              "base=%p raw=%p\n",
              nchunk, (unsigned)c->blk, (unsigned long long)stride, state,
              (unsigned long long)live, (unsigned long long)carved,
              (unsigned long long)cap, (unsigned long long)freeN, ideal, real,
              (void *)base, (void *)raw);
  }

  /* THE REGISTRY CROSS-CHECK. scr_cyc_ar_held is maintained by the arena
   * for its budget test, on paths this census does not touch. If the two
   * disagree the registry has missed a chunk or kept a released one, and
   * every total above is wrong by that much -- so the disagreement is
   * printed instead of a total that looks fine. */
  {
    unsigned long long heldByReg = nchunk * (unsigned long long)SCR_CYC_ARENA_CHUNK;
    unsigned long long heldByArena = (unsigned long long)scr_cyc_ar_held;
    fprintf(out,
            "CHUNKCEN-CYC chunks=%llu bad=%llu heldBytes=%llu arenaHeld=%llu "
            "regcheck=%s cur=%llu part=%llu full=%llu emptyHeld=%llu\n",
            nchunk, nbad, heldByReg, heldByArena,
            heldByReg == heldByArena ? "OK" : "MISMATCH",
            nCur, nPart, nFull, wholeEmpty);
  }
  if (nchunk == 0) {
    /* Named, not a row of zeros: "no chunks" and "the walk never ran" must
     * not read the same. The ABSENT case is caught in scr_kc_snapshot. */
    fprintf(out, "CHUNKCEN-CYC NO-CHUNKS\n");
    return;
  }
  fprintf(out,
          "CHUNKCEN-CYCBYTES liveBlocks=%llu liveBytes=%llu carvedBlocks=%llu "
          "carvedBytes=%llu freelistBlocks=%llu freelistBytes=%llu "
          "uncarvedBytes=%llu capBlocks=%llu\n",
          liveBlocks, liveBytes, carvedBlocks, carvedBytes, freeBlocks,
          freeBytes, uncarvedBytes, capBlocks);
  fprintf(out,
          "CHUNKCEN-CYCPAGE idealFreePg=%llu idealFreeBytes=%llu "
          "idealCandPg=%llu realFreePg=%llu realFreeBytes=%llu realCandPg=%llu\n",
          idealFree, idealFree * (unsigned long long)SCR_KC_PAGE, idealPages,
          realFree, realFree * (unsigned long long)SCR_KC_PAGE, realPages);
  for (i = 0; i < SCR_KC_NBUCKET; i++)
    if (bucket[i])
      fprintf(out, "CHUNKCEN-CYCOCC %s %llu\n", scr_kc_bucket_name[i], bucket[i]);
  for (i = 0; i < 33; i++)
    if (clsChunk[i])
      fprintf(out,
              "CHUNKCEN-CYCCLASS blk=%llu stride=%llu chunks=%llu live=%llu "
              "cap=%llu idealFreePg=%llu\n",
              (unsigned long long)i, (unsigned long long)(i * 8u), clsChunk[i],
              clsLive[i], clsCap[i], clsPage[i]);
}

/* Registered rather than called by name so scr_chunk_census.h -- which
 * cannot see this file -- can report ABSENT when scr_cycle.c was built
 * without the hooks. That is the u16census failure mode: an instrument
 * that is IN the binary is not an instrument that is ARMED. */
SCR_KC_SHARED int scr_kc_cyc_reg_ran = 0;
__attribute__((constructor)) SCR_KC_FN void scr_kc_cyc_register(void) {
  if (scr_kc_cyc_reg_ran) return;
  scr_kc_cyc_reg_ran = 1;
  scr_kc_cyc_walk = scr_kc_cyc_walk_impl;
}

#endif /* SCR_CHUNK_CENSUS_WALK_H */
