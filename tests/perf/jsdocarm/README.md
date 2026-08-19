# `tests/perf/jsdocarm` — can a declaration type the body beside it?

Five instruments and one lab, none of them on a gate path. They exist to
answer one question about one build shape: `estado-dynpath.md` priced
"declaration-driven body typing" of a provenance `.d.ts`+`.js` twin at
16.7% of zapo's image, and left the two things it did not build — the
declared-member ↔ function-expression **correspondence** over a minified
bundle, and the proof that the declaration's **types** may be applied to
the body it names.

The answers, measured over zapo's real `spec/proto/index.js`
(1,867,556 bytes, 641 declared classes, 1,923 declared members):

* the **correspondence is exact** — 1,923 of 1,923, 0 false positives,
  0 false negatives, 0 position mismatches, 0 arity mismatches, checked
  against a second correspondence built from Node's live object graph;
* the **types do not transfer** — 0 of 1,923 members are clean of the
  seven hazard classes below, and the four smallest declaration-derived
  typings each refuse at a different fence.

`estado-jsdocarm.md` is the report.

## The instruments

    corr-jsdocarm.mjs         the correspondence FROM THE AST — what a
                              compiler can do. Resolves scopes (the bundle
                              shadows: three `e`s in three scopes) and both
                              namespace idioms terser emits.
    corr-oracle-jsdocarm.mjs  the SAME correspondence from NODE — requires
                              the bundle and walks the live object graph,
                              recording arity from `Function.length` and
                              position from `toString()` (only where the
                              text occurs ONCE: every generated constructor
                              is byte-identical to every other).
    corr-diff-jsdocarm.mjs    the subtraction. False positives, false
                              negatives, position mismatches, arity
                              mismatches. A position disagreement counts as
                              a false POSITIVE: pointing at the wrong
                              function is the failure that miscompiles
                              silently.
    hazard-jsdocarm.mjs       the seven things the declaration does not say
                              about the body, counted over the
                              correspondence's own spans, and the RESIDUE:
                              how many members carry none of them.

      H1 arity        the body takes parameters the declaration does not
      H2 undeclared   a write naming a property nowhere in the .d.ts
         write
      H3 retyped      a parameter reassigned inside its own body
         param
      H4 dynamic      a property created through a runtime helper
         property
      H5 over-call    a call site passing more arguments than declared
      H6 computed     a property write whose key is computed at run time
         write
      H7 per-instance a presence test (`Object.hasOwnProperty.call`)
         presence

## The lab

`twin-lab-real-jsdocarm.mjs <N> <outdir>` is `tests/perf/dynpath`'s
four-arm lab over a body that has all seven hazards, in the proportions
protobufjs generates them — a oneOf setter that DELETES its siblings, a
per-instance presence gate on every field, `util.makeProp`, a computed-key
constructor, and the group-end/depth/merge-target parameters the
declaration does not mention.

    R    the real-shape minified JS + its .d.ts twin   today's shipped path
    RP   the SAME JS, pretty-printed                   the INTERNAL CONTROL
    RC   RP + JSDoc carrying the WHOLE declared signature
    RD   RP + JSDoc for the LEADING REQUIRED parameters only
    RE   RP + JSDoc on encode's FIRST parameter only
    RX   RC + a hand-INVENTED type for every undeclared parameter
    RB   the same logic as typed TypeScript            the floor

**RP is the reason to trust the table**: a measurement that reformats a
body and moves `.text` is measuring formatting. R and RP are
`.text`-identical to the byte at both sizes.

RC, RD, RE and RX all **refuse at a statement** — SC1090, four different
fences, one per hazard class. R, RP and RB run and are byte-exact against
the Node oracle, whose answer depends on the oneOf deletion, on
`$unknowns` and on the presence gate, so an arm that gets any of them
wrong prints a different number.

The reader is built INSIDE the module from a byte array, exactly as
protobufjs's `Reader.create` does. That is load-bearing: a static record
handed to the dyn twin is DEEP-COPIED at the boundary (`dynFrom`), so a
stateful reader crossing in never advances.

## Recipe

    P=<app>/node_modules/zapo-js/spec/proto

    node corr-jsdocarm.mjs        $P/index.js $P/index.d.ts --json ast.json
    node corr-oracle-jsdocarm.mjs $P/index.js --json oracle.json
    node corr-diff-jsdocarm.mjs   ast.json oracle.json
    node hazard-jsdocarm.mjs      $P/index.js $P/index.d.ts ast.json

    node twin-lab-real-jsdocarm.mjs   8 <lab>/n8
    node twin-lab-real-jsdocarm.mjs 120 <lab>/n120
    # one arm: SCRIPTC_PROVENANCE_MANIFEST=<arm>/manifest.json, then
    #   cd <arm>/case && scriptc build main.ts --backend c \
    #     --provenance-sources --best-effort --keep-c -o <tag>.exe
    # and run it against <lab>/n8/oracle/run.mjs.

    node ../dynpath/armtab.mjs --lo 8 --hi 120 \
      --A <lab>/n8/R/case/r8,<lab>/n120/R/case/r120 \
      --P <lab>/n8/RP/case/rp8,<lab>/n120/RP/case/rp120 \
      --B <lab>/n8/RB/case/rb8,<lab>/n120/RB/case/rb120

The refusing arms' sizes must NOT be read as a ceiling: a refused
statement is a trap, so the body it replaces is dead code and the arm gets
smaller for the wrong reason.

`SCRIPTC_TS_MODULE` picks the TypeScript package the two parsers use
(default `typescript`; the compiler's own is `typescript5`).
