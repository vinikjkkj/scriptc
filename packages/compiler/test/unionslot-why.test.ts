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
 * On zapo at main those two relations split the fence's four rows two and two,
 * and the split does not line up with the must-not-close grades — which is the
 * whole reason the instrument exists, and the reason it must not be allowed to
 * go quietly silent. */
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

/* Three literals, one per outcome. `armIdentity` is zapo's
 * `content.ts:183` / `fetcher.ts:92` shape; `armDisjoint` is
 * `mex-notification.ts:192`'s (`{ ...normalized, errors }`, where every target
 * arm is a source arm plus a required field); `singleArmSlot` must produce NO
 * row at all, because the `recordArms.length === 1` rule above the fence
 * answers it and no fence is reached. That third case is the armed half: an
 * instrument that printed a row for everything would pass the first two
 * assertions. */
const SOURCE = `
interface Img { readonly url: string; readonly viewOnce?: boolean }
interface Vid { readonly url: string; readonly seconds: number; readonly viewOnce?: boolean }
type Media = Img | Vid

interface ImgE { readonly url: string; readonly viewOnce?: boolean; readonly errors: number }
interface VidE { readonly url: string; readonly seconds: number; readonly viewOnce?: boolean; readonly errors: number }
type MediaE = ImgE | VidE

export function armIdentity(m: Media): Media {
    return { ...m, viewOnce: true }
}
export function armDisjoint(m: Media): MediaE {
    return { ...m, errors: 1 }
}
export function singleArmSlot(m: Img): Img | null {
    return { ...m, viewOnce: true }
}
console.log(typeof armIdentity, typeof armDisjoint, typeof singleArmSlot)
`;

test("the instrument names the ARM RELATION at each fence, and nothing where there is no fence", () => {
  const rows = unionslotRows(SOURCE, true);
  // Lowering runs collection more than once per program, so a site can be
  // reported repeatedly; the CLAIM is about the distinct rows.
  const distinct = [...new Set(rows)].sort();
  expect(distinct.length, `rows:\n${distinct.join("\n")}`).toBe(2);

  const identity = distinct.filter((l) => l.includes(" ARMS=identity "));
  const disjoint = distinct.filter((l) => l.includes(" ARMS=disjoint "));
  expect(identity.length, `rows:\n${distinct.join("\n")}`).toBe(1);
  expect(disjoint.length, `rows:\n${distinct.join("\n")}`).toBe(1);

  // The identity row is the one whose added name every source arm declares —
  // the precondition a clone-and-carry lowering would be gated on.
  expect(identity[0]).toContain("extras=[viewOnce] extrasInEveryArm=true");
  expect(identity[0]).toContain("srcArms=2/2");
  expect(identity[0]).toContain("ctxArms=2/2");
  // The disjoint row's added name is NOT in the source arms: `errors` is what
  // the target arms have and the source arms do not, which is exactly why no
  // arm can be carried through.
  expect(disjoint[0]).toContain("extras=[errors] extrasInEveryArm=false");

  // Both rows are keyed `file@offset`, the SCRIPTC_DC_WHERE spelling.
  for (const l of distinct) expect(l).toMatch(/UNIONSLOT \S+main\.ts@\d+ ARMS=/);

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
  expect(disjoint[0]).toContain("pairedByNames=0/2");
  // Shapes go out as `shapeId/fieldCount` per arm, so a reader can see the
  // widths rather than infer them; the two arms here have 2 and 3 fields, and
  // the disjoint slot's arms have one more field each.
  for (const l of distinct) {
    expect(l).toMatch(/srcShapes=\[\w+\/\d+,\w+\/\d+\] ctxShapes=\[\w+\/\d+,\w+\/\d+\]/);
  }
  // The identity row's two sides are the SAME shape ids; the disjoint row's are
  // not, and its slot arms are one field WIDER (the required `errors`) — which
  // is the difference `pairedByNames` exists to report.
  expect(identity[0]).toMatch(/srcShapes=\[(\w+\/\d+,\w+\/\d+)\] ctxShapes=\[\1\]/);
  expect(disjoint[0]).not.toMatch(/srcShapes=\[(\w+\/\d+,\w+\/\d+)\] ctxShapes=\[\1\]/);
  expect(identity[0]).toContain("ctx0='Media'");
  expect(disjoint[0]).toContain("ctx0='MediaE'");
});

test("the instrument is silent with the dial unset", () => {
  expect(unionslotRows(SOURCE, false)).toEqual([]);
});
