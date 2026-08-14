// An absent index-signature key answers `undefined` when it lands in a
// RECORD-LITERAL FIELD whose slot can say so.
//
// This is the abort that killed every ordinary incoming direct message in
// zapo. `persistIncomingMailboxEntities` builds
//
//   writeBehind.persistMessage({ ..., participantJid: event.rawNode.attrs.participant })
//
// where `attrs` is `Readonly<Record<string, string>>` and a 1:1 stanza never
// carries a `participant` attribute (it is group-only). tsc types the read by
// the signature's VALUE type, so the field value is spelled `string`, the
// emitted keyed-read helper's miss path had no undefined to answer with, and
// it took `scr_trap_fmt` -- an ABORT, which walked straight past the caller's
// own try/catch and killed the process. The same read answers `undefined`
// correctly one line earlier in a comparison, which is what made it invisible:
// it is not a `[SCxxxx]` string in the emitted C at all.
//
// The destination is `participantJid?: string` -- a union that CAN hold
// undefined, and both emitters already answer a keyed miss with a union's
// undefined arm (they do it under noUncheckedIndexedAccess). Only the
// frontend never asked.
//
// Why this destination and not every one. recordKeyReadAtSlotWidth refuses
// an undefined-armed union slot, and its reason is real: tsc NARROWS
// `const s: string | undefined = attrs.k` to `string` at the declaration, so
// every later use of `s` compiles as "definitely the string arm" -- a bare
// peek over a stored undefined. That is a fact about the DESTINATION. Measured
// on tsc 5.9.3, the narrowing happens at a declaration, at an assignment and
// at a property write, and NOT at a record-literal field: `const r: {p?: string}
// = { p: attrs.k }; const t: string = r.p` is still an error, so the readers
// were compiled against the union and every one of them discriminates. The
// declaration already had its own answer (0b6bdfb widens the LOCAL to dyn);
// the assignment and the property write keep the loud trap.
//
// What deliberately still traps, and so cannot appear below: a field whose
// slot is exactly `string` -- an INFERRED literal (`const rec = { p: attrs.k }`,
// where tsc types `rec.p` as `string` and told the readers so) or a declared
// REQUIRED field. Those are the "checker claimed a type nothing can honour"
// case, and a loud trap is the documented stance (SEMANTICS.md, the array-OOB
// policy).

interface Node2 {
  readonly tag: string;
  readonly attrs: Readonly<Record<string, string>>;
}

interface StoredMessage {
  readonly id: string;
  readonly threadJid: string;
  readonly senderJid?: string;
  readonly participantJid?: string;
  readonly fromMe: boolean;
}

const oneToOne: Node2 = { tag: "message", attrs: { from: "5511999999999@lid", id: "MB1", t: "1" } };
const group: Node2 = {
  tag: "message",
  attrs: { from: "120363000000000000@g.us", id: "MB2", t: "2", participant: "5511888888888@lid" },
};

// -------------------------------------------------------- 1. the zapo shape
// The record is built and handed to a consumer that reads the declared
// union, exactly like `persistMessage`.
function store(rec: StoredMessage): string {
  const p = rec.participantJid === undefined ? "-" : rec.participantJid;
  const s = rec.senderJid === undefined ? "-" : rec.senderJid;
  return rec.id + " sender=" + s + " participant=" + p;
}

const fromOneToOne: StoredMessage = {
  id: "MB1",
  threadJid: "5511999999999@lid",
  participantJid: oneToOne.attrs.participant,
  fromMe: false,
};
console.log("r01", store(fromOneToOne));

const fromGroup: StoredMessage = {
  id: "MB2",
  threadJid: "120363000000000000@g.us",
  participantJid: group.attrs.participant,
  fromMe: false,
};
console.log("r02", store(fromGroup));

// The field read is a plain optional read afterwards -- no narrowing was
// smuggled in by the literal.
console.log("r03", fromOneToOne.participantJid === undefined, fromGroup.participantJid === undefined);
console.log("r04", typeof fromOneToOne.participantJid, typeof fromGroup.participantJid);
console.log("r05", String(fromOneToOne.participantJid), String(fromGroup.participantJid));

// Every reader discriminates, and the one that needs the value gets it.
if (fromGroup.participantJid !== undefined) {
  console.log("r06", fromGroup.participantJid.length, fromGroup.participantJid.slice(0, 4));
}
if (fromOneToOne.participantJid !== undefined) {
  console.log("r07 unreachable");
} else {
  console.log("r07", "absent");
}
console.log("r08", fromOneToOne.participantJid ?? "fallback", fromGroup.participantJid ?? "fallback");

// -------------------------------------------------- 2. spellings and widths
// The element-access spelling is the same read.
interface Opt {
  readonly p?: string;
  readonly q?: string;
}
const byElem: Opt = { p: oneToOne.attrs["participant"], q: oneToOne.attrs["id"] };
console.log("r09", byElem.p === undefined ? "undefined" : byElem.p, byElem.q === undefined ? "undefined" : byElem.q);

// A number-valued signature, and a boolean one: the slot is that width plus
// the undefined arm.
//
// A UNION-valued signature (the width 82d8eb2 admitted for the dyn route,
// `Record<string, string | boolean>`) is NOT here, and the omission is
// deliberate rather than an oversight: the helper surfaces a hit by wrapping
// it into ONE arm of the result, and the whole union `string | boolean` is
// not an arm of `string | boolean | undefined`. recordKeyResultOk declines
// it and the loud trap stays. The dyn route has no such limit -- toDyn is
// total over the union -- so `String(bag[k])` and `bag[k] ?? d` still answer
// there (3481). A union-to-superset re-tag in both emitters would lift this;
// it is not this change.
const counts = { a: 1 } as unknown as Readonly<Record<string, number>>;
const bools = { on: true } as unknown as Readonly<Record<string, boolean>>;
interface Mixed {
  readonly n?: number;
  readonly b?: boolean;
}
const m1: Mixed = { n: counts["nope"], b: bools["gone"] };
const m2: Mixed = { n: counts["a"], b: bools["on"] };
console.log("r10", m1.n === undefined, m1.b === undefined);
console.log("r11", m2.n, m2.b, typeof m2.b);
console.log("r12", m1.n ?? -1, m1.b ?? "none", m2.b ?? "none");

// A COMPOSITE value type is admitted here (unlike the dyn widening, a union
// wrap is not a deep copy, so no aliasing is severed): the field holds the
// very array the record holds.
const lists = { a: ["one"] } as unknown as Readonly<Record<string, string[]>>;
interface WithList {
  readonly xs?: string[];
}
const wl: WithList = { xs: lists["a"] };
const wlMiss: WithList = { xs: lists["nope"] };
if (wl.xs !== undefined) {
  wl.xs.push("two");
}
console.log("r13", lists["a"]!.length, lists["a"]!.join("|"), wlMiss.xs === undefined);

// A shorthand property is the same destination.
const participant = oneToOne.attrs.participant;
console.log("r14", participant === undefined ? "undefined" : participant);

// ------------------------------------------------------- 3. what does NOT move
// A DECLARED field always answers, so nothing widens.
const withDeclared: { readonly kind: string; readonly [k: string]: string } = { kind: "k", extra: "e" };
const d1: Opt = { p: withDeclared.kind, q: withDeclared["extra"] };
console.log("r15", d1.p, d1.q);

// A WIDER slot is a conversion the author asked for and keeps its own
// coercion: `string | number | undefined` is not the read's width plus the
// undefined arm, so the read stays where it was -- and it is a HIT, so the
// answer is the same either way.
interface Wider {
  readonly v?: string | number;
}
const w1: Wider = { v: oneToOne.attrs.id };
console.log("r16", w1.v, typeof w1.v);

// A slot that can ALREADY say undefined keeps its width: `undefined` written
// out loud, and an optional field left off entirely.
const explicitUndef: Opt = { p: undefined, q: "q" };
const omitted: Opt = { q: "q2" };
console.log("r17", explicitUndef.p === undefined, omitted.p === undefined, omitted.q);

// The declaration destination, which had its own answer three merges ago and
// still has it (the LOCAL holds the read at dyn width).
const asLocal: string | undefined = oneToOne.attrs.participant;
console.log("r18", asLocal === undefined ? "undefined" : asLocal);
const asLocalHit: string | undefined = oneToOne.attrs.id;
console.log("r19", asLocalHit === undefined ? "undefined" : asLocalHit);

// ------------------------------------------------- 4. the loop zapo runs it in
// Two stanzas through one builder -- a miss and a hit through the same code.
function build(n: Node2, id: string): StoredMessage {
  return {
    id,
    threadJid: n.attrs.from!,
    participantJid: n.attrs.participant,
    fromMe: false,
  };
}
const built = [build(oneToOne, "A"), build(group, "B"), build(oneToOne, "C")];
for (let i = 0; i < built.length; i += 1) {
  console.log("r20." + String(i), store(built[i]!));
}
console.log("r21", built.filter((b) => b.participantJid !== undefined).length);
