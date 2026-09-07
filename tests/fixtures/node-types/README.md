# node-types fixture

A project whose node_modules contains @types/node — the adoption path for
real-world Node/TypeScript projects. The vendored node_modules are COMMITTED
TEST DATA, pinned so the type surface (and therefore the pinned diagnostics)
never drifts with the registry:

- `@types/node` 24.13.3
- `undici-types` 7.18.2 (its dependency — declares the web-platform globals:
  fetch/Response/AbortSignal/ReadableStream/...)

What the fixture pins (see tests/harness/project-config.test.ts):

- `argv-env.ts` — the SUPPORTED process surface (argv, env) typed by
  @types/node lowers statically and the binary runs: with @types/node
  present, the shipped fallback declarations for `process`/`node:fs`/
  `console` stand down (their types come from @types/node), but the same
  members lower to the same libCalls, recognized by name + @types/node
  provenance.
- `fenced.ts` — surface @types/node DECLARES but scriptc does not lower
  (process.uptime, Buffer.from, setInterval) reports the SC2020-family
  fence naming @types/node, instead of typechecking its way into a broken
  binary — and never a raw "Cannot find name" error.
- `streams.ts` — the node:stream classes (see
  tests/harness/stream-node-types.test.ts).
- `child-stdio.ts` — spawn's piped child stdio, read through all three
  forms (plain member, `!`, `?.`) (see
  tests/harness/child-stdio-node-types.test.ts).

Projects WITHOUT @types/node (every other fixture and the whole corpus) keep
the shipped fallback declarations and behave exactly as before.

## The coverage hazard this fixture exists to close

**A green corpus is not evidence that a subsystem is reachable.** The corpus
compiles against the SHIPPED FALLBACK declarations; every real project
installs @types/node. Where the two declaration sources spell the same
runtime object differently, a subsystem can be certified by a passing corpus
program and be unreachable for every real consumer — and nothing in the
corpus can report it.

It has now happened twice, and both times the fix was a provenance/name
question, not a missing runtime:

| subsystem | what the two sources disagreed about | measured |
| --- | --- | --- |
| node:stream classes | both places deciding "this is a node:stream class" excluded @types/node; `Readable` was claimed by the child-stdio mapping instead | stream-node-types.test.ts |
| piped child stdio | a tuple `stdio` selects @types/node's `ChildProcessByStdio<I, O, E>` overload, a different SYMBOL NAME for the same handle; mapType matched `ChildProcess` only | **`tests/corpus/1565-spawn-pipe-streams.ts`'s shape: 0 refusal sites under the fallback, 4 under @types/node 24.13.3** (tests/perf/mediautils-0907 §5.1) |

So: **when a corpus program is the only proof a surface works, it is proof on
one lane only.** Anything whose declarations differ between the fallback and
@types/node needs a fixture here too. That is what these files are for, and
why each one is paired with a harness test that compiles it and compares
against Node.
