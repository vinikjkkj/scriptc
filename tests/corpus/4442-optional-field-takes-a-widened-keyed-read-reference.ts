// The same question at the RECORD-LITERAL FIELD destination.
//
// `participantJid: event.rawNode.attrs.participant` into a
// `participantJid?: string` slot already reads at the field's armed width:
// tsc does not narrow an optional property from the literal that initialised
// it, so the readers were compiled against `string | undefined` and every one
// of them discriminates. That is what makes the field a keep-case where a
// declaration, an assignment and a property write are not.
//
// One binding earlier the author writes `const p = ...attrs.participant` and
// spells the field `participantJid: p`. The read has been widened to dyn, tsc
// narrows the REFERENCE back to `string`, and what arrives at the field is
// maybeNarrow's validated bridge - so the rung declined on the node's kind
// while the destination was the same destination it was admitted for.
//
// A case deliberately NOT in this fixture, checked against Node before it was
// written rather than after: a REQUIRED `string` field. `{ stanzaType:
// missingType }` into `stanzaType: string` does not throw in Node - it stores
// the undefined and a later read prints "undefined". scriptc refuses it (the
// field has no arm and no destination fact says otherwise), so the two
// programs disagree and a corpus entry must be byte-exact. It is a real,
// still-open divergence of the same family, and it belongs in a report, not
// in a fixture that would have to pin the wrong answer to pass.
interface Ev {
  readonly stanzaId: string;
  readonly participantJid?: string;
  readonly recipientJid?: string;
}


interface BinNode {
  readonly tag: string;
  readonly attrs: Readonly<Record<string, string>>;
}

function render(e: Ev): string {
  const p = e.participantJid === undefined ? "-" : e.participantJid;
  const r = e.recipientJid === undefined ? "-" : e.recipientJid;
  return e.stanzaId + "/" + p + "/" + r;
}

function caught(f: () => void): string {
  try {
    f();
    return "no-throw";
  } catch (e) {
    return e instanceof TypeError ? "TypeError" : "other";
  }
}

function run(n: BinNode): void {
  const part = n.attrs.participant;
  const recip = n.attrs.recipient;
  const id = n.attrs.id;
  const ev: Ev = { stanzaId: id, participantJid: part, recipientJid: recip };
  console.log("both absent:", render(ev));

  const ev2: Ev = { stanzaId: id, participantJid: id, recipientJid: recip };
  console.log("one present:", render(ev2));

  // The DEREFERENCE control, which must keep throwing on both sides: Node
  // throws on `.length` of undefined too, so the two programs agree.
  const missingType = n.attrs.type;
  console.log("deref:", caught(() => { console.log(missingType.length); }));

  // The same reference reaching the field through a nested literal - the
  // destination fact is the inner field's, not the outer one's.
  const nested: { readonly ev: Ev } = {
    ev: { stanzaId: id, participantJid: missingType, recipientJid: part },
  };
  console.log("nested:", render(nested.ev));
}

run({ tag: "receipt", attrs: { id: "DVOUT1" } });
