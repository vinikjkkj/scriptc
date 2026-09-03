# elemcost — what ONE typed-array element access costs, in cycles

`bytes[i]` lowers to `scr_bytes_get_inl` / `scr_bytes_set_inl`
(scr_runtime.h), and on the LLVM lane to their out-of-line faces
`scr_bytes_get_fast` / `scr_bytes_set_fast`. The phase-scoped sampler gives
those a SHARE of `send_group`; `tests/perf/arrcensus` gives a COUNT and, since
the element-kind split was added, a KIND. Neither gives a per-access COST, and
a per-call change has to be priced as `count x per-access delta` before it is
worth building.

This measures the delta. It links against the **shipping `scr_bytes.o`**,
compiled unmodified from `packages/runtime/src`, so the arm under test is
chosen by the object file and not by anything this program can see — build it
twice, once with the switch and once without, and interleave the two binaries.

It replays the sequence the emitter actually writes, read out of
`messaging.bench.ll`:

    %t1 = call ptr    @scr_bytes_retain_v(ptr %t0)
    %t2 = call double @scr_bytes_get_fast(ptr %t1, double %i)
           call void  @scr_bytes_release(ptr %t1)

so the refcount round trip is measured in place rather than assumed away.
Indices come out of MEMORY, because a visible loop counter lets the compiler
fold the index window away and the emitted program's index is never visible.

## Build and run

    cd packages/runtime/src
    zig cc -O2 -c -target x86_64-windows-gnu -I. scr_bytes.c -o /tmp/bytes_on.o
    zig cc -O2 -c -target x86_64-windows-gnu -I. -DSCR_NO_F64ARM scr_bytes.c -o /tmp/bytes_off.o
    cd <this dir>
    zig cc -O2 -target x86_64-windows-gnu -o on.exe  elemprobe.c /tmp/bytes_on.o  stubs.c
    zig cc -O2 -target x86_64-windows-gnu -o off.exe elemprobe.c /tmp/bytes_off.o stubs.c
    for i in 1 2 3; do ./off.exe 8000000 OFF; ./on.exe 8000000 ON; done

`stubs.c` supplies the six runtime symbols `scr_bytes.c` references and this
harness never reaches (`scr_trap`, `scr_trap_fmt`, `scr_throw_error_msg`,
`scr_throw_error_msg_code`, `scr_f64_to_str`, `scr_str_new`,
`scr_str_utf16_len`). Every one of them aborts, so a probe that ever took a
trap path would die rather than report a number.

The first arm is repeated LAST as an A/A control; the printed drift is the
noise floor for the run and every reading below should be read against it.

## What it read on 2026-09-03 (AMD Ryzen 5 5500, zig 0.16.0,
## x86_64-windows-gnu, three interleaved runs each, A/A drift under 0.9%)

| arm                                | u8-only | + f64 arm |
| ---------------------------------- | ------- | --------- |
| f64 read, full emitted sequence    | 18.12   | 13.77     |
| f64 read, `get_fast` alone         | 11.25   | 6.89      |
| f64 write, full emitted sequence   | 20.71   | 13.77     |
| u8 read, full emitted sequence     | 12.91   | 14.59     |
| retain + release, no access        |  8.58   |  7.77     |

Two things to carry forward from that table.

**It UNDER-predicts the real phase.** Scaled by the census
(311.5M f64 reads, 164.7M f64 writes, 32.4M u8 accesses in `send_group`) the
three deltas predict a 2444 Mcyc saving; the real bench measured 3400. The
tight loop here keeps `scr_bytes_get` in L1i, and 476M tail-calls into it in
the real program do not. Treat any number from here as a LOWER bound.

**Half of what is left is the refcount round trip.** After the f64 arm an f64
read is 13.77 cycles, of which `retain_v` + `release` on the receiver is about
6.9 — and in `messaging.bench.ll` 119 of 202 `get_fast` sites and 99 of 173
`set_fast` sites are literally `retain_v; get_fast; release` around a receiver
that is a plain local slot holding a +1 reference for the whole function. The
phase-scoped sampler agrees from the other side: `scr_bytes_retain_v` 4.70%
plus `scr_bytes_release` 5.91% of `send_group`, against 14.81% in the two
accessors. Eliding the pair where the emitter can prove the receiver's slot
outlives the call is worth roughly another 3.3 Gcyc of a 32 Gcyc phase — that
is a claim about size, priced here, and not yet a measurement of a change.
