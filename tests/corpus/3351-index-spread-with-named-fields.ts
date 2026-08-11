// An index-signature spread and NAMED fields in one literal, typed a
// declared shape — the media-message builder shape `{ ...spread(content),
// ...uploaded, width: w }`. Contributors apply at their literal position
// (JS last-write-wins), each source and each explicit value evaluates
// exactly once, in source order.

interface Msg {
  url?: string;
  width?: number;
  mimetype?: string;
  caption?: string;
}

let evals = 0;
function fields(c: Record<string, unknown>): Record<string, unknown> {
  evals++;
  return c;
}
let widths = 0;
function width(n: number): number {
  widths++;
  return n;
}

// Explicit AFTER the spreads: the named field wins over a colliding key.
const a: Msg = {
  ...fields({ url: "u1", width: 1, mimetype: "image/png" }),
  ...fields({ caption: "c1" }),
  width: width(9),
};
console.log(`${a.url} ${a.width} ${a.mimetype} ${a.caption}`);
console.log("evals:", evals, "widths:", widths);

// Explicit BEFORE the spread: the runtime key wins, writing the declared
// slot the named field had already filled.
const b: Msg = { width: width(1), ...fields({ width: 42, url: "u2" }) };
console.log(`${b.width} ${b.url} ${b.caption === undefined}`);

// A key the source carries but the shape does not declare is dropped.
const c: Msg = { ...fields({ url: "u3", nope: "x" }), caption: "cc" };
console.log(`${c.url} ${c.caption}`);

// Shorthand properties contribute exactly like named ones.
const mimetype = "audio/ogg";
const d: Msg = { ...fields({ url: "u4" }), mimetype };
console.log(`${d.url} ${d.mimetype}`);

// One spread, one explicit, values of every declared type present.
const e: Msg = { ...fields({ mimetype: "video/mp4" }), url: "u5", width: 3, caption: "e" };
console.log(`${e.url} ${e.width} ${e.mimetype} ${e.caption}`);

// Evaluation ORDER across the whole literal is left to right.
const order: string[] = [];
function tag<T>(name: string, v: T): T {
  order.push(name);
  return v;
}
const f: Msg = {
  ...fields(tag("s1", { url: "u6" })),
  width: tag("w", 7),
  ...fields(tag("s2", { mimetype: "m6" })),
  caption: tag("cap", "c6"),
};
console.log(order.join(">"));
console.log(`${f.url} ${f.width} ${f.mimetype} ${f.caption}`);

// A REQUIRED field is fine when an explicit contributor names it.
interface Req {
  id: string;
  extra?: string;
}
const g: Req = { ...fields({ extra: "x" }), id: "the-id" };
console.log(`${g.id} ${g.extra}`);
// ...and the runtime key may still overwrite it afterwards.
const h: Req = { id: "seed", ...fields({ id: "runtime", extra: "y" }) };
console.log(`${h.id} ${h.extra}`);

// Empty sources leave every optional slot undefined.
const i: Msg = { ...fields({}), width: 0 };
console.log(i.url === undefined, i.width === 0, i.caption === undefined);

// A FIXED-shape source beside the runtime-keyed one: its declared fields
// copy at its position, a name the target does not declare drops, and the
// source evaluates exactly once.
let ups = 0;
function uploaded(): { url: string; mimetype: string; fileLength: number } {
  ups++;
  return { url: "https://cdn", mimetype: "image/png", fileLength: 99 };
}
const j: Msg = { ...fields({ url: "orig", caption: "orig-cap" }), ...uploaded(), width: 42 };
console.log(`${j.url} ${j.width} ${j.mimetype} ${j.caption}`, ups);
// ...and the runtime-keyed source wins when it comes last.
const k: Msg = { ...uploaded(), ...fields({ url: "late", caption: "late-cap" }) };
console.log(`${k.url} ${k.mimetype} ${k.caption}`, ups);
// A required slot may be filled by a fixed source's copy.
interface Need {
  mimetype: string;
  url?: string;
}
const l: Need = { ...fields({ url: "u" }), ...uploaded() };
console.log(`${l.mimetype} ${l.url}`, ups);

// A runtime key that a LATER contributor overwrites unconditionally is
// dead under JS last-write-wins, so it drops — even when its value could
// never have reached that slot's type.
interface Ev {
  schema: string;
  version: number;
  tag?: string;
}
let idxs = 0;
function idx(): Record<string, boolean | null | string> {
  idxs++;
  return { tag: "t", version: "not-a-number", schema: "from-keys" };
}
const m: Ev = { ...idx(), version: 7, schema: "explicit" };
console.log(`${m.schema} ${m.version} ${m.tag}`, typeof m.version, idxs);

// A union value slot landing on a NON-union field extracts the matching
// arm under its own tag test...
interface Sc {
  name: string;
  n?: number;
}
function labels(v: boolean | null | string): Record<string, boolean | null | string> {
  return { name: v };
}
const p: Sc = { name: "seed", ...labels("ok"), n: 1 };
console.log(`${p.name} ${p.n}`);
// (A NON-matching arm throws the catchable TypeError instead of storing
// the lie — divergence 34's keyed-write stance, already the behaviour of
// the all-spread merge. Not asserted here: Node stores it, so the
// differential harness would read the divergence as a mismatch.)

// NEGATIVE CONTROLS, kept as prose because a fenced program cannot be a
// corpus entry. Every literal in this file names a DECLARED target type,
// which is what makes dropping a runtime key that names no declared field
// divergence 68 rather than a wrong answer. When the target shape is the
// literal's OWN inferred type the merge must NOT apply, and these two
// still fence with the original SC1090:
//
//   function a(jid: string, extra: Record<string, string>) {
//     return { jid, ...extra };        // tsc infers `{ jid: string }`
//   }                                  // — `extra`'s keys are NOT droppable
//
//   jids.map((jid) => ({ tag: "g", attrs: { jid, ...groupAttrs } }))
//                                      // the enclosing literal passes its
//                                      // own inferred type down as context

console.log("evals:", evals, "widths:", widths);
console.log("done");
