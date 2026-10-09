/* THE CROSS-PARK SLOT ORACLE -- an independent reading of the emitted module.
 *
 * WHAT IT IS FOR. blocks.ts carries two rules over the stackless lowering, and
 * both scan at APPEND time: a reference is judged against the suspension
 * generation it was appended in. That is blind to BACK EDGES by construction --
 * a loop's condition and body head are appended before the park and re-entered
 * after it -- and it says nothing at all about slots the emitter decided to
 * carry in the frame, because carrying one removes it from the registry. This
 * reads the emitted `.ll` instead, over its real control-flow graph, and asks
 * the question the emission order cannot:
 *
 *   is a slot read on a path from a resume label with only the ENTRY BLOCK'S
 *   re-initialisation reaching it?
 *
 * THE ENTRY STORE IS POISON, NOT A DEFINITION, and that is the whole design.
 * The entry block re-runs on every resume -- the dispatch terminates it -- so
 * its initialising store destroys whatever the pre-park code left in the slot.
 * An earlier version of this file asked "was the slot WRITTEN on this path", a
 * definedness question, and was green by construction for every refcounted
 * local: measured, 0 of 77 planted reload deletions detected. Treating the
 * entry store as poison instead catches every planted deletion that changes
 * behaviour.
 *
 * THE DIFFERENTIAL AGAINST THE FIRST-CALL CFG keeps a pre-existing
 * uninitialised read -- an older and different defect class -- out of the
 * result: a finding must appear on the full CFG and NOT on the one where the
 * dispatch takes only its `sc_S0` arm.
 *
 * THE SSA CONTROL IS NOT A PRODUCT. This host verifies the IR it is handed at
 * parse, so any `.ll` that compiled is dominance clean; `ssaViolations` must
 * therefore read zero on a compiled artifact. It is here because it exercises
 * the SAME parsed CFG as the slot check, against a property an external
 * toolchain independently guarantees. A non-zero control means the CFG reader
 * is wrong and the slot result is worthless. It earned its place: it named the
 * undominated values in this slice's first failed build.
 *
 * WHAT IT DOES NOT SEE, named rather than left to be discovered:
 *   - a reload that loads the WRONG frame field. A store is a store here;
 *     emitCoroTempSpill's type and determinism assertions cover that.
 *   - a slot whose address ESCAPES (a getelementptr on it, or passing it to a
 *     call). Nothing can be concluded through the derived pointer, so such a
 *     slot clears poison and is counted in `escaped` rather than folded
 *     silently into the green.
 *   - anything about a shape the emitter never emits. It reads the artifact,
 *     so the caller must assert `allocasExamined` too: a zero population is
 *     not a pass. */

const RESUME = /^sc_S([1-9][0-9]*)$/;

interface Line {
  text: string;
  line: number;
}
interface Block {
  label: string;
  lines: Line[];
  term: string | null;
}
export interface LlFunction {
  name: string;
  blocks: Block[];
  byLabel: Map<string, Block>;
}

export function parseModule(src: string): LlFunction[] {
  const lines = src.split(/\r?\n/);
  const fns: LlFunction[] = [];
  let fn: LlFunction | null = null;
  let blk: Block | null = null;
  for (let n = 0; n < lines.length; n++) {
    const raw = lines[n]!;
    const s = raw.trim();
    const d = /^define .*?@([A-Za-z0-9_.$]+)\(/.exec(s);
    if (d !== null) {
      fn = { name: d[1]!, blocks: [], byLabel: new Map() };
      fns.push(fn);
      blk = { label: "%__pre", lines: [], term: null };
      fn.blocks.push(blk);
      fn.byLabel.set(blk.label, blk);
      continue;
    }
    if (fn === null) continue;
    if (s === "}") {
      fn = null;
      blk = null;
      continue;
    }
    const lab = /^([A-Za-z0-9_.$]+):/.exec(raw);
    if (lab !== null && !/^\s/.test(raw)) {
      blk = { label: `%${lab[1]!}`, lines: [], term: null };
      fn.blocks.push(blk);
      fn.byLabel.set(blk.label, blk);
      continue;
    }
    if (blk === null || s === "") continue;
    if (/^(br |switch |ret |unreachable|resume |indirectbr |callbr )/.test(s)) blk.term = s;
    else blk.lines.push({ text: s, line: n + 1 });
  }
  for (const f of fns) {
    const first = f.blocks[0]!;
    if (first.lines.length === 0 && first.term === null && f.blocks.length > 1) {
      f.byLabel.delete("%__pre");
      f.blocks.shift();
    }
  }
  return fns;
}

const succsOf = (t: string | null): string[] =>
  t === null ? [] : [...t.matchAll(/label (%[A-Za-z0-9_.$]+)/g)].map((m) => m[1]!);

function cfg(fn: LlFunction, onlyS0: boolean): Map<string, string[]> {
  const succ = new Map<string, string[]>();
  for (const b of fn.blocks) {
    let s = succsOf(b.term);
    if (onlyS0 && /^switch /.test(b.term ?? "")) s = s.filter((l) => !RESUME.test(l.slice(1)));
    succ.set(
      b.label,
      s.filter((l) => fn.byLabel.has(l)),
    );
  }
  return succ;
}

function reachable(fn: LlFunction, succ: Map<string, string[]>): Set<string> {
  const seen = new Set<string>();
  const st = [fn.blocks[0]!.label];
  while (st.length > 0) {
    const l = st.pop()!;
    if (seen.has(l)) continue;
    seen.add(l);
    for (const n of succ.get(l) ?? []) st.push(n);
  }
  return seen;
}

function dominators(fn: LlFunction, succ: Map<string, string[]>): Map<string, Set<string>> {
  const preds = new Map<string, string[]>(fn.blocks.map((b) => [b.label, []]));
  for (const b of fn.blocks) for (const s of succ.get(b.label) ?? []) preds.get(s)!.push(b.label);
  const all = fn.blocks.map((b) => b.label);
  const dom = new Map<string, Set<string>>(all.map((l) => [l, new Set(l === all[0] ? [l] : all)]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const l of all.slice(1)) {
      const ps = preds.get(l)!.filter((p) => dom.has(p));
      let inter: Set<string> | null = null;
      for (const p of ps) {
        inter =
          inter === null
            ? new Set(dom.get(p)!)
            : new Set([...inter].filter((x) => dom.get(p)!.has(x)));
      }
      const next = inter === null ? new Set([l]) : inter.add(l);
      if (next.size !== dom.get(l)!.size) {
        dom.set(l, next);
        changed = true;
      }
    }
  }
  return dom;
}

export interface SsaViolation {
  value: string;
  at: string;
  why: string;
}

export function ssaViolations(fn: LlFunction): SsaViolation[] {
  const succ = cfg(fn, false);
  const live = reachable(fn, succ);
  const dom = dominators(fn, succ);
  const defBlock = new Map<string, string>();
  const defIdx = new Map<string, number>();
  for (const b of fn.blocks) {
    b.lines.forEach((ln, i) => {
      const m = /^(%[A-Za-z0-9_.$]+) = /.exec(ln.text);
      if (m !== null) {
        defBlock.set(m[1]!, b.label);
        defIdx.set(m[1]!, i);
      }
    });
  }
  const out: SsaViolation[] = [];
  for (const b of fn.blocks) {
    if (!live.has(b.label)) continue;
    const scan: Array<[string, number]> = b.lines.map((l, i) => [l.text, i]);
    if (b.term !== null) scan.push([b.term, Number.MAX_SAFE_INTEGER]);
    for (const [text, i] of scan) {
      const rhs = text.replace(/^(%[A-Za-z0-9_.$]+) = /, "");
      for (const m of rhs.matchAll(/(%[A-Za-z0-9_.$]+)/g)) {
        const v = m[1]!;
        const db = defBlock.get(v);
        if (db === undefined) continue;
        if (db === b.label) {
          if (defIdx.get(v)! >= i) out.push({ value: v, at: b.label, why: "use before def" });
        } else if (!(dom.get(b.label)?.has(db) ?? false)) {
          out.push({ value: v, at: b.label, why: `def in ${db} does not dominate use` });
        }
      }
    }
  }
  return out;
}

const q = (s: string): string => s.replace(/[$.]/g, "\\$&");

function role(text: string, slot: string): "store" | "load" | "escape" | null {
  if (!new RegExp(`${q(slot)}(?![0-9A-Za-z_.$])`).test(text)) return null;
  // THE ALLOCA DECLARATION IS NOT A REFERENCE. blocks.ts says so in prose, and
  // this file proved it the hard way: counting it made every slot "escaped"
  // and the whole result vacuously green.
  if (new RegExp(`^${q(slot)} = alloca `).test(text)) return null;
  if (/^store /.test(text) && new RegExp(`, ptr ${q(slot)}(?![0-9A-Za-z_.$])`).test(text)) {
    return "store";
  }
  if (/= load /.test(text) && new RegExp(`, ptr ${q(slot)}(?![0-9A-Za-z_.$])`).test(text)) {
    return "load";
  }
  return "escape";
}

function poisonReads(
  fn: LlFunction,
  slot: string,
  onlyS0: boolean,
): { hits: Line[]; escaped: boolean } {
  const succ = cfg(fn, onlyS0);
  const live = reachable(fn, succ);
  const entry = fn.blocks[0]!.label;
  const inSt = new Map<string, boolean>([[entry, true]]);
  const work = [entry];
  const hits: Line[] = [];
  const seen = new Set<string>();
  let escaped = false;
  while (work.length > 0) {
    const l = work.pop()!;
    if (!live.has(l)) continue;
    let st = inSt.get(l) ?? false;
    const b = fn.byLabel.get(l)!;
    for (const ln of b.lines) {
      const r = role(ln.text, slot);
      if (r === null) continue;
      if (r === "load" && st) {
        const k = `${l}#${ln.line}`;
        if (!seen.has(k)) {
          seen.add(k);
          hits.push(ln);
        }
      }
      // THE ENTRY BLOCK'S OWN STORES DO NOT CLEAR POISON: they re-run on every
      // resume, so they destroy the carried value rather than defining it.
      if (r === "escape") {
        escaped = true;
        st = false;
      } else if (r === "store" && l !== entry) st = false;
    }
    for (const n of succ.get(l) ?? []) {
      const prev = inSt.get(n);
      const next = prev === undefined ? st : prev || st;
      if (prev !== next) {
        inSt.set(n, next);
        work.push(n);
      }
    }
  }
  return { hits, escaped };
}

export interface SlotFinding {
  slot: string;
  hits: Line[];
}
export interface FnAudit {
  name: string;
  isCoro: boolean;
  allocas: string[];
  ssa: SsaViolation[];
  slots: SlotFinding[];
  escaped: string[];
}

export function auditFn(fn: LlFunction): FnAudit {
  const allocas: string[] = [];
  for (const b of fn.blocks) {
    for (const ln of b.lines) {
      const m = /^(%[A-Za-z0-9_.$]+) = alloca /.exec(ln.text);
      if (m !== null) allocas.push(m[1]!);
    }
  }
  const isCoro = fn.blocks.some((b) => RESUME.test(b.label.slice(1)));
  const r: FnAudit = {
    name: fn.name,
    isCoro,
    allocas,
    ssa: ssaViolations(fn),
    slots: [],
    escaped: [],
  };
  if (!isCoro) return r;
  for (const s of allocas) {
    const full = poisonReads(fn, s, false);
    if (full.escaped) {
      r.escaped.push(s);
      continue;
    }
    if (full.hits.length === 0) continue;
    const first = new Set(poisonReads(fn, s, true).hits.map((h) => `${h.line}`));
    const only = full.hits.filter((h) => !first.has(`${h.line}`));
    if (only.length > 0) r.slots.push({ slot: s, hits: only });
  }
  return r;
}

export interface ModuleAudit {
  functions: number;
  suspending: number;
  allocasExamined: number;
  escaped: number;
  ssa: string[];
  slots: string[];
}

export function auditModule(ll: string): ModuleAudit {
  const out: ModuleAudit = {
    functions: 0,
    suspending: 0,
    allocasExamined: 0,
    escaped: 0,
    ssa: [],
    slots: [],
  };
  for (const fn of parseModule(ll)) {
    out.functions++;
    const r = auditFn(fn);
    for (const v of r.ssa) out.ssa.push(`${fn.name}: ${v.value} at ${v.at} (${v.why})`);
    if (!r.isCoro) continue;
    out.suspending++;
    out.allocasExamined += r.allocas.length;
    out.escaped += r.escaped.length;
    for (const s of r.slots) {
      out.slots.push(
        `${fn.name}: ${s.slot} is read on a resume path with only the entry block's ` +
          `re-initialisation reaching it, at ${s.hits.map((h) => `line ${h.line}`).join(", ")}`,
      );
    }
  }
  return out;
}
