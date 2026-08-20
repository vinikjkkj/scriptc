/* The SCRIPTC_INSTGUARD_WHY instrument, tested — and with it the rule behind
 * it, at the one altitude where a rule that silently stopped firing would
 * otherwise look exactly like a rule that was never written.
 *
 * WHAT IT IS FOR. `Array.isArray(n.content)` over a member typed
 * `Uint8Array | string | readonly T[]` narrows to bare `any[]` (the
 * `arg is any[]` predicate cannot keep the readonly constituent), so every
 * element is `any`, and tsc then declines to narrow a property access whose
 * ROOT is `any`. `child.content` inside `if (child.content instanceof
 * Uint8Array)` therefore arrives at the read with checker type `any`, while
 * the VALUE is the real union all along.
 *
 * The compiler already READS that guard: `x instanceof Uint8Array` over a
 * union is lowered by lowerInstanceOf into `tag == N`, the arm test built out
 * of the same union def. The branch was entered having proved the arm and the
 * read inside it was then refused. `maybeNarrow` had the isArray twin of the
 * missing rule (`isArrayGuardProven`) and not the instanceof one.
 *
 * WHY THE INSTRUMENT EXISTS AT ALL. The first half of that rule — the
 * `maybeNarrow` bridge — fires, builds a `bytes`, returns it, and changes
 * NOTHING in a compiled binary, because every gate below `maybeNarrow` is
 * keyed on the CHECKER (`lowerIntrinsicProperty` takes its kind from
 * mapTypeOf(checker type); `isStdlibMember` needs a property symbol an `any`
 * receiver does not have). So "the rule fired" and "the read lowered" are two
 * different facts, and a dial that only said the first would have certified a
 * fix that did nothing. The rows below say which arm was picked, so a decline
 * and an absence are distinguishable.
 *
 * The verdicts:
 *
 *   NO-GUARD           no `instanceof` over the SAME reference guards this
 *                      read. The rule stands down; whatever answered before
 *                      answers now.
 *   NO-ARM ctor=X      a guard is there and the union has no single arm the
 *                      compiler can test for X, so the proof selects nothing.
 *                      No source spelling reaches this today — see `wrongCtor`
 *                      below — and the test pins that rather than assuming it.
 *   NARROWED=<kind>    the guard proved exactly one arm and the read bridges
 *                      through it (tag-checked, like every other narrowing).
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { loadProgram } from "../src/frontend/program.js";
import { lowerToIr } from "../src/frontend/lowering/lowerer.js";

/** Lower `source` and return the instrument's rows. `on` selects whether the
 * env dial is set, because "off by default" is half the contract. */
function instguardRows(source: string, on: boolean): string[] {
  const dir = mkdtempSync(join(tmpdir(), "scriptc-instguard-"));
  const entry = join(dir, "main.ts");
  writeFileSync(entry, source);
  const captured: string[] = [];
  const realWrite = process.stderr.write.bind(process.stderr);
  const previous = process.env["SCRIPTC_INSTGUARD_WHY"];
  if (on) process.env["SCRIPTC_INSTGUARD_WHY"] = "1";
  else delete process.env["SCRIPTC_INSTGUARD_WHY"];
  (process.stderr as unknown as { write: (s: string) => boolean }).write = (s: string): boolean => {
    captured.push(String(s));
    return true;
  };
  try {
    const load = loadProgram(entry);
    // Some of these reads are EXPECTED to be refused; lowerToIr returns its
    // diagnostics rather than throwing, so nothing here inspects them.
    lowerToIr(load.program, load.entry, load.moduleOrder);
  } finally {
    (process.stderr as unknown as { write: typeof realWrite }).write = realWrite;
    if (previous === undefined) delete process.env["SCRIPTC_INSTGUARD_WHY"];
    else process.env["SCRIPTC_INSTGUARD_WHY"] = previous;
  }
  return captured
    .join("")
    .split("\n")
    .filter((l) => l.startsWith("INSTGUARD "));
}

/* Seven reads, one per outcome, and every expected value below is readable off
 * these lines rather than off the implementation.
 *
 *   guarded      the plain positive `if` — the simplest spelling, and the one
 *                whose emitted C shows the arm test the rule then refused to
 *                read through.
 *   earlyOut     zapo's own `parsePollVotes` spelling: the read is the RIGHT
 *                operand of an `||` whose LEFT is `!(… instanceof …)`. The
 *                right operand runs when the left is FALSE, and a false `!G`
 *                is a true `G`, so both polarities have to be read or the one
 *                site the rule was written for is missed.
 *   otherRef     a guard over a DIFFERENT reference. The rule must not fire;
 *                the reference identity is syntactic, exactly as tsc's is.
 *   crossFn      the guard is outside and the read is inside a nested
 *                function, which runs later — tsc's own invalidation rule,
 *                and isArrayGuardProven's. Must not fire.
 *   noGuard      no guard at all.
 *   regexArm     the OTHER arm lowerInstanceOf turns into a tag test.
 *   wrongCtor    a guard naming a constructor the union has no arm for. This
 *                is the shape that SHOULD read NO-ARM, and measuring it is how
 *                I learned that no source spelling reaches that verdict today:
 *                `lowerInstanceOf` refuses the TEST first ("on a union with no
 *                Uint8Array arm — the answer is constantly false"), the
 *                condition poisons, and the read behind it is never lowered.
 *                The assertion below pins the absence, not a guess. */
const SOURCE = `
interface Leaf {
  readonly tag: string;
  readonly content?: Uint8Array | string | readonly Leaf[];
}
interface Ruled {
  readonly tag: string;
  readonly match?: RegExp | string | readonly Ruled[];
}
const other: Leaf = { tag: "o", content: new Uint8Array(1) };

export function guarded(root: Leaf): number {
  if (!Array.isArray(root.content)) return -1;
  let n = 0;
  for (const child of root.content) {
    if (child.content instanceof Uint8Array) n += child.content.byteLength;
  }
  return n;
}

export function earlyOut(root: Leaf): number {
  if (!Array.isArray(root.content)) return -1;
  let n = 0;
  for (const child of root.content) {
    if (!(child.content instanceof Uint8Array) || child.content.byteLength !== 32) return -2;
    n += 1;
  }
  return n;
}

export function otherRef(root: Leaf): number {
  if (!Array.isArray(root.content)) return -1;
  let n = 0;
  for (const child of root.content) {
    if (other.content instanceof Uint8Array) n += child.content.byteLength;
  }
  return n;
}

export function crossFn(root: Leaf): number {
  if (!Array.isArray(root.content)) return -1;
  let n = 0;
  for (const child of root.content) {
    if (child.content instanceof Uint8Array) {
      const later = (): number => child.content.byteLength;
      n += later();
    }
  }
  return n;
}

export function noGuard(root: Leaf): number {
  if (!Array.isArray(root.content)) return -1;
  let n = 0;
  for (const child of root.content) n += child.content.byteLength;
  return n;
}

export function regexArm(root: Ruled): string {
  if (!Array.isArray(root.match)) return "";
  let s = "";
  for (const r of root.match) {
    if (r.match instanceof RegExp) s += r.match.source;
  }
  return s;
}

export function wrongCtor(root: Ruled): string {
  if (!Array.isArray(root.match)) return "";
  let s = "";
  for (const r of root.match) {
    if (r.match instanceof Uint8Array) s += String(r.match.source);
  }
  return s;
}

// The lowerer walks REACHABLE code; an exported-but-uncalled function is
// never lowered and the instrument would report an empty run that looks
// exactly like a rule that stopped firing. (It did, the first time.)
const leaf: Leaf = { tag: "r" };
const ruled: Ruled = { tag: "r" };
console.log(
  guarded(leaf), earlyOut(leaf), otherRef(leaf), crossFn(leaf),
  noGuard(leaf), regexArm(ruled), wrongCtor(ruled),
);
`;

test("the instrument names the arm it picked, and stays silent where no guard proves one", () => {
  const rows = instguardRows(SOURCE, true);
  const why = "\n" + rows.join("\n");

  // Every row is keyed file:line:col — the same spelling the other dials use.
  for (const l of rows) {
    expect(l).toMatch(/^INSTGUARD \S+main\.ts:\d+:\d+ (NO-GUARD|NO-ARM|NARROWED=)/);
  }

  const narrowed = rows.filter((l) => l.includes("NARROWED="));
  const noGuard = rows.filter((l) => l.includes("NO-GUARD"));
  const noArm = rows.filter((l) => l.includes("NO-ARM"));

  // The two shapes that must narrow, one per polarity. `earlyOut` is zapo's.
  expect(narrowed.some((l) => l.includes("NARROWED=bytes ctor=Uint8Array")), why).toBe(true);
  expect(narrowed.some((l) => l.includes("NARROWED=regex ctor=RegExp")), why).toBe(true);

  // NO-ARM is the third verdict and NO SOURCE SPELLING REACHES IT TODAY —
  // measured, not assumed. `wrongCtor` guards a `RegExp | string | …` union
  // with `instanceof Uint8Array`, which is exactly the shape that should
  // select no arm; but `lowerInstanceOf` refuses that TEST first ("on a union
  // with no Uint8Array arm — the answer is constantly false"), so the
  // condition poisons and the read behind it is never lowered. The verdict
  // stays in the instrument because the branch it reports is real code, and
  // because the day that fence moves this row is how anyone will see it.
  expect(noArm, why).toEqual([]);
  const wrong = rows.filter((l) => l.includes("r.match") && l.includes("ctor=Uint8Array"));
  expect(wrong, why).toEqual([]);

  // The armed half. A rule that fired on everything would satisfy every
  // assertion above; these three reads must produce NO-GUARD.
  expect(noGuard.some((l) => l.includes("child.content")), why).toBe(true);

  // Every union this rule looked at reports its arm set, so a row that read
  // nothing is distinguishable from a union that carries no bytes arm.
  for (const l of rows) expect(l, why).toMatch(/ arms=[a-zA-Z]/);
});

test("the instrument is silent with the dial unset", () => {
  expect(instguardRows(SOURCE, false)).toEqual([]);
});
