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
//      Layer 3 is CLOSED NOW, and `wrapA` is GONE from this snapshot. Read
//      the history, because this comment has said the opposite twice.
//
//      The fence's four zapo rows split by ARM RELATION
//      (SCRIPTC_UNIONSLOT_WHY=1), not by spelling. `fetcher.ts:92` is
//      ARMS=identity — the slot's record arms ARE the source's — while
//      `content.ts:183`, `incoming.ts:397` and `mex-notification.ts:192`
//      are ARMS=disjoint. But `disjoint` groups two different things, and
//      the second fingerprint separates them: `content.ts:183` pairs
//      3/3 BY FIELD NAME while the other two pair 0/8 and 0/7. Same names,
//      different interned shapes, against slot arms that are records five
//      fields wider than anything the source holds.
//
//      So the rule is pairing, not identity: pair the arms one-to-one by
//      field-NAME set, totally and unambiguously, and rebuild the SLOT
//      arm's shape per arm. `wrapA` here is exactly `content.ts:183`'s
//      shape — its slot arms make `viewOnce` REQUIRED where the source arms
//      have it optional, which is one differing field and it is the field
//      the literal OVERRIDES — so it builds, and its absence from the
//      snapshot is the pin. `incoming.ts:397` and `mex-notification.ts:192`
//      keep their refusal: no pairing exists for them at all.
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
// spread into a union-typed slot whose record arms ARE the source's arms.
// C was in this snapshot and is GONE, and its absence is the pin: this is the
// ARMS=identity relation — zapo's `fetcher.ts:92`, not the other three — and
// the identity-arm rule builds it. An earlier revision of this comment called
// C "the shape of the three must-not-close rows"; measured, it is the shape of
// exactly ONE of them, and A above is the shape of the other kind.
interface Msg2 { media?: Img | Vid | Aud; conversation?: string }
export function wrapC(m: Msg2): Msg2 {
  const media = m.media;
  if (media) return { ...m, media: { ...media, viewOnce: true } };
  return m;
}

// D — a runtime `string` key into a SIGNATURE-FREE record. It KEEPS its
// refusal, and the snapshot still pins that — but READ THE CODE IT PINS,
// because the mechanism changed and this comment used to claim the wrong
// one. It said the literal-union gate is what preserves the refusal here.
// It is not, any more.
//
// `unionKeyNames` now has a second way to obtain candidates when the key
// type has no finite name set: the TARGET's declared fields (block/lastrow,
// with :1116 — together they are the ninth `iq w:sync:app:state`). So the
// key no longer stops D. What stops D is the VALUE: `m.conversation` is
// `string | undefined` and the media slots this key can spell hold
// `{ ptt; viewOnce } | undefined`, so the fold's per-candidate fit check
// refuses — SC2003 at the value, where it used to be SC1090 at the key.
//
// THAT MAKES D A CONTROL CARRIED BY ITS FIELD TYPES, not by a gate, which
// is the inertness its own last sentence warned about. So the real
// behaviour is pinned here as prose instead, measured, the way 3351 pins
// its negative controls (a diverging program cannot be a corpus entry):
//
//   interface Msg3 { conversation?: string; caption?: string; title?: string }
//   function wrapD3(m: Msg3, field: string): Msg3 {
//     return { [field]: m.conversation } as Msg3;   // value fits EVERY slot
//   }
//
//   wrapD3(m, "caption")    Node {"caption":"hello"}    scriptc SAME
//   wrapD3(m, "title")      Node {"title":"hello"}      scriptc SAME
//   wrapD3(m, "notAField")  Node {"notAField":"hello"}  scriptc {}
//
// The third line is DIVERGENCE 68 and it is the price of closing :205: a
// key naming no declared field has no slot in a monomorphic struct, and
// dropping it is honest exactly because the program DECLARED the target as
// `Msg3` — the `shapeDeclared` gate the rule sits behind. Give D a
// `Record<string, unknown>` return instead and it has always compiled, by
// the index-signature merge path.
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
