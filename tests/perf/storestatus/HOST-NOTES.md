# Host state while these numbers were taken, and what it does and does not affect

## The throttle, 2026-09-08 ~11:49

Four blocks were running on a six-core box and free RAM reached **3.2 GB of
40**. This block was the largest consumer, so it serialised: from that point
**one measurement process at a time**.

What was running when the instruction arrived, and what happened to it:

| job | state | disposition |
| --- | --- | --- |
| `bd-c-sqlite` (build, `--backend c`) | in `zig cc`, furthest along | **kept** — the only survivor |
| `an-b-redis` (bare-lane analyse) | ~15 min in, no result yet | **killed**, re-run later, serially |
| `an-b-sqlite` (bare-lane analyse) | ~15 min in, no result yet | **killed**, re-run later, serially |

Process accounting was done with `Get-CimInstance Win32_Process`, not `ps`.
The count went 33 → 11 and free RAM 4.95 → 8.14 GB. Nine of the eleven
survivors are 6–17 MB shell and `zig` wrappers; the one real consumer was the
build's compiler process at 2.1 GB.

**Each `analyze()` pass costs about 1.9 GB, not 1 GB** — the node process
peaked near 850 MB and it spawns a native `tsc.exe` child of a further
1.0–1.1 GB that a node-only process scan does not see. Two concurrent analyses
plus a build is therefore ~6 GB, which is what made this block the lever.

## What this does and does not invalidate

**Unaffected — every number in this survey.** Site counts, blocker counts,
roots-vs-cascade splits, message clusters, by-file and by-owner distributions
and binary sizes are load-independent. They are properties of the compiler and
the program, not of the box.

**Affected — every elapsed time.** The `ms=` and `Ns` figures recorded today
are **contended floors on a loaded six-core box**, not measurements:
`store-redis` analysed in 554 s alone and `store-mysql` in 668 s with two other
heavy jobs beside it. No timing in this document may be quoted as a cost.

**And a build failure would be suspect before the compiler was.** No build in
this survey failed for want of memory; where a build exits non-zero the log
carries the compiler's own `N errors.` line and the diagnostics behind it, and
that is what is quoted.

## The false zero a killed run leaves behind

`an-b-sqlite` was killed mid-run. Its `sites.mjs` record still reached disk,
and it reads:

```
BLOCKER SITES=0  (roots=0  cascade/SC2004=0)   distinct messages=0
```

— a clean, entirely convincing zero for a package that has never compiled. The
only thing separating it from a real zero is the state on the line above:

```
=== b-store-sqlite  [CRASHED]  ms=219760  CRASHED=EPIPE: broken pipe, write
```

The record is kept as `sites/_void-killed-b-store-sqlite.json` rather than
deleted, because it is the exhibit: **a count is only readable next to its
state.** `harness/tally.mjs` prints the state first for this reason, and
`sites.mjs` writes `crashed` rather than an empty success.
