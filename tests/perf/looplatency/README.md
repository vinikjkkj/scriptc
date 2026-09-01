# Event-loop turn latency (win32)

A compiled program pays a fixed cost **per event-loop turn** when it is
waiting on a socket, and on win32 that cost is a full scheduler tick.
Sequential request/response workloads pay it once per request; concurrent
ones amortise it away. Measured against the real zapo messaging bench it
was worth **11.5x** on the worst phase and **4.4x** on the next, while the
phases that issue no round trips were 1.3-1.5x and one phase where the
client fans out over 1000 concurrent chains was **0.93x — compiled faster**.

Nothing here involves zapo, crypto, TLS or WebSockets. That is the point:
the whole effect reproduces in about a second with a 40-line loopback echo.

## What it measures

`client.ts` opens one loopback TCP connection to `echo-server.mjs` and does
`RTT_ROUNDS` request/response exchanges with `RTT_INFLIGHT` requests in
flight at a time. Running it at several depths separates a per-TURN cost
from a per-byte or per-syscall one: a per-turn cost is flat per BATCH and
falls as 1/depth per REQUEST.

    RTT_PORT=45411 RTT_ROUNDS=2000 RTT_INFLIGHT=1   ./client.exe
    RTT_PORT=45411 RTT_ROUNDS=2000 RTT_INFLIGHT=128 ./client.exe

Measured 2026-08-31, x86_64-windows-gnu, quiet box:

    depth   compiled per-request   compiled per-BATCH   node per-request
        1        8.5245 ms              8.524 ms           0.1057 ms
        8        1.9040 ms             15.232 ms           0.0346 ms
      128        0.0992 ms             12.400 ms           0.0207 ms

Per-batch flat, per-request 1/depth: a per-turn cost. At depth 128 the
compiled client reaches node's *sequential* number, so the socket path is
not slow -- the turn is.

## Why

`scr_async.c`'s win32 arm caps the idle sleep at `SCR_CHILD_POLL_MS = 1.0`
and calls `nanosleep()`. `sleep-primitives.c` measures what that costs:

    primitive                                default    timeBeginPeriod(1)
    nanosleep(1ms)              <- in use    15.611 ms      15.584 ms
    Sleep(1)                                 15.531 ms       1.186 ms
    WaitForSingleObject(ev, 1)               15.480 ms       1.126 ms
    CreateWaitableTimerExW + HIGH_RESOLUTION  1.124 ms       1.207 ms

`nanosleep` is the one primitive that ignores the multimedia timer
resolution, so raising it system-wide does nothing -- verified by holding
`timeBeginPeriod(1)` from another process and re-running both this probe
and the full bench: no change either time. A reply arriving anywhere
inside a 15.7 ms sleep is noticed at the next turn's zero-timeout
`WSAPoll`, so the expected wait is half the window, ~7.9 ms, against
8.26-10.58 ms measured.

Note this is NOT the absence of a pollable wake fd, which is what
`scr_loop_wsapoll.c`'s header predicts and proposes to fix with
`WSAEventSelect`/IOCP. That would be better still, but the granularity of
the sleep is what stands between this workload and node.

    zig cc -O2 -target x86_64-windows-gnu sleep-primitives.c -o sp.exe -lwinmm
    ./sp.exe        # default resolution
    ./sp.exe b      # with timeBeginPeriod(1) held
