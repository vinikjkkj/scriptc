# wamfix binaries — keep these, the user runs them

Block `wamfix`, branch `block/wamfix`, base main `70e1fe48`.
Built on win32 x86_64 with `zig 0.16.0` (`<zapo-work>\tools\zig`, ahead of
chocolatey's 0.15.2), `SCRIPTC_CC=zigcc`, `SCRIPTC_TARGET=x86_64-windows-gnu`,
`SCRIPTC_GENERIC_SLOT=1`. Compiler built under node **v22.18.0**; every oracle
run is node **v25.9.0** (`<home>\AppData\Local\nvm\v25.9.0`), which
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
| `wam-entry2-be.c.exe` (C) | `--provenance-sources --best-effort`, **`SCRIPTC_PROVENANCE_AUTHORED_JS=1`** | **26,464,256** | node v25.9.0 | **WRONG when built, 2026-08-30 — exits `0xC0000005`, prints nothing. THE DEFECT IS FIXED; see below** |
| `wawam-min.c.exe` (C) | `--provenance-sources`, **`SCRIPTC_PROVENANCE_AUTHORED_JS=1`** | **657,408** | node v25.9.0 | **WRONG when built, 2026-08-30 — `protocol=0` where node prints `5`, then `0xC0000005`. THE DEFECT IS FIXED; see below** |

The two `wam-wire-probe2` binaries are the floor and they pass. The other two
were kept as the reproduction of a defect that was open when this file was
written. **That defect is closed — see the section immediately below, added
2026-09-07. The two binaries on disk are historical artifacts of a compiler
that no longer exists.**

## CLOSED 2026-09-07 — the two WRONG rows above no longer reproduce

Block `wamcoord`, main `83432479`. The same probe source, rebuilt strict
(**no `--best-effort`**), `--backend c`, zig 0.16.0, oracle node v25.9.0:

```
protocol=5          <- node prints 5; this binary now prints 5
wire.regular=0
wire.private=2
CHAT_OPEN=3
LT128=3
WAWAM-MIN: reached the end
```

    BUILD rc=0   0 error sites   BINARY 2,701,824 B   RUN exit=0   88 B stdout
    ORACLE: MATCH (byte-exact)
    fences: 0 over 11,044,135 bytes of emitted C
    engine scan: quickjs=0 ScrDyn=0 JS_NewRuntime=0

What the rebuild showed: the `protocol=0` / `0xC0000005` pair was **one bug,
and it was an edge dropped at RESOLUTION**, not the twin-init redirect this
file's diagnosis pointed at. `orderedImportsOf` resolved the bare specifier
through `resolveProjectImportSf7`, which answered null for any
declaration-file resolution, so the module header saw `dep=null` and emitted
no init call at all — the twin's init function was defined and never called,
which is exactly the `sc_f__x25_init_0` symptom recorded below. Both halves
landed before main `3f3dd523` (`program.ts` `resolveProjectImportSf7`; the
three-valued binding kind in `lower-modules.ts`), and `7eca1660` corrected
`provenance.ts`'s own note. Nothing in the test suite covered any of it, which
is why the fix sat unnoticed behind a flag for a week;
`tests/harness/provenance-authored-js.test.ts` now does, and asserts this
`protocol=5` read specifically.

The mapping is no longer a boolean flag either. It is a whitelist,
`AUTHORED_JS_DEFAULT_PACKAGES`, and `@vinikjkkj/wa-wam` ships on it — so the
probe above builds correctly with **no environment variable set at all**.

Full measurement, both lanes and the published package: `tests/perf/wamcoord`.

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

**The two wrong binaries cannot be reproduced at all any more** — not by a
default build and not by any flag. When this file was written the mapping was
off unless `SCRIPTC_PROVENANCE_AUTHORED_JS=1` was set (commit `b93ea18a`); it
is now on by default for `@vinikjkkj/wa-wam` and the binary it produces is
byte-exact against node.

See `<zapo-work>\estado-wamfix.md` for the full numbers and the diagnosis.

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
