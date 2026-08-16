// A record literal into a MULTI-ARM union, where one field's own inferred
// type is an ARRAY OF A UNION.
//
// `literalUnionArmOf` picks the one arm a fresh literal inhabits by matching
// the literal's fields against each union member's CHECKER types. Its `fits`
// already decomposes a union SOURCE arm by arm — the value is one of those
// arms at runtime and each needs a home. One container in, it did not:
// `[c ? { code } : {}]` types as `({ code: string } | {})[]`, the arm's field
// is `readonly Entry[]`, and widthLiftPlan recursing into the element found a
// UNION source against a RECORD destination and had no rung. No arm was
// selected, the literal built at its OWN inferred type, and the field value —
// which HAD lowered at the declared element type, because each ternary arm
// takes its own contextual `Entry` — met it:
//   SC2003 union types must match exactly: expected '({ code: string } |
//   {})[]', got '{ code: string | undefined; count: number | undefined }[]'
// zapo's `message/kinds/newsletter.ts:86` is that site.
//
// Two factors were independently necessary — a UNION destination AND a
// union-typed element — so both single-factor controls are below and both
// compiled on base. The ambiguity gate is untouched: `candidates.size !== 1`
// still declines, which is what the `ambiguous` block at the end shows.

interface Entry {
  readonly code?: string
  readonly count?: number
}
type Update =
  | { readonly kind: "reaction"; readonly isSender: boolean; readonly revoked: boolean; readonly reactions: ReadonlyArray<Entry> }
  | { readonly kind: "revoke" }
  | { readonly kind: "edit"; readonly plaintext: Uint8Array }
  | { readonly kind: "poll_vote"; readonly isSender: boolean; readonly votes: ReadonlyArray<Entry> }
  | { readonly kind: "counters"; readonly views?: number }

function emit(u: Update): string {
  switch (u.kind) {
    case "reaction":
      return "reaction " + String(u.isSender) + " " + String(u.revoked) + " [" +
        u.reactions.map((e) => (e.code ?? "-") + ":" + String(e.count ?? 0)).join(",") + "]"
    case "revoke":
      return "revoke"
    case "edit":
      return "edit " + String(u.plaintext.length)
    case "poll_vote":
      return "poll " + String(u.isSender) + " " + String(u.votes.length)
    default:
      return "counters " + String(u.views ?? 0)
  }
}

// THE REFUSAL on base: the ternary makes the element type a union, and the
// destination is the 5-arm union.
function reaction(code: string): string {
  return emit({ kind: "reaction", isSender: true, revoked: false, reactions: [code ? { code } : {}] })
}
console.log(reaction("heart"))
console.log(reaction(""))

// Several elements, mixed arms, in one literal.
function many(a: string, b: string): string {
  return emit({
    kind: "reaction",
    isSender: false,
    revoked: true,
    reactions: [a ? { code: a } : {}, {}, b ? { code: b } : {}],
  })
}
console.log(many("x", "y"))
console.log(many("", ""))

// The SAME shape at the OTHER arm that carries an `Entry[]` field: the
// discriminant is what selects, and `votes` takes the same element route.
function votes(v: string): string {
  return emit({ kind: "poll_vote", isSender: true, votes: [v ? { code: v, count: 1 } : {}] })
}
console.log(votes("a"), votes(""))

// The other arms still select, so nothing about the probe's discriminant
// matching moved.
console.log(emit({ kind: "revoke" }))
console.log(emit({ kind: "edit", plaintext: new Uint8Array([1, 2]) }))
console.log(emit({ kind: "counters", views: 0 }))
console.log(emit({ kind: "counters", views: 12 }))

// THE CONTROL, one: the same union destination WITHOUT the ternary. The arm
// was selected on base and must still be.
console.log(emit({ kind: "reaction", isSender: true, revoked: false, reactions: [{ code: "plain" }] }))

// THE CONTROL, two: the same ternary against a NON-union destination. Base.
type Reaction = { readonly kind: "reaction"; readonly isSender: boolean; readonly revoked: boolean; readonly reactions: ReadonlyArray<Entry> }
function single(code: string): Reaction {
  return { kind: "reaction", isSender: true, revoked: false, reactions: [code ? { code } : {}] }
}
console.log(single("solo").reactions.length, single("").reactions[0]!.code ?? "-")

// The selected arm's field types really did drive the element build: the
// optional `count` a ternary arm never wrote reads as undefined, not as a
// missing slot.
const r = single("k")
console.log(r.reactions[0]!.code, r.reactions[0]!.count === undefined)

// THE AMBIGUITY GATE, still shut. Both `reaction` and `poll_vote` carry an
// `isSender: boolean` and an `Entry[]` field, so a literal that names only
// the shared fields would fit two arms. The discriminant is what keeps the
// count at one — and it must keep doing so with the new element rung in
// place, or two of these calls would build as the wrong arm.
console.log(emit({ kind: "reaction", isSender: true, revoked: false, reactions: [{ count: 2 }] }))
console.log(emit({ kind: "poll_vote", isSender: true, votes: [{ count: 2 }] }))
