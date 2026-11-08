/** Closed-world fence on a record with SYMBOL-KEYED members crossing into the untyped world in a program that reads
 * symbol-keyed properties of untyped values.
 *
 * A record literal `{ [K]: v }` is a typed record whose member the checker names `__@K@<id>` (the late-bound spelling,
 * which carries the VARIABLE name and not the symbol). When it crosses into a checked-dynamic slot the converter keeps
 * the member under that spelling, as a hidden entry. The runtime's symbol-keyed property table (scr_symbol.c) is keyed
 * by the symbol VALUE, so a later `untyped[K]` read cannot find a member stored under the spelling: it would answer
 * `undefined` where Node answers the value. No runtime answer is exact without the symbol's identity, so a program that
 * has both is refused at compile time, at the crossing, by name. A program with only one of the two is untouched.
 *
 * Runs once over the final IR (iterative, like null-proto-fence.ts), only when the module holds a sym.dyn* read.
 */
import { BOOL, DYN, STRING, SYMBOL_T, moduleUsesSymbol, type IrExpr, type IrModule, type IrRecordShape, type SrcLoc } from "../../ir/nodes.js";
import type { ScrDiagnostic } from "../../diagnostics/diagnostic.js";
import { unsupportedDiag } from "../../diagnostics/diagnostic.js";

export interface SymbolRecordFenceHost {
  shapeGet(id: string): IrRecordShape | undefined;
}

const WELL_KNOWN = new Set([
  "toStringTag", "iterator", "asyncIterator", "toPrimitive", "hasInstance", "isConcatSpreadable", "match", "matchAll",
  "replace", "search", "species", "split", "unscopables", "dispose", "asyncDispose",
]);

/** `typeof v === "symbol"` on an untyped value lowers to a kind test (sym.isSym). A program that creates no symbol cannot hold
 * one in an untyped value, so there the test is the constant it always was: false, or true under `!==`. */
export function foldSymbolTestsWithoutSymbols(mod: IrModule): void {
  if (moduleUsesSymbol(mod)) return;
  const seen = new Set<object>();
  const isTest = (x: unknown): boolean => typeof x === "object" && x !== null && (x as Record<string, unknown>)["kind"] === "libCall" && (x as Record<string, unknown>)["fn"] === "sym.isSym";
  const roots = { fns: mod.functions, globals: mod.globals ?? [], classes: mod.classes ?? [] } as Record<string, unknown>;
  const stack: [Record<string, unknown> | unknown[], string | number][] = Object.keys(roots).map((k) => [roots, k]);
  while (stack.length > 0) {
    const [parent, key] = stack.pop()!;
    const slot = parent as Record<string | number, unknown>;
    const v = slot[key];
    if (v === null || typeof v !== "object" || seen.has(v)) continue;
    seen.add(v);
    const o = v as Record<string, unknown>;
    if (o["kind"] === "unary" && o["op"] === "!" && isTest(o["operand"])) {
      slot[key] = { kind: "boolLit", value: true, type: BOOL, loc: o["loc"] };
      continue;
    }
    if (isTest(o)) {
      slot[key] = { kind: "boolLit", value: false, type: BOOL, loc: o["loc"] };
      continue;
    }
    for (const k of Array.isArray(v) ? (v as unknown[]).keys() : Object.keys(o)) stack.push([v as Record<string, unknown>, k as string | number]);
  }
}

/** The late-bound member names of a shape that stand for a USER symbol (not a well-known one, not an order marker). */
function userSymbolMembers(shape: IrRecordShape): string[] {
  const out: string[] = [];
  for (const f of shape.fields) {
    if (!f.name.startsWith("__@") || f.name.startsWith("__@ord@")) continue;
    const m = /^__@(.*)@\d+$/.exec(f.name);
    if (m !== null && WELL_KNOWN.has(m[1]!)) continue;
    out.push(f.name);
  }
  return out;
}

export function fenceSymbolRecordCrossings(
  host: SymbolRecordFenceHost,
  mod: IrModule,
  pushDiag: (d: ScrDiagnostic) => void,
): number {
  const crossings: { loc: SrcLoc; names: string[] }[] = [];
  let reads = 0;
  let anyDyn = false;
  const creations: { kind: string; fn: string; args: unknown[]; symSite?: string; loc: SrcLoc }[] = [];
  const seenObj = new Set<object>();
  const stack: unknown[] = [mod.globals ?? [], mod.classes ?? [], mod.functions];
  while (stack.length > 0) {
    const v = stack.pop();
    if (v === null || typeof v !== "object") continue;
    if (seenObj.has(v)) continue;
    seenObj.add(v);
    const o = v as Record<string, unknown>;
    if (o["kind"] === "libCall" && typeof o["fn"] === "string") {
      const fn = o["fn"] as string;
      if (fn.startsWith("sym.dyn") || fn.startsWith("sym.any") || fn === "sym.hasAcc") anyDyn = true;
      if ((fn === "sym.new" || fn === "sym.newAnon") && typeof o["symSite"] === "string") creations.push(o as unknown as (typeof creations)[number]);
      if (fn === "sym.dynGet" || fn === "sym.dynGetOpt" || fn === "sym.dynHas" || fn === "sym.dynHasOwn" || fn === "sym.dynOwnKeys") reads++;
    } else if (o["kind"] === "dynFrom") {
      const inner = o["value"] as { type?: { kind?: string; shapeId?: string } } | undefined;
      if (inner?.type?.kind === "record" && inner.type.shapeId !== undefined) {
        const shape = host.shapeGet(inner.type.shapeId);
        const names = shape === undefined ? [] : userSymbolMembers(shape);
        if (names.length > 0) crossings.push({ loc: o["loc"] as SrcLoc, names });
      }
    }
    const kids: unknown[] = Array.isArray(v) ? v : Object.values(o);
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
  }
  // A program that keeps symbol properties on untyped values matches a class's symbol-keyed members by the symbol's creation site
  // (the class side names it in a %symid member), so every Symbol() call records its site. Other programs emit exactly as before.
  if (anyDyn) {
    for (const c of creations) {
      const site: IrExpr = { kind: "strLit", value: c.symSite!, type: STRING, loc: c.loc };
      if (c.fn === "sym.new") {
        c.fn = "sym.newTagged";
        c.args = [...c.args, site];
      } else {
        c.fn = "sym.newAnonTagged";
        c.args = [site];
      }
    }
  }
  if (reads === 0) return 0;
  for (const c of crossings) {
    pushDiag(unsupportedDiag(
      "SC1101",
      c.loc,
      "converting a record with a symbol-keyed member to 'unknown' in a program that reads symbol-keyed properties of 'unknown' values",
      `the member (${c.names.slice(0, 3).map((n) => n.replace(/@\d+$/, "")).join(", ")}) crosses under its checker spelling, which the symbol-keyed read cannot match by identity, so the read would answer undefined where Node answers the value. ` +
        `Keep the object untyped from its creation (Object.create(null) and assign the symbol key), or read the member through its record type.`,
    ));
  }
  return crossings.length;
}

/** A dynamic key whose static type is not a symbol (`o[k]` with `k: any`) reaches the string-keyed operations through String(k), which would
 * turn a symbol into its description. In a program that handles symbols at all, each such operation becomes one that tests the key for a
 * symbol handle first and routes it to the symbol table (sym.any*), or, for a read, a ternary over the two reads. The key and the receiver are
 * evaluated once, in order, into hidden locals. Programs that touch no symbol are untouched. */
interface AnyKeyNode { kind: string; fn?: string; args?: unknown[]; key?: AnyKeyNode; value?: unknown; operand?: AnyKeyNode & { type: { kind: string } }; type: { kind: string }; loc: SrcLoc; hint?: string; optional?: boolean }

const ANY_KEY_OPS: Record<string, { to: string; extra: number }> = {
  "dyn.keySet": { to: "sym.anySet", extra: 1 },
  "dyn.keySetSloppy": { to: "sym.anySetSloppy", extra: 1 },
  "dyn.keyDelete": { to: "sym.anyDelete", extra: 0 },
  "dyn.hasKey": { to: "sym.anyHas", extra: 0 },
  "dyn.hasOwn": { to: "sym.anyHasOwn", extra: 0 },
  "dyn.getOwnPropDesc": { to: "sym.anyGetOwnDesc", extra: 0 },
  "dyn.defineProp": { to: "sym.anyDefine", extra: 1 },
};

/** The locals of `fn` no statement of it ever reassigns and no closure captures: a read of one yields the same value whenever it
 * runs, so an operation that mentions it twice needs no hidden copy (and pays no retain / release pair for one). */
function stableLocals(fn: { locals: { id: string; mutable: boolean; boxed?: boolean }[]; body: unknown }): Set<string> {
  const written = new Set<string>();
  const stack: unknown[] = [fn.body];
  const seen = new Set<object>();
  while (stack.length > 0) {
    const v = stack.pop();
    if (v === null || typeof v !== "object" || seen.has(v)) continue;
    seen.add(v);
    const o = v as Record<string, unknown>;
    if ((o["kind"] === "assign" || o["kind"] === "assignExpr") && typeof o["localId"] === "string") written.add(o["localId"] as string);
    const kids: unknown[] = Array.isArray(v) ? v : Object.values(o);
    for (const k of kids) stack.push(k);
  }
  const out = new Set<string>();
  for (const l of fn.locals) if (!l.boxed && (!l.mutable || !written.has(l.id))) out.add(l.id);
  return out;
}

export function routeAnyKeysToSymbols(mod: IrModule): number {
  if (!moduleUsesSymbol(mod)) return 0;
  let rewritten = 0;
  let counter = 0;
  const done = new WeakSet<object>();
  for (const fn of mod.functions as unknown as { locals: { id: string; name: string; type: unknown; mutable: boolean; boxed?: boolean }[]; body: unknown }[]) {
    const stable = stableLocals(fn);
    const stack: unknown[] = [fn.body];
    const seen = new Set<object>();
    while (stack.length > 0) {
      const v = stack.pop();
      if (v === null || typeof v !== "object" || seen.has(v)) continue;
      seen.add(v);
      const n = v as AnyKeyNode & Record<string, unknown>;
      if (!Array.isArray(v) && !done.has(n)) {
        const isLib = n.kind === "libCall" && typeof n.fn === "string" && ANY_KEY_OPS[n.fn] !== undefined && Array.isArray(n.args) && n.args.length === 2 + ANY_KEY_OPS[n.fn]!.extra;
        const keyArg = isLib ? (n.args![1] as AnyKeyNode) : n.kind === "dynKeyGet" ? (n.key as AnyKeyNode) : null;
        // Object.defineProperty(o, k, d) with an untyped `k` lowers the key through a checked string cast; the cast is replaced by the same
        // ToString the other operations use (a number key stringifies, as in Node; a symbol is routed to the table)
        if (keyArg !== null && keyArg.kind === "dynCheck" && keyArg.type.kind === "string" && (keyArg as unknown as { value: AnyKeyNode }).value?.type.kind === "dyn" && n.fn === "dyn.defineProp") {
          const cast = keyArg as unknown as { value: AnyKeyNode & { type: { kind: string } } };
          Object.assign(keyArg, { kind: "toString", operand: cast.value });
          delete (keyArg as unknown as Record<string, unknown>)["value"];
        }
        if (keyArg !== null && keyArg.kind === "toString" && keyArg.hint === undefined && keyArg.operand?.type.kind === "dyn") {
          const id = ++counter;
          // a stable local (never reassigned, never captured) is read where it is mentioned; anything else is evaluated once, in
          // order, into a hidden local
          const mk = (name: string, init: unknown): [string, unknown | null] => {
            const iv = init as { kind?: string; localId?: string; type?: { kind: string } };
            if (iv.kind === "varRef" && typeof iv.localId === "string" && iv.type?.kind === "dyn" && stable.has(iv.localId)) return [iv.localId, null];
            const localId = `anykey${id}${name}.0`;
            fn.locals.push({ id: localId, name: `%anykey${id}${name}`, type: DYN, mutable: false });
            return [localId, { kind: "varDecl", localId, init, loc: n.loc }];
          };
          const recvInit = isLib ? n.args![0] : n.value;
          const [rId, rDecl] = mk("r", recvInit);
          const [kId, kDecl] = mk("k", keyArg.operand);
          const decls = [rDecl, kDecl].filter((x) => x !== null);
          const ref = (localId: string): IrExpr => ({ kind: "varRef", localId, type: DYN, loc: n.loc });
          keyArg.operand = ref(kId) as never;
          const loc = n.loc;
          if (isLib) {
            const op = ANY_KEY_OPS[n.fn!]!;
            const rest = n.args!.slice(2);
            const inner = { kind: "libCall", fn: op.to, args: [ref(rId), ref(kId), keyArg, ...rest], type: n.type, loc } as unknown as AnyKeyNode;
            done.add(inner);
            for (const k of Object.keys(n)) delete n[k];
            Object.assign(n, decls.length === 0 ? inner : { kind: "seqExpr", stmts: decls, result: inner, type: inner.type, loc });
          } else {
            const read = { kind: "dynKeyGet", key: keyArg, value: ref(rId), type: DYN, ...(n.optional ? { optional: true } : {}), loc } as unknown as AnyKeyNode;
            done.add(read);
            const sym = {
              kind: "libCall", fn: n.optional ? "sym.dynGetOpt" : "sym.dynGet",
              args: [ref(rId), { kind: "dynCheck", value: ref(kId), type: SYMBOL_T, loc }], type: DYN, loc,
            };
            const test = { kind: "libCall", fn: "sym.isSym", args: [ref(kId)], type: BOOL, loc };
            for (const k of Object.keys(n)) delete n[k];
            const tern = { kind: "ternary", cond: test, then: sym, else_: read, type: DYN, loc };
            Object.assign(n, decls.length === 0 ? tern : { kind: "seqExpr", stmts: decls, result: tern, type: DYN, loc });
          }
          rewritten++;
        }
      }
      const kids: unknown[] = Array.isArray(v) ? v : Object.values(v as object);
      for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
    }
  }
  return rewritten;
}
