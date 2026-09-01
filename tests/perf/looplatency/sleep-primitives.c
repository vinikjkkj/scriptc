/* Which sleep primitive honours a 1 ms request on this toolchain/target,
 * and which respond to timeBeginPeriod(1)? The runtime's loop needs a
 * sub-tick idle wait; nanosleep is not providing one. */
#include <stdio.h>
#include <time.h>
#include <windows.h>

static double now_ms(void) {
  LARGE_INTEGER f, c;
  QueryPerformanceFrequency(&f); QueryPerformanceCounter(&c);
  return (double)c.QuadPart * 1000.0 / (double)f.QuadPart;
}
#define BENCH(label, stmt) do { \
  double t0 = now_ms(); for (int i = 0; i < N; i++) { stmt; } \
  double el = now_ms() - t0; \
  printf("  %-34s %8.3f ms each\n", label, el / N); fflush(stdout); } while (0)

int main(int argc, char **argv) {
  const int N = 200;
  int boost = (argc > 1 && argv[1][0] == 'b');
  if (boost) timeBeginPeriod(1);
  printf("%s\n", boost ? "-- timeBeginPeriod(1) HELD --" : "-- default timer resolution --");

  struct timespec ts = {0, 1000000L};
  BENCH("nanosleep(1ms)", nanosleep(&ts, NULL));
  BENCH("Sleep(1)", Sleep(1));

  HANDLE ev = CreateEventW(NULL, FALSE, FALSE, NULL);
  BENCH("WaitForSingleObject(ev,1)", WaitForSingleObject(ev, 1));
  CloseHandle(ev);

  HANDLE t = CreateWaitableTimerExW(NULL, NULL,
      CREATE_WAITABLE_TIMER_HIGH_RESOLUTION, TIMER_ALL_ACCESS);
  if (t == NULL) {
    printf("  %-34s (unavailable)\n", "high-res waitable timer");
  } else {
    LARGE_INTEGER due; due.QuadPart = -10000LL; /* 1 ms, relative */
    BENCH("waitable timer HIGH_RESOLUTION 1ms",
          (SetWaitableTimer(t, &due, 0, NULL, NULL, FALSE), WaitForSingleObject(t, INFINITE)));
    CloseHandle(t);
  }
  if (boost) timeEndPeriod(1);
  return 0;
}
