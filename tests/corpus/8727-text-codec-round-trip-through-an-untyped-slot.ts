// A TextEncoder / TextDecoder is the string "utf-8" on the static side, and
// the boundary now boxes one as an object when it crosses into an untyped
// slot (see 8721). The way BACK has to take the object for what it was: a
// statically typed slot that receives it through `any` — a typed
// declaration, a record field, a union arm, an array element — must still
// work, where the string check refused the box ("expected string at $, got
// TextEncoder") and a program that round-trips a codec stopped running.
function box(x: any): any { return x; }

const e: TextEncoder = box(new TextEncoder());
const d: TextDecoder = box(new TextDecoder());
console.log(d.decode(e.encode("héllo \u{1F600}")));

const maybe: TextEncoder | null = box(new TextEncoder());
console.log(maybe === null ? "null" : maybe.encode("ab").length);

const holder: { enc?: TextEncoder; dec: TextDecoder } = box({ enc: new TextEncoder(), dec: new TextDecoder() });
console.log(holder.enc ? holder.dec.decode(holder.enc.encode("record")) : "none");

const list: TextDecoder[] = box([new TextDecoder(), new TextDecoder()]);
console.log(list.length, list[1]!.decode(new Uint8Array([104, 105])));

// a codec stored, boxed twice, and used on both sides of the boundary
const shared = new TextEncoder();
const viaAny: any = shared;
console.log(viaAny.encode("x").length, shared.encode("yz").length);
function typed(t: TextEncoder): number { return t.encode("typed").length; }
console.log(typed(box(shared)));
