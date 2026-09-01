# block/wrtcjoin — what the join costs a linked binary

Recipe: the harness's own, `--backend c`, plain (non-ASan), the exact two
sources `island.test.ts` and `regex.test.ts` build. `measure.sh` is the runner,
`pesec.mjs` reads PE section sizes out of the headers (no objdump on this host).

## Neither recorded class moves — in either win32 configuration

A/B on ONE tree, one install, one zig cache, `scr_async.c` + `scr_runtime.h`
swapped to `c16b2b2d` as the only variable.

|              | SCRIPTC_TARGET=x86_64-windows-gnu | unset (native) |
| ---          | ---                               | ---            |
| static base  | 657,408                           | 664,576        |
| static HEAD  | **657,408**                       | **664,576**    |
| regex base   | 799,232                           | 806,912        |
| regex HEAD   | **799,232**                       | **806,912**    |

Cross column re-run: byte-stable. `STATIC_CLASS_RECORDED` 657,408 and
`REGEX_CLASS_RECORDED` 795,648 are **not moved**, because nothing moved them.

`scr_async.c`'s object DID grow — 202,837 -> 203,722 (+885, +0.44%) — and 885
bytes fit inside both programs' existing file-alignment padding.

## Positive control, because a zero looks exactly like a stale cache

A referenced `volatile unsigned char [8192]` planted in `scr_async.c`:

    static 657,408 -> 666,112  (+8,704)
    regex  799,232 -> 807,424  (+8,192)

The pipeline recompiles and the scale responds. The zero above is a
measurement.

## The premise I was given is wrong, and the measurement says how

> the link line has no `--gc-sections`, so `scr_wrtc_conn.c` lands in every
> binary whether a program touches WebRTC or not

It does not. The gate is in `cc.ts` at the **link line**, not at dead-strip:
`...(wrtc ? [scr_wrtc.c, scr_wrtc_conn.c, scr_wrtc_cert.c, scr_wrtc_fp.c,
scr_sctp.c, scr_sctp_assoc.c] : [])` plus the mbedTLS archive. A program with
no peer connection never COMPILES those TUs, which is a stronger gate than
dead-strip and one `--gc-sections` never enters into.

Measured both ways rather than argued:

| string scan     | hello-world | WebRTC program |
| ---             | ---         | ---            |
| `mbedtls`       | 0           | 9              |
| `RTCDataChannel`| 0           | 1              |
| `ice-ufrag`     | 0           | 3              |

## What it costs where it DOES land

657,408 -> 1,490,944, attributed by section:

    section            A           B         B-A
    .buildid         512         512           0
    .data            512        3584       +3072
    .pdata         23552       46592      +23040
    .rdata        109568      341504     +231936
    .reloc          1024        4096       +3072
    .text         520704     1093120     +572416
    .tls             512         512           0
    TOTAL raw     656384     1489920     +833536

mbedTLS's ECDSA P-256 / AES-GCM / SHA-2 / X.509 / DTLS state machine and its
constant tables.

## RSS, since the ~20 MB target is now known to be image-driven

Polled `WorkingSet64` to exit (sample counts given so an empty poll cannot be
mistaken for a zero):

| run                                        | samples | peak WorkingSet |
| ---                                        | ---     | ---             |
| full live path (handshake, association, channel open, send, receive) | 3,387 | **6,955,008 B = 6.63 MB** |
| same binary, no peer answering             | 3,246   | 6,082,560 B = 5.80 MB |

So the established DTLS session + SCTP association + open channel is
**~0.83 MB resident**, and the whole WebRTC path peaks at about a third of a
20 MB budget.

Peak RSS of the hello-world is **unmeasured**, not zero: it exits faster than
the poller can sample, and `PeakWorkingSet64` read after exit returns 0 for
every program — which is exactly the false zero to avoid reporting.

## The configurations have swapped, and that is the finding for the fleet

`size-class.ts`'s 2026-08-31 entry says the recorded pair tracks the NATIVE
build and reads 15,872/17,408 low under the cross target. Today:

    cross   657,408 (EXACT)  and 799,232 (+3,584, 0.88 page)  -> green
    native  664,576 (+7,168) and 806,912 (+11,264)            -> RED

Identical at base and at HEAD, so it is drift from intervening merges and
belongs to nobody here. No anchor moved — moving one would break the other
configuration, the same conclusion that entry reached from the opposite side.
A brief that pins `SCRIPTC_TARGET` now gets the GREEN column.

`tests/harness/size-class-armed.test.ts` and `tests/harness/regex.test.ts`
both PASS under the pinned target.

**The regex class has 512 bytes of headroom under the cross target, and the
file-alignment quantum IS 512.** The next always-linked byte tips it. Nothing
here spent that headroom, and nothing here leaves any either.
