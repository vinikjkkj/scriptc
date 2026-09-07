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
compiles against the SHIPPED FALLBACK declarations; every real project installs
@types/node. Where the two declaration sources spell the same runtime object
differently, a subsystem can be certified by a passing corpus program and be
unreachable for every real consumer.

This tree already MEASURES that gap and does not need convincing of it: the
manifest in `tests/harness/node-types-divergence.json` lists the 49 corpus
programs that are clean under the fallback and red under @types/node 24.13.3,
and `tests/harness/node-types-divergence.test.ts` re-derives them and fails when
the set moves in either direction. What this directory adds is the other half.
The manifest records where a capability is MISSING in the real-types world; a
fixture here proves one is PRESENT, by compiling and matching Node. A gap can be
closed only against a fixture, and can be kept closed only by one.

Two have been closed this way so far, and both were a provenance/name question
rather than a missing runtime:

| subsystem | what the two sources disagreed about | fixture |
| --- | --- | --- |
| node:stream classes | both places deciding "this is a node:stream class" excluded @types/node; `Readable` was claimed by the child-stdio mapping instead | `streams.ts` |
| piped child stdio | a tuple `stdio` selects @types/node's `ChildProcessByStdio<I, O, E>` overload, a different SYMBOL NAME for the same handle; mapType matched `ChildProcess` only. The manifest had named this cluster exactly — `ChildProcessByStdio<null, Readable, Readable> and its members`, over `1565-spawn-pipe-streams.ts` and `1657-spawn-async-neutral.ts` | `child-stdio.ts` |

The second one carries a lesson worth keeping. Closing that fence did not make
those two programs clean: it revealed a SECOND divergence behind the first —
their `data` listeners take an unannotated `chunk`, which @types/node types
`unknown` where the fallback types `Buffer`. The manifest entry now records the
deeper codes and says so. **A fence that is hiding another fence looks exactly
like a fence that is alone**, and only closing the first one tells them apart.

So: **when a corpus program is the only proof a surface works, it is proof on
one lane only.** Anything whose declarations differ between the fallback and
@types/node needs a fixture here as well, paired with a harness test that
compiles it and compares against Node.

### One trap the site count will not catch

`analyze()` does not run the IR validator or either emitter. A change to a
lowering can therefore report a clean site count on every program and still
fail the build. `child-stdio.ts` is the fixture that caught exactly that: a
`child.stdout` result minted without its null arm passed every site count and
ICEd (SC9001) in the validator, because `scr_child_stdout` answers +1-or-NULL
and both emitters materialise that test off the two arms. **Run the harness
suites for the files you touch; a green site count is not a green build.**
