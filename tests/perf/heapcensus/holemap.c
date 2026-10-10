/* holemap.c - what size HOLE does a request of R bytes leave behind?
 *
 * WHY. tests/perf/settled-census/evidence-llvm182/main reports 15,766 free
 * blocks of exactly 1,344 B -- 57.3% of all committed-but-free bytes in
 * that run -- and the allocation-side exact table has NO 1,344 bucket.
 * tests/perf/placement/SEGREGATION.md registered that as refutable and
 * named two live hypotheses: the holes are COALESCED from smaller adjacent
 * free blocks, or the heap reports a BLOCK size that differs from the
 * request.
 *
 * Both are statements about a FUNCTION -- request size -> reported free
 * cbData -- that nobody had measured on this CRT and this heap. This file
 * measures it directly.
 *
 * THE KEY ASYMMETRY, and the whole reason the two tables cannot be
 * compared row for row: HeapWalk reports cbData for a BUSY block as the
 * size the caller ASKED FOR (the NT heap stores the user size), and for a
 * FREE block as the size of the block's data extent, because once it is
 * free there is no request left to report. scr_heap_census.h keys HCFREE
 * on cbData with a comment saying it is done so the table "has to be
 * comparable with a REQUEST an allocation site made". That comment is the
 * assumption under test here.
 *
 *   iso    2N blocks of R, every other one freed. Live neighbours on both
 *          sides, so no hole can coalesce with another. This is the
 *          POSITIVE CONTROL: it plants a known population of exactly N
 *          holes, all from a known request size, and the free table must
 *          show them. A run that cannot see its own plant cannot be
 *          believed when it reports someone else's.
 *   bulk   all 2N freed. Holes are adjacent, so they MUST coalesce; this
 *          is the negative direction -- it shows what coalescence actually
 *          looks like in this table, which is what P2 predicts for 1,344.
 *   trip   groups of 4: free 3, keep 1. A known 3-way coalescence.
 *
 * BUILD
 *   zig cc -O2 -target x86_64-windows-gnu tests/perf/heapcensus/holemap.c \
 *     -o <out>/holemap.exe
 * RUN
 *   holemap.exe <reqSize> <N> <iso|bulk|trip>
 */
#include <malloc.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* PROCESS_HEAP_ENTRY, spelled out -- same shape and the same static
 * assertions as scr_heap_census.h, so the two instruments cannot disagree
 * about where cbData lives. */
typedef struct HmEntry {
  void *lpData;
  unsigned long cbData;
  unsigned char cbOverhead;
  unsigned char iRegionIndex;
  unsigned short wFlags;
  union {
    struct { void *hMem; unsigned long dwReserved[3]; } Block;
    struct {
      unsigned long dwCommittedSize;
      unsigned long dwUnCommittedSize;
      void *lpFirstBlock;
      void *lpLastBlock;
    } Region;
  } u;
} HmEntry;
_Static_assert(offsetof(HmEntry, cbData) == 8, "cbData");
_Static_assert(offsetof(HmEntry, wFlags) == 14, "wFlags");
_Static_assert(sizeof(HmEntry) == 40, "PROCESS_HEAP_ENTRY is 40 bytes on x64");

#define HM_REGION 0x0001u
#define HM_UNCOMMITTED 0x0002u
#define HM_BUSY 0x0004u

int __stdcall hm_HeapWalk(void *, HmEntry *) __asm__("HeapWalk");
int __stdcall hm_HeapLock(void *) __asm__("HeapLock");
int __stdcall hm_HeapUnlock(void *) __asm__("HeapUnlock");

#define HM_SLOTS 16384u
typedef struct { size_t size; size_t n; size_t bytes; size_t ovmin; size_t ovmax; } HmRow;

static HmRow hm_free[HM_SLOTS];
static HmRow hm_busy[HM_SLOTS];
static size_t hm_lost;

static size_t hm_hash(size_t size) {
  unsigned long long x = (unsigned long long)size;
  x ^= x >> 33; x *= 0xff51afd7ed558ccdULL;
  x ^= x >> 29; x *= 0xc4ceb9fe1a85ec53ULL;
  x ^= x >> 32;
  return (size_t)(x & (HM_SLOTS - 1u));
}
static void hm_note(HmRow *t, size_t size, size_t ov) {
  size_t h = hm_hash(size);
  for (unsigned i = 0; i < HM_SLOTS; i++) {
    size_t j = (h + i) & (HM_SLOTS - 1u);
    if (t[j].n != 0 && t[j].size != size) continue;
    if (t[j].n == 0) { t[j].size = size; t[j].ovmin = ov; t[j].ovmax = ov; }
    if (ov < t[j].ovmin) t[j].ovmin = ov;
    if (ov > t[j].ovmax) t[j].ovmax = ov;
    t[j].n++; t[j].bytes += size + ov;
    return;
  }
  hm_lost++;
}

static size_t g_free_bytes, g_free_blocks, g_busy_bytes, g_busy_blocks;

static void hm_walk(void) {
  memset(hm_free, 0, sizeof hm_free);
  memset(hm_busy, 0, sizeof hm_busy);
  g_free_bytes = g_free_blocks = g_busy_bytes = g_busy_blocks = 0;
  void *crt = (void *)(intptr_t)_get_heap_handle();
  HmEntry e;
  memset(&e, 0, sizeof e);
  hm_HeapLock(crt);
  while (hm_HeapWalk(crt, &e)) {
    if (e.wFlags & HM_BUSY) {
      g_busy_blocks++; g_busy_bytes += (size_t)e.cbData + e.cbOverhead;
      hm_note(hm_busy, (size_t)e.cbData, (size_t)e.cbOverhead);
    } else if (e.wFlags & (HM_UNCOMMITTED | HM_REGION)) {
      /* not a hole */
    } else {
      g_free_blocks++; g_free_bytes += (size_t)e.cbData + e.cbOverhead;
      hm_note(hm_free, (size_t)e.cbData, (size_t)e.cbOverhead);
    }
  }
  hm_HeapUnlock(crt);
}

static void hm_top(const char *tag, HmRow *t, size_t minN) {
  for (size_t i = 0; i < HM_SLOTS; i++)
    if (t[i].n >= minN)
      printf("%s size=%zu n=%zu bytes=%zu ov=%zu..%zu\n", tag, t[i].size,
             t[i].n, t[i].bytes, t[i].ovmin, t[i].ovmax);
}
static size_t hm_get(HmRow *t, size_t size) {
  size_t h = hm_hash(size);
  for (unsigned i = 0; i < HM_SLOTS; i++) {
    size_t j = (h + i) & (HM_SLOTS - 1u);
    if (t[j].n == 0) return 0;
    if (t[j].size == size) return t[j].n;
  }
  return 0;
}

int main(int argc, char **argv) {
  size_t R = argc > 1 ? (size_t)strtoull(argv[1], NULL, 10) : 1328;
  size_t N = argc > 2 ? (size_t)strtoull(argv[2], NULL, 10) : 20000;
  const char *mode = argc > 3 ? argv[3] : "iso";

  size_t total = N * 2;
  void **p = (void **)malloc(total * sizeof(void *));
  if (p == NULL) return 2;

  /* baseline, so the plant is a DELTA and not a reading of the CRT's own
   * startup residue. */
  hm_walk();
  size_t base_free_at_R = 0;
  size_t base_rows[64];
  size_t base_counts[64];
  size_t nbase = 0;
  for (size_t i = 0; i < HM_SLOTS && nbase < 64; i++)
    if (hm_free[i].n) { base_rows[nbase] = hm_free[i].size; base_counts[nbase] = hm_free[i].n; nbase++; }
  (void)base_free_at_R;
  printf("BASE freeBlocks=%zu freeBytes=%zu busyBlocks=%zu busyBytes=%zu\n",
         g_free_blocks, g_free_bytes, g_busy_blocks, g_busy_bytes);

  for (size_t i = 0; i < total; i++) {
    p[i] = malloc(R);
    if (p[i] == NULL) return 3;
    memset(p[i], 0x5a, 16);
  }

  hm_walk();
  size_t liveN = hm_get(hm_busy, R);
  printf("PLANTED req=%zu n=%zu liveAtR=%zu\n", R, total, liveN);
  hm_top("BUSYROW", hm_busy, total / 2);

  size_t freed = 0;
  if (strcmp(mode, "bulk") == 0) {
    for (size_t i = 0; i < total; i++) { free(p[i]); freed++; }
  } else if (strcmp(mode, "trip") == 0) {
    for (size_t i = 0; i < total; i++)
      if ((i & 3u) != 3u) { free(p[i]); freed++; }
  } else {
    for (size_t i = 1; i < total; i += 2) { free(p[i]); freed++; }
  }

  hm_walk();
  printf("FREED mode=%s count=%zu\n", mode, freed);
  printf("AFTER freeBlocks=%zu freeBytes=%zu busyBlocks=%zu busyBytes=%zu\n",
         g_free_blocks, g_free_bytes, g_busy_blocks, g_busy_bytes);
  /* a plant of `freed` blocks has to show up somewhere; print every free
   * row big enough to be it, and the baseline rows so the reader can tell
   * a plant from residue. */
  hm_top("FREEROW", hm_free, freed / 8 ? freed / 8 : 1);
  printf("BASEROWS n=%zu\n", nbase);
  for (size_t i = 0; i < nbase; i++)
    printf("BASEROW size=%zu n=%zu\n", base_rows[i], base_counts[i]);
  printf("LOST %zu\n", hm_lost);
  fflush(stdout);
  return 0;
}
