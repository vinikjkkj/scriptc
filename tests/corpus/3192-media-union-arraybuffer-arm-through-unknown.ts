// The zapo SHAPE, and the reason this pair of kinds had to land together.
//
// zapo's twenty SC1101 sites are all one type reached from nineteen
// places: a discriminated union of message records, one of whose fields is
//
//     type MediaInput = Uint8Array | ArrayBuffer | Readable | string
//
// flowing into an `unknown` parameter (a `(v: unknown) => v is T` user
// predicate). The compiler's own refusal probe names the SAME three leaves
// at every one of those sites:
//
//     T|record.linkPreview|record.thumbnail|record.stream : childStream
//     T|record.media|bytes                                : bytes  (ArrayBuffer)
//     T|record.media|childStream                          : childStream
//
// Two kinds, never one. Admitting either alone moves nothing, because a
// container refuses when ANY leaf does.
//
// This file owns the ArrayBuffer half and 3193 owns the childStream half,
// and they are split rather than combined for the reason that runs through
// this whole change: the corpus builds against the compiler's shipped
// fallback declarations, where a `Readable` arm written here would be the
// runtime stream CLASS (an SCR_DYN_OBJINST box) and not the childStream
// handle the zapo site has. A combined fixture would look like it covered
// both kinds while covering one of them twice. 3193 reaches the real kind
// the only way that is stable under both declaration sets — through
// `child.stdout`.
//
// What this file does pin, and what a bare-ArrayBuffer test could not, is
// that NOTHING here is a bare value: the ArrayBuffer is a union arm inside
// a record field, and the record is an arm of a wider union, which is
// exactly zapo's shape. A predicate that admitted only the top-level type
// would leave the gate precisely where it was.
import { hkdfSync } from "node:crypto";

type MediaInput = Uint8Array | ArrayBuffer | string;

interface Thumb {
  readonly width: number;
}
interface LinkPreview {
  readonly title: string;
  readonly thumbnail: Thumb;
}
interface SendMedia {
  readonly type: "media";
  readonly media: MediaInput;
  readonly caption?: string;
}
interface SendText {
  readonly type: "text";
  readonly text: string;
  readonly linkPreview: LinkPreview;
}
type Content = SendMedia | SendText;

// The user predicates the real code dispatches with — each takes
// `unknown`, which is what forces the whole union across the boundary.
//
// The tag is read through a NARROW cast, `{ type: string }`, and not
// through `(v as SendMedia).type`. That is not a stylistic preference: in
// this compiler `as` on an `unknown` value is a CHECKED cast that
// validates the whole target shape and throws, where Node erases the
// assertion entirely (a documented divergence). Casting a SendText to
// SendMedia just to read its tag therefore throws
// "expected ArrayBuffer | Uint8Array | string at $.media, got undefined"
// on the very arm the predicate exists to reject. Record checks are
// width-tolerant, so a cast to the tag alone validates against every arm
// and reads the same byte Node reads.
function tagOf(v: unknown): string {
  return (v as { type: string }).type;
}
function isMedia(v: unknown): v is SendMedia {
  return typeof v === "object" && v !== null && tagOf(v) === "media";
}
function isText(v: unknown): v is SendText {
  return typeof v === "object" && v !== null && tagOf(v) === "text";
}

function describe(c: Content): string {
  if (isMedia(c)) {
    const m = c.media;
    // The arm test the two kinds have to keep apart: a Uint8Array must
    // NOT match the ArrayBuffer arm and vice versa. With one shared dyn
    // kind behind both, this test answers by kind alone and gets it
    // wrong — that is the silent wrong answer the split prevents.
    if (typeof m === "string") return `media:string:${m}`;
    if (m instanceof Uint8Array) return `media:u8:${m.length}`;
    return `media:buf:${(m as ArrayBuffer).byteLength}`;
  }
  if (isText(c)) return `text:${c.text}:${c.linkPreview.thumbnail.width}`;
  return "none";
}

const key = new Uint8Array([4]);
const salt = new Uint8Array([1, 2]);
const info = new Uint8Array([3]);

const asBuf: Content = { type: "media", media: hkdfSync("sha256", key, salt, info, 16) };
const asU8: Content = { type: "media", media: new Uint8Array([9, 9, 9]) };
const asStr: Content = { type: "media", media: "https://example.invalid/x.png" };
const asText: Content = {
  type: "text",
  text: "hi",
  linkPreview: { title: "t", thumbnail: { width: 64 } },
};

console.log(describe(asBuf));
console.log(describe(asU8));
console.log(describe(asStr));
console.log(describe(asText));

// The predicates answer over the WHOLE union, including the arms they
// reject — the crossing has to work for every arm, not just the matching
// one, because the refusal was never arm-specific.
for (const c of [asBuf, asU8, asStr, asText]) {
  console.log(isMedia(c), isText(c));
}
