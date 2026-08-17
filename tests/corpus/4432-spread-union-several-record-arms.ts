// Spreading a source whose type is a union with SEVERAL record arms —
// `{ ...media, viewOnce: true }` where `media` is `Image | Video | Audio`,
// zapo's src/message/encode/content.ts:183. Main lowered the ONE-record-arm
// form (`Partial<X> | undefined`) and refused two or more.
//
// Expected values were read off Node. The one-arm form runs in the same
// program as the CONTROL: it must keep answering exactly as it did.
//
// The source arms' own fields are REQUIRED on purpose. An arm that declares
// an optional field which is ABSENT at run time is a separate, PRE-EXISTING
// divergence (scriptc's record slot always exists and the copy writes its
// undefined; JS's spread copies present keys only) — measured identical on
// the plain-record and one-record-arm paths, so it is not this fixture's
// subject. What IS this fixture's subject: an arm that does not DECLARE the
// field at all must leave the earlier contributor's value alone.
interface Img { kind: "i"; url: string; caption: string }
interface Vid { kind: "v"; seconds: number }
interface Aud { kind: "a"; ptt: boolean }
type Media = Img | Vid | Aud;
interface Out {
  tag?: string;
  kind?: string;
  url?: string;
  seconds?: number;
  ptt?: boolean;
  caption?: string;
  viewOnce?: boolean;
}
const show = (o: Out): string =>
  [o.tag ?? "-", o.kind ?? "-", o.url ?? "-", o.seconds ?? "-", o.ptt ?? "-", o.caption ?? "-", o.viewOnce ?? "-"].join(
    ",",
  );

function wrap(m: Media): Out {
  return { ...m, viewOnce: true };
}
// An arm that does not declare a field leaves the EARLIER contributor's value
// in that slot — which is what JS does, since that arm never carried the key.
function over(base: Out, m: Media): Out {
  return { ...base, ...m };
}
// CONTROL: the single-record-arm form main already lowered.
function oneArm(m: Img | undefined): Out {
  return { tag: "t", ...m, viewOnce: true };
}

const img: Media = { kind: "i", url: "u", caption: "cap" };
const vid: Media = { kind: "v", seconds: 3 };
const aud: Media = { kind: "a", ptt: true };
for (const m of [img, vid, aud]) console.log("wrap  ", show(wrap(m)));
const filled: Out = { tag: "t", url: "old", seconds: 9, ptt: false, caption: "oldcap" };
for (const m of [img, vid, aud]) console.log("over  ", show(over(filled, m)));
for (const m of [img, vid, aud]) console.log("overE ", show(over({ tag: "t" }, m)));
console.log("1arm  ", show(oneArm({ kind: "i", url: "u", caption: "c1" })));
console.log("1armU ", show(oneArm(undefined)));
// The source evaluates exactly once even though several fields read it.
let reads = 0;
function pick(m: Media): Media {
  reads++;
  return m;
}
const src = pick(vid);
console.log("once  ", show({ ...src, viewOnce: true }), reads);
// Nested: the spread result is itself spread into a wider record.
console.log("nested", show({ ...over(filled, aud), caption: "z" }));
// A two-arm union where the arms share a field: the shared name takes its
// value from whichever arm the source holds.
interface P { kind: "p"; who: string }
interface Q { kind: "q"; who: string; extra: number }
function shared(m: P | Q): Out & { who?: string; extra?: number } {
  return { tag: "t", ...m };
}
console.log("shared", JSON.stringify(shared({ kind: "p", who: "pp" })));
console.log("shared", JSON.stringify(shared({ kind: "q", who: "qq", extra: 5 })));
