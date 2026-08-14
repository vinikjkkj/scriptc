// An absent index-signature key answers `undefined` as the MIDDLE operand of
// a `??` CHAIN.
//
// The other half of zapo's incoming-message abort. One line above the record
// field 3661 is about, `persistIncomingMailboxEntities` writes
//
//   senderJid: event.key.participant ?? event.rawNode.attrs.participant ?? event.key.remoteJid
//
// and on a 1:1 stanza `key.participant` is undefined, so the middle operand
// runs -- a keyed read of an attribute a 1:1 stanza never carries. JS takes
// the first non-nullish of the three and answers `remoteJid`. tsc types the
// middle read `string`, so the fold demanded a string of it, and the miss
// aborted the process one operand short of the answer.
//
// `??` already widened a keyed read in its LEFT operand (`attrs.k ?? d`).
// The RIGHT operand is this `??`'s default, and its value is handed straight
// to the ENCLOSING `??`, whose entire job is to test it for nullish -- so
// that destination can say undefined and must. The enclosing test is asked of
// the SYNTAX (a `??` whose left this node is, parentheses tolerated), because
// that is exactly the fact being relied on.
//
// The middle operand is also reached one BINDING later — a reference to the
// local that holds the read at dyn width — which is the form zapo's
// persistContacts writes; section 3.
//
// A chain of TWO (`a ?? attrs.k`, nothing after it) has no such consumer: its
// result flows into whatever slot the author wrote, and a slot that cannot
// say undefined keeps the loud trap. That case is not below, for the same
// reason a trap cannot appear in a differential fixture.

interface Node2 {
  readonly tag: string;
  readonly attrs: Readonly<Record<string, string>>;
}
interface Key {
  readonly remoteJid: string;
  readonly id: string;
  readonly participant?: string;
}

const oneToOne: Node2 = { tag: "message", attrs: { from: "5511999999999@lid", id: "MB1", t: "1" } };
const group: Node2 = {
  tag: "message",
  attrs: { from: "120363000000000000@g.us", id: "MB2", participant: "5511888888888@lid" },
};
const keyDirect: Key = { remoteJid: "5511999999999@lid", id: "MB1" };
const keyGroup: Key = { remoteJid: "120363000000000000@g.us", id: "MB2", participant: "5511777777777@lid" };

// ------------------------------------------------------- 1. the zapo chain
// Four combinations of (left present?, middle present?) through one shape.
function sender(k: Key, n: Node2): string {
  return k.participant ?? n.attrs.participant ?? k.remoteJid;
}
console.log("r01", sender(keyDirect, oneToOne));
console.log("r02", sender(keyDirect, group));
console.log("r03", sender(keyGroup, oneToOne));
console.log("r04", sender(keyGroup, group));

// The chain's result in the destination it actually has -- an optional field.
interface Stored {
  readonly id: string;
  readonly senderJid?: string;
}
const s1: Stored = { id: "A", senderJid: keyDirect.participant ?? oneToOne.attrs.participant ?? keyDirect.remoteJid };
console.log("r05", s1.senderJid);

// -------------------------------------------------- 2. shapes of the chain
// Parentheses around the inner `??` are the same expression.
console.log("r06", (keyDirect.participant ?? oneToOne.attrs.participant) ?? "tail");
// A THREE-deep chain: the middle two are both consumed by a `??`.
console.log("r07", keyDirect.participant ?? oneToOne.attrs.participant ?? oneToOne.attrs.nope ?? "tail");
console.log("r08", keyDirect.participant ?? oneToOne.attrs.nope ?? oneToOne.attrs.id ?? "tail");
// The element-access spelling.
console.log("r09", keyDirect.participant ?? oneToOne.attrs["participant"] ?? "tail");
console.log("r10", keyDirect.participant ?? oneToOne.attrs["id"] ?? "tail");

// The right operand is evaluated LAZILY and only when the left is nullish --
// the chain must not have pre-evaluated anything.
let probes = 0;
function probe(n: Node2): Node2 {
  probes += 1;
  return n;
}
const eager: string | undefined = "present";
console.log("r11", eager ?? probe(oneToOne).attrs.participant ?? "tail", probes);
console.log("r12", keyDirect.participant ?? probe(oneToOne).attrs.participant ?? "tail", probes);

// A `??` on the LEFT was already answered (`attrs.k ?? d`) and still is.
console.log("r13", oneToOne.attrs.participant ?? "left-dflt", oneToOne.attrs.id ?? "left-dflt");
// Both operands keyed reads, the whole thing consumed by a third `??`.
console.log("r14", oneToOne.attrs.nope ?? oneToOne.attrs.participant ?? "tail");
console.log("r15", oneToOne.attrs.nope ?? oneToOne.attrs.id ?? "tail");

// ------------------------------- 3. the middle operand one binding later
// zapo's `persistContacts` writes the read into a local first and then puts
// the LOCAL in the middle of the chain:
//
//   const rawParticipant = event.rawNode.attrs.participant;
//   const participantJid = rawParticipant ? toUserJid(rawParticipant) : undefined;
//   const senderPrimary  = event.key.participant ?? rawParticipant ?? event.key.remoteJid;
//
// The local holds the read at dyn width (0b6bdfb), and tsc narrows each
// REFERENCE back to the `string` it believes, so the reference carries a
// validated extraction. That is right for a use that needs the value and
// wrong for this one, which is asking whether there is a value at all: it
// threw "expected string at $, got undefined" where Node takes the tail.
function contactSender(k: Key, n: Node2): string {
  const rawParticipant = n.attrs.participant;
  return k.participant ?? rawParticipant ?? k.remoteJid;
}
console.log("r14a", contactSender(keyDirect, oneToOne));
console.log("r14b", contactSender(keyDirect, group));
console.log("r14c", contactSender(keyGroup, oneToOne));

// The use that DOES need the value still validates, in the same function --
// nothing became silent.
function contactPair(n: Node2, lead: string | undefined): string {
  const raw = n.attrs.participant;
  const upper = raw ? raw.toUpperCase() : "-";
  const primary = lead ?? raw ?? "fallback";
  return upper + " / " + primary;
}
console.log("r14d", contactPair(oneToOne, undefined));
console.log("r14e", contactPair(group, undefined));

// ------------------------------------------------ 4. widths and non-strings
const counts = { a: 1 } as unknown as Readonly<Record<string, number>>;
const n1: number | undefined = undefined;
console.log("r16", n1 ?? counts["nope"] ?? -1);
console.log("r17", n1 ?? counts["a"] ?? -1);
// A ZERO hit is not nullish -- the chain must not step past it.
const zeros = { z: 0 } as unknown as Readonly<Record<string, number>>;
console.log("r18", n1 ?? zeros["z"] ?? -1);
// An EMPTY-STRING hit is not nullish either.
const empties = { e: "" } as unknown as Readonly<Record<string, string>>;
console.log("r19", "[" + (keyDirect.participant ?? empties["e"] ?? "tail") + "]");

// ------------------------------------------------------ 5. what does NOT move
// A DECLARED field always answers, so nothing widens.
const declared: { readonly kind: string; readonly [k: string]: string } = { kind: "k", extra: "e" };
console.log("r20", keyDirect.participant ?? declared.kind ?? "tail");
console.log("r21", keyDirect.participant ?? declared["extra"] ?? "tail");
// `||` is a different operator with a different test, and it already had its
// own answer (the truthiness rung).
console.log("r22", oneToOne.attrs.participant || "or-dflt", oneToOne.attrs.id || "or-dflt");
// The binding one level down, which 0b6bdfb answers.
const raw = oneToOne.attrs.participant;
console.log("r23", raw ?? "bound-dflt");
const rawHit = oneToOne.attrs.id;
console.log("r24", rawHit ?? "bound-dflt");

// ------------------------------------------------- 6. the loop zapo runs it in
const stanzas: readonly Node2[] = [oneToOne, group, oneToOne];
const keys: readonly Key[] = [keyDirect, keyDirect, keyGroup];
for (let i = 0; i < stanzas.length; i += 1) {
  console.log("r25." + String(i), sender(keys[i]!, stanzas[i]!));
}
