/* The SCRIPTC_UNIONSLOT_WHY instrument, tested — because this project has now
 * twice caught an instrument passing without testing anything (a coverage
 * report calling a program "fully static" while its first dial throws; a
 * census's "structural" grade that turned out to be a run). An instrument
 * whose only proof is that somebody looked at its output once is the same
 * class of artefact.
 *
 * WHAT IT IS FOR. `lower-exprs.ts`'s union-typed-slot fence declines
 * `{ ...u, k: v }` when the contextual union's record arms did not resolve to
 * one arm and the spread source is a union with several record arms. Its
 * message names two TYPES. The question anyone deciding whether some narrower
 * rule could admit a given site actually has is the RELATION between the
 * source's arms and the slot's arms, and that relation is nowhere in the text:
 *
 *   identity  the slot's record arms ARE the source's record arms, so the
 *             result's arm is the source's arm carried through at run time;
 *   disjoint  every slot arm is strictly wider than the source arm it
 *             corresponds to, so an arm would have to be INVENTED.
 *
 * On zapo the four rows split ONE identity (`fetcher.ts:92`) against THREE
 * disjoint (`content.ts:183`, `incoming.ts:397`, `mex-notification.ts:192`),
 * and `ARMS=` alone is not enough to act on: `content.ts:183` pairs 3/3 BY
 * FIELD NAME while the other two pair 0/8 and 0/7, so the verdict groups a
 * site the compiler can build with two it cannot. The paired-arm rule CLOSES
 * the first two and refuses the last two, and the instrument has to report
 * enough to tell them apart — the relation, the pairing count, and the
 * per-field type deltas behind a pairing. This test pins all of it:
 *
 *   CLOSED-BY=identity-arm   the arms are the identity map and the literal's
 *                            own spelling lets the rule build it — no fence,
 *                            and therefore no `ARMS=` row at that site at all;
 *   CLOSED-BY=paired-arm     the arms pair one-to-one by field NAME onto
 *                            DIFFERENT interned shapes, and the per-arm
 *                            rebuild moves at least one field;
 *   NOT-CLOSED=<reason>      the rule declined, and WHY, before the fence;
 *   ARMS=<relation>          the fence's own relation report, which now only
 *                            ever appears where the rule declined.
 *
 * A rule that silently declined would leave this file looking exactly as it
 * did when the rule did not exist. */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { loadProgram } from "../src/frontend/program.js";
import { lowerToIr } from "../src/frontend/lowering/lowerer.js";

/** Lower `source` and return the instrument's rows. `on` selects whether the
 * env dial is set, because "off by default" is half the contract. */
function unionslotRows(source: string, on: boolean): string[] {
  const dir = mkdtempSync(join(tmpdir(), "scriptc-unionslot-"));
  const entry = join(dir, "main.ts");
  writeFileSync(entry, source);
  const captured: string[] = [];
  const realError = console.error;
  const previous = process.env["SCRIPTC_UNIONSLOT_WHY"];
  if (on) process.env["SCRIPTC_UNIONSLOT_WHY"] = "1";
  else delete process.env["SCRIPTC_UNIONSLOT_WHY"];
  console.error = (...args: unknown[]): void => {
    captured.push(args.map((a) => String(a)).join(" "));
  };
  try {
    const load = loadProgram(entry);
    // The program is EXPECTED to be refused — the instrument reports at a
    // fence. `lowerToIr` returns the diagnostics rather than throwing, so
    // nothing here needs to inspect them.
    lowerToIr(load.program, load.entry, load.moduleOrder);
  } finally {
    console.error = realError;
    if (previous === undefined) delete process.env["SCRIPTC_UNIONSLOT_WHY"];
    else process.env["SCRIPTC_UNIONSLOT_WHY"] = previous;
  }
  return captured.filter((l) => l.startsWith("UNIONSLOT "));
}

/* Six literals, one per outcome, and every expected value below is readable
 * off these thirty lines rather than off the implementation.
 *
 *   armIdentityClosed  zapo's `fetcher.ts:92` shape — the slot's record arms
 *                      ARE the source's, so the rule builds it and NO fence is
 *                      reached. `viewOnce` is declared on both `Img` and `Vid`,
 *                      which is why the override is legal in every arm.
 *   armIdentityLate    the SAME arms with the spread written AFTER an explicit
 *                      property. The rule requires the union spread FIRST (its
 *                      desugar rebuilds the source's arm, and a contributor the
 *                      spread then overwrites is a different merge), so this
 *                      one declines and the fence still reports `ARMS=identity`
 *                      — which is what keeps the relation report itself tested
 *                      now that the plain identity case no longer reaches it.
 *   armDisjoint        `mex-notification.ts:192`'s shape (`{ ...normalized,
 *                      errors }`): `errors` is required on both `ImgE`/`VidE`
 *                      and absent from both `Img`/`Vid`, so no source arm can
 *                      share a field-name set with a slot arm and the pairing
 *                      must be 0/2. An arm would have to be INVENTED.
 *   armPairedWiden     `content.ts:183`'s RELATION with `content.ts:183`'s
 *                      difficulty removed and a harder one put in: the arms
 *                      pair 2/2 by name onto DIFFERENT interned shapes, and
 *                      the differing field (`n`, `number` against
 *                      `number | null`) is NOT the one the literal
 *                      overrides, so the rebuild has to widen a read rather
 *                      than skip it. The real site's only delta IS its
 *                      override, so nothing there exercises this.
 *   armPairAmbiguous   two arms with the IDENTICAL field-name set `{a, k}`
 *                      at different types. `pairedByNames` counts 2/2 — a
 *                      count is not a pairing — and the rule must refuse
 *                      rather than pick one, because picking wrong writes a
 *                      string into the number arm with no diagnostic.
 *   singleArmSlot      must produce NO row at all — the
 *                      `recordArms.length === 1` rule above the fence answers
 *                      it and neither the rule nor the fence is reached. That
 *                      is the armed half: an instrument that printed a row for
 *                      every object literal would pass everything else here. */
const SOURCE = `
interface Img { readonly url: string; readonly viewOnce?: boolean }
interface Vid { readonly url: string; readonly seconds: number; readonly viewOnce?: boolean }
type Media = Img | Vid

interface ImgE { readonly url: string; readonly viewOnce?: boolean; readonly errors: number }
interface VidE { readonly url: string; readonly seconds: number; readonly viewOnce?: boolean; readonly errors: number }
type MediaE = ImgE | VidE

interface ImgW { readonly url: string; readonly n: number; readonly k: string }
interface VidW { readonly url: string; readonly n: number; readonly frames: number; readonly k: string }
interface ImgWOut { readonly url: string; readonly n: number | null; readonly k: string }
interface VidWOut { readonly url: string; readonly n: number | null; readonly frames: number; readonly k: string }

interface AmbA { readonly a: string; readonly k: boolean }
interface AmbB { readonly a: number; readonly k: boolean }
interface AmbAOut { readonly a: string | null; readonly k: boolean }
interface AmbBOut { readonly a: number | null; readonly k: boolean }

export function armIdentityClosed(m: Media): Media {
    return { ...m, viewOnce: true }
}
export function armIdentityLate(m: Media): Media {
    return { viewOnce: true, ...m }
}
export function armDisjoint(m: Media): MediaE {
    return { ...m, errors: 1 }
}
export function armPairedWiden(m: ImgW | VidW): ImgWOut | VidWOut {
    return { ...m, k: "done" }
}
export function armPairAmbiguous(m: AmbA | AmbB): AmbAOut | AmbBOut {
    return { ...m, k: true }
}
export function singleArmSlot(m: Img): Img | null {
    return { ...m, viewOnce: true }
}
console.log(typeof armIdentityClosed, typeof armIdentityLate, typeof armDisjoint, typeof armPairedWiden, typeof armPairAmbiguous, typeof singleArmSlot)
`;

test("the instrument names the ARM RELATION at each fence, and nothing where there is no fence", () => {
  const rows = unionslotRows(SOURCE, true);
  // Lowering runs collection more than once per program, so a site can be
  // reported repeatedly; the CLAIM is about the distinct rows.
  const distinct = [...new Set(rows)].sort();
  const why = `rows:\n${distinct.join("\n")}`;

  /* THE RULE FIRED, EXACTLY ONCE, AND ON THE ONE LITERAL THAT QUALIFIES.
   * `armIdentityClosed` is the only one of the four whose arms are the
   * identity map AND whose spread is first, so it must be the only
   * `CLOSED-BY` row — and it must not also appear as a fence. */
  const closed = distinct.filter((l) => l.includes(" CLOSED-BY="));
  expect(closed.length, why).toBe(2);
  const identityClosed = closed.filter((l) => l.includes("CLOSED-BY=identity-arm"));
  const pairedClosed = closed.filter((l) => l.includes("CLOSED-BY=paired-arm"));
  expect(identityClosed.length, why).toBe(1);
  expect(pairedClosed.length, why).toBe(1);
  expect(identityClosed[0]).toContain("arms=2");
  expect(identityClosed[0]).toContain("overrides=[viewOnce]");
  // The identity row's PAIRS are every arm with ITSELF — which is what makes
  // it the identity case rather than a pairing that happened to agree.
  expect(identityClosed[0]).toMatch(/pairs=\[(\w+)->\1,(\w+)->\2\]/);
  // The paired row's are not: `n` widens from `number` to `number | null`,
  // so the two sides interned apart and the rebuild has to MOVE the field.
  expect(pairedClosed[0]).toContain("overrides=[k]");
  expect(pairedClosed[0]).not.toMatch(/pairs=\[(\w+)->\1,(\w+)->\2\]/);

  /* AND IT DECLINED FOR A NAMED REASON EVERYWHERE ELSE. `armIdentityLate`'s
   * spread is not first; `armDisjoint`'s arms are not the identity map, and
   * that reason carries BOTH shape lists so a reader can see which arms
   * differed. `singleArmSlot` reaches neither. */
  const declined = distinct.filter((l) => l.includes(" NOT-CLOSED="));
  expect(declined.length, why).toBe(3);
  expect(declined.some((l) => l.includes("NOT-CLOSED=head-not-a-spread")), why).toBe(true);
  expect(declined.some((l) => /NOT-CLOSED=arms-not-paired:\[\w+,\w+\]vs\[\w+,\w+\]/.test(l)), why).toBe(true);
  /* AMBIGUITY IS ITS OWN ANSWER, and it is the armed half of the pairing
   * rule. `AmbA`/`AmbB` carry the IDENTICAL field-name set `{a, k}` at
   * different types, so "the slot arm with these names" does not name one
   * arm — and a rule that picked either would be a coin toss that can write
   * a string into the number arm. The decline has to report AMBIGUITY, not
   * "not paired": they are different facts about the program, and only one
   * of them could ever be fixed by widening the rule. */
  expect(
    declined.some((l) => /NOT-CLOSED=arms-pair-ambiguously-by-name:\[\w+,\w+\]vs\[\w+,\w+\]/.test(l)),
    why,
  ).toBe(true);

  // THREE fences: the two CLOSED literals are gone from this population.
  const fences = distinct.filter((l) => l.includes(" ARMS="));
  expect(fences.length, why).toBe(3);

  const identity = fences.filter((l) => l.includes(" ARMS=identity "));
  const disjoint = fences.filter((l) => l.includes(" ARMS=disjoint "));
  expect(identity.length, why).toBe(1);
  // The disjoint pair: `armDisjoint` (0/2 — no pairing exists) and
  // `armPairAmbiguous` (2/2 by the COUNT, but a count is not a pairing —
  // both arms answer to the same name set). That the two read the same on
  // `ARMS=` and differently on `pairedByNames` is exactly why the
  // fingerprints exist.
  expect(disjoint.length, why).toBe(2);
  const disjointUnpaired = disjoint.filter((l) => l.includes("pairedByNames=0/2"));
  const ambiguousFence = disjoint.filter((l) => l.includes("pairedByNames=2/2"));
  expect(disjointUnpaired.length, why).toBe(1);
  expect(ambiguousFence.length, why).toBe(1);

  // The identity row is the one whose added name every source arm declares —
  // the precondition a clone-and-carry lowering would be gated on.
  expect(identity[0]).toContain("extras=[viewOnce] extrasInEveryArm=true");
  expect(identity[0]).toContain("srcArms=2/2");
  expect(identity[0]).toContain("ctxArms=2/2");
  // The disjoint row's added name is NOT in the source arms: `errors` is what
  // the target arms have and the source arms do not, which is exactly why no
  // arm can be carried through.
  expect(disjointUnpaired[0]).toContain("extras=[errors] extrasInEveryArm=false");

  // Every row is keyed `file@offset`, the SCRIPTC_DC_WHERE spelling. The
  // fence's key is the SPREAD PROPERTY's offset (it is the decliner); the
  // rule's own rows are keyed at the LITERAL, which is the thing it built or
  // declined to build, so the two are deliberately not the same number.
  for (const l of fences) expect(l).toMatch(/UNIONSLOT \S+main\.ts@\d+ ARMS=/);
  for (const l of [...closed, ...declined]) {
    expect(l).toMatch(/UNIONSLOT \S+main\.ts@\d+ (CLOSED-BY|NOT-CLOSED)=/);
  }

  /* THE FINGERPRINTS. `ARMS=disjoint` over two unions that LOOK like the same
   * declared types has two very different causes — a real width difference, or
   * one declared type interned as two shapes — and the verdict alone cannot
   * tell them apart. `pairedByNames` does: it counts source arms that have a
   * slot arm with an IDENTICAL field-name set.
   *
   * Here the two cases are known by construction and they must read
   * differently, which is what makes this an assertion and not a printout:
   *   identity — every arm pairs with itself, 2/2;
   *   disjoint — `errors` is required on both slot arms and on NEITHER source
   *              arm, so no field-name set matches and it is 0/2. A
   *              `pairedByNames` that always returned the arm count would pass
   *              the identity case and fail here. */
  expect(identity[0]).toContain("pairedByNames=2/2");
  expect(disjointUnpaired[0]).toContain("pairedByNames=0/2");
  /* THE FIELD DELTAS. `pairedByNames=n/n` says the arms CORRESPOND; it does
   * not say the per-arm reshape is buildable, and the ONLY thing that can
   * make two same-named shapes intern apart is a field TYPE. The ambiguous
   * pair is where that reads: each of its arms differs from its name-mate
   * in field `a`, so the row must NAME the field and both types rather than
   * leave a reader to infer them from shape ids. `fieldDeltas=0` on the 0/2
   * row is the negative half — no pairing, so nothing to compare. */
  expect(disjointUnpaired[0]).toContain("fieldDeltas=0[]");
  expect(ambiguousFence[0], why).toMatch(/fieldDeltas=[1-9]\d*\[/);
  expect(ambiguousFence[0], why).toContain(":a:");
  // Shapes go out as `shapeId/fieldCount` per arm, so a reader can see the
  // widths rather than infer them; the two arms here have 2 and 3 fields, and
  // the disjoint slot's arms have one more field each.
  for (const l of fences) {
    expect(l).toMatch(/srcShapes=\[\w+\/\d+,\w+\/\d+\] ctxShapes=\[\w+\/\d+,\w+\/\d+\]/);
  }
  // The identity row's two sides are the SAME shape ids; the disjoint row's are
  // not, and its slot arms are one field WIDER (the required `errors`) — which
  // is the difference `pairedByNames` exists to report.
  expect(identity[0]).toMatch(/srcShapes=\[(\w+\/\d+,\w+\/\d+)\] ctxShapes=\[\1\]/);
  for (const l of disjoint) {
    expect(l).not.toMatch(/srcShapes=\[(\w+\/\d+,\w+\/\d+)\] ctxShapes=\[\1\]/);
  }
  expect(identity[0]).toContain("ctx0='Media'");
  expect(disjointUnpaired[0]).toContain("ctx0='MediaE'");
});

test("the instrument is silent with the dial unset", () => {
  expect(unionslotRows(SOURCE, false)).toEqual([]);
});
