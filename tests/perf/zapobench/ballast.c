/* ballast.c — positive control for runner.exe.
 *   ballast.exe <MiB>
 * Touches exactly <MiB> MiB of private memory (one byte per 4 KiB page, then a
 * full memset so the pages are certainly resident), holds it, and exits 0.
 * runner's reported peak working set must rise by about <MiB> MiB.
 */
#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
int main(int argc, char **argv) {
  long long mib = argc > 1 ? atoll(argv[1]) : 0;
  size_t n = (size_t)mib * 1024 * 1024;
  volatile unsigned char *p = NULL;
  if (n) {
    p = (unsigned char *)VirtualAlloc(NULL, n, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
    if (!p) { fprintf(stderr, "ballast: alloc failed\n"); return 1; }
    for (size_t i = 0; i < n; i += 4096) p[i] = (unsigned char)(i & 0xff);
    unsigned long long s = 0;
    for (size_t i = 0; i < n; i += 4096) s += p[i];
    printf("ballast %lld MiB touched sum=%llu\n", mib, s);
  } else {
    printf("ballast 0 MiB\n");
  }
  fflush(stdout);
  return 0;
}
