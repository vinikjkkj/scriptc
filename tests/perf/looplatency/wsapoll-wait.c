/* Does a BLOCKING WSAPoll wake on socket readiness at sub-tick latency,
 * and what does its timeout actually cost when nothing arrives?
 *
 * The loop's win32 arm today is: high-resolution waitable timer for
 * min(deadline, 1 ms), then a ZERO-timeout WSAPoll at the next turn's
 * top.  A reply that lands inside the sleep waits the rest of it.  The
 * proposed replacement is a blocking WSAPoll with the same 1 ms cap.
 * That is only an improvement if
 *   (a) readiness ends the wait promptly, and
 *   (b) the timeout itself does not round up to a 15.6 ms tick.
 *
 * Positive control: case READY must report ~0 -- an instrument that
 * cannot see an immediate return cannot be believed about a slow one.
 *
 *   zig cc -O2 -target x86_64-windows-gnu wsapoll-wait.c -o wsapoll-wait.exe -lws2_32
 */
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <stdio.h>
#include <stdlib.h>

static double freq_ms;
static double nowms(void) {
  LARGE_INTEGER c; QueryPerformanceCounter(&c);
  return (double)c.QuadPart / freq_ms;
}

typedef struct { SOCKET a, b; } Pair;

static Pair make_pair(void) {
  Pair p;
  SOCKET ln = socket(AF_INET, SOCK_STREAM, 0);
  struct sockaddr_in sa; memset(&sa, 0, sizeof sa);
  sa.sin_family = AF_INET; sa.sin_addr.s_addr = htonl(INADDR_LOOPBACK); sa.sin_port = 0;
  if (bind(ln, (struct sockaddr *)&sa, sizeof sa) != 0) { fprintf(stderr, "bind %d\n", WSAGetLastError()); exit(2); }
  int len = sizeof sa;
  getsockname(ln, (struct sockaddr *)&sa, &len);
  listen(ln, 1);
  p.a = socket(AF_INET, SOCK_STREAM, 0);
  if (connect(p.a, (struct sockaddr *)&sa, sizeof sa) != 0) { fprintf(stderr, "connect %d\n", WSAGetLastError()); exit(2); }
  p.b = accept(ln, NULL, NULL);
  if (p.b == INVALID_SOCKET) { fprintf(stderr, "accept %d\n", WSAGetLastError()); exit(2); }
  closesocket(ln);
  BOOL one = TRUE;
  setsockopt(p.a, IPPROTO_TCP, TCP_NODELAY, (char *)&one, sizeof one);
  setsockopt(p.b, IPPROTO_TCP, TCP_NODELAY, (char *)&one, sizeof one);
  u_long nb = 1; ioctlsocket(p.a, FIONBIO, &nb); ioctlsocket(p.b, FIONBIO, &nb);
  return p;
}

/* sender thread: waits on an event, spins a precise delay, then sends 1 byte */
typedef struct { SOCKET s; HANDLE go; double delay_us; volatile LONG stop; } Sender;
static DWORD WINAPI sender_main(LPVOID arg) {
  Sender *S = (Sender *)arg;
  for (;;) {
    WaitForSingleObject(S->go, INFINITE);
    if (S->stop) return 0;
    double t0 = nowms(), want = S->delay_us / 1000.0;
    while (nowms() - t0 < want) { YieldProcessor(); }
    char c = 'x';
    send(S->s, &c, 1, 0);
  }
}

static void drain(SOCKET s) { char buf[64]; while (recv(s, buf, sizeof buf, 0) > 0) {} }

static double median(double *v, int n) {
  for (int i = 1; i < n; i++) { double k = v[i]; int j = i - 1; while (j >= 0 && v[j] > k) { v[j+1] = v[j]; j--; } v[j+1] = k; }
  return n & 1 ? v[n/2] : (v[n/2-1] + v[n/2]) / 2.0;
}

int main(void) {
  LARGE_INTEGER f; QueryPerformanceFrequency(&f); freq_ms = (double)f.QuadPart / 1000.0;
  WSADATA wsa; WSAStartup(MAKEWORD(2,2), &wsa);
  Pair p = make_pair();
  enum { N = 200 };
  double v[N];
  WSAPOLLFD pfd; pfd.fd = p.a; pfd.events = POLLRDNORM; pfd.revents = 0;

  /* --- positive control: data already there, timeout 1 ms --- */
  { char c = 'x'; send(p.b, &c, 1, 0); Sleep(30); }
  for (int i = 0; i < 20; i++) {
    double t0 = nowms(); pfd.revents = 0; int r = WSAPoll(&pfd, 1, 1); v[i] = nowms() - t0;
    if (r != 1) { fprintf(stderr, "CONTROL FAILED: WSAPoll returned %d (%d) -- instrument is blind\n", r, WSAGetLastError()); return 3; }
  }
  double ctrl = median(v, 20);
  printf("CONTROL  ready-already, WSAPoll(t=1)      %8.4f ms  (must be ~0)\n", ctrl);
  if (ctrl > 0.30) { fprintf(stderr, "CONTROL FAILED: an immediate return cost %.4f ms\n", ctrl); return 3; }
  drain(p.a);

  /* --- timeout cost when nothing is ready --- */
  int tos[] = {1, 2, 5, 15, 50};
  for (unsigned k = 0; k < sizeof tos / sizeof *tos; k++) {
    for (int i = 0; i < 60; i++) {
      double t0 = nowms(); pfd.revents = 0; WSAPoll(&pfd, 1, tos[k]); v[i] = nowms() - t0;
    }
    printf("IDLE     WSAPoll(timeout=%2d)             %8.4f ms\n", tos[k], median(v, 60));
  }

  /* --- the high-resolution waitable timer, for comparison --- */
  HANDLE ht = CreateWaitableTimerExW(NULL, NULL, CREATE_WAITABLE_TIMER_HIGH_RESOLUTION, TIMER_ALL_ACCESS);
  if (ht == NULL) { fprintf(stderr, "no high-res timer\n"); return 2; }
  for (int i = 0; i < 60; i++) {
    LARGE_INTEGER due; due.QuadPart = -10000; /* 1 ms */
    double t0 = nowms(); SetWaitableTimer(ht, &due, 0, NULL, NULL, FALSE); WaitForSingleObject(ht, 101); v[i] = nowms() - t0;
  }
  printf("IDLE     hi-res timer 1 ms (in use today) %8.4f ms\n", median(v, 60));

  /* --- wakeup latency: reply lands DELAY us into the wait --- */
  Sender S; S.s = p.b; S.go = CreateEventW(NULL, FALSE, FALSE, NULL); S.stop = 0;
  HANDLE th = CreateThread(NULL, 0, sender_main, &S, 0, NULL);
  double delays[] = {50, 200, 500, 900};
  for (unsigned k = 0; k < sizeof delays / sizeof *delays; k++) {
    S.delay_us = delays[k];
    /* arm A: blocking WSAPoll, 1 ms cap */
    for (int i = 0; i < 60; i++) {
      drain(p.a);
      double t0 = nowms(); SetEvent(S.go);
      pfd.revents = 0;
      double el;
      for (;;) { int r = WSAPoll(&pfd, 1, 1); el = nowms() - t0; if (r == 1) break; if (el > 60) break; }
      v[i] = el;
    }
    double a = median(v, 60);
    /* arm B: today's scheme -- hi-res 1 ms sleep, then WSAPoll(0) */
    for (int i = 0; i < 60; i++) {
      drain(p.a);
      double t0 = nowms(); SetEvent(S.go);
      double el;
      for (;;) {
        pfd.revents = 0;
        int r = WSAPoll(&pfd, 1, 0);
        el = nowms() - t0;
        if (r == 1) break;
        if (el > 60) break;
        LARGE_INTEGER due; due.QuadPart = -10000;
        SetWaitableTimer(ht, &due, 0, NULL, NULL, FALSE); WaitForSingleObject(ht, 101);
      }
      v[i] = el;
    }
    double b = median(v, 60);
    printf("WAKEUP   reply at %4.0f us:  blocking WSAPoll %7.4f ms   sleep+poll(0) %7.4f ms   delta %+7.4f\n",
           delays[k], a, b, b - a);
  }
  S.stop = 1; SetEvent(S.go); WaitForSingleObject(th, 1000);
  return 0;
}
