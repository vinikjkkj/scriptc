// The side table that carries a call site's resolved type into a generic
// body is per-INSTANCE and installed only while that instance's body
// lowers. This pins the scope, which is the half that can go wrong
// silently: the SAME symbolic ts.Type resolves differently under every
// instantiation, so an entry that outlived its body — or one visible from a
// sibling frame — is one instantiation answering for another, and a wrong
// field read at speed rather than a diagnostic.
//
// Three ways to escape the scope are exercised:
//   - NESTING: a generic body instantiating another generic at a DIFFERENT
//     schema, so two tables are live at once and the inner must not be read
//     under the outer's frame (nor survive back into it);
//   - RECURSION through the same generic at two schemas;
//   - a later, UNRELATED instantiation of the same function, which must not
//     inherit whatever the last body installed.

type Part =
  | { readonly kind: "lit"; readonly text: string }
  | { readonly kind: "field"; readonly field: string };

interface Spec<P extends ReadonlyArray<Part> = ReadonlyArray<Part>> {
  readonly label: string;
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
  for (const p of spec.parts) {
    out.push(p.kind === "lit" ? p.text : bag[p.field]);
  }
  return out.join("/");
}

type AParts = readonly [{ readonly kind: "lit"; readonly text: "a" }, { readonly kind: "field"; readonly field: "one" }];
type BParts = readonly [
  { readonly kind: "lit"; readonly text: "b" },
  { readonly kind: "field"; readonly field: "left" },
  { readonly kind: "field"; readonly field: "right" },
];

const A: Spec<AParts> = { label: "A", parts: [{ kind: "lit", text: "a" }, { kind: "field", field: "one" }] };
const B: Spec<BParts> = {
  label: "B",
  parts: [{ kind: "lit", text: "b" }, { kind: "field", field: "left" }, { kind: "field", field: "right" }],
};

// NESTING: this generic's own body instantiates `render` at BOTH specs, so
// while `wrap<S>`'s table is installed, two more are built and torn down
// underneath it — and `wrap`'s own symbolic parameter must still resolve
// correctly on the way out.
function wrap<S extends Spec>(spec: S, args: ArgsFor<S>): string {
  const mine = render(spec, args);
  const other = render(B, { left: "L", right: "R" });
  const same = render(A, { one: "1" });
  return `${spec.label}[${mine}](${other})(${same})`;
}

console.log(wrap(A, { one: "x" }));
console.log(wrap(B, { left: "p", right: "q" }));
// The A instance again, AFTER the B instance's body has been lowered: it
// must still read `one`, not whatever B installed last.
console.log(wrap(A, { one: "y" }));

// Plain re-instantiation, interleaved.
console.log(render(A, { one: "m" }));
console.log(render(B, { left: "n", right: "o" }));
console.log(render(A, { one: "z" }));
