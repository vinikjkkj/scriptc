// tsc DISCARDS a spread source's index signature when it infers an object
// literal's type: `{ jid, ...groupAttrs }` over a `Record<string, string>`
// source types as `{ jid: string }`, though the value carries every key
// the source had. An enclosing literal passes that inferred type down, so
// the shape the merge builds at is the one with the signature erased.
//
// This is zapo's `buildUnlinkSubGroupsIq`: an XML stanza whose `group`
// attrs are a JID plus whatever the caller asked for. Dropping the
// recovered keys is not a divergence — it is a WhatsApp unlink stanza
// that silently loses `remove_orphaned_members`.

interface BinaryNode {
  readonly tag: string;
  readonly attrs: Record<string, string>;
  readonly content?: readonly BinaryNode[] | string;
}

function buildUnlink(jids: readonly string[], removeOrphans: boolean): BinaryNode {
  const groupAttrs: Record<string, string> = {};
  if (removeOrphans) {
    groupAttrs.remove_orphaned_members = "true";
  }
  return {
    tag: "unlink",
    attrs: { unlink_type: "sub_group" },
    // No contextual type reaches this literal: `map` infers the arrow's
    // return, so `attrs` is built at the literal's OWN inferred type.
    content: jids.map((jid) => ({
      tag: "group",
      attrs: { jid, ...groupAttrs },
    })),
  };
}

for (const orphans of [true, false]) {
  const n = buildUnlink(["a@s", "b@s"], orphans);
  const rows = n.content as readonly BinaryNode[];
  console.log("orphans:", orphans, "rows:", rows.length);
  for (const r of rows) {
    console.log(" ", r.tag, Object.keys(r.attrs).join(","), JSON.stringify(r.attrs));
    console.log("   remove_orphaned_members:", r.attrs.remove_orphaned_members);
  }
}

// The recovered store is a real overflow map: reads by runtime key, the
// `in` test, and deletion all see the spread-contributed entries.
function attrsOf(jid: string, extra: Record<string, string>): Record<string, string> {
  const rows = [{ tag: "g", attrs: { jid, ...extra } }];
  return rows[0]!.attrs;
}
const extra: Record<string, string> = {};
extra.alpha = "1";
extra.beta = "2";
const a = attrsOf("j@s", extra);
console.log("keys:", Object.keys(a).join(","));
console.log("values:", Object.values(a).join(","));
console.log("read:", a.alpha, a.beta, a.jid);
console.log("runtime read:", a["al" + "pha"]);
console.log("in:", "alpha" in a, "gamma" in a, "jid" in a);
console.log("entries:", JSON.stringify(Object.entries(a)));

// A source key that COLLIDES with the named field takes the named field's
// slot — and its position, exactly as JS keeps the first-insertion order.
const collide: Record<string, string> = {};
collide.jid = "FROM-SPREAD";
collide.z = "z";
console.log("collide:", JSON.stringify(attrsOf("DECLARED", collide)));

// Each source evaluates exactly once, in source order.
let evals = 0;
function src(v: Record<string, string>): Record<string, string> {
  evals++;
  return v;
}
const s1: Record<string, string> = {};
s1.one = "1";
const s2: Record<string, string> = {};
s2.two = "2";
const two = [{ tag: "g", attrs: { jid: "j", ...src(s1), ...src(s2) } }][0]!.attrs;
console.log("two sources:", JSON.stringify(two), "evals:", evals);

// An EMPTY source contributes nothing and leaves the named field alone.
const empty: Record<string, string> = {};
console.log("empty:", JSON.stringify(attrsOf("only@s", empty)));
