/* WHICH SUSPENSIONS A CARRIED SLOT IS ACTUALLY LIVE ACROSS.
 *
 * THE COST THIS EXISTS TO REMOVE. emitCoroSlotSpill/emitCoroSlotReload used to
 * walk the WHOLE carried set at EVERY suspension, so a body paid |slots| x
 * |states| whether or not a slot had anything to carry there. Measured on the
 * stackless-values program at `3ef911616` (LLVM lane, knob ON): `sc_cr_main`
 * carries 54 slots across 101 states, and the 32,724 lines that pays for are
 * 2,771,188 of the module's 4,252,082 bytes -- 65.2% of the artifact. The SET
 * is right: every one of those slots IS read after SOME park. The QUANTIFIER
 * was wrong.
 *
 * THE QUESTION, and it is a backward liveness over the real CFG:
 *
 *   starting at the top of resume label sc_S(k+1), is this slot READ before it
 *   is WRITTEN, on any path?
 *
 * If yes, the frame must carry it across state k. If no, the body stores into
 * the slot before it ever reads it again and the carry is dead text.
 *
 * ================= THE CARRY IS A CHAIN, NOT A SET OF INDEPENDENT =========
 * ================= DECISIONS, AND THAT IS THE WHOLE DESIGN       =========
 *
 * THE FIRST VERSION OF THIS FILE GOT IT WRONG AND THE ORACLE SAID SO. It
 * excluded every `%cxslot_` line from the scan -- which is right for the
 * RELOAD and wrong for the SPILL. The spill is `%cxslot_svK_s = load T, ptr
 * %s`: a genuine READ of the slot, emitted in the park's own block. Striking
 * it made the park look like it did not touch the slot, so a slot read after
 * park 23 was judged live at park 23 and dead at parks 0..22 -- and then the
 * spill at park 23 loaded whatever the entry block's re-initialisation had
 * left there and stored THAT into the frame. tests/harness's cross-park slot
 * oracle named sixteen of them, in `sc_cr_main`, at the spill's own line. It
 * was right to fire; the analysis is what had to change.
 *
 * SO `carry(k)` IS A FIXPOINT, NOT A FUNCTION OF THE TEXT. The spill at state
 * k counts as a read of the slot exactly when the carry at state k is emitted:
 *
 *   carry(k)  <=>  the slot is live at the top of sc_S(k+1)
 *   liveness  <=>  computed with a READ at each state k's spill, for k in carry
 *
 * Both sides are monotone and the iteration starts from the empty carry set,
 * so it converges on the least fixpoint: every state between a slot's
 * definition and its last read, and nothing else. A store to the slot kills
 * the chain backwards, which is what keeps the answer small -- a value
 * produced after park 22 and consumed before park 24 pays for one state, not
 * a hundred.
 *
 * WHY THE RELOAD IS STILL NOT AN EVENT. It is a store into the slot at the top
 * of the very block whose liveIn is the question, so counting it would kill
 * the liveness it exists to satisfy and the answer would be "nothing is ever
 * live" -- green by construction, and wrong at every site. Omitting it is also
 * the SAFE direction in general: a missing store can only make liveness
 * propagate further back, which carries more, never less.
 *
 * WHY THE ENTRY BLOCK'S INITIALISING STORES KILL NOTHING. They run BEFORE the
 * dispatch reaches any resume label, so they sit on the path INTO sc_S(k+1),
 * never on a path OUT of it, and a backward walk from that label cannot reach
 * them -- no block branches back to the entry block. That re-initialisation is
 * precisely WHY a live slot needs the carry at all: it is what the cross-park
 * slot oracle treats as POISON.
 *
 * THE BACK EDGE IS THE REASON THIS IS A FIXPOINT AND NOT A SCAN. blocks.ts's
 * two rules are ordered by EMISSION and are blind, by construction, to a loop
 * re-entering its own head; a slot written after the park and read at the top
 * of the next iteration is live across that park and no linear reading of the
 * text can see it. This walks successors to a fixpoint over the emitted CFG,
 * so a back edge is an edge like any other. The artifact is still audited
 * independently by tests/harness/cross-park-slot-oracle.ts, a SECOND reader of
 * the same CFG written against the same hazard -- deliberately not shared
 * code, because an analysis checked by its own parser is checked by nothing.
 *
 * IT DECLINES RATHER THAN GUESSES. Any shape this cannot read -- a terminator
 * form it does not know, a successor label that is not in the function, a
 * resume label the state count says should exist and does not -- returns
 * `null`, and the caller carries EVERYTHING, which is the behaviour every base
 * before this one had. A slot whose address ESCAPES is live everywhere by the
 * same rule: nothing can be concluded through a derived pointer, so the carry
 * stays. The asymmetry is the point. Under-carrying is silent memory
 * corruption that this host's IR check cannot see -- it sees DOMINANCE, and an
 * entry alloca dominates every use of it; over-carrying is only bytes. */

/** The carry prefix. Every line emitted by emitCoroSlotSpill and
 * emitCoroSlotReload contains it, and nothing else does -- see slotCarryName. */
const CARRY = "%cxslot_";

/** The spill's own load, which IS a read of the slot. `slotCarryName("sv", k,
 * slot)` spells it, and the digits are greedy up to the `_` that cannot start
 * a slot name, so the state index is unambiguous. */
const SPILL_LOAD = /^%cxslot_sv([0-9]+)_/;

/** A resume label, by the spelling coroLabel() mints. */
const resumeLabel = (state: number): string => `sc_S${state + 1}`;

const STORE = 0;
const LOAD = 1;
const ESCAPE = 2;
/** A read that happens only if this state's carry is emitted. */
const SPILL = 3;

interface Ev {
  r: number;
  /** The state index, for SPILL; -1 otherwise. */
  k: number;
}

interface Blk {
  label: string;
  succ: string[];
  /** slot index -> that slot's events in emission order, terminator last. */
  ev: Map<number, Ev[]>;
}

/** The pointer operand of a `store`. The `.*,` is greedy on purpose:
 * `store ptr %a, ptr %b` must yield `%b` and not `%a`. */
const STORE_PTR = /^store\s+.*,\s*ptr\s+(%[A-Za-z0-9_.$]+)\s*(?:;.*)?$/;
/** The pointer operand of a `load`. */
const LOAD_PTR = /^%[A-Za-z0-9_.$]+\s*=\s*load\s+[^,]+,\s*ptr\s+(%[A-Za-z0-9_.$]+)\s*(?:;.*)?$/;
/** A slot's own declaration is not a reference to it. */
const ALLOCA_DEF = /^(%[A-Za-z0-9_.$]+)\s*=\s*alloca\s/;
const TERMINATOR = /^(br|switch|ret|unreachable)\b/;
/** Terminator forms whose successors this cannot read. Listed rather than
 * lumped into a default, so the decline is deliberate and legible. */
const UNREADABLE_TERMINATOR =
  /^(indirectbr|callbr|resume|invoke|catchswitch|catchret|cleanupret)\b/;

/** Backward liveness of each carried slot at each resume label.
 *
 * `define` is the whole rendered function WITH the full carry in it, `slots`
 * the carried set, and `stateCount` the number of states the body drew.
 * Returns, per slot, the state indices whose carry must be emitted -- or null
 * when the body could not be read, which means carry everything. */
export function slotCarryLiveness(
  define: string,
  slots: readonly string[],
  stateCount: number,
): Map<string, Set<number>> | null {
  if (slots.length === 0 || stateCount === 0) return null;
  const slotIdx = new Map<string, number>();
  slots.forEach((s, i) => slotIdx.set(s, i));

  const lines = define.split("\n");
  const blocks: Blk[] = [];
  const byLabel = new Map<string, number>();
  let blk: Blk | null = null;
  let terminated = false;

  const push = (b: Blk, si: number, e: Ev): void => {
    let arr = b.ev.get(si);
    if (arr === undefined) {
      arr = [];
      b.ev.set(si, arr);
    }
    arr.push(e);
  };

  /** Record this line's events for every carried slot it mentions.
   *
   * Returns false when the line is a carry line that could not be classified,
   * which is a shape this cannot read. */
  const note = (b: Blk, text: string, atTerminator: boolean): boolean => {
    if (text.includes(CARRY)) {
      // THE SPILL'S LOAD IS THE ONE CARRY LINE THAT IS EVIDENCE. See the
      // header: it reads the slot, in the park's own block, whenever the
      // carry at that state is emitted. Every other carry line -- the two
      // GEPs, the field store, the reload's load, the reload's store back
      // into the slot -- is the mechanism rather than a use of it.
      const sp = SPILL_LOAD.exec(text);
      if (sp === null) return true;
      const ptr = LOAD_PTR.exec(text);
      if (ptr === null) return false;
      const si = slotIdx.get(ptr[1]!);
      if (si === undefined) return false;
      const k = Number(sp[1]);
      if (!Number.isInteger(k) || k < 0 || k >= stateCount) return false;
      push(b, si, { r: SPILL, k });
      return true;
    }
    const decl = ALLOCA_DEF.exec(text);
    const sp = STORE_PTR.exec(text);
    const lp = LOAD_PTR.exec(text);
    for (const m of text.matchAll(/%[A-Za-z0-9_.$]+/g)) {
      const name = m[0];
      const si = slotIdx.get(name);
      if (si === undefined) continue;
      if (decl !== null && decl[1] === name) continue;
      const r = atTerminator
        ? ESCAPE
        : sp !== null && sp[1] === name
          ? STORE
          : lp !== null && lp[1] === name
            ? LOAD
            : ESCAPE;
      push(b, si, { r, k: -1 });
    }
    return true;
  };

  for (let n = 1; n < lines.length; n++) {
    const raw = lines[n]!;
    if (raw === "}") break;
    const s = raw.trim();
    if (s === "") continue;
    const lab = /^([A-Za-z0-9_.$]+):$/.exec(raw);
    if (lab !== null) {
      const label = lab[1]!;
      if (byLabel.has(label)) return null;
      blk = { label, succ: [], ev: new Map() };
      byLabel.set(label, blocks.length);
      blocks.push(blk);
      terminated = false;
      continue;
    }
    if (blk === null) return null;
    // Text after a terminator is dropped by render(), so reaching it here
    // means this is not the shape that was emitted.
    if (terminated) return null;
    if (UNREADABLE_TERMINATOR.test(s)) return null;
    if (TERMINATOR.test(s)) {
      blk.succ = [...s.matchAll(/label %([A-Za-z0-9_.$]+)/g)].map((m) => m[1]!);
      if (!note(blk, s, true)) return null;
      terminated = true;
      continue;
    }
    if (!note(blk, s, false)) return null;
  }
  if (blocks.length === 0) return null;

  const succIdx: number[][] = [];
  for (const b of blocks) {
    const out: number[] = [];
    for (const l of b.succ) {
      const i = byLabel.get(l);
      // A successor this function does not define is a shape this cannot read.
      if (i === undefined) return null;
      out.push(i);
    }
    succIdx.push(out);
  }
  // Every state the caller will ask about must exist as a label, or the
  // mapping from state index to block is not the one the emitter used.
  const stateBlock: number[] = [];
  for (let k = 0; k < stateCount; k++) {
    const i = byLabel.get(resumeLabel(k));
    if (i === undefined) return null;
    stateBlock.push(i);
  }

  const nb = blocks.length;
  const out = new Map<string, Set<number>>();
  for (let si = 0; si < slots.length; si++) {
    /* ONE CHAOTIC ITERATION OVER BOTH UNKNOWNS. `liveIn` is the backward
     * liveness and `carry` decides which spills count as reads; each is
     * monotone in the other and both start at the bottom, so the loop climbs
     * to the least fixpoint and stops. Running them as nested loops would give
     * the same answer and pay for a full liveness pass per state. */
    const liveIn = new Uint8Array(nb);
    const carry = new Uint8Array(stateCount);
    let changed = true;
    while (changed) {
      changed = false;
      // Reverse block order is a heuristic for a fast fixpoint, not a
      // correctness condition: the loop runs until nothing moves.
      for (let b = nb - 1; b >= 0; b--) {
        let st = 0;
        for (const s of succIdx[b]!) st |= liveIn[s]!;
        const ev = blocks[b]!.ev.get(si);
        if (ev !== undefined) {
          for (let i = ev.length - 1; i >= 0; i--) {
            const e = ev[i]!;
            if (e.r === STORE) st = 0;
            else if (e.r === SPILL) st = carry[e.k] === 1 ? 1 : st;
            else st = 1;
          }
        }
        if (liveIn[b] !== st) {
          liveIn[b] = st;
          changed = true;
        }
      }
      for (let k = 0; k < stateCount; k++) {
        if (carry[k] === 0 && liveIn[stateBlock[k]!] === 1) {
          carry[k] = 1;
          changed = true;
        }
      }
    }
    const keep = new Set<number>();
    for (let k = 0; k < stateCount; k++) if (carry[k] === 1) keep.add(k);
    out.set(slots[si]!, keep);
  }
  return out;
}

/** The rendered function with every slot-carry line removed.
 *
 * THE CONTROL THE RE-EMISSION IS CHECKED WITH, and the only thing that proves
 * the second pass changed ONLY the carry. Two emissions of one body must agree
 * line for line once the carry is struck from both; a difference anywhere else
 * means the body did not reproduce, and then the liveness answer was computed
 * against a CFG that is not the one emitted. */
export function withoutSlotCarry(define: string): string {
  return define
    .split("\n")
    .filter((l) => !l.includes(CARRY))
    .join("\n");
}
