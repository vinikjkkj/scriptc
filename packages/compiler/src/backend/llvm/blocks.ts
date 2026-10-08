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
  constructor(message: string) {
    super(message);
    this.name = "CrossParkTempError";
  }
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
   * WHAT IT DOES NOT COVER, and this belongs next to the rule rather than in a
   * side document: it checks ONE rule. It does not verify the module. It is
   * blind BY CONSTRUCTION to the `%sN` alloca slots — they are dominance-legal
   * machine-stack memory of the resume CALL, so a slot written before a park
   * and read after it reads garbage with no SSA violation to detect. That is a
   * different mechanism and a different slice. A reader who sees this assertion
   * pass must not conclude "the emission is verified"; it means one rule holds. */
  private readonly tmpGen = new Map<string, number>();
  private gen = 0;
  private coroFn: string | null = null;
  private parks = 0;

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
      );
    }
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
    this.checkCrossPark(s);
    this.cur.lines.push(`  ${s}`);
  }

  tmp(): string {
    const n = `%t${this.tempCounter++}`;
    if (this.coroFn !== null) this.tmpGen.set(n, this.gen);
    return n;
  }

  slot(): string {
    return `%s${this.tempCounter++}`;
  }

  isTerminated(): boolean {
    return this.cur.term !== null;
  }

  terminate(s: string): void {
    if (this.cur.term !== null) return;
    this.checkCrossPark(s);
    this.cur.term = `  ${s}`;
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
