/* Layout order: place the program TU's functions in a profile-driven order (scriptc build --layout-order <file>).
 *
 * WHY THE EMITTERS DO IT AND NOT THE LINKER. A GNU ld section-ordering file (binutils >= 2.43) or an lld symbol-ordering file would
 * do the same job, but zig 0.16 cc (every Windows and cross lane) rejects all of them ("unsupported linker arg", measured), and
 * section NAMES (.text.hot / .text.unlikely) only group under GNU ld's default script. What every linker does honour is INPUT
 * ORDER: -ffunction-sections gives each function its own section and the sections of one object are laid out in the order the
 * object lists them, which is the order the emitter wrote the functions. So the order is made here, in the text the emitters
 * write, after emission, so no counter-named helper changes its name because the order changed.
 *
 * THE FILE. One symbol per line, in layout order; `#` starts a comment; blank lines are ignored. The producer (`scriptc
 * layout-order`) writes the tiers in this order: the steady set, the other executed code, the startup-only code. A symbol that
 * is not named is COLD and goes last, in the order it already had. A name the program does not contain is ignored.
 *
 * The rank of a function is the line number of its symbol; a unit that holds several functions (one IR function can emit its
 * frame, resume function and spawn wrapper together) ranks as its best-ranked member and moves as one piece. */

export interface LayoutOrder {
  readonly rank: ReadonlyMap<string, number>;
}

export function parseLayoutOrder(text: string): LayoutOrder {
  const rank = new Map<string, number>();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    // GNU ld ordering-file spelling (`*(.text.sym)`) is accepted too, so one file can serve both consumers.
    const m = /^\*\(\.text\.([^)]+)\)$/.exec(line);
    const name = m !== null ? m[1]! : line;
    if (!rank.has(name)) rank.set(name, rank.size);
  }
  return { rank };
}

/** The rank of the best-ranked name in `names`, or Infinity (cold). */
export function bestRank(order: LayoutOrder, names: readonly string[]): number {
  let best = Infinity;
  for (const n of names) {
    const r = order.rank.get(n);
    if (r !== undefined && r < best) best = r;
  }
  return best;
}

/** A stable sort of `items` by `rankOf`: ranked first in rank order, unranked (Infinity) last in their original order. */
export function stableByRank<T>(items: readonly T[], rankOf: (t: T) => number): T[] {
  const idx = items.map((t, i) => ({ t, i, r: rankOf(t) }));
  idx.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r < b.r ? -1 : 1));
  return idx.map((x) => x.t);
}

/* ---------------------------------------------------------------- C */

/** A column-0 function definition header: `[static ]<type> name(<params>) {` with an optional trailing source-location comment. The emitters put nothing else at column 0 that ends in
 * `{` and carries a parameter list (struct/union/enum bodies end `{` with no `(`; initialisers end `=`). */
const C_HEADER = /^(?:static\s+)?(?:inline\s+)?[A-Za-z_][^;{}=]*?([A-Za-z_]\w*)\s*\([^;{}]*\)\s*\{(?:\s*\/\*.*\*\/)?$/;

/** The names of the functions DEFINED at column 0 in `lines`. */
export function cDefinedNames(lines: readonly string[]): string[] {
  const out: string[] = [];
  for (const l of lines) {
    if (l.length === 0 || l.charCodeAt(0) <= 32) continue;
    // a header already marked `used` (an emitted TU read back) carries `__attribute__((used))`, whose own parenthesis must not read as the parameter list
    const m = C_HEADER.exec(l.includes("__attribute__") ? l.replace(/__attribute__\(\([^)]*\)\)\s*/g, "") : l);
    if (m !== null) out.push(m[1]!);
  }
  return out;
}

/** Splits `lines` into function chunks (a header line through its closing `}` at column 0) and everything else, preserving the
 * order of both. The chunk's trailing blank lines stay in `rest`. */
export function extractCFunctionChunks(lines: readonly string[]): { chunks: string[][]; rest: string[] } {
  const chunks: string[][] = [];
  const rest: string[] = [];
  let cur: string[] | null = null;
  for (const l of lines) {
    if (cur !== null) {
      cur.push(l);
      if (l === "}") {
        chunks.push(cur);
        cur = null;
      }
      continue;
    }
    if (l.length > 0 && l.charCodeAt(0) > 32 && C_HEADER.test(l)) {
      cur = [l];
      continue;
    }
    rest.push(l);
  }
  // an unterminated chunk (never produced by the emitters) is put back untouched
  if (cur !== null) for (const l of cur) rest.push(l);
  return { chunks, rest };
}

/** Marks the internal-linkage function definitions in `chunk` that the order file NAMES as `used`, so the C compiler emits each where it
 * is DEFINED. Without it clang defers a `static` function until something references it and writes it right after that referrer, which
 * is call-graph order, not definition order: the order the emitter wrote would not reach the object file. Only named functions are
 * marked: they ran in the profile, so they are referenced anyway and `used` merely pins their position; every other function keeps
 * normal dead-code elimination (a blanket `used` would keep unreferenced statics alive in the object). `used` changes nothing else
 * (the function stays internal and inlinable, and the final link drops an unreferenced one through --gc-sections, every function
 * having its own section). Applied only under --layout-order. */
export function markUsedDefinitions(chunk: readonly string[], order: LayoutOrder): string[] {
  return chunk.map((l) => {
    if (!l.startsWith("static ")) return l;
    const m = C_HEADER.exec(l);
    return m !== null && order.rank.has(m[1]!) ? `static __attribute__((used)) ${l.slice(7)}` : l;
  });
}

/* ------------------------------------------------------------- LLVM */

/** `define ... @name(` -> name (quoted names included). */
const LL_DEFINE = /^define\b[^@]*@("(?:[^"\\]|\\.)*"|[\w.$-]+)\(/;

/** Reorders the `define` blocks of an LLVM IR text by rank. Functions are the only thing moved: every non-function line keeps its
 * relative order and the sorted blocks follow them. LLVM IR has no definition-before-use rule for functions or
 * globals, so this cannot change what the module means. A text with no ranked function is returned as is (the same string). */
export function reorderLlvmText(ll: string, order: LayoutOrder): string {
  const parsed = splitLlvmDefines(ll);
  if (parsed === null) return ll;
  const { blocks, rest } = parsed;
  if (blocks.length === 0 || !blocks.some((b) => order.rank.has(b.name))) return ll;
  const sorted = stableByRank(blocks, (b) => order.rank.get(b.name) ?? Infinity);
  // The sorted blocks go AFTER every other line, not where the first define stood: named types are defined between functions, and a
  // function body that GEPs into a type has to see the complete type before it ("base element of getelementptr must be sized").
  // Functions, globals, attributes and metadata may all be referenced forward, so nothing else is order-sensitive.
  const out: string[] = [];
  for (const l of hotLiteralsFirst(rest, sorted, order)) out.push(l);
  for (const b of sorted) for (const l of b.lines) out.push(l);
  return out.join("\n");
}

/** The `define` blocks of an LLVM IR text and every other line, or null when a block is unterminated. */
function splitLlvmDefines(ll: string): { blocks: { name: string; lines: string[] }[]; rest: string[] } | null {
  const lines = ll.split("\n");
  const blocks: { name: string; lines: string[] }[] = [];
  const rest: string[] = [];
  let cur: { name: string; lines: string[] } | null = null;
  for (const l of lines) {
    if (cur !== null) {
      cur.lines.push(l);
      if (l === "}") {
        blocks.push(cur);
        cur = null;
      }
      continue;
    }
    if (l.startsWith("define ")) {
      const m = LL_DEFINE.exec(l);
      // `{` ends the header, optionally followed by a `; comment` (the emitter annotates some definitions)
      if (m !== null && /\{\s*(?:;.*)?$/.test(l)) {
        const raw = m[1]!;
        const name = raw.startsWith('"') ? raw.slice(1, -1) : raw;
        cur = { name, lines: [l] };
        continue;
      }
    }
    rest.push(l);
  }
  return cur !== null ? null : { blocks, rest };
}

/** `rest` with its `@sc_lit_N = internal global ...` definitions repartitioned in place (hot literals first, see above): the lines keep the slots they held. */
function hotLiteralsFirst(rest: string[], blocks: readonly { name: string; lines: string[] }[], order: LayoutOrder): string[] {
  const LIT_DEF = /^@(sc_lit_\d+) = internal global /;
  const slots: number[] = [];
  const defs: { sym: string; line: string }[] = [];
  const nonLit: string[] = [];
  rest.forEach((l, i) => {
    const m = LIT_DEF.exec(l);
    if (m === null) {
      nonLit.push(l);
      return;
    }
    slots.push(i);
    defs.push({ sym: m[1]!, line: l });
  });
  if (defs.length === 0) return rest;
  const inCold = new Set<string>();
  const inHot = literalRefs(nonLit);
  for (const b of blocks) for (const r of literalRefs(b.lines)) (order.rank.has(b.name) ? inHot : inCold).add(r);
  const cold = new Set<string>();
  for (const r of inCold) if (!inHot.has(r)) cold.add(r);
  if (cold.size === 0) return rest;
  const sortedDefs = hotFirst(defs, (d) => d.sym, cold);
  const out = rest.slice();
  slots.forEach((slot, k) => {
    out[slot] = sortedDefs[k]!.line;
  });
  return out;
}

/* ------------------------------------------------------- data literals */

/* The program's string literals are immortal ScrStr statics in .data (2.2 MB of the REST app's 2.3 MB). The ordered lane already puts the functions the profile
 * ran first, but the literals stay in the order they were interned, so the 0.9 MB the executed code references is scattered over every 64 KiB window of the
 * section and the kernel's fault-around maps all of them (the section is 97% resident). A literal that ONLY cold functions mention goes after every other literal;
 * every other literal keeps its relative order. The partition is conservative: a literal that appears in any text that is not an unranked function (a
 * data table, a ranked function, a walker) counts as hot. Nothing is written to a literal, so the move changes no semantics. */
const LITERAL_REF = /\bsc_lit_\d+\b/g;

/** The distinct `sc_lit_N` names mentioned in `lines`. */
export function literalRefs(lines: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const l of lines) {
    if (!l.includes("sc_lit_")) continue;
    for (const m of l.matchAll(LITERAL_REF)) out.add(m[0]);
  }
  return out;
}

/** `items` with the cold ones moved after the rest, each group in its original order. */
export function hotFirst<T>(items: readonly T[], symOf: (t: T) => string, cold: ReadonlySet<string>): T[] {
  const hot: T[] = [];
  const late: T[] = [];
  for (const t of items) (cold.has(symOf(t)) ? late : hot).push(t);
  return [...hot, ...late];
}

/** The literals a linker ordering file should list, in order: every `sc_lit_N` that ranked functions or non-function text mention (see above), the program's
 * emitted text in `texts` (C units, or one LLVM IR file). Names a cold-only literal never appear: the linker leaves them after everything it was told. */
export function hotLiteralNames(texts: readonly string[], kind: "c" | "llvm", order: LayoutOrder): string[] {
  const hot = new Set<string>();
  const LIT_DECL = /^(?:extern |static )?SCR_STR_LIT\(\d+\) sc_lit_\d+/;
  const LIT_DEF = /^@sc_lit_\d+ = internal global /;
  for (const text of texts) {
    if (kind === "llvm") {
      const parsed = splitLlvmDefines(text);
      if (parsed === null) continue;
      const ranked = parsed.blocks.filter((b) => order.rank.has(b.name));
      for (const b of stableByRank(ranked, (x) => order.rank.get(x.name) ?? Infinity)) for (const r of literalRefs(b.lines)) hot.add(r);
      for (const r of literalRefs(parsed.rest.filter((l) => !LIT_DEF.test(l)))) hot.add(r);
    } else {
      const { chunks, rest } = extractCFunctionChunks(text.split("\n"));
      const ranked = chunks.filter((c) => Number.isFinite(bestRank(order, cDefinedNames(c))));
      for (const c of stableByRank(ranked, (x) => bestRank(order, cDefinedNames(x)))) for (const r of literalRefs(c)) hot.add(r);
      for (const r of literalRefs(rest.filter((l) => !LIT_DECL.test(l)))) hot.add(r);
    }
  }
  // only literals seen in ranked or data text are listed; a literal only unranked (cold) functions mention is left to the linker's default (last)
  return [...hot];
}

/* ------------------------------------------------------------ staleness */

/** Names in an order file that the PROGRAM emitted (`sc_*`; the runtime's `scr_*` functions live in other objects and are not in the
 * program TU), and how many of them the program being built still defines. A file recorded from an older version of the program lists
 * names the program no longer has: those are ignored by the ordering (nothing breaks), but a file that has mostly gone stale orders
 * little, so the build says so once. */
export function layoutMatchStats(order: LayoutOrder, defined: ReadonlySet<string>): { listed: number; found: number } {
  let listed = 0;
  let found = 0;
  for (const name of order.rank.keys()) {
    if (!name.startsWith("sc_") || name.startsWith("scr_")) continue;
    listed++;
    if (defined.has(name)) found++;
  }
  return { listed, found };
}

/** The stale-file warning, or null: at least 30 program functions listed and fewer than 60% of them still defined. */
export const LAYOUT_STALE_MIN_NAMES = 30;
export const LAYOUT_STALE_MIN_RATE = 0.6;
export function layoutStaleWarning(orderPath: string, stats: { listed: number; found: number }): string | null {
  if (stats.listed < LAYOUT_STALE_MIN_NAMES) return null;
  if (stats.found / stats.listed >= LAYOUT_STALE_MIN_RATE) return null;
  const pct = Math.round((100 * stats.found) / stats.listed);
  return `scriptc: warning: the layout order ${orderPath} lists ${stats.listed} functions of this program and only ${stats.found} (${pct}%) still exist; it was recorded from an older version. The build is correct but little is ordered: regenerate it with \`scriptc build --pgo\`.`;
}

/** The names `define`d in an LLVM IR text. */
export function llvmDefinedNames(ll: string): string[] {
  const out: string[] = [];
  for (const l of ll.split("\n")) {
    if (!l.startsWith("define ")) continue;
    const m = LL_DEFINE.exec(l);
    if (m !== null) out.push(m[1]!.startsWith('"') ? m[1]!.slice(1, -1) : m[1]!);
  }
  return out;
}
