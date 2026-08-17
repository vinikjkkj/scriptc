// `parseOptionalInt(retry.attrs.error ?? node.attrs.error)` — zapo
// `src/retry/parse.ts:124`, inside `parseRetryReceiptRequest`. It threw
// `expected string at $, got undefined`, so the compiled client neither RESENT
// on an inbound `<receipt type=retry>` nor ACKED it (`shouldAck = true` sits
// after the parse). Two stanzas, priced at this rung by `block/sixteen`.
//
// tsc types an index-signature read by the signature's VALUE type, so it types
// both operands `string` and the whole `??` `string`. Every operand can be
// absent at run time, and when they all are, JS evaluates the chain to the last
// read's `undefined` — a value the validated exit back to `string` refused.
//
// 4511 fixed the `?? <unit literal>` spelling by widening the checked type to
// `want | unit` under a DESTINATION licence. The only thing missing for
// `?? <another keyed read>` was seeing the unit, because it is not written in
// the source. `recordKeyReadAtSlotWidth` — the predicate this rung already
// applies to the LEFT operand — sees it: it accepts exactly an index-signature
// read whose checker type cannot say undefined and whose runtime value can.
//
// The licence is unchanged, which is what bounds this. On zapo,
// `SCRIPTC_NULLISH_UNIT=1` reports 51 firings of the rung; 42 have no unit
// literal and only the 8 whose destination is `string | undefined` widen. So
// the two populations below must BOTH hold:
//
//   1-6   destinations that DECLARE undefined: main threw, Node prints the
//         value, and these are the rows the fix closes.
//   A1-A3 destinations that CANNOT hold undefined, ending with the RECEIVER
//         position that has no contextual type at all. These keep main's exact
//         behaviour and must not become compile-time refusals.

interface BinNode {
  readonly attrs: Readonly<Record<string, string>>;
}

function caught(f: () => void): string {
  try {
    f();
    return "no-throw";
  } catch {
    return "threw";
  }
}

function showU(v: string | undefined): string {
  return v === undefined ? "undefined" : "have:" + v;
}

function parseOptionalInt(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
}

function showN(v: number | undefined): string {
  return v === undefined ? "undefined" : "have:" + String(v);
}

// ---- 1-6: destinations that declare undefined ------------------------------

interface Parsed {
  readonly retryReason: number | undefined;
  readonly t: string | undefined;
}

function takesOptional(v: string | undefined): string {
  return showU(v);
}

function asReturn(a: BinNode, b: BinNode): string | undefined {
  return a.attrs.error ?? b.attrs.error;
}

function declared(a: BinNode, b: BinNode): void {
  // 1 — the real site: the chain goes straight into a CALL ARGUMENT whose
  // parameter declares `string | undefined`.
  console.log("1 arg:", showN(parseOptionalInt(a.attrs.error ?? b.attrs.error)));

  // 2 — the same chain into an ARGUMENT of a plain optional-string parameter.
  console.log("2 arg2:", takesOptional(a.attrs.error ?? b.attrs.error));

  // 3 — a RETURN declaring undefined.
  console.log("3 return:", showU(asReturn(a, b)));

  // 4 — an optional FIELD. `parse.ts:125` (`retry.attrs.t ?? node.attrs.t`)
  // is this one, and it was ALREADY served on main: the field destination
  // takes the value dynamically. It is here as the row that isolated the
  // call-argument destination as the gap.
  const p: Parsed = {
    retryReason: parseOptionalInt(a.attrs.error ?? b.attrs.error),
    t: a.attrs.t ?? b.attrs.t,
  };
  console.log("4 record:", showN(p.retryReason), showU(p.t));

  // 5 — three keyed reads in a row: only the LAST one's absence can reach the
  // destination, and it does.
  console.log("5 three:", takesOptional(a.attrs.x ?? b.attrs.y ?? a.attrs.z));

  // 6 — a mixed chain whose tail IS a unit literal, 4511's rung. The two
  // predicates must not fight: the literal wins and the arm is `null`.
  const nn: string | null = a.attrs.error ?? null;
  console.log("6 literal tail:", nn === null ? "null" : "have:" + nn);
}

// ---- A1-A3: destinations that cannot hold undefined ------------------------

function wantsString(v: string): number {
  return v.length;
}

function undeclared(a: BinNode, b: BinNode): void {
  // A1 — a binding declared plain `string`. Unchanged from main.
  console.log("A1 bind:", caught(() => {
    const s: string = a.attrs.error ?? b.attrs.error;
    console.log("   value:", s);
  }));

  // A2 — an ARGUMENT declared plain `string`.
  console.log("A2 arg:", caught(() => { console.log("   len:", wantsString(a.attrs.error ?? b.attrs.error)); }));

  // A3 — the RECEIVER position, with no contextual type at all. This is the
  // case that disqualifies an UNLICENSED widening: with the keys present it
  // compiles and prints the length, and widening it unconditionally turns that
  // into a new compile-time refusal on a program main gets right.
  console.log("A3 recv:", caught(() => { console.log("   len:", (a.attrs.error ?? b.attrs.error).length); }));
}

// ---- the arming controls ---------------------------------------------------

function controls(a: BinNode, b: BinNode): void {
  // C1 — an enclosing `??` still hands over at dyn width with no check.
  console.log("C1 chain:", a.attrs.error ?? b.attrs.error ?? "tail");

  // C2 — a right operand that is NOT a keyed read: a plain string default
  // never makes the result optional, so the rung must not widen.
  console.log("C2 string default:", a.attrs.error ?? "dflt");

  // C3 — a right operand that is a keyed read off a DIFFERENT index-signature
  // shape. The predicate is about the read, not about the receiver, so a second
  // bag widens the same way.
  const other: Readonly<Record<string, string>> = {};
  console.log("C3 other bag:", takesOptional(a.attrs.error ?? other["error"]));

  // NOT HERE, and measured rather than assumed: a right operand that is a
  // DECLARED OPTIONAL FIELD (`{ readonly error?: string }`) rather than a keyed
  // read. `recordKeyReadAtSlotWidth` declines it — the read is a fieldGet, not a
  // recordKeyGet — so the rung never widens, and the site throws
  // `expected string at $, got undefined` where Node prints `undefined`. That
  // is IDENTICAL on main and on this branch (`repro-rt/lab/c3.ts`, run both
  // ways), so it is a neighbouring gap this change neither closes nor opens,
  // and it is kept out of order-parity because it diverges on both sides.
}

const A_ABSENT: BinNode = { attrs: { count: "1", id: "X" } };
const B_ABSENT: BinNode = { attrs: { id: "Y", from: "peer" } };
const A_PRESENT: BinNode = { attrs: { count: "1", id: "X", error: "500", t: "9" } };
const B_PRESENT: BinNode = { attrs: { id: "Y", error: "404", t: "8", y: "Y2" } };

console.log("== both absent ==");
declared(A_ABSENT, B_ABSENT);
undeclared(A_ABSENT, B_ABSENT);
controls(A_ABSENT, B_ABSENT);

console.log("== left absent, right present ==");
declared(A_ABSENT, B_PRESENT);
undeclared(A_ABSENT, B_PRESENT);
controls(A_ABSENT, B_PRESENT);

console.log("== both present ==");
declared(A_PRESENT, B_PRESENT);
undeclared(A_PRESENT, B_PRESENT);
controls(A_PRESENT, B_PRESENT);
