// A child's stdout crossing into `unknown` and back — the
// SCR_DYNH_CHILD_STREAM handle, the OTHER kind zapo's twenty SC1101 sites
// fence on, and the larger of the two by count: it appears at every one of
// the nineteen probe-reachable sites, twice at most of them (once as
// `record.media|childStream`, once as
// `record.linkPreview|record.thumbnail|record.stream`).
//
// The name is the trap, and it is worth stating in the fixture that pins
// the behaviour. `Readable` from "node:stream" does NOT lower to one type:
// under @types/node it is THIS kind (types.ts's childStream branch, which
// also types child stdio), and under the compiler's shipped fallback
// declarations the same spelling is the runtime stream CLASS, which boxes
// as SCR_DYN_OBJINST instead. A minimal program written against the
// fallback therefore exercises a different kind than a record field
// spelled identically in a @types/node build — which is exactly how eight
// earlier reproducers reproduced the trap CODE without touching the site.
//
// This fixture reaches the handle kind the way zapo reaches it, through
// `child.stdout`, which is childStream under BOTH declaration sets. What
// it must then avoid is naming the narrowing target `Readable` — see the
// note on ChildStdout below.
//
// spawn("node", ...) with an explicit stdio triple is 1657's idiom, the one
// that behaves the same on win32 and POSIX.
import { spawn } from "node:child_process";

// The narrowing target is spelled as "the type of child.stdout" and NOT as
// `Readable`, and that is this fixture's second lesson rather than a
// style choice.
//
// Under the compiler's shipped fallback declarations — which is what the
// corpus builds against — `Readable` imported from "node:stream" is the
// runtime stream CLASS (`object:%Readable`, an SCR_DYN_OBJINST box) while
// `child.stdout` is `NodeJS.ReadableStream`, i.e. `childStream` (an
// SCR_DYNH_CHILD_STREAM handle). Naming the cast target `Readable` here
// therefore asked to unwrap a handle box as a class instance, and the
// checked cast threw — the SAME name resolving to two kinds, which is
// exactly the confusion that made zapo's twenty sites look like a class
// problem for a whole session. Under @types/node (zapo) both spellings
// land on childStream and the mistake is invisible.
type ChildStdout = NonNullable<ReturnType<typeof spawn>["stdout"]>;

const child: ReturnType<typeof spawn> = spawn(
  "node",
  ["-e", "process.stdout.write('hello'); process.exit(0)"],
  { stdio: ["ignore", "pipe", "pipe"] },
);

const stream = child.stdout;
if (stream === null) {
  console.log("no stdout");
} else {
  // Widening: a stateful I/O object, so the box carries a REFERENCE.
  const u: unknown = stream;

  // The two answers that need no layout, plus ToString — an inherited
  // Object.prototype.toString, since this class has no own one.
  console.log(typeof u);
  console.log(u ? "truthy" : "falsy");
  console.log(String(u));

  // Identity is the HANDLE, not the box: two independent crossings of one
  // stream compare ===-equal. The comparison is made on the DYN side
  // deliberately — a static `===` between two Readable-typed values is
  // fenced (SC1043, comparing non-number non-string values), so the dyn
  // spelling is both the only one available and the one that exercises
  // the box's identity rule.
  const again: unknown = stream;
  console.log(u === again);

  // Narrowing hands back the SAME stream, and RE-WIDENING is how that is
  // observed here — it has to be. A narrowed child stream's only modeled
  // members are on/once, `typeof` on a statically-typed value is fenced
  // (SC1090), and `===` between two stream-typed values is fenced too
  // (SC1043), so there is no legal synchronous question to ask on the
  // static side. Going back through the boundary is also the stronger
  // statement: box(unbox(box(x))) === box(x) holds only if the unwrap
  // really handed back the same handle rather than some copy.
  const back = u as ChildStdout;
  const round: unknown = back;
  console.log(round === u);

  // Every observation in this fixture is SYNCHRONOUS on purpose. What it
  // pins is the KIND — the box, the three constant answers, the identity
  // rule, the unwrap — and none of that needs a byte to move. Draining the
  // pipe would add the 'end'-versus-'exit' race that 1565 and 1657 already
  // exist to pin for the stream machinery itself, and it made this file
  // flaky under the harness while passing every direct run.
}
