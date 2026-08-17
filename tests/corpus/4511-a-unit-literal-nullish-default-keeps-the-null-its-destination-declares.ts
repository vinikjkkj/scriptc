// `abKey: attrs.ab_key ?? null` — zapo `src/client/events/abprops.ts:52:16`,
// which the SCRIPTC_DC_WHERE instrument names in a paired run against the fake
// server and which `estado-content3.md` §5.4 characterised without fixing.
//
// tsc types an index-signature read by the signature's VALUE type, so it types
// `attrs.ab_key` as `string` and the whole `?? null` as `string` — the default
// is dead as far as the checker is concerned. `lowerNullishCoalesce`'s dyn rung
// then widened the read, took the nullish correctly (an absent key IS nullish,
// so the RIGHT operand won), and validated the result back to `string`, which
// refused the `null` it had just produced. Node prints `null`.
//
// The honest type of `L ?? <unit literal>` is `want | unit`: JS guarantees the
// unit is the value whenever the left is nullish. The retype is LICENSED by the
// destination, and the second half of this fixture is why. Widened without a
// licence, `(attrs.k ?? null).length` with the key PRESENT — which main
// compiles and gets right — becomes `SC2003 union types must match exactly:
// expected 'string', got 'null | string'`, a new refusal on a working program.
// So the cases below are TWO populations that must both hold:
//
//   1-7   destinations that DECLARE the unit: main threw, Node prints the
//         default, and these are the rows the fix closes.
//   A1-A3 destinations that CANNOT hold the unit, ending with the RECEIVER
//         position that has no contextual type at all. These keep main's exact
//         behaviour and must not become compile-time refusals. A3 with the key
//         PRESENT is the row an unlicensed retype breaks.
//
// Only at-risk rows that agree with Node on BOTH sides are here. The plain-
// `string` FIELD and RETURN destinations with an absent key, and a unit-TYPED
// default that is not a unit LITERAL, all diverge from Node on main AND on this
// branch — pre-existing, unrelated to this change, and therefore not
// order-parity material. They live in `repro-sx/s1.ts` (case 10) and
// `repro-sx/s2.ts` (A5-A8) with both sides measured.
//
// The controls at the end are the rest of the predicate's arming: an enclosing
// `??` still hands over at dyn width with no check at all, and a left that is
// already honestly typed never reaches this rung.
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

function showN(v: string | null): string {
  return v === null ? "null" : "have:" + v;
}

function showU(v: string | undefined): string {
  return v === undefined ? "undefined" : "have:" + v;
}

// ---- 1-7: destinations that declare the unit -------------------------------

interface Snap {
  readonly abKey: string | null;
}

function asField(n: BinNode): Snap {
  return { abKey: n.attrs.ab_key ?? null };
}

function takesNullable(v: string | null): string {
  return showN(v);
}

function asReturn(n: BinNode): string | null {
  return n.attrs.ab_key ?? null;
}

function asUndef(n: BinNode): string | undefined {
  return n.attrs.ab_key ?? undefined;
}

function declared(n: BinNode): void {
  // 1 — the real site's destination: a record FIELD declaring the null.
  console.log("1 field:", showN(asField(n).abKey));

  // 2 — a const BINDING whose declared slot admits null, read by a consumer
  // that takes the value dynamically.
  //
  // The consumer matters here and it is a LIMIT of this fix, recorded on
  // purpose. tsc narrows a `const` by the type of its initializer, and the
  // initializer's type is the very lie this rung exists to correct — so at every
  // REFERENCE tsc says `string`, and `maybeNarrow` re-narrows the value back to
  // `string` however wide the local itself is. Measured both ways: with
  // `keyedReadLocalShortCircuitAlreadyWidened` firing the reference throws
  // `expected string at $, got null`, and with `SCRIPTC_LOCALSC2_OFF=1`
  // ablating it the union-typed local throws `null is not representable in the
  // target union` instead. Neither is a regression — main throws one operator
  // earlier, at the initializer — and neither is a fix. A reference consumed
  // DYNAMICALLY has nothing to re-narrow to, and that one is fixed.
  const bound: string | null = n.attrs.ab_key ?? null;
  console.log("2 binding:", bound);

  // 3 — an ARGUMENT whose declared parameter admits null.
  console.log("3 arg:", takesNullable(n.attrs.ab_key ?? null));

  // 4 — a RETURN whose declared type admits null.
  console.log("4 return:", showN(asReturn(n)));

  // 5 — no named destination: the value goes straight into a rest parameter.
  // §5.4 read this as "no destination at all"; its contextual type is the rest
  // parameter's element, and that element admits the unit, which is why a
  // destination-aware rule reaches this case after all.
  console.log("5 bare:", n.attrs.ab_key ?? null);

  // 6 — `?? undefined`, the other unit literal.
  console.log("6 undef:", showU(asUndef(n)));

  // 7 — an ARRAY whose element type declares the null.
  const arr: (string | null)[] = [n.attrs.ab_key ?? null, n.attrs.hash ?? null];
  console.log("7 array:", showN(arr[0]), showN(arr[1]));
}

// ---- A1-A6: destinations that cannot hold the unit -------------------------

function wantsString(v: string): number {
  return v.length;
}

function undeclared(n: BinNode): void {
  // A1 — a binding declared plain `string`. tsc accepts it; the program is
  // unsound and Node simply tolerates the unsoundness. Unchanged from main.
  console.log("A1 bind:", caught(() => {
    const s: string = n.attrs.ab_key ?? null;
    console.log("   value:", s);
  }));

  // A2 — an ARGUMENT declared plain `string`. Both sides refuse the absent key
  // at run time and Node faults on the dereference, so the rows agree.
  console.log("A2 arg:", caught(() => { console.log("   len:", wantsString(n.attrs.ab_key ?? null)); }));

  // A3 — the RECEIVER position, the one with no contextual type at all. This is
  // the case that disqualifies an UNLICENSED retype: with the key present it
  // compiles and prints the length on main, and an unlicensed widening turns it
  // into `SC2003 ... expected 'string', got 'null | string'`.
  console.log("A3 recv:", caught(() => { console.log("   len:", (n.attrs.ab_key ?? null).length); }));
}

// ---- the arming controls ---------------------------------------------------

function controls(n: BinNode): void {
  // C2 — an enclosing `??`. The inner node is tested for nullish by its parent,
  // so it hands over at dyn width with no validated exit; the answer is the
  // tail, on both sides, unchanged.
  console.log("C2 chain:", n.attrs.ab_key ?? n.attrs.other ?? "tail");

  // C3 — the left is ALREADY honestly typed, so this rung never fires.
  const loose: { readonly k: string | null } = { k: null };
  const v: string | null = loose.k ?? null;
  console.log("C3 honest:", showN(v));
}

console.log("== absent ==");
declared({ attrs: {} });
undeclared({ attrs: {} });
controls({ attrs: {} });

console.log("== present ==");
declared({ attrs: { ab_key: "K", hash: "H" } });
undeclared({ attrs: { ab_key: "K" } });
controls({ attrs: { ab_key: "K" } });
