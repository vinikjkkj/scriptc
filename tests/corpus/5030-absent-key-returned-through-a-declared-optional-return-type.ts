// An absent index-signature key answers `undefined` when it is RETURNED
// through a declared return type that can say so.
//
// The same abort family as 3661, one destination further on. The checker
// types an index-signature read by the signature's VALUE type, so
//
//   function participantOf(n: Node2): string | undefined {
//     return n.attrs.participant;
//   }
//
// reads at width `string`, a 1:1 stanza carries no `participant` attribute,
// and the emitted keyed-read helper's miss path had no undefined to answer
// with: it took `scr_trap_fmt` -- a process ABORT, past every catch clause,
// where Node hands the CALLER `undefined` and the caller's own
// `=== undefined` answers it. Like 3661 it is not a `[SCxxxx]` string in the
// emitted C at all, so no trap census saw it.
//
// WHY THE RETURN SLOT IS ADMISSIBLE, which is the whole admission rule. It
// is lowerArgExpecting's parameter argument with the direction reversed: a
// parameter cannot be narrowed by a caller because the body was compiled
// once against the DECLARATION, and a declared return type cannot be
// narrowed by the body because every caller was compiled once against the
// SAME declaration. Measured on tsc 5.9.3 rather than argued -- with
//
//   function viaReturn(x: Node2): string | undefined { return x.attrs.k }
//   const a: string = viaReturn(n);
//
// tsc reports TS2322, so every reader of the result discriminates; and the
// same probe reports NO error for `const c: string | undefined = attrs.k;
// const s: string = c`, for the assignment form and for the property-write
// form. That is why those three destinations keep the loud trap here and
// below, and this one does not.
//
// An INFERRED return type is not a counter-example, it is the gate:
// `function f() { return attrs.k }` infers `string`, which carries no
// undefined arm, so the rung declines and the trap stays -- honestly,
// because there is nowhere for the undefined to go.

interface Node2 {
  readonly tag: string;
  readonly attrs: Readonly<Record<string, string>>;
}

const oneToOne: Node2 = { tag: "message", attrs: { from: "5511999999999@lid", id: "MB1", t: "1" } };
const group: Node2 = {
  tag: "message",
  attrs: { from: "120363000000000000@g.us", id: "MB2", t: "2", participant: "5511888888888@lid" },
};

// ---------------------------------------------------- 1. the zapo shape
function participantOf(n: Node2): string | undefined {
  return n.attrs.participant;
}
console.log("r01", participantOf(oneToOne) === undefined ? "undefined" : participantOf(oneToOne));
console.log("r02", participantOf(group) === undefined ? "undefined" : participantOf(group));

// Every reader discriminates, because tsc made them.
const p1 = participantOf(oneToOne);
const p2 = participantOf(group);
console.log("r03", p1 === undefined, p2 === undefined);
console.log("r04", typeof p1, typeof p2);
console.log("r05", String(p1), String(p2));
console.log("r06", p1 ?? "fallback", p2 ?? "fallback");
if (p2 !== undefined) {
  console.log("r07", p2.length, p2.slice(0, 4));
}

// ------------------------------------------------- 2. the four spellings
// A block-bodied arrow.
const viaArrowBlock = (n: Node2): string | undefined => {
  return n.attrs.participant;
};
console.log("r08", viaArrowBlock(oneToOne) === undefined ? "undefined" : viaArrowBlock(oneToOne));

// A concise arrow: the implicit return is the same completion.
const viaArrowConcise = (n: Node2): string | undefined => n.attrs.participant;
console.log("r09", viaArrowConcise(oneToOne) === undefined ? "undefined" : viaArrowConcise(oneToOne));

// A method on a record.
interface Reader {
  readonly of: (n: Node2) => string | undefined;
}
const reader: Reader = { of: (n: Node2): string | undefined => n.attrs.participant };
console.log("r10", reader.of(oneToOne) === undefined ? "undefined" : reader.of(oneToOne));

// A method on a class.
class Coordinator {
  participant(n: Node2): string | undefined {
    return n.attrs.participant;
  }
}
const co = new Coordinator();
console.log("r11", co.participant(oneToOne) === undefined ? "undefined" : co.participant(oneToOne));
console.log("r12", co.participant(group) === undefined ? "undefined" : co.participant(group));

// ------------------------------------------------------- 3. other widths
const counts = { a: 1 } as unknown as Readonly<Record<string, number>>;
const flags = { on: true } as unknown as Readonly<Record<string, boolean>>;
function countOf(k: string): number | undefined {
  return counts[k];
}
function flagOf(k: string): boolean | undefined {
  return flags[k];
}
console.log("r13", countOf("nope") === undefined, countOf("a"));
console.log("r14", flagOf("gone") === undefined, flagOf("on"));
console.log("r15", countOf("nope") ?? -1, flagOf("gone") ?? "none");

// A COMPOSITE value type: a union wrap is not a deep copy, so the returned
// value is the very array the record holds.
const lists = { a: ["one"] } as unknown as Readonly<Record<string, string[]>>;
function listOf(k: string): string[] | undefined {
  return lists[k];
}
const got = listOf("a");
if (got !== undefined) {
  got.push("two");
}
console.log("r16", lists["a"]!.join("|"), listOf("nope") === undefined);

// --------------------------------------------------------- 4. what does NOT move
// An INFERRED return type has no arm to offer, so the read keeps its own
// width and answers a HIT exactly as it always did. (A miss would still
// abort -- the checker claimed a type nothing can honour, the documented
// stance -- so only the hit is exercised.)
function inferred(n: Node2) {
  return n.attrs.id;
}
console.log("r17", inferred(oneToOne));

// A DECLARED FIELD always answers, so nothing widens.
const withDeclared: { readonly kind: string; readonly [k: string]: string } = { kind: "k", extra: "e" };
function declaredOf(): string | undefined {
  return withDeclared.kind;
}
console.log("r18", declaredOf());

// A WIDER slot is a conversion the author asked for and keeps its own
// coercion: `string | number | undefined` is not the read's width plus the
// undefined arm, so the read stays where it was -- and it is a HIT, so the
// answer is the same either way.
function wider(n: Node2): string | number | undefined {
  return n.attrs.id;
}
console.log("r19", wider(oneToOne), typeof wider(oneToOne));

// A return whose value can ALREADY say undefined keeps its width.
function alreadyArmed(n: Node2): string | undefined {
  const v: string | undefined = n.attrs.participant;
  return v;
}
console.log("r20", alreadyArmed(oneToOne) === undefined ? "undefined" : alreadyArmed(oneToOne));

// ------------------------------------------------- 5. the loop zapo runs it in
function label(n: Node2, i: number): string {
  const p = participantOf(n);
  return "s" + String(i) + " " + (p === undefined ? "-" : p);
}
const stanzas = [oneToOne, group, oneToOne, group];
for (let i = 0; i < stanzas.length; i += 1) {
  console.log("r21." + String(i), label(stanzas[i]!, i));
}
console.log("r22", stanzas.map((n) => participantOf(n)).filter((v) => v !== undefined).length);

// An early return on the miss path, so the arm crosses a branch.
function firstPresent(ns: Node2[]): string | undefined {
  for (let i = 0; i < ns.length; i += 1) {
    const v = ns[i]!.attrs.participant;
    if (v !== undefined) return v;
  }
  return undefined;
}
console.log("r23", firstPresent([oneToOne]) === undefined ? "undefined" : firstPresent([oneToOne]));
console.log("r24", firstPresent([oneToOne, group]));
