// The two INDEPENDENTLY SUFFICIENT decliners at zapo's
// `src/message/encode/content.ts:183`, pinned so the next block inherits a
// measurement instead of a sentence.
//
// The site is `if (media) return { ...message, [field]: { ...media, viewOnce: true } }`
// inside a `for (const field of VIEW_ONCE_MEDIA_FIELDS)` over an `as const`
// tuple, so `field` is a union of string LITERALS and `media = message[field]`
// is a union of the field types.
//
// `estado-eleven` §7.5 priced this row as "the write-side mirror ... worth -1".
// `estado-zaposrc` §7.4 re-priced it as the general computed-property-key
// feature with two decliners, but measured the second one on a REDUCTION and
// wrote that whether it stands at the real site is "UNMEASURED until the key
// is fixed". It is measured now, at the real site, against zapo's real
// `Proto.IMessage` (repro-fv/lab/f1-realsite.ts, f2-statickey.ts,
// f3-staticnonunion.ts -- f1 fences on the key, f2 removes ONLY the key and
// fences on the spread, f3 removes both and is CLEAN, with the other sixteen
// real-zapo diagnostics identical across all three so the verdict is
// attributable). BOTH decliners are real and either alone is enough.
//
// A third fact the board does not carry: zapo has TWO computed-key sites, and
// the other one -- `WaAppStateMutationCoordinator.ts:205`, `{ [field]: encoded }`
// where `field: string | null` -- is a MUST-NOT-CLOSE row. So a computed-key
// rule has to distinguish them. It can: `:183`'s key is a union of string
// literals and `:205`'s is plain `string`, which is `wrapA` vs `wrapD` below.

interface Img { url?: string; viewOnce?: boolean }
interface Vid { seconds?: number; viewOnce?: boolean }
interface Aud { ptt?: boolean; viewOnce?: boolean }
interface Msg { imageMessage?: Img; videoMessage?: Vid; audioMessage?: Aud; conversation?: string }

const FIELDS = ["imageMessage", "videoMessage", "audioMessage"] as const;

// A — the real site verbatim. DECLINER 1 (the computed key) refuses FIRST and
// the lowering stops, which is why decliner 2 is invisible here.
export function wrapA(m: Msg): Msg {
  for (const field of FIELDS) {
    const media = m[field];
    if (media) return { ...m, [field]: { ...media, viewOnce: true } };
  }
  return m;
}

// B — the SAME site with the key made STATIC and nothing else changed.
// DECLINER 2, at the real site's slot shape: a single record slot, so the
// refusal is the per-field merge's, not the union-typed-slot fence in C.
export function wrapB(m: Msg): Msg {
  for (const field of FIELDS) {
    const media = m[field];
    if (media) return { ...m, imageMessage: { ...media, viewOnce: true } };
  }
  return m;
}

// C — decliner 2's OTHER spelling, when the slot is itself union-typed. This
// is the one `estado-zaposrc` §7.4 case 5 measured; both exist and which one
// fires depends on the slot, which is why a reduction can name the wrong one.
interface Msg2 { media?: Img | Vid | Aud; conversation?: string }
export function wrapC(m: Msg2): Msg2 {
  const media = m.media;
  if (media) return { ...m, media: { ...media, viewOnce: true } };
  return m;
}

// D — the must-not-close sibling: a runtime `string` key into a SIGNATURE-FREE
// record, which is what `WaAppStateMutationCoordinator.ts:205` is (it returns
// `Proto.ISyncActionValue`, a fixed shape). It must KEEP its refusal through
// any fix that closes A. The return type matters: give this a
// `Record<string, unknown>` instead and it COMPILES, because an index-signature
// target takes the merge path -- which is exactly the mistake that makes a
// control inert without making it look wrong.
export function wrapD(m: Msg, field: string): Msg {
  return { [field]: m.conversation } as Msg;
}

// E — CONTROL: both decliners removed. E must NOT appear in the snapshot; if
// it ever does, A and B stopped being attributable to the two constructs.
export function wrapE(m: Msg): Msg {
  const media = m.imageMessage;
  if (media) return { ...m, imageMessage: { ...media, viewOnce: true } };
  return m;
}

console.log(wrapA({}), wrapB({}), wrapC({}), wrapD({}, "k"), wrapE({}));
