# Park-table evidence, `6bc2848a9`, 2026-10-10

Raw `SCR_FIBERSTAT_OUT` files behind `docs/stackless-frame-contract.md` 6a.5.
Every one was written by the `_Exit` interposer in `scr_fiber_stat.h` on
app182's `/shutdown` route (`via=_Exit` on the header line): `process.exit`
lowers to `_Exit`, so an atexit-only report would be blank on all seven.

| file | arm | phase |
|---|---|---|
| `c01-on-boot.txt` | stackless | boot, no requests |
| `c02-on-threads20.txt` | stackless | `/s/alpha/store/threads?limit=20`, C=64 |
| `c03-on-health.txt` | stackless | `/health`, C=64 |
| `c04-on-teardown.txt` | stackless | one `/sessions/create` + `/sessions/remove` |
| `c05-off-boot.txt` | fiber | boot, no requests |
| `c06-off-threads20.txt` | fiber | `/s/alpha/store/threads?limit=20`, C=64 |
| `c07-off-teardown.txt` | fiber | one `/sessions/create` + `/sessions/remove` |
| `probe-control.txt` | n/a | `parkprobe.exe`, the positive control |
| `c08-off-historysync.txt` | fiber | history sync, 8x400x6 |
| `c09-on-historysync.txt` | stackless | history sync, 8x400x6 |
| `c10-off-historysync-min.txt` | fiber | history sync, 1x1x1 (the baseline to subtract) |
| `c11-on-historysync-min.txt` | stackless | history sync, 1x1x1 |
| `c12-off-historysync-pool0.txt` | fiber | history sync, 8x400x6, `SCR_FIBER_POOL=0` |
| `matrix.jsonl` | both | one row per cell, with the load result |

Columns: `spawns` is `scr_async_spawn`/`scr_gen_new` calls carrying that
entry, `parkIn`/`parkHi` the `scr_await_park` count and its exact high-water,
`yieldIn`/`yieldHi` the same for the one-turn microtask hop. The table has NO
RESET, so each file is cumulative over its whole process and a per-phase
figure is a subtraction across cells -- which is why boot is its own cell.

Entries are POINTERS: the emitted entries are `define internal` on the LLVM
lane and cannot be declared from a header. Attribution on the stackless arm is
by workload instead, and it is exact there because the artifact holds only two
`scr_async_spawn` entries and only one of them can run with no session being
destroyed. On the FIBER arm there are 1,487 and no attribution is claimed;
that arm is here as the control that the counter reads non-zero under this
load, which it does -- 315 suspended at once on the same route and the same
62.9 in-flight where the stackless arm reads nothing at all.

`c07` overflowed the 64-entry table by 36, so its entry count is a floor. The
stackless arm never exceeded one entry.

## The history-sync cells, added 2026-10-11 at `3c462de14`

`c01`-`c07` are all boot, HTTP route or teardown, and on every one of them
`ZAPO_AUTOCONNECT=0` leaves `ProtoStreamReader.ensure` structurally
unreachable. `c08`-`c12` are the gap that left: the `memrig.mts` history-sync
workload (`CHUNKS=8 CONVS=400 MSGS=6 TEXTLEN=300 ROUNDS=1 IDLE_S=60`), where
the fake WhatsApp server delivers real decrypted notifications and the path IS
reached. Written by the same `_Exit` interposer on the same `/shutdown` route.
Read them with `docs/stackless-frame-contract.md` 6a.6, which scores them
against the peak-private-commit table measured on the same two binaries.

The short version: the fiber arm holds **20,256** frames suspended at the same
instant and the stackless arm holds **14**, and the 14 scale with CHUNKS
rather than with the 19,200 messages those chunks carry. `c10`/`c11` are the
minimal-load baseline the cumulative table needs for a subtraction, and `c12`
is the pool control: `SCR_FIBER_POOL=0` must zero `poolHi` and push `fresh`
above `outHi`, and it does (4,096 -> 0, 42,434 -> 166,381).
