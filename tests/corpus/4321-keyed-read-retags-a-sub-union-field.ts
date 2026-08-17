// `r[k]` where k's checker type is a UNION of string literals naming declared
// fields, and a named field's own type is a SUB-UNION of the access's result.
//
// The dispatch route for literal-union keys already existed, but it required
// each named field's type to BE one arm of the result union, so it only ever
// fired on the registry shape (`stores: StoreA`, `caches: CacheB`). Every
// record with OPTIONAL fields fails that: `imageMessage?: IImage | null` has
// type `IImage | null | undefined`, which is a sub-union of the result
// `IImage | IVideo | IAudio | null | undefined` and not an arm of it, so
// `armTag` answered -1 and the read fell out to
// `SC1090 dynamic keyed reads of '<the whole record>' (the declared fields
// have no one common type)`.
//
// The payload is now re-tagged ARM BY ARM, and only when the map is TOTAL —
// every arm of the field's union is an arm of the result. A partial map
// would need a fall-through, and a fall-through here would be an UNCODED
// runtime TypeError standing exactly where a coded fence used to be.
//
// Every case below is what Node answers, enumerated from the language and
// not from the lowering: a present object field, a field holding null, a
// field holding an explicit undefined, an ABSENT optional field, identity
// preservation through the read, and a read whose result is immediately
// narrowed. The registry shape that already worked is carried as a control.

// --- the row: sub-union field types, three different record arms ------------
interface IImage { url?: string | null; viewOnce?: boolean | null }
interface IVideo { url?: string | null; seconds?: number | null }
interface IAudio { ptt?: boolean | null }
interface IMsg {
  imageMessage?: IImage | null;
  videoMessage?: IVideo | null;
  ptvMessage?: IVideo | null;
  audioMessage?: IAudio | null;
  conversation?: string | null; // NOT named by the key: the field that makes
                                // the whole-shape "one common type" test fail
}
const MEDIA = ["imageMessage", "videoMessage", "ptvMessage", "audioMessage"] as const;

function firstMediaKey(m: IMsg): string {
  for (const field of MEDIA) {
    const media = m[field];
    if (media) return field;
  }
  return "none";
}
console.log("first:", firstMediaKey({ videoMessage: { url: "v" } }));
console.log("first:", firstMediaKey({ audioMessage: { ptt: true } }));
console.log("first:", firstMediaKey({ conversation: "hi" }));
console.log("first:", firstMediaKey({ imageMessage: { url: "i" }, videoMessage: { url: "v" } }));

// --- each arm of the sub-union, read back through JSON ----------------------
function readOne(m: IMsg, field: (typeof MEDIA)[number]): string {
  return JSON.stringify(m[field] ?? "MISSING");
}
const present: IMsg = { imageMessage: { url: "i", viewOnce: true } };
const nulled: IMsg = { imageMessage: null };
const undef: IMsg = { imageMessage: undefined };
const absent: IMsg = {};
console.log("present:", readOne(present, "imageMessage"));
console.log("null:", readOne(nulled, "imageMessage"));
console.log("undefined:", readOne(undef, "imageMessage"));
console.log("absent:", readOne(absent, "imageMessage"));
console.log("other-absent:", readOne(present, "audioMessage"));

// --- the null arm and the undefined arm are DISTINGUISHED --------------------
function classify(m: IMsg, field: (typeof MEDIA)[number]): string {
  const v = m[field];
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  return "value";
}
console.log("classify:", classify(nulled, "imageMessage"), classify(undef, "imageMessage"),
  classify(absent, "imageMessage"), classify(present, "imageMessage"));

// --- identity is preserved through the read ----------------------------------
const shared: IImage = { url: "s" };
const holder: IMsg = { imageMessage: shared };
const k0: (typeof MEDIA)[number] = "imageMessage";
console.log("identity:", holder["imageMessage"] === shared, holder[k0] === shared);

// --- a read whose result is narrowed to one record arm -----------------------
function seconds(m: IMsg, field: (typeof MEDIA)[number]): number {
  const v = m[field];
  if (v && "seconds" in v && typeof v.seconds === "number") return v.seconds;
  return -1;
}
console.log("seconds:", seconds({ videoMessage: { seconds: 7 } }, "videoMessage"),
  seconds({ imageMessage: { url: "i" } }, "imageMessage"),
  seconds({}, "ptvMessage"));

// --- a key that is a two-name union, the smallest shape ----------------------
type TwoKey = "imageMessage" | "audioMessage";
function two(m: IMsg, k: TwoKey): string {
  return JSON.stringify(m[k] ?? null);
}
console.log("two:", two({ imageMessage: { url: "i" } }, "imageMessage"),
  two({ audioMessage: { ptt: false } }, "audioMessage"),
  two({}, "audioMessage"));

// --- CONTROL: the registry shape that already dispatched (WRAP, not RETAG) ---
interface Registry { stores: { n: number }; caches: { s: string } }
const registry: Registry = { stores: { n: 1 }, caches: { s: "c" } };
function pick(k: "stores" | "caches"): string {
  return JSON.stringify(registry[k]);
}
console.log("registry:", pick("stores"), pick("caches"));

// --- CONTROL: a literal key still folds to a plain field read ----------------
console.log("literal:", JSON.stringify(present["imageMessage"] ?? null), JSON.stringify(present.imageMessage ?? null));

// --- CONTROL: a shape whose declared fields DO share one type is unchanged ---
interface Uniform { a?: string; b?: string; c?: string }
const uni: Uniform = { a: "A", c: "C" };
function uget(k: "a" | "b" | "c"): string {
  return String(uni[k]);
}
console.log("uniform:", uget("a"), uget("b"), uget("c"));
