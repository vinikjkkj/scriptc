// A UNION flowing into a RECORD slot.
//
//   const node = content === null ? { tag, attrs } : { tag, attrs, content }
//   return node                                    // declared: Node
//
// A ternary of two literals bound WITHOUT an annotation types as the union
// of the two shapes -- the checker has no reason to pick either -- and the
// slot that receives it wants the one shape. Re-tagging covered union into
// UNION; there was no rule for union into a single record, so a decoder
// written this way did not compile.
//
// Every arm has to reach the shape on its own: identity, or the
// field-copying width coercion that an absent optional member already
// rides. The helper then picks per tag. A unit arm declines the whole
// form, which is right -- a slot that can hold `null` spells a union, and
// this conversion is for the slot that spells one shape.

type Attrs = { [k: string]: string };
type Node2 = { readonly tag: string; readonly attrs: Attrs; readonly content?: readonly Node2[] };

function make(tag: string, attrs: Attrs, content: readonly Node2[] | null): Node2 {
  const node = content === null ? { tag, attrs } : { tag, attrs, content };
  return node;
}
const n = make("a", {}, [make("b", { x: "1" }, null)]);
console.log(n.tag, n.content?.length, n.content?.[0]?.attrs["x"]);
