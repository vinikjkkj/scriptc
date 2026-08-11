// `"k" in u` where the union's arms do NOT all answer statically. Each arm
// answers on its own: a declared non-optional field is always present, an
// undeclared name never is, and an OPTIONAL (undefined-armed) slot tests
// the slot's arm at runtime — the single-record rule, now per arm. The
// answers mix freely inside one union, and the guard composes with tsc's
// own `in`-narrowing exactly as the all-static case does.

// (1) The key is optional in SOME arms and absent from the others.
interface Img {
  readonly type: "image";
  readonly width?: number;
}
interface Vid {
  readonly type: "video";
  readonly width?: number;
  readonly seconds?: number;
}
interface Aud {
  readonly type: "audio";
  readonly seconds?: number;
}
interface Doc {
  readonly type: "document";
  readonly fileName?: string;
}
type Media = Img | Vid | Aud | Doc;

function needsProbe(content: Media): boolean {
  return !("seconds" in content && content.seconds !== undefined);
}
console.log(
  needsProbe({ type: "video", seconds: 3 }),
  needsProbe({ type: "video" }),
  needsProbe({ type: "audio", seconds: 0 }),
  needsProbe({ type: "image" }),
  needsProbe({ type: "document", fileName: "a.pdf" }),
);

// The guard narrows: inside it the value is Vid | Aud and the slot reads.
function secondsOf(content: Media): number {
  if ("seconds" in content && content.seconds !== undefined) return content.seconds;
  return -1;
}
console.log(secondsOf({ type: "video", seconds: 12 }), secondsOf({ type: "audio" }), secondsOf({ type: "image", width: 4 }));

// (2) The key is optional in EVERY arm — no static answer anywhere.
interface WithMime {
  readonly kind: "a" | "b";
  readonly mimetype?: string;
}
interface WithMime2 {
  readonly kind: "c";
  readonly mimetype?: string;
  readonly extra?: number;
}
type Mimed = WithMime | WithMime2;
function mimeOf(m: Mimed): string {
  return "mimetype" in m ? String(m.mimetype) : "<none>";
}
console.log(mimeOf({ kind: "a", mimetype: "image/png" }), mimeOf({ kind: "b" }), mimeOf({ kind: "c", extra: 1 }));

// (3) One key, all three answers at once: REQUIRED in one arm, OPTIONAL in
// the next, ABSENT from the third.
interface Req {
  readonly tag: "req";
  readonly id: string;
}
interface Opt {
  readonly tag: "opt";
  readonly id?: string;
}
interface None {
  readonly tag: "none";
}
type Three = Req | Opt | None;
function hasId(v: Three): boolean {
  return "id" in v;
}
console.log(hasId({ tag: "req", id: "x" }), hasId({ tag: "opt", id: "y" }), hasId({ tag: "opt" }), hasId({ tag: "none" }));

// Negated, and in a plain `if`.
for (const v of [{ tag: "req", id: "r" }, { tag: "opt" }, { tag: "none" }] as Three[]) {
  if (!("id" in v)) console.log(`absent on ${v.tag}`);
  else console.log(`present on ${v.tag}`);
}

// (4) A field whose union type has NO undefined arm is a real slot: always
// present, whichever arm carries it.
interface NullableL {
  readonly w: "l";
  readonly v: string | null;
}
interface NullableR {
  readonly w: "r";
  readonly v?: string | null;
}
type Nullable = NullableL | NullableR;
function hasV(n: Nullable): boolean {
  return "v" in n;
}
console.log(hasV({ w: "l", v: null }), hasV({ w: "r", v: null }), hasV({ w: "r" }));

// (5) The receiver may be any side-effect-free read, not just a name: a
// record field holding the union answers the same way.
interface Holder {
  readonly inner: Three;
}
const holders: Holder[] = [{ inner: { tag: "req", id: "h" } }, { inner: { tag: "opt" } }];
for (const h of holders) console.log("id" in h.inner);

// (6) The answer is a plain boolean value, usable outside a condition.
const flags = ([{ tag: "req", id: "1" }, { tag: "opt", id: "2" }, { tag: "opt" }, { tag: "none" }] as Three[]).map(
  (v) => "id" in v,
);
console.log(flags.join(","));
console.log(flags.filter((f) => f).length);
