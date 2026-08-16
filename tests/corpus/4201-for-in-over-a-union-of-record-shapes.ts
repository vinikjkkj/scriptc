// `for (const k in v)` where v is a UNION of fixed record shapes.
//
// The single-record for-in has been lowered for a long time: the key list is
// recordKeysArrayCall's interned walk over the shape's declaredOrder, with an
// undefined-armed (optional) field skipped at runtime by its tag — Node's own
// enumerable-own-keys answer under SEMANTICS.md 37. A UNION receiver had no
// answer at all and fenced for the whole statement:
//   SC1052 for-in over 'Media' receivers (records, index-signature shapes,
//          arrays, and globalThis enumerate) is not supported yet
// zapo's `buildMediaMessage` local helper (client/messaging/messages.ts:583)
// spreads a SEVEN-arm `WaSendMediaMessage` exactly this way, and the fence
// throws BEFORE the loop body is lowered, so the body's own diagnostics had
// never been produced by any build.
//
// Every arm of a lowered union carries its own shape, so the answer exists
// per ARM and the tag the value already carries selects it. The receiver
// binds to a hidden local once (JS evaluates the for-in operand once) and the
// key list is a chain of tag tests over the SAME interned per-shape helper —
// not a second stance on which keys a record has.
//
// A UNIT arm contributes an EMPTY list, which is Node exactly: `for (const k
// in undefined) {}` and `for (const k in null) {}` are legal and iterate zero
// times, unlike the `in` OPERATOR, which throws a TypeError on them.
//
// The fence that remains is the point of the rule: a tuple arm, an
// index-signature arm, an accessor-carrying arm, a class arm and an array arm
// each have a per-arm answer that is NOT this walk, and each keeps the SC1052
// it has today.

interface Base {
    readonly media: string;
    readonly fileLength?: number;
    readonly mimetype?: string;
    readonly caption?: string;
}
interface Img extends Base { readonly type: "image"; readonly width?: number; readonly height?: number }
interface Vid extends Base { readonly type: "video"; readonly seconds?: number; readonly gifPlayback?: boolean }
interface Ptv extends Base { readonly type: "ptv"; readonly seconds?: number }
interface Aud extends Base { readonly type: "audio"; readonly ptt?: boolean; readonly seconds?: number }
interface Doc extends Base { readonly type: "document"; readonly fileName?: string }
interface Stk extends Base { readonly type: "sticker"; readonly isAnimated?: boolean }
interface Pack {
    readonly type: "sticker-pack";
    readonly media: string;
    readonly name: string;
    readonly publisher: string;
    readonly mimetype?: string;
    readonly fileLength?: number;
}
type Media = Img | Vid | Ptv | Aud | Doc | Stk | Pack;

// zapo's helper, verbatim in shape.
function spread(c: Media): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const key in c) {
        if (key !== "type" && key !== "media" && key !== "fileLength" && key !== "mimetype") {
            result[key] = (c as unknown as Record<string, unknown>)[key];
        }
    }
    return result;
}

const cases: readonly Media[] = [
    { type: "image", media: "m1", width: 10, height: 20, caption: "hi", mimetype: "image/jpeg" },
    { type: "video", media: "m2", seconds: 3 },
    { type: "ptv", media: "m3" },
    { type: "audio", media: "m4", ptt: true, seconds: 7, fileLength: 99 },
    { type: "document", media: "m5", fileName: "a.pdf", caption: "doc" },
    { type: "sticker", media: "m6", isAnimated: false },
    { type: "sticker-pack", media: "m7", name: "p", publisher: "v", fileLength: 5 },
];
for (const c of cases) {
    console.log(JSON.stringify(spread(c)));
}

// The key list itself, in declaration order, with the optional slots skipped
// by their runtime tag.
type A = { readonly type: "a"; readonly x: number; readonly y?: string };
type B = { readonly type: "b"; readonly z: boolean };
function keys(v: A | B | undefined | null): string {
    const out: string[] = [];
    for (const k in v) out.push(k);
    return "[" + out.join(",") + "]";
}
console.log(keys({ type: "a", x: 1, y: "q" }));
console.log(keys({ type: "a", x: 1 }));
console.log(keys({ type: "b", z: false }));
console.log(keys(undefined));
console.log(keys(null));

// The operand evaluates exactly ONCE, even though the tag chain reads it per
// arm: the receiver binds to a hidden local first.
let effects = 0;
const box: { readonly cur: A | B } = { cur: { type: "b", z: true } };
function pick(): A | B {
    effects += 1;
    return box.cur;
}
let n = 0;
for (const _k in pick()) n += 1;
console.log("effects", effects, "keys", n);

// A single-arm-shaped union still walks per arm, and both arms can share a
// field name without sharing a shape.
type P = { readonly kind: "p"; readonly v: number };
type Q = { readonly kind: "q"; readonly v: string; readonly extra: boolean };
function both(v: P | Q): string {
    const out: string[] = [];
    for (const k in v) out.push(k + "=" + String((v as unknown as Record<string, unknown>)[k]));
    return out.join(";");
}
console.log(both({ kind: "p", v: 1 }));
console.log(both({ kind: "q", v: "s", extra: false }));

// `var` and a pre-declared binding are for-in's other two head forms; both
// ride the same key list.
let shared = "";
const acc: string[] = [];
for (shared in { type: "a", x: 3, y: "t" } as A | B) acc.push(shared);
console.log(acc.join("|"), shared);

// The DECLINE CONTROLS live beside this fixture rather than in it: a tuple
// arm, an index-signature arm, an accessor-carrying arm, a class arm and an
// array arm are HARD compile errors, which a corpus program that must run
// cannot carry. They are `repro-fy/lab/fy17s-declines.ts`, and all five keep
// their SC1052 on this branch.
