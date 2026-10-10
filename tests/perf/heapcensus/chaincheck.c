/* H2 positive control for the prof+heapcensus chain and the second size band.
 * Plants a KNOWN population in each band and exits through _Exit, which is
 * the only exit a compiled scriptc program ever takes. */
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#define N_A 300   /* band 1: 1328 */
#define N_B 170   /* band 2: 4376 */
#define N_C 500   /* outside both bands: must NOT be captured */
static void *keepA[N_A], *keepB[N_B], *keepC[N_C];
static void mk(void){
  int i;
  for (i=0;i<N_A;i++) keepA[i]=malloc(1328);
  for (i=0;i<N_B;i++) keepB[i]=malloc(4376);
  for (i=0;i<N_C;i++) keepC[i]=malloc(2000);
  /* free every other A so the free table gets a known 1344 population */
  for (i=1;i<N_A;i+=2){ free(keepA[i]); keepA[i]=NULL; }
}
int main(void){ mk(); fflush(stdout); _Exit(0); }
