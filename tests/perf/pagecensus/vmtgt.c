/* vmtgt -- an arm for vmcensus with a KNOWN answer in every class.
 *
 *   vmtgt <commitMiB> <touchMiB> <nfibers> <fiberStackKiB> <holdSeconds>
 *
 * commitMiB  VirtualAlloc MEM_COMMIT, NOT touched. Commit charge rises, the
 *            working set does not. If the walker confuses the two columns the
 *            positive control fails here and nowhere else.
 * touchMiB   of that, written to. Working set rises too.
 * nfibers    CreateFiber() with an explicit stack size. Each gets a private
 *            allocation base carrying a PAGE_GUARD region, which is the exact
 *            shape the STACK rule keys on. Zero here is the NEGATIVE control:
 *            the walk must then report the thread's own 1-2 stacks, not 0 and
 *            not nfibers.
 *
 * Nothing is freed and nothing is converted back: the process holds the shape
 * for holdSeconds so a sampling walker cannot miss it. The arm's job is to
 * make "found none" and "there are none" read differently.
 *
 *   zig cc -O0 -o vmtgt.exe vmtgt.c
 * -O0 deliberately: tests/perf -- an optimiser has collapsed a control's
 * distinguishing work into nothing in this repo before (estado-vmwalk sec.10).
 */
#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void CALLBACK fiberBody(void *p) { (void)p; for (;;) SwitchToFiber(NULL); }

int main(int argc, char **argv) {
  if (argc < 6) {
    fprintf(stderr, "usage: vmtgt <commitMiB> <touchMiB> <nfibers> <fiberStackKiB> <holdSeconds> [mallocMiB]\n");
    return 2;
  }
  size_t commitMiB = (size_t)strtoull(argv[1], NULL, 10);
  size_t touchMiB  = (size_t)strtoull(argv[2], NULL, 10);
  long   nfib      = strtol(argv[3], NULL, 10);
  size_t stackKiB  = (size_t)strtoull(argv[4], NULL, 10);
  int    hold      = (int)strtol(argv[5], NULL, 10);
  size_t mallocMiB = (argc > 6) ? (size_t)strtoull(argv[6], NULL, 10) : 0;
  /* argv[7]: one FIXED block size in bytes instead of the mixed ladder.
   * The subject has seven 1.004 MiB bases of ONE region each, a shape the
   * mixed-ladder arm never produced. Either they are large mallocs the NT
   * heap forwards straight to VirtualAlloc, or they are not the heap at
   * all. One size settles it. */
  size_t fixedSz = (argc > 7) ? (size_t)strtoull(argv[7], NULL, 10) : 0;

  /* SHAPE CONTROL. The subject's large private bases carry dozens of
   * regions under ONE allocation base. That is a claim about which
   * ALLOCATOR made them, and a label is not a measurement. This arm
   * drives the SAME CRT (both binaries are zig cc, x86_64-windows-gnu,
   * so both are mingw/msvcrt) through ordinary malloc of mixed sizes
   * and lets the walk report the shape malloc actually produces here.
   * If the signature matches, the subject's bases are named by
   * evidence; if it does not, the label was wrong and that is the
   * result. */
  if (mallocMiB) {
    size_t want = mallocMiB << 20, got = 0;
    size_t sizes[6] = { 48, 112, 300, 1024, 4096, 65536 };
    int k = 0; long nblk = 0;
    while (got < want) {
      size_t sz = fixedSz ? fixedSz : sizes[k++ % 6];
      void *q = malloc(sz);
      if (!q) break;
      memset(q, 0xA5, sz);   /* touch: an untouched malloc may not commit */
      got += sz; nblk++;
    }
    fprintf(stderr, "vmtgt: malloc arm wanted=%zu MiB got=%zu MiB blocks=%ld\n",
            mallocMiB, got >> 20, nblk);
  }

  unsigned char *p = NULL;
  if (commitMiB) {
    p = (unsigned char *)VirtualAlloc(NULL, commitMiB << 20,
                                      MEM_RESERVE | MEM_COMMIT, PAGE_READWRITE);
    if (!p) { fprintf(stderr, "vmtgt: VirtualAlloc(%zu MiB) failed %lu\n", commitMiB, GetLastError()); return 3; }
    for (size_t i = 0; i < (touchMiB << 20); i += 4096) p[i] = (unsigned char)i;
  }

  if (nfib > 0) {
    if (!ConvertThreadToFiber(NULL)) {
      fprintf(stderr, "vmtgt: ConvertThreadToFiber failed %lu\n", GetLastError());
      return 4;
    }
    long made = 0;
    for (long i = 0; i < nfib; i++) {
      /* dwStackCommitSize=0 lets the system choose; the reserve is what shapes
       * the base. Both are asked for explicitly so the arm's answer is a
       * number the walk can be checked against. */
      LPVOID f = CreateFiberEx(stackKiB << 10, stackKiB << 10, 0, fiberBody, NULL);
      if (!f) break;
      made++;
    }
    fprintf(stderr, "vmtgt: fibers requested=%ld created=%ld stackKiB=%zu\n", nfib, made, stackKiB);
    if (made != nfib) { fprintf(stderr, "vmtgt: ARM INCOMPLETE -- do not score this run\n"); return 5; }
  }

  fprintf(stderr, "vmtgt: pid=%lu commitMiB=%zu touchMiB=%zu fibers=%ld holding %ds\n",
          GetCurrentProcessId(), commitMiB, touchMiB, nfib, hold);
  fflush(stderr);
  Sleep((DWORD)hold * 1000);
  if (p) p[0] = 1;             /* keep the reservation alive to the end */
  return 0;
}
