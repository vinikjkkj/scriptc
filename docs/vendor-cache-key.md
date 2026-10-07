# The vendored-object cache key, what it misses, and what fixing it costs

DESIGN ONLY. No build change is proposed for today. The point of writing it
now is that the cost is named before anyone decides.

Prompted by another block finding `libregexp.o` and `libunicode.o` in
`packages/runtime/vendor/.cache` built eleven hours apart **under an
identical cache key**, the fresh object carrying `clang version 21.1.0` and
a `.debug$S` section and the stale one carrying neither.

## 1. Two guards that do not cover this

- **Asserting `zig version` protects what you COMPILE, not what a cache
  already holds.** A run can assert the toolchain correctly and still link
  an object built by a different one.
- **`vendor/.cache` is gitignored**, so `git status`, the gate's
  dirty-worktree guard and `treehash` are all blind to it. A run can be
  "clean tree, pinned lane, treehash checked" and still link a foreign
  object. A treehash stable across six runs does not exclude it.

## 2. What is in the key today, read from source

`packages/compiler/src/backend/cc.ts`:

| unit | source identity | sanitize | DRIVER IDENTITY | target | prof |
|---|---|---|---|---|---|
| engine archive `libqjs.a` (:879) | `QJS_COMMIT[0:12]` | yes | **none** | yes | yes |
| lre objects (:1017) | `QJS_COMMIT[0:12]` | yes | **1 bit** | yes | yes |
| zlib objects (:1085) | `ZLIB_VERSION` | yes | **1 bit** | yes | yes |
| sqlite object (:1207) | `SQLITE_VERSION` | yes | **1 bit** | yes | yes |
| mbedTLS archive `libmbedtls.a` (:1337) | `MBEDTLS_VERSION` | yes | **none** | yes | yes |

The "1 bit" is literally:

```ts
(driver.argv.length === 1 && driver.argv[0] === "clang" ? "" : "-zigcc")
```

**Two of the five units carry no driver component at all.** That is wider
than the report that prompted this: the unit caught in the act (lre) is one
of the three that at least has the bit. `libqjs.a` and `libmbedtls.a` have
nothing.

Both of those take a host path that forces `clang` when `driver.target` is
null -- but on this host `SCRIPTC_TARGET` is always set, so every build
takes the CROSS path, where `driver.argv` IS used to compile and is NOT
keyed.

## 3. What is missing

1. **Compiler VERSION.** The bit classifies, it does not identify. This host
   has two zigs (0.15.2 and 0.16.0); both map to `-zigcc` and share a
   directory. Two clangs both map to `""`. That is exactly the observed
   collision.
2. **Compiler PATH.** A path-qualified clang fails `argv[0] === "clang"` and
   is filed as `-zigcc` -- misfiled, not merely under-keyed.
3. **Driver identity at all, for `libqjs.a` and `libmbedtls.a`.**

**Not missing, checked rather than assumed:** `SCRIPTC_OPT_LEVEL` does not
belong in this key. The vendored units are always MinSizeRel/`-Os`; the knob
reaches scriptc's own runtime and the emitted TU only (:698-706). Its
absence is correct, and a false gap costs as much as a missed one.

**Already correct, and the model to copy:** `profFlavor()` folds the
CONTENTS of every file a `-include` names, not just the flag string. Its
header says why -- an instrument lives in a header, so hashing the flag
alone was this same defect one level up.

## 4. The fix

One memoised helper, used by all five units:

```
toolchainId(driver) = fnv1a( realpath(driver.argv[0])
                           + NUL + driver.argv.join(NUL)
                           + NUL + firstLineOf(`<driver> --version`) )
```

folded to 8 hex and appended as `-tc<hash>`. The `--version` line is what
carries the embedded clang version, which is the quantity that actually
changed codegen. One spawn per process, memoised; `realpath` defeats
symlinked toolchains.

## 5. Proving it, and the arm that can come out wrong

Three arms. The first is mandatory -- without it the fix is a green that
could not have been red.

1. **COLLISION, on the OLD key, must REPRODUCE.** Build lre objects with zig
   A. Without clearing the cache, repoint `SCRIPTC_ZIG` at zig B and build
   again. Assert the cache directory name is IDENTICAL and the object mtime
   is UNCHANGED -- B silently received A's object. If this does not
   reproduce, the premise is wrong and the fix is unmotivated.
2. **SEPARATION, on the NEW key, must PASS.** The same two builds must land
   in two different directories, each object carrying its own toolchain
   stamp.
3. **NON-REGRESSION.** The same compiler twice must land in ONE directory
   and the second build must be a cache hit. Otherwise the key is too
   strict and nobody has a cache at all.

## 6. Cost

- A cold vendor set is **~40 s** (stated at cc.ts:1809). Per unit: engine
  archive ~10 s, mbedTLS ~15 s over ~110 TUs, lre ~1 s, zlib ~1 s.
- On disk today: main checkout 27 dirs / 59 objects / 6 archives / 21 MB;
  each active worktree 9-10 dirs / ~27 objects / 4 archives / 5-6.5 MB.
- **Changing the key invalidates every entry in every worktree at once.**
  Compute cost is small -- roughly 40 s per worktree per flavour actually
  used, a few minutes in total -- plus ~21 MB of orphans in main that
  nothing will ever hit again.
- **The scheduling cost is the real one.** It lands mid-series for whoever
  is running, adds ~40 s to one shard, and shifts every timing comparison
  across the boundary. It must land BETWEEN series with an anchor run, on
  the same rule as any instrument swap.

## 7. A provisional detector that invalidates nothing

Ship before the key change, independently:

Write a `.toolchain` sidecar into each cache directory at populate time
holding the same `toolchainId` string. On a cache HIT, read it and compare;
on mismatch emit one line and continue (or fail, by knob):

```
VENDOR-CACHE-MISMATCH unit=<u> dir=<d> built=<id-a> now=<id-b>
```

Why this is worth shipping first:

- it **changes no key**, so no cache is invalidated and nobody's series is
  disturbed;
- it costs one small file read per unit per build;
- it turns the next unexplained size delta into a logged line instead of a
  hunt;
- it computes exactly what the key fix needs, so it is a prerequisite
  rather than throwaway work.

**One trap registered in advance:** existing cache directories have no
sidecar. Absence must read as **unknown**, never as **match**. Getting that
backwards would make the detector certify every stale object already on the
box -- the `n/a is not 0` rule, in the place where it would do the most
damage.
