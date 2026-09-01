// @exit: 1
// The METHOD-RETURN UNDER-CLAIM: an interface annotated onto an `any`-typed
// value, declaring a method whose return type is NARROWER than what the body
// can actually return. No cast is written — a plain annotation binds the claim,
// which is what happens whenever ordinary TypeScript meets a bundler-emitted
// export that infers as `any`. This file's `any` is written in TypeScript
// directly: the defect never needed JavaScript, only an `any` source.
//
// The compiler admits the annotation and materialises a record. Where the
// declared member is a FUNCTION whose signature differs from the body's, the
// dyn walker mints an adapter closure that re-validates the arguments on the
// way in and THE RESULT on the way out — so the under-claim is caught at the
// return site, which is the only place it exists. That part always worked.
//
// What did not work was the unwind. computeMayThrow decides whether a call
// through a value needs a pending-exception check, and its dyn-adapter guard
// tested only the dynCheck's TOP-LEVEL kind. Here the checked type is a
// `record` with the func one level down, so the flag stayed clear, `indirect`
// stayed false, and the call site got no check. The adapter threw, the caller
// never looked, and the program ran on with a NULL result — printing a
// `typeof` folded from the DECLARED type (`string`) where Node prints the real
// one (`object`), then surfacing the throw at exit instead of at the call.
// A silent wrong answer where a trap belonged, on both backends.
//
// The pin is the second half: Node throws reading `.length` off the null, and
// scriptc throws one statement earlier at the call that produced it. Same
// stdout, same exit — but only while the pending check is emitted. Without it
// the compiled binary reads `.length` through a NULL string and dies with a
// signal, so a regression shows up as an exit-code divergence, not as silence.
//
// The first half is the control that keeps the fix honest: an annotation the
// body HONOURS must still run, and every call through it must still return.

interface Codec {
  find(k: string): string;
  readonly count: number;
}

// 1. The claim HELD. The body returns a string on every path, the adapter's
//    result check passes every time, and nothing throws.
const honest: any = {
  find(k: string) {
    return k.toUpperCase();
  },
  count: 2,
};
const ok: Codec = honest;
console.log("1 " + ok.find("hit"));
console.log("2 " + ok.find("miss"));
console.log("3 " + String(ok.count));
console.log("4 " + String(ok.find("a") + ok.find("b")));

// 2. The claim BROKEN on one path only, so the honoured call still answers
//    first — the divergence is not "this construct fails", it is "this
//    construct answers correctly until it doesn't".
const liar: any = {
  find(k: string) {
    return k === "hit" ? "FOUND" : null;
  },
  count: 7,
};
const bad: Codec = liar;
console.log("5 " + bad.find("hit"));
console.log("6 " + String(bad.count));

// The under-claiming return. scriptc throws HERE (the adapter's result check,
// reported at the call); Node hands back the null and throws one line later.
// Nothing may print between the two, or the stdout comparison would encode
// the divergence rather than catch it.
const missing = bad.find("miss");
console.log("7 " + String(missing.length));
console.log("8 unreachable");
