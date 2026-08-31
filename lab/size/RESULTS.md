# The two size floors: attribution

Measured on ONE tree with the CLI (size-class.ts records the CLI as
agreeing with the harness to the byte), `git checkout <rev> -- packages/
{compiler,runtime}/src` between columns so the install, caches, toolchain
and every other source file are held fixed.

| program | recorded | base `e361d31d` | this branch | mine |
| --- | --- | --- | --- | --- |
| static hello-world | 653,312 | **656,896** | 657,408 | **+512** |
| regex program | 795,648 | **798,208** | 798,720 | **+512** |

Base `e361d31d` is already **3,584 bytes over the recorded static anchor
and 2,560 over the regex one**, before this branch compiles a line. The
tolerance is one 4,096-byte page. 3,584 + 512 = 4,096 — the complaint
fires on the byte, and **seven eighths of it is drift that was already
there.** That is the fifth recalibration in a row reached mostly by drift,
and this file has now said so five times.

The orchestrator's gate of `e361d31d` was green because 3,584 < 4,096.
Both figures are true.

## The class distance is byte-identical

    base    798,208 - 656,896 = 141,312
    branch  798,720 - 657,408 = 141,312

Both classes pay the same 512, which is size-class.ts's own standing test
for "runtime-core cost, not a library link". Nothing new is being linked;
an always-linked TU got slightly larger.

## Where the 512 went, and why it is now zero

Not `BYTES_ELEM_SIZE` and not `BYTES_ELEM_NUM`. Both are compiler-side
TypeScript and never reach a program: the hello-world's emitted TU is
3,316 bytes and names **no** bytes symbol at all (`grep -c
'scr_bytes|BYTES_ELEM|I16|U16' static.ll` -> 0). The bytes were entirely
`packages/runtime/src/scr_bytes.c`, which is in `RUNTIME_SOURCES`
(cc.ts:11) and therefore linked into every binary, on a link line with no
`-ffunction-sections` and no `--gc-sections` (cc.ts:423).

Two edits, both in that TU, gave the page back:

| | static | regex |
| --- | --- | --- |
| base `e361d31d` | 656,896 | 798,208 |
| branch, first draft | 657,408 | 798,720 |
| **branch, shipped** | **656,896** | **798,208** |

- `scr_bytes_elem_size` is a 16-entry `static const` table indexed by the
  enum instead of a chain of six comparisons. The table pays for the two
  new element kinds and the rest of the chain besides.
- the two 16-bit read arms became one: a single load, and only the
  reinterpretation differs — the shape the store arm already had.

The index is masked (`& 15u`) against a padded table rather than left
unchecked: a garbage element size is a garbage *allocation* size, which is
worse than the 4 the old chain fell through to. The mask is one
instruction and the padding is seven bytes of `.rodata`; both measurements
are byte-identical with and without it.

## What the orchestrator should know

**This branch no longer moves either floor.** But base `e361d31d` sits
3,584 bytes into a 4,096-byte tolerance, so **the next change to land that
costs 512 bytes turns both floors red**, and the failure will name that
change while seven eighths of the number belongs to everyone before it.
Recalibrating is a deliberate decision, so this block has not touched
`STATIC_CLASS_RECORDED` or `REGEX_CLASS_RECORDED`.

## The coverage timeout is contention, and one sample nearly said otherwise

`every corpus program is 100% static` timed out at 603,381 ms inside the
full sweep, as it did before the rebase (602,305 ms). Run alone it passes.
Four uncontended samples, same host, same 600,000 ms limit:

| compiler | corpus | ms |
| --- | --- | --- |
| base `e361d31d` | base | 275,798 |
| branch | base (my 3 held out) | 269,539 |
| branch | branch | **335,656** |
| branch | branch (second sample) | **269,288** |

The 335,656 was a single noisy sample and it is the only reason this
section exists: taken alone it reads as a 21.7% regression from three
added programs, which would have been a false finding reported with a
number attached. Re-running the same configuration gives 269,288 — inside
the 6,259 ms spread the two base-corpus rows already showed. Measured
individually through the CLI, the three new programs cost 990/1,016/941 ms
against 1,022 ms for `1400-typedarray-basics` and 1,020 ms for
`2625-bytes-views`: entirely ordinary, and nowhere near the 20 s each the
outlier implied.

So: the branch does not move this test, and the timeout is what the fleet
brief already calls it — a contended long pole, ~269 s alone against a
600 s limit, which exceeds the limit when it runs beside both differential
suites.

## Re-measured on `003a7177`, and the two classes parted

Main moved again (three stdlib surfaces). Re-weighed, two samples of base
and three of the branch, all reproducible to the byte:

| program | recorded | base `003a7177` | branch | delta |
| --- | --- | --- | --- | --- |
| static hello-world | 653,312 | 656,896 | **656,896** | **0** |
| regex program | 795,648 | 798,208 | **798,720** | **+512** |

The static class is still byte-identical. The regex class is **+512**, and
this is exactly the parting size-class.ts warns about — "the two classes
have parted by 512 bytes before, so deriving either from the other would
have been 1,024 bytes wrong". Both floors are GREEN: the regex figure is
3,072 over its recorded anchor against a 4,096-byte tolerance, so 1,024 of
headroom remains.

### It is not code growth. Section-level, on the two regex binaries:

| section | base | branch | delta |
| --- | --- | --- | --- |
| `.text` | 606,598 | 606,598 | **0** |
| `.rdata` | 161,792 | 161,840 | **+48** |
| everything else | — | — | 0 (`.buildid` +2, the hash) |

`scr_bytes.o`'s own `.text` is 24,953 -> 24,969, **+16 bytes** for two new
element kinds — the table paid for essentially the whole comparison chain
it replaced. The linked `.text` does not move at all.

The `.rdata` +48 is the unavoidable part: two new `case` labels in each of
three switches add jump-table entries (24 bytes), plus the 16-byte size
table, plus alignment. **The +512 is those 48 bytes crossing a 512-byte
file-alignment boundary in the regex binary and not in the static one** —
which is why the same source change measures 0 in one class and 512 in the
other. Chasing it would mean shaving the 7 bytes of table padding that
keeps the index in bounds, and an element size is an allocation size; the
padding stays.
