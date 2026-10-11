#include <stdio.h>
int main(void){
  printf("ScrProfRow   %zu  x 65536 = %zu\n", sizeof(ScrProfRow), sizeof(ScrProfRow)*65536u);
  printf("ScrProfStack %zu  x %u = %zu\n", sizeof(ScrProfStack), (unsigned)SCR_PROF_STACK_SLOTS, sizeof(ScrProfStack)*(size_t)SCR_PROF_STACK_SLOTS);
  printf("sizeof scr_prof_tbl   %zu\n", sizeof scr_prof_tbl);
  printf("sizeof scr_prof_hist  %zu\n", sizeof scr_prof_hist);
  printf("sizeof scr_prof_exact %zu\n", sizeof scr_prof_exact);
  printf("sizeof scr_prof_stk   %zu\n", sizeof scr_prof_stk);
  printf("ScrHcRow     %zu\n", sizeof(ScrHcRow));
  printf("sizeof scr_hc_tbl     %zu\n", sizeof scr_hc_tbl);
  printf("sizeof scr_hc_ftbl    %zu\n", sizeof scr_hc_ftbl);
  printf("sizeof scr_hc_runhist %zu\n", sizeof scr_hc_runhist);
  printf("sizeof scr_hc_runpg   %zu\n", sizeof scr_hc_runpg);
  printf("sizeof scr_hc_pkheaps %zu\n", sizeof scr_hc_pkheaps);
  return 0;
}
