# Event-loop turn latency (win32)

A compiled program pays a fixed cost **per event-loop turn** when it is
waiting on a socket. Sequential request/response workloads pay it once per
request; concurrent ones amortise it away.

This has now been fixed **twice**, and the second fix is the one that
finishes it. Read both halves — the first is still the reason the second
was findable.

| | the sleep's granularity | the sleep's *existence* |
|---|---|---|
| what was wrong | `nanosleep(1 ms)` cost a full 15.6 ms tick | a 1 ms sleep costs 1.5164 ms *whatever* time the reply lands |
| the fix | `CreateWaitableTimerExW` + `HIGH_RESOLUTION` | wait on the sockets too: `WSAEventSelect` + `WaitForMultipleObjects` |
| depth-1 loopback RTT | 8.52 ms -> 1.49 ms | 1.49 ms -> **0.047 ms** (node: 0.091 ms) |
| real zapo bench, `buildGroups` | 12.06x node -> 1.97x | 2.36x node -> **1.00x** |

Nothing in the reproduction involves zapo, crypto, TLS or WebSockets. That
is the point: the whole effect reproduces in about a second with a 40-line
loopback echo.

## What `client.ts` measures

One loopback TCP connection to `echo-server.mjs`, `RTT_ROUNDS` exchanges
with `RTT_INFLIGHT` in flight at a time. Running it at several depths
separates a per-TURN cost from a per-byte or per-syscall one: a per-turn
cost is flat per BATCH and falls as 1/depth per REQUEST.

    RTT_PORT=45411 RTT_ROUNDS=2000 RTT_INFLIGHT=1   ./client.exe
    RTT_PORT=45411 RTT_ROUNDS=2000 RTT_INFLIGHT=128 ./client.exe

Measured 2026-08-31, x86_64-windows-gnu, quiet box, **before** either fix:

    depth   compiled per-request   compiled per-BATCH   node per-request
        1        8.5245 ms              8.524 ms           0.1057 ms
        8        1.9040 ms             15.232 ms           0.0346 ms
      128        0.0992 ms             12.400 ms           0.0207 ms

Per-batch flat, per-request 1/depth: a per-turn cost.

## Round one: the sleep could not express a sub-tick wait

`scr_async.c`'s win32 arm capped the idle sleep at `SCR_CHILD_POLL_MS = 1.0`
and called `nanosleep()`. `sleep-primitives.c` measures what that costs:

    primitive                                default    timeBeginPeriod(1)
    nanosleep(1ms)              <- was here  15.611 ms      15.584 ms
    Sleep(1)                                 15.531 ms       1.186 ms
    WaitForSingleObject(ev, 1)               15.480 ms       1.126 ms
    CreateWaitableTimerExW + HIGH_RESOLUTION  1.124 ms       1.207 ms

`nanosleep` is the one primitive that ignores the multimedia timer
resolution, so raising it system-wide does nothing — verified by holding
`timeBeginPeriod(1)` from another process and re-running both this probe
and the full bench: no change either time.

    zig cc -O2 -target x86_64-windows-gnu sleep-primitives.c -o sp.exe -lwinmm
    ./sp.exe        # default resolution
    ./sp.exe b      # with timeBeginPeriod(1) held

## Round two: the loop was still SLEEPING, not WAITING

The high-resolution timer made the sleep 1 ms instead of 15.6 ms, and the
loop still noticed readiness only at the *next* turn's zero-timeout
`WSAPoll`. So a reply that landed 50 us into the sleep waited the other
950, and one that landed at 900 us waited 600 — a **flat** cost, not a
proportional one. `waitarm.c` and `wsapoll-wait.c` measure it directly on a
loopback pair, with a sender thread that lands the reply at a chosen offset
into the wait:

    reply arrives at   blocking WSAPoll   hi-res sleep then WSAPoll(0)
             50 us         0.0691 ms              1.5207 ms
            200 us         0.2198 ms              1.5173 ms
            500 us         0.5266 ms              1.5104 ms
            900 us         0.9210 ms              1.5189 ms

Both files carry a positive control that must report ~0 for an
already-readable socket; an instrument that cannot see an immediate return
cannot be trusted about a slow one.

Two things that look like the fix and are not, both measured here:

1. **A blocking `WSAPoll` alone.** It wakes on readiness beautifully, but
   its *timeout* rounds up to a scheduler tick — 15.42 ms for a 1 ms
   request, 15.35 for 2, 15.25 for 15. Waiting on it would make every idle
   turn ten times worse.
2. **Slicing the sleep finer.** The high-resolution timer has a **fixed
   ~0.5 ms overhead**, so it does not scale down: a 50 us request costs
   0.5147 ms and a 100 us request costs 0.5157 ms. Eight slices of 125 us
   would cost 4 ms, not 1.

       request   0.05 ms -> 0.5147    request  0.50 ms -> 1.0065
       request   0.10 ms -> 0.5157    request  1.00 ms -> 1.5164
       request   0.25 ms -> 0.5144    request  2.00 ms -> 2.5049

What works is waiting on **both** at once: `WSAEventSelect` gives each
watched socket a waitable handle and `WaitForMultipleObjects` takes them
together with the high-resolution timer. Measured with the same sender:

    CONTROL ready-already              0.0035 ms
    IDLE, 1 ms cap, nothing arrives    1.5195 ms   (unchanged — no regression)
    reply at   50 us                   0.0645 ms
    reply at  200 us                   0.2165 ms
    reply at  500 us                   0.5202 ms
    reply at  900 us                   0.9213 ms

That is `scrp_wait_win32` in `scr_loop_wsapoll.c`; the reset-race guard and
the anti-spin ceiling it needs are documented at the function. The knob is
`SCRIPTC_NET_WAIT=0`, which restores the plain capped sleep.

    zig cc -O2 -target x86_64-windows-gnu waitarm.c      -o waitarm.exe      -lws2_32
    zig cc -O2 -target x86_64-windows-gnu wsapoll-wait.c -o wsapoll-wait.exe -lws2_32

## What round two is worth, on this microbenchmark

`client.ts`, 2000 rounds, three reps, medians of per-request ms, the two
arms being `SCRIPTC_NET_WAIT=0` and `=1` on **one binary**:

    depth   NET_WAIT=0   NET_WAIT=1   node v22
        1     1.4934       0.0475      0.0906
        8     0.2028       0.0324      0.0236
      128     0.0213       0.0127      0.0179

At depth 1 the compiled client is **31x** its own previous arm and **1.9x
faster than node**. At depth 128, where the cost was already amortised,
nothing moves — which is the shape a per-turn cost has to have.

The real-bench numbers this is responsible for are in
`tests/perf/cpuphase/README.md`.
