/* FIELD-RUN LOOPS for the enumeration and reshape helpers.
 *
 * `Object.entries(record)`, `Object.values(record)` and the width reshape of `as Record<string, V>` are lowered to one IR function per record shape
 * (`%obj.entries.N`, `%obj.values.N`, `%rec.capture.N`), and the lowering writes ONE STATEMENT PER MEMBER:
 *
 *     if (recordKeyPresent(r, "p0")) { out.push({"0": "p0", "1": <value of recordGet(r, "p0")>}); }
 *     if (recordKeyPresent(r, "p1")) { out.push({"0": "p1", "1": <value of recordGet(r, "p1")>}); }   ...
 *
 * For zapo's WA_ABPROPS, a record of 2,151 members of one type, the two helpers were 471 KB and 452 KB of machine code, run once and resident at the startup
 * peak. This pass runs AFTER every guard, patch and shape unification has been applied (so the statements are final), finds a RUN of consecutive top-level
 * statements that are, after replacing the member's name in exactly three roles, the SAME statement for every member, and replaces the run with a loop:
 *
 *     for (fi = 0; fi < N; fi++) { if (recordKeyPresentAt(r, run, fi)) { out.push({"0": runKeyAt(run, fi), "1": ...recordGetAt(r, run, fi)...}); } }
 *
 * The three roles are recordGet.field, recordKeyPresent.field and a strLit whose value IS the member's name; the *At nodes mean exactly what those nodes mean for
 * the field run[fi] (ir/nodes.ts). The loop body is the first statement of the run rewritten that way, and every statement of the run is rewritten the same way and
 * compared with it (as canonical text, locations ignored), so a run is a loop only when each statement was the first one's code for another member. Key order is
 * the run's order, which is the statements' order; the own-bit test, the undefined-arm test and the hole/absent behaviour are inside the statement and unchanged.
 *
 * What a run may NOT contain, and what stays unrolled: a member whose name appears in any other role (the canonical texts then differ), a member of another type
 * (recordGet carries its type), a member with a different own-mask situation (the bit is part of what recordKeyPresent answers: a run is all-with or all-without),
 * and nothing else is excluded: a shape the required-absent read applies to loops too, because recordGetAt carries that read (scr_throw_absent_key names the member from the run's key table).
 * MIN members or more make a run (default 8; SCRIPTC_FIELD_LOOP_MIN, 0 = off, the same knob as the walkers). Only the three helper families above are examined. */
import type { IrExpr, IrFunction, IrRecordShape, IrStmt, SrcLoc } from "./nodes.js";
import { F64, BOOL, ownMaskKeyBit, typeKey } from "./nodes.js";
import { fieldLoopMin } from "../backend/emission/field-loop.js";

const HELPER_PREFIXES = ["%obj.entries.", "%obj.values.", "%rec.capture."];
const RUN = "\u0001RUN\u0001";

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => x !== null && typeof x === "object" && !Array.isArray(x);

/** The member a statement is about: every recordGet / recordKeyPresent over a record-typed LOCAL names the same member of the same shape through the same local.
 * null when there is none, or when they disagree (such a statement is not a per-member statement). */
function memberOf(stmt: unknown): { field: string; shapeId: string; localId: string } | null {
  let found: { field: string; shapeId: string; localId: string } | null = null;
  let ok = true;
  const walk = (n: unknown): void => {
    if (!ok || n === null || typeof n !== "object") return;
    if (Array.isArray(n)) {
      for (const x of n) walk(x);
      return;
    }
    const o = n as Obj;
    if ((o["kind"] === "recordGet" || o["kind"] === "recordKeyPresent") && isObj(o["obj"]) && o["obj"]["kind"] === "varRef") {
      const t = o["obj"]["type"];
      const cand = { field: String(o["field"]), shapeId: String(o["shapeId"]), localId: String(o["obj"]["localId"]) };
      if (isObj(t) && t["kind"] === "record" && t["shapeId"] === cand.shapeId) {
        if (found === null) found = cand;
        else if (found.field !== cand.field || found.shapeId !== cand.shapeId || found.localId !== cand.localId) ok = false;
      }
    }
    for (const [k, v] of Object.entries(o)) if (k !== "loc") walk(v);
  };
  walk(stmt);
  return ok ? found : null;
}

/** A copy of `n` with the member's three roles rewritten to the At nodes, over the shared `run` array and the index expression. */
function rewrite(n: unknown, m: { field: string; shapeId: string; localId: string }, run: string[], index: () => IrExpr): unknown {
  if (Array.isArray(n)) return n.map((x) => rewrite(x, m, run, index));
  if (!isObj(n)) return n;
  const o = n;
  const kind = o["kind"];
  const isMemberRef =
    (kind === "recordGet" || kind === "recordKeyPresent") && o["field"] === m.field && o["shapeId"] === m.shapeId && isObj(o["obj"]) && o["obj"]["kind"] === "varRef" && o["obj"]["localId"] === m.localId;
  if (isMemberRef) {
    const { field: _f, kind: _k, ...rest } = o;
    void _f;
    void _k;
    const out: Obj = { ...(rewrite(rest, m, run, index) as Obj), kind: kind === "recordGet" ? "recordGetAt" : "recordKeyPresentAt", run, index: index() };
    return out;
  }
  if (kind === "strLit" && o["value"] === m.field) {
    return { kind: "runKeyAt", run, index: index(), type: o["type"], loc: o["loc"] };
  }
  const out: Obj = {};
  for (const [k, v] of Object.entries(o)) out[k] = rewrite(v, m, run, index);
  return out;
}

/** Canonical text of a rewritten statement: locations dropped, the run placeholder named. */
function canonical(x: unknown, run: string[]): string {
  return JSON.stringify(x, (k, v) => (k === "loc" ? undefined : v === run ? RUN : v));
}

interface Cand {
  member: { field: string; shapeId: string; localId: string };
  text: string;
}

/** At most this many different bodies in one mixed run (one per kind of member); more kinds keep the unrolled statements. */
const MAX_KINDS = 8;

export function compressFieldRunLoops(functions: IrFunction[], records: readonly IrRecordShape[], min = fieldLoopMin()): number {
  if (min <= 0) return 0;
  const shapes = new Map(records.map((s) => [s.id, s]));
  let loops = 0;
  for (const fn of functions) {
    if (!HELPER_PREFIXES.some((p) => fn.name.startsWith(p))) continue;
    const body = fn.body;
    // UNITS: the consecutive statements about one member (an optional member lowers to two: the undefined-arm test and its complement), or one statement that is
    // about none. A unit is a candidate when it is about a member of a known shape.
    const units: { stmts: IrStmt[]; member: { field: string; shapeId: string; localId: string } | null }[] = [];
    for (const st of body) {
      const m = memberOf(st);
      const last = units[units.length - 1];
      if (m !== null && last !== undefined && last.member !== null && last.member.field === m.field && last.member.shapeId === m.shapeId && last.member.localId === m.localId) last.stmts.push(st);
      else units.push({ stmts: [st], member: m });
    }
    const cands: (Cand | null)[] = units.map((u) => {
      const m = u.member;
      if (m === null) return null;
      const shape = shapes.get(m.shapeId);
      if (shape === undefined || !shape.fields.some((f) => f.name === m.field)) return null;
      const probe: string[] = [];
      const ix = () => ({ kind: "varRef", localId: "\u0001i", type: F64, loc: undefined as unknown as SrcLoc }) as IrExpr;
      return { member: m, text: canonical(u.stmts.map((st) => rewrite(st, m, probe, ix)), probe) };
    });
    // A member's KIND: the canonical text of its unit (which carries the field type through recordGet's type), its field type and its own-mask situation. A run is
    // MIXED when its members have up to MAX_KINDS kinds interleaved in any order: ONE loop over the whole member list, a per-member kind table and a chain of the
    // kinds' bodies, each reading its own members' tables with a running counter, so the key order stays the run's order.
    const kindOf = (c: Cand): string => {
      const shape = shapes.get(c.member.shapeId)!;
      const f = shape.fields.find((x) => x.name === c.member.field)!;
      return `${c.text}|${typeKey(f.type)}|${ownMaskKeyBit(shape, c.member.field) !== null}`;
    };
    const out: IrStmt[] = [];
    let i = 0;
    const idLocals = new Set(fn.locals.map((l) => l.id));
    const fresh = (base: string, name: string, mutable: boolean): string => {
      let n = 0;
      while (idLocals.has(`${base}.${n}`)) n++;
      const id = `${base}.${n}`;
      idLocals.add(id);
      fn.locals.push({ id, name, type: F64, mutable });
      return id;
    };
    // The emitters declare a run's constant tables once per function, in the first loop that reads them, so one (shape, run) is looped once per function.
    const looped = new Set<string>();
    while (i < units.length) {
      const c0 = cands[i];
      let j = i + 1;
      const classes = new Map<string, number>();
      const classOf: number[] = [];
      if (c0 !== null && c0 !== undefined) {
        const seen = new Set<string>();
        j = i;
        while (j < units.length) {
          const cj = cands[j];
          if (cj === null || cj === undefined || cj.member.shapeId !== c0.member.shapeId || cj.member.localId !== c0.member.localId) break;
          if (seen.has(cj.member.field)) break;
          const key = kindOf(cj);
          let k = classes.get(key);
          if (k === undefined) {
            if (classes.size >= MAX_KINDS) break;
            k = classes.size;
            classes.set(key, k);
          }
          classOf.push(k);
          seen.add(cj.member.field);
          j++;
        }
      }
      const n = j - i;
      const K = classes.size;
      const subRuns: string[][] = Array.from({ length: K }, () => []);
      for (let t = 0; t < classOf.length; t++) subRuns[classOf[t]!]!.push(units[i + t]!.member!.field);
      const subKeys = subRuns.map((r) => `${c0?.member.shapeId}|${r.join("\u0001")}`);
      // a loop pays for K bodies: it needs at least two members per kind on average, and no table of it may already belong to another loop of this function
      if (c0 !== null && c0 !== undefined && n >= min && n >= 2 * K && subKeys.every((k) => !looped.has(k))) {
        for (const k of subKeys) looped.add(k);
        const loc = (units[i]!.stmts[0] as { loc: SrcLoc }).loc;
        const fi = fresh("fi", "fi", true);
        const num = (value: number): IrExpr => ({ kind: "numLit", value, type: F64, loc });
        const ref = (id: string): IrExpr => ({ kind: "varRef", localId: id, type: F64, loc });
        const add1 = (id: string): IrStmt => ({ kind: "assign", localId: id, value: { kind: "bin", op: "+", left: ref(id), right: num(1), type: F64, loc }, loc });
        let loopBody: IrStmt[];
        if (K === 1) {
          loopBody = units[i]!.stmts.map((st) => rewrite(st, c0.member, subRuns[0]!, () => ref(fi)) as IrStmt);
        } else {
          const kinds = classOf.slice();
          const fk = fresh("fk", "fk", true);
          const counters: string[] = [];
          for (let k = 0; k < K; k++) {
            const id = fresh("fc", "fc", true);
            counters.push(id);
            out.push({ kind: "varDecl", localId: id, init: num(0), loc } as IrStmt);
          }
          // the first member of each kind is the body's template
          const first: number[] = [];
          for (let t = 0; t < n; t++) if (first[classOf[t]!] === undefined) first[classOf[t]!] = t;
          const bodies: IrStmt[][] = [];
          for (let k = 0; k < K; k++) {
            const u = units[i + first[k]!]!;
            const stmts = u.stmts.map((st) => rewrite(st, u.member!, subRuns[k]!, () => ref(counters[k]!)) as IrStmt);
            stmts.push(add1(counters[k]!));
            bodies.push(stmts);
          }
          let chain: IrStmt[] | null = bodies[K - 1]!;
          for (let k = K - 2; k >= 0; k--) {
            chain = [{ kind: "if", cond: { kind: "bin", op: "===", left: ref(fk), right: num(k), type: BOOL, loc }, then: bodies[k]!, else_: chain, loc } as IrStmt];
          }
          loopBody = [
            { kind: "varDecl", localId: fk, init: { kind: "runKindAt", kinds, index: ref(fi), type: F64, loc } as IrExpr, loc } as IrStmt,
            ...chain!,
          ];
        }
        out.push({
          kind: "for",
          init: { kind: "varDecl", localId: fi, init: num(0), loc },
          cond: { kind: "bin", op: "<", left: ref(fi), right: num(n), type: BOOL, loc },
          update: add1(fi),
          body: loopBody,
          loc,
        } as IrStmt);
        loops++;
        i = j;
      } else {
        out.push(...units[i]!.stmts);
        i++;
      }
    }
    if (out.length !== body.length) {
      body.length = 0;
      body.push(...out);
    }
  }
  return loops;
}
