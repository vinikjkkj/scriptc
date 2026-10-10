/* Is the BUSY table banded like the free one?
 *
 * HOLEMAP.md establishes that every request in [1296,1352] leaves a hole the
 * free table reports as 1,344. It then reads the BUSY row at 1,328 as a
 * request of exactly 1,328. That second step is a separate claim about a
 * separate table and it was never tested: if HeapWalk's cbData for a busy
 * block were also rounded to the bucket, "4,097 busy at 1,328" would mean
 * "4,097 busy anywhere in [1296,1352]" and the attribution would be looser
 * than it reads.
 *
 * Plant 100 LIVE blocks at each of the band's edges and interior and read the
 * busy table back. Distinct rows => the busy table is exact. One row => it is
 * banded and HOLEMAP ss.4 over-reads it.
 */
#include <stdlib.h>
#include <stdio.h>
static const size_t SZ[] = {1288, 1296, 1304, 1312, 1320, 1328, 1336, 1344, 1352, 1353, 4368, 4376, 4384};
#define NS (sizeof SZ / sizeof SZ[0])
#define PER 100
static void *keep[NS][PER];
int main(void) {
  size_t i, j;
  for (i = 0; i < NS; i++)
    for (j = 0; j < PER; j++) keep[i][j] = malloc(SZ[i]);
  fprintf(stderr, "[busyband] planted %u sizes x %d live blocks\n", (unsigned)NS, PER);
  for (i = 0; i < NS; i++) fprintf(stderr, "[busyband] planted %zu\n", SZ[i]);
  _Exit(0);
}
