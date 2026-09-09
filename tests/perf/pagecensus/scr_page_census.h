/* scr_page_census.h — how much of the cycle arena's retained chunk bytes is
 * WHOLE FREE PAGES, and how those pages are distributed across chunks.
 *
 * THE QUESTION. scr_cycle.c hands a 64 KiB chunk back to the allocator only
 * when its live count reaches zero, so one survivor keeps all 64 KiB. On a
 * zapo history sync that leaves ~160 chunks at exit (tests/perf/cycstat's
 * `held`), and at most 33 of them are the per-class cache: the rest hold at
 * least one live block. A chunk is 16 pages, and a survivor occupies only
 * the page it sits on. This header measures the difference — the whole
 * pages, inside chunks the arena still holds, that contain no live block —
 * because that sum is the CEILING on anything a per-page reclaimer could
 * return, and it is arithmetic over bookkeeping the allocator already has.
 *
 * IT IS A CEILING AND NOT A FORECAST. It says what is free, not what is
 * returnable: see the "TWO MODELS" note below, and note that a chunk's
 * own 256-byte header sits on its first page, which can therefore never be
 * given back whatever the free list says.
 *
 * -------------------------------------------------------------------------
 * TWO MODELS, and the gap between them is the cost of malloc placement.
 *
 *   ALIGNED   the chunk as a page-aligned 64 KiB span: 16 pages, page 0
 *             carrying the chunk header, pages 1..15 pure carve. This is the
 *             geometry a VirtualAlloc'd chunk has for free (Windows reserves
 *             on a 64 KiB granularity), and it is the ceiling for a
 *             MEM_DECOMMIT implementation.
 *   ACTUAL    the chunk where malloc actually put it. The carve region is
 *             [base+256, raw+65536) at whatever alignment the CRT chose, so
 *             the first and last partial pages can never be whole-free. The
 *             ALIGNED-minus-ACTUAL gap is what moving chunks off malloc buys
 *             before a single page is decommitted.
 *
 * ACTUAL IS INFORMATIONAL ONLY. Pages inside a malloc'd block belong to the
 * CRT heap's segment; decommitting them under the heap manager is not sound.
 * A real implementation has to own the reservation. ACTUAL is here to say
 * how much of the ALIGNED number is alignment and how much is occupancy.
 *
 * -------------------------------------------------------------------------
 * ARMING. Force-included through SCRIPTC_PROF_CFLAGS with -DSCR_PAGECEN_ON,
 * exactly as tests/perf/cycstat/scr_cyc_stat.h is, so an ordinary build
 * carries no trace of it. It follows the linkage rules scr_prof.h
 * established for this target — shared DATA is selectany with an explicit
 * initialiser, every FUNCTION is static — because it is included into every
 * translation unit and only scr_cycle.c calls it.
 *
 *   SCR_PAGECEN_OUT     file for the report; absent, stderr.
 *   SCR_PAGECEN_EVERY   1 = also report after every collector pass, so the
 *                       trajectory is visible and the exit reading is not the
 *                       only one. Absent, the report is written at exit only.
 *
 * -------------------------------------------------------------------------
 * IT REFUSES TO REPORT A SILENT ZERO, for the same reason cycstat does.
 *
 *   ARMED is printed unconditionally, so "the hooks were never compiled" and
 *   "the arena held nothing" cannot read alike.
 *
 *   NO CHUNKS is printed by name when the walk saw none, rather than a row
 *   of zeroes that reads like a measurement.
 *
 *   THE WALK SELF-TESTS. For every chunk the census recomputes the live
 *   count from geometry the allocator did not hand it — carved slots minus
 *   free-list length — and compares it with the chunk's own `used`. A
 *   mismatch means the walk is wrong (a stride the census misread, a free
 *   list it followed off the grid), and it is printed as SELFTEST FAILED
 *   with a count, because every number below is derived from that same
 *   bitmap. A census that cannot detect its own miscount cannot be trusted
 *   when it reports a large one.
 *
 *   THE POSITIVE AND NULL CONTROLS are in tests/harness/cycle-arena.test.ts
 *   and are exact, not approximate:
 *     null      SCR_CYCLE_ARENA=0 — no chunk is ever taken, so the report
 *               must say NO CHUNKS. An instrument that prints "0 free pages"
 *               there has not measured a full arena.
 *     positive  a fixture that frees everything it allocated leaves only the
 *               per-class current chunks, each with NO live block at all —
 *               so each must report exactly SCR_PC_PPC-1 free pages (15 of
 *               16; page 0 carries the header). That number is arithmetic,
 *               not whatever the instrument printed the first time.
 *     graded    the same fixture holding N objects reports strictly fewer
 *               free pages than the same fixture holding none, on the same
 *               binary.
 */
#ifndef SCR_PAGE_CENSUS_H
#define SCR_PAGE_CENSUS_H

#ifdef SCR_PAGECEN_ON

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define SCR_PC_SHARED __attribute__((selectany))
#define SCR_PC_FN static __attribute__((unused))

/* 4096 on every x86_64 Windows and Linux target this compiler emits for.
 * Overridable so a large-page or 16 KiB target can be measured without
 * editing this file, and PRINTED in the report so a reading always names
 * the page size it was taken at. */
#ifndef SCR_PC_PAGE
#define SCR_PC_PAGE 4096u
#endif
/* Must agree with SCR_CYC_ARENA_CHUNK. scr_cycle.c static-asserts that. */
#ifndef SCR_PC_CHUNK
#define SCR_PC_CHUNK 65536u
#endif
#define SCR_PC_PPC ((unsigned)(SCR_PC_CHUNK / SCR_PC_PAGE))
/* A carve stride is 16-byte aligned and never smaller than 16, so this
 * bounds the slot count in any chunk. */
#define SCR_PC_MAXSLOTS ((unsigned)(SCR_PC_CHUNK / 16u))

/* The three states a chunk can be in, which is the whole of the arena's
 * reachability: CUR is its class's cached chunk, PART is on the class's
 * partial list, FULL is on neither because it has no free block and no room
 * to carve. FULL is counted so the report can SHOW that a full chunk
 * contributes no free page, rather than the reader having to trust the
 * invariant. */
#define SCR_PC_CUR 0
#define SCR_PC_PART 1
#define SCR_PC_FULL 2

SCR_PC_SHARED unsigned long long scr_pc_chunks = 0;
SCR_PC_SHARED unsigned long long scr_pc_role[3] = {0, 0, 0};
SCR_PC_SHARED unsigned long long scr_pc_slots = 0;      /* carved slots */
SCR_PC_SHARED unsigned long long scr_pc_free_slots = 0; /* on a free list */
SCR_PC_SHARED unsigned long long scr_pc_live_slots = 0;
SCR_PC_SHARED unsigned long long scr_pc_live_bytes = 0;
SCR_PC_SHARED unsigned long long scr_pc_pages_aligned = 0;
SCR_PC_SHARED unsigned long long scr_pc_pages_actual = 0;
SCR_PC_SHARED unsigned long long scr_pc_empty_chunks = 0; /* no live block */
/* Free pages contributed by chunks with NO live block at all. It exists to
 * be checked, not read: such a chunk must contribute exactly SCR_PC_PPC-1
 * (every page but the header's), so this number is arithmetic on the one
 * beside it and the report says so on EVERY reading, including the real
 * ones. A census whose page math is wrong fails here on the workload it is
 * actually measuring, not only in a fixture. */
SCR_PC_SHARED unsigned long long scr_pc_pages_nolive = 0;
SCR_PC_SHARED unsigned long long scr_pc_hist[SCR_PC_PPC + 1] = {0};
/* Per-role free-page totals, so "the cache is free and the rest is not" is a
 * number rather than an inference. */
SCR_PC_SHARED unsigned long long scr_pc_pages_role[3] = {0, 0, 0};
SCR_PC_SHARED unsigned long long scr_pc_bad_used = 0;  /* selftest mismatch */
SCR_PC_SHARED unsigned long long scr_pc_bad_slot = 0;  /* free entry off grid */
SCR_PC_SHARED unsigned long long scr_pc_bad_loop = 0;  /* free list too long */
SCR_PC_SHARED int scr_pc_registered = 0;
SCR_PC_SHARED int scr_pc_every = -1;
SCR_PC_SHARED FILE *scr_pc_file = NULL;

SCR_PC_FN void scr_pc_reset(void) {
  unsigned i;
  scr_pc_chunks = 0;
  scr_pc_slots = 0;
  scr_pc_free_slots = 0;
  scr_pc_live_slots = 0;
  scr_pc_live_bytes = 0;
  scr_pc_pages_aligned = 0;
  scr_pc_pages_actual = 0;
  scr_pc_empty_chunks = 0;
  scr_pc_pages_nolive = 0;
  scr_pc_bad_used = 0;
  scr_pc_bad_slot = 0;
  scr_pc_bad_loop = 0;
  for (i = 0; i < 3; i++) {
    scr_pc_role[i] = 0;
    scr_pc_pages_role[i] = 0;
  }
  for (i = 0; i <= SCR_PC_PPC; i++) scr_pc_hist[i] = 0;
}

/* One chunk. Everything is passed in rather than reached through a struct
 * definition this header cannot see; the free list is a plain singly-linked
 * list through the first word of each free block, which is generic. */
SCR_PC_FN void scr_pc_note_chunk(const void *basev, const void *rawv,
                                 const void *limv, unsigned long hdrzone,
                                 unsigned long stride, const void *bumpv,
                                 unsigned long used, const void *freelistv,
                                 int role) {
  static unsigned char live[SCR_PC_MAXSLOTS];
  unsigned char upage[SCR_PC_PPC + 2];
  const unsigned char *base = (const unsigned char *)basev;
  const unsigned char *raw = (const unsigned char *)rawv;
  const unsigned char *lim = (const unsigned char *)limv;
  const unsigned char *bump = (const unsigned char *)bumpv;
  const unsigned char *cs = base + hdrzone;
  const void *b;
  unsigned long nslots, i, flen = 0, nlive, off, p, p0, p1;
  unsigned long freepg = 0;

  (void)raw;
  if (role < 0 || role > 2) role = SCR_PC_FULL;
  scr_pc_chunks++;
  scr_pc_role[role]++;
  if (stride == 0 || bump < cs) {
    /* A chunk whose geometry the census cannot read at all. Counted as a
     * selftest failure rather than skipped: a skipped chunk would quietly
     * shrink every total below. */
    scr_pc_bad_used++;
    return;
  }
  nslots = (unsigned long)(bump - cs) / stride;
  if (nslots > SCR_PC_MAXSLOTS) {
    scr_pc_bad_used++;
    return;
  }
  memset(live, 1, (size_t)nslots);

  /* The free list. Bounded by nslots + 1 so a corrupted or cyclic list is a
   * reported failure and not a hang. */
  for (b = freelistv; b != NULL; ) {
    const unsigned char *bp = (const unsigned char *)b;
    if (flen > nslots) {
      scr_pc_bad_loop++;
      break;
    }
    flen++;
    if (bp < cs || bp >= bump || ((unsigned long)(bp - cs) % stride) != 0) {
      scr_pc_bad_slot++;
    } else {
      live[(unsigned long)(bp - cs) / stride] = 0;
    }
    memcpy(&b, bp, sizeof(void *));
  }
  nlive = nslots >= flen ? nslots - flen : 0;

  /* THE SELF-TEST: the census recomputed the live count from geometry; the
   * chunk carries its own. They must agree. */
  if (nlive != used) scr_pc_bad_used++;

  scr_pc_slots += nslots;
  scr_pc_free_slots += flen;
  scr_pc_live_slots += nlive;
  scr_pc_live_bytes += (unsigned long long)nlive * stride;
  if (nlive == 0) scr_pc_empty_chunks++;

  /* ---- ALIGNED model: the chunk as 16 pages from `base`. Page 0 carries
   * the header zone and is never returnable, so it is excluded by
   * construction rather than by a live block happening to sit on it. */
  memset(upage, 0, sizeof upage);
  upage[0] = 1;
  for (i = 0; i < nslots; i++) {
    if (!live[i]) continue;
    off = hdrzone + i * stride;
    p0 = off / SCR_PC_PAGE;
    p1 = (off + stride - 1u) / SCR_PC_PAGE;
    if (p1 >= SCR_PC_PPC) p1 = SCR_PC_PPC - 1u;
    for (p = p0; p <= p1; p++) upage[p] = 1;
  }
  for (p = 0; p < SCR_PC_PPC; p++) {
    if (!upage[p]) freepg++;
  }
  scr_pc_pages_aligned += freepg;
  scr_pc_pages_role[role] += freepg;
  if (nlive == 0) scr_pc_pages_nolive += freepg;
  scr_pc_hist[freepg]++;

  /* ---- ACTUAL model: whole pages entirely inside [cs, lim) at the address
   * malloc actually chose. */
  {
    uintptr_t a = (uintptr_t)(const void *)cs;
    uintptr_t z = (uintptr_t)(const void *)lim;
    uintptr_t first = (a + (SCR_PC_PAGE - 1u)) & ~(uintptr_t)(SCR_PC_PAGE - 1u);
    uintptr_t last = z & ~(uintptr_t)(SCR_PC_PAGE - 1u);
    unsigned long npg = last > first ? (unsigned long)((last - first) / SCR_PC_PAGE) : 0;
    if (npg > SCR_PC_PPC + 1u) npg = SCR_PC_PPC + 1u;
    memset(upage, 0, sizeof upage);
    for (i = 0; i < nslots && npg > 0; i++) {
      uintptr_t sa, sz2;
      if (!live[i]) continue;
      sa = (uintptr_t)(const void *)(cs + i * stride);
      sz2 = sa + stride;
      if (sz2 <= first || sa >= last) continue;
      p0 = sa <= first ? 0ul : (unsigned long)((sa - first) / SCR_PC_PAGE);
      p1 = (unsigned long)(((sz2 - 1u) - first) / SCR_PC_PAGE);
      if (p1 >= npg) p1 = npg - 1u;
      for (p = p0; p <= p1; p++) upage[p] = 1;
    }
    for (p = 0; p < npg; p++) {
      if (!upage[p]) scr_pc_pages_actual++;
    }
  }
}

/* ── THE SYNTHETIC ARM ────────────────────────────────────────────────────
 * Three fabricated chunks with known occupancy, pushed through the SAME
 * scr_pc_note_chunk every real reading goes through, with expected free-page
 * counts that are arithmetic rather than whatever the instrument printed
 * first:
 *
 *   allfree   every slot on the free list -> 0 live -> 15 free pages
 *             (pages 1..15; page 0 carries the chunk header).
 *   onelive   every slot but one on the free list, the survivor placed on
 *             page 3 -> 14 free pages.
 *   allive    an empty free list, 1020 live slots spanning all 16 pages
 *             -> 0 free pages.
 *
 * `allive` is the one that matters most: an instrument that can only say
 * "yes, there are free pages" is the failure mode this project has hit five
 * times in one day. A census that reports 15 for a chunk with 1020 live
 * blocks is not measuring occupancy at all, and the arm says so by name.
 *
 * It runs once, at arm time, before any real chunk exists, and its results
 * are held in these variables because the report file is opened (and
 * truncated) later. */
#define SCR_PC_SYNTH_GRAN 256u
#define SCR_PC_SYNTH_STRIDE 64u
SCR_PC_SHARED unsigned scr_pc_synth_want[3] = {0, 0, 0};
SCR_PC_SHARED unsigned scr_pc_synth_got[3] = {0, 0, 0};
SCR_PC_SHARED int scr_pc_synth_ran = 0;

SCR_PC_FN void scr_pc_synth_case(int idx, long keep, unsigned want) {
  static unsigned char buf[2u * SCR_PC_CHUNK];
  unsigned char *base = (unsigned char *)(void *)(((uintptr_t)(void *)buf +
                                                   (SCR_PC_CHUNK - 1u)) &
                                                  ~(uintptr_t)(SCR_PC_CHUNK - 1u));
  unsigned char *cs = base + SCR_PC_SYNTH_GRAN;
  unsigned long nslots = (SCR_PC_CHUNK - SCR_PC_SYNTH_GRAN) / SCR_PC_SYNTH_STRIDE;
  unsigned char *bump = cs + nslots * SCR_PC_SYNTH_STRIDE;
  void *head = NULL;
  unsigned long i, flen = 0;
  /* keep < 0 means "no slot is live" and keep >= nslots means "every slot
   * is live"; otherwise exactly slot `keep` stays off the free list. */
  for (i = 0; i < nslots; i++) {
    unsigned char *b;
    if (keep >= (long)nslots) break;
    if ((long)i == keep) continue;
    b = cs + i * SCR_PC_SYNTH_STRIDE;
    memcpy(b, &head, sizeof(void *));
    head = (void *)b;
    flen++;
  }
  scr_pc_reset();
  scr_pc_note_chunk(base, base, base + SCR_PC_CHUNK, SCR_PC_SYNTH_GRAN,
                    SCR_PC_SYNTH_STRIDE, bump, (unsigned long)(nslots - flen),
                    head, SCR_PC_CUR);
  scr_pc_synth_want[idx] = want;
  scr_pc_synth_got[idx] = (unsigned)scr_pc_pages_aligned;
  /* A synthetic chunk that fails the walk's own selftest would make the
   * page number meaningless, so fold that into the arm's verdict. */
  if (scr_pc_bad_used != 0 || scr_pc_bad_slot != 0 || scr_pc_bad_loop != 0) {
    scr_pc_synth_got[idx] = 0xffffu;
  }
  scr_pc_reset();
}

SCR_PC_FN void scr_pc_synth(void) {
  unsigned long nslots = (SCR_PC_CHUNK - SCR_PC_SYNTH_GRAN) / SCR_PC_SYNTH_STRIDE;
  /* The survivor's slot for the `onelive` case: the first slot whose offset
   * from the chunk base lands on page 3, spelled as arithmetic so the
   * expected 14 is derived and not asserted. */
  long k = (long)((3u * SCR_PC_PAGE - SCR_PC_SYNTH_GRAN) / SCR_PC_SYNTH_STRIDE);
  scr_pc_synth_case(0, -1, SCR_PC_PPC - 1u);
  scr_pc_synth_case(1, k, SCR_PC_PPC - 2u);
  scr_pc_synth_case(2, (long)nslots, 0u);
  scr_pc_synth_ran = 1;
}

SCR_PC_FN FILE *scr_pc_out(void) {
  if (scr_pc_file == NULL) {
    const char *out = getenv("SCR_PAGECEN_OUT");
    scr_pc_file = stderr;
    if (out != NULL && *out != '\0') {
      FILE *g = fopen(out, "w");
      if (g != NULL) scr_pc_file = g;
    }
  }
  return scr_pc_file;
}

SCR_PC_FN void scr_pc_report(const char *when) {
  FILE *f = scr_pc_out();
  double heldmib = (double)scr_pc_chunks * (double)SCR_PC_CHUNK / (1024.0 * 1024.0);
  double freemib = (double)scr_pc_pages_aligned * (double)SCR_PC_PAGE / (1024.0 * 1024.0);
  double actmib = (double)scr_pc_pages_actual * (double)SCR_PC_PAGE / (1024.0 * 1024.0);
  unsigned p;
  fprintf(f, "[pagecen] ARMED tests/perf/pagecensus/scr_page_census.h at=%s"
             " page=%u chunk=%u pages/chunk=%u\n",
          when, (unsigned)SCR_PC_PAGE, (unsigned)SCR_PC_CHUNK, SCR_PC_PPC);
  if (!scr_pc_synth_ran) {
    fprintf(f, "[pagecen] SYNTH NOT RUN - the page arithmetic was never"
               " exercised against a known answer in this process. Every"
               " number below is unvalidated.\n");
  } else {
    static const char *const nm[3] = {"allfree", "onelive", "alllive"};
    int i, bad = 0;
    for (i = 0; i < 3; i++) {
      if (scr_pc_synth_got[i] != scr_pc_synth_want[i]) bad = 1;
    }
    fprintf(f, "[pagecen] SYNTH %s", bad ? "FAILED" : "ok");
    for (i = 0; i < 3; i++) {
      fprintf(f, " %s want=%u got=%u", nm[i], scr_pc_synth_want[i],
              scr_pc_synth_got[i]);
    }
    fprintf(f, "\n");
    if (bad) {
      fprintf(f, "[pagecen] the page arithmetic is wrong on a chunk whose"
                 " answer is known, so nothing below is a measurement.\n");
    }
  }
  if (scr_pc_chunks == 0) {
    fprintf(f, "[pagecen] NO CHUNKS - the cycle arena held nothing at this"
               " point. Either SCR_CYCLE_ARENA=0, or no allocation reached the"
               " arena, or every chunk was given back. Not a measurement of"
               " free pages.\n");
    fflush(f);
    return;
  }
  if (scr_pc_bad_used != 0 || scr_pc_bad_slot != 0 || scr_pc_bad_loop != 0) {
    fprintf(f, "[pagecen] SELFTEST FAILED usedmismatch=%llu offgrid=%llu"
               " runawaylist=%llu - the walk disagrees with the arena's own"
               " bookkeeping, so every number below is derived from a bitmap"
               " known to be wrong. Fix the walk before reading it.\n",
            scr_pc_bad_used, scr_pc_bad_slot, scr_pc_bad_loop);
  } else {
    fprintf(f, "[pagecen] SELFTEST ok on %llu/%llu chunks"
               " (carved-freelist == used)\n",
            scr_pc_chunks, scr_pc_chunks);
  }
  fprintf(f, "[pagecen] chunks=%llu cur=%llu part=%llu full=%llu"
             " nolive=%llu held=%.2f MiB\n",
          scr_pc_chunks, scr_pc_role[SCR_PC_CUR], scr_pc_role[SCR_PC_PART],
          scr_pc_role[SCR_PC_FULL], scr_pc_empty_chunks, heldmib);
  fprintf(f, "[pagecen] slots carved=%llu free=%llu live=%llu livebytes=%llu"
             " occupancy=%.4f\n",
          scr_pc_slots, scr_pc_free_slots, scr_pc_live_slots,
          scr_pc_live_bytes,
          heldmib > 0.0 ? (double)scr_pc_live_bytes /
                              ((double)scr_pc_chunks * (double)SCR_PC_CHUNK)
                        : 0.0);
  fprintf(f, "[pagecen] CEILING aligned freepages=%llu = %.2f MiB of %.2f MiB"
             " held (%.1f%%)\n",
          scr_pc_pages_aligned, freemib, heldmib,
          heldmib > 0.0 ? 100.0 * freemib / heldmib : 0.0);
  fprintf(f, "[pagecen] actual (malloc-placed) freepages=%llu = %.2f MiB"
             " (alignment cost %.2f MiB)\n",
          scr_pc_pages_actual, actmib, freemib - actmib);
  /* The arithmetic check that rides on every real reading: a chunk with no
   * live block must contribute every page but its header's. */
  if (scr_pc_pages_nolive !=
      scr_pc_empty_chunks * (unsigned long long)(SCR_PC_PPC - 1u)) {
    fprintf(f, "[pagecen] NOLIVE CHECK FAILED %llu pages from %llu chunks with"
               " no live block; %llu expected. The page math disagrees with"
               " itself on this very reading.\n",
            scr_pc_pages_nolive, scr_pc_empty_chunks,
            scr_pc_empty_chunks * (unsigned long long)(SCR_PC_PPC - 1u));
  } else {
    fprintf(f, "[pagecen] NOLIVE CHECK ok %llu pages from %llu empty chunks"
               " (%u each)\n",
            scr_pc_pages_nolive, scr_pc_empty_chunks, SCR_PC_PPC - 1u);
  }
  fprintf(f, "[pagecen] freepages by role cur=%llu part=%llu full=%llu\n",
          scr_pc_pages_role[SCR_PC_CUR], scr_pc_pages_role[SCR_PC_PART],
          scr_pc_pages_role[SCR_PC_FULL]);
  if (scr_pc_role[SCR_PC_FULL] != 0 && scr_pc_pages_role[SCR_PC_FULL] != 0) {
    fprintf(f, "[pagecen] NOTE a FULL chunk reported free pages, which the"
               " arena's own invariant says cannot happen (a chunk with a free"
               " block is relinked). Read the walk, not the arena.\n");
  }
  fprintf(f, "[pagecen] histogram freepages/chunk:");
  for (p = 0; p <= SCR_PC_PPC; p++) {
    if (scr_pc_hist[p] != 0) fprintf(f, " %u:%llu", p, scr_pc_hist[p]);
  }
  fprintf(f, "\n");
  /* THE TRADE CURVE, printed rather than left to the reader: a policy that
   * only decommits chunks with at least T free pages touches this many
   * chunks and recovers this much. T=1 is "decommit everything free". */
  fprintf(f, "[pagecen] policy threshold: T chunks pages MiB\n");
  for (p = 1; p <= SCR_PC_PPC; p++) {
    unsigned long long ch = 0, pg = 0;
    unsigned q;
    for (q = p; q <= SCR_PC_PPC; q++) {
      ch += scr_pc_hist[q];
      pg += (unsigned long long)q * scr_pc_hist[q];
    }
    if (ch == 0) continue;
    fprintf(f, "[pagecen]   T=%u %llu %llu %.2f\n", p, ch, pg,
            (double)pg * (double)SCR_PC_PAGE / (1024.0 * 1024.0));
  }
  fflush(f);
}

SCR_PC_FN int scr_pc_every_on(void) {
  if (scr_pc_every < 0) {
    const char *e = getenv("SCR_PAGECEN_EVERY");
    scr_pc_every = (e != NULL && *e != '\0' && strtol(e, NULL, 10) != 0) ? 1 : 0;
  }
  return scr_pc_every;
}

#endif /* SCR_PAGECEN_ON */
#endif /* SCR_PAGE_CENSUS_H */
