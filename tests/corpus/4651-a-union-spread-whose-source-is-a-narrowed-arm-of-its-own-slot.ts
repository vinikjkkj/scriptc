// `content = { ...content, media: normalized, mimetype: VOICE_NOTE_MIMETYPE }`
// — zapo's `src/client/messaging/messages.ts:497`, the SC2003 row, and the one
// union-slot spread neither the identity rule nor the by-NAME pairing could
// build.
//
// The relation is CONTAINMENT, and the instrument already had a name for it.
// Measured on the real TU at 91bbd897 with SCRIPTC_UNIONSLOT_WHY=1, the site
// reports `ARMS=subset`, `pairedByNames=5/5`, `fieldDeltas=0` — and then
// `NOT-CLOSED=arms-not-paired`, because `pairArmsByFieldName` opened with
// `srcIds.length !== ctxIds.length` and the source is the SLOT's union minus
// the arm an early `return` already excluded:
//
//     srcShapes=[r11,r3,r5,r7,r9]        (content narrowed: not 'sticker-pack')
//     ctxShapes=[r0,r11,r3,r5,r7,r9]     (the parameter's declared type)
//
// Five shapes against six, the five IDENTICAL. So the arm a branch builds is
// the arm the source holds and nothing whatever is chosen — this is the
// identity fast path with a narrowed source, not a second rule, and it is
// strictly safer than the by-name pairing it now precedes.
//
// FOUR things have to hold at once and this file pins all four:
//
//   * THE ZAPO SHAPE — a sub-union source, two plain overrides declared by
//     every arm on both sides. `normalize`.
//   * THE SHAPE COLLISION, which is the reason this rule must not be built
//     out of field NAMES. zapo's `WaSendVideoMessage` and `WaSendPtvMessage`
//     both extend `UserMediaFields<Proto.Message.IVideoMessage>` and differ
//     only in a string-LITERAL discriminant, so they carry one field-name set
//     — `pairArmsByFieldName` would call that ambiguous — and they intern to
//     ONE record shape and ONE union arm. `Vid`/`Ptv` below are that pair.
//     The discriminant is a FIELD, copied from the source like every other,
//     so a ptv rebuilds as a ptv; a rule that rebuilt the arm from its
//     declared type instead would silently turn every ptv into a video.
//     Every call prints `type` first, so that swap is a differing line.
//   * THE ARMS THE SOURCE CANNOT BE are never built. `Pack` is in the slot
//     and not in the source, and its own required field (`name`) is on no
//     other arm — a rebuild that reached it would have nothing to put there.
//   * THE SOURCE IS EVALUATED ONCE. The desugar dispatches on the tag and
//     re-reads a hidden local per arm.

// The arms are declared FLAT, not through a shared `extends Base`, and the
// field order below is the order the values are built in. Node's
// JSON.stringify follows the object's INSERTION order (a spread inserts the
// source's keys in the source's order, and an override replaces in place);
// scriptc's follows the interned SHAPE's field order, which puts a member
// declared on the interface itself ahead of one it inherits. With no
// inheritance the two orders are the same order, so a differing line means a
// differing VALUE — which is what this file is for. (Measured the other way
// round first: with `extends Base` every line diverged on key order alone.)

interface Img {
    readonly type: "image";
    readonly media: string;
    readonly mimetype: string;
    readonly jpegThumbnail?: string;
}

// Vid and Ptv are the collision: identical field NAMES, identical field
// types, differing only in the literal type of `type`. One interned shape.
interface Vid {
    readonly type: "video";
    readonly media: string;
    readonly mimetype: string;
    readonly gifPlayback?: boolean;
}

interface Ptv {
    readonly type: "ptv";
    readonly media: string;
    readonly mimetype: string;
    readonly gifPlayback?: boolean;
}

interface Aud {
    readonly type: "audio";
    readonly media: string;
    readonly mimetype: string;
    readonly ptt?: boolean;
}

interface Doc {
    readonly type: "document";
    readonly media: string;
    readonly mimetype: string;
    readonly fileName?: string;
}

interface Stk {
    readonly type: "sticker";
    readonly media: string;
    readonly mimetype: string;
    readonly isAnimated?: boolean;
}

// The arm the early return excludes — in the SLOT and not in the source.
interface Pack {
    readonly type: "sticker-pack";
    readonly media: string;
    readonly mimetype: string;
    readonly name: string;
}

type Send = Img | Vid | Ptv | Aud | Doc | Stk | Pack;

function show(c: Send): string {
    return JSON.stringify(c);
}

// zapo's site verbatim: the early return narrows the parameter, the literal
// spreads the NARROWED value, and the assignment target is the parameter's
// own DECLARED type — the six-arm slot against the five-arm source.
function normalize(content: Send, normalized: string): string {
    if (content.type === "sticker-pack") {
        return "pack:" + content.name;
    }
    content = { ...content, media: normalized, mimetype: "audio/ogg; codecs=opus" };
    return show(content);
}

const img: Send = { type: "image", media: "i.jpg", mimetype: "image/jpeg", jpegThumbnail: "t" };
const vid: Send = { type: "video", media: "v.mp4", mimetype: "video/mp4", gifPlayback: false };
const ptv: Send = { type: "ptv", media: "p.mp4", mimetype: "video/mp4", gifPlayback: true };
const aud: Send = { type: "audio", media: "a.ogg", mimetype: "audio/mp4", ptt: true };
const doc: Send = { type: "document", media: "d.pdf", mimetype: "application/pdf", fileName: "d" };
const stk: Send = { type: "sticker", media: "s.webp", mimetype: "image/webp", isAnimated: true };
const pack: Send = { type: "sticker-pack", media: "z.zip", mimetype: "application/zip", name: "np" };

console.log(normalize(img, "N1"));
console.log(normalize(vid, "N2"));
console.log(normalize(ptv, "N3"));
console.log(normalize(aud, "N4"));
console.log(normalize(doc, "N5"));
console.log(normalize(stk, "N6"));
console.log(normalize(pack, "N7"));

// The collision, on its own and read BACK through the discriminant rather
// than through JSON: a ptv that came out a video would take the other branch.
function kindOf(c: Send, normalized: string): string {
    if (c.type === "sticker-pack") {
        return "pack";
    }
    const out: Send = { ...c, media: normalized, mimetype: "x/y" };
    if (out.type === "ptv") {
        return "ptv-stays-ptv";
    }
    if (out.type === "video") {
        return "video-stays-video";
    }
    return "other:" + out.type;
}

console.log(kindOf(vid, "K1"), kindOf(ptv, "K2"), kindOf(img, "K3"));

// The same two through the same function twice, so a rule that memoised the
// first arm it saw would answer the second call wrong.
console.log(kindOf(ptv, "K4"), kindOf(vid, "K5"));

// A field the literal does NOT override survives per arm, including the
// OPTIONAL one that only one arm declares.
console.log(kindOf(stk, "K6"), show(vid), show(ptv));

// ── the source is evaluated ONCE ────────────────────────────────────────

let reads = 0;

function pick(which: number): Send {
    reads += 1;
    if (which === 0) {
        return img;
    }
    if (which === 1) {
        return ptv;
    }
    return aud;
}

console.log(normalize(pick(0), "P0"), "reads=" + String(reads));
console.log(normalize(pick(1), "P1"), "reads=" + String(reads));
console.log(normalize(pick(2), "P2"), "reads=" + String(reads));

// ── the by-NAME path is untouched ───────────────────────────────────────
// Equal-sized arm lists whose shapes differ (the 4621 relation) still pair by
// field name. Generalising a rule is the classic way to lose its base case.

interface SongIn {
    readonly title: string;
    readonly bitrate: number;
    readonly tag: string;
}

interface ClipIn {
    readonly title: string;
    readonly bitrate: number;
    readonly frames: number;
    readonly tag: string;
}

interface SongOut {
    readonly title: string;
    readonly bitrate: number | null;
    readonly tag: string;
}

interface ClipOut {
    readonly title: string;
    readonly bitrate: number | null;
    readonly frames: number;
    readonly tag: string;
}

function wrapWidened(x: SongIn | ClipIn): SongOut | ClipOut {
    return { ...x, tag: "done" };
}

console.log(JSON.stringify(wrapWidened({ title: "s", bitrate: 320, tag: "raw" })));
console.log(JSON.stringify(wrapWidened({ title: "c", bitrate: 96, frames: 24, tag: "raw" })));

// ── THE REAL messages.ts:497: a ONE-ARM source ──────────────────────────
// The measurement that matters, and it is not what the surveys recorded.
// zapo's narrowing is not the early `return` above — it is a user type
// PREDICATE one line earlier:
//
//     shouldNormalizeVoiceNote(media, content): content is
//         WaSendMediaMessage & { type: 'audio' }
//
// so at `:497` the spread source is ONE arm while the slot is still the
// parameter's declared six. The literal's own type therefore merges to ONE
// record, the union-slot branch of `lowerObjectLiteral` is unreachable
// (measured: `OBJLIT messages.ts@18490 ctx0=WaSendMediaMessage ctxUnion=u893
// arms=6 recArms=6 mapped=record#r2429`), and the refusal arrives a frame
// later at `coerceInto`/`requireExactShape` — which is why every prior report
// named requireExactShape as the decliner.
//
// What makes it REFUSE rather than pick, and what this section reproduces:
// the arms all come from `UserMediaFields<Proto.Message.I*Message>`, so their
// optional field sets overlap and the merged record width-lifts into FIVE of
// the six arms. `Media` below is `string | Uint8Array` for exactly that
// reason — with a single-typed `media` the merged record is IDENTICAL to the
// audio arm and coerceInto finds its one arm without help, which is how the
// first two reductions of this site quietly failed to reproduce it at all.
//
// A one-arm source needs no tag test and invents nothing: the arm is known at
// compile time. `arms=1 srcUnion=null pairs=[r0->r0]`.

type Media = string | Uint8Array;

interface AudN { readonly type: "audio"; readonly media: Media; readonly mimetype: string; readonly ptt?: boolean }
interface ImgN { readonly type: "image"; readonly media: Media; readonly mimetype: string; readonly ptt?: boolean; readonly jpegThumbnail?: string }
interface VidN { readonly type: "video"; readonly media: Media; readonly mimetype: string; readonly ptt?: boolean; readonly gifPlayback?: boolean }
interface DocN { readonly type: "document"; readonly media: Media; readonly mimetype: string; readonly ptt?: boolean; readonly fileName?: string }

type SendN = AudN | ImgN | VidN | DocN;

function isVoiceNote(c: SendN): c is SendN & { type: "audio" } {
    return c.type === "audio" && c.ptt === true;
}

function mediaText(m: Media): string {
    return typeof m === "string" ? m : "bytes:" + String(m.length);
}

function describe(c: SendN): string {
    let extra = "-";
    if (c.type === "image") {
        extra = "jpeg=" + String(c.jpegThumbnail);
    } else if (c.type === "video") {
        extra = "gif=" + String(c.gifPlayback);
    } else if (c.type === "document") {
        extra = "file=" + String(c.fileName);
    } else {
        extra = "ptt=" + String(c.ptt);
    }
    return c.type + " " + mediaText(c.media) + " " + c.mimetype + " " + extra;
}

function normalizeVoice(content: SendN, normalized: string): string {
    if (isVoiceNote(content)) {
        content = { ...content, media: normalized, mimetype: "audio/ogg; codecs=opus" };
    }
    return describe(content);
}

console.log(normalizeVoice({ type: "audio", media: "a.ogg", mimetype: "audio/mp4", ptt: true }, "V1"));
console.log(normalizeVoice({ type: "audio", media: "b.ogg", mimetype: "audio/mp4", ptt: false }, "V2"));
console.log(normalizeVoice({ type: "audio", media: new Uint8Array([1, 2, 3]), mimetype: "audio/mp4", ptt: true }, "V3"));
console.log(normalizeVoice({ type: "image", media: "i.jpg", mimetype: "image/jpeg", jpegThumbnail: "t" }, "V4"));
console.log(normalizeVoice({ type: "video", media: "v.mp4", mimetype: "video/mp4", gifPlayback: true }, "V5"));
console.log(normalizeVoice({ type: "document", media: "d.pdf", mimetype: "application/pdf", fileName: "d" }, "V6"));

// The rebuilt value must still be the AUDIO arm and nothing else: read it
// back through the discriminant, not through a printer.
function armAfter(content: SendN, normalized: string): string {
    if (isVoiceNote(content)) {
        const out: SendN = { ...content, media: normalized, mimetype: "audio/ogg" };
        return "rebuilt-as:" + out.type;
    }
    return "untouched:" + content.type;
}

console.log(armAfter({ type: "audio", media: "a.ogg", mimetype: "audio/mp4", ptt: true }, "W1"));
console.log(armAfter({ type: "video", media: "v.mp4", mimetype: "video/mp4" }, "W2"));
