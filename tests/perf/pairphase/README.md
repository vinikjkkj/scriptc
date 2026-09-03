# The other half of the bench: what the fake server costs

`cpuphase.exe` samples the **direct child only** — there is no job object —
so on the zapo messaging bench its cycle and RSS columns are *client-only*
while wall is real end-to-end. Everything the fake server does lands in the
wall and in none of the counters, and that blind spot is what made
`send_1to1` unreadable for three blocks running: the phase sat at 1.28x
node's wall on 0.84x node's cycles, and the difference was written up as
"~740 ms of waiting that no known mechanism accounts for".

`pairphase.c` is `cpuphase.c` with one addition. A discovery thread walks
the process table for children of the bench process — the fake server is
spawned as `BENCH_NODE` -> `node.exe` — and opens a handle to each. At
every `[phase-begin]` / `[phase-end]` marker on the **client's** stdout,
both the client and every discovered server child are sampled, so the two
processes' cycles, user/kernel split, IO operation counts and page faults
line up on the same phase boundaries.

    pairphase.exe -- <cmd> [args...]

Output is `[cpuphase]` and `[cpumem]` in cpuphase's exact column order — the
existing parsers read it unchanged — followed by one `[srvphase]` block per
server pid. A child discovered while a phase is already open takes its
baseline at discovery; a phase that ended before the child existed prints
`n/a` for it rather than a zero, because a census that cannot say "I did
not see this" is the failure this fleet keeps finding.

## What it answered

Measured 2026-09-03 on `main@15cb7d30`, real zapo messaging bench,
default workload, node v25.9.0 as the oracle, fake-server child held fixed
at v22.18.0, three reps, arms interleaved inside every rep.

**There is no waiting.** In `send_1to1` the compiled client's wall is
3251 ms and its CPU time is 3219 ms — 99.0% of one core, 32 ms of idle in
the whole phase. The fake server costs 4291 Mcycles under the compiled
client and 4171 under node, a 1.03x difference: the server is not the
gap either.

The gap is that **the compiled binary is single-threaded and node is not.**

| phase | node cores | compiled cores | wall x |
|---|---|---|---|
| buildContacts | 0.14 | 0.12 | 1.03 |
| buildGroups   | 0.15 | 0.13 | 1.00 |
| send_1to1     | 1.51 | 0.99 | 1.26 |
| recv_1to1     | 0.46 | 0.43 | 1.01 |
| send_group    | 1.33 | 0.99 | 3.05 |
| recv_group    | 0.47 | 0.46 | 1.09 |

`cores` is `cpu_ms / wall_ms`. The compiled arm never exceeds 0.995 in any
phase of any run. The two phases where node exceeds 1.0 are exactly the two
phases the compiled binary loses; the four where node stays under 1.0 are
at 1.00-1.09x. Since `wall = cycles / (clock x cores)`, the identity

    wall_ratio = cycle_ratio / (cores_ratio x clock_ratio)

closes to three decimals on every row — 1.258 measured against 1.258
predicted for `send_1to1`, 3.045 against 3.044 for `send_group`. The two
instruments are independent (`QueryProcessCycleTime` for cycles,
`GetProcessTimes` for CPU time) and agree on an effective clock of
3.45-3.65 GHz across every arm, so `cores` is not an artefact of either.

The direct control: the same node, the same work, `--single-threaded`.
`send_1to1` goes 2521 -> 3161 ms and 1.57 -> 1.22 cores, and the compiled
arm's ratio against it falls from 1.29x to **1.03x**.

## The one thing it cannot see

Client-side socket operations. During `send_1to1` the client's
`ioRead`/`ioWrite`/`ioOther` read 0-5 on **both** lanes while the server
registers 1,906 (node client) and 3,456 (compiled client) — the OS does not
attribute inline-completing overlapped socket I/O to the issuing process.
So the server-side count is the only usable read/write-pattern instrument
here, and by it the compiled client provokes 1.81x the socket operations
for the same messages. That is real and unexplained; it is not what costs
the wall, because the server absorbs it at 36% of one core.
