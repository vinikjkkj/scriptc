# wamfix binaries — keep these, the user runs them

Block `wamfix`, branch `block/wamfix`, base main `70e1fe48`.
Built on win32 x86_64 with `zig 0.16.0` (`G:\zapo-work\tools\zig`, ahead of
chocolatey's 0.15.2), `SCRIPTC_CC=zigcc`, `SCRIPTC_TARGET=x86_64-windows-gnu`,
`SCRIPTC_GENERIC_SLOT=1`. Compiler built under node **v22.18.0**; every oracle
run is node **v25.9.0** (`C:\Users\vinicius\AppData\Local\nvm\v25.9.0`), which
is NOT the node on PATH.

`--dynamic` was never passed to anything here. Every binary was scanned for the
two markers that actually discriminate an embedded engine — `quickjs` and
`ScrDyn` — and both read **0** in all of them.

## Running them

Each `NAME.exe` is the LLVM backend and each `NAME.c.exe` is the C backend of
the same program. They take no arguments and print to stdout. Beside each one:

| file | what it is |
| --- | --- |
| `NAME.exe` / `NAME.c.exe` | the binaries, LLVM and C backends |
| `NAME.llvm.out` / `NAME.c.out` | what each binary printed |
| `NAME.node.out` | what node v25.9.0 printed from the SAME source — the oracle |
| `NAME.build-llvm.log` / `NAME.build-c.log` | the build, including provenance notes |
| `NAME.c` | the emitted C, kept so the `[SCxxxx]` runtime-fence count is auditable |

A binary is MATCH when its `.out` is **byte-identical** to `NAME.node.out`.
Check with `diff`, not by eye.

## The binaries

| binary | lane | bytes | oracle | verdict |
| --- | --- | --- | --- | --- |
| `wam-wire-probe2.exe` (LLVM) | `--provenance-sources --npm-static '@vinikjkkj/wa-wam'` | **2,812,416** | `wire.test.ts` | **14/14 byte-exact, exit 0** |
| `wam-wire-probe2.c.exe` (C) | same | **2,871,808** | same | **14/14 byte-exact, exit 0** |
| `wam-entry2-be.c.exe` (C) | `--provenance-sources --best-effort`, **`SCRIPTC_PROVENANCE_AUTHORED_JS=1`** | **26,464,256** | node v25.9.0 | **WRONG — exits `0xC0000005`, prints nothing** |
| `wawam-min.c.exe` (C) | `--provenance-sources`, **`SCRIPTC_PROVENANCE_AUTHORED_JS=1`** | **657,408** | node v25.9.0 | **WRONG — prints `protocol=0` where node prints `5`, then `0xC0000005`** |

The two `wam-wire-probe2` binaries are the floor and they pass. **The other two
are kept because they are the evidence for an open defect, not because they
work.** Do not treat them as deliverables — they are the reproduction.

`wam-entry2.c` (141,409,061 bytes) is the emitted C for the entry, kept for the
same reason: it is what a `0xC0000005` with no output looks like from the
compiler's side. **`sc_f__x25_init_0` in it is the function that is defined and
never called** — `main` calls `sc_f__x25_main`, which calls only
`sc_f__x25_init_2`. `wawam-min.c` (11,044,420 bytes) is the same defect in a
file small enough to read.

The LLVM lane's `wam-entry2.ll` measured **205,596,457 bytes**; it is NOT kept —
a later build in the same output directory removed it. The number is a
measurement in this README, not a file on disk. Regenerate it with the same
command and `--backend llvm` if it is needed.

**The two wrong binaries cannot be produced by a default build.** The mapping
that creates them is off unless `SCRIPTC_PROVENANCE_AUTHORED_JS=1` is set
(commit `b93ea18a`).

See `G:\zapo-work\estado-wamfix.md` for the full numbers and the diagnosis.

## Two things to know before trusting a green run here

**The attested `@vinikjkkj/wa-wam` source tree is not the published artifact.**
Installed is `2.3000.1041713829-1ec0d3b`; the tree fetched at the attested
commit `1ec0d3b91d0e` carries the previous day's table
(`2.3000.1041627196`). The difference is 49 lines and every one is
**additive** — one new enum table (`CA2D_EXTENSION_CONNECTION_STATE`), one new
member each in `BANNER_TYPES`, `MEDIA_PICKER_ORIGIN_TYPE`, `MEDIA_TYPE`,
`PTT_MESSAGE_USER_JOURNEY_ACTION`, `PTT_MESSAGE_USER_JOURNEY_STAGE` and
`SURFACE_TYPE`, two in `PAYMENT_ACTION_TARGETS`, twelve new fields on the
`Call` event and one (`isScheduled`) on `MessageSend`.

Nothing that already existed changed value. So under `--provenance-sources` a
driver reading only pre-existing keys agrees with node **automatically** — the
green is the default, not something the driver earned. Only a driver naming one
of the new identifiers can go red. Read any wa-wam oracle result here with that
in mind.

**`--best-effort` was not used for any binary here**, deliberately: it turns a
statement with no static lowering into a runtime throw, so a site census taken
with it can read zero while the binary is full of throwing fences. Where a
count appears in the report it names the flag that produced it.
