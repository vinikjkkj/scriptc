/* The one structure the C emitter never needed: a basic-block builder
 * lowering the structured statement tree to labeled blocks with explicit
 * terminators. clang -O0 style — every local is an alloca, every read a
 * load — so no SSA construction is ever needed; LLVM's mem2reg promotes
 * the slots at -O2. Ported from the survey prototype (ll-emit.mjs).
 *
 * Terminator discipline: text after a terminator is unreachable — the C
 * emitter relies on the same property when a body ends in return (dead C
 * code after it); here the lines are DROPPED instead, and emitStmts skips
 * whole statements once the current block is terminated, so no dropped
 * definition can leak into a later block. */

/** A `%tN` minted before a park and read after it. See BlockBuilder's
 * cross-park invariant below for why this is a hard build failure and not a
 * diagnostic. */
import { crossLoadName, crossSlotName } from "./coro.js";

/** An origin's name with the sigil stripped, FOR USE IN A COMMENT ONLY.
 *
 * A `%tN` AFTER A SEMICOLON IS STILL A REFERENCE TO EVERY TEXT SCAN IN THIS
 * TREE, and that is measured rather than guessed: the promotion first spelled
 * its comments `; promoted %t24`, and the cross-park slot oracle -- which reads
 * the emitted module's CFG and is the one check that sees back edges --
 * reported eighteen dominance violations across `pu`, `wau` and `was`. Every
 * one of them was a comment. `zig cc` accepted the same module, because to the
 * assembler a comment is a comment; the two disagreeing is exactly the shape
 * that assertion exists to report, so the oracle was right to fire and the
 * spelling is what had to change.
 *
 * The same trap is already written down one rule up (noteLine: a text scan that
 * counts the `alloca` DECLARATION as a use reports five correct coroutines as
 * broken). This is the second instance, so it is a helper rather than a habit. */
function bare(origin: string): string {
  return origin.slice(1);
}

export class CrossParkTempError extends Error {
  constructor(
    message: string,
    /** The offending `%tN`. Carried so the caller can SPILL it and retry
     * rather than only report it -- see emitFunction's fixpoint. */
    readonly temp: string,
    /** Its LLVM result type, or null when the defining instruction was not one
     * of the forms `llResultType` covers. A null here is the difference
     * between "spill it" and "refuse the function": a frame field cannot be
     * laid out for a value whose type is unknown. */
    readonly llType: string | null,
  ) {
    super(message);
    this.name = "CrossParkTempError";
  }
}

/** A resume-call-private `alloca` slot READ after a park that did not re-write
 * it -- the cross-park ALLOCA class, which no SSA rule can see.
 *
 * WHY IT IS A SEPARATE ERROR from the one above, even though both end in the
 * same handler: they are not the same defect and they do not have the same
 * fix. A cross-park TEMP is spillable -- it has a value and a type, and the
 * frame can carry it. A cross-park SLOT is MEMORY of the resume call, and
 * carrying it means moving the slot itself into the frame, which is a
 * different slice. Folding them into one error would make the census say
 * "cross-park-temp" for a function no amount of temp spilling will ever lower,
 * and the census is the worklist the next slice is built from.
 *
 * SCOPE, AND IT IS DELIBERATELY NARROW. This rule applies to the slots
 * REGISTERED as resume-call-private (see `privateSlot`), which today is
 * everything `slot()` mints plus the log-argument array. It is NOT the general
 * classification of every `entryAllocas.push` site in the backend -- that is a
 * wider decision that is not taken here. What it IS, is a rule a later general
 * classification can be CHECKED AGAINST rather than having to re-derive: any
 * push site that classifies as resume-call-private must already be reaching
 * this registry, and one that is not is either frame-backed or an omission. */
/** A promoted cross-park temp reached a `phi` as an incoming value.
 *
 * A REFUSAL, NOT A REPAIR, and separate from the two rules above because it is
 * a limit of the PROMOTION mechanism rather than of the body. emitFunction
 * catches it and puts the function back on the fiber lane. No body on the
 * corpus is known to reach it; it is written down so that the one that does is
 * refused rather than emitted. */
export class PromotedTempInPhiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PromotedTempInPhiError";
  }
}

/** EVERY VIOLATION OF ONE BODY, GATHERED IN ONE EMISSION INSTEAD OF ONE PER
 * EMISSION -- the probe emitFunction runs before it repairs anything.
 *
 * WHY A COLLECTOR AND NOT A BIGGER CAP. The discovery loop finds exactly one
 * violation per pass because the rules below THROW, and a throw ends the
 * emission. A body with 55 of them therefore needs 109 passes, and the cap
 * that stops the loop at 12 refused it. Raising the number buys the same
 * coverage at 109 re-emissions of the body; collecting buys it at three.
 *
 * NOTHING IS REPAIRED WHILE COLLECTING, which is what makes the set complete
 * rather than merely longer. The repairs only ever REMOVE violations -- a
 * spilled temp is read under its reload name, a promoted one under a load,
 * and a frame-backed slot leaves the registry -- so a pass with no repair
 * installed sees a superset of what any later pass can see.
 *
 * AND IT IS ONLY SOUND BECAUSE THE REPAIRS MINT NO `%tN`. The set addresses
 * values by a name a counter hands out in emission order; if installing the
 * set renumbered the body, every name in it would address a different value
 * on the pass that uses it. crossName, crossSlotName, crossLoadName and
 * slotCarryName all derive their names from the origin and the suspension
 * index for exactly that reason. */
export interface CoroViolations {
  /** `%tN` -> its LLVM result type, or null when `llResultType` could not
   * read the defining form. A null is a REFUSAL upstream, not a spill. */
  readonly temps: Map<string, string | null>;
  /** A resume-call-private slot -> its declared type, same null rule. */
  readonly slots: Map<string, string | null>;
}
export class CrossParkSlotError extends Error {
  constructor(
    message: string,
    readonly slot: string,
    /** The slot's declared LLVM type, or null when the alloca text was not a
     * form `allocaTypeOf` could read. Null is the difference between "carry
     * it in the frame" and "refuse the function", exactly as CrossParkTempError's
     * llType is: a frame field cannot be laid out for an unknown type. */
    readonly llType: string | null = null,
  ) {
    super(message);
    this.name = "CrossParkSlotError";
  }
}

/** The LLVM result type of an instruction, or null when the form is not one
 * this function covers.
 *
 * WHY A CLOSED SET AND NOT A PARSER. The only consumer is the cross-park
 * spill, which needs a type for a frame field; an uncovered form yields null
 * and REFUSES the function. So the failure mode of an omission is lost
 * coverage, never a wrong field type -- which is what makes it safe to
 * enumerate instead of parsing LLVM properly.
 *
 * MEASURED, NOT GUESSED. Over every temp that actually crosses a park in the
 * stackless-values corpus -- 37 candidate wrappers, 76 crossing temps --
 * exactly THREE forms occur: call (65), load (10), fmul (1). The rest below is
 * the cheap closure of those three's neighbours, one regex each. It is
 * deliberately NOT exhaustive over LLVM: `extractvalue`, aggregates and
 * vectors are absent because nothing in this backend mints a crossing temp
 * with one, and inventing coverage for a form no call site produces is how a
 * declare set stops being call-site driven. */
export function llResultType(rhs: string): string | null {
  const s = rhs.trim();
  // `call [ret-attrs] <ty> @fn(...)`. The attribute list is the one this
  // emitter actually spells; an UNKNOWN attribute falls through to null rather
  // than being skipped, because skipping it would take the attribute for the
  // type and lay out a frame field named `zeroext`.
  const call =
    /^(?:tail |musttail |notail )?call (?:(?:zeroext|signext|noundef|inreg|fast|nnan|ninf|nsz|arcp|contract|reassoc|afn) )*([^ @]+) @/.exec(
      s,
    );
  if (call !== null) return call[1] === "void" ? null : call[1]!;
  const load = /^load (?:atomic |volatile )*([^,]+), ptr /.exec(s);
  if (load !== null) return load[1]!.trim();
  if (/^getelementptr /.test(s)) return "ptr";
  if (/^alloca /.test(s)) return "ptr";
  if (/^icmp |^fcmp /.test(s)) return "i1";
  const bin =
    /^(?:fadd|fsub|fmul|fdiv|frem|add|sub|mul|sdiv|udiv|srem|urem|shl|lshr|ashr|and|or|xor) (?:(?:nsw|nuw|exact|fast|nnan|ninf|nsz|arcp|contract|reassoc|afn|disjoint) )*([^ ,]+) /.exec(
      s,
    );
  if (bin !== null) return bin[1]!;
  // The cast family names its type outright, after `to`.
  const cast =
    /^(?:zext|sext|trunc|fptosi|fptoui|sitofp|uitofp|fpext|fptrunc|bitcast|inttoptr|ptrtoint|addrspacecast) .* to ([^ ,]+)$/.exec(
      s,
    );
  if (cast !== null) return cast[1]!;
  const sel = /^select (?:fast )?i1 [^,]+, ([^ ]+) /.exec(s);
  if (sel !== null) return sel[1]!;
  const phi = /^phi (?:fast )?([^ []+) \[/.exec(s);
  if (phi !== null) return phi[1]!;
  const frz = /^freeze ([^ ]+) /.exec(s);
  if (frz !== null) return frz[1]!;
  return null;
}

export class BlockBuilder {
  private readonly blocks: { label: string; lines: string[]; term: string | null }[] = [];
  private cur: { label: string; lines: string[]; term: string | null };
  /** Lines spliced into the head of the entry block at render time —
   * allocas (locals, result slots, the log-arg array) all live there so
   * every block is dominated by them. */
  readonly entryAllocas: string[] = [];
  private tempCounter = 0;
  private labelCounter = 0;

  /* ── the cross-park temp invariant ──────────────────────────────────────
   *
   * THE RULE: no `%tN` minted before a park may be referenced after it.
   *
   * WHY IT HAS TO BE AN ASSERTION AND NOT A TEST. A park terminates its block
   * with `ret void`, and the resume block that follows is reachable ONLY from
   * the entry dispatch — so an SSA value defined before the park does not
   * dominate a use after it, and the module is malformed.
   *
   * THIS PARAGRAPH USED TO SAY THERE WAS NO EXTERNAL ORACLE FOR THAT ON THIS
   * HOST. THAT WAS WRONG, and it is corrected here rather than softened,
   * because a rule whose justification rests on a false premise is a bug until
   * someone shows it is not. `-disable-llvm-verifier` turns off the verifier
   * pass in the OPTIMISATION pipeline; it does not turn off the check `zig cc`
   * runs when it PARSES `.ll` text. Measured on this tree's own artifact, both
   * directions: the unmodified prog.ll compiles to exit 0, and the same file
   * with one arm of an `awaitUnion` reading a `%tN` the OTHER arm defines exits
   * 1 with `invalid LLVM IR input: Instruction does not dominate all uses!`.
   * So there IS an external oracle for exactly this class.
   *
   * THE RULE SURVIVES THE CORRECTION, FOR A DIFFERENT AND NARROWER REASON, and
   * the difference is worth stating because it changes what the rule is FOR.
   * It is no longer "the only thing that can see this". It is the thing that
   * sees it FIRST, and the distinction is the whole value: a shape the
   * admission predicate wrongly admitted would otherwise reach `zig cc` and
   * fail the BUILD, when the correct outcome is for it to keep its fiber
   * lowering and cost only coverage. emitFunction says this in its own words
   * at the catch. The downstream oracle is a backstop that turns a miss into a
   * loud failure instead of a silent one — which is better than this comment
   * used to claim, not worse.
   *
   * AND THE LIMIT TRAVELS WITH THE CORRECTION, because half of it is worse
   * than the old premise: the verifier sees DOMINANCE. It is blind to
   * everything dominance-legal. Measured on the same artifact: narrowing
   * %ScrCoroBase's last field from i64 to i32 — every GEP index still in
   * range, every type still legal, every frame under-allocated — compiles to
   * exit 0 with no diagnostic. That is the class the slot rule above exists
   * for, and nothing outside this file can report it.
   *
   * COLLISION-SAFE BY ENUMERATION, re-verified rather than inherited: every
   * hand-written `%t`-prefixed name in backend/llvm is `%t` followed by a
   * LETTER (%tag, %take, %text, %tj, %tla_status, %top, %tp, ...). A literal
   * `%t` followed by a DIGIT appears nowhere in the backend — `%tN` with a
   * numeral is minted only by tmp() below — so the scan cannot match a name it
   * does not own.
   *
   * COST WHEN THE KNOB IS ABSENT: nothing is armed. `enterCoro` is called only
   * for a function the LLVM backend is actually lowering, and `coroPlans` is
   * empty without SCRIPTC_STACKLESS=1, so `coroFn` stays null, the generation
   * map is never written and the scan returns on its first line.
   *
   * THE RULE IS NO LONGER ONLY A DIAGNOSTIC. A temp it names is now SPILLED
   * into the coroutine frame and reloaded into a fresh name after the resume
   * label, and `rename` below is what makes every later use spell the new one.
   * The throw is still the discovery mechanism -- emitFunction catches it, adds
   * the temp to the spill set and re-emits -- so this text is what the emitter
   * reads to decide what to carry, not merely what a human reads after a
   * failure. It remains a hard failure for a temp whose type is not derivable,
   * because a frame field cannot be laid out for a value of unknown type.
   *
   * WHAT IT DOES NOT COVER, and this belongs next to the rule rather than in a
   * side document: it checks ONE rule, over SSA temps. It does not verify the
   * module. It is blind BY CONSTRUCTION to `alloca` slots — they are
   * dominance-legal machine-stack memory of the resume CALL, so a slot written
   * before a park and read after it reads garbage with no SSA violation to
   * detect. CrossParkSlotError above is a SECOND, separate rule covering the
   * slots this emitter registers as resume-call-private; it is a refusal, not
   * a repair, and it is bounded to that registry rather than to every alloca
   * in the backend. A reader who sees these assertions pass must not conclude
   * "the emission is verified"; it means two rules hold — plus, downstream,
   * whatever `zig cc`'s parse-time check catches, which is dominance and not
   * this.
   *
   * AND BOTH RULES ARE ORDERED BY EMISSION, NOT BY THE CFG. A reference is
   * judged against the generation it was APPENDED in, so both are blind, BY
   * CONSTRUCTION, to a BACK EDGE: a loop's condition and body head are appended
   * before the park and re-entered after it, and neither scan can see that.
   *
   * THIS IS NOT THEORETICAL AND IT IS NOT CURRENTLY A HOLE, and the difference
   * matters to whoever reads this next. A forOf used to be REFUSED here, which
   * looked like the rule covering the loop -- but the refusal came from the
   * STEP block's load, which happens to be appended after the park. The
   * condition's load of the same cursor, and every use of the iterable, were
   * appended before it and passed. The rule was right about that loop BY
   * ACCIDENT, through a neighbouring line.
   *
   * WHAT REPLACES THE ACCIDENT, now that forOf lowers. Two things, and the
   * second is the one not to "fix":
   *   1. The lowering DEMANDS its loop state be carried instead of waiting to
   *      be told -- emitStmt's forOf case throws for the cursor and the
   *      iterable when the body parked, because a loop re-entering its own head
   *      is something the lowering knows and this scan cannot learn.
   *   2. Anything still left in an SSA temp across a back edge becomes a REAL
   *      dominance violation, and this host verifies the IR it is handed at
   *      PARSE. It fails the build, loudly, naming the value. That is measured,
   *      not hoped for: the first build of the forOf slice carried only the
   *      cursor and zig cc rejected it with fourteen "Instruction does not
   *      dominate all uses".
   * So the noise IS the guard for that half. Anyone tempted to quiet it --
   * by relaxing what gets carried, or by routing a value around the verifier --
   * is removing the only thing standing where the accident used to stand.
   *
   * THE SLOT HALF IS GUARDED ELSEWHERE, deliberately. A slot the emitter
   * carries in the frame leaves the registry above (frameBackedSlot), so this
   * file stops speaking about it; what checks that its reload is really emitted
   * at every resume label is the cross-park slot oracle in
   * tests/harness/cross-park-slot-oracle.ts, which reads the emitted module's
   * CFG and therefore sees back edges. Re-seated, not dropped. */
  private readonly tmpGen = new Map<string, number>();
  private gen = 0;
  private coroFn: string | null = null;
  private parks = 0;
  /** `%tN` -> its LLVM result type, recorded from the defining line. Only
   * populated while a coroutine body is being emitted. */
  private readonly tmpType = new Map<string, string>();
  /** `%told` -> `%tnew`, installed by the reload after a resume label and
   * applied to every line appended AFTERWARDS.
   *
   * THE REWRITE IS TEXTUAL AND IT IS APPLIED AT APPEND TIME, which is what
   * makes it complete and what makes it cheap. Complete, because every use of
   * a value reaches the module as text through `line()` or `terminate()` -- a
   * name copied into a plain string, or stored on some other object, or
   * spelled by any route at all, still arrives here. The alternative that was
   * considered and rejected was rewriting `LlValue.name` in place, which
   * reaches only the holders the emitter happens to keep, and has two known
   * holes (ownImmortal pushes a COPY; a non-refcounted value is never recorded
   * at all). Cheap, because blocks already appended are not revisited: the
   * pre-park uses keep the pre-park name because they were appended before the
   * rename existed, which is exactly the behaviour wanted and costs no pass. */
  /** Non-null while this body is being emitted as a PROBE: the two rules
   * below record into it and let emission continue, instead of throwing at
   * the first violation. See CoroViolations. */
  private collect: CoroViolations | null = null;
  private readonly rename = new Map<string, string>();
  /** Cross-park temps PROMOTED to an alloca: origin `%tN` -> the slot it lives
   * in and the type it was minted with.
   *
   * THE SECOND CROSSING IS WHY THIS EXISTS, and it is a different mechanism
   * from `rename` rather than a bigger version of it. `rename` carries a value
   * as an SSA reload, which has exactly one definition and therefore survives
   * exactly one suspension: at the next one the spill would reference a
   * definition that does not dominate it. A promoted temp is MEMORY, so every
   * path sees it and the number of crossings stops mattering -- the same
   * reason `frameBacked` slots may cross several suspensions while a renamed
   * temp may not. The two are mutually exclusive by construction: emitFunction's
   * fixpoint moves a temp OUT of the spill set when it promotes it, so no
   * origin is ever in both maps. */
  private readonly promoted = new Map<string, { slot: string; llType: string }>();
  /** Per-origin use ordinal, the only input to a promoted load's name besides
   * the origin. A counter is safe HERE where it is not safe for temps: it
   * counts uses of ONE origin, and promoting another origin neither adds nor
   * removes a line that mentions this one. */
  private readonly promotedUses = new Map<string, number>();
  /** Alloca slots whose storage belongs to the RESUME CALL rather than to the
   * frame, and the generation of the last write to each. See
   * CrossParkSlotError for why this registry is deliberately narrow. */
  private readonly privateSlots = new Map<string, number>();
  /** Slots the emitter has decided to carry in the coroutine FRAME. They are
   * no longer resume-call-private, so they leave the registry above rather
   * than being exempted inside the rule.
   *
   * THIS IS A RE-SEATING, NOT A LOOSENING, and the distinction is the whole
   * reason it is spelled this way. The guarantee the slot rule gave does not
   * disappear when a slot moves here: it moves to the reload the frame emits
   * at every resume label. What CHECKS that reload is no longer this file --
   * it is the cross-park slot oracle in tests/harness/stackless-values.test.ts,
   * which reads the emitted module's CFG and asks whether any load of a slot
   * is reachable from a resume label with only the entry block's
   * re-initialisation reaching it. A slot removed from here with no frame
   * reload emitted is exactly what that oracle reports. */
  private readonly frameBacked = new Set<string>();

  constructor() {
    this.cur = { label: "entry", lines: [], term: null };
    this.blocks.push(this.cur);
  }

  /** Arm the cross-park invariant for a coroutine resume body. Called by
   * emitFunction for exactly the functions the LLVM backend lowers. */
  enterCoro(fnName: string): void {
    this.coroFn = fnName;
  }

  /** Emit this body as a PROBE: gather every cross-park violation into `v`
   * rather than throwing at the first. The module this pass produces is
   * unrepaired and must be discarded -- emitFunction does. */
  collectInto(v: CoroViolations): void {
    this.collect = v;
  }

  /** One suspension boundary has been emitted: every temp minted so far is
   * now dead, because the block that follows is reachable only from the
   * dispatch.
   *
   * CALLED AT EVERY HOP AS WELL AS EVERY PARK, when hops arrive. "A hop is a
   * park: the C locals of the resume function are just as dead across it as
   * they are across an await, and the first version of emitCoroAwait learned
   * that by segfault." A boundary recorded only at awaits is a detector with a
   * hole the shape of the other suspension form. */
  parkBoundary(): void {
    this.gen++;
    this.parks++;
  }

  /** How many boundaries were taken. emitFunction asserts this against the
   * number of states the dispatch actually emitted — see D5. */
  boundaries(): number {
    return this.parks;
  }

  /** True once the invariant is armed, so emitFunction can assert that a
   * body it lowered as a coroutine really did arm it. */
  isCoro(): boolean {
    return this.coroFn !== null;
  }

  private checkCrossPark(s: string): void {
    if (this.coroFn === null || this.gen === 0) return;
    for (const m of s.match(/%t[0-9]+/g) ?? []) {
      const g = this.tmpGen.get(m);
      if (g === undefined || g >= this.gen) continue;
      if (this.collect !== null) {
        this.collect.temps.set(m, this.tmpType.get(m) ?? null);
        continue;
      }
      throw new CrossParkTempError(
        `llvm emitter bug: ${this.coroFn} references ${m} after a park. ` +
          `${m} was minted before suspension point ${g} and is read in block ` +
          `'${this.cur.label}', which is reachable only from the dispatch -- so its ` +
          `definition does not dominate this use. Spill ${m} into the coroutine frame ` +
          `before the park and reload it into a FRESH temp after the resume label.\n` +
          `  offending line: ${s}`,
        m,
        this.tmpType.get(m) ?? null,
      );
    }
  }

  /** Record `%tN`'s result type from its defining line, and classify this
   * line's references to resume-call-private slots.
   *
   * THE THREE ROLES A SLOT REFERENCE CAN PLAY, and the middle one is the
   * reason this is not a two-line function:
   *   store  into the slot      -- a WRITE. The slot is live from here.
   *   load   from the slot      -- a READ. Legal only if a write in THIS
   *                                generation already happened.
   *   getelementptr on the slot -- the address ESCAPED. Nothing can be
   *                                concluded about what is done through the
   *                                derived pointer, so it counts as a write:
   *                                it is the point at which the slot becomes
   *                                live, and references in the same generation
   *                                are fine while a reference in a LATER one
   *                                is not. This is what admits the
   *                                log-argument array (its GEPs and its one
   *                                read sit in the same generation) without
   *                                admitting a slot written before a park.
   *
   * THE ALLOCA DECLARATION IS NOT A REFERENCE AT ALL. It never passes through
   * here: `entryAllocas` is spliced into the head of block 0 by `render()`.
   * That distinction was MEASURED rather than assumed -- a text scan that
   * counts the declaration as a use reports five of the lane's current
   * coroutines as carrying a slot across their park, and opening the lines
   * shows every one of those hits is the `alloca` line and every real use is
   * on the far side. A rule built on the wrong reading would have refused five
   * functions that are correct today. */
  private noteLine(s: string): void {
    if (this.coroFn === null) return;
    const def = /^(%t[0-9]+) = (.*)$/.exec(s);
    if (def !== null) {
      const ty = llResultType(def[2]!);
      if (ty !== null) this.tmpType.set(def[1]!, ty);
    }
    if (this.privateSlots.size === 0) return;
    for (const slot of this.privateSlots.keys()) {
      if (!s.includes(slot)) continue;
      // A longer registered name must not be matched by a shorter one's
      // substring test. The registry holds `%sN` (N a numeral) and `%logargs`,
      // and `includes` can therefore match `%s1` inside `%s12`; the boundary
      // check keeps the roles attributed to the right slot.
      if (new RegExp(`${slot}(?![0-9A-Za-z_])`).test(s) === false) continue;
      const isStore = /^store /.test(s) && new RegExp(`, ptr ${slot}(?![0-9A-Za-z_])`).test(s);
      const isGep = /^%t[0-9]+ = getelementptr /.test(s);
      if (isStore || isGep) {
        this.privateSlots.set(slot, this.gen);
        continue;
      }
      const lastWrite = this.privateSlots.get(slot)!;
      if (lastWrite >= this.gen) continue;
      if (this.collect !== null) {
        this.collect.slots.set(slot, this.allocaTypeOf(slot));
        continue;
      }
      throw new CrossParkSlotError(
        `llvm emitter bug: ${this.coroFn} reads ${slot} after a park that did not ` +
          `re-write it. ${slot} was last written in suspension generation ${lastWrite} ` +
          `and is read in block '${this.cur.label}' at generation ${this.gen}. That slot ` +
          `is an alloca of the RESUME CALL, and every resume is a fresh call -- so the ` +
          `read sees stack memory the write never touched. It is dominance-legal, so no ` +
          `SSA rule can see it and neither can the toolchain: zig cc DOES verify the .ll ` +
          `it parses, but for dominance, which this is not. ` +
          `Carrying it means moving the slot into the coroutine frame, which is a ` +
          `different mechanism from the temp spill and a later slice.\n` +
          `  offending line: ${s}`,
        slot,
        this.allocaTypeOf(slot),
      );
    }
  }

  private applyRename(s: string): string {
    if (this.rename.size === 0) return s;
    return s.replace(/%t[0-9]+/g, (m) => this.rename.get(m) ?? m);
  }

  /** The reload after a resume label has loaded `old` into `fresh`: every line
   * appended from now on spells it the new way. */
  renameTemp(old: string, fresh: string): void {
    this.rename.set(old, fresh);
  }

  /** Is this origin already being carried, i.e. was it reloaded at an EARLIER
   * suspension? See emitCoroTempSpill for why that is a refusal. */
  isCarried(origin: string): boolean {
    return this.rename.has(origin);
  }

  /** Carry this temp in an ALLOCA instead of as an SSA reload: the defining
   * line stores into the slot, and every later use loads out of it.
   *
   * CALLED BEFORE THE WALK, by emitFunctionBody, for the set a previous pass
   * discovered -- the same shape `frameBackedSlot` is called in. The alloca is
   * pushed into `entryAllocas`, so it is spliced into the head of block 0 and
   * dominates every use by construction.
   *
   * AND IT IS DELIBERATELY NOT REGISTERED AS A RESUME-CALL-PRIVATE SLOT. The
   * slot rule exists to catch memory of the resume CALL being read across a
   * park; this slot is about to be handed to the FRAME carry (emitFunction
   * pushes it into the slot-spill set in the same step), so it is frame-backed
   * from the moment it exists and the rule has nothing to say about it. */
  promoteTemp(origin: string, llType: string): string {
    const slot = crossSlotName(origin);
    this.promoted.set(origin, { slot, llType });
    this.entryAllocas.push(`${slot} = alloca ${llType} ; promoted ${bare(origin)}`);
    return slot;
  }

  /** Rewrite one line's references to promoted temps into loads, appending the
   * loads to `pre` in the order they must be emitted.
   *
   * THE DEFINING LINE KEEPS ITS OWN NAME on the left: the value still has to be
   * computed before it can be stored, and `line()` emits the store after it.
   * Only the right-hand side is rewritten, which matters for a defining line
   * that also USES another promoted temp.
   *
   * A `phi` IS REFUSED RATHER THAN REWRITTEN. A load placed before a phi is
   * invalid IR (phis lead their block) and a load placed in the predecessor is
   * a block this builder does not know. No body on this lane is known to reach
   * it -- every phi in the backend joins values minted in the two arms it joins,
   * which by definition do not cross a park -- so this is a guard over a case
   * that should not arise, written as a refusal because the alternative is
   * emitting a module the assembler rejects. */
  private applyPromotion(s: string, pre: string[]): string {
    if (this.promoted.size === 0) return s;
    const def = /^(%t[0-9]+) = /.exec(s);
    const lhs = def !== null && this.promoted.has(def[1]!) ? def[0]! : "";
    const body = s.slice(lhs.length);
    const seen = new Map<string, string>();
    const out = body.replace(/%t[0-9]+/g, (m) => {
      const p = this.promoted.get(m);
      if (p === undefined) return m;
      const already = seen.get(m);
      if (already !== undefined) return already;
      if (/ = phi /.test(s)) {
        throw new PromotedTempInPhiError(
          `llvm emitter bug: ${this.coroFn ?? "?"} uses the promoted temp ${m} as a phi ` +
            `incoming value. The load that materialises it cannot go before the phi (phis ` +
            `lead their block) and this builder does not know the predecessor to put it in.` +
            `\n  offending line: ${s}`,
        );
      }
      const k = this.promotedUses.get(m) ?? 0;
      this.promotedUses.set(m, k + 1);
      const name = crossLoadName(m, k);
      seen.set(m, name);
      pre.push(`${name} = load ${p.llType}, ptr ${p.slot} ; promoted ${bare(m)}`);
      return name;
    });
    return lhs + out;
  }

  /** The store that seats a promoted temp in its slot, or null when this line
   * does not define one. Emitted immediately AFTER the defining line. */
  private promotionStore(s: string): string | null {
    if (this.promoted.size === 0) return null;
    const def = /^(%t[0-9]+) = /.exec(s);
    if (def === null) return null;
    const p = this.promoted.get(def[1]!);
    if (p === undefined) return null;
    return `store ${p.llType} ${def[1]!}, ptr ${p.slot} ; seat promoted ${bare(def[1]!)}`;
  }

  /** The LLVM result type recorded for a temp, or undefined when its defining
   * form is not one `llResultType` covers. */
  typeOfTemp(name: string): string | undefined {
    return this.tmpType.get(name);
  }

  /** The generation a temp was minted in, or undefined if it was never minted
   * in this body. Used to assert that re-emission is deterministic. */
  genOfTemp(name: string): number | undefined {
    return this.tmpGen.get(name);
  }

  /** Register an alloca whose storage belongs to the resume CALL, so the slot
   * rule above can see it. `slot()` does this for everything it mints; the
   * log-argument array is registered by emitFunction because it is pushed into
   * `entryAllocas` after the body has already been walked. */
  privateSlot(name: string): void {
    if (this.coroFn === null) return;
    if (this.frameBacked.has(name)) return;
    // CREATION COUNTS AS A WRITE IN ITS OWN GENERATION. A slot read in the
    // generation it was created in, with no store between, is an
    // uninitialised read -- a defect that predates this rule and is not the
    // one it exists to find -- so it is admitted rather than reported here,
    // and the rule stays about the park.
    if (!this.privateSlots.has(name)) this.privateSlots.set(name, this.gen);
  }

  /** Carry this slot in the frame: it leaves the resume-call-private registry
   * and the slot rule stops speaking about it. Called by emitFunction for the
   * set its previous emission pass discovered. */
  frameBackedSlot(name: string): void {
    this.frameBacked.add(name);
    this.privateSlots.delete(name);
  }

  /** The LLVM type a slot was declared with, read back out of the entry
   * allocas rather than recorded beside them.
   *
   * READ BACK, NOT TALLIED: the declaration is pushed as TEXT by the ~96 call
   * sites that build entryAllocas, none of which passes through line(), so a
   * parallel map would be a second source for a fact the text already carries.
   * A type this cannot parse yields null and REFUSES the function -- the same
   * failure mode llResultType has, so an omission costs coverage and never a
   * wrong field type. */
  allocaTypeOf(slot: string): string | null {
    for (const l of this.entryAllocas) {
      const eq = l.indexOf(" = alloca ");
      if (eq < 0 || l.slice(0, eq) !== slot) continue;
      const rest = l.slice(eq + " = alloca ".length);
      const semi = rest.indexOf(";");
      const ty = (semi < 0 ? rest : rest.slice(0, semi)).trim();
      return ty === "" ? null : ty;
    }
    return null;
  }

  newLabel(hint: string): string {
    return `${hint}${this.labelCounter++}`;
  }

  startBlock(label: string): void {
    this.cur = { label, lines: [], term: null };
    this.blocks.push(this.cur);
  }

  line(s: string): void {
    if (this.cur.term !== null) return;
    // RENAME FIRST, THEN CHECK. A line naming a temp that the reload has
    // already replaced is not a violation -- it is the ordinary case this
    // slice exists to produce -- so it must be rewritten before the rule sees
    // it. Checking first would report every successfully spilled temp.
    //
    // PROMOTION IS THE SAME ARGUMENT ONE STEP FURTHER. A use of a PROMOTED temp
    // becomes a load, and that load is dominated by the entry alloca on every
    // path -- so the line the rules should judge is the rewritten one, not the
    // one the caller handed in. The order between the two rewrites cannot
    // matter (an origin is never in both maps) and is fixed anyway so that
    // there is one answer to read.
    const t0 = this.applyRename(s);
    const pre: string[] = [];
    const t = this.applyPromotion(t0, pre);
    for (const l of pre) this.cur.lines.push(`  ${l}`);
    this.noteLine(t);
    this.checkCrossPark(t);
    this.cur.lines.push(`  ${t}`);
    // The seating store reads `%tN` in the generation it was minted in, so it
    // passes both rules; it is run through them anyway rather than pushed raw,
    // because a line this file appends is not more trustworthy than one it is
    // handed.
    const seat = this.promotionStore(t);
    if (seat !== null) {
      this.noteLine(seat);
      this.checkCrossPark(seat);
      this.cur.lines.push(`  ${seat}`);
    }
  }

  tmp(): string {
    const n = `%t${this.tempCounter++}`;
    if (this.coroFn !== null) this.tmpGen.set(n, this.gen);
    return n;
  }

  slot(): string {
    const n = `%s${this.tempCounter++}`;
    // Everything `slot()` mints is machine-stack memory of the call that runs
    // the block -- which, in a resume body, is a DIFFERENT call on every
    // resume. Registering here is what bounds the slot rule to the shapes this
    // admission actually makes cross-park, without opening the general
    // question of every alloca in the backend.
    this.privateSlot(n);
    return n;
  }

  isTerminated(): boolean {
    return this.cur.term !== null;
  }

  terminate(s: string): void {
    if (this.cur.term !== null) return;
    const t0 = this.applyRename(s);
    const pre: string[] = [];
    const t = this.applyPromotion(t0, pre);
    // A terminator cannot define a temp, so there is no seating store here --
    // but it CAN use one (`br i1 %t7`), and the loads it needs belong in this
    // block's body, ahead of the terminator.
    for (const l of pre) this.cur.lines.push(`  ${l}`);
    this.noteLine(t);
    this.checkCrossPark(t);
    this.cur.term = `  ${t}`;
  }

  br(label: string): void {
    this.terminate(`br label %${label}`);
  }

  condBr(v: string, t: string, f: string): void {
    this.terminate(`br i1 ${v}, label %${t}, label %${f}`);
  }

  /** The dispatch terminator. `terminate()` already accepts arbitrary
   * terminator text, so this is one spelling helper and not a new mechanism —
   * but it is spelled out here rather than built at the call site so the
   * `switch` form has one place to be right.
   *
   * `arms` is [value, label] in case order; `dflt` is the label an
   * out-of-range state takes. */
  switchTerm(value: string, dflt: string, arms: ReadonlyArray<[number, string]>): void {
    const cases = arms.map(([v, l]) => `i32 ${v}, label %${l}`).join(" ");
    this.terminate(`switch i32 ${value}, label %${dflt} [ ${cases} ]`);
  }

  render(): string {
    return this.blocks
      .map((b, i) => {
        const lines = i === 0 ? [...this.entryAllocas.map((l) => `  ${l}`), ...b.lines] : b.lines;
        // A block left unterminated is a structurally unreachable join
        // (every predecessor jumped elsewhere); the verifier still wants a
        // terminator.
        const term = b.term ?? "  unreachable";
        return `${b.label}:\n${lines.join("\n")}${lines.length ? "\n" : ""}${term}`;
      })
      .join("\n");
  }
}
