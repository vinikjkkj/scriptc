/* Two questions the first probe left open.
 *
 * 1. Does the high-resolution waitable timer scale BELOW 1 ms, or is the
 *    1.51 ms it costs for a 1 ms request mostly fixed overhead?  If it
 *    scales, slicing the idle sleep is a cheap partial fix.
 * 2. Does WSAEventSelect + WaitForMultipleObjects(sockets + hi-res timer)
 *    give both halves at once -- prompt wakeup on readiness AND an exact
 *    sub-tick timeout?
 *
 * Positive control on question 2: the READY case must return ~0.
 *
 *   zig cc -O2 -target x86_64-windows-gnu waitarm.c -o waitarm.exe -lws2_32
 */
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>

static double freq_ms;
static double nowms(void) { LARGE_INTEGER c; QueryPerformanceCounter(&c); return (double)c.QuadPart / freq_ms; }
static double median(double *v, int n) {
  for (int i = 1; i < n; i++) { double k = v[i]; int j = i-1; while (j >= 0 && v[j] > k) { v[j+1] = v[j]; j--; } v[j+1] = k; }
  return n & 1 ? v[n/2] : (v[n/2-1] + v[n/2]) / 2.0;
}
typedef struct { SOCKET a, b; } Pair;
static Pair make_pair(void) {
  Pair p; SOCKET ln = socket(AF_INET, SOCK_STREAM, 0);
  struct sockaddr_in sa; memset(&sa, 0, sizeof sa);
  sa.sin_family = AF_INET; sa.sin_addr.s_addr = htonl(INADDR_LOOPBACK); sa.sin_port = 0;
  bind(ln, (struct sockaddr *)&sa, sizeof sa); int len = sizeof sa;
  getsockname(ln, (struct sockaddr *)&sa, &len); listen(ln, 1);
  p.a = socket(AF_INET, SOCK_STREAM, 0);
  connect(p.a, (struct sockaddr *)&sa, sizeof sa);
  p.b = accept(ln, NULL, NULL); closesocket(ln);
  BOOL one = TRUE;
  setsockopt(p.a, IPPROTO_TCP, TCP_NODELAY, (char *)&one, sizeof one);
  setsockopt(p.b, IPPROTO_TCP, TCP_NODELAY, (char *)&one, sizeof one);
  u_long nb = 1; ioctlsocket(p.a, FIONBIO, &nb); ioctlsocket(p.b, FIONBIO, &nb);
  return p;
}
typedef struct { SOCKET s; HANDLE go; double delay_us; volatile LONG stop; } Sender;
static DWORD WINAPI sender_main(LPVOID arg) {
  Sender *S = (Sender *)arg;
  for (;;) { WaitForSingleObject(S->go, INFINITE); if (S->stop) return 0;
    double t0 = nowms(), want = S->delay_us / 1000.0;
    while (nowms() - t0 < want) YieldProcessor();
    char c = 'x'; send(S->s, &c, 1, 0); }
}
static void drain(SOCKET s) { char buf[64]; while (recv(s, buf, sizeof buf, 0) > 0) {} }

int main(void) {
  LARGE_INTEGER f; QueryPerformanceFrequency(&f); freq_ms = (double)f.QuadPart / 1000.0;
  WSADATA wsa; WSAStartup(MAKEWORD(2,2), &wsa);
  Pair p = make_pair();
  enum { N = 100 }; double v[N];
  HANDLE ht = CreateWaitableTimerExW(NULL, NULL, CREATE_WAITABLE_TIMER_HIGH_RESOLUTION, TIMER_ALL_ACCESS);
  if (!ht) { fprintf(stderr, "no high-res timer\n"); return 2; }

  puts("-- q1: high-resolution waitable timer, requested vs actual --");
  double reqs[] = {0.05, 0.1, 0.25, 0.5, 1.0, 2.0};
  for (unsigned k = 0; k < sizeof reqs/sizeof *reqs; k++) {
    for (int i = 0; i < N; i++) {
      LARGE_INTEGER due; due.QuadPart = -(LONGLONG)(reqs[k] * 10000.0);
      double t0 = nowms(); SetWaitableTimer(ht, &due, 0, NULL, NULL, FALSE);
      WaitForSingleObject(ht, 101); v[i] = nowms() - t0;
    }
    double m = median(v, N);
    printf("   request %5.2f ms  ->  actual %7.4f ms   overhead %+7.4f\n", reqs[k], m, m - reqs[k]);
  }

  puts("-- q2: WSAEventSelect + WaitForMultipleObjects(socket, timer) --");
  WSAEVENT ev = WSACreateEvent();
  if (WSAEventSelect(p.a, ev, FD_READ | FD_CLOSE) != 0) { fprintf(stderr, "WSAEventSelect %d\n", WSAGetLastError()); return 2; }
  HANDLE hs[2] = { (HANDLE)ev, ht };

  /* positive control: data already present */
  { char c = 'x'; send(p.b, &c, 1, 0); Sleep(30); }
  for (int i = 0; i < 20; i++) {
    WSAResetEvent(ev);
    WSAPOLLFD pf; pf.fd = p.a; pf.events = POLLRDNORM; pf.revents = 0;
    double t0 = nowms();
    int ready = WSAPoll(&pf, 1, 0) == 1;      /* the reset-race guard */
    double el;
    if (!ready) {
      LARGE_INTEGER due; due.QuadPart = -10000;
      SetWaitableTimer(ht, &due, 0, NULL, NULL, FALSE);
      WaitForMultipleObjects(2, hs, FALSE, 101);
      el = nowms() - t0;
    } else el = nowms() - t0;
    v[i] = el;
    if (!ready) { fprintf(stderr, "CONTROL FAILED: guard poll did not see present data\n"); return 3; }
  }
  printf("   CONTROL ready-already            %8.4f ms  (must be ~0)\n", median(v, 20));
  drain(p.a);

  /* idle cost */
  for (int i = 0; i < N; i++) {
    WSAResetEvent(ev);
    WSAPOLLFD pf; pf.fd = p.a; pf.events = POLLRDNORM; pf.revents = 0;
    double t0 = nowms();
    if (WSAPoll(&pf, 1, 0) != 1) {
      LARGE_INTEGER due; due.QuadPart = -10000;
      SetWaitableTimer(ht, &due, 0, NULL, NULL, FALSE);
      WaitForMultipleObjects(2, hs, FALSE, 101);
    }
    v[i] = nowms() - t0;
  }
  printf("   IDLE, 1 ms cap, nothing arrives  %8.4f ms\n", median(v, N));

  Sender S; S.s = p.b; S.go = CreateEventW(NULL, FALSE, FALSE, NULL); S.stop = 0;
  HANDLE th = CreateThread(NULL, 0, sender_main, &S, 0, NULL);
  double delays[] = {50, 200, 500, 900, 3000};
  for (unsigned k = 0; k < sizeof delays/sizeof *delays; k++) {
    S.delay_us = delays[k];
    for (int i = 0; i < 60; i++) {
      drain(p.a);
      double t0 = nowms(); SetEvent(S.go);
      double el;
      for (;;) {
        WSAResetEvent(ev);
        WSAPOLLFD pf; pf.fd = p.a; pf.events = POLLRDNORM; pf.revents = 0;
        if (WSAPoll(&pf, 1, 0) == 1) { el = nowms() - t0; break; }
        LARGE_INTEGER due; due.QuadPart = -10000;
        SetWaitableTimer(ht, &due, 0, NULL, NULL, FALSE);
        WaitForMultipleObjects(2, hs, FALSE, 101);
        el = nowms() - t0;
        if (el > 60) break;
      }
      v[i] = el;
    }
    printf("   WAKEUP reply at %4.0f us          %8.4f ms\n", delays[k], median(v, 60));
  }
  S.stop = 1; SetEvent(S.go); WaitForSingleObject(th, 1000);
  return 0;
}
