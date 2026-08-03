// A nested object literal inside a RECURSIVE type whose self-reference is
// OPTIONAL -- the shape a node tree is written in.
//
//   type N = { tag: string; kids?: readonly N[] }
//   return { tag: 'root', kids: [{ tag: 'leaf', kids: undefined }] }
//
// The inner literals were built against the shape they infer on their OWN,
// which for a recursive type is the narrow one-level unfolding the literal
// spells: writing `kids: undefined` infers `kids: null | undefined`, not
// `N[] | undefined`. They then had to coerce into the knot shape, and that
// is what failed.
//
// The trigger is recursion AND the optional field together: an optional
// field is a union, and the union path preferred the literal's own array
// type whenever it looked usable. An own RECORD element type looks usable
// and is not -- the slot's arm is what the elements must become, and
// contextual typing says so. A non-optional self-reference always worked,
// because the field type is the arm directly.
type Node2 = {
  readonly tag: string;
  readonly n: number;
  readonly kids?: readonly Node2[];
};

function build(): Node2 {
  return {
    tag: "root",
    n: 1,
    kids: [
      { tag: "leaf-a", n: 2, kids: undefined },
      { tag: "leaf-b", n: 3, kids: [{ tag: "deep", n: 4, kids: undefined }] },
    ],
  };
}

function total(node: Node2): number {
  let sum = node.n;
  for (const k of node.kids ?? []) sum += total(k);
  return sum;
}

function render(node: Node2, depth: number): string {
  const here = `${"-".repeat(depth)}${node.tag}:${node.n}`;
  const kids = node.kids ?? [];
  if (kids.length === 0) return here;
  return `${here}(${kids.map((k) => render(k, depth + 1)).join(" ")})`;
}

const tree = build();
console.log(tree.tag, tree.n, tree.kids?.length);
console.log(total(tree));
console.log(render(tree, 0));

// The same knot with an INDEX SIGNATURE on a field, which is how the
// attribute bags of a wire-protocol node are typed.
type Attrs = { [key: string]: string };
type WireNode = {
  readonly tag: string;
  readonly attrs: Attrs;
  readonly content?: readonly WireNode[];
};

function envelope(count: number): WireNode {
  return {
    tag: "ib",
    attrs: {},
    content: [{ tag: "offline", attrs: { count: String(count) }, content: undefined }],
  };
}

const env = envelope(7);
console.log(env.tag, Object.keys(env.attrs).length, env.content?.length);
console.log(env.content?.[0]?.tag, env.content?.[0]?.attrs["count"]);

// A NON-optional self-reference still behaves: the empty array terminates
// it, and nothing about that path changed.
type Chain = { readonly name: string; readonly next: readonly Chain[] };
const chain: Chain = { name: "a", next: [{ name: "b", next: [{ name: "c", next: [] }] }] };
function walk(c: Chain): string {
  return c.next.length === 0 ? c.name : `${c.name}>${walk(c.next[0]!)}`;
}
console.log(walk(chain));
