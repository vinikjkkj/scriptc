// `const alt = attrs.sender_pn ?? attrs.sender_lid` — a `??` whose LEFT is
// itself an index-signature keyed read, bound to a local.
//
// This is zapo `message/primitives/incoming.ts:66-68`
// (`extractMessageIdentityAttrs`), and the SCRIPTC_DC_WHERE instrument names it
// ELEVEN times in one paired run against the fake server — once per inbound
// decrypt, plus one. Both keys are absent on an ordinary 1:1 message and the
// author's next lines spread only the defined ones, so Node's answer is simply
// `undefined`.
//
// `keyedReadLocalShortCircuitAtDynWidth` was written for this exact spelling and
// never fired on it. Its gate asks for `init.kind === "nullish"`, and when the
// LEFT operand is a bare keyed read — not a union — `lowerNullishCoalesce`'s own
// dyn rung has already run: it widens both operands, builds the `nullish` at dyn
// width, and checks the result BACK to the checker's type, so what the binding
// rule receives is a `dynCheck` WRAPPING the nullish. The rule that reads as
// working does work — on `const t = override ?? attrs.type`, whose left IS a
// union and therefore keeps the bare `nullish` shape. Correct, and incomplete by
// one lowering shape.
//
// Every branch of the chain is here, and so is the TERNARY spelling, which
// takes the same path. The dereference control keeps throwing on both sides
// because Node throws there too.
interface BinNode {
  readonly tag: string;
  readonly attrs: Readonly<Record<string, string>>;
}

function caught(f: () => void): string {
  try {
    f();
    return "no-throw";
  } catch (e) {
    return e instanceof TypeError ? "TypeError" : "other";
  }
}

function show(v: string | undefined): string {
  return v === undefined ? "none" : "have:" + v;
}

function run(n: BinNode): void {
  // BOTH absent — the zapo shape.
  const bothAbsent = n.attrs.sender_pn ?? n.attrs.sender_lid;
  console.log("both absent:", show(bothAbsent));

  // Left present: the default is never evaluated.
  const leftPresent = n.attrs.id ?? n.attrs.sender_lid;
  console.log("left present:", show(leftPresent));

  // Right present: the chain falls through to it.
  const rightPresent = n.attrs.sender_pn ?? n.attrs.id;
  console.log("right present:", show(rightPresent));

  // A chain of THREE, all absent.
  const three = n.attrs.a1 ?? n.attrs.a2 ?? n.attrs.a3;
  console.log("three absent:", show(three));

  // A chain of three whose TAIL is present.
  const threeTail = n.attrs.a1 ?? n.attrs.a2 ?? n.attrs.id;
  console.log("three tail:", show(threeTail));

  // A literal tail is the ordinary author-written default.
  const literalTail = n.attrs.sender_pn ?? "fallback";
  console.log("literal tail:", literalTail);

  // The TERNARY spelling of the same idea.
  const tern = n.attrs.from ? n.attrs.from : n.attrs.sender_pn;
  console.log("ternary:", show(tern));

  // The control: a use that DEREFERENCES an absent value throws in Node too.
  console.log("deref:", caught(() => { console.log(bothAbsent.length); }));

  // And the reference still reaches an armed parameter and a truthiness test.
  console.log("truthy:", bothAbsent ? "yes" : "no");
  console.log("compare:", bothAbsent === "x" ? "eq" : "ne");
}

run({ tag: "message", attrs: { id: "3EB0", from: "peer@s.whatsapp.net" } });
