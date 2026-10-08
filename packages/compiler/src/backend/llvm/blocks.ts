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
export class CrossParkSlotError extends Error {
  constructor(
    message: string,
    readonly slot: string,
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
   * dominate a use after it, and the module is malformed. On a host with a
   * working toolchain `llvm-as` would say so. This host's does not: `zig cc`
   * passes `-disable-llvm-verifier` to cc1, which was MEASURED rather than
   * assumed — a probe with a deliberate verifier-only defect compiled to exit
   * 0 with no diagnostic, while a PARSER error in the same harness correctly
   * exited 1. So the module is never verified, the defect is never reported,
   * and at -O2 the optimiser EXPLOITS the undefined value: it folded the two
   * blocks of the probe together and tail-called with whatever was in %rax.
   * Silent wrong answer, exit 0, both at -O0 and -O2.
   *
   * There is therefore no external oracle for this class on this host, and the
   * emitter is the only place that knows both facts at the moment they matter.
   * It fails the BUILD, which is the strongest thing available.
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
   * "the emission is verified"; it means two rules hold. */
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
  private readonly rename = new Map<string, string>();
  /** Alloca slots whose storage belongs to the RESUME CALL rather than to the
   * frame, and the generation of the last write to each. See
   * CrossParkSlotError for why this registry is deliberately narrow. */
  private readonly privateSlots = new Map<string, number>();

  constructor() {
    this.cur = { label: "entry", lines: [], term: null };
    this.blocks.push(this.cur);
  }

  /** Arm the cross-park invariant for a coroutine resume body. Called by
   * emitFunction for exactly the functions the LLVM backend lowers. */
  enterCoro(fnName: string): void {
    this.coroFn = fnName;
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
      throw new CrossParkSlotError(
        `llvm emitter bug: ${this.coroFn} reads ${slot} after a park that did not ` +
          `re-write it. ${slot} was last written in suspension generation ${lastWrite} ` +
          `and is read in block '${this.cur.label}' at generation ${this.gen}. That slot ` +
          `is an alloca of the RESUME CALL, and every resume is a fresh call -- so the ` +
          `read sees stack memory the write never touched. It is dominance-legal, so no ` +
          `verifier and no SSA rule can see it; this host runs no verifier at all. ` +
          `Carrying it means moving the slot into the coroutine frame, which is a ` +
          `different mechanism from the temp spill and a later slice.\n` +
          `  offending line: ${s}`,
        slot,
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
    // CREATION COUNTS AS A WRITE IN ITS OWN GENERATION. A slot read in the
    // generation it was created in, with no store between, is an
    // uninitialised read -- a defect that predates this rule and is not the
    // one it exists to find -- so it is admitted rather than reported here,
    // and the rule stays about the park.
    if (!this.privateSlots.has(name)) this.privateSlots.set(name, this.gen);
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
    const t = this.applyRename(s);
    this.noteLine(t);
    this.checkCrossPark(t);
    this.cur.lines.push(`  ${t}`);
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
    const t = this.applyRename(s);
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
