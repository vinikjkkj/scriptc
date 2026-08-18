// `{ ...media, viewOnce: true }` — zapo's `src/message/encode/content.ts:183`,
// and the one union-slot spread the IDENTITY-arm rule could not build.
//
// The identity rule (4-something's `fetcher.ts:92` shape) requires the slot's
// record arms to BE the source's record arms — the very same interned shape
// ids. This site's arms are not: measured on the real 129 MB TU with
// SCRIPTC_UNIONSLOT_WHY=1, the source is `[r209/31, r223/17, r225/31]` and the
// slot is `[r2878/31, r2879/17, r2880/31]` — same field NAMES, same widths,
// three shapes against three, and `pairedByNames=3/3`. The reason the ids
// differ is one field, and the instrument names it:
//
//     fieldDeltas=3[ r209->r2880:viewOnce:boolean | null | undefined=>boolean
//                    r223->r2879:viewOnce:boolean | null | undefined=>boolean
//                    r225->r2878:viewOnce:boolean | null | undefined=>boolean ]
//
// — the OVERRIDDEN field, and nothing else. The source reaches its arms
// through `message[field]`'s narrowed type (where `viewOnce` is the protobuf
// `boolean | null | undefined`); the slot reaches the same declared types
// through the computed-key fold, where the write `viewOnce: true` has fixed
// it at `boolean`. Two internings of one declared type, differing exactly
// where the literal overwrites.
//
// So the rule this file pins is: pair the source's record arms to the slot's
// ONE-TO-ONE by identical field-NAME set, and per arm rebuild the SLOT arm's
// shape out of the narrowed source. Three things have to hold at once and
// this file pins all three against each other:
//
//   * the ZAPO shape — the only differing field is the one the literal
//     overrides, so the reshape is a no-op everywhere else. `wrapViewOnce`.
//   * a differing field the literal does NOT override, which the rebuild has
//     to WIDEN rather than copy (`bitrate: number` read into a
//     `number | null` slot). `wrapWidened`. The identity rule never had to
//     move a field's representation at all, so nothing exercised this.
//   * the IDENTITY case, unchanged, through the conditional-spread spelling
//     that is `fetcher.ts:92`'s. `withOptionalDims`. Generalising a rule is
//     the classic way to lose its base case, and the base case here is a
//     live zapo site.
//
// Every arm's result is JSON-printed in full, so a rebuild that dropped a
// field, carried the WRONG arm's field, or picked the wrong slot tag shows up
// as a differing line rather than as a differing type.

interface ImageMedia {
    readonly url: string;
    readonly width: number;
    readonly viewOnce?: boolean | null;
}

interface AudioMedia {
    readonly url: string;
    readonly seconds: number;
    readonly ptt: boolean;
    readonly viewOnce?: boolean | null;
}

interface VideoMedia {
    readonly url: string;
    readonly width: number;
    readonly gif: boolean;
    readonly viewOnce?: boolean | null;
}

// The SLOT arms: the same three field-name sets, with `viewOnce` fixed at a
// plain boolean — which is what makes these three shapes intern apart from
// the three above, and is exactly the delta measured at content.ts:183.
interface ImageOut {
    readonly url: string;
    readonly width: number;
    readonly viewOnce: boolean;
}

interface AudioOut {
    readonly url: string;
    readonly seconds: number;
    readonly ptt: boolean;
    readonly viewOnce: boolean;
}

interface VideoOut {
    readonly url: string;
    readonly width: number;
    readonly gif: boolean;
    readonly viewOnce: boolean;
}

function wrapViewOnce(media: ImageMedia | AudioMedia | VideoMedia): ImageOut | AudioOut | VideoOut {
    return { ...media, viewOnce: true };
}

const img: ImageMedia = { url: "i.jpg", width: 640 };
const aud: AudioMedia = { url: "a.ogg", seconds: 12, ptt: true, viewOnce: null };
const vid: VideoMedia = { url: "v.mp4", width: 1280, gif: false, viewOnce: false };

console.log(JSON.stringify(wrapViewOnce(img)));
console.log(JSON.stringify(wrapViewOnce(aud)));
console.log(JSON.stringify(wrapViewOnce(vid)));

// The same three sources through the same function twice, so a rule that
// somehow memoised the first arm it saw would answer the second call wrong.
console.log(JSON.stringify(wrapViewOnce(vid)));
console.log(JSON.stringify(wrapViewOnce(img)));

// ── a differing field the literal does NOT override ─────────────────────
// `bitrate` is `number` on the source side and `number | null` on the slot
// side, so the per-arm rebuild has to widen the read into the slot's union
// arm. Nothing in the identity rule ever moved a field's representation.

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

const song: SongIn = { title: "s", bitrate: 320, tag: "raw" };
const clip: ClipIn = { title: "c", bitrate: 96, frames: 24, tag: "raw" };

console.log(JSON.stringify(wrapWidened(song)));
console.log(JSON.stringify(wrapWidened(clip)));

// The widened field is a real union at run time, not a coincidence of
// printing: read it back and branch on the null arm.
function bitrateOf(x: SongOut | ClipOut): string {
    return x.bitrate === null ? "none" : String(x.bitrate);
}

console.log(bitrateOf(wrapWidened(song)), bitrateOf(wrapWidened(clip)));

// ── the IDENTITY case must still build ──────────────────────────────────
// `fetcher.ts:92`'s spelling: a plain spread first, then single-property
// CONDITIONAL spreads. The slot's arms are the source's own arms here, so
// this is the pairing rule's fast path and it must not have moved.

interface Thumb {
    readonly data: string;
    readonly width?: number;
    readonly height?: number;
}

interface ThumbSized {
    readonly data: string;
    readonly kind: string;
    readonly width?: number;
    readonly height?: number;
}

function withOptionalDims(
    t: Thumb | ThumbSized,
    w: number | undefined,
    h: number | undefined,
): Thumb | ThumbSized {
    return {
        ...t,
        ...(w !== undefined ? { width: w } : {}),
        ...(h !== undefined ? { height: h } : {}),
    };
}

const bare: Thumb = { data: "d0" };
const sized: ThumbSized = { data: "d1", kind: "png", width: 1, height: 2 };

console.log(JSON.stringify(withOptionalDims(bare, 10, undefined)));
console.log(JSON.stringify(withOptionalDims(bare, undefined, 20)));
console.log(JSON.stringify(withOptionalDims(sized, 30, 40)));
console.log(JSON.stringify(withOptionalDims(sized, undefined, undefined)));

// ── the source is evaluated ONCE ────────────────────────────────────────
// The desugar dispatches on the source's tag and re-reads it per arm, so a
// source with a side effect must still run exactly once. A rule that
// re-lowered the spread expression inside every branch would print the
// counter more than once per call and JS prints it once.

let reads = 0;

function pick(which: number): ImageMedia | AudioMedia | VideoMedia {
    reads += 1;
    if (which === 0) return img;
    if (which === 1) return aud;
    return vid;
}

console.log(JSON.stringify(wrapViewOnce(pick(0))), "reads=" + String(reads));
console.log(JSON.stringify(wrapViewOnce(pick(1))), "reads=" + String(reads));
console.log(JSON.stringify(wrapViewOnce(pick(2))), "reads=" + String(reads));
