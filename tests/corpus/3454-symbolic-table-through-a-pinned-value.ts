// The route into the side table that is NOT a direct call: a generic taken
// as a VALUE inside an instantiated body.
//
// That position mints a CONSTRAINT-ERASED mapping attempt
// (constraintErasedCtx), which spreads the enclosing context — so the side
// table rides along into a walk whose whole purpose is to answer "what
// shape does this signature have with the type parameters replaced by
// their CONSTRAINTS", not "what did this call site resolve them to". The
// two answers differ: the constraint gives the index-signature form, the
// instantiation gives the concrete fields.
//
// So the fixture is deliberately adversarial. The pinned value is applied
// TWICE inside one body: once to the enclosing instantiation's own
// arguments, and once to a DIFFERENT spec entirely. If the erased walk or
// the pinned instance could read the enclosing body's resolution, the
// second call reads the wrong field and prints `b/x` or `a/Z`.
//
// It cannot, and the reason is the keying rather than the scoping: the
// second call is its own instantiation with its own resolution, so it gets
// its own instance. Both lines below must match Node exactly.

type Part =
  | { readonly kind: "lit"; readonly text: string }
  | { readonly kind: "f"; readonly field: string };

interface Spec<P extends ReadonlyArray<Part> = ReadonlyArray<Part>> {
  readonly parts: P;
}

type ArgsFor<S extends Spec> = {
  readonly [P in S["parts"][number] as P extends { kind: "lit" }
    ? never
    : P extends { field: infer F extends string }
      ? F
      : never]: string;
};

function render<S extends Spec>(spec: S, args: ArgsFor<S>): string {
  const bag = args as Readonly<Record<string, string>>;
  const out: string[] = [];
  for (const p of spec.parts) out.push(p.kind === "lit" ? p.text : bag[p.field]);
  return out.join("/");
}

type AP = readonly [
  { readonly kind: "lit"; readonly text: "a" },
  { readonly kind: "f"; readonly field: "one" },
];
type BP = readonly [
  { readonly kind: "lit"; readonly text: "b" },
  { readonly kind: "f"; readonly field: "two" },
];

const A: Spec<AP> = { parts: [{ kind: "lit", text: "a" }, { kind: "f", field: "one" }] };
const B: Spec<BP> = { parts: [{ kind: "lit", text: "b" }, { kind: "f", field: "two" }] };

function viaValue<S extends Spec>(spec: S, args: ArgsFor<S>): string {
  const f: <T extends Spec>(s: T, a: ArgsFor<T>) => string = render;
  const other = f(B, { two: "Z" });
  return f(spec, args) + "|" + other;
}

console.log(viaValue(A, { one: "x" }));
console.log(viaValue(B, { two: "y" }));
