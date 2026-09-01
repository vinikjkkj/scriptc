# Attributing a scriptc binary's image by cause

`estado-strpool` established that zapo's RAM front IS its size front: peak
working set **31,476 KiB** against a **29.06 MiB** image, with the whole
heap-and-stack high-water of a full pairing session at 1.67–3.04 MiB. What
nobody had done was say where the image comes from. These scripts do, and
they are written so the next block can re-run them rather than re-derive
them.

Everything here READS artefacts a normal build already produces. Nothing
changes the compiler, and nothing here is on any gate's path.

## The two instruments, and why there are two

1. **The PE section table**, read from the .exe itself. Sum of
   `SizeOfRawData` + `SizeOfHeaders` equals the file size exactly, so this
   is the top line and nothing may contradict it.
2. **The PDB's section contributions.** `zig cc` for `x86_64-windows-gnu`
   writes `<out>.pdb` next to every binary this repo builds — no flag
   needed — and it carries one record per (module, section, offset) with an
   exact byte size, plus per-module `S_LPROC32` records with per-procedure
   code sizes, `static` functions included. The module index resolves to an
   object file path, and the object file path is the source file.

The two disagree only on linker-synthesised content (import tables, header,
padding). That residue is printed as the gap between `rawsize` and
`attributed`, never absorbed: on zapo it is 8,604 bytes of a 27,053,190-byte
`.text`, 0.03%.

The PDB reader is WSL's `llvm-pdbutil`, launched through the `/opt/hslib`
loader exactly as `tests/perf/pdb-symbols.mjs` does it; see that file's
header for the bootstrap and what it costs to reproduce.

## The scripts

| script | question it answers |
| --- | --- |
| `attrib.mjs` | which SUBSYSTEM holds the bytes — emitted program, runtime, mbedTLS, CRT, libregexp, zlib, monocypher, linker |
| `drill.mjs` | inside one PDB module, which PROCEDURES hold the bytes |
| `calls.mjs` | how many DIRECT CALLS the shipped `.text` makes to each named function |
| `cscan.mjs` | split the emitted `.c` into top-level definitions and weigh each |
| `lines.mjs` | classify every BYTE of the emitted `.c` by what the emitter wrote it for |
| `lits.mjs` | are the interned string literals actually interned, and what do they cost |
| `name-modules.mjs` | give every `%m<i>` tag in the emitted C a source file |
| `module-share.mjs` | how much of the image belongs to one module, by the globals a definition names |
| `dynshare.mjs` | how much of the image is DYNAMIC code, by C signature |
| `crosstab.mjs` | do those two independent rules agree procedure by procedure, or only on the total |
| `rollup.mjs` | the image rolled up by source file (see the caveat below) |
| `region.mjs` | is a module a contiguous region of the emitted C, and what are the bounds |
| `probe.mjs` | what ONE emitted exception-unwind release costs in `.text`, by building a family of programs and reading the slope |
| `flagsweep.mjs` | price build-line flags on one small program, byte-exact, with the PDB cost stated |
| `epimerge.mjs` | how much of the emitted C's unwind epilogue is REDUNDANT — three models (as emitted / one pad per distinct body / a `goto` chain) |
| `guardsrc.mjs` | WHICH CALL each `if (scr_exc_pending())` guards, ranked by the epilogue bytes it carries |

## The caveat that cost the most time

`rollup.mjs` attributes an untagged definition to the nearest preceding
tagged one. The emitter writes module by module and the tags are 98.9%
monotonic through the file, so that rule looks sound — and on zapo it is
catastrophically wrong, because the untagged run is most of the file:
it charges 96.57 MiB of emitted C to `src/infra/perf/StoreLock.ts`, a small
utility that happens to own the last tag before the big untagged run.

Anonymous functions carry no module tag anywhere in the program, so
"nearest preceding tag" is not a proxy for "which module is being emitted".
`module-share.mjs` and `dynshare.mjs` exist because of that: they attribute
by evidence inside the definition (the globals it names, the C signature it
has) rather than by its position, and `crosstab.mjs` checks that they agree
on the same procedures rather than only on the same total.

Read `rollup.mjs`'s output as "which named module owns each region", never
as a per-file byte count.

## What it found on zapo (2026-08-19, base `71b188e2`)

    subsystem        bytes         MiB     %of attributed
    program      28,529,404       27.21    93.33
    runtime         891,128        0.85     2.92
    mbedtls         642,069        0.61     2.10
    crt             260,578        0.25     0.85
    libregexp        86,510        0.08     0.28
    monocypher       78,277        0.07     0.26
    zlib             58,930        0.06     0.19
    linker           21,268        0.02     0.07

and inside the program's 24.30 MiB of code, the two independent rules put
**15,725,523 bytes (61.72%)** on the same 1,921 procedures: the `waproto`
module — `spec/proto/index.js`, 1,867,556 bytes of esbuild+terser-minified
protobufjs, compiled through the dynamic (`ScrDyn`) path.

The scripts in this directory reproduce every number above; each carries its
own usage line, and each resolves paths from its own location so it runs from
any checkout.

## What the epilogue instruments found (2026-09-01, block/sizespeed)

`estado-imagesize.md` section 8 named "tail-merge the unwind epilogues in the
emitter" as a lever and declined to guess its ceiling. `epimerge.mjs` measures
that ceiling in the emitted C, and it is small. On a 130,379,169-byte
`messaging.bench.c`:

    pending-check sites   107,177
    epilogue body         43,732,766 bytes  (33.5% of the file)

    model     epilogue bytes   saved vs now   % of whole file
    now           43,732,766              0            0.00
    dedup         43,395,121        337,645            0.26
    chain         38,214,342      5,518,424            4.23

`dedup` shares one landing pad per DISTINCT body; it is worth 0.26% because
the bodies are almost all distinct (1,191 distinct across 1,193 sites in the
worst function). `chain` is the `goto sc_unwind_k;` shape section 8 names;
its ceiling is 4.23% of the emitted C, and only 15.93% of consecutive
release lists in a function actually nest, so even that is optimistic. Read
with section 11.3's finding that clang tail-merges the machine code anyway,
the `.text` value of this lever is near zero. **Do not spend a session on
it.**

`guardsrc.mjs` says where the epilogue comes from instead, and the answer is
three dyn primitives:

         guards      epi bytes    %epi   avg  callee
         33,061     12,289,187   28.07   372  sc_dyn_key_get
         19,420     10,182,602   23.26   524  scr_dyn_invoke
         16,679      6,451,666   14.73   387  scr_dyn_key_set

69,160 of 107,473 guards (64.3%) and 66.06% of all epilogue bytes. A dyn
property read, call or write is a fallible runtime call, so each one costs a
pending check plus the whole live set's release list; the same source typed
emits a struct load and nothing else. That is what the 8.4x expansion IS,
and it is why the lever is the frontend's typing of the bundle rather than
anything the emitter can fold.
