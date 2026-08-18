// `Error.prototype.stack` — the read this compiler refused until now, and the
// question the refusal was refusing to answer: what does a runtime that
// captures NO FRAMES say when a program asks for a stack?
//
// The answer shipped here is the HEADER LINE, and it is not invented. Node
// v25.9.0 produces exactly it, and the configuration that makes it do so is
// one assignment:
//
//     Error.stackTraceLimit = 0
//     new Error("boom").stack   === "Error: boom"
//     new TypeError("t").stack  === "TypeError: t"
//     new Error().stack         === "Error"
//
// That is V8 formatting a capture of zero frames, and it is character for
// character `Error.prototype.toString()` over the same two slots — which is
// why this needs no new runtime code: the runtime already computes that
// string (`scr_error_to_string`) and already prints it for an uncaught error.
//
// The alternative that was on the table is `undefined` — type-correct, since
// lib.es5.d.ts declares `stack?: string`. It was NOT taken, and this file is
// where the reason is testable rather than arguable: every line below reads
// `typeof`, truthiness or the FIRST LINE, and under `undefined` every one of
// them would print something Node never prints under any configuration,
// while `e.stack.split("\n")[0]` — a working expression in Node — would
// throw. The project made the same call the other way for
// `Function.prototype.toString`, and the discriminator is exactly this: no
// Node configuration answers `[native code]` for a user function, and every
// Node configuration with `stackTraceLimit = 0` answers this.
//
// WHAT IS NOT PINNED HERE, deliberately, because it cannot be:
//   * the FRAME LINES. There are none, and a fixture asserting the whole
//     string would embed absolute paths and line numbers of the TypeScript
//     source, which a compiled binary has no way to reproduce. The named
//     cost of this decision is exactly "line count", and it is stated in
//     the lowering's own comment.
//   * V8 memoises the header at FIRST READ, so mutating `.name` after a read
//     does not change a later read; this recomputes. Measured, reachable
//     through a `.name` write, and left out of this fixture on purpose — a
//     fixture that pinned it would pin a divergence as correct.

const boom = new Error("boom");
console.log(typeof boom.stack);
console.log((boom.stack ?? "MISSING").split("\n")[0]);
console.log(boom.stack === undefined ? "ABSENT" : "PRESENT");
console.log(String(Boolean(boom.stack)));

// Every builtin the error battery lowers, so the NAME half of the header is
// the receiver's own and not a constant.
console.log((new TypeError("t").stack ?? "MISSING").split("\n")[0]);
console.log((new RangeError("r").stack ?? "MISSING").split("\n")[0]);
console.log((new SyntaxError("s").stack ?? "MISSING").split("\n")[0]);

// No message: V8 prints the bare name, with no colon.
console.log((new Error().stack ?? "MISSING").split("\n")[0]);
console.log((new Error("").stack ?? "MISSING").split("\n")[0]);

// A user subclass that does not set `name` reads as its BASE's name, which
// is what V8 does — the header comes from the `name` property, not from the
// constructor.
class Plain extends Error {}
console.log((new Plain("p").stack ?? "MISSING").split("\n")[0]);

// A user subclass that DOES set it, in the constructor, before any read.
class Named extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Named";
  }
}
const named = new Named("n");
console.log((named.stack ?? "MISSING").split("\n")[0]);

// The header IS the toString: the two must agree, which is the whole claim
// of this lowering stated as an assertion the run can fail.
console.log(String((named.stack ?? "").split("\n")[0] === String(named)));
console.log(String((boom.stack ?? "").split("\n")[0] === boom.toString()));

// A caught error, narrowed by instanceof — the shape a program actually
// writes when it logs a stack.
try {
  throw new RangeError("thrown");
} catch (e) {
  if (e instanceof Error) {
    console.log((e.stack ?? "MISSING").split("\n")[0]);
  }
}

// The optional-chain read, and protobufjs's own fallback spelling
// `(new Error).stack || ""` — the arm the library ships for an engine
// without `Error.captureStackTrace`, which is the arm this compiler now
// selects.
const maybe: Error | undefined = new Error("maybe");
console.log((maybe?.stack ?? "MISSING").split("\n")[0]);
const fallback = new Error("fb").stack || "";
console.log(fallback.split("\n")[0], String(fallback.length > 0));

// DOMException: the ScrError prefix under a different vtable, and V8 puts
// the WebIDL name in the header.
const dom = new DOMException("dm", "AbortError");
console.log((dom.stack ?? "MISSING").split("\n")[0]);
console.log(typeof dom.stack);

// `.code` on the same receivers already answered `string | undefined`; the
// two reads share one lowering and one receiver test, so a change to either
// has to keep both. (`code` is NodeJS.ErrnoException's member, not Error's,
// so the receiver has to be spelled as one — which is also the shape zapo's
// own error handling uses.)
const errno: NodeJS.ErrnoException = new Error("errno");
console.log(String(errno.code === undefined), String(typeof errno.stack === "string"));
console.log((errno.stack ?? "MISSING").split("\n")[0]);
