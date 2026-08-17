// A binding whose initializer is a SHORT CIRCUIT — `??` or `?:` — with an
// index-signature keyed read as one of its operands. The short circuit is
// the author's own miss handler; the abort fires one operator before it.
//
// zapo `transport/node/builders/global.ts:133` and `:137`, inside
// `buildAckNode`:
//
//     const type = input.typeOverride ?? input.node.attrs.type
//     if (type) { attrs.type = type }
//     const participant = input.participant ?? input.node.attrs.participant
//     if (participant) { attrs.participant = participant }
//
// and `message/primitives/incoming.ts:108`:
//
//     const fromUserJid = node.attrs.from ? toUserJid(node.attrs.from) : node.attrs.from
//
// A `<message>` stanza with no `type` and no `participant` is the ordinary
// case, not the edge one, so acking one aborted the process where Node
// simply took the guard's false branch.
//
// The third case is the same binding rule declining on a WIDTH: zapo's
// app-state index arguments are `Record<string, string | boolean | null>`,
// and the `null` arm alone was enough to keep `const arg = args[part.name]`
// on the aborting path — one line before the author's own
// `if (arg === null || arg === undefined)`.
//
// The bindings are inside FUNCTIONS, as zapo's are: the file-scope twin of
// this rule (`keyedReadGlobalIsDyn`) asks its question from the syntax
// before any body lowers and is deliberately not extended here.
//
// Every expectation below is Node's answer, taken from Node.

type Attrs = Readonly<Record<string, string>>;
const attrs: Attrs = { present: "7", empty: "" };

function tag(v: string): string { return "[" + v + "]"; }
function show(v: string | undefined): string { return v === undefined ? "undef" : "<" + v + ">"; }
function override(which: string): string | undefined { return which === "yes" ? "over" : undefined; }

// 1 — `??` with the keyed read as the DEFAULT, the override absent; and
//     the same expression with the key present, with the override
//     present, and on an EMPTY-string value (`??` must not take the
//     default for "").
function ackType(which: string, key: string): string {
  const t = override(which) ?? attrs[key];
  if (t) { return "t:" + t; }
  return "t:falsy/" + String(t);
}
console.log(ackType("no", "missingType"));
console.log(ackType("no", "present"));
console.log(ackType("yes", "missingType"));
console.log(ackType("no", "empty"));

// 2 — the binding flows on: a comparison, a template span, a `??` of its
//     own and a truthiness guard, which is what zapo does with it.
function ackTypeUses(key: string): string {
  const t = override("no") ?? attrs[key];
  return [
    t === undefined ? "cmp:undef" : "cmp:set",
    `tpl:${String(t)}`,
    "nul:" + (t ?? "dflt"),
    t ? "guard:taken" : "guard:skipped",
  ].join(" ");
}
console.log(ackTypeUses("missingType"));
console.log(ackTypeUses("present"));

// 3 — `?:` whose ELSE arm re-reads the same absent key. The condition is
//     the guard; the else arm is the value the guard produced.
function fromUserJid(key: string): string {
  const f = attrs[key] ? tag(attrs[key]) : attrs[key];
  if (f === undefined) return "f:undef/" + String(f);
  return "f:" + f;
}
console.log(fromUserJid("missingFrom"));
console.log(fromUserJid("present"));
console.log(fromUserJid("empty"));

// 4 — a value type with a UNIT arm. `null` and `undefined` have no
//     identity to lose, so widening the binding costs no deep copy — the
//     same reason `string | boolean` was already allowed.
type IndexArgs = Readonly<Record<string, string | boolean | null>>;
const args: IndexArgs = { name: "chat", fromMe: true, alt: null };
function argKind(v: string | boolean | null | undefined): string {
  if (v === undefined) return "undef";
  if (v === null) return "null";
  return typeof v === "boolean" ? (v ? "true" : "false") : "str:" + v;
}
function indexPart(name: string): string {
  const arg = args[name];
  if (arg === null || arg === undefined) return "nullish/" + argKind(arg) + "/" + String(arg);
  return argKind(arg);
}
console.log(indexPart("missingPart"));
console.log(indexPart("name"));
console.log(indexPart("fromMe"));
console.log(indexPart("alt"));

// 5 — the SAME shape read many times, so a shared helper's width shows.
function sweep(): string {
  let acc = "";
  for (const k of ["name", "gone", "fromMe", "alt", "vanished"]) {
    const v = args[k];
    acc += argKind(v) + ";";
  }
  return acc;
}
console.log(sweep());

// 6 — the controls: the forms that already answered undefined, so a
//     regression in any of them shows here rather than in zapo.
function controls(): string {
  const whole = attrs.wholeMiss;
  return [
    attrs.plainNullish ?? "plain:undef",
    whole === undefined ? "whole:undef" : "whole:" + whole,
    attrs.truthMiss ? "truth:yes" : "truth:no",
    attrs.cmpMiss === undefined ? "cmp:undef" : "cmp:set",
    show(attrs.present),
  ].join(" ");
}
console.log(controls());
