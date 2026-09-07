// An OBJECT pattern whose source is UNION-typed --
// `const { pnJid, username, displayName } = target` over
// `WaBlocklistTarget`, the two-arm blocklist record in zapo-js 1.8.2's
// `transport/node/builders/privacy.ts:169`.
//
// Destructuring is one property read per bound name, and a union RECEIVER
// already answers a property read three ways: the same-typed arm read, the
// lifted per-arm join switch when the arms disagree, and the keyed read
// over an index signature. The pattern hands each name to that reader, so a
// destructure and the `.name` reads it desugars to build the IDENTICAL IR
// node and cannot disagree.
//
// What this pins against Node:
//
//   * arms that answer the SAME type for a name (`username`, `displayName`
//     -- the optional half of the intersection, present on both arms);
//   * arms that answer DIFFERENT types for it (`pnJid` is `string | null`
//     on one arm and `string` on the other, so the read is the join);
//   * a discriminant read out of the pattern (`kind`), then the union-typed
//     payload beside it;
//   * a RENAMED element and a DEFAULTED one, whose default tests the read's
//     undefined arm exactly as it does over a record field;
//   * the source evaluating ONCE: the initializer here is a call with a
//     visible side effect, and it must be logged once per destructure no
//     matter how many names the pattern binds.

type BlocklistTarget = (
  | { readonly lidJid: string; readonly pnJid: string | null }
  | { readonly lidJid: null; readonly pnJid: string }
) & {
  readonly username?: string | null;
  readonly displayName?: string | null;
};

const reads: string[] = [];

function identifierAttrs(target: BlocklistTarget): string {
  const { pnJid, username, displayName } = target;
  if (pnJid && username) {
    return displayName ? "pn_jid=" + pnJid : "username=" + username;
  }
  if (username) return "username=" + username;
  if (pnJid) return "pn_jid=" + pnJid;
  if (displayName) return "display_name=" + displayName;
  return "unknown_identifier=true";
}

// A DISCRIMINATED union: the tag comes out of the pattern beside a payload
// whose type differs per arm, so the payload's read is the join and the
// narrowing that follows is the ordinary one on the bound name.
type Tagged =
  | { readonly kind: "num"; readonly v: number; readonly note?: string }
  | { readonly kind: "str"; readonly v: string; readonly note?: string };

function describe(t: Tagged): string {
  // A rename (`kind: k`) and a default (`note = "-"`) in the same pattern.
  const { kind: k, v, note = "-" } = t;
  return k + "/" + (typeof v === "number" ? "n" + v : "s" + v) + "/" + note;
}

// The source is evaluated ONCE, before any name binds -- the hidden temp is
// what makes that true, and a pattern with three names must not call this
// three times.
function pick(which: number): BlocklistTarget {
  reads.push("pick" + which);
  return which === 0
    ? { lidJid: "lid-a", pnJid: null, username: "alice" }
    : { lidJid: null, pnJid: "55110000@s.whatsapp.net", displayName: "Bob" };
}

console.log(identifierAttrs({ lidJid: "lid-a", pnJid: null, username: "alice" }));
console.log(identifierAttrs({ lidJid: null, pnJid: "55119999@s.whatsapp.net" }));
console.log(identifierAttrs({ lidJid: "lid-b", pnJid: "5511@s", username: "carol", displayName: "Carol" }));
console.log(identifierAttrs({ lidJid: "lid-c", pnJid: null, displayName: "Dave" }));
console.log(identifierAttrs({ lidJid: "lid-d", pnJid: null }));
console.log(identifierAttrs({ lidJid: "lid-e", pnJid: null, username: null, displayName: null }));

console.log(describe({ kind: "num", v: 7 }));
console.log(describe({ kind: "str", v: "seven", note: "n" }));

console.log(identifierAttrs(pick(0)));
console.log(identifierAttrs(pick(1)));
console.log(reads.join(","));
