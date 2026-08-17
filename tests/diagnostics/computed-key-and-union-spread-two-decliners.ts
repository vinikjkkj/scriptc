// The decliners at zapo's `src/message/encode/content.ts:183`, pinned so the
// next block inherits a measurement instead of a sentence.
//
// The site is `if (media) return { ...message, [field]: { ...media, viewOnce: true } }`
// inside a `for (const field of VIEW_ONCE_MEDIA_FIELDS)` over an `as const`
// tuple, so `field` is a union of string LITERALS and `media = message[field]`
// is a union of the field types.
//
// THREE layers, in the order the lowering meets them. `estado-fifth` measured
// the first two at the real site and predicted a third one that turned out to
// be a different problem than the one predicted:
//
//   1. THE COMPUTED KEY — `isRuntimeComputedKey`'s sweep. CLOSED: a key whose
//      checker type is a union of string literals, all naming declared
//      fields, folds into one conditional contributor per name. `wrapA` used
//      to stop here.
//   2. THE INNER `...media` SPREAD — the union-source branch's
//      `recArms.length !== 1` guard. CLOSED: the per-target-field
//      `present ? extracted : earlier` ternary generalises to a chain over
//      the arms. `wrapB` used to stop here and now COMPILES, which is why it
//      is gone from this snapshot.
//   3. THE UNION-TYPED SLOT — `{ ...media, viewOnce: true }` has no
//      contextual type in a computed-key position, so its OWN type is a union
//      of one result record per source arm, and a record literal builds one
//      static shape. That is where `wrapA` stops today, at the real site as
//      well as here (measured: zapo's `content.ts:183` moved from col 41 to
//      col 52 and from the computed-key message to this one).
//
//      Layer 3 is NOT free to take. The same fence is the whole reason three
//      must-not-close rows are graded "a wrong answer if forced" —
//      `incoming.ts:397`, `mex-notification.ts:192`, `fetcher.ts:92`, all
//      spreading a multi-arm union into a union slot. A rule broad enough to
//      close this one closes those, and their grade rests on exactly the
//      premise such a rule would remove.
//
// `estado-fifth` §3.4 also predicted a "correlated store" behind the two
// decliners — the union-typed media value going into a single-record slot.
// Measured at the real types, that store is CLEAN (`wrapF`): it is not a
// layer.
//
// And the constraint that decides how the first rule had to be written: zapo
// has TWO computed-key sites, and the other one —
// `WaAppStateMutationCoordinator.ts:205`, `{ [field]: encoded }` where
// `field: string | null` — is a MUST-NOT-CLOSE row. A literal-union gate
// separates them, which is `wrapA` vs `wrapD` below: `:183`'s key is a union
// of string literals, `:205`'s is plain `string`. Measured still refusing at
// the real site, same code and same message.

interface Img { url?: string; viewOnce?: boolean }
interface Vid { seconds?: number; viewOnce?: boolean }
interface Aud { ptt?: boolean; viewOnce?: boolean }
interface Msg { imageMessage?: Img; videoMessage?: Vid; audioMessage?: Aud; conversation?: string }

const FIELDS = ["imageMessage", "videoMessage", "audioMessage"] as const;

// A — the real site verbatim. Layers 1 and 2 are closed, so it now reaches
// LAYER 3: the inner literal's own type is a union of result records.
export function wrapA(m: Msg): Msg {
  for (const field of FIELDS) {
    const media = m[field];
    if (media) return { ...m, [field]: { ...media, viewOnce: true } };
  }
  return m;
}

// B — the same site with the key made STATIC and nothing else changed. This
// was DECLINER 2 and it COMPILES now: with a static key the inner literal has
// the slot as its contextual type, so it is one record shape, and the
// multi-arm union spread lowers. B must stay ABSENT from the snapshot.
export function wrapB(m: Msg): Msg {
  for (const field of FIELDS) {
    const media = m[field];
    if (media) return { ...m, imageMessage: { ...media, viewOnce: true } };
  }
  return m;
}

// C — layer 3 in its own right, with no computed key anywhere: a union source
// spread into a union-typed slot. This is the shape of the three
// must-not-close rows.
interface Msg2 { media?: Img | Vid | Aud; conversation?: string }
export function wrapC(m: Msg2): Msg2 {
  const media = m.media;
  if (media) return { ...m, media: { ...media, viewOnce: true } };
  return m;
}

// D — the must-not-close sibling: a runtime `string` key into a
// SIGNATURE-FREE record. It KEEPS its refusal, and that is the property the
// literal-union gate exists to preserve. The return type matters: give this a
// `Record<string, unknown>` instead and it COMPILES, because an
// index-signature target takes the merge path — which is exactly the mistake
// that makes a control inert without making it look wrong.
export function wrapD(m: Msg, field: string): Msg {
  return { [field]: m.conversation } as Msg;
}

// E — CONTROL: all three layers removed. E must NOT appear in the snapshot.
export function wrapE(m: Msg): Msg {
  const media = m.imageMessage;
  if (media) return { ...m, imageMessage: { ...media, viewOnce: true } };
  return m;
}

// F — the "correlated store" `estado-fifth` predicted as a layer: a
// union-typed media value stored into a single-record slot under a static
// key. It compiles, and must stay absent from the snapshot.
export function wrapF(m: Msg, v: Img | Vid | Aud): Msg {
  return { ...m, imageMessage: v };
}

// G — decliner 1 on its own: a literal-union computed key whose value fits
// every name it can spell. Compiles; must stay absent.
export function wrapG(m: Msg, field: (typeof FIELDS)[number], v: Img | Vid | Aud): Msg {
  return { ...m, [field]: v };
}

console.log(wrapA({}), wrapB({}), wrapC({}), wrapD({}, "k"), wrapE({}), wrapF({}, { url: "u" }), wrapG({}, "imageMessage", { url: "u" }));
