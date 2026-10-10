# mediavoip — static-lane survey of three zapo packages

A **measurement** harness, not a fix. It answers, for `@zapo-js/media-utils`,
`@zapo-js/voip` and `@zapo-js/wam`: how far does the static lane get, what
exactly refuses, and how many call sites does each distinct refusal own.

Nothing here runs in the gate. `tests/perf/` is excluded from the directory
gate and no vitest file imports any of it.

## Why a harness and not `scriptc coverage`

`scriptc coverage` renders blockers grouped by code and message but prints no
file or line, so the same message from twenty sites and from one site look the
same in a sweep. `harness/sites.mjs` calls the compiler's `analyze()` directly
and dumps **every** site as JSON with `code`, `message`, `file` and `line`.
`harness/rank.py` then dedupes by `(file, line, code, message)` — without that
dedupe a module pulled in by eight entries counts its sites eight times.

## Layout

| path | what |
| --- | --- |
| `harness/env.sh` | the block's environment (zig 0.16, `SCRIPTC_CC=zigcc`, per-block caches) |
| `harness/sites.mjs` | one `analyze()`, every coverage site to JSON with file+line |
| `harness/sweep2.sh` | per-module sweep over the three package trees, one lock per output dir |
| `harness/rank.py` | dedupe by site, rank distinct causes by call sites |
| `harness/sc1090.py` | split one diagnostic code into its distinct message variants |
| `harness/revalidate.sh` | self-test for a **`scriptc coverage` `*.log` sweep**, not for `sweep2.sh`: a log naming neither "statements analyzed" nor "not analyzable" is DID-NOT-REPORT, not "no diagnostics" — re-runs those. Refuses on zero logs examined. See the CORRECTED note under "Reproducing" |
| `sites-default/*.json` | the recorded default-lane result, 40 modules |
| `drivers/*.ts` | the probes each finding rests on |

## The probes

| driver | what it establishes |
| --- | --- |
| `wam-wire.ts` | the WAM TLV encoder against zapo's own `wire.test.ts` byte oracle |
| `wam-wire-probe.ts` | the same, over copies with the two npm-island causes removed — 14 build errors become 1 |
| `wawam-values.ts` / `wawam-type.ts` | `--npm-static` on a 28k-line generated table: value-only imports compile 100%, adding one `type` import sends the whole package to the island |
| `cascade-a.ts` / `cascade-b.ts` | a class field typed by an island package makes every call of the class's generic methods refuse; the identical class with a local type is clean |
| `net-probe.ts` / `net-probe2.ts` | `node:dgram` compiles and runs statically (C backend); `net.isIPv6` has no lowering |
| `hang-a.ts` | `--provenance-sources` over a value import of `zapo-js`: 23m21s for a two-line program |

## Reproducing

The sweep needs a lab app outside the repo holding the three package sources
plus their installed dependencies (`zapo-js`, `@types/node`, `sharp`,
`file-type`, `@roamhq/wrtc`, `libmlow-wasm`, `@vinikjkkj/wa-wam`).

```sh
. harness/env.sh
bash harness/sweep2.sh "$LAB/sites-default"      # default static lane
python ../mediavoip-remeasure/harness/selftest.py "$LAB/sites-default"
python harness/rank.py "$LAB/sites-default"
python harness/sc1090.py "$LAB/sites-default" SC1090
```

A self-test is not optional. During this survey two concurrent sweeps raced on
the same output directory and produced a 27-byte log — a coverage run that
exits 0 having written nothing is indistinguishable from a clean module unless
something checks.

> ### CORRECTED: this recipe named the wrong self-test, and the named one could not pass
>
> The second line above used to read
> `bash harness/revalidate.sh "$LAB/sites-default"  # must report 0 invalid`.
> **On a `sweep2.sh` output directory that criterion was unsatisfiable, so the
> instruction could never have been followed as written.** `revalidate.sh`
> globs `$OUT/*.log` and tests each log for "statements analyzed" or "not
> analyzable", both emitted by the `scriptc coverage` reporter.
> `sweep2.sh` runs `sites.mjs` and writes `$OUT/$tag.txt` with a `sites=`
> line and neither string. With no `*.log` present and no `nullglob`, the
> glob stayed literal, the loop body ran once on a path that does not exist,
> and the script printed `1 invalid log(s)` for any sweep2 directory.
>
> **The wrong half was the pairing, not the whole script.** Measured over a
> fixture built from the reporter's real output text: on a genuine `*.log`
> directory the old script reported `0 invalid` and on the same directory
> plus one planted 27-byte log it reported `1 invalid` — so it was never
> unconditionally broken, and the claim that it could *never* report clean is
> true only of the directory this recipe pointed it at.
>
> **A second defect, independent and not previously recorded: it exited 0
> whether or not it found anything.** In the fixture the old script exited 0
> on the arm where it printed `1 invalid`, so any caller chaining
> `revalidate.sh && rank.py` ran on past a failed self-test. It now exits 0
> clean, 1 invalid-found, 2 nothing-examined.
>
> `revalidate.sh` is kept and repaired rather than deleted, because
> `harness/table.py` parses the same `*.log` family and the
> `scriptc coverage` sweep that produces it is a real lane. The guard added
> there deliberately **refuses** on zero logs examined instead of passing:
> guarding the glob alone would have turned "always 1 invalid" into "always 0
> invalid", which is the worse failure — a check built to catch a false clean
> that is itself clean by construction.
>
> **What this does to the recorded numbers: they are unverified, not wrong.**
> The `sites-default/` result and the 33-causes / 234-unique-sites figure that
> `../mediavoip-remeasure/README.md` quotes from it were produced by a sweep
> whose self-test could not have passed, so nothing here has been shown to be
> a false clean — it has only never been checked. `mediavoip-remeasure`
> re-ran the same corpus with `selftest.py` and its two armed controls; that
> directory, not this one, is where a checked number lives.
>
> Nothing else in this file was audited. Sections not named in this note are
> **not** thereby correct, only unexamined.
