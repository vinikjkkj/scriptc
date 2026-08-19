// zapo's `WaRetryReplayer.resendOpaquePayload`, `src/retry/replay.ts:354-374`,
// reproduced whole: the retry path re-sends a decoded stanza under the
// outbound message's own id, and rebuilds the node ONLY when the ids differ.
//
//     const replayNode =
//         decoded.attrs.id === outbound.messageId
//             ? decoded
//             : { ...decoded, attrs: { ...decoded.attrs, id: outbound.messageId } }
//
// The inner literal is the spread-then-name arrangement (4801). What makes
// THIS file the site rather than a restatement of that one is the chain the
// value then travels, every link of which the fold has to survive:
//
//   * the folded shape is a FIELD of an outer object literal whose own type
//     tsc also inferred (`{ tag: string; attrs: { id: string } }`);
//   * that literal is one ARM of a ternary whose other arm is the declared
//     `BinaryNode`, so the two arms must intern to types that meet;
//   * the meet is assigned to a `BinaryNode`-typed return, whose `attrs` is
//     `Readonly<Record<string, string>>` — the PURE index record the fold
//     already produced, so the coercion is a copy and not a width lift that
//     would have to move a struct slot into an overflow store.
//
// The wire is what makes the answer matter: `sendMessageNode` walks `attrs`
// in order, so a rebuilt node that dropped `to`/`type` (what a literal shape
// with only `id` would carry) or reordered them is a corrupted retry, and a
// corrupted retry is silent. Every case prints the attribute list in order.

interface BinaryNode {
  readonly tag: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly content?: Uint8Array | string | readonly BinaryNode[];
}

function rebuild(decoded: BinaryNode, messageId: string): BinaryNode {
  const replayNode =
    decoded.attrs.id === messageId
      ? decoded
      : {
          ...decoded,
          attrs: {
            ...decoded.attrs,
            id: messageId,
          },
        };
  return replayNode;
}

function render(n: BinaryNode): string {
  let s = n.tag + "{";
  let first = true;
  for (const k of Object.keys(n.attrs)) {
    if (!first) s += ",";
    first = false;
    s += k + "=" + n.attrs[k];
  }
  return s + "}";
}

const message: BinaryNode = { tag: "message", attrs: { to: "5511999@s.whatsapp.net", id: "3EB0AAAA", type: "text" } };
// the id already matches: the SAME node comes back, untouched
console.log(render(rebuild(message, "3EB0AAAA")));
// the id differs: rebuilt, and `id` keeps its position among the attributes
console.log(render(rebuild(message, "3EB0BBBB")));
// an id-less node: `id` is appended, exactly where JS appends it
const iq: BinaryNode = { tag: "iq", attrs: { from: "s.whatsapp.net", type: "result" } };
console.log(render(rebuild(iq, "3EB0CCCC")));
// an EMPTY attribute set
const bare: BinaryNode = { tag: "ping", attrs: {} };
console.log(render(rebuild(bare, "3EB0DDDD")));
// the rebuilt node serialized, and read back by key
const out = rebuild(message, "3EB0EEEE");
console.log(JSON.stringify(out.attrs) + " id=" + out.attrs["id"] + " to=" + out.attrs["to"]);
console.log("tag=" + out.tag + " same-object=" + String(rebuild(message, "3EB0AAAA") === message));
