# The mechanism, reproduced in three drivers and four arms

`harness/ladder.sh`, one command, ~7 s, `main` `f91fcd55`, node **v25.9.0**,
`--provenance-sources`, strict, no `--best-effort`. Every arm typechecks clean
under plain `tsc` first (`tsc rc=0`), so a refusal below is the compiler's
judgement and not a type error.

## The shape

26 lines across three files. A base class in its own module holds a field whose
type comes from a **type-only** import of an **islanded** package; a subclass in
a **different** module extends it; the entry constructs the subclass and calls
one method.

## The four arms

| arm | what it changes | why it is here |
| --- | --- | --- |
| **A** baseline | the shape above | the thing being measured |
| **B** probe | ONE line: the islanded import becomes a locally-declared structural type. **Line-neutral** — 14/14 and 6/6 lines in both files | substitution: if A's sites are the island's, B has none |
| **C** A/A control | a **byte-identical** copy of A in a different directory | the harness must be able to say "no difference" |
| **D** position | the same islanded type in a **method parameter**, never in a field | is the *field* load-bearing, or any appearance in the class shape? |

## The result — the same in all three drivers

| driver | why it islands | A | B | C | D |
| --- | --- | --- | --- | --- | --- |
| `ioredis` | no provenance attestation published | **4** | **0** | **4** | **4** |
| `mysql2/promise` | mysql2 **is** attested; the subpath has *no source mapping* (published target `./promise.js`) | **4** | **0** | **4** | **4** |
| `pg` | no provenance attestation published | **4** | **0** | **4** | **4** |

Statements reached go 4 → 8 on the B arms (the two failed statements become
analysable) and the four sites go to zero. Arm C reads exactly what arm A reads
in every driver, so the B delta is the substitution and not noise.

## The four sites, and where each is named

Identical in all three drivers, and in arm D:

```
SC2013  <mod>/base.ts    values from the '<pkg>' package run in the embedded
                         dynamic engine, which this build does not include
SC1090  <mod>/sub.ts     extending classes not declared in the program
                         ('<Base>') is not supported yet
SC1090  entry.ts         constructing through a class value whose class has no
                         lowering (the class declaration itself was rejected)
SC1090  entry.ts         method calls like 's.who' is not supported yet
```

**The cause is named one module away from the consequence, under a different
code.** `SC2013` is the island; `SC1090` is what the reader sees first, and it
says nothing about a package. A roots-vs-cascade split does not join them:
`SC2004` is the compiler's cascade marker and none of these four carry it, so
all four count as *roots*. That is how one cause reads as four independent
problems, and at package scale as twenty.

## What arm D refutes

Arm D was written expecting **0**: the three store packages put the islanded
type in a field only in their base class, while fourteen of their store files
import the same type merely for a **method parameter**. If the field were the
load-bearing position, those fourteen imports would be harmless *for a
different reason* than the one that actually applies.

Arm D reads **4**, identical to A. **Position does not matter.** An islanded
type anywhere in a class's declared shape rejects the class declaration; the
fourteen method-parameter imports are harmless only because their classes are
already rejected for extending a rejected base, and a rejected class is not
re-reported. Any statement of this mechanism that says "in a **field**" is
narrower than the compiler's actual rule.
