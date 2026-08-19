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
 * FIELD NAME while the other two pair 0/8 and 0/7, so the verdict groups
 * sites the compiler can build with one it cannot. The paired-arm rule now
 * CLOSES all four — `mex-notification.ts:192` reads 0/7 only because its
 * literal SUPPLIES the missing name, and `incoming.ts:397` reads 0/8 only
 * because a leading plain-record CONTRIBUTOR supplies its eight. Both
 * belong to the shape the branch builds rather than the one it reads, and
 * folding them into the pairing key is the whole of both closures. The
 * instrument has to report enough to tell every outcome apart: the
 * relation, the pairing count, the supplied names, the contributors, and
 * the per-field type deltas behind a pairing. This test pins all of it:
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

/* Seven literals, one per outcome, and every expected value below is readable
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
 *   armSuppliedName    `mex-notification.ts:192`'s shape (`{ ...normalized,
 *                      errors }`): `errors` is required on both `ImgE`/`VidE`
 *                      and absent from both `Img`/`Vid`. This used to read
 *                      `pairedByNames=0/2` and was graded "an arm would have
 *                      to be INVENTED"; it is CLOSED now, and the reason the
 *                      old reading was wrong is in the instrument's own
 *                      `extras=[errors]` field. A PLAIN override is written
 *                      into every branch unconditionally, so it belongs to
 *                      the shape the branch BUILDS: source arm + `errors` IS
 *                      the slot arm, and nothing is invented. The pairing
 *                      folds the supplied names into the source side.
 *   armTwoSpreads      `incoming.ts:397`'s shape (`{ ...baseEvent, ...parsed
 *                      }`) — TWO plain spreads with the union one SECOND.
 *                      CLOSED: the leading spread is a plain-record
 *                      CONTRIBUTOR, its names join the source side of the
 *                      pairing key exactly as a plain override's do, and the
 *                      source still wins every name it declares because it is
 *                      written after the contributor. It is the only closed
 *                      row with an EMPTY `overrides` and a non-empty
 *                      `contributors`, which is how this test tells it from
 *                      the two override-driven ones.
 *   armUnionContributor  a contributor that is itself a UNION. Refused by
 *                      name (`contributor-not-a-record:union`), and this is
 *                      where the genuine `pairedByNames=0/2` reading now
 *                      lives — the fence's own count folds nothing in, so a
 *                      two-spread decline still reads 0/2.
 *   armContribPrecedence  the configuration the contributor rule is ARMED
 *                      against: `n` is supplied by the contributor and also
 *                      declared by ONE source arm, so Node reads it from the
 *                      SOURCE there and from the CONTRIBUTOR in the other
 *                      arm. Once the contributor's names join the key the two
 *                      source arms collapse onto ONE key and the pairing
 *                      refuses as AMBIGUOUS. Its fence reads
 *                      `pairedByNames=1/2` — a third fingerprint on the same
 *                      `ARMS=disjoint` verdict.
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

interface BaseF { readonly rawId: string; readonly at: number }
interface ImgB { readonly url: string; readonly viewOnce?: boolean; readonly rawId: string; readonly at: number }
interface VidB { readonly url: string; readonly seconds: number; readonly viewOnce?: boolean; readonly rawId: string; readonly at: number }
type MediaB = ImgB | VidB

interface AmbA { readonly a: string; readonly k: boolean }
interface AmbB { readonly a: number; readonly k: boolean }
interface AmbAOut { readonly a: string | null; readonly k: boolean }
interface AmbBOut { readonly a: number | null; readonly k: boolean }

interface BaseU1 { readonly rawId: string; readonly at: number }
interface BaseU2 { readonly rawId: string; readonly at: string }
interface ImgU { readonly url: string; readonly viewOnce?: boolean; readonly rawId: string; readonly at: number | string }
interface VidU { readonly url: string; readonly seconds: number; readonly viewOnce?: boolean; readonly rawId: string; readonly at: number | string }
type MediaU = ImgU | VidU

interface PrecA { readonly k: string; readonly n: number; readonly t: number }
interface PrecB { readonly k: string; readonly t: string }
interface PrecLead { readonly k: string; readonly n: number }
interface PrecOutA { readonly k: string; readonly n: number; readonly t: number }
interface PrecOutB { readonly k: string; readonly n: number; readonly t: string }

export function armIdentityClosed(m: Media): Media {
    return { ...m, viewOnce: true }
}
export function armIdentityLate(m: Media): Media {
    return { viewOnce: true, ...m }
}
export function armSuppliedName(m: Media): MediaE {
    return { ...m, errors: 1 }
}
export function armTwoSpreads(b: BaseF, m: Media): MediaB {
    return { ...b, ...m }
}
export function armPairedWiden(m: ImgW | VidW): ImgWOut | VidWOut {
    return { ...m, k: "done" }
}
export function armPairAmbiguous(m: AmbA | AmbB): AmbAOut | AmbBOut {
    return { ...m, k: true }
}
export function armUnionContributor(b: BaseU1 | BaseU2, m: Media): MediaU {
    return { ...b, ...m }
}
export function armContribPrecedence(lead: PrecLead, s: PrecA | PrecB): PrecOutA | PrecOutB {
    return { ...lead, ...s }
}
export function singleArmSlot(m: Img): Img | null {
    return { ...m, viewOnce: true }
}
console.log(typeof armIdentityClosed, typeof armIdentityLate, typeof armSuppliedName, typeof armTwoSpreads, typeof armPairedWiden, typeof armPairAmbiguous, typeof armUnionContributor, typeof armContribPrecedence, typeof singleArmSlot)
`;

test("the instrument names the ARM RELATION at each fence, and nothing where there is no fence", () => {
  const rows = unionslotRows(SOURCE, true);
  // Lowering runs collection more than once per program, so a site can be
  // reported repeatedly; the CLAIM is about the distinct rows.
  const distinct = [...new Set(rows)].sort();
  const why = `rows:\n${distinct.join("\n")}`;

  /* THE RULE FIRED ON EXACTLY THE THREE LITERALS THAT QUALIFY, and on no
   * other. `armIdentityClosed` is the only one whose arms are the identity
   * map AND whose spread is first, so it must be the only `identity-arm`
   * row; `armPairedWiden` and `armSuppliedName` are the two `paired-arm`
   * ones. None of the three may also appear as a fence. */
  const closed = distinct.filter((l) => l.includes(" CLOSED-BY="));
  expect(closed.length, why).toBe(4);
  const identityClosed = closed.filter((l) => l.includes("CLOSED-BY=identity-arm"));
  const pairedClosed = closed.filter((l) => l.includes("CLOSED-BY=paired-arm"));
  expect(identityClosed.length, why).toBe(1);
  expect(pairedClosed.length, why).toBe(3);
  expect(identityClosed[0]).toContain("arms=2");
  expect(identityClosed[0]).toContain("overrides=[viewOnce]");
  // The identity row's PAIRS are every arm with ITSELF — which is what makes
  // it the identity case rather than a pairing that happened to agree.
  expect(identityClosed[0]).toMatch(/pairs=\[(\w+)->\1,(\w+)->\2\]/);
  // Neither paired row's are: `armPairedWiden` widens `n` from `number` to
  // `number | null`, and `armSuppliedName`'s slot arms carry a field its
  // source arms do not. Both interned apart, and both rebuilds MOVE a shape.
  const widenClosed = pairedClosed.filter((l) => l.includes("overrides=[k]"));
  const suppliedClosed = pairedClosed.filter((l) => l.includes("overrides=[errors]"));
  expect(widenClosed.length, why).toBe(1);
  expect(suppliedClosed.length, why).toBe(1);
  /* THE CONTRIBUTOR ROW. `armTwoSpreads` has NO override at all -- every
   * name its slot arms carry and its source arms do not comes from the
   * LEADING spread -- so it is the one closed row whose `overrides` is empty
   * and whose `contributors` is not. Exactly one contributor, named by shape
   * id, is what separates it from the two override-driven rows above. */
  const contribClosed = pairedClosed.filter((l) => /contributors=\[\w+\]/.test(l));
  expect(contribClosed.length, why).toBe(1);
  expect(contribClosed[0], why).toContain("overrides=[]");
  expect(contribClosed[0], why).toContain("arms=2");
  for (const l of [...identityClosed, ...widenClosed, ...suppliedClosed]) {
    expect(l, why).toContain("contributors=[]");
  }
  for (const l of pairedClosed) expect(l).not.toMatch(/pairs=\[(\w+)->\1,(\w+)->\2\]/);
  // THE SUPPLIED-NAME ROW is the one this instrument's old reading got
  // wrong: `errors` is on NEITHER source arm, and the rule still pairs 2/2
  // because a plain override belongs to the shape the branch BUILDS.
  expect(suppliedClosed[0]).toContain("arms=2");

  /* AND IT DECLINED FOR A NAMED REASON EVERYWHERE ELSE. `armIdentityLate`'s
   * spread is not first; `armTwoSpreads` puts the union spread SECOND, which
   * this rule does not model; `armPairAmbiguous`'s arms answer to one name
   * set. `singleArmSlot` reaches neither. */
  const declined = distinct.filter((l) => l.includes(" NOT-CLOSED="));
  expect(declined.length, why).toBe(4);
  expect(declined.some((l) => l.includes("NOT-CLOSED=head-not-a-spread")), why).toBe(true);
  /* A UNION CONTRIBUTOR is refused by its own named reason rather than by
   * the pairing: "which contributor supplies this name" is not a
   * compile-time fact when the contributor has arms, and the per-arm rebuild
   * has no single shape to copy from. */
  expect(
    declined.some((l) => l.includes("NOT-CLOSED=contributor-not-a-record:union")),
    why,
  ).toBe(true);
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

  // FOUR fences: the four CLOSED literals are gone from this population.
  const fences = distinct.filter((l) => l.includes(" ARMS="));
  expect(fences.length, why).toBe(4);

  const identity = fences.filter((l) => l.includes(" ARMS=identity "));
  const disjoint = fences.filter((l) => l.includes(" ARMS=disjoint "));
  expect(identity.length, why).toBe(1);
  // The disjoint TRIO: `armUnionContributor` (0/2 — the fence's own count
  // folds nothing in, so a two-spread decline still reads 0/2),
  // `armPairAmbiguous` (2/2 by the COUNT, but a count is not a pairing —
  // both arms answer to the same name set) and `armContribPrecedence` (1/2 —
  // one source arm already carries the contributor's name and one does not).
  // That the three read the same on `ARMS=` and differently on
  // `pairedByNames` is exactly why the fingerprints exist.
  expect(disjoint.length, why).toBe(3);
  const disjointUnpaired = disjoint.filter((l) => l.includes("pairedByNames=0/2"));
  const ambiguousFence = disjoint.filter((l) => l.includes("pairedByNames=2/2"));
  const precedenceFence = disjoint.filter((l) => l.includes("pairedByNames=1/2"));
  expect(disjointUnpaired.length, why).toBe(1);
  expect(ambiguousFence.length, why).toBe(1);
  /* THE PER-ARM PRECEDENCE ROW, and its reading is a THIRD fingerprint on
   * the same `ARMS=disjoint` verdict: 1/2. One source arm already carries the
   * contributor's name and one does not, so exactly one of the two has a
   * name-mate on the slot side before any folding -- and once the
   * contributor's names DO join the key both arms answer to it and the
   * pairing refuses as ambiguous. A rule that folded contributor names in
   * without the ambiguity guard would build this site and read `n` from the
   * wrong contributor in one of its two arms, with no diagnostic. */
  expect(precedenceFence.length, why).toBe(1);
  expect(precedenceFence[0], why).toContain("spreads=2");
  expect(
    declined.filter((l) => l.includes("NOT-CLOSED=arms-pair-ambiguously-by-name")).length,
    why,
  ).toBe(2);

  // The identity row is the one whose added name every source arm declares —
  // the precondition a clone-and-carry lowering would be gated on.
  expect(identity[0]).toContain("extras=[viewOnce] extrasInEveryArm=true");
  expect(identity[0]).toContain("srcArms=2/2");
  expect(identity[0]).toContain("ctxArms=2/2");
  // The disjoint row has NO added name at all: `armUnionContributor` has no
  // override, so `extras` is empty. What its slot arms carry and its source
  // arms do not comes from a CONTRIBUTOR — and the fence's own `extras`
  // reports overrides only, which is why a closed contributor site and a
  // refused one read identically here and differently on `contributors=`.
  expect(disjointUnpaired[0]).toContain("extras=[] extrasInEveryArm=true");
  expect(disjointUnpaired[0]).toContain("spreads=2");

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
   *   disjoint — `armUnionContributor`'s slot arms carry two names on
   *              NEITHER source arm, so no field-name set matches and it is
   *              0/2. A `pairedByNames` that always returned the arm count
   *              would pass the identity case and fail here. */
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
  // The identity row's two sides are the SAME shape ids; the disjoint rows'
  // are not, and `armUnionContributor`'s slot arms are TWO fields WIDER (the
  // contributor's `rawId` and `at`) — which is the difference
  // `pairedByNames` exists to report.
  expect(identity[0]).toMatch(/srcShapes=\[(\w+\/\d+,\w+\/\d+)\] ctxShapes=\[\1\]/);
  for (const l of disjoint) {
    expect(l).not.toMatch(/srcShapes=\[(\w+\/\d+,\w+\/\d+)\] ctxShapes=\[\1\]/);
  }
  expect(identity[0]).toContain("ctx0='Media'");
  expect(disjointUnpaired[0]).toContain("ctx0='MediaU'");
});

test("the instrument is silent with the dial unset", () => {
  expect(unionslotRows(SOURCE, false)).toEqual([]);
});
