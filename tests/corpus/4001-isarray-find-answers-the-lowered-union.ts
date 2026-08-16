// A property read whose CHECKER type is `any` but whose lowered VALUE is a
// real union: `Array.isArray` cannot narrow a `readonly T[]` arm (the
// predicate is `arg is any[]`, and `readonly T[]` does not satisfy it), so
// the checker answers `any[]` and every element read downstream is `any` —
// while the lowering still carries the union. The union field read serves
// these; before it was routed here they were SC1090 "reading 'x' from a
// value of type 'any'".
interface Node2 {
  readonly tag: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly content?: Uint8Array | string | readonly Node2[];
}

function pickTag(node: Node2, want: string): string {
  const found = Array.isArray(node.content)
    ? node.content.find((c) => c.tag === want)
    : undefined;
  if (!found) return "none";
  return found.tag;
}

const root: Node2 = {
  tag: "iq",
  attrs: { id: "1" },
  content: [
    { tag: "tos", attrs: { refresh: "60" } },
    { tag: "notice", attrs: { id: "a" } },
  ],
};
console.log(pickTag(root, "tos"));
console.log(pickTag(root, "notice"));
console.log(pickTag(root, "missing"));
console.log(pickTag({ tag: "x", attrs: {} }, "tos"));
