/* mallocgrain.c — what a malloc block really costs on this target.
 *
 * The census prices entries/items buffers, the OBJ ext block and every
 * member key at what the ALLOCATOR charges, not at what the caller asked
 * for. SCR_DYNCEN_MALLOC_HDR and SCR_DYNCEN_MALLOC_ALIGN are that model
 * and this program is where they come from. Run it before believing a
 * physical-bytes figure on a target it has not been run on.
 *
 *   zig cc -O2 -target x86_64-windows-gnu -o mallocgrain.exe mallocgrain.c -lpsapi
 *
 * WHY NOT _msize. On x86_64-windows-gnu _msize ECHOES THE REQUEST — it
 * reports 24 for malloc(24) and 96 for malloc(96), i.e. zero slack at
 * every size. A first probe of mine believed exactly that and concluded
 * the allocator rounds nothing. Three instruments that do measure it:
 *
 *   HeapSize   the CRT's own answer, when malloc rides HeapAlloc;
 *   stride     the modal gap between consecutive same-size blocks, which
 *              is the only one that sees the block header;
 *   privdelta  the process's committed private bytes divided by the
 *              number of live blocks — the figure that decides whether a
 *              smaller request would return pages at all.
 *
 * On x86_64-windows-gnu, zig 0.16.0, Windows 11: stride is
 * round_up(want + 8, 16) at every size below, and privdelta tracks it
 * within ~4 bytes. That is the model the census uses.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <windows.h>
#include <psapi.h>

#define NBLK 200000
#define NSTRIDE 4000

static void *blk[NBLK];

static size_t priv_bytes(void) {
  PROCESS_MEMORY_COUNTERS_EX pmc;
  memset(&pmc, 0, sizeof pmc);
  pmc.cb = sizeof pmc;
  if (!GetProcessMemoryInfo(GetCurrentProcess(), (PROCESS_MEMORY_COUNTERS *)&pmc,
                            sizeof pmc))
    return 0;
  return (size_t)pmc.PrivateUsage;
}

static size_t modal_stride(void) {
  size_t seen[64], ns = 0, best = 0, bestn = 0, i, j;
  for (i = 1; i < NSTRIDE && ns < 64; i++) {
    ptrdiff_t d = (char *)blk[i] - (char *)blk[i - 1];
    size_t u = (size_t)d;
    int found = 0;
    if (d <= 0 || u >= 4096) continue;
    for (j = 0; j < ns; j++)
      if (seen[j] == u) { found = 1; break; }
    if (!found) seen[ns++] = u;
  }
  for (j = 0; j < ns; j++) {
    size_t c = 0;
    for (i = 1; i < NSTRIDE; i++)
      if ((size_t)((char *)blk[i] - (char *)blk[i - 1]) == seen[j]) c++;
    if (c > bestn) { bestn = c; best = seen[j]; }
  }
  return best;
}

static void measure(const char *what, size_t want) {
  size_t i, before, after, heapsz = 0, stride, model;
  HANDLE hh = GetProcessHeap();

  before = priv_bytes();
  for (i = 0; i < NBLK; i++) {
    blk[i] = malloc(want);
    if (!blk[i]) { printf("%s: OOM\n", what); return; }
    memset(blk[i], 0x5a, want); /* touch it: commit is what is being priced */
  }
  after = priv_bytes();
  if (HeapValidate(hh, 0, blk[0])) heapsz = HeapSize(hh, 0, blk[0]);
  stride = modal_stride();
  model = (want + 8 + 15) & ~(size_t)15;

  printf("%-18s want=%-6zu msize=%-6zu heapsize=%-6zu stride=%-6zu model=%-6zu %s "
         "privdelta/blk=%.2f\n",
         what, want, _msize(blk[0]), heapsz, stride, model,
         stride == model ? "OK  " : "DIFF", (double)(after - before) / (double)NBLK);

  for (i = 0; i < NBLK; i++) free(blk[i]);
}

int main(void) {
  char lbl[64];
  size_t c;
  puts("# ScrDynEntry is 24 bytes; the entries buffer is cap*24.");
  for (c = 1; c <= 64; c *= 2) {
    snprintf(lbl, sizeof lbl, "entries cap=%zu", c);
    measure(lbl, c * 24);
  }
  measure("entries cap=3", 72);
  puts("# the items buffer is cap*8.");
  for (c = 1; c <= 128; c *= 2) {
    snprintf(lbl, sizeof lbl, "items cap=%zu", c);
    measure(lbl, c * 8);
  }
  puts("# member keys: the pool rounds key_len+1 up to 8 and mallocs that.");
  measure("key<=7", 8);
  measure("key<=15", 16);
  measure("key<=23", 24);
  measure("key<=31", 32);
  puts("# the OBJ ext block.");
  measure("ScrDynObjExt", 32);
  return 0;
}
