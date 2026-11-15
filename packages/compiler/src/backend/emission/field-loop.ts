/* FIELD LOOPS for the record walkers.
 *
 * The record<->dyn walkers (the to-dyn converter sc_td_*, the dynCheck builder sc_dc_*) emit one block of C per member. A record with thousands of members
 * of one type (zapo's WA_ABPROPS has 2,151, each a WaAbProp) became thousands of identical blocks: 400 KB of straight-line machine code per helper, run
 * ONCE, every page of it resident at the startup peak.
 *
 * This turns a RUN of consecutive blocks that differ only in the member they handle into one loop over a static table of those members. It does NOT
 * re-implement any per-member semantics: the loop body IS the first block's own text, with exactly four things replaced by table reads -- the member
 * reference, the key literal (and its length), and the own-mask byte and bit. The blocks of a run are compared AFTER that replacement, so a run is a loop
 * only when every block in it is, character for character, the same code for a different member. Any block that differs in anything else (another
 * member type, an optional member, a function member, a symbol key, a mask arm) is not part of the run and keeps today's unrolled code, so the
 * semantics hold by construction and a mixed record falls back by itself.
 *
 * A run needs MIN or more blocks, so small records stay unrolled and fast. SCRIPTC_FIELD_LOOP_MIN overrides it (0 turns the loops off entirely: the
 * negative control of the corpus rows and the micro). The member offset in the table is __builtin_offsetof of the record type: the loop reads and writes
 * the very struct member the unrolled code named. Both clang and gcc accept the spelling; the LLVM backend builds the same loop in IR (backend/llvm/). */

export const FIELD_LOOP_MIN_DEFAULT = 8;

export function fieldLoopMin(): number {
  const v = process.env["SCRIPTC_FIELD_LOOP_MIN"];
  if (v === undefined || v === "") return FIELD_LOOP_MIN_DEFAULT;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : FIELD_LOOP_MIN_DEFAULT;
}

/** One member's emitted block: the lines [start, end) of the helper's output, and the tokens in them that name THIS member. */
export interface FieldBlock {
  start: number;
  end: number;
  /** The record variable the member is read or written through ("v" in a converter, "r" in a builder). */
  base: string;
  /** The struct member's C name, and the full reference text the block uses for it (`v->sc_fld_p0`). */
  member: string;
  fieldRef: string;
  /** The key as a C string literal, and its byte length. */
  keyLit: string;
  keyLen: number;
  /** The own-mask byte and bit this member owns, when the block mentions them. */
  own: { byte: number; bit: number | string } | null;
  /** Exact text forms of the mask test or mask set in the block, with how the loop spells each from the table row `e`. */
  ownForms: { text: string; make: (e: string) => string }[];
}

const KK = "\u0001KK\u0001";
const K = "\u0001K\u0001";
const F = "\u0001F\u0001";
const O = (i: number): string => `\u0001O${i}\u0001`;

/** The block's text with every member-specific token replaced by a placeholder, or null when the block still mentions the member by anything else. */
function normalized(lines: readonly string[], b: FieldBlock): string | null {
  let t = lines.slice(b.start, b.end).join("\n");
  b.ownForms.forEach((o, i) => {
    t = t.split(o.text).join(O(i));
  });
  t = t.split(`${b.keyLit}, ${b.keyLen}`).join(KK);
  t = t.split(b.keyLit).join(K);
  t = t.split(b.fieldRef).join(F);
  // Anything that still names the member (a comment, a second spelling) means this block is not interchangeable with another member's.
  if (t.includes(b.member) || t.includes(b.keyLit)) return null;
  // The loop body sits in a `for`: a bare break or continue in the block would now bind to the loop.
  if (/\b(break|continue)\b/.test(t)) return null;
  return t;
}

/** Replaces each run of MIN or more interchangeable consecutive blocks in `lines` with a table-driven loop, in place. Blocks must be in output order. */
export function compressFieldRuns(lines: string[], blocks: readonly (FieldBlock | null)[], min = fieldLoopMin(), tag = "sc_ft"): number {
  if (min <= 0) return 0;
  type Run = { from: number; to: number; norm: string };
  const runs: Run[] = [];
  let cur: Run | null = null;
  let prev: FieldBlock | null = null;
  blocks.forEach((b, i) => {
    const n = b === null ? null : normalized(lines, b);
    const joins =
      cur !== null && b !== null && n !== null && prev !== null && prev.end === b.start && n === cur.norm &&
      b.ownForms.length === (blocks[cur.from] as FieldBlock).ownForms.length;
    if (joins) {
      cur!.to = i + 1;
    } else {
      if (cur !== null && cur.to - cur.from >= min) runs.push(cur);
      cur = b !== null && n !== null ? { from: i, to: i + 1, norm: n } : null;
    }
    prev = b;
  });
  if (cur !== null && (cur as Run).to - (cur as Run).from >= min) runs.push(cur);
  // From the last run to the first, so the indexes of the earlier ones stay valid.
  for (let r = runs.length - 1; r >= 0; r--) {
    const run = runs[r]!;
    const first = blocks[run.from] as FieldBlock;
    const last = blocks[run.to - 1] as FieldBlock;
    const hasOwn = first.ownForms.length > 0;
    const rows: string[] = [];
    // The keys live in ONE pool of NUL-terminated literals, named by offset: a table of char pointers would carry a relocation per row in a
    // position-independent executable. The terminator matters, a dynCheck path (ScrDynPath) reads its key as a C string.
    const pool: string[] = [];
    let ko = 0;
    for (let i = run.from; i < run.to; i++) {
      const b = blocks[i] as FieldBlock;
      const own = hasOwn && b.own !== null ? `, ${b.own.byte}, ${b.own.bit}` : hasOwn ? ", 0, 0" : "";
      rows.push(`      { ${ko}, ${b.keyLen}, (uint32_t)__builtin_offsetof(__typeof__(*${b.base}), ${b.member})${own} },`);
      pool.push(`      ${b.keyLit.slice(0, -1)}\\0"`);
      ko += b.keyLen + 1;
    }
    let body = run.norm;
    first.ownForms.forEach((o, i) => {
      body = body.split(O(i)).join(o.make("sc_e"));
    });
    body = body.split(KK).join(`${tag}_keys + sc_e->ko, sc_e->kl`);
    body = body.split(K).join(`${tag}_keys + sc_e->ko`);
    body = body.split(F).join(`(*(__typeof__(${first.fieldRef}) *)((char *)${first.base} + sc_e->off))`);
    const out: string[] = [];
    out.push(`  { /* ${run.to - run.from} members of one shape and one kind of handling: one loop over their table */`);
    out.push(`    static const char ${tag}_keys[] =`);
    out.push(...pool.slice(0, -1), `${pool[pool.length - 1]};`);
    out.push(`    static const struct { uint32_t ko; uint32_t kl; uint32_t off;${hasOwn ? " uint8_t byte; uint8_t bit;" : ""} } ${tag}[] = {`);
    out.push(...rows);
    out.push(`    };`);
    out.push(`    for (size_t sc_i = 0; sc_i < sizeof ${tag} / sizeof ${tag}[0]; sc_i++) {`);
    out.push(`      const __typeof__(${tag}[0]) *sc_e = &${tag}[sc_i];`);
    out.push(...body.split("\n"));
    out.push(`    }`);
    out.push(`  }`);
    lines.splice(first.start, last.end - first.start, ...out);
  }
  return runs.length;
}
