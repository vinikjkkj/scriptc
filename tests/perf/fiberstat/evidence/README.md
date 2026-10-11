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
