// A computed property key whose checker type is a UNION of string literals —
// `[field]` inside `for (const field of FIELDS)` over an `as const` tuple.
// zapo's src/message/encode/content.ts:183 is this shape. Every expected
// value here was read off Node first; the program prints field reads rather
// than JSON, because record key ORDER is a separate, pre-existing divergence
// and this fixture is about the write landing in the right slot.
interface Slots {
  imageMessage?: string;
  videoMessage?: string;
  audioMessage?: string;
  caption?: string;
}
const FIELDS = ["imageMessage", "videoMessage", "audioMessage"] as const;

function put(m: Slots, k: (typeof FIELDS)[number], v: string): Slots {
  return { ...m, [k]: v };
}
const show = (s: Slots): string =>
  `${s.imageMessage ?? "-"}/${s.videoMessage ?? "-"}/${s.audioMessage ?? "-"}/${s.caption ?? "-"}`;

const base: Slots = { imageMessage: "i", videoMessage: "v", audioMessage: "a", caption: "c" };
for (const field of FIELDS) {
  console.log(field, show(put(base, field, "NEW")));
}
// An empty base: the names the key does NOT spell stay absent.
for (const field of FIELDS) {
  console.log("empty", field, show(put({}, field, "X")));
}
// The value expression evaluates EXACTLY ONCE, whichever name is written,
// and the key evaluates before it.
let log = "";
function key(k: (typeof FIELDS)[number]): (typeof FIELDS)[number] {
  log += "k";
  return k;
}
function val(v: string): string {
  log += "v";
  return v;
}
const kOnce: (typeof FIELDS)[number] = key("videoMessage");
const one: Slots = { ...base, [kOnce]: val("once") };
console.log(show(one), log);
// A key that is a plain local of the union type, not an element read.
const k2: (typeof FIELDS)[number] = "audioMessage";
console.log(show({ ...base, [k2]: "K2" }));
// The whole real-site shape: read a slot through the same union key, test it,
// write it back. The loop returns on the first present field.
function first(m: Slots): string {
  for (const field of FIELDS) {
    const cur = m[field];
    if (cur) return show({ ...m, [field]: cur + "!" });
  }
  return "none";
}
console.log(first(base));
console.log(first({ videoMessage: "only" }));
console.log(first({}));
