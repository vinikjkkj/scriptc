/*
 * elemprobe.c - MECHANISM PROBE, not a perf claim.
 *
 * What ONE typed-array element access costs on the LLVM lane, in cycles, on
 * the buffer the census says carries 92.1% of send_group's accesses: a
 * SIXTEEN-ELEMENT Float64Array. The sequence is the one the emitter writes,
 * read straight out of messaging.bench.ll:
 *
 *   %t1 = call ptr    @scr_bytes_retain_v(ptr %t0)
 *   %t2 = call double @scr_bytes_get_fast(ptr %t1, double %i)
 *          call void  @scr_bytes_release(ptr %t1)
 *
 * The same source links against either scr_bytes.o, so the arm under test is
 * chosen by the object, not by a flag this file can see. Indices come out of
 * MEMORY so the compiler cannot fold the window check away.
 *
 * ARMS (printed per run; the caller interleaves the two binaries):
 *   f64.full   retain + get_fast + release      what ships
 *   f64.bare   get_fast alone                   the elided-refcount ceiling
 *   f64.set    retain + set_fast + release
 *   u8.full    the u8 buffer, for contrast
 *   rconly     retain + release, no access      the refcount round trip
 * The first arm is repeated LAST as an A/A control.
 */
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <windows.h>

typedef enum { SCR_BYTES_U8 = 0, SCR_BYTES_U32, SCR_BYTES_F32, SCR_BYTES_I32,
               SCR_BYTES_F64 } ScrBytesElem;
typedef struct ScrBytes {
  size_t rc; size_t len; ScrBytesElem elem; uint8_t flavor; uint8_t *data;
  struct ScrBytes *backing;
} ScrBytes;

extern void  *scr_bytes_retain_v(void *b);
extern void   scr_bytes_release(ScrBytes *b);
extern double scr_bytes_get_fast(const ScrBytes *b, double i);
extern void   scr_bytes_set_fast(ScrBytes *b, double i, double v);

static uint64_t tsc(void) { unsigned aux; return __builtin_ia32_rdtscp(&aux); }

#define N 16
static double idx[N];
static volatile double sink;

int main(int argc, char **argv) {
  long reps = argc > 1 ? atol(argv[1]) : 8000000;
  const char *tag = argc > 2 ? argv[2] : "?";
  double f64store[N];
  uint8_t u8store[N];
  ScrBytes f, u;
  int i;
  memset(&f, 0, sizeof f); memset(&u, 0, sizeof u);
  f.rc = 1; f.len = N; f.elem = SCR_BYTES_F64; f.data = (uint8_t *)f64store;
  u.rc = 1; u.len = N; u.elem = SCR_BYTES_U8;  u.data = u8store;
  for (i = 0; i < N; i++) { f64store[i] = (double)(i * 4099); u8store[i] = (uint8_t)(i * 7); idx[i] = (double)i; }

  SetPriorityClass(GetCurrentProcess(), HIGH_PRIORITY_CLASS);
  SetThreadAffinityMask(GetCurrentThread(), 1);

  static const char *names[6] = { "f64.full", "f64.bare", "f64.set", "u8.full", "rconly", "f64.full(A/A)" };
  uint64_t t[6];
  double acc = 0;
  long r;
  int arm;

  for (arm = 0; arm < 6; arm++) {
    uint64_t t0;
    for (r = 0; r < 200000; r++) { /* warm, same shape as the arm */
      ScrBytes *p = (ScrBytes *)scr_bytes_retain_v(&f);
      acc += scr_bytes_get_fast(p, idx[r & (N - 1)]);
      scr_bytes_release(p);
    }
    t0 = tsc();
    switch (arm) {
      case 0: case 5:
        for (r = 0; r < reps; r++) {
          ScrBytes *p = (ScrBytes *)scr_bytes_retain_v(&f);
          acc += scr_bytes_get_fast(p, idx[r & (N - 1)]);
          scr_bytes_release(p);
        }
        break;
      case 1:
        for (r = 0; r < reps; r++) acc += scr_bytes_get_fast(&f, idx[r & (N - 1)]);
        break;
      case 2:
        for (r = 0; r < reps; r++) {
          ScrBytes *p = (ScrBytes *)scr_bytes_retain_v(&f);
          scr_bytes_set_fast(p, idx[r & (N - 1)], (double)r);
          scr_bytes_release(p);
        }
        break;
      case 3:
        for (r = 0; r < reps; r++) {
          ScrBytes *p = (ScrBytes *)scr_bytes_retain_v(&u);
          acc += scr_bytes_get_fast(p, idx[r & (N - 1)]);
          scr_bytes_release(p);
        }
        break;
      default:
        for (r = 0; r < reps; r++) {
          ScrBytes *p = (ScrBytes *)scr_bytes_retain_v(&f);
          acc += (double)(uintptr_t)p;
          scr_bytes_release(p);
        }
        break;
    }
    t[arm] = tsc() - t0;
  }
  sink = acc + f64store[3];

  printf("== %s == reps=%ld  cycles/access (rdtscp, core 0, HIGH prio)\n", tag, reps);
  for (arm = 0; arm < 6; arm++)
    printf("   %-14s %8.2f\n", names[arm], (double)t[arm] / (double)reps);
  printf("   A/A drift     %8.4f\n", (double)t[5] / (double)t[0]);
  return 0;
}
