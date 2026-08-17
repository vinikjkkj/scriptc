// Spreading a union source into a union-typed slot whose record arms ARE the
// source's record arms — the IDENTITY arm relation, zapo's
// `src/message/addons/link-preview/fetcher.ts:92`:
//
//     thumbnail = {
//         ...fetched,
//         ...(parsed.imageWidth  !== undefined ? { width:  parsed.imageWidth  } : {}),
//         ...(parsed.imageHeight !== undefined ? { height: parsed.imageHeight } : {})
//     }
//
// where `fetched` is `WaLinkPreviewThumbnailInput` (a two-record-arm union) and
// `thumbnail` is that same union `| undefined`. The union-typed-slot fence
// refused the whole family — "the source's arm decides which arm the literal
// builds, and a literal builds one shape" — which is true, and is exactly why
// THIS relation has an answer: the arm to build is the arm the source already
// holds, so the desugar dispatches on the source's own tag and rebuilds that
// arm. Nothing is invented.
//
// The gate is arm IDENTITY. The three OTHER union-typed-slot sites in zapo
// (content.ts:183, incoming.ts:397, mex-notification.ts:192) are all
// ARMS=disjoint and must stay refused; tests/diagnostics/union-spread-into-
// union-slot.ts is their pin, and it is unchanged.
//
// Expected values were read off Node. Nothing here ENUMERATES a record
// (Object.keys / JSON.stringify over an arm with an absent optional field is a
// separate, pre-existing divergence — scriptc's slot always exists and holds
// undefined where JS omits the key — and it is not this fixture's subject).

interface Bytes {
  readonly bytes: string;
  readonly width?: number;
  readonly height?: number;
}
interface Stream {
  readonly stream: string;
  readonly contentLength: number;
  readonly width?: number;
  readonly height?: number;
}
type Thumb = Bytes | Stream;

interface Meta {
  readonly imageWidth?: number;
  readonly imageHeight?: number;
}

function show(t: Thumb | undefined): string {
  if (t === undefined) return "undefined";
  const w = t.width === undefined ? "-" : String(t.width);
  const h = t.height === undefined ? "-" : String(t.height);
  if ("bytes" in t) return `bytes:${t.bytes} w=${w} h=${h}`;
  return `stream:${t.stream}/${String(t.contentLength)} w=${w} h=${h}`;
}

// fetcher.ts:91-95, verbatim in shape: the ASSIGNMENT form, into a `let` whose
// declared slot carries the union plus a unit arm the checker has narrowed
// away at the spread. Every added name arrives through a CONDITIONAL spread.
function wrap(fetched: Thumb | undefined, parsed: Meta): Thumb | undefined {
  let thumbnail: Thumb | undefined;
  if (fetched !== undefined) {
    thumbnail = {
      ...fetched,
      ...(parsed.imageWidth !== undefined ? { width: parsed.imageWidth } : {}),
      ...(parsed.imageHeight !== undefined ? { height: parsed.imageHeight } : {}),
    };
  }
  return thumbnail;
}

const b: Thumb = { bytes: "B" };
const bwh: Thumb = { bytes: "B2", width: 1, height: 2 };
const s: Thumb = { stream: "S", contentLength: 7 };
const swh: Thumb = { stream: "S2", contentLength: 8, width: 3, height: 4 };

console.log("1", show(wrap(b, {})));
console.log("2", show(wrap(b, { imageWidth: 10 })));
console.log("3", show(wrap(b, { imageWidth: 10, imageHeight: 20 })));
console.log("4", show(wrap(bwh, {})));
console.log("5", show(wrap(bwh, { imageWidth: 10 })));
console.log("6", show(wrap(s, {})));
console.log("7", show(wrap(s, { imageHeight: 20 })));
console.log("8", show(wrap(swh, { imageWidth: 10, imageHeight: 20 })));
console.log("9", show(wrap(undefined, { imageWidth: 10 })));

// The RETURN form, into the bare union (no unit arm on either side).
function retag(t: Thumb): Thumb {
  return { ...t };
}
console.log("10", show(retag(b)), show(retag(swh)));

// A PLAIN property override, unconditional, on a name every arm declares.
function force(t: Thumb, w: number): Thumb {
  return { ...t, width: w };
}
console.log("11", show(force(b, 42)), show(force(swh, 42)));

// Plain and conditional overrides together, and the conditional one FIRST.
function both(t: Thumb, m: Meta): Thumb {
  return { ...t, ...(m.imageWidth !== undefined ? { width: m.imageWidth } : {}), height: 99 };
}
console.log("12", show(both(b, {})), show(both(s, { imageWidth: 5 })));

// THREE arms, one of them wider, and an override on a name all three declare.
interface A3 {
  readonly a: string;
  readonly tag?: string;
}
interface B3 {
  readonly b: number;
  readonly tag?: string;
}
interface C3 {
  readonly c: boolean;
  readonly extra: string;
  readonly tag?: string;
}
type Three = A3 | B3 | C3;
function showThree(t: Three): string {
  const tag = t.tag === undefined ? "-" : t.tag;
  if ("a" in t) return `a:${t.a}/${tag}`;
  if ("b" in t) return `b:${String(t.b)}/${tag}`;
  return `c:${String(t.c)}:${t.extra}/${tag}`;
}
function tagIt(t: Three, want: string | undefined): Three {
  return { ...t, ...(want !== undefined ? { tag: want } : {}) };
}
const t3a: Three = { a: "A" };
const t3b: Three = { b: 5, tag: "kept" };
const t3c: Three = { c: true, extra: "E" };
for (const t of [t3a, t3b, t3c]) console.log("13", showThree(tagIt(t, "T")));
for (const t of [t3a, t3b, t3c]) console.log("14", showThree(tagIt(t, undefined)));

// The source evaluates EXACTLY ONCE even though every field of every arm
// reads it, and it evaluates BEFORE the overrides.
let reads = 0;
const order: string[] = [];
function pick(t: Thumb): Thumb {
  reads++;
  order.push("src");
  return t;
}
console.log("15", show(wrap(pick(swh), { imageWidth: 99 })), reads);

// The override VALUE evaluates only when its condition is true — the ternary
// arms are lazy, exactly as JS's conditional spread is.
let vals = 0;
function vw(m: Meta): number {
  vals++;
  order.push("val");
  return m.imageWidth ?? 0;
}
function lazy(fetched: Thumb, m: Meta): Thumb {
  return { ...fetched, ...(m.imageWidth !== undefined ? { width: vw(m) } : {}) };
}
console.log("16", show(lazy(b, {})), vals);
console.log("17", show(lazy(s, { imageWidth: 5 })), vals);

// The source is evaluated first, then the override value — JS's own order.
order.length = 0;
console.log("18", show(lazy(pick(b), { imageWidth: 3 })), order.join(">"));

// The result of one identity-arm spread feeds the next.
console.log("19", show(force(retag(force(bwh, 7)), 8)));

// REF-COUNTED payloads. zapo's real arms carry a `Uint8Array` and a
// `Readable`, not two strings: the per-arm rebuild READS every field of the
// narrowed source and stores it into a fresh record, so a field whose value is
// a heap object is retained once and released once on each path. A miscount
// here is a leak or a double free, not a wrong string.
interface Blob1 {
  readonly data: Uint8Array;
  readonly tags: readonly string[];
  readonly note?: string;
}
interface Blob2 {
  readonly chunks: readonly Uint8Array[];
  readonly total: number;
  readonly note?: string;
}
type Blob = Blob1 | Blob2;
function showBlob(x: Blob): string {
  const n = x.note === undefined ? "-" : x.note;
  if ("data" in x) return `d[${String(x.data.length)}]:${String(x.data[0] ?? -1)}/${x.tags.join("+")}/${n}`;
  return `c[${String(x.chunks.length)}]/${String(x.total)}/${n}`;
}
function note(x: Blob, s: string | undefined): Blob {
  return { ...x, ...(s !== undefined ? { note: s } : {}) };
}
const bl1: Blob = { data: new Uint8Array([7, 8, 9]), tags: ["a", "b"] };
const bl2: Blob = { chunks: [new Uint8Array([1]), new Uint8Array([2, 3])], total: 3, note: "kept" };
for (let i = 0; i < 3; i++) {
  console.log("20", showBlob(note(bl1, `n${String(i)}`)), showBlob(note(bl2, undefined)));
}
// The rebuilt record's payload must outlive the temporaries the copy made.
const held: Blob[] = [];
for (let i = 0; i < 4; i++) held.push(note(note(bl1, "x"), undefined));
console.log("21", held.length, showBlob(held[3]!));

// CONTROLS that must keep answering exactly as they always have.
// (a) the SINGLE-record-arm union source — the optional-options merge.
interface Opts {
  readonly host: string;
  readonly port: number;
}
function overrides(n: number): { readonly port: number } | undefined {
  return n === 0 ? undefined : { port: 9 };
}
function merge(n: number): Opts {
  return { host: "h", port: 1, ...overrides(n) };
}
console.log("C1", String(merge(0).port), String(merge(1).port));
// (b) a plain RECORD spread into a union-typed slot.
function plain(x: Bytes): Thumb {
  return { ...x, width: 3 };
}
console.log("C2", show(plain({ bytes: "P" })));
// (c) a union spread into a slot the literal fits as ONE arm: the
// single-record-arm rule, untouched.
function narrowed(t: Thumb): string {
  if ("bytes" in t) {
    const copy: Bytes = { ...t, width: 1 };
    return show(copy);
  }
  const copy: Stream = { ...t, height: 2 };
  return show(copy);
}
console.log("C3", narrowed(b), narrowed(s));
