// AN `instanceof` GUARD NARROWS THE UNION THE CHECKER GAVE UP ON.
//
// `Array.isArray(n.content)` over a member typed `Uint8Array | string |
// readonly T[]` narrows to bare `any[]` — tsc's readonly-array quirk, since
// `readonly T[]` cannot survive the `arg is any[]` predicate — so every
// element is `any`, and tsc then declines to narrow a property access whose
// ROOT is `any`. `child.content` inside `if (child.content instanceof
// Uint8Array)` comes out `any`, not `Uint8Array`.
//
// The VALUE was never `any`: the field read lowered through the record and
// carries the real union. And the compiler ALREADY reads the guard —
// `x instanceof Uint8Array` over a union is lowered by lowerInstanceOf into
// `tag == N`, the arm test built from that same union def. So the branch was
// entered having PROVEN the arm and the read inside it then answered
//
//   reading 'byteLength' from a value of type 'any' is not supported yet
//
// because maybeNarrow had a rule that took the proof from tsc and none that
// took it from the source. The isArray twin of that rule was already here
// (isArrayGuardProven); this is the instanceof one.
//
// zapo's `parsePollVotes` (newsletter.ts:230) is section 1 exactly, in the
// early-out spelling — which is why both polarities are read: the right
// operand of an `||` runs when the left is FALSE, and a false
// `!(x instanceof U)` is a true `x instanceof U`.
//
// Every expected value below is Node's, taken by running this file.

interface Node2 {
  readonly tag: string;
  readonly content?: Uint8Array | string | readonly Node2[];
}

// 1. The zapo shape: the early-out `!(… instanceof U) || …`.
function pollVotes(votesNode: Node2): number {
  if (!Array.isArray(votesNode.content)) return -1;
  let n = 0;
  for (const child of votesNode.content) {
    if (child.tag !== "vote") continue;
    if (!(child.content instanceof Uint8Array) || child.content.byteLength !== 32) {
      return -2;
    }
    n += 1;
  }
  return n;
}

const hash32: Node2 = { tag: "vote", content: new Uint8Array(32) };
const hash3: Node2 = { tag: "vote", content: new Uint8Array(3) };
const texty: Node2 = { tag: "vote", content: "not-bytes" };
const other: Node2 = { tag: "skip", content: "ignored" };

console.log("1a", pollVotes({ tag: "votes", content: [hash32, hash32] }));
console.log("1b", pollVotes({ tag: "votes", content: [hash32, hash3] }));
console.log("1c", pollVotes({ tag: "votes", content: [texty] }));
console.log("1d", pollVotes({ tag: "votes", content: [other, hash32] }));
console.log("1e", pollVotes({ tag: "votes", content: "flat" }));

// 2. The plain positive guard, and the `&&` whose right operand inherits it.
function sizes(root: Node2): string {
  if (!Array.isArray(root.content)) return "none";
  let out = "";
  for (const child of root.content) {
    if (child.content instanceof Uint8Array) {
      out += ":" + String(child.content.byteLength);
    }
    if (child.content instanceof Uint8Array && child.content.byteLength > 4) {
      out += "!";
    }
  }
  return out;
}
console.log("2", sizes({ tag: "r", content: [hash32, texty, hash3] }));

// 3. Both arms of a conditional expression, and the `else` of an if.
function pick(root: Node2): string {
  if (!Array.isArray(root.content)) return "none";
  let out = "";
  for (const child of root.content) {
    out +=
      child.content instanceof Uint8Array
        ? "b" + String(child.content.byteLength)
        : "x";
    out += !(child.content instanceof Uint8Array) ? "-" : "+" + String(child.content.byteLength);
    if (!(child.content instanceof Uint8Array)) {
      out += "/";
    } else {
      out += "=" + String(child.content.byteLength);
    }
  }
  return out;
}
console.log("3", pick({ tag: "r", content: [hash3, texty] }));

// 4. (An ArrayBuffer arm cannot be written here: no free-standing
//     ArrayBuffer VALUE exists in a compiled program -- lower-exprs refuses
//     `.buffer` outside the DataView/Buffer.from positions that peel it -- so
//     the `buf` flavor has no constructible union to guard over. The rule
//     reads it the same way; nothing in this corpus can exercise it.)

// 5. The regex arm — the other shape lowerInstanceOf already turns into a
//    tag test over a union.
interface Rule {
  readonly name: string;
  readonly match?: RegExp | string;
}
function ruleSource(root: { readonly rules?: readonly Rule[] | string }): string {
  if (!Array.isArray(root.rules)) return "none";
  let out = "";
  for (const r of root.rules) {
    if (r.match instanceof RegExp) out += "[" + r.match.source + "]";
    else out += "(?)";
  }
  return out;
}
const rRe: Rule = { name: "re", match: /ab+c/ };
const rStr: Rule = { name: "st", match: "plain" };
console.log("5", ruleSource({ rules: [rRe, rStr] }));

// 6. A nested function inside the guarded region does NOT inherit the proof
//    (it runs later, when the proof is stale — tsc's own invalidation rule,
//    and isArrayGuardProven's). Read the value through a local instead, which
//    is what the checker can narrow.
function deferred(root: Node2): string {
  if (!Array.isArray(root.content)) return "none";
  let out = "";
  for (const child of root.content) {
    if (child.content instanceof Uint8Array) {
      const held: Uint8Array = child.content;
      const later = (): number => held.byteLength;
      out += String(later());
    }
  }
  return out;
}
console.log("6", deferred({ tag: "r", content: [hash3] }));
