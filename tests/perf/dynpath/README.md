# `tests/perf/dynpath` — pricing the dynamic path, and the twin that feeds it

Six instruments and one two-arm lab. None of them is on a gate path; every
one answers a single question and prints the number it read rather than a
number it computed. `tests/perf/imagesize/attrib.mjs` supplies the PE
section-table reader they share.

## The question these were built for

`estado-imagesize.md` attributed 51.6% of zapo's 29.06 MiB image to one
module — `spec/proto/index.js`, 1,867,550 bytes of esbuild+terser-minified
protobufjs, compiled entirely through the `ScrDyn` path because it reaches
the lowering as the **implementation twin of a `.d.ts`**. The obvious next
question is "why not use the `.d.ts`", and the obvious next number is the
11.7x per-procedure ratio between a dyn procedure and a typed one. Both
needed a measurement rather than an argument:

* the two paths are not a choice — `provenanceDeclSiblings()` +
  `declTwinOf()` compile **both** halves, because a `.d.ts` has no body;
* and 11.7x compares populations that are not comparable (a generated
  protobuf codec against a typed helper).

## The lab

`twin-lab.mjs <N> <outdir>` writes two package trees that differ in exactly
one thing — how the module's own body is typed — and are driven by the SAME
entry statements against the SAME declared surface:

    A   spec/proto/index.js  (minified, generated)  + index.d.ts twin
    B   spec/proto/index.ts  (the same logic, typed TypeScript)

`twin-lab-jsdoc.mjs <N> <outdir>` adds the two arms that bound what the
declaration's types could ever buy if the compiler applied them to the JS
body:

    P   the SAME JS as A, pretty-printed              — the INTERNAL CONTROL
    C   P plus JSDoc carrying exactly the .d.ts types — the CEILING

Both labs ride `SCRIPTC_PROVENANCE_MANIFEST` (provenance.ts's offline hook),
which is the only build shape that produces the twin. Each lab also writes
a Node oracle that runs the JS body directly, so every arm is checked
against Node and not only against the other arms.

`armtab.mjs` reads the arms at two sizes and prints the per-message-type
SLOPE, which removes the runtime, the CRT and the entry exactly. Quote the
slope; never the total.

**P is the reason to trust the table.** A measurement that reformats a body
and moves `.text` is measuring formatting. On the tree this was written for,
A and P are `.text`-identical to the byte at both sizes.

## The instruments

    waproto-split.mjs   what is IN zapo's bundle: which bytes are vendored
                        protobufjs (the .d.ts describes none of it) and which
                        are generated message code (the .d.ts describes all
                        of it), plus the declared-surface and body-member
                        counts that have to agree.
                        They DO agree, and that is the trap: agreeing counts
                        say the declaration NAMES these procedures, not that
                        it DESCRIBES them. So it also parses both files and
                        prints the agreement that decides whether the .d.ts
                        could ever type the bodies -- per-procedure ARITY,
                        per-member reader/writer use, and how concrete the
                        declared field types are. On zapo's bundle: arity
                        agrees on 0 of 1,284, the declared PbReader is missing
                        tag/raw/discardUnknown and the real skipType arity
                        (28.7% of sites), and 188 of 7,493 declared fields
                        (2.51%) are concrete rather than optional or a union.
    decode-shape.mjs    the follow-on to waproto-split: the .d.ts does not
                        describe these bodies, so can the shapes be recovered
                        from the BODIES, which is the only source npm-static's
                        doctrine permits? Prints how many message field sets are
                        statically enumerable from the generated template, and
                        the three things a static shape would have to preserve
                        to stay byte-exact. On zapo's bundle: decode is ONE
                        template for 641 of 641 and 635 field sets (99.1%) are
                        enumerable -- but encode reads a CALLER-SUPPLIED plain
                        object and uses hasOwnProperty as the presence test that
                        decides the wire bytes, so a static struct would emit
                        fields the caller never set. Read the SAFETY block before
                        costing any of this; the decode half is tractable and the
                        encode half is gated on modelling presence.

    presence-coupling.mjs
                        the assumption a decode-only static shape rests on,
                        EXECUTED against the real bundle rather than argued
                        about. A decode-produced message is an encode input, and
                        encode decides the wire with a null check AND a
                        hasOwnProperty check. Runs both, plus $unknowns
                        enumerability, the caller-supplied target, and the
                        null-slot vs zero-slot question over every message type.
                        Exits non-zero on any failure and carries three controls,
                        one of which asserts the harness can detect a difference
                        at all. Headline: the NULL CHECK COMES FIRST, so a shape
                        that makes every field an own property is harmless for
                        the wire provided an absent slot reads as null --
                        presence needs nullable slots, not a side bitset. Slots
                        defaulting to 0/false/"" diverge on 278 types.

    enum-observability.mjs
                        presence-coupling proves a null-defaulted shape is
                        byte-exact on the WIRE and says nothing about the object
                        surface. This is the object surface. 13 of 20 common
                        expressions distinguish an absent field from a
                        null-valued own slot -- but `x === null || x ===
                        undefined` and `x !== null && x !== undefined` are each
                        just `x == null`, so it classifies those as safe rather
                        than counting them. Scope-aware: a same-named variable in
                        another function is not the decoded one. Over-approximates
                        the tracked set on purpose (any `.decode(`, TextDecoder
                        included), because tracking too much can only invent
                        findings, never hide one. Carries a SELF-TEST that fires
                        every detector on a fixture and exits non-zero if any of
                        them is dead -- "0 findings" from a broken scan looks
                        exactly like good news, and this project has already been
                        fooled once by a harness that confirmed its own
                        hypothesis. On zapo's checkout plus the drivers, 1,152
                        files: 81 decode-bound locals, 72 of them protobuf, 22
                        safe pairs, and ZERO observations.

    seed-inventory.mjs  what a shaped decode would cost, counted in MAY-THROW
                        SEEDS rather than sites, because the size is the guards
                        and not the object layout. may-throw.ts seeds f.throws
                        unconditionally on dynInvoke and dynKeyGet; recordKeySet
                        seeds only for a dynamic key hitting a declared field;
                        and recordSet -- a static-field store on a known shape --
                        is not in that switch at all, so it carries no guard. A
                        known slot therefore does remove the store's guard. It is
                        not enough alone: the same statement's e.uint32() is a
                        dynInvoke and seeds anyway, and a function keeps its
                        epilogue while any seed remains. On zapo's 641 decode
                        bodies, of 23,359 seeds: message shape alone removes
                        25.2%, reader shape alone 41.1%, BOTH 78.8% -- which
                        EXCEEDS the sum of the arms by exactly the 2,923 stores
                        whose value is still dyn. Those relocate their guard to a
                        dynCheck under a message shape alone and only pay once the
                        reader shape has typed the value, so they belong to
                        neither arm on its own. Reader first.
                        The residue after both is NOT a wall: 4,108 of it is the
                        j.waproto.X namespace walk, and that is ONE record with
                        641 fields rather than a per-message problem. THREE shapes
                        -- reader 9,594, message 8,814, namespace 4,108 -- account
                        for every seed except the 843 nested decode calls, and
                        those dissolve through the may-throw fixpoint once the
                        decodes are clean. A decode body can reach ZERO seeds.

    protoclass-probe.cjs
                        runs frontend/lowering/proto-class.ts against a real
                        bundle WITHOUT building the compiler: it transpiles that
                        one module in memory and hands it a typescript. CJS for
                        exactly that reason. Prints which JS pre-class
                        constructors have a fixed instance shape and a fixed
                        method table, and the reason for every refusal, with a
                        character offset since a minified bundle has no lines.
                        On zapo's bundle: 140 candidates, 4 usable, including
                        Reader {buf,pos,len,discardUnknown} with 14 prototype
                        methods plus the 5 that merge(proto,{...}) installs at
                        _configure time, and Writer {len,head,tail,states} with
                        19. Those two are the 9,594-seed reader arm.

    tucount.mjs         one streaming pass over a 130 MB emitted TU: the
                        retain/release/dyn-op shapes, with the interned-
                        literal share of scr_str_retain.
    litrel.mjs          the immortal-literal ownership ceiling, counted PER
                        FUNCTION so sc_tN names cannot collide: how many
                        ScrStr temps are bound to an interned literal, and
                        how many scr_str_release STATEMENTS name one — the
                        normal path and every unwind epilogue alike.
    elide-lit.mjs       the same elision performed on emitted C rather than
                        in the compiler, so the ceiling could be priced
                        before the emitter change was written. It is kept
                        because it is the CROSS-CHECK: on the probe arm it
                        produces a file byte-identical (md5) to the one the
                        emitter now emits, which is how the change's scope
                        was confirmed to be exactly what was intended and
                        nothing else.

    bucket-origin.mjs   WHERE each seed bucket's RECEIVER comes from, which is
                        what decides whether a lowering arm can reach it at all.
                        seed-inventory.mjs counts the seeds; this one counts the
                        spellings that produce the values they are read off. On
                        zapo's bundle: 641 of 641 decode bodies take the READER
                        as an untyped FUNCTION PARAMETER, and 641 of 641 MESSAGE
                        bindings are `var a = <param> || new j.waproto.X` -- a
                        var slot whose construction names a NAMESPACE MEMBER.
                        Neither is a `new K(...)` an identifier resolves to, so
                        the prototype-class arm cannot type either.
    arm-reach.mts       the same question asked of the COMPILER instead of the
                        source: four programs, each compiled with the arm off and
                        the arm ON, with the emitted C's seed CALL SITES counted
                        both times. The param shape and the namespace-new shape
                        move by ZERO and each gains ~7.2 KB of emitted C; a
                        `const` binding of the same construction drops its four
                        dynInvoke sites to zero. That last row is the POSITIVE
                        CONTROL and it is why the zeros above are readable: a
                        `var` spelling of the identical body also moves by zero,
                        because a var slot is typed at HOIST. Needs tsx (it
                        imports the compiler): see the usage line in the header.

`litrel.mjs` counts SOURCE LINES. `estado-imagesize.md` §11.3 is the
standing warning that source lines do not transfer to `.text` — clang
tail-merges the epilogues. The `.text` ceiling is that count times the
shipped share, and only the PDB can give the shipped share.

## Recipe

    node twin-lab.mjs        8 <lab>      # writes <lab>/A and <lab>/B
    node twin-lab.mjs      120 <lab120>
    node twin-lab-jsdoc.mjs  8 <mlab>     # writes <mlab>/P and <mlab>/C
    node twin-lab-jsdoc.mjs 120 <mlab120>

    # one arm: SCRIPTC_PROVENANCE_MANIFEST=<arm>/manifest.json, then
    #   cd <arm>/case && scriptc build main.ts --backend c \
    #     --provenance-sources --best-effort --keep-c -o <tag>.exe
    # and run it against <lab>/oracle/run.mjs.

    node armtab.mjs --lo 8 --hi 120 \
      --A <lab>/A/case/a8,<lab120>/A/case/a120 \
      --P <mlab>/P/case/p8,<mlab120>/P/case/p120 \
      --C <mlab>/C/case/c8,<mlab120>/C/case/c120 \
      --B <lab>/B/case/b8,<lab120>/B/case/b120

    node waproto-split.mjs <index.js> <index.d.ts>
    node tucount.mjs <program>.c
    node litrel.mjs  <program>.c
    node elide-lit.mjs <program>.c <out>.c
