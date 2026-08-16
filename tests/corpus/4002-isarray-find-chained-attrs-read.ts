// The CHAINED read of the same shape, and zapo's transport/node/builders/
// tos.ts almost verbatim: `.find()` over an `Array.isArray`-narrowed
// `readonly T[]` arm answers checker-`any`, so BOTH `.attrs` and the
// `.refresh` read through it fenced. The union field read serves the first;
// the record read serves the second once the first has a type again.
//
// Note which half of the shape matters: the plain `for (const x of arr)`
// form after the same `Array.isArray` guard compiled BEFORE this change
// too -- it is `.find()`'s return, not the narrowing itself, that lands on
// the last-resort property fence.
interface Node2 {
  readonly tag: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly content?: Uint8Array | string | readonly Node2[];
}

function refreshOf(node: Node2): string {
  const found = Array.isArray(node.content)
    ? node.content.find((c) => c.tag === "tos")
    : undefined;
  if (!found) return "absent";
  const r = found.attrs.refresh;
  return r === undefined ? "unset" : r;
}

console.log(refreshOf({ tag: "iq", attrs: {}, content: [{ tag: "tos", attrs: { refresh: "60" } }] }));
console.log(refreshOf({ tag: "iq", attrs: {}, content: [{ tag: "tos", attrs: {} }] }));
console.log(refreshOf({ tag: "iq", attrs: {}, content: [{ tag: "other", attrs: {} }] }));
console.log(refreshOf({ tag: "iq", attrs: {}, content: "text" }));
