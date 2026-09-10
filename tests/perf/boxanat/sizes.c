#include <stdio.h>
#include "scr_runtime.h"
int main(void) {
  printf("sizeof(ScrDyn)=%zu\n", sizeof(ScrDyn));
  printf("sizeof(ScrDynEntry)=%zu\n", sizeof(ScrDynEntry));
  printf("sizeof(ScrCycHdr)=%zu\n", sizeof(ScrCycHdr));
  printf("sizeof(ScrDynObjExt)=%zu\n", sizeof(ScrDynObjExt));
  printf("POOL_GRAIN=%u POOL_MAX=%u\n", (unsigned)SCR_POOL_GRAIN, (unsigned)SCR_POOL_MAX);
  printf("dyn_node_phys=%zu\n", scr_pool_bytes(sizeof(ScrCycHdr) + sizeof(ScrDyn)));
  printf("OBJ_FIRST_CAP=%d ARR_FIRST_CAP=%d\n", SCR_DYN_OBJ_FIRST_CAP, SCR_DYN_ARR_FIRST_CAP);
  printf("sizeof(ScrStr)=%zu sizeof(ScrArr)=%zu\n", sizeof(ScrStr), sizeof(ScrArr));
  printf("sizeof(ScrUnion)=%zu\n", sizeof(ScrUnion));
  printf("union_node_phys=%zu\n", scr_pool_bytes(sizeof(ScrCycHdr) + sizeof(ScrUnion)));
  return 0;
}
