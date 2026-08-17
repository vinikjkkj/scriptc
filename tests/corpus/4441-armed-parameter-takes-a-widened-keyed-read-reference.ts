// A REFERENCE to a local holding an index-signature keyed read, handed to a
// parameter whose declared type admits `undefined`.
//
// `keyedReadLocalAtDynWidth` widens `const t = n.attrs.type` to dyn so an
// absent key answers undefined instead of aborting the process, and then
// bets that "the destination decides all over again ... at every REFERENCE:
// tsc narrows each use to the scalar it believes, and maybeNarrow bridges
// that with a VALIDATED extraction. So a use that needs the value throws the
// catchable dyn-boundary TypeError where Node would throw its own."
//
// The bet holds for a DEREFERENCE (`t.length` throws in Node too - `deref`
// below) and fails for a parameter declared `string | undefined`, where Node
// hands the undefined straight over and the callee's own `=== undefined`
// answers it. `lowerArgExpecting` already asks exactly this question, and
// declined here because the lowered value is maybeNarrow's bridge rather
// than the read itself - a different node kind, the same destination, one
// binding later.
//
// Both outcomes are in the fixture, and so are the two destinations that
// must NOT move: a parameter declared bare `string` has nowhere to put the
// undefined and keeps throwing, and the dereference keeps throwing. Node
// throws for both, so "byte-exact against Node" is what pins them - the
// point of the rung is not that nothing throws, it is that the two programs
// agree about WHEN.
interface BinNode {
  readonly tag: string;
  readonly attrs: Readonly<Record<string, string>>;
}

function armed(v: string | undefined): string {
  return v === undefined ? "absent" : "present:" + v;
}

function optional(v?: string): string {
  return v === undefined ? "opt-absent" : "opt-present:" + v;
}

function bare(v: string): number {
  return v.length;
}

// A union-valued signature is the width zapo's app-state index args have.
function armedUnion(v: string | boolean | undefined): string {
  if (v === undefined) return "u-absent";
  return typeof v === "boolean" ? "u-bool:" + String(v) : "u-str:" + v;
}

function caught(f: () => void): string {
  try {
    f();
    return "no-throw";
  } catch (e) {
    return e instanceof TypeError ? "TypeError" : "other";
  }
}

function run(n: BinNode): void {
  const missing = n.attrs.type;
  const found = n.attrs.id;
  console.log("armed missing:", armed(missing));
  console.log("armed found:", armed(found));
  console.log("optional missing:", optional(missing));
  console.log("optional found:", optional(found));
  // Keeps throwing: a bare `string` parameter has no arm for the undefined,
  // and Node throws inside the callee on `v.length`.
  console.log("bare missing:", caught(() => { bare(missing); }));
  console.log("bare found:", bare(found));
  // Keeps throwing: the use dereferences the value, which is what Node does.
  console.log("deref missing:", caught(() => { console.log(missing.length); }));
  console.log("deref found:", found.length);
}

function runUnion(args: Readonly<Record<string, string | boolean>>): void {
  const missing = args["nope"];
  const str = args["s"];
  const bool = args["b"];
  console.log("union missing:", armedUnion(missing));
  console.log("union str:", armedUnion(str));
  console.log("union bool:", armedUnion(bool));
}

run({ tag: "message", attrs: { id: "3EB0" } });
runUnion({ s: "hi", b: true });
