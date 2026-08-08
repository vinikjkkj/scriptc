// A user TYPE PREDICATE over a union one of whose arms reaches a class —
// the shape that made SC1101 the largest single-code family in the zapo
// corpus, twenty sites of it.
//
// The value is never a bare class instance at any of those sites. It is a
// wide union of record shapes dispatched over by `isSendText(content)`,
// `isSendMedia(content)`, and so on, each declared `(v: unknown) => v is T`.
// The union's arms are records; one record has a field whose type is
// itself a union with a class arm (`Uint8Array | Readable | string`). That
// one leaf, several containers down, refused — and refusing a leaf refuses
// the whole value, so every predicate call on the union fenced.
//
// So this program is about NESTING as much as about classes: a record
// copies deeply into the dyn tree, and a class member of that record is
// carried BY REFERENCE inside the copy. The two rules have to compose.

class Cursor {
  pos: number;
  constructor(pos: number) {
    this.pos = pos;
  }
  read(): number {
    this.pos = this.pos + 1;
    return this.pos;
  }
}

type Source = string | Cursor;

interface TextItem {
  readonly type: "text";
  readonly text: string;
}

interface BlobItem {
  readonly type: "blob";
  readonly name: string;
  // The class-bearing leaf: two containers below the value being widened.
  readonly body: Source;
}

type Item = string | TextItem | BlobItem;

// Predicates written the way the corpus library writes them: `unknown`
// in, a narrowed arm out, `in`-guarded own-property probing between —
// never a cast, because a cast of an unknown value is CHECKED here and
// erased in Node. Every call site WIDENS its argument, which is the
// direction that used to fence.
function isText(v: unknown): v is TextItem {
  return (
    typeof v === "object" && v !== null && "type" in v && v.type === "text" && "text" in v
  );
}

function isBlob(v: unknown): v is BlobItem {
  return typeof v === "object" && v !== null && "type" in v && v.type === "blob";
}

function describe(item: Item): string {
  if (typeof item === "string") return "raw:" + item;
  // Both calls widen `item` — a union whose BlobItem arm carries a class.
  if (isText(item)) return "text:" + item.text;
  if (isBlob(item)) {
    const body = item.body;
    if (typeof body === "string") return "blob:" + item.name + ":" + body;
    return "blob:" + item.name + ":cursor@" + String(body.pos);
  }
  return "other";
}

const cursor = new Cursor(41);
const items: Item[] = [
  "plain",
  { type: "text", text: "hello" },
  { type: "blob", name: "a", body: "inline" },
  { type: "blob", name: "b", body: cursor },
];
for (const it of items) console.log(describe(it));

// The narrowed value is the STATIC one, so the class member is still the
// live object: reading through it moves the same cursor everyone else has.
console.log("cursor before:", cursor.pos);
console.log("read:", cursor.read());
console.log(describe({ type: "blob", name: "c", body: cursor }));

// A predicate that IGNORES the class arm still has to accept the value —
// the fence was on the conversion, not on the use, so a helper that only
// ever looks at `.type` was refused just as hard as one that read `.body`.
function tag(v: unknown): string {
  if (isText(v)) return "T";
  if (isBlob(v)) return "B";
  return "?";
}
console.log(tag(items[1]), tag(items[3]), tag("nope"));

// The BARE class arm crossing on its own, beside the nested one: a union
// of `string | Cursor` widened directly.
function isCursorish(v: unknown): boolean {
  return typeof v === "object" && v !== null;
}
function kind(s: Source): string {
  if (isCursorish(s)) return "cursor";
  return "string";
}
console.log(kind("x"), kind(cursor));

// An ARRAY of the class-armed union widened whole: the container rule
// composes too (the element converter boxes each element by its own kind,
// so the array copies while its class elements are carried by reference).
const sources: Source[] = ["one", cursor, "two"];
function sawArray(v: unknown): boolean {
  return Array.isArray(v);
}
console.log("array crossed:", sawArray(sources));
let cursors = 0;
for (const s of sources) if (typeof s !== "string") cursors = cursors + 1;
console.log("cursors:", cursors);
console.log("cursor after:", cursor.pos);
