import * as ts from "./ts7/adapter.js";
import type { IrRecordShape, IrType, IrUnionDef } from "../ir/nodes.js";
import { ABORTCONTROLLER_T, ABORTSIGNAL_T, BIGINT, arrayOf, BOOL, bytesOf, canConvertToDyn, CHILD_T, DYN, F64, funcOf, isSupportedIndexValue, isSupportedMapKey, isSupportedMapValue, isSupportedSetElem, isUnitType, JSVAL, mapOf, NULL_T, PROCSTREAM_T, RUNTIME_EMITTER_CLASS, RUNTIME_ERROR_CLASSES, RUNTIME_STREAM_CLASSES, setOf, STRING, SYMBOL_T, typeEquals, typeKey, UNDEFINED_T, VOID } from "../ir/nodes.js";

import { isJsSourceFile } from "./program.js";
import { accessorSlotProp, wsGlobalPlan } from "../ir/nodes.js";
// typeKey moved to ir/nodes.ts (the backend needs it too, for per-type
// helper interning); re-exported here so frontend call sites keep their
// import path.
export { typeKey };

/** The island-backed ambient TYPE names of the fetch slice: standard-
 * library interfaces whose VALUES live in the embedded engine (the
 * engine's fetch mints the Response; AbortSignal.timeout mints the
 * signal), so under --dynamic they map to island handles (jsval) exactly
 * like npm-declared types. Checked with declaration provenance in mapType;
 * consumed by the lowerer's badType for the static-build wording. */
export const ISLAND_AMBIENT_TYPES = ["Response", "RequestInit", "AbortSignal", "Headers"] as const;

/** The frontend's record-shape interner. Records are monomorphic structural
 * shapes: fields sorted by name form the canonical identity, and two types
 * with the same canonical field list share one shapeId (and later one C
 * struct). Owned by the Lowerer; `mapType` needs it to intern the object
 * types it encounters, which is why it is threaded through as a parameter. */
export class ShapeRegistry {
  private readonly byKey = new Map<string, string>();
  private readonly byId = new Map<string, IrRecordShape>();
  /** All interned shapes in first-seen (`r0`, `r1`, ...) order. */
  readonly shapes: IrRecordShape[] = [];
  /** ts.Types currently being mapped — a BACK-REFERENCE to one of these is
   * the recursive knot (`interface TreeNode { children: TreeNode[] }`):
   * mapType answers a NAMED RECURSIVE SHAPE (recursiveRef) whose fields
   * fill in when the outer frame completes. */
  readonly inProgress = new Set<ts.Type>();
  /** RECURSIVE shape ids, keyed by CHECKER TYPE identity: one shapeId per
   * declaration site (the checker canonicalizes interface/alias types per
   * declaration, and caches generic instantiations, so the same spelling
   * is the same ts.Type). Cross-declaration structural unification exists
   * only through the byKey registration finalizeRecursive performs — a
   * one-level unfolding that references the same knot (`{ next: T }` where
   * `type T = { next: T }`) folds into the knot's id; two INDEPENDENT
   * structurally identical recursive declarations intern as distinct
   * shapes, so values of one fence at the other's slots with the ordinary
   * shape-mismatch diagnostic (tsc admits the assignment; the exact-shape
   * stance reports it — the documented v1 width/assignability consequence
   * of per-declaration identity). */
  private readonly recIds = new Map<ts.Type, string>();
  /** Placeholder ids minted but not yet finalized: mid-construction, or
   * permanently pending when the outer mapping failed (such shapes are
   * referenced by nothing reachable and prune at module assembly). */
  private readonly pendingRec = new Set<string>();

  /** The interning key of a canonical field list — shared by intern and
   * finalizeRecursive so the two registration paths can never disagree. */
  private keyOf(fields: { name: string; type: IrType }[], tuple: boolean, indexValue?: IrType): string {
    return (
      (tuple ? "tuple!" : "") +
      (indexValue ? `idx<${typeKey(indexValue)}>!` : "") +
      JSON.stringify(fields.map((f) => [f.name, typeKey(f.type)]))
    );
  }

  /** The shape id a back-reference to an in-progress type resolves to:
   * reuses the type's persistent recursive id or mints a PLACEHOLDER
   * entry (empty fields) the outer frame finalizes. */
  recursiveRef(t: ts.Type): string {
    let id = this.recIds.get(t);
    if (id === undefined) {
      id = `r${this.shapes.length}`;
      const shape: IrRecordShape = { id, fields: [] };
      this.byId.set(id, shape);
      this.shapes.push(shape);
      this.recIds.set(t, id);
      this.pendingRec.add(id);
      if (process.env["SCRIPTC_REC_TRACE"]) process.stderr.write(`REC mint ${id}
`);
    }
    return id;
  }

  /** Rollback point for a SPECULATIVE mapping — UnionRegistry.mark's twin,
   * for the same reason: an abandoned attempt must leave no placeholder
   * behind for a later mapping to pick up through recIds. */
  mark(): number {
    return this.shapes.length;
  }

  /** Discards every shape minted since `mark`, with its cache entries. Safe
   * only for a FAILED attempt: nothing kept may reference them. */
  rollback(mark: number): void {
    if (mark >= this.shapes.length) return;
    const dropped = new Set<string>();
    for (let i = mark; i < this.shapes.length; i++) {
      const shape = this.shapes[i]!;
      dropped.add(shape.id);
      this.byId.delete(shape.id);
      this.pendingRec.delete(shape.id);
    }
    for (const [k, v] of [...this.byKey]) if (dropped.has(v)) this.byKey.delete(k);
    for (const [t, id] of [...this.recIds]) if (dropped.has(id)) this.recIds.delete(t);
    this.shapes.length = mark;
  }

  /** The FINALIZED recursive shape for a checker type — undefined while
   * never mapped, mid-construction, or permanently failed. */
  /** True while `id` is a placeholder no frame has finalized. */
  isPending(id: string): boolean {
    return this.pendingRec.has(id);
  }

  recursiveShapeFor(t: ts.Type): string | undefined {
    const id = this.recIds.get(t);
    return id !== undefined && !this.pendingRec.has(id) ? id : undefined;
  }

  /** True when a back-reference minted a placeholder for `t` that the
   * outer frame has not (yet) finalized. */
  recursivePending(t: ts.Type): boolean {
    const id = this.recIds.get(t);
    return id !== undefined && this.pendingRec.has(id);
  }

  /** Completes a recursive placeholder with its computed field list and
   * registers the structural key (first writer wins — the key may already
   * belong to a structurally identical shape; the recursive id stays
   * authoritative for its own checker type either way). */
  finalizeRecursive(t: ts.Type, fields: { name: string; type: IrType }[], indexValue?: IrType, declaredOrder?: string[]): string {
    const id = this.recIds.get(t);
    if (id === undefined) throw new Error("shape registry bug: finalizeRecursive without a placeholder");
    if (this.pendingRec.has(id)) {
      const shape = this.byId.get(id)!;
      shape.fields = fields;
      if (indexValue) shape.indexValue = indexValue;
      if (declaredOrder) shape.declaredOrder = declaredOrder;
      this.pendingRec.delete(id);
      const key = this.keyOf(fields, false, indexValue);
      if (process.env["SCRIPTC_REC_TRACE"]) {
        const owner = this.byKey.get(key);
        process.stderr.write(
          `REC final ${id} key=${key.slice(0, 90)} ${owner === undefined ? "CLAIMS" : `LOSES-TO ${owner}`}
`,
        );
      }
      if (!this.byKey.has(key)) this.byKey.set(key, id);
    }
    return id;
  }

  /** Interns a canonical (name-sorted) field list, returning its shapeId.
   * `tuple` shapes (fields "0".."n-1" from a tuple type) intern SEPARATELY
   * from structurally identical numeric-keyed object records: the flag is
   * part of the identity because the two serialize differently (a tuple is
   * a JSON array, an object a JSON object). A string index signature's
   * value type (`indexValue`) is part of the identity too: the same
   * declared fields with and without an overflow portion — or with
   * differently-typed ones — are different structs. */
  intern(fields: { name: string; type: IrType }[], tuple = false, indexValue?: IrType, declaredOrder?: string[],): string {
    const key = this.keyOf(fields, tuple, indexValue);
    let id = this.byKey.get(key);
    if (id === undefined) {
      id = `r${this.shapes.length}`;
      const shape: IrRecordShape = {
        id,
        fields,
        ...(tuple ? { tuple: true as const } : {}),
        ...(indexValue ? { indexValue } : {}),
        // First-seen declaration order — metadata, NOT identity (see the
        // IrRecordShape doc): a later structurally-equal type keeps the
        // first one's order.
        ...(declaredOrder ? { declaredOrder } : {}),
      };
      this.byKey.set(key, id);
      this.byId.set(id, shape);
      this.shapes.push(shape);
    }
    return id;
  }

  get(shapeId: string): IrRecordShape | undefined {
    return this.byId.get(shapeId);
  }
}

/** The frontend's union interner — mirrors ShapeRegistry. A union's
 * canonical identity is its typeKey-sorted arm list; two ts unions whose
 * arms map to the same IR types share one unionId (and later one runtime
 * tag numbering: an arm's index in the canonical list IS its tag). Owned by
 * the Lowerer; threaded through mapType exactly like ShapeRegistry. */
export class UnionRegistry {
  private readonly byKey = new Map<string, string>();
  private readonly byId = new Map<string, IrUnionDef>();
  /** All interned unions in first-seen (`u0`, `u1`, ...) order. */
  readonly unions: IrUnionDef[] = [];
  /** ts.Types currently being mapped — a back-reference to one is the
   * recursive knot passing through a union (`type Tree = Leaf | Branch`
   * whose Branch arm carries `Tree[]`, the optional field `a?: A` of a
   * mutually recursive pair): mapType answers a NAMED RECURSIVE UNION
   * (recursiveRef) whose arms fill in when the outer frame completes. */
  readonly inProgress = new Set<ts.Type>();
  /** Recursive union ids, keyed by checker type identity — the
   * ShapeRegistry.recIds story exactly (per-declaration identity, byKey
   * folding one-level unfoldings in). */
  private readonly recIds = new Map<ts.Type, string>();
  private readonly pendingRec = new Set<string>();
  /** Placeholders whose frame FAILED: unmappable, never `undefined`. */
  private readonly poisoned = new Set<string>();

  /** The union id a back-reference to an in-progress union resolves to:
   * reuses the type's persistent recursive id or mints a PLACEHOLDER
   * entry (empty arms) the outer frame finalizes. */
  recursiveRef(t: ts.Type): string {
    let id = this.recIds.get(t);
    if (id === undefined) {
      id = `u${this.unions.length}`;
      const def: IrUnionDef = { id, arms: [] };
      this.byId.set(id, def);
      this.unions.push(def);
      this.recIds.set(t, id);
      this.pendingRec.add(id);
    }
    return id;
  }

  /** A rollback point for a SPECULATIVE mapping — an attempt whose failure
   * must leave no trace. A failed attempt can mint a recursive PLACEHOLDER
   * that nothing will ever finalize; the registry expects such an id to be
   * unreachable and prune, but a later successful mapping can pick it up
   * through recIds and carry it into the program, where the validator sees
   * a union with no arms. Marking before the attempt and rolling back after
   * a failure keeps ids dense and the caches honest. */
  mark(): number {
    return this.unions.length;
  }

  /** Discards every union minted since `mark`, with its cache entries. Safe
   * only for a FAILED attempt: nothing kept may reference them. */
  rollback(mark: number): void {
    if (mark >= this.unions.length) return;
    const dropped = new Set<string>();
    for (let i = mark; i < this.unions.length; i++) {
      const def = this.unions[i]!;
      dropped.add(def.id);
      this.byId.delete(def.id);
      this.pendingRec.delete(def.id);
    }
    for (const [k, v] of [...this.byKey]) if (dropped.has(v)) this.byKey.delete(k);
    for (const [t, id] of [...this.recIds]) if (dropped.has(id)) this.recIds.delete(t);
    // The POISON goes with them. A speculative attempt that failed and was
    // rolled back must leave no verdict behind: the same union reached
    // again on a legitimate path has to be mapped on its own merits, not
    // refused because a discarded attempt once tripped over it.
    for (const id of dropped) this.poisoned.delete(id);
    this.unions.length = mark;
  }

  /** The FINALIZED recursive union for a checker type — undefined while
   * never mapped, mid-construction, or permanently failed. */
  /** True while `id` is a placeholder no frame has finalized. */
  isPending(id: string): boolean {
    return this.pendingRec.has(id);
  }

  /** POISONS the unfinalized placeholder minted for `t` — the frame that
   * would have filled it in failed, so nothing ever will. The def stays in
   * `unions` (ids are positional and later ones are already handed out) and
   * keeps its empty arms: inventing arms would hand every stale reference a
   * type the program never had, trading a loud ICE for a silent wrong one.
   * Instead the id is marked, and mapType refuses any type that reaches it
   * (isPoisoned) — the reference fences honestly. */
  poisonPendingPlaceholder(t: ts.Type): void {
    const id = this.recIds.get(t);
    if (id === undefined || !this.pendingRec.has(id)) return;
    this.pendingRec.delete(id);
    this.recIds.delete(t);
    this.poisoned.add(id);
  }

  /** True for a placeholder whose frame failed: anything reaching it is
   * unmappable, not `undefined`. */
  isPoisoned(id: string): boolean {
    return this.poisoned.has(id);
  }

  recursiveUnionFor(t: ts.Type): string | undefined {
    const id = this.recIds.get(t);
    return id !== undefined && !this.pendingRec.has(id) ? id : undefined;
  }

  /** True when a back-reference minted a placeholder for `t` that the
   * outer frame has not (yet) finalized. */
  recursivePending(t: ts.Type): boolean {
    const id = this.recIds.get(t);
    return id !== undefined && this.pendingRec.has(id);
  }

  /** Completes a recursive placeholder with its canonical arm list and
   * registers the structural key (first writer wins, like shapes). */
  finalizeRecursive(t: ts.Type, arms: IrType[]): string {
    const id = this.recIds.get(t);
    if (id === undefined) throw new Error("union registry bug: finalizeRecursive without a placeholder");
    if (this.pendingRec.has(id)) {
      const def = this.byId.get(id)!;
      def.arms.push(...arms);
      this.pendingRec.delete(id);
      const key = JSON.stringify(arms.map(typeKey));
      if (!this.byKey.has(key)) this.byKey.set(key, id);
    }
    return id;
  }

  /** Interns a canonical (typeKey-sorted, deduplicated) arm list, returning
   * its unionId. */
  intern(arms: IrType[]): string {
    const key = JSON.stringify(arms.map(typeKey));
    let id = this.byKey.get(key);
    if (id === undefined) {
      id = `u${this.unions.length}`;
      const def: IrUnionDef = { id, arms };
      this.byKey.set(key, id);
      this.byId.set(id, def);
      this.unions.push(def);
    }
    return id;
  }

  get(unionId: string): IrUnionDef | undefined {
    return this.byId.get(unionId);
  }
}

/** Human-readable rendering of an IrType for diagnostics (records expand to
 * their canonical field list, unions to their arms; `checker.typeToString`
 * can't — it never sees IR types). `seen` breaks recursive shapes/unions:
 * a back-reference renders as "..." instead of expanding forever.
 *
 * BUDGETED. Recursion is not the only way a spelling runs away: a wide
 * shape whose fields are themselves wide expands multiplicatively without
 * ever repeating a shape, and a generated protobuf message did exactly
 * that -- 19.5 MB in ONE diagnostic, which no reader can use and which
 * made the coverage report unprintable. Past the budget the rest of the
 * spelling collapses to "…", so the head a reader actually reads survives
 * intact. */
const FORMAT_BUDGET = 4000;

export function formatIrType(t: IrType, shapes: ShapeRegistry, unions: UnionRegistry, seen: Set<string> = new Set()): string {
  const s = formatIrTypeInner(t, shapes, unions, seen);
  return s.length > FORMAT_BUDGET ? s.slice(0, FORMAT_BUDGET) + "…" : s;
}

function formatIrTypeInner(t: IrType, shapes: ShapeRegistry, unions: UnionRegistry, seen: Set<string> = new Set()): string {
  switch (t.kind) {
    case "f64":
      return "number";
    case "string":
      return "string";
    case "bool":
      return "boolean";
    case "dyn":
      return "unknown";
    case "caught":
      // What tsc calls the binding; the fence messages carry the real story.
      return "unknown";
    case "void":
      return "void";
    case "undefinedT":
      return "undefined";
    case "nullT":
      return "null";
    case "array": {
      // Union/func elements need the parens TS syntax would ("(number |
      // string)[]" — without them the [] reads as binding to the last arm).
      const elem = formatIrType(t.elem, shapes, unions, seen);
      return t.elem.kind === "union" || t.elem.kind === "func" ? `(${elem})[]` : `${elem}[]`;
    }
    case "bytes":
      // The u8 kind reads as Uint8Array (Buffer maps here too — one
      // runtime representation; the message stays honest either way).
      return t.elem === "u8" ? "Uint8Array" : t.elem === "u32" ? "Uint32Array" : t.elem === "i32" ? "Int32Array" : t.elem === "buf" ? "ArrayBuffer" : "Float32Array";
    case "map":
      return `Map<${formatIrType(t.key, shapes, unions, seen)}, ${formatIrType(t.value, shapes, unions, seen)}>`;
    case "set":
      return `Set<${formatIrType(t.elem, shapes, unions, seen)}>`;
    case "func":
      return `(${t.params.map((p) => formatIrType(p, shapes, unions, seen)).join(", ")}) => ${formatIrType(t.ret, shapes, unions, seen)}`;
    case "object":
      // Runtime-provided error classes carry '%'-prefixed IR names
      // ("%Error") so user classes can never collide; diagnostics show the
      // source-level name.
      return t.className.startsWith("%") ? t.className.slice(1) : t.className;
    case "classval":
      // The static side, in TS's own spelling.
      return `typeof ${t.className.startsWith("%") ? t.className.slice(1) : t.className}`;
    case "record": {
      const shape = shapes.get(t.shapeId);
      if (!shape) return `{ /* unknown shape ${t.shapeId} */ }`;
      if (seen.has(t.shapeId)) return "..."; // the recursive knot
      seen.add(t.shapeId);
      try {
        if (shape.tuple) {
          const byIndex = [...shape.fields].sort((a, b) => Number(a.name) - Number(b.name));
          return `[${byIndex.map((f) => formatIrType(f.type, shapes, unions, seen)).join(", ")}]`;
        }
        const members = shape.fields.map((f) => {
          // Accessor slots print in TS's accessor spelling, not the
          // reserved '%'-field encoding.
          const slot = accessorSlotProp(f.name);
          if (slot && f.type.kind === "func") {
            return slot.kind === "get"
              ? `get ${slot.prop}(): ${formatIrType(f.type.ret, shapes, unions, seen)}`
              : `set ${slot.prop}(${formatIrType(f.type.params[0] ?? VOID, shapes, unions, seen)})`;
          }
          return `${f.name}: ${formatIrType(f.type, shapes, unions, seen)}`;
        });
        if (shape.indexValue) {
          members.push(`[key: string]: ${formatIrType(shape.indexValue, shapes, unions, seen)}`);
        }
        if (members.length === 0) return "{}";
        return `{ ${members.join("; ")} }`;
      } finally {
        seen.delete(t.shapeId); // sibling occurrences still expand
      }
    }
    case "union": {
      const def = unions.get(t.unionId);
      if (!def) return `/* union ${t.unionId} */`;
      if (seen.has(t.unionId)) return "..."; // the recursive knot
      seen.add(t.unionId);
      try {
        return def.arms.map((a) => formatIrType(a, shapes, unions, seen)).join(" | ");
      } finally {
        seen.delete(t.unionId);
      }
    }
    case "jsval":
      return "any";
    case "regex":
      return "RegExp";
    case "url":
      return "URL";
    case "searchParams":
      return "URLSearchParams";
    case "symbol":
      return "symbol";
    case "stats":
      return "Stats";
    case "fileHandle":
      return "FileHandle";
    case "spawnRes":
      return "SpawnSyncReturns";
    case "child":
      return "ChildProcess";
    case "netServer":
      return "Server";
    case "netSocket":
      return "Socket";
    case "http2Session":
      return "Http2Session";
    case "http2Stream":
      return "Http2Stream";
    case "dgramSocket":
      return "dgram.Socket";
    case "testCtx":
      return "TestContext";
    case "httpReq":
      return "IncomingMessage";
    case "httpRes":
      return "ServerResponse";
    case "httpClientReq":
      return "ClientRequest";
    case "secureCtx":
      return "SecureContext";
    case "fsWatcher":
      return "FSWatcher";
    case "childStream":
      return "Readable";
    case "procStream":
      return "WriteStream";
    case "bigint":
      return "bigint";
    case "keyobj":
      return "KeyObject";
    case "hash":
      return "Hash";
    case "hmac":
      return "Hmac";
    case "cipher":
      return "Cipher";
    case "decipher":
      return "Decipher";
    case "abortSignal":
      return "AbortSignal";
    case "abortController":
      return "AbortController";
    case "promise":
      return `Promise<${formatIrType(t.inner, shapes, unions, seen)}>`;
    case "generator":
      return `Generator<${formatIrType(t.yieldT, shapes, unions, seen)}, ${formatIrType(t.retT, shapes, unions, seen)}, ${formatIrType(t.nextT, shapes, unions, seen)}>`;
    default: {
      const _exhaustive: never = t;
      void _exhaustive;
      throw new Error("unreachable");
    }
  }
}

/** True when the declaration sits inside `declare module "<name>"` (or
 * its node:-prefixed twin) — the disambiguator for builtin-module type
 * names that repeat across modules (net.Server vs http.Server). Both
 * @types/node and the shipped fallback declare builtins this way. */
/** ES OrdinaryOwnPropertyKeys order over string keys: canonical array
 * indices (the exact string spelling of an integer in [0, 2^32-1)) come
 * first in ascending numeric order, everything else follows in the given
 * (insertion/declaration) order. This is JS's enumeration order for the
 * objects records model — Object.keys, JSON.stringify, spread, inspect. */
export function esOwnKeyOrder(names: string[]): string[] {
  const isArrayIndex = (name: string): boolean => {
    const n = Number(name);
    return Number.isInteger(n) && n >= 0 && n < 4294967295 && String(n) === name;
  };
  const indices = names.filter(isArrayIndex).sort((a, b) => Number(a) - Number(b));
  return indices.length === 0 ? names : [...indices, ...names.filter((n) => !isArrayIndex(n))];
}

/** The runtime stream class one stdlib CLASS symbol names (`%Readable`,
 * `%Writable`, `%Duplex`, `%Transform`, `%PassThrough`) — null for
 * everything else.
 *
 * THE ONE provenance test for "this symbol is a node:stream class", used
 * by both the TYPE mapping (mapType, for values whose declared type is
 * `Readable`) and the VALUE mapping (builtinStreamInfoOf, for `new
 * Readable(...)` / `x instanceof Writable`). It used to be written twice,
 * once in each place, and the copies had to agree about declaration
 * provenance forever; streams-under-@types/node is exactly the drift that
 * bug produced. Accounted for by the "EVERY class in
 * RUNTIME_STREAM_CLASSES maps under @types/node" case in
 * tests/harness/stream-node-types.test.ts, which walks the registry so it
 * cannot go stale against a class added later.
 *
 * Both declaration sources answer: the shipped fallback declarations'
 * `declare module "stream"` classes and @types/node's same-named classes
 * (which sit in `namespace internal` inside its own `declare module
 * "stream"` — the ambient-module walk passes through the namespace).
 *
 * These no longer collide with child stdio. The fallback types
 * ChildProcess.stdout as NodeJS.ReadableStream, which is a separate
 * branch; @types/node types it as stream.Readable, which this claims, and
 * the child-stdio spoke keys off the producing syntax instead. */
export function runtimeStreamClassOf(
  decls: readonly ts.Node[],
  symbolName: string | undefined,
  isStdlibFile: (sf: ts.SourceFile) => boolean,
): string | null {
  if (symbolName === undefined) return null;
  let irName: string | null = null;
  for (const [ir, rec] of RUNTIME_STREAM_CLASSES) {
    if (rec.lib === symbolName) irName = ir;
  }
  if (irName === null) return null;
  const declared = decls.some(
    (d) =>
      ts.isClassDeclaration(d) &&
      isStdlibFile(d.getSourceFile()) &&
      isDeclaredInAmbientModule(d, "stream"),
  );
  return declared ? irName : null;
}

/** The runtime stream class node:fs's OWN two stream classes map to —
 * `fs.ReadStream` → `%Readable`, `fs.WriteStream` → `%Writable` — null
 * for everything else.
 *
 * A TYPE mapping ONLY, deliberately separate from runtimeStreamClassOf.
 * Node declares these as `class ReadStream extends stream.Readable` /
 * `class WriteStream extends stream.Writable`, and the runtime backs
 * fs.createReadStream/createWriteStream with exactly those values (native
 * _read/_write/_destroy over the shared machinery — scr_fs_read_stream),
 * so the honest static type IS the base class: every stream operation a
 * ReadStream supports is a Readable operation. The fs-only surface
 * (`path`, `bytesRead`, `close()`, the 'open'/'ready' events) is not
 * implemented and keeps fencing at its use site.
 *
 * It is NOT joined to runtimeStreamClassOf because that function also
 * drives the VALUE mapping (`new Readable(...)`, `x instanceof
 * Writable`). Answering there would make `new fs.ReadStream(path)`
 * compile as the options-object Readable constructor and `x instanceof
 * ReadStream` answer true for any Readable — a quiet wrong answer in
 * both directions. Constructing and testing fs.ReadStream keep their
 * fences.
 *
 * The ambient module must be "fs": `tty.ReadStream` (process.stdin) and
 * `NodeJS.WriteStream` (process.stdout) share the two names and are not
 * these values. */
export function fsStreamClassOf(
  decls: readonly ts.Node[],
  symbolName: string | undefined,
  isStdlibFile: (sf: ts.SourceFile) => boolean,
): string | null {
  const irName = symbolName === "ReadStream" ? "%Readable"
    : symbolName === "WriteStream" ? "%Writable"
    : null;
  if (irName === null) return null;
  const declared = decls.some(
    (d) =>
      ts.isClassDeclaration(d) &&
      isStdlibFile(d.getSourceFile()) &&
      isDeclaredInAmbientModule(d, "fs"),
  );
  return declared ? irName : null;
}

function isDeclaredInAmbientModule(d: ts.Declaration, name: string): boolean {
  let node: ts.Node | undefined = d.parent;
  while (node) {
    if (ts.isModuleDeclaration(node) && ts.isStringLiteral(node.name)) {
      const spec = node.name.text;
      return spec === name || spec === `node:${name}`;
    }
    node = node.parent;
  }
  return false;
}

/** True when the declaration's nearest enclosing namespace is `name`
 * (`declare global { namespace NodeJS { ... } }` — the NodeJS-global
 * interfaces @types/node declares outside any ambient module). */
function isDeclaredInAmbientNamespace(d: ts.Declaration, name: string): boolean {
  let node: ts.Node | undefined = d.parent;
  while (node) {
    if (ts.isModuleDeclaration(node) && ts.isIdentifier(node.name)) {
      return node.name.text === name;
    }
    node = node.parent;
  }
  return false;
}

/** True when a type contains a record anywhere (the trigger for the
 * shape-mismatch diagnostic SC2002 — non-record mismatches are tsc's or
 * the validator's business). */
export function containsRecord(t: IrType): boolean {
  switch (t.kind) {
    case "record":
      return true;
    case "array":
      return containsRecord(t.elem);
    case "func":
      return t.params.some(containsRecord) || containsRecord(t.ret);
    default:
      // Unions deliberately return false: a union-involving mismatch has its
      // own diagnostic (SC2003 via containsUnion), not the record one.
      return false;
  }
}

/** True when a type contains a union anywhere reachable without a registry
 * (the trigger for the union-mismatch diagnostic SC2003 — e.g. a value
 * narrowed to a SUB-union flowing into the full union's slot, which would
 * need a runtime re-tag). */
export function containsUnion(t: IrType): boolean {
  switch (t.kind) {
    case "union":
      return true;
    case "array":
      return containsUnion(t.elem);
    case "func":
      return t.params.some(containsUnion) || containsUnion(t.ret);
    default:
      return false;
  }
}

/** ts.Type → IrType. Returns null for anything outside the supported
 * surface; the caller (badType) classifies the shape and reports the
 * matching type fence — SC2005 generic signatures, SC2006 index
 * signatures, SC2007 overloads, SC2008 intersections, SC2009 component
 * fences, SC2020 library types, SC2001 for the remainder — with
 * checker.typeToString.
 *
 * Literal types are widened FIRST (`const x = 1` has type `1`, `true` has
 * type `true`; internally `boolean` is the union `true | false`) — mapping
 * without widening is the classic bug this function exists to centralize.
 *
 * `ctx.shapes` is the Lowerer's shape registry: object types over data
 * properties intern their canonical shape there and map to
 * `{ kind: "record", shapeId }`.
 */
/** Computes the program-wide IR name for a class declaration. Injected by
 * the Lowerer so type mapping and lowering agree on qualified names in
 * multi-file programs (two files may each declare `class Point`). */
export type ClassNamer = (decl: ts.ClassLikeDeclaration) => string;

/** Resolves a type-parameter ts.Type to a concrete IR type, or null when it
 * isn't one / isn't bound. Injected by the Lowerer while it instantiates a
 * generic function body (monomorphization): inside the body the checker
 * reports the UNSUBSTITUTED types (`T`, `T[]`, `{ v: T }`), so the
 * substitution has to happen inside mapType's recursion — carried by the
 * TypeMapperCtx exactly like ClassNamer. */
export type TypeParamResolver = (t: ts.Type) => IrType | null;

/** Resolves a type-parameter ts.Type to the CHECKER type it is bound to in
 * the current instantiation, or null. The ts-level twin of
 * TypeParamResolver, needed where the IR type has already lost information
 * mapType's widening discipline drops: `T[K]` inside a generic body resolves
 * through the BOUND checker types (K's literal names the property), which no
 * IrType binding can carry. */
export type TypeParamTsResolver = (t: ts.Type) => ts.Type | null;

/** Resolves a SYMBOLIC checker type — one written in terms of a generic's
 * own type parameters, which the checker leaves unresolved inside the body
 * — to the RESOLVED checker type the current instantiation's call site
 * already computed for it. See collectSymbolicResolutions (lower-calls.ts)
 * for how the pairing is built and why it cannot mis-pair. */
export type SymbolicResolver = (t: ts.Type) => ts.Type | null;

/** Everything mapType needs besides the type itself: the checker, the two
 * interners (owned by the Lowerer), and the Lowerer-injected hooks. Built
 * once per Lowerer and threaded through the recursion — adding a hook means
 * one new field here, not a new parameter at every call site. */
export interface TypeMapperCtx {
  checker: ts.TypeChecker;
  shapes: ShapeRegistry;
  unions: UnionRegistry;
  classNamer: ClassNamer;
  resolveTypeParam?: TypeParamResolver;
  /** The ts-level twin of resolveTypeParam (bound CHECKER types), consulted
   * only where literal identity matters — indexed accesses (`T[K]`) inside
   * generic bodies whose K is bound to a literal key. */
  resolveTypeParamTs?: TypeParamTsResolver;
  /** The instantiation's symbolic→resolved side table (SymbolicResolver):
   * a type the checker keeps SYMBOLIC inside a generic body, answered with
   * the resolved type the CALL SITE already holds for it. Consulted only
   * for types the symbolic-candidate gate admits, and only ever populated
   * with pairs whose symbolic side does not map on its own — so a refusal
   * is exactly today's answer. Inert outside call-keyed instantiation. */
  resolveSymbolic?: SymbolicResolver;
  /** Constraint-erased VALUE mapping: an indexed access whose index is a
   * UNION of literal keys answers the UNION of those property types. Set
   * only by constraintErasedCtx — a monomorphized body keeps the stricter
   * one-key rule. */
  indexUnionOk?: boolean | undefined;
  /** Inside a CONSTRAINT-erased instantiation. Marks the context, not the
   * type: once the checker resolves `Parameters<M[K]>` its origin is gone
   * from the type itself, and widening every tuple-typed rest instead
   * changed the calling convention of 30 corpus programs. */
  restTupleFromErasure?: boolean | undefined;
  /** This mapping is an ATTEMPT whose failure is discarded by the caller.
   * Refusals collected under it are not the types' own answer and must not
   * reach the memo — the caller's rollback restores registries and the
   * sensitivity counters, but a WeakMap entry survives it. */
  speculative?: boolean | undefined;
  /** GENERIC program classes (monomorphization by flow): the mapping of a
   * concrete instantiation reference (`Box<number>`) — the Lowerer
   * registers/reuses the instantiation (`Box%0`) and answers its object
   * type; null when a type argument doesn't map, the cap tripped, or the
   * family never collected. Absent in checkers with no lowering attached
   * (generic instance types stay unmapped there). */
  genericClassInstance?: (decl: ts.ClassLikeDeclaration, typeRef: ts.Type) => IrType | null;
  /** MIXIN class nodes (the class inside a mixin function): one shared
   * AST node, one instantiation per call site — the node's instance type
   * resolves to the instantiation CURRENTLY collecting/lowering (`this`
   * inside members, self-referential member types), null outside any
   * mixin context (the type alone cannot name a call site). */
  mixinClassInstance?: (decl: ts.ClassLikeDeclaration) => IrType | null;
  /** MIXIN instance INTERSECTIONS (`Tagged.C & Derived` — values built
   * through a mixin result): resolved by chain structure to the unique
   * pinned instantiation they describe; null when ambiguous or when no
   * part names a mixin class node (lower-mixins.ts). */
  mixinIntersectionInstance?: (widened: ts.Type) => IrType | null;
  /** True for the STANDARD LIBRARY's files — the shipped ambient .d.ts or a
   * lib.*.d.ts bundled with typescript (program.isSourceFileDefaultLibrary).
   * Map/RegExp/Promise recognition needs declaration provenance: the name
   * alone proves nothing (a user's own `interface Map` maps as a record). */
  isStdlibFile: (sf: ts.SourceFile) => boolean;
  /** True for an npm package's shipped .d.ts — a declaration file under
   * node_modules that is NOT the standard library (typescript's own lib
   * files live under node_modules too). Types declared there map to jsval
   * under --dynamic: the package's implementation runs in the embedded
   * engine, so its values are island handles. */
  isNpmFile: (sf: ts.SourceFile) => boolean;
  /** True for a DATA property some literal satisfies with a getter: the
   * field carries an accessor slot so both producers share one layout. */
  accessorProducerProp?: (sym: ts.Symbol) => boolean;
  /** --dynamic: `any` maps to the island handle type (jsval). Off, `any`
   * stays unmapped and the requires-dynamic diagnostic fires per site. */
  dynamic: boolean;
  /** True for files the Lowerer actually compiles (its module order). A
   * class type can reach the entry through the TYPE world alone — a jsdoc
   * `typeof import('./mod')` over a module never imported at value level
   * pulls the file into the ts.Program without ever entering the lowered
   * program, so its classes never register and an object type naming one
   * would ICE the validator. Such instance types stay unmapped (null):
   * callers fence them like any other unsupported type. */
  isProgramFile: (sf: ts.SourceFile) => boolean;
  /** True when a DECLARATION file's values come from a module this build
   * COMPILED — the `.js` beside it is in the lowered set. Resolution hands a
   * compiler the `.d.ts` (the type surface) and leaves the body behind; when
   * the body was picked up too, the declaration is a trustworthy face for
   * values that DO exist in the binary. */
  declFileHasCompiledImpl?: (sf: ts.SourceFile) => boolean;
}


/** lower-calls.ts's bodyReadsArguments, duplicated here (types.ts must not
 * import from lowering/ — that edge is a module cycle): does the function's
 * OWN body read `arguments`? Nested plain functions/methods own theirs
 * (skipped); arrows see the enclosing one (descended). */
function bodyReadsArgumentsLocal(fn: { body?: ts.Node | undefined }): boolean {
  let found = false;
  if (fn.body === undefined) return false;
  // Iterative walk (walkPreorder): function bodies can hold pathologically
  // deep expression chains that a recursive visit would die on.
  ts.walkPreorder(fn.body, (n) => {
    if (ts.isIdentifier(n) && n.text === "arguments" && !(ts.isPropertyAccessExpression(n.parent) && n.parent.name === n)) {
      found = true;
      return "stop";
    }
    if ((ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) && (n as unknown) !== fn) {
      return "skip"; // own `arguments` scope
    }
    return undefined;
  });
  return found;
}

/** A generator type's normalized value channels (Generator<T, TReturn,
 * TNext> and the IteratorResult alias share this):
 * - yield: `never` (a generator that never yields) rides the VOID
 *   sentinel; any/unknown ride dyn; undefined-only yields have no C value
 *   form (null); else the mapped type.
 * - return: void/undefined/never carry no value (VOID — the done-value is
 *   the undefined arm); any/unknown are DEFAULTS (`Generator<number>` is
 *   Generator<number, any, any>), and a defaulted return channel means
 *   "no modeled return value" — VOID, not dyn (a dyn return channel would
 *   force the yield channel dyn too; bodies that `return v` under a
 *   defaulted TReturn keep their fence at the return site).
 * - next: void/undefined/never mean valueless resumes (the undefined
 *   unit); any/unknown ride dyn; else the mapped type (`.next(v)` then
 *   requires its argument — fenced at the call site).
 * Mixed dyn/concrete value channels stay unmapped (the shared result
 * record's value slot is one representation). */
function genChannels(
  yieldTs: ts.Type | undefined,
  retTs: ts.Type | undefined,
  nextTs: ts.Type | undefined,
  ctx: TypeMapperCtx,
): { yieldT: IrType; retT: IrType; nextT: IrType } | null {
  if (!yieldTs) return null;
  const UNITISH = ts.TypeFlags.Void | ts.TypeFlags.Undefined | ts.TypeFlags.Never;
  const ANYISH = ts.TypeFlags.Any | ts.TypeFlags.Unknown;
  let yieldT: IrType | null;
  if (yieldTs.flags & ts.TypeFlags.Never) yieldT = VOID;
  else if (yieldTs.flags & ANYISH) yieldT = DYN;
  else {
    yieldT = mapType(yieldTs, ctx);
    if (yieldT?.kind === "void" || (yieldT && isUnitType(yieldT))) yieldT = null;
  }
  if (!yieldT) return null;
  const retT = retTs === undefined || retTs.flags & (UNITISH | ANYISH)
    ? VOID
    : mapType(retTs, ctx);
  if (!retT || (retT.kind !== "void" && isUnitType(retT))) return null;
  const nextT = nextTs === undefined || nextTs.flags & UNITISH
    ? UNDEFINED_T
    : nextTs.flags & ANYISH ? DYN : mapType(nextTs, ctx);
  if (!nextT || nextT.kind === "void" || nextT.kind === "nullT") return null;
  const dynMix =
    (yieldT.kind === "dyn" && retT.kind !== "dyn" && retT.kind !== "void") ||
    (retT.kind === "dyn" && yieldT.kind !== "dyn" && yieldT.kind !== "void");
  if (dynMix) return null;
  return { yieldT, retT, nextT };
}

/** SELF-REFERENTIAL types recurse through mapType with no structural floor:
 * `function somefn() { return somefn; }` maps the return type by mapping the
 * function's own type again (the 15-stack-overflow-self-return signature),
 * and `new.target` in a class-field function expression builds the same
 * loop through the containing class. Legitimate types bottom out fast —
 * anything this deep is cyclic (or pathological), and unmappable (null) is
 * the honest answer: every call site already owns a fence or checked-dyn
 * fallback for it. */
const MAP_TYPE_MAX_DEPTH = 64;
let mapTypeDepth = 0;
/** Bumped whenever mapType resolves a type through CONTEXT-SENSITIVE hooks
 * (a generic body's type parameter, a mixin instantiation) — mappings that
 * make the same ts.Type answer differently across instantiation contexts.
 * The recursive-shape machinery keys shape identity by checker type, which
 * is sound only for context-FREE mappings: a recursive frame that observes
 * a bump between entry and exit stays fenced (recursive generic-open types
 * stay fenced instead of interning a per-context-wrong shape). */
let contextResolutions = 0;

/** Context sensitivity the MEMO must see but the recursive-shape fencing must
 * not. Two answers depend on the current instantiation without contextResolutions
 * moving, and both were measured leaking wrong cache hits (a generic class
 * instantiated at two record types compiled its second instantiation against the
 * first one's fields):
 *
 *   - a type PARAMETER whose binding is absent. The bump below lives inside
 *     `if (bound)`, so "no binding yet" — collection running before the
 *     instantiation exists — records `null` as if it were context-free, and the
 *     later bound answer never displaces it.
 *   - a generic class's INSTANCE type, which genericClassInstance resolves to
 *     whichever instantiation is current (monomorphization by flow).
 *
 * Kept apart from contextResolutions on purpose: that counter also drives the
 * recursive-shape fence, where an extra bump means an extra FENCE — a new
 * blocker, not a slower cache. This one only ever costs a cache miss. */
let memoSensitivity = 0;

/** SCRIPTC_FLATTEN_WHY probe: how many union frames have spliced a nested
 * union arm in (mapTypeInner's union rule). The trace line carries the
 * running count, so the LAST line of a run is the total — read in the same
 * run as the result, because "nothing changed" and "the branch never ran"
 * are otherwise indistinguishable. */
let unionArmFlattens = 0;

/** SCRIPTC_VOIDUNION_WHY probe: how many types mapped through the
 * valueless-union rule (`void | undefined` IS the standalone void mapping).
 * Same discipline as the flatten counter — the running count rides the trace
 * line so a run can tell "nothing changed" from "the branch never ran". */
let voidUnionMappings = 0;

/** Context-FREE mapping results, keyed by checker-type identity.
 *
 * The checker is a separate process: every property read, signature query and
 * declaration walk mapType performs is a round trip. The same ts.Type is mapped
 * again at every site that mentions it, so a large dependency turns into
 * millions of redundant crossings — measured at ~29 CPU-minutes across the two
 * processes for one entry file, with neither side saturated (each waiting on
 * the other).
 *
 * Only context-FREE results are cached, and a frame qualifies only when BOTH
 * sensitivity counters stand still across it: contextResolutions (already
 * tracked for the recursive-shape fence) plus memoSensitivity (the two answers
 * above it, which move with the instantiation without moving that fence).
 * A frame neither counter moved for produced an answer depending on nothing but
 * the type, which is exactly the condition for reusing it. The registries are
 * per-run, so the cache is too.
 *
 * SCRIPTC_MEMO_AUDIT recomputes on every hit and reports answers that differ —
 * the check that found both leaks. It compares the mapped ANSWER, not the
 * type's rendering: a type parameter renders identically under every
 * instantiation, so a typeToString probe is blind to precisely this bug.
 * SCRIPTC_NO_MEMO bypasses the cache entirely, for A/B against it. */
const mapTypeMemo = new WeakMap<ts.Type, { ctx: TypeMapperCtx; result: IrType | null }>();

/** Whether a cached answer may be READ under this context.
 *
 * What the entry needs is the guarantee the store side already established:
 * the frame that produced it consulted nothing but the type, since neither
 * sensitivity counter moved across it. The RESOLVERS — the whole reason a
 * derived context exists — therefore cannot matter to it, and demanding the
 * same context OBJECT throws away every hit for no soundness gained. What
 * must still agree is what a context-free frame can nonetheless read: the
 * REGISTRIES the answer's ids point into (per run, so this is the run check
 * the identity test was really performing), and the mapping-MODE flags,
 * which gate whole rules and can decline without bumping a counter on the
 * way out.
 *
 * `speculative` is deliberately absent: it decides only whether a refusal is
 * WRITTEN, never what any answer is.
 *
 * A derived context is minted fresh at every generic-member attempt and at
 * every constraint erasure, so under the identity test those walks were
 * unmemoizable by construction — each one re-crossed the checker for the
 * whole member type graph. */
function memoUsableUnder(entry: TypeMapperCtx, ctx: TypeMapperCtx): boolean {
  return (
    entry === ctx ||
    (entry.unions === ctx.unions &&
      entry.shapes === ctx.shapes &&
      entry.checker === ctx.checker &&
      entry.dynamic === ctx.dynamic &&
      entry.indexUnionOk === ctx.indexUnionOk &&
      entry.restTupleFromErasure === ctx.restTupleFromErasure)
  );
}

export function mapType(type: ts.Type, ctx: TypeMapperCtx): IrType | null {
  if (mapTypeDepth >= MAP_TYPE_MAX_DEPTH) return null;
  const hit = process.env.SCRIPTC_NO_MEMO ? undefined : mapTypeMemo.get(type);
  // Same run, same registries, same mapping mode: see memoUsableUnder.
  if (hit !== undefined && memoUsableUnder(hit.ctx, ctx)) {
    if (process.env.SCRIPTC_MEMO_AUDIT) {
      // Recompute and compare the ANSWER, not the type's rendering: a type
      // parameter renders the same under every instantiation, so comparing
      // typeToString cannot see the unsoundness we are hunting.
      mapTypeDepth++;
      let fresh: IrType | null = null;
      try { fresh = mapTypeInner(type, ctx); } finally { mapTypeDepth--; }
      const a = hit.result ? typeKey(hit.result) : "<null>";
      const b = fresh ? typeKey(fresh) : "<null>";
      if (a !== b) {
        console.error(`MEMOBAD ${ctx.checker.typeToString(type)} cached=${a.slice(0, 70)} fresh=${b.slice(0, 70)}`);
      }
    }
    return hit.result;
  }
  mapTypeDepth++;
  const sensitivityAtEntry = contextResolutions;
  const memoSensitivityAtEntry = memoSensitivity;
  try {
    const result = mapTypeInner(type, ctx);
    if (result === null && type.isIntersectionType() && process.env["SCRIPTC_ISECT_WHY"] !== undefined) {
      isectWhy(type, ctx);
    }
    // A REFUSAL reached under a constraint-erased attempt is not the type's
    // own answer — the attempt walks places the ordinary mapping never
    // does, and caching its null hands that verdict to the legitimate
    // mapping that comes later. Successes still cache: they are the type's
    // answer either way.
    const speculativeRefusal = result === null && (ctx.restTupleFromErasure === true || ctx.speculative === true);
    if (
      !speculativeRefusal &&
      contextResolutions === sensitivityAtEntry &&
      memoSensitivity === memoSensitivityAtEntry
    ) {
      mapTypeMemo.set(type, { ctx, result });
    }
    return result;
  } finally {
    mapTypeDepth--;
  }
}

/** True when a class expression can NEVER register a lowering: one
 * enclosed by a function-like body or a class static block mints a
 * DISTINCT class per evaluation, which lowerClassExpressionInfo always
 * fences. Its instance/static types must stay UNMAPPED — an object type
 * naming a struct that will never be emitted is the invalid-C escape
 * family (every SITE using the value already carries its own fence). */
function classExprNeverRegisters(decl: ts.ClassLikeDeclaration): boolean {
  if (!ts.isClassExpression(decl)) return false;
  for (let p: ts.Node = decl.parent; !ts.isSourceFile(p); p = p.parent) {
    if (ts.isFunctionLike(p) || ts.isClassStaticBlockDeclaration(p)) return true;
  }
  return false;
}

/** The INSTANCE type of the program class an interface merely RE-TYPES, or
 * null. See the call site for the shape and why it is the class.
 *
 * Deliberately narrow, because each condition is what keeps the answer
 * sound rather than merely convenient:
 *
 *  - every declaration of the symbol is an interface (a merged VALUE would
 *    make the name mean something else too),
 *  - they agree on ONE `extends`, naming a program class by bare identifier
 *    with NO type arguments (`extends Base<T>` would need the instantiated
 *    base, not the declared one, and the interface's own type parameters
 *    could then reach the runtime shape),
 *  - the interface adds no call/construct/index signature, and
 *  - EVERY member it declares already exists on the class. A member the
 *    class does not have would be a real widening: the published type
 *    would promise something no instance carries. */
function interfaceRetypingClassInstance(
  checker: TypeMapperCtx["checker"],
  iface: ts.Type,
  sym: ts.Symbol | undefined,
  ctx: TypeMapperCtx,
): ts.Type | null {
  if (!sym) return null;
  // SCRIPTC_RETYPE_TRACE: one line per refusal, naming the condition. The
  // shape has many ways to not-quite-match and the diagnostic only says
  // "record", so the reason has to be observable.
  const trace = process.env["SCRIPTC_RETYPE_TRACE"] ? (why: string) => {
    process.stderr.write(`RETYPE ${checker.typeToString(iface)}: ${why}\n`);
    return null;
  } : () => null;
  if (process.env["SCRIPTC_RETYPE_TRACE"]) process.stderr.write(`RETYPE-IN ${checker.typeToString(iface)}\n`);
  const decls = checker.declarationsOf(sym);
  // A CLASS merged under the name means the type already IS a class type —
  // the ordinary class path below owns that, and must not be pre-empted.
  if (decls.some((d) => ts.isClassDeclaration(d) || ts.isClassExpression(d))) return trace("merged class");
  // The published shape merges the interface with the `const C = Impl as
  // unknown as CCtor` VALUE declaration. Only the interface declarations
  // matter here: in TYPE position the name always means the interface (a
  // const contributes a type only through `typeof`), so the value side
  // cannot change what this type maps to.
  const ifaces = decls.filter((d) => ts.isInterfaceDeclaration(d));
  if (ifaces.length === 0) return trace("no interface declaration");

  let baseSym: ts.Symbol | undefined;
  for (const d of ifaces) {
    const clauses = d.heritageClauses ?? [];
    if (clauses.length !== 1) return trace(`heritage clauses = ${clauses.length}`);
    const clause = clauses[0]!;
    if (clause.token !== ts.SyntaxKind.ExtendsKeyword || clause.types.length !== 1) return trace("not a single extends");
    const ref = clause.types[0]!;
    if (ref.typeArguments !== undefined) return trace("base has type arguments");
    if (!ts.isIdentifier(ref.expression)) return trace("base is not a bare identifier");
    const s = checker.getSymbolAtLocation(ref.expression);
    if (!s) return trace("base identifier has no symbol");
    if (baseSym !== undefined && baseSym !== s) return trace("declarations disagree on base");
    baseSym = s;
  }
  if (baseSym === undefined) return trace("no base symbol");

  const baseDecl = checker.valueDeclarationOf(baseSym);
  if (
    baseDecl === undefined ||
    !(ts.isClassDeclaration(baseDecl) || ts.isClassExpression(baseDecl)) ||
    baseDecl.getSourceFile().isDeclarationFile ||
    !ctx.isProgramFile(baseDecl.getSourceFile())
  ) {
    return null;
  }

  const baseInstance = checker.getDeclaredTypeOfSymbol(baseSym);
  // Compared on the TYPE side rather than by walking declaration members:
  // the instantiated interface is what is being mapped, and inherited
  // members trivially pass (they came from the class), so anything the
  // check rejects is genuinely ADDED.
  // Both sides enumerated the SAME way, and compared as name sets. A
  // by-name getPropertyOfType lookup would work for ordinary members and
  // silently fail for SYMBOL-keyed ones (they enumerate under a mangled
  // `__@sym@id` name that no lookup resolves), so a class inheriting one —
  // every EventEmitter subclass inherits captureRejectionSymbol — would
  // look like it were being widened by an interface that adds nothing.
  const baseNames = new Set(checker.getPropertiesOfType(baseInstance).map((p) => p.name));
  for (const p of checker.getPropertiesOfType(iface)) {
    if (!baseNames.has(p.name)) return trace(`added member ${p.name}`);
  }
  if (checker.getCallSignatures(iface).length > checker.getCallSignatures(baseInstance).length) return null;
  if (checker.getConstructSignatures(iface).length > checker.getConstructSignatures(baseInstance).length) {
    return null;
  }
  if (checker.getIndexInfosOfType(iface).length > checker.getIndexInfosOfType(baseInstance).length) return null;
  if (process.env["SCRIPTC_RETYPE_TRACE"]) {
    process.stderr.write(`RETYPE-OK ${checker.typeToString(iface)} -> ${checker.typeToString(baseInstance)}\n`);
  }
  return baseInstance;
}

function mapTypeInner(type: ts.Type, ctx: TypeMapperCtx): IrType | null {
  if (process.env["SCRIPTC_INNER_WHY"] !== undefined && ctx.checker.typeToString(type).includes("keyof EvMap")) {
    console.error(`[innerwhy] enter: ${ctx.checker.typeToString(type).slice(0, 90)}`);
  }
  const { checker, unions, classNamer, resolveTypeParam } = ctx;
  if (resolveTypeParam && type.flags & ts.TypeFlags.TypeParameter) {
    const bound = resolveTypeParam(type);
    // Consulting the bindings is itself context-dependent, bound or not.
    memoSensitivity++;
    if (bound) {
      contextResolutions++;
      return bound;
    }
  }
  // Narrowed type parameters: `!== undefined` / `!== null` / truthiness on
  // a `T | undefined`-flavored value inside a generic body leaves the
  // SYMBOLIC forms `T & {}`, `T & ({} | null)`, `(T & {}) | (T & null)`
  // (concrete types compute the intersection away; only generic bodies see
  // them). Each companion is an ALLOWANCE over the binding's arms — `{}`
  // admits every non-unit arm, a null/undefined companion its unit — and
  // the mapping is the binding filtered to what the narrowing kept.
  if (resolveTypeParam) {
    const viaNarrowedParam = mapNarrowedTypeParam(type, ctx);
    if (viaNarrowedParam !== undefined) {
      contextResolutions++;
      return viaNarrowedParam;
    }
    // `Awaited<T>` over a bound type parameter (an async generic body's
    // `await fn()` result): a CONDITIONAL type the checker keeps symbolic
    // inside the body — the object-gated utility-alias hook below never
    // sees it, so it resolves here, before the flag dispatch.
    const viaAwaited = mapGenericAwaitedAlias(type, ctx);
    if (viaAwaited !== null) {
      contextResolutions++;
      return viaAwaited;
    }
    // `T[K]` over a bound parameter: like Awaited, a form the checker
    // keeps symbolic inside the body. Two resolvers, tried in order: the
    // structural read against the record binding, then the bound-checker
    // route for a K naming one concrete key (mapBoundIndexedAccess).
    const viaIndexed = mapGenericIndexedAccess(type, ctx) ?? mapBoundIndexedAccess(type, ctx);
    if (viaIndexed !== null) {
      contextResolutions++;
      return viaIndexed;
    }
    // `Parameters<M[K]>` over a bound K — the emitter idiom's rest. Also a
    // form the checker keeps symbolic, and answered HERE rather than at
    // each place that meets it: the signature walk, the instance's
    // parameter list and the body's own typing of the identifier all ask
    // mapType, so one answer serves all three. The rest stays an ARRAY
    // (the body indexes it); only the element widens, to the union of
    // every position's type across the named handlers.
    // Behind the SAME switch as the slot: these only exist to serve it,
    // and left always-on they fire inside ordinary generic bodies (the
    // corpus caught 30 programs changing behaviour that way).
    const viaParamsAlias = mapRestTupleUnion(type, ctx) ?? mapParametersAliasOverBoundKey(type, ctx);
    if (viaParamsAlias !== null) {
      contextResolutions++;
      return viaParamsAlias;
    }
  }
  // The instantiation's symbolic→resolved side table. LAST of the
  // context-sensitive hooks on purpose: it only ever holds pairs whose
  // symbolic side mapped to null at collection time, so every rule above
  // that could answer already has, and a refusal here leaves today's
  // diagnostic exactly where it was.
  {
    const viaSideTable = mapResolvedSymbolic(type, ctx);
    if (viaSideTable !== null) {
      contextResolutions++;
      return viaSideTable;
    }
  }
  const widened = checker.getBaseTypeOfLiteralType(type);
  const flags = widened.flags;

  if (flags & ts.TypeFlags.Number) return F64;
  if (flags & ts.TypeFlags.String) return STRING;
  if (flags & ts.TypeFlags.Boolean || flags & ts.TypeFlags.BooleanLiteral) return BOOL;
  // The lib's BOXED wrapper interfaces used as TYPES (`const n: Number =
  // 5`): every value such a slot can hold IS the primitive — `new
  // Number(...)` construction is fenced, so no box object ever exists —
  // and the interface members are exactly the primitive's lowered surface.
  // Provenance-gated: a user's own `interface Number` maps as a record.
  {
    const boxSym = widened.getSymbol();
    if (
      boxSym &&
      (boxSym.name === "Number" || boxSym.name === "String" || boxSym.name === "Boolean") &&
      checker.declarationsOf(boxSym).some((d) => ctx.isStdlibFile(d.getSourceFile()))
    ) {
      return boxSym.name === "Number" ? F64 : boxSym.name === "String" ? STRING : BOOL;
    }
  }
  // The lib's PRIMITIVE-CONSTRUCTOR interfaces as TYPES (`typeof String`,
  // a `type: StringConstructor` record field — the CLI option-table
  // idiom): the VALUE is the interned coercion closure (lower-exprs mints
  // one per program), so the type maps to that closure's one concrete
  // signature — the string-coercion form `(value: string) => primitive`.
  // String(s) is identity on strings, Number(s) the ECMA StringToNumber,
  // Boolean(s) emptiness — the parsed-token shape every stored-constructor
  // call feeds. Calls passing other argument types fence at their site
  // (the func param coercion), exactly like any other typed closure slot.
  // Provenance-gated like the boxed wrappers above: a user's own
  // `interface StringConstructor` maps as a record.
  {
    const ctorSym = widened.getSymbol();
    if (
      ctorSym &&
      (ctorSym.name === "StringConstructor" ||
        ctorSym.name === "NumberConstructor" ||
        ctorSym.name === "BooleanConstructor") &&
      checker.declarationsOf(ctorSym).some((d) => ctx.isStdlibFile(d.getSourceFile()))
    ) {
      return funcOf(
        [STRING],
        ctorSym.name === "StringConstructor" ? STRING : ctorSym.name === "NumberConstructor" ? F64 : BOOL,
      );
    }
  }
  // `symbol` and `unique symbol` (the type of `const k = Symbol(...)` —
  // getBaseTypeOfLiteralType widens unique symbols, but check both flags)
  // map to the symbol identity kind.
  if (flags & (ts.TypeFlags.ESSymbol | ts.TypeFlags.UniqueESSymbol)) return SYMBOL_T;
  // STANDALONE undefined (and void) map to VOID: return-type mapping flows
  // through here, and `(): void | undefined` functions must stay void.
  // Inside a union, undefined becomes the undefinedT unit ARM instead (see
  // the union branch below). VALUE positions that today receive VOID
  // (record fields, tuple/array elements, variable slots) substitute the
  // unit-only union themselves (isUnitOnlyTsType + unitOnlyUnion) — the
  // position knows it wants a value; this mapping cannot.
  if (flags & (ts.TypeFlags.Void | ts.TypeFlags.Undefined)) return VOID;
  // THE SAME STANDALONE RULE, SPELLED AS A UNION. `void | undefined` is not
  // a choice between two values — both parts are inhabited by exactly
  // `undefined`, so the type carries no value at all and IS the standalone
  // mapping above. The checker hands it out wherever a valueless callback
  // meets a valueless promise: `Promise<void>.catch(() => undefined)` binds
  // TResult = undefined and yields `Promise<void | undefined>`, which the
  // union branch below cannot represent (both parts fold to the undefinedT
  // arm, and a lone unit arm has no union representation — it fenced).
  // `never` parts come along because they are uninhabited: `T | never ≡ T`,
  // the same elision the union branch performs.
  // NULL is deliberately NOT here: `null` and `undefined` are DISTINGUISHABLE
  // values with separate tags, so `null | undefined` is a real two-arm union
  // and keeps its existing home.
  if (
    widened.isUnionType() &&
    widened.getTypes().some((p) => p.flags & (ts.TypeFlags.Void | ts.TypeFlags.Undefined)) &&
    widened
      .getTypes()
      .every((p) => p.flags & (ts.TypeFlags.Void | ts.TypeFlags.Undefined | ts.TypeFlags.Never))
  ) {
    voidUnionMappings++;
    if (process.env["SCRIPTC_VOIDUNION_WHY"] !== undefined) {
      console.error(
        `[voidunionwhy] #${voidUnionMappings} ${checker.typeToString(widened).slice(0, 70)}`,
      );
    }
    return VOID;
  }
  // Standalone `null` (a `const x = null` binding, a `{ value: null }`
  // field, a `(): null` return): the unit-only union — the value is always
  // THE interned null instance, comparisons are tag tests, JSON serializes
  // null. Inside a union, null keeps becoming the nullT ARM (the union
  // branch below never recurses here for null parts).
  if (flags & ts.TypeFlags.Null) return unitOnlyUnion(unions);
  // `never` VALUES are uninhabited — the checker only types dead reads
  // this way (`for (const v of [])`'s loop var, the empty literal's
  // `never[]` element) — so any representation is unobservable; f64 is the
  // cheapest slot. Return positions never reach here (declaredReturnType
  // and the signature branches map never returns to VOID first), and
  // construction sites cannot exist (nothing has type never to feed them).
  if (flags & ts.TypeFlags.Never) return F64;
  // `unknown` is a VALUE with a runtime representation (the dyn JSON dyn —
  // JSON.parse results and unknown-typed locals/params/returns).
  // `bigint` and bigint LITERAL types: one compiled kind (ScrBigInt), never
  // interchangeable with f64 — JS itself refuses to mix them in arithmetic,
  // so no implicit conversion can be right.
  if (flags & ts.TypeFlags.BigIntLike) return BIGINT;
  if (flags & ts.TypeFlags.Unknown) return DYN;
  // `object` (the NonPrimitive intrinsic) is a TOP type over non-primitive
  // values — tsc admits every record, array, function, or class instance
  // into an `object` slot, so no exact record shape can hold it. It lowers
  // like `unknown` (the dyn): assignments convert at the site (sources
  // outside the checked-dynamic tree fence there, same as unknown), reads narrow back out
  // through the same checked casts. Member accesses tsc allows on `object`
  // (the Object.prototype surface) fence at their use sites.
  if (flags & ts.TypeFlags.NonPrimitive) return DYN;
  // `any` is the island handle type under --dynamic (the type-hole becomes
  // dynamically-executed code); without the flag it stays unmapped and the
  // per-site diagnostic tells the user about --dynamic and the static
  // alternative (`unknown` + a checked cast).
  if (flags & ts.TypeFlags.Any) return ctx.dynamic ? JSVAL : null;
  // Enum types and enum member literal types: an enum VALUE at runtime IS
  // its underlying primitive (tsc's own emit stores plain numbers/strings
  // on the enum object; const enums inline them), so the enum type maps to
  // number/string — comparisons, switch dispatch, arithmetic, and template
  // formatting all take their ordinary primitive lowerings. A member
  // literal type (`E.A` in type position) widens to the whole enum first
  // (getBaseTypeOfLiteralType), so both spellings land here. Heterogeneous
  // enums map to the number|string union (each member READ produces one
  // exact arm; the slot re-tags like any literal-into-union assignment).
  // A union MIXING enum literals with non-enum arms (`E | undefined`)
  // falls through to the general union branch below, whose per-part
  // recursion re-enters here with the pure enum parts.
  if (flags & ts.TypeFlags.EnumLike) {
    const parts = widened.isUnionType() ? widened.getTypes() : [widened];
    if (parts.every((p) => p.flags & ts.TypeFlags.EnumLike)) {
      let hasNum = false;
      let hasStr = false;
      for (const p of parts) {
        if (p.flags & ts.TypeFlags.StringLiteral) hasStr = true;
        // NumberLiteral members, and the non-literal `Enum` flavor (an
        // enum with computed members is a NUMERIC enum type — string
        // members would make it a literal enum by definition).
        else hasNum = true;
      }
      if (hasNum && hasStr) {
        const arms = [F64, STRING];
        arms.sort((a, b) => (typeKey(a) < typeKey(b) ? -1 : 1));
        return { kind: "union", unionId: unions.intern(arms) };
      }
      return hasStr ? STRING : F64;
    }
  }
  // Types DECLARED by a shipped .d.ts — an npm package's, or a LOCAL
  // declaration file describing sibling JS the program loads dynamically
  // (an Emscripten factory's .d.mts): the .d.ts is trusted as the type
  // surface, but the values behind it live in the embedded engine — under
  // --dynamic they are island handles (jsval), and every operation on them
  // rides the engine ops with validated exits at typed boundaries.
  // Primitives/arrays/etc. REACHED THROUGH such types keep their
  // structural mapping (they were handled above or recurse normally); this
  // rule fires only when the type's own identity is declaration-file-
  // declared — interfaces, classes, type literals, and aliases from the
  // .d.ts. The standard library's declaration files are carved out (their
  // surfaces have static lowerings), and the program's own compiled
  // modules are never declaration files. Without --dynamic it stays
  // unmapped; badType reports the per-package requires-dynamic diagnostic
  // for node_modules types and the generic story otherwise.
  const npmSym = widened.getAliasSymbol() ?? widened.getSymbol();
  const npmDecls = npmSym ? checker.declarationsOf(npmSym) : undefined;
  if (
    npmDecls &&
    npmDecls.length > 0 &&
    npmDecls.every((d) => {
      const sf = d.getSourceFile();
      return (
        sf.isDeclarationFile &&
        !ctx.isStdlibFile(sf) &&
        // ... unless its implementation twin was compiled into this build.
        !(ctx.declFileHasCompiledImpl?.(sf) ?? false)
      );
    })
  ) {
    // A PURE-DATA interface/type-literal from the .d.ts is the EXCEPTION:
    // the values behind an ordinary declaration-file type live in the
    // engine, BUT a data-only shape (a protobuf message — `interface
    // IADVSignedDeviceIdentity extends $Properties` whose members are all
    // Uint8Array/number/nested-data, no methods) is one the PROGRAM builds
    // from its own decoded bytes, and the only way to get a value FROM the
    // uncompiled module — a value read / method call like
    // `proto.X.decode(...)` — fences at its own value-import gate. So the
    // STRUCTURAL shape maps (falling through to the record path below);
    // only the module's VALUES are refused, exactly where they cross. A
    // method-bearing type (an engine object's surface) keeps the fence:
    // a call signature needs a body the .d.ts lacks. Classes keep their
    // nominal fence too — only interfaces/type-literals fall through.
    // STATIC builds only: the soundness rests on the value-import gate
    // fencing every value that would cross FROM the uncompiled module
    // (`proto.X.decode(...)` → SC1090). Under --dynamic that import does
    // NOT fence — it becomes a jsval island handle — so a data-only shape
    // must stay JSVAL there too, or a program-built record and an
    // island-imported handle would disagree on representation.
    const dataInterface =
      !ctx.dynamic &&
      npmDecls.every(
        (d) => ts.isInterfaceDeclaration(d) || ts.isTypeLiteralNode(d) || ts.isTypeAliasDeclaration(d),
      ) &&
      isDataOnlyObjectType(widened, checker);
    if (!dataInterface) return ctx.dynamic ? JSVAL : null;
  }
  // NOTE on module NAMESPACE types (`typeof import("./x.mjs")` — what a
  // dynamic import resolves to): non-stdlib ones fall under the rule
  // above (their declarations are the .d.ts SourceFiles themselves).
  // Stdlib `declare module` namespaces ("fs", "path") deliberately stay
  // unmapped: their members have STATIC lowerings keyed off import
  // bindings (builtinImportOf), and a handle mapping would reroute
  // `import * as path` member calls into the engine — dynamic imports of
  // builtins get their handles from the import lowering's IR type
  // instead.
  // T[]: monomorphic arrays, recursively (number[][] works). An element type
  // that doesn't map (never from a context-free `[]`) makes the whole array
  // unsupported — null propagates. Record/object/union elements ride the
  // runtime's REF element kind (per-array RC entry points, the map-value
  // technique), and PROMISE elements ride it too (Promise<T>[] is
  // Promise.all's food: promises are refcounted, cycle-headered values
  // with `_v` adapters like any other ref element — they just never
  // JSON-serialize or cross the island boundary, which the safety
  // predicates already refuse). FUNCTION elements ride REF too (closure
  // `_v` adapters + scr_closure_trace_v — closures are cycle-headered):
  // `f === f` identity through indexOf/includes is sound because a
  // function VALUE is one ScrClosure for its whole life — top-level
  // declarations intern one immortal closure, and inner closures are
  // allocated once at their definition's evaluation and flow by
  // reference, exactly JS's function identity. map/set/regex/url/dyn and
  // the other opaque handles stay unsupported.
  if (checker.isArrayType(widened)) {
    const elemTs = checker.getTypeArguments(widened as ts.TypeReference)[0];
    if (!elemTs) return null;
    let elem = mapType(elemTs, ctx);
    // `undefined[]` (sparse literals — `[,]` — and explicit annotations):
    // the element rides the unit-only union like a record field would; the
    // VOID mapping is a return-position artifact, not a value.
    if (elem?.kind === "void" && isUnitOnlyTsType(elemTs)) elem = unitOnlyUnion(unions);
    // A jsval element ABSORBS the array — with one carve-out. An array
    // type entangled with package-declared ('npm-jsval') elements
    // (`GeneratedFile[]`, `ModelMessage[]`) describes ISLAND values: the
    // handles those APIs produce are engine arrays, never the static
    // ScrArr this mapping would otherwise claim, so the whole array is
    // one handle and every operation on it is an engine op. The carve-out
    // is literal `any[]`: an EXPLICIT static array of dynamic values —
    // the messages-building pattern (`const content: any[] = []`) — which
    // keeps its static array-of-handles representation.
    if (elem?.kind === "jsval" && !(elemTs.flags & ts.TypeFlags.Any)) return JSVAL;
    // RegExp elements ride REF (scr_regex_retain_v/release_v, no trace —
    // a regex holds only its bytecode and source): the derived-pattern
    // idiom `[bases].map(ps => new RegExp(...))` builds real regex
    // arrays, elements flow into the regex intrinsics unchanged, and
    // indexOf/includes/=== are the REF kind's pointer identity — exactly
    // JS object identity for RegExp values.
    if (
      !elem ||
      elem.kind === "void" ||
    // Map/Set elements ride REF like every other refcounted element
    // (scr_map_retain_v/release_v — the SAME adapters a Map VALUE and an
    // index-signature overflow value already use, and ScrArr stores every
    // non-scalar element as a ref). The trace fixpoint that propagates an
    // inner container's cycle capability is the one the nested-container
    // Map value rides; an array holding them is the identical storage
    // under a different spelling — the argument isSupportedMapValue makes
    // for `Map<string, Set<T>>`, one container out.
      elem.kind === "url" ||
      elem.kind === "searchParams" ||
      elem.kind === "stats" ||
      elem.kind === "fileHandle" ||
      elem.kind === "spawnRes" ||
      elem.kind === "netSocket" ||
      elem.kind === "dgramSocket" ||
      elem.kind === "testCtx" ||
      elem.kind === "httpReq" ||
      elem.kind === "httpRes" ||
      elem.kind === "httpClientReq" ||
      elem.kind === "secureCtx" ||
      elem.kind === "fsWatcher" ||
      elem.kind === "childStream" ||
      elem.kind === "procStream" ||
      elem.kind === "generator"
    ) {
      return null; // ScrArr has no closure/map/regex/url element kinds yet
    }
    // A dyn ELEMENT makes the WHOLE array the checked-dynamic value:
    // `unknown[]`, `object[]`, and the collapsed `(string | object)[]`
    // (the plugins-slot shape) — the checked-dynamic tree has real arrays, so length/
    // index/push/iteration ride the keyed-dyn paths, while a dyn-element
    // STATIC array has no backend representation (ScrArr has no dyn
    // element kind). This is dynFallbackType's JS stance promoted into
    // the mapping itself; construction sites build dynArrLit (the checked-dynamic tree
    // array literal) and typed sources convert per element at the slot.
    if (elem.kind === "dyn") return DYN;
    // ChildProcess[] (the running-apps list) and Server[] (the [...set]
    // drain of the auxiliary-server registries): handles are ordinary
    // refcounted REF elements (their `_v` adapters, no trace — both drop
    // their closures at their terminal event).
    if (process.env["SCRIPTC_ORDER_WHY"] !== undefined && elem.kind === "union") {
      const arms = unions.get(elem.unionId)?.arms ?? [];
      if (arms.length >= 2 && arms.every((a) => a.kind === "record")) {
        console.error(
          `ORDER arr ${checker.typeToString(widened).slice(0, 80)} -> ${typeKey(arrayOf(elem)).slice(0, 100)}` +
          ` rest=${String(ctx.restTupleFromErasure)} idxU=${String(ctx.indexUnionOk)}`,
        );
      }
    }
    return arrayOf(elem);
  }
  // Tuples: `[string, string]` maps to an interned RECORD shape flagged
  // `tuple`, with one field per position named by its index ("0", "1", ...)
  // — fixed shape, literal-index access, length = the arity constant
  // (SEMANTICS.md). The flag keeps tuple shapes distinct from numeric-keyed
  // object records (JSON must serialize a tuple as an ARRAY) and is why
  // interning happens through the tuple-aware path. Optional/rest elements
  // have no fixed shape and stay unmapped; element types follow record-field
  // rules (no void/dyn).
  if (checker.isTupleType(widened)) {
    const ref = widened as ts.TupleTypeReference;
    // elementFlags live on the tuple SHAPE: a direct tuple type carries
    // them itself; a REFERENCE to one (isTupleType still answers true —
    // the facade's 5.9.3 contract) reads them off its target.
    const tupleShape = (ref.elementFlags as ts.ElementFlags[] | undefined) !== undefined
      ? ref
      : (ref.getTarget() as ts.TupleType | undefined);
    // The empty tuple `[]` — a declared annotation, or the facade edge
    // where isTupleType answers true with NO element flags on the shape or
    // its target (the empty-array arm of `''.match(/x/) || []`; the
    // declared `[]` reads the same way, 0 type arguments and no flags). A
    // zero-field tuple SHAPE would violate the IR's tuple invariant
    // (positional fields "0".."n-1", n >= 1), but the type needs no shape
    // at all — its only inhabitant is the empty array. It rides the ARRAY
    // representation over the unit-only element (the `undefined[]` rule):
    // length reads the runtime 0 and no element is ever written (push
    // takes `never`; indexed reads are out of range for tsc). Element-
    // FACING surfaces (JSON.stringify, spread, for-of) keep their
    // unit-element fences: no element exists, but the type-directed checks
    // see the unit arm.
    const args = checker.getTypeArguments(ref);
    if (args.length === 0) return arrayOf(unitOnlyUnion(unions));
    if (tupleShape?.elementFlags === undefined) return null;
    // Optional/rest elements (`[string?, number?]`, `[string, ...number[]]`)
    // have no fixed shape — the ARITY is a runtime fact. Under --dynamic
    // the value lives in the engine, a real JS array carrying its true
    // length (reads, destructuring, JSON, .length all exact); static
    // builds stay unmapped and badType tells the dynamic-tier story.
    if (tupleShape.elementFlags.some((f) => !(f & ts.ElementFlags.Required))) {
      return ctx.dynamic ? JSVAL : null;
    }
    // A UNIFORM readonly tuple — every position the SAME mapped element
    // type, the `as const` const-table idiom (SINGLE_BYTE_TOKENS, the
    // ~600-string binary token dictionaries) — rides the ARRAY
    // representation rather than a fixed positional record. A runtime index
    // (`TOKENS[i]` in a loop), `.length`, and a same-type function parameter
    // (`dicts.map(d => …)`, where `d` is one dictionary) all want an array;
    // literal-index reads and destructuring work over an array too. tsc's
    // `readonly` marks the idiom, and the array aliases as the one `as const`
    // object does in JS. Mixed-type tuples keep the positional record below.
    const roA = (tupleShape as { readonly?: boolean }).readonly === true;
    const roB = ((ref.getTarget?.() as { readonly?: boolean } | undefined)?.readonly) === true;
    if ((roA || roB) && args.length > 0) {
      const elem0 = mapType(args[0]!, ctx);
      if (
        elem0 !== null && elem0.kind !== "void" && elem0.kind !== "jsval" && elem0.kind !== "dyn" &&
        args.every((a) => {
          const e = mapType(a, ctx);
          return e !== null && typeEquals(e, elem0);
        })
      ) {
        return arrayOf(elem0);
      }
    }
    const fields: { name: string; type: IrType }[] = [];
    for (let i = 0; i < args.length; i++) {
      let et = mapType(args[i]!, ctx);
      // A unit-only element (`[number, undefined]`) rides the unit-only
      // union, the record-field rule.
      if (et?.kind === "void" && isUnitOnlyTsType(args[i]!)) et = unitOnlyUnion(unions);
      // dyn ELEMENTS map now — `[string, unknown]`, the Object.entries
      // tuple over an `unknown`-valued index signature (the pricing-table
      // normalizer shape): the slot has the overflow map's RC/JSON/dyn
      // plumbing, values arrive dyn or convert via dynFrom.
      if (!et || et.kind === "void") return null;
      // A jsval MEMBER absorbs the tuple (bare jsval fields have no shape
      // slot — the record-field rule), exactly like record fields below.
      if (et.kind === "jsval") return JSVAL;
      fields.push({ name: String(i), type: et });
    }
    fields.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const tupleId = ctx.shapes.intern(fields, true);
    if (process.env["SCRIPTC_ORDER_WHY"] !== undefined && fields.length >= 2) {
      console.error(
        `ORDER tup ${checker.typeToString(widened).slice(0, 80)} -> #${tupleId}` +
        ` rest=${String(ctx.restTupleFromErasure)} idxU=${String(ctx.indexUnionOk)}`,
      );
    }
    return { kind: "record", shapeId: tupleId };
  }
  // Class instances: the type's symbol is a class declared in the user's
  // file. The class NAME as a value has the *constructor* type — same
  // REFINED handle intersections — @types/node's idioms: `ServerResponse<
  // IncomingMessage> & { req: IncomingMessage }` (RequestListener's
  // inferred res param — every unannotated http.createServer handler) and
  // the cast shape `Socket & { encrypted?: boolean }`. The VALUE is the
  // handle; the refinement's extra members are type-level decoration whose
  // uses fence per site (they are not stdlib members). Exactly one
  // constituent must map to an opaque builtin-handle kind; every other
  // part must be a plain object refinement — no call/construct signatures,
  // no class identity of its own.
  if (widened.isIntersectionType()) {
    // `string & {}` — the literal-union-with-autocomplete idiom
    // (`'NONE' | 'CAPPED' | (string & {})`, written so editors still
    // suggest the named members while any string is accepted). The empty
    // object type only removes null/undefined, which the primitive
    // already excludes, so the intersection IS the primitive: no runtime
    // distinction exists to model. Deliberately narrow -- every non-
    // primitive part must be EMPTY, so a branded `string & { tag: 'x' }`
    // keeps whatever the rules below decide for it.
    {
      const parts = widened.getTypes();
      const PRIM =
        ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike |
        ts.TypeFlags.BooleanLike | ts.TypeFlags.BigIntLike;
      const prims = parts.filter((p) => (p.flags & PRIM) !== 0);
      const emptyShape = (t: ts.Type): boolean =>
        (t.flags & ts.TypeFlags.Object) !== 0 &&
        checker.getPropertiesOfType(t).length === 0 &&
        checker.getCallSignatures(t).length === 0 &&
        checker.getConstructSignatures(t).length === 0 &&
        checker.getIndexInfosOfType(t).length === 0;
      if (prims.length === 1 && parts.every((p) => p === prims[0] || emptyShape(p))) {
        return mapType(prims[0]!, ctx);
      }
    }
    const HANDLE_KINDS = new Set([
      "netServer", "netSocket", "httpReq", "httpRes", "httpClientReq", "dgramSocket",
      // process.stdout's own type IS the refined intersection
      // `WriteStream & { fd: 1 }` — the scalar stream kind rides the same
      // refinement rule.
      "procStream",
    ]);
    let handle: IrType | null = null;
    let refined = true;
    for (const part of widened.getTypes()) {
      const mapped = mapType(part, ctx);
      if (mapped && HANDLE_KINDS.has(mapped.kind)) {
        if (handle !== null && handle.kind !== mapped.kind) {
          refined = false;
          break;
        }
        handle = mapped;
        continue;
      }
      const partSym = part.getSymbol();
      if (
        (part.flags & ts.TypeFlags.Object) === 0 ||
        checker.getCallSignatures(part).length > 0 ||
        checker.getConstructSignatures(part).length > 0 ||
        (partSym !== undefined && (partSym.flags & ts.SymbolFlags.Class) !== 0)
      ) {
        refined = false;
        break;
      }
    }
    if (refined && handle !== null) return handle;
    // THE WEBSOCKET GLOBAL's cast intersection. A program with no lib.dom
    // reaches the global the only way it can:
    //
    //   (globalThis as typeof globalThis & { WebSocket?: Ctor }).WebSocket
    //
    // and with @types/node adopted `typeof globalThis` ALREADY declares
    // WebSocket, so the property's type is `typeof WebSocket & Ctor` —
    // undici's class object (prototype, the four readyState statics, a
    // construct signature over its own interface: nothing that maps)
    // intersected with the shape the cast was written to assert. The
    // VALUE is one object and exactly one constituent describes it in
    // terms this compiler can build, which is the same reasoning as the
    // handle refinement above, one level up.
    //
    // Deliberately keyed on wsGlobalPlan and nothing weaker: the rule
    // fires only for a construct signature over the full WebSocket API
    // record, and only when every OTHER constituent is unmappable — so
    // it can never DISCARD a representable half. Members the discarded
    // parts contribute keep fencing at their own sites.
    {
      const parts = widened.getTypes();
      const mappedParts = parts.map((p) => mapType(p, ctx));
      const wsParts = mappedParts.filter(
        (m) =>
          m !== null &&
          m.kind === "func" &&
          wsGlobalPlan(m, (id) => ctx.shapes.get(id), (id) => ctx.unions.get(id)) !== null,
      );
      if (wsParts.length === 1 && mappedParts.every((m) => m === null || m === wsParts[0])) {
        return wsParts[0]!;
      }
    }
    // MIXIN instance intersections (`Tagged.C & Derived` — values built
    // through a mixin result): the chain structure names the unique
    // pinned instantiation; ambiguity stays unmapped (the hook's rules).
    {
      const viaMixin = ctx.mixinIntersectionInstance?.(widened);
      if (viaMixin) {
        contextResolutions++;
        return viaMixin;
      }
    }
    // A PRIMITIVE intersected with an object that has real members, and
    // nothing above claimed it: `number & { low: number; high: number;
    // unsigned: boolean }` -- how protobuf typings spell "a number, or the
    // Long object this becomes past 2^53". The value really is one or the
    // other at runtime, so the checked-dynamic tree is what represents it:
    // members read through the dyn, arithmetic exits through a dynCheck,
    // and a lying value throws instead of being misread.
    //
    // Mapping it to the PRIMITIVE instead would be simpler and wrong -- a
    // Long object read as an f64 is garbage, silently. Last resort on
    // purpose: the empty-object refinement above still answers first, so a
    // branded `string & { tag }` keeps whatever the rules there decide.
    {
      const parts = widened.getTypes();
      const PRIM2 =
        ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike |
        ts.TypeFlags.BooleanLike | ts.TypeFlags.BigIntLike;
      const prims = parts.filter((p) => (p.flags & PRIM2) !== 0);
      const objs = parts.filter((p) => (p.flags & ts.TypeFlags.Object) !== 0);
      if (
        prims.length === 1 &&
        objs.length === parts.length - 1 &&
        objs.length > 0 &&
        objs.every(
          (o) =>
            checker.getPropertiesOfType(o).length > 0 &&
            checker.getCallSignatures(o).length === 0 &&
            checker.getConstructSignatures(o).length === 0,
        )
      ) {
        return DYN;
      }
    }
  }
  // symbol, but with construct signatures — that is the STATIC side, and
  // it maps to classval below.
  const widenedSym = widened.getSymbol();
  // An interface that EXTENDS a program class and whose OWN members all
  // SHADOW members the class already declares is a pure RE-TYPING of it:
  // nothing new exists at runtime, so an instance of that interface IS an
  // instance of the class. This is the shape a package uses to publish a
  // class behind an interface --
  //
  //     class Impl extends EventEmitter { … }        // unexported
  //     export interface C<E = {}> extends Impl {
  //       on<K extends keyof E>(event: K, l: E[K]): this   // re-typed
  //     }
  //     export const C = Impl as unknown as CCtor
  //
  // -- typically to give `on`/`emit` event-map-typed overloads the class
  // itself cannot express. Mapping the interface STRUCTURALLY instead
  // would make the published type a record that no instance of the class
  // can satisfy, so every use of the published surface fences.
  {
    const viaRetyping = interfaceRetypingClassInstance(checker, widened, widenedSym, ctx);
    if (viaRetyping) return mapType(viaRetyping, ctx);
  }
  const classDecl = widenedSym ? checker.valueDeclarationOf(widenedSym) : undefined;
  if (
    classDecl &&
    (ts.isClassDeclaration(classDecl) || ts.isClassExpression(classDecl)) &&
    // Nameless class DECLARATIONS are legal only as `export default class
    // {}` — classNamer spells them "%anon" (unique per file), the same
    // name their collection registered.
    !classDecl.getSourceFile().isDeclarationFile &&
    checker.getConstructSignatures(widened).length === 0
  ) {
    // Declared OUTSIDE the lowered program (reached through the type world
    // alone — jsdoc `typeof import()` over a never-required module): the
    // class will never register, so the instance type is unmappable, not
    // an object type naming a struct that cannot exist.
    if (!ctx.isProgramFile(classDecl.getSourceFile())) return null;
    // The class inside a MIXIN function: per-call-site instantiations
    // share this one node — the CURRENT instantiation (collecting or
    // lowering) is the answer; outside any mixin context the node's type
    // stays unmapped (nothing names a call site).
    {
      const viaMixin = ctx.mixinClassInstance?.(classDecl);
      if (viaMixin) {
        contextResolutions++;
        return viaMixin;
      }
    }
    // A class expression inside a function/static block never registers
    // (a distinct class per evaluation): unmappable for the same reason.
    if (classExprNeverRegisters(classDecl)) return null;
    // A GENERIC class's instance type (`Box<number>`) maps to the concrete
    // INSTANTIATION's class (`Box%0`), registered on demand — the Lowerer
    // hook owns the instance table (monomorphization by flow).
    if (classDecl.typeParameters) {
      memoSensitivity++;
      return ctx.genericClassInstance ? ctx.genericClassInstance(classDecl, widened) : null;
    }
    return { kind: "object", className: classNamer(classDecl) };
  }
  // The class STATIC side (`typeof C` — the class name as a value): the
  // same symbol WITH its construct signatures. Program classes only; lib
  // and package statics keep their fences.
  if (
    classDecl &&
    (ts.isClassDeclaration(classDecl) || ts.isClassExpression(classDecl)) &&
    !classDecl.getSourceFile().isDeclarationFile &&
    checker.getConstructSignatures(widened).length > 0
  ) {
    if (!ctx.isProgramFile(classDecl.getSourceFile())) return null;
    // The MIXIN class node's static side (`typeof C` inside the mixin):
    // the current instantiation's classval, like the instance type above.
    {
      const viaMixin = ctx.mixinClassInstance?.(classDecl);
      if (viaMixin?.kind === "object") {
        contextResolutions++;
        return { kind: "classval", className: viaMixin.className };
      }
    }
    if (classExprNeverRegisters(classDecl)) return null;
    // A GENERIC class's static side: only an INSTANTIATED one maps — an
    // instantiation expression's type (`Box<number>` as a value) carries a
    // construct signature returning the concrete instance, which maps to
    // the instantiation's classval. Uninstantiated `typeof Box` keeps the
    // type parameter in the construct signature's return — unmapped (the
    // family has no thunk and no single constructor ABI).
    if (classDecl.typeParameters) {
      const ctorSigs = checker.getConstructSignatures(widened);
      if (ctorSigs.length !== 1) return null;
      const inst = mapType(checker.getReturnTypeOfSignature(ctorSigs[0]!), ctx);
      return inst?.kind === "object" ? { kind: "classval", className: inst.className } : null;
    }
    return { kind: "classval", className: classNamer(classDecl) };
  }
  // Constructor-signature TYPES (`new (…) => T`, an interface with one
  // construct signature): slots typed as constructables hold class
  // values whose instance type is T — classval of T's class. The spelled
  // signature is not part of the IR type: every value legally in the slot
  // shares the class's own completed constructor ABI (the upcast rule),
  // which is what newValue completes against. Only single-signature
  // constructables over PROGRAM class instances map; overload sets and
  // lib/package constructables stay unmapped (their fences name them).
  {
    const ctorSigs = checker.getConstructSignatures(widened);
    if (ctorSigs.length === 1 && checker.getCallSignatures(widened).length === 0) {
      const inst = mapType(checker.getReturnTypeOfSignature(ctorSigs[0]!), ctx);
      if (
        inst?.kind === "object" &&
        !RUNTIME_ERROR_CLASSES.has(inst.className) &&
        inst.className !== RUNTIME_EMITTER_CLASS &&
        !RUNTIME_STREAM_CLASSES.has(inst.className)
      ) {
        return { kind: "classval", className: inst.className };
      }
      // A constructable whose instance type is an INTERFACE rather
      // than a program class (`new (url: string) => RawWebSocket` —
      // the injection point a transport keeps for its socket
      // implementation). There is no class to name, but a
      // constructor IS a callable producing the instance, so the
      // slot maps to that function type: records holding one
      // compile, which is what an OPTIONAL injection point needs,
      // and it is almost always optional and unset.
      //
      // The VALUE side is not opened by this: assigning a class to
      // the slot needs a classval-to-thunk conversion, and `new`
      // through the slot needs the construct path — both keep
      // their fences, so nothing can be built or called through it
      // while only the type is here.
      if (inst?.kind === "record") {
        const sigDecl = checker.signatureDeclaration(ctorSigs[0]!);
        // Both spellings: `interface C { new (…): T }` gives a construct
        // SIGNATURE, `type C = new (…) => T` a constructor TYPE node.
        const sigParams =
          sigDecl !== undefined &&
          (ts.isConstructSignatureDeclaration(sigDecl) || ts.isConstructorTypeNode(sigDecl))
            ? sigDecl.parameters
            : undefined;
        if (sigParams !== undefined) {
          const params: IrType[] = [];
          let ok = true;
          for (const prm of sigParams) {
            const pt = mapType(checker.getTypeAtLocation(prm.name), ctx);
            if (!pt) { ok = false; break; }
            params.push(pt);
          }
          if (ok) return funcOf(params, inst);
        }
      }
    }
  }
  // Map<K, V>: a reference to the standard library's Map interface —
  // provenance, not the name (a user's own `interface Map` maps as a record
  // like any other). Keys are fenced to f64/string (SameValueZero hashing),
  // values to the supported kinds (see isSupportedMapValue); anything
  // outside stays unmapped — callers report the component fence (SC2009)
  // naming the offending half, as does the `new Map` lowering per site.
  const psym = widened.getSymbol();
  const isStdlibInterface = (name: string): boolean =>
    psym?.name === name &&
    checker.declarationsOf(psym).some(
      (d) => ts.isInterfaceDeclaration(d) && ctx.isStdlibFile(d.getSourceFile()),
    );
  // `Readonly<Uint8Array>` and friends: the homomorphic mapped type erases
  // the interface identity into an anonymous index signature, so every
  // named-interface test below misses and the value reports as an
  // unsupported index shape. A typed array's readonly-ness is a
  // COMPILE-TIME modifier over a runtime representation that carries no
  // per-element mutability of its own -- `Readonly<T>` IS a T at runtime --
  // so the alias unwraps to the same bytes kind. Deliberately narrow: only
  // the stdlib alias (provenance-checked, never a user's shadowing
  // `Readonly`), only over an argument that maps to bytes. Record and
  // type-parameter arguments keep their existing paths
  // (mapGenericUtilityAlias, the mapped-shape branch), so nothing that
  // mapped before changes.
  {
    const alias = widened.getAliasSymbol();
    const aliasArgs = widened.getAliasTypeArguments() ?? [];
    const inner = aliasArgs[0];
    if (
      alias?.name === "Readonly" &&
      aliasArgs.length === 1 &&
      inner !== undefined &&
      checker.declarationsOf(alias).some(
        (d) => ts.isTypeAliasDeclaration(d) && ctx.isStdlibFile(d.getSourceFile()),
      )
    ) {
      const mapped = mapType(inner, ctx);
      if (mapped?.kind === "bytes") return mapped;
    }
  }
  // The builtin Error classes: references to the LIB's Error/TypeError/
  // RangeError/SyntaxError interfaces map to the runtime-provided class
  // hierarchy (provenance, not the name — a user's own `class Error`
  // resolved through the class-instance branch above, and a user
  // `interface Error` maps as a record). The '%'-prefixed IR names are the
  // RUNTIME_ERROR_CLASSES table's; the Lowerer registers the matching
  // ClassInfos eagerly, so every consumer of the class name finds them.
  for (const [irName, rec] of RUNTIME_ERROR_CLASSES) {
    if (isStdlibInterface(rec.lib)) return { kind: "object", className: irName };
  }
  // The lib's `Object` interface is a TOP type: tsc admits every
  // non-nullish value into an `Object` slot (`const x: Object = "s"`), so
  // it lowers like `unknown` (the dyn) — the same rule as `object` and
  // the empty object type, provenance-checked so a user's own `interface
  // Object` still maps as a record. Its Object.prototype member surface
  // (`x.toString()`) fences at each use site, never silently.
  if (isStdlibInterface("Object")) return DYN;
  // events.EventEmitter: the runtime-provided emitter base class (the
  // Error-hierarchy precedent — user subclasses resolved through the
  // class-instance branch above). Both type layers declare it in the
  // "events" ambient module — the fallback as a class, @types/node as a
  // (generic) class plus a same-named interface — and @types/node's
  // NodeJS.EventEmitter interface (the structural surface net.Socket
  // et al. extend) is the same runtime value. Provenance-checked.
  if (
    psym?.name === "EventEmitter" &&
    checker.declarationsOf(psym).some(
      (d) =>
        (ts.isClassDeclaration(d) || ts.isInterfaceDeclaration(d)) &&
        ctx.isStdlibFile(d.getSourceFile()) &&
        (isDeclaredInAmbientModule(d, "events") || isDeclaredInAmbientNamespace(d, "NodeJS")),
    )
  ) {
    return { kind: "object", className: RUNTIME_EMITTER_CLASS };
  }
  // readline.Interface: the interface value is an f64 handle into the
  // runtime's registry (the Timeout-id precedent). The NAME is generic,
  // so the provenance check adds the enclosing ambient module, like
  // net.Server (@types/node also declares Interface in
  // readline/promises — that one stays unmapped and fences).
  if (
    psym?.name === "Interface" &&
    checker.declarationsOf(psym).some(
      (d) =>
        (ts.isInterfaceDeclaration(d) || ts.isClassDeclaration(d)) &&
        ctx.isStdlibFile(d.getSourceFile()) &&
        isDeclaredInAmbientModule(d, "readline"),
    )
  ) {
    return F64;
  }
  // diagnostics_channel.Channel: the channel value is an f64 handle into
  // the runtime's channel registry (the readline.Interface precedent —
  // Node's channels are process-lived too, its WeakRef machinery aside).
  // Provenance: the name is specific enough that stdlib-file provenance
  // plus the ambient module suffices for both the fallback declarations
  // and @types/node's class Channel<StoreType, ContextType>.
  if (
    psym?.name === "Channel" &&
    checker.declarationsOf(psym).some(
      (d) =>
        (ts.isInterfaceDeclaration(d) || ts.isClassDeclaration(d)) &&
        ctx.isStdlibFile(d.getSourceFile()) &&
        isDeclaredInAmbientModule(d, "diagnostics_channel"),
    )
  ) {
    return F64;
  }
  // async_hooks.AsyncLocalStorage: the store value is an f64 handle into
  // the runtime's store id space (the Channel story — stores are
  // process-lived; contexts ride the fiber machinery).
  if (
    psym?.name === "AsyncLocalStorage" &&
    checker.declarationsOf(psym).some(
      (d) =>
        (ts.isInterfaceDeclaration(d) || ts.isClassDeclaration(d)) &&
        ctx.isStdlibFile(d.getSourceFile()) &&
        isDeclaredInAmbientModule(d, "async_hooks"),
    )
  ) {
    return F64;
  }
  // diagnostics_channel.TracingChannel: the same f64-handle story over the
  // runtime's tracing registry (five event channels per entry).
  if (
    psym?.name === "TracingChannel" &&
    checker.declarationsOf(psym).some(
      (d) =>
        (ts.isInterfaceDeclaration(d) || ts.isClassDeclaration(d)) &&
        ctx.isStdlibFile(d.getSourceFile()) &&
        isDeclaredInAmbientModule(d, "diagnostics_channel"),
    )
  ) {
    return F64;
  }
  // string_decoder.StringDecoder: the decoder value is a two-field record
  // — the CANONICAL encoding name (construction normalizes aliases; the
  // `.encoding` property reads it) and the f64 packing the pending
  // partial sequence (the %strdec helpers' state cell). Provenance-
  // checked like Stats; construction and the write/end methods are
  // special-cased in lowerNew / lowerStringDecoderMethodCall, so the
  // record shape never surfaces.
  if (
    psym?.name === "StringDecoder" &&
    checker.declarationsOf(psym).some(
      (d) =>
        (ts.isInterfaceDeclaration(d) || ts.isClassDeclaration(d)) &&
        ctx.isStdlibFile(d.getSourceFile()),
    )
  ) {
    return {
      kind: "record",
      shapeId: ctx.shapes.intern([
        { name: "%enc", type: STRING },
        { name: "%pending", type: F64 },
      ]),
    };
  }
  // Promise.withResolvers's return type — `{ promise, resolve, reject }`
  // from the overrides declaration (or es2024's PromiseWithResolvers,
  // the same shape): a real data record, but its anonymous literal lives
  // in a declaration file, which recordProvenanceOk rightly refuses for
  // lib type worlds. Map it manually with the executor's own scriptc
  // field shapes (plain-value resolve — () => void for Promise<void> —
  // and the Error-pinned reject), so both the destructured and the
  // record-holding binding forms compile. User-declared literals with
  // these member names keep the ordinary record path (their declarations
  // are not in declaration files).
  if (
    flags & ts.TypeFlags.Object &&
    (psym ? checker.declarationsOf(psym).length : 0) > 0 &&
    (psym ? checker.declarationsOf(psym) : []).every((d) => d.getSourceFile().isDeclarationFile)
  ) {
    const props = checker.getPropertiesOfType(widened);
    if (
      props.length === 3 &&
      ["promise", "resolve", "reject"].every((n) => props.some((p) => p.name === n))
    ) {
      const promProp = props.find((p) => p.name === "promise")!;
      const promT = mapType(checker.getTypeOfSymbol(promProp), ctx);
      if (promT?.kind === "promise") {
        const inner = promT.inner;
        return {
          kind: "record",
          shapeId: ctx.shapes.intern(
            [
              { name: "promise", type: promT },
              {
                name: "reject",
                type: { kind: "func", params: [{ kind: "object", className: "%Error" }], ret: VOID },
              },
              {
                name: "resolve",
                type: { kind: "func", params: inner.kind === "void" ? [] : [inner], ret: VOID },
              },
            ],
            false,
            undefined,
            ["promise", "resolve", "reject"],
          ),
        };
      }
    }
  }
  // NodeJS.ErrnoException (@types/node): an Error with optional
  // code/errno/syscall/path members. The VALUE is a plain runtime error
  // (fs/exec throw sites stamp `code`), so the type maps to the %Error
  // root — `err as NodeJS.ErrnoException` from an Error-typed value is a
  // no-op cast, error-typed listener params accept it, and the `.code`
  // read has its own lowering (errno/syscall/path stay per-member fences).
  if (isStdlibInterface("ErrnoException")) return { kind: "object", className: "%Error" };
  // The fetch ambient slice (Response, RequestInit, AbortSignal): island-
  // backed ambient TYPES — the values behind them live in the embedded
  // engine (fetch's Response, AbortSignal.timeout's signal), so under
  // --dynamic they map to island handles exactly like npm-declared types,
  // and every operation on them rides the engine ops with validated exits
  // at typed boundaries. Provenance, not names: a user's own `interface
  // Response` maps as a record like any other. Without the flag they stay
  // unmapped; the use sites report the per-site requires-dynamic story
  // (the fetch/AbortSignal.timeout lowerings' SC2012, badType's naming
  // for a bare value of the type).
  // Interface OR class declarations (the shipped fallback declares
  // interfaces; @types/node's undici-types declares Response as a class).
  // AbortSignal has a STATIC representation of its own (the abortSignal
  // handle), so it leaves the island group before the check below sends
  // the rest of that group to jsval-or-nothing. It is overwhelmingly an
  // optional field on an options record that the program never touches,
  // and having no type at all is what stops those records — and every
  // class holding one — from compiling. The value surface (the statics,
  // the instance members, AbortController) is not lowered yet and fences
  // per site, so nothing can build or observe a signal from here.
  if (
    psym?.name === "AbortSignal" &&
    checker.declarationsOf(psym).some(
      (d) =>
        (ts.isInterfaceDeclaration(d) || ts.isClassDeclaration(d)) &&
        ctx.isStdlibFile(d.getSourceFile()),
    )
  ) {
    return ctx.dynamic ? JSVAL : ABORTSIGNAL_T;
  }
  // AbortController rides the same static representation, and ONLY the
  // static one: under --dynamic the island owns the class and every
  // spelling keeps its existing per-site story, so nothing about that lane
  // moves here. Provenance, not names: a user's own class AbortController
  // maps like any other class.
  if (
    !ctx.dynamic &&
    psym?.name === "AbortController" &&
    checker.declarationsOf(psym).some(
      (d) =>
        (ts.isInterfaceDeclaration(d) || ts.isClassDeclaration(d)) &&
        ctx.isStdlibFile(d.getSourceFile()),
    )
  ) {
    return ABORTCONTROLLER_T;
  }
  if (
    psym &&
    (ISLAND_AMBIENT_TYPES as readonly string[]).includes(psym.name) &&
    checker.declarationsOf(psym).some(
      (d) =>
        (ts.isInterfaceDeclaration(d) || ts.isClassDeclaration(d)) &&
        ctx.isStdlibFile(d.getSourceFile()),
    )
  ) {
    return ctx.dynamic ? JSVAL : null;
  }
  // ReadonlyMap/ReadonlySet are the SAME runtime values as Map/Set — the
  // readonly-ness is a checker-only view (no mutating members on the
  // interface), so both map to the identical IR kinds and the read-side
  // method lowerings (.has/.get/.size/iteration) dispatch unchanged.
  // WeakMap rides the ordinary identity-keyed Map. The two differ only in
  // whether an entry keeps its key ALIVE, and a compiled program cannot
  // observe that difference: there is no finalizer, no WeakRef surface, and
  // WeakMap has no iteration by design. What changes is MEMORY — entries are
  // retained until the map dies rather than until the key does. A documented
  // divergence in footprint, not in behaviour.
  if (
    isStdlibInterface("Map") ||
    isStdlibInterface("ReadonlyMap") ||
    isStdlibInterface("WeakMap")
  ) {
    const args = checker.getTypeArguments(widened as ts.TypeReference);
    if (args.length !== 2) return null;
    const key = mapType(args[0]!, ctx);
    if (!key || !isSupportedMapKey(key)) return null;
    const value = mapType(args[1]!, ctx);
    if (!value || !isSupportedMapValue(value)) return null;
    return mapOf(key, value);
  }
  // Set<T>: Map's sibling — same provenance rule, elements fenced to Map's
  // KEY kinds (f64/string, SameValueZero). Anything else stays unmapped;
  // the `new Set` lowering names the offending element type specifically.
  if (isStdlibInterface("Set") || isStdlibInterface("ReadonlySet")) {
    const args = checker.getTypeArguments(widened as ts.TypeReference);
    if (args.length !== 1) return null;
    const elem = mapType(args[0]!, ctx);
    if (!elem || !isSupportedSetElem(elem)) return null;
    return setOf(elem);
  }
  // RegExp: a reference to the lib RegExp interface — provenance, not the
  // name (a user's own `interface RegExp` maps as a record). Regex values
  // are literals interned as immortal statics; the kind is fenced out of
  // array elements, union arms, and Map keys/values above/below.
  if (isStdlibInterface("RegExp")) {
    return { kind: "regex" };
  }
  // Typed arrays: references to the lib's Uint8Array/Uint32Array/
  // Float32Array interfaces (provenance, not names). The es2022+ lib
  // declares them generic over the backing buffer (`Uint8Array<ArrayBuffer>`
  // in error text) — the type argument is irrelevant here: no views exist,
  // every value owns its storage. The other TypedArray flavors stay
  // unmapped (the record path's index-signature check rejects them).
  // RegExpMatchArray (s.match's result) IS a string[] here — the honest
  // slice: [whole match, ...captures] (a nonparticipating capture reads
  // "" — SEMANTICS.md). The `.index`/`.input`/`.groups` extras fence per
  // member like any other unlowered array property.
  if (isStdlibInterface("RegExpMatchArray")) return arrayOf(STRING);
  // TemplateStringsArray (a tag function's first parameter): a string[] —
  // the cooked spans the templateStrings site value carries. The `.raw`
  // extra fences per member like RegExpMatchArray's `.index`/`.input`.
  if (isStdlibInterface("TemplateStringsArray")) return arrayOf(STRING);
  // RegExpExecArray (matchAll's row type): the same honest slice.
  if (isStdlibInterface("RegExpExecArray")) return arrayOf(STRING);
  // RegExpStringIterator<RegExpExecArray> (matchAll's checker result): the
  // VALUE-position spelling of the eager drain — the intrinsic already
  // materializes string[][] (lazy vs eager is unobservable: strings are
  // immutable and the spec clones the regex at the call), so a stored
  // `const urlMatches = output.matchAll(re)` types as exactly that array.
  if (isStdlibInterface("RegExpStringIterator")) return arrayOf(arrayOf(STRING));
  // NodeJS.Timeout / the fallback `Timeout` interface (setTimeout's return)
  // maps to F64 — the numeric timer handle. The `.ref`/`.unref`/`.hasRef`
  // methods lower over that handle (loop-liveness bookkeeping); `Timeout |
  // null` becomes `number | null`, and clearTimeout/clearInterval take the
  // handle. Provenance-checked like the other named interfaces.
  if (isStdlibInterface("Timeout")) return F64;
  // NodeJS.Immediate / the fallback `Immediate` (setImmediate's return):
  // the same numeric-handle story over the check-phase queue — its own id
  // space, so clearTimeout of an Immediate no-ops like Node.
  if (isStdlibInterface("Immediate")) return F64;
  // TextEncoder is STATELESS — its only observable state is the constant
  // `encoding` ("utf-8"); encode() is a pure string→bytes transform. So it
  // maps to that encoding STRING, the Timeout-handle idiom (an opaque
  // stdlib object represented by the one value it carries). The checker
  // keeps the surfaces apart, so nothing can do string operations on a
  // TextEncoder; `encoding` reads the value itself and encode() ignores
  // the receiver. Divergence: inspecting one prints "utf-8" rather than
  // `TextEncoder {}`.
  // TextDecoder joins it on the SAME footing, because the constructor
  // fences on every argument: the options that would give an instance
  // state of its own (fatal, ignoreBOM) cannot be spelled, and the only
  // constructible decoder is the default utf-8 one. So it too carries
  // nothing but its `encoding`.
  // (@types/node declares them as CLASSES, so this one checks both forms.)
  if (
    (psym?.name === "TextEncoder" || psym?.name === "TextDecoder") &&
    checker.declarationsOf(psym).some(
      (d) =>
        (ts.isInterfaceDeclaration(d) || ts.isClassDeclaration(d)) &&
        ctx.isStdlibFile(d.getSourceFile()),
    )
  ) {
    return STRING;
  }
  // ArrayBuffer: the OPAQUE bytes flavor. It rides the same ScrBytes
  // representation as the typed arrays -- which is what makes the VIEW
  // relationship work for free: `new Uint8Array(buf)` is the ordinary
  // backing alias DataView/subarray/Buffer.slice already use (chain depth
  // 1), and `.buffer` hands back the owner. It is a DISTINCT IR type from
  // bytes<u8> so that `x instanceof Uint8Array` can still discriminate an
  // `ArrayBuffer | Uint8Array` arm -- the test that rules out mapping the
  // two to one type. Members lower per-member like any stdlib surface.
  if (isStdlibInterface("ArrayBuffer")) return bytesOf("buf");
  if (isStdlibInterface("Uint8Array")) return bytesOf("u8");
  if (isStdlibInterface("Uint32Array")) return bytesOf("u32");
  // Int32Array: the signed 32-bit kind (element reads sign-extend, writes
  // ToInt32-wrap) — the Atomics.wait sleep idiom constructs one over a
  // SharedArrayBuffer, and the i32 semantics hold for every other use.
  if (isStdlibInterface("Int32Array")) return bytesOf("i32");
  if (isStdlibInterface("Float32Array")) return bytesOf("f32");
  // Float64Array: the element IS the runtime's own double, so reads and
  // writes are exact — no coercion step, unlike every other kind.
  if (isStdlibInterface("Float64Array")) return bytesOf("f64");
  // Int8Array: the signed 8-bit kind — reads sign-extend, writes ToInt8-wrap.
  if (isStdlibInterface("Int8Array")) return bytesOf("i8");
  // ArrayBufferView: the ABSTRACT byte-view base ({ buffer, byteLength,
  // byteOffset } — no index signature). Every typed array and DataView
  // satisfies it, and it appears only as an opaque "some byte view" handle
  // (e.g. a `ArrayBufferView | Uint8Array` field that is a Uint8Array at
  // every value). It rides the u8 view representation like DataView: the
  // abstract type exposes no elements (no index signature), so a concrete
  // flavor is only ever observed after an `instanceof` narrow, which
  // re-establishes it. `.buffer` hands back the owner; `.byteLength`/
  // `.byteOffset` are the numeric extents. Distinct from bytes<buf>
  // (ArrayBuffer) so `instanceof Uint8Array` still discriminates the
  // `ArrayBuffer | ArrayBufferView | Uint8Array` union into its two
  // representations, and the two u8-view arms collapse (same IR type).
  if (isStdlibInterface("ArrayBufferView")) return bytesOf("u8");
  // DataView: the ONE view kind — a u8 bytes value whose runtime
  // representation borrows (aliases) its owner's storage, so reads through
  // it see writes to the source exactly like JS. The checker keeps the
  // DataView and typed-array member surfaces apart; at the IR level both
  // are bytes<u8>.
  if (isStdlibInterface("DataView")) return bytesOf("u8");
  // Node's Buffer IS a Uint8Array subclass — ONE runtime representation
  // (the u8 bytes kind). Declared `interface Buffer` by the shipped
  // fallback and by @types/node (whose NonSharedBuffer alias resolves to
  // the same symbol); provenance-checked like URL.
  if (
    psym?.name === "Buffer" &&
    checker.declarationsOf(psym).some(
      (d) =>
        (ts.isInterfaceDeclaration(d) || ts.isClassDeclaration(d)) &&
        ctx.isStdlibFile(d.getSourceFile()),
    )
  ) {
    return bytesOf("u8");
  }
  // URL: the WHATWG URL instance type — declared as a global `interface
  // URL` (the shipped fallback, and @types/node's globals) AND as `class
  // URL` in @types/node's "url" module (`new URL(x)` types as the class's
  // instance type). Provenance, not the name: a user's own URL maps as a
  // record/class like any other.
  if (
    psym?.name === "URL" &&
    checker.declarationsOf(psym).some(
      (d) =>
        (ts.isInterfaceDeclaration(d) || ts.isClassDeclaration(d)) &&
        ctx.isStdlibFile(d.getSourceFile()),
    )
  ) {
    return { kind: "url" };
  }
  // URLSearchParams: the WHATWG live query view — declared as a global
  // interface by the shipped fallback and by @types/node (plus `class
  // URLSearchParams` in the "url" module). Provenance-checked like URL.
  if (
    psym?.name === "URLSearchParams" &&
    checker.declarationsOf(psym).some(
      (d) =>
        (ts.isInterfaceDeclaration(d) || ts.isClassDeclaration(d)) &&
        ctx.isStdlibFile(d.getSourceFile()),
    )
  ) {
    return { kind: "searchParams" };
  }
  // fs.Stats: @types/node's `class Stats` (module "fs") or the fallback
  // declarations' interface. Provenance-checked like URL.
  if (
    psym?.name === "Stats" &&
    checker.declarationsOf(psym).some(
      (d) =>
        (ts.isInterfaceDeclaration(d) || ts.isClassDeclaration(d)) &&
        ctx.isStdlibFile(d.getSourceFile()),
    )
  ) {
    return { kind: "stats" };
  }
  // child_process.SpawnSyncReturns: @types/node's generic interface (the
  // Buffer/string split is re-checked at the stdout/stderr READ — status
  // reads work either way) or the fallback declarations' plain interface.
  // Provenance-checked like Stats.
  if (
    psym?.name === "SpawnSyncReturns" &&
    checker.declarationsOf(psym).some(
      (d) =>
        (ts.isInterfaceDeclaration(d) || ts.isClassDeclaration(d)) &&
        ctx.isStdlibFile(d.getSourceFile()),
    )
  ) {
    return { kind: "spawnRes" };
  }
  // child_process.ChildProcess: @types/node's class or the fallback
  // declarations' interface. Provenance-checked like Stats.
  // generateKeyPair(Sync)'s result pair — two KeyObjects, nothing else.
  if (
    psym?.name === "KeyPairKeyObjectResult" &&
    checker.declarationsOf(psym).some(
      (d) => ts.isInterfaceDeclaration(d) && ctx.isStdlibFile(d.getSourceFile()),
    )
  ) {
    return {
      kind: "record",
      shapeId: ctx.shapes.intern([
        { name: "privateKey", type: { kind: "keyobj" } },
        { name: "publicKey", type: { kind: "keyobj" } },
      ]),
    };
  }

  // The JWK of an X25519/Ed25519 key. @types/node spells JsonWebKey as
  // every JWK member across every algorithm plus a string index signature;
  // for these two curves Node fills exactly kty, crv, x, and (private only)
  // d. Mapping to that fixed shape lets the export compile; a read of any
  // OTHER member — an RSA n/e, an EC y — fences at the read instead of
  // answering undefined, which is the honest failure for a key that could
  // never carry one.
  if (
    psym?.name === "JsonWebKey" &&
    checker.declarationsOf(psym).some(
      (d) => ts.isInterfaceDeclaration(d) && ctx.isStdlibFile(d.getSourceFile()),
    )
  ) {
    const optStr = withUndefinedArm(STRING, ctx.unions);
    if (!optStr) return null;
    return {
      kind: "record",
      // Every member keeps the undefined arm @types/node declares: only `d`
      // is genuinely absent for a public key, but a shape that promised
      // `string` where the checker says `string | undefined` would disagree
      // with tsc at every read.
      shapeId: ctx.shapes.intern([
        { name: "crv", type: optStr },
        { name: "d", type: optStr },
        { name: "kty", type: optStr },
        { name: "x", type: optStr },
      ]),
    };
  }

  // node:crypto KeyObject — the opaque handle createPrivateKey/
  // createPublicKey/generateKeyPair produce and diffieHellman/sign/verify
  // consume. Only X25519 and Ed25519 keys can live in one here; the runtime
  // refuses any other DER framing at construction.
  if (
    psym?.name === "KeyObject" &&
    checker.declarationsOf(psym).some(
      (d) =>
        (ts.isInterfaceDeclaration(d) || ts.isClassDeclaration(d)) &&
        ctx.isStdlibFile(d.getSourceFile()),
    )
  ) {
    return { kind: "keyobj" };
  }

  // node:crypto Hash — the handle createHash mints. The FUSED chain
  // (createHash(a).update(d).digest(e)) is still lowered as one libCall
  // with no handle in sight; this mapping is what lets the handle exist
  // as an ordinary value when the chain is broken up — bound to a
  // variable, handed to a function, updated in a loop, returned.
  // Module-checked like SecureContext: @types/node declares `class Hash`
  // inside `declare module "crypto"` and the shipped fallback mirrors it
  // as an interface.
  if (
    psym?.name === "Hash" &&
    checker.declarationsOf(psym).some(
      (d) =>
        (ts.isInterfaceDeclaration(d) || ts.isClassDeclaration(d)) &&
        ctx.isStdlibFile(d.getSourceFile()) &&
        isDeclaredInAmbientModule(d, "crypto"),
    )
  ) {
    return { kind: "hash" };
  }

  // node:crypto Cipher / Decipher. SEVERAL names map, not two: @types/node
  // gives createCipheriv an overload per mode family, so an aes-256-gcm
  // call is typed `CipherGCM` while an aes-256-cbc call takes the GENERIC
  // overload — the same runtime handle either way, and the GCM-only
  // members are fenced by the runtime state, not by the name.
  //
  // The generic overload's result is spelled `Cipheriv` by the real
  // @types/node (a class extending stream.Transform) and `Cipher` by the
  // packaged fallback ambient, so BOTH have to be listed. Only `Cipher`
  // was, which is why an aes-256-gcm call compiled while the cbc and ctr
  // calls beside it did not: the CALL lowered, and then the local's own
  // declared type had no mapping.
  //
  // Adding the generic name cannot widen what compiles to a wrong cipher.
  // Nothing but a lowered createCipheriv/createDecipheriv call produces
  // this handle, and that lowering already requires the ALGORITHM to be a
  // string literal in LOWERED_CIPHER_ALGS (the three AES-256 modes) —
  // so `createCipheriv('aes-128-cbc', ...)`, also typed `Cipheriv`, still
  // refuses at the call. `CipherChaCha20Poly1305` is deliberately NOT
  // here: its algorithm is refused at the call too, and mapping the name
  // would only serve a declared parameter, for which answering "the
  // AES-256 handle" would be a lie.
  if (
    (psym?.name === "Cipher" || psym?.name === "Cipheriv" || psym?.name === "CipherGCM" ||
      psym?.name === "CipherCCM" || psym?.name === "CipherOCB") &&
    checker.declarationsOf(psym).some(
      (d) =>
        (ts.isInterfaceDeclaration(d) || ts.isClassDeclaration(d)) &&
        ctx.isStdlibFile(d.getSourceFile()) &&
        isDeclaredInAmbientModule(d, "crypto"),
    )
  ) {
    return { kind: "cipher" };
  }
  if (
    (psym?.name === "Decipher" || psym?.name === "Decipheriv" || psym?.name === "DecipherGCM" ||
      psym?.name === "DecipherCCM" || psym?.name === "DecipherOCB") &&
    checker.declarationsOf(psym).some(
      (d) =>
        (ts.isInterfaceDeclaration(d) || ts.isClassDeclaration(d)) &&
        ctx.isStdlibFile(d.getSourceFile()) &&
        isDeclaredInAmbientModule(d, "crypto"),
    )
  ) {
    return { kind: "decipher" };
  }

  // node:crypto Hmac — Hash's twin, same story, same module check.
  if (
    psym?.name === "Hmac" &&
    checker.declarationsOf(psym).some(
      (d) =>
        (ts.isInterfaceDeclaration(d) || ts.isClassDeclaration(d)) &&
        ctx.isStdlibFile(d.getSourceFile()) &&
        isDeclaredInAmbientModule(d, "crypto"),
    )
  ) {
    return { kind: "hmac" };
  }

  if (
    psym?.name === "ChildProcess" &&
    checker.declarationsOf(psym).some(
      (d) =>
        (ts.isInterfaceDeclaration(d) || ts.isClassDeclaration(d)) &&
        ctx.isStdlibFile(d.getSourceFile()),
    )
  ) {
    return { kind: "child" };
  }
  // net.Server / net.Socket: @types/node's classes or the fallback
  // declarations' interfaces. The NAME is ambiguous across builtin
  // modules (http.Server, tls.Socket share it), so the provenance check
  // adds the ENCLOSING AMBIENT MODULE: both @types/node and the fallback
  // declare these inside `declare module "net"` — a declaration outside
  // that module (http's Server) stays unmapped and fences at its use
  // site.
  if (
    (psym?.name === "Server" || psym?.name === "Socket" || psym?.name === "TLSSocket") &&
    checker.declarationsOf(psym).some(
      (d) =>
        (ts.isInterfaceDeclaration(d) || ts.isClassDeclaration(d)) &&
        ctx.isStdlibFile(d.getSourceFile()) &&
        (isDeclaredInAmbientModule(d, "net") ||
          // http.Server extends net.Server in @types/node — and tls.Server
          // / https.Server extend it transitively: same lowered surface
          // (listen/close/address/'error'), same handle kind. tls.TLSSocket
          // extends net.Socket the same way: post-handshake it IS a net
          // socket to every lowered member.
          (psym.name === "Server" &&
            (isDeclaredInAmbientModule(d, "http") ||
              isDeclaredInAmbientModule(d, "tls") ||
              isDeclaredInAmbientModule(d, "https"))) ||
          (psym.name === "TLSSocket" && isDeclaredInAmbientModule(d, "tls"))),
    )
  ) {
    return psym.name === "Server" ? { kind: "netServer" } : { kind: "netSocket" };
  }
  // tls.SecureContext: the opaque parsed-cert/key handle SNI callbacks
  // answer with (tls.createSecureContext({ cert, key }) mints it; the TLS
  // server's handshake consumes it). Module-checked like net.Server —
  // @types/node declares `interface SecureContext` inside `declare module
  // "tls"`, and the shipped fallback mirrors it.
  if (
    psym?.name === "SecureContext" &&
    checker.declarationsOf(psym).some(
      (d) =>
        (ts.isInterfaceDeclaration(d) || ts.isClassDeclaration(d)) &&
        ctx.isStdlibFile(d.getSourceFile()) &&
        isDeclaredInAmbientModule(d, "tls"),
    )
  ) {
    return { kind: "secureCtx" };
  }
  // fs.FSWatcher: the fs.watch handle (scr_watch.c). Module-checked like
  // net.Server — @types/node declares `interface FSWatcher extends
  // EventEmitter` inside `declare module "fs"`, and the shipped fallback
  // mirrors it.
  if (
    psym?.name === "FSWatcher" &&
    checker.declarationsOf(psym).some(
      (d) =>
        (ts.isInterfaceDeclaration(d) || ts.isClassDeclaration(d)) &&
        ctx.isStdlibFile(d.getSourceFile()) &&
        isDeclaredInAmbientModule(d, "fs"),
    )
  ) {
    return { kind: "fsWatcher" };
  }
  // fs/promises FileHandle: the handle fsPromises.open() resolves to.
  // Module-checked like FSWatcher — @types/node declares
  // `interface FileHandle` inside `declare module "fs/promises"`, and the
  // name is common enough (any library may export its own FileHandle)
  // that the enclosing-module check is what keeps this from capturing
  // one. Deliberately NOT mapped to the raw fd: see the IrType comment —
  // a closed-then-reopened descriptor number reads the wrong file with
  // no error, and only an owned handle can answer Node's
  // `EBADF: file closed`.
  if (
    psym?.name === "FileHandle" &&
    checker.declarationsOf(psym).some(
      (d) =>
        (ts.isInterfaceDeclaration(d) || ts.isClassDeclaration(d)) &&
        ctx.isStdlibFile(d.getSourceFile()) &&
        isDeclaredInAmbientModule(d, "fs/promises"),
    )
  ) {
    return { kind: "fileHandle" };
  }
  // The piped child-output stream, under BOTH spellings @types/node uses
  // for it: stream.Readable (ChildProcess.stdout's declared type — the
  // class inside `declare module "stream"`) and NodeJS.ReadableStream
  // (the global-namespace interface real code writes in its own
  // signatures — the portless prefixStream/NgrokChildProcess idiom). In
  // a static program every value of either type ARISES from
  // child.stdout/stderr — anything else producing one fences at its
  // producing site. The NodeJS namespace check keeps the web
  // ReadableStream (undici-types' whatwg stream, generic, no ambient
  // namespace) unmapped.
  // The process output streams as first-class VALUES, under the two
  // spellings @types/node uses: tty.WriteStream (process.stdout's own
  // intersection base — `WriteStream & { fd: 1 }` resolves through the
  // handle-refinement path below) and NodeJS.WritableStream (the
  // global-namespace interface real code writes in its own signatures —
  // prefixStream's `output` param). The representation is the raw fd
  // scalar; the lowered surface is write(string).
  if (
    (psym?.name === "WriteStream" &&
      checker.declarationsOf(psym).some(
        (d) =>
          (ts.isInterfaceDeclaration(d) || ts.isClassDeclaration(d)) &&
          ctx.isStdlibFile(d.getSourceFile()) &&
          isDeclaredInAmbientModule(d, "tty"),
      )) ||
    (psym?.name === "WritableStream" &&
      checker.declarationsOf(psym).some(
        (d) =>
          ts.isInterfaceDeclaration(d) &&
          ctx.isStdlibFile(d.getSourceFile()) &&
          isDeclaredInAmbientNamespace(d, "NodeJS"),
      ))
  ) {
    return PROCSTREAM_T;
  }
  // The static node:stream classes, under BOTH declaration sources: the
  // shipped fallback's `declare module "stream"` classes and @types/node's
  // same-named classes inside its own. Checked BEFORE the childStream
  // branch — see runtimeStreamClassOf for why the two no longer collide.
  {
    const irName = psym
      ? runtimeStreamClassOf(checker.declarationsOf(psym), psym.name, ctx.isStdlibFile) ??
        // node:fs's own two — the base class they extend (fsStreamClassOf
        // explains why this is a type-only claim).
        fsStreamClassOf(checker.declarationsOf(psym), psym.name, ctx.isStdlibFile)
      : null;
    if (irName) return { kind: "object", className: irName };
  }
  // The piped child-output stream. ONE spelling now: NodeJS.ReadableStream,
  // the global-namespace interface the shipped fallback gives
  // ChildProcess.stdout/stderr. @types/node spells those slots
  // `stream.Readable`, which the branch above claims for the runtime class
  // — child stdio under @types/node keeps working because its lowering
  // spoke keys off the PRODUCING SYNTAX (child.stdout/child.stderr), not
  // off this type mapping. See lowerChildStreamMethodCall.
  if (
    psym?.name === "ReadableStream" &&
    checker.declarationsOf(psym).some(
      (d) =>
        ts.isInterfaceDeclaration(d) &&
        ctx.isStdlibFile(d.getSourceFile()) &&
        isDeclaredInAmbientNamespace(d, "NodeJS"),
    )
  ) {
    return { kind: "childStream" };
  }
  // dgram.Socket: the same ambiguous "Socket" name disambiguated by its
  // enclosing ambient module — @types/node's `class Socket extends
  // EventEmitter` and the fallback declarations' interface both live
  // inside `declare module "dgram"`.
  if (
    psym?.name === "Socket" &&
    checker.declarationsOf(psym).some(
      (d) =>
        (ts.isInterfaceDeclaration(d) || ts.isClassDeclaration(d)) &&
        ctx.isStdlibFile(d.getSourceFile()) &&
        isDeclaredInAmbientModule(d, "dgram"),
    )
  ) {
    return { kind: "dgramSocket" };
  }
  // node:test's TestContext — the test-body parameter (`test('x', (t) =>
  // ...)`). @types/node's `class TestContext` and the fallback
  // declarations' interface both live inside `declare module "node:test"`
  // (isDeclaredInAmbientModule answers for both spellings).
  if (
    psym?.name === "TestContext" &&
    checker.declarationsOf(psym).some(
      (d) =>
        (ts.isInterfaceDeclaration(d) || ts.isClassDeclaration(d)) &&
        ctx.isStdlibFile(d.getSourceFile()) &&
        isDeclaredInAmbientModule(d, "test"),
    )
  ) {
    return { kind: "testCtx" };
  }
  // NodeJS.ErrnoException: @types/node's `interface ErrnoException extends
  // Error` (dns/fs callback error types). It IS an Error at runtime — map
  // it to the runtime %Error hierarchy like the lib Error interfaces
  // above; the optional errno/code/path/syscall extras fence per member
  // (the .stack stance). Provenance-checked like the rest.
  if (
    psym?.name === "ErrnoException" &&
    checker.declarationsOf(psym).some(
      (d) => ts.isInterfaceDeclaration(d) && ctx.isStdlibFile(d.getSourceFile()),
    )
  ) {
    return { kind: "object", className: "%Error" };
  }
  // http.Agent / https.Agent — the Agent VALUE is a checked-dynamic
  // handle (new http.Agent lowers to the dyn handle whose members
  // dispatch through the handle ops), so the TYPE maps to dyn: a typed
  // binding, parameter, or field carrying an Agent stays usable instead
  // of fencing at the declaration. Module-checked like the rest (https'
  // Agent extends http's; both live in their ambient modules).
  if (
    psym?.name === "Agent" &&
    checker.declarationsOf(psym).some(
      (d) =>
        (ts.isInterfaceDeclaration(d) || ts.isClassDeclaration(d)) &&
        ctx.isStdlibFile(d.getSourceFile()) &&
        (isDeclaredInAmbientModule(d, "http") || isDeclaredInAmbientModule(d, "https")),
    )
  ) {
    return { kind: "dyn" };
  }
  // http.IncomingMessage / http.ServerResponse — module-checked like
  // net.Server (the names repeat nowhere today, but provenance stays the
  // rule).
  if (
    (psym?.name === "IncomingMessage" || psym?.name === "ServerResponse") &&
    checker.declarationsOf(psym).some(
      (d) =>
        (ts.isInterfaceDeclaration(d) || ts.isClassDeclaration(d)) &&
        ctx.isStdlibFile(d.getSourceFile()) &&
        isDeclaredInAmbientModule(d, "http"),
    )
  ) {
    return psym.name === "IncomingMessage" ? { kind: "httpReq" } : { kind: "httpRes" };
  }
  // http2's compatibility surface (the allowHTTP1 lowering): the secure
  // server IS a net server (listen/close/address/emit ride the same
  // handle), and Http2ServerRequest/Response ARE the http req/res kinds —
  // every connection the lowering accepts is HTTP/1.1, exactly the case
  // where Node hands the compatibility objects the http.IncomingMessage /
  // ServerResponse surface. h2-only members (stream, session) fence per
  // member at their use sites (lower-server.ts). Module-checked like the
  // rest.
  if (
    (psym?.name === "Http2SecureServer" ||
      psym?.name === "Http2ServerRequest" ||
      psym?.name === "Http2ServerResponse") &&
    checker.declarationsOf(psym).some(
      (d) =>
        (ts.isInterfaceDeclaration(d) || ts.isClassDeclaration(d)) &&
        ctx.isStdlibFile(d.getSourceFile()) &&
        isDeclaredInAmbientModule(d, "http2"),
    )
  ) {
    return psym.name === "Http2SecureServer"
      ? { kind: "netServer" }
      : psym.name === "Http2ServerRequest"
        ? { kind: "httpReq" }
        : { kind: "httpRes" };
  }
  // The REAL h2 surface (scr_http2.c): the h2c server is a net server
  // like the secure one; sessions and streams are first-class handle
  // kinds (client and server flavors share a kind — the runtime handle
  // carries the role). Module-checked like the rest.
  if (
    (psym?.name === "Http2Server" || psym?.name === "Http2Session" ||
      psym?.name === "ClientHttp2Session" || psym?.name === "ServerHttp2Session" ||
      psym?.name === "ClientHttp2Stream" || psym?.name === "ServerHttp2Stream") &&
    checker.declarationsOf(psym).some(
      (d) =>
        (ts.isInterfaceDeclaration(d) || ts.isClassDeclaration(d)) &&
        ctx.isStdlibFile(d.getSourceFile()) &&
        isDeclaredInAmbientModule(d, "http2"),
    )
  ) {
    return psym.name === "Http2Server"
      ? { kind: "netServer" }
      : psym.name === "ClientHttp2Stream" || psym.name === "ServerHttp2Stream"
        ? { kind: "http2Stream" }
        : { kind: "http2Session" };
  }
  // http.ClientRequest (http.request/http.get results) — module-checked
  // like IncomingMessage.
  if (
    psym?.name === "ClientRequest" &&
    checker.declarationsOf(psym).some(
      (d) =>
        (ts.isInterfaceDeclaration(d) || ts.isClassDeclaration(d)) &&
        ctx.isStdlibFile(d.getSourceFile()) &&
        isDeclaredInAmbientModule(d, "http"),
    )
  ) {
    return { kind: "httpClientReq" };
  }
  // NodeJS.ProcessEnv: @types/node's interface (Dict<string> plus a TZ?
  // member) maps to the PURE index-signature shape it structurally is —
  // `{ [k: string]: string | undefined }` (TZ is just another
  // string-or-undefined key and reads through the overflow like the rest).
  // What makes `process.env` as a VALUE representable (the snapshot
  // record) and ProcessEnv-typed parameters mappable. The fallback
  // declarations' anonymous env type takes the pureIndexShape path below
  // and interns the SAME shape.
  if (
    psym?.name === "ProcessEnv" &&
    checker.declarationsOf(psym).some(
      (d) => ts.isInterfaceDeclaration(d) && ctx.isStdlibFile(d.getSourceFile()),
    )
  ) {
    const value = withUndefinedArm(STRING, ctx.unions);
    if (!value) return null;
    return { kind: "record", shapeId: ctx.shapes.intern([], false, value, []) };
  }
  // Promise<T>: a reference to the lib Promise interface. The inner type
  // maps recursively; promise-of-unmappable stays unmappable.
  if (isStdlibInterface("Promise")) {
    const arg = checker.getTypeArguments(widened as ts.TypeReference)[0];
    if (!arg) return null;
    // Promise<never> — a throw-only async function's inference. Like sync
    // `never` in return position (declaredReturnType), the honest reading
    // is "void with a stronger guarantee": the promise only ever rejects,
    // so no await can observe a fulfillment value. `never` VALUES outside
    // a promise stay unmapped.
    if (arg.flags & ts.TypeFlags.Never) return { kind: "promise", inner: VOID };
    // Promise<any> in a STATIC build (untyped JS entries: `new
    // Promise((resolve) => ...)` infers any): the settled value rides the
    // dyn arm exactly like Promise<unknown> — every use of the awaited
    // value is checked-dynamic, the same honesty `unknown` gets. Dynamic
    // builds keep the jsval mapping below (an engine promise is one
    // handle).
    if (arg.flags & ts.TypeFlags.Any && !ctx.dynamic) return { kind: "promise", inner: DYN };
    const inner = mapType(arg, ctx);
    if (!inner) return null;
    return { kind: "promise", inner };
  }
  // Generator<T, TReturn, TNext> (and the lib's IterableIterator<T, ...>,
  // the older annotation spelling — Generator extends it): the sync
  // generator kind. Channel normalization keeps the runtime honest:
  //   yield channel  — T must be a real value type (a generator that could
  //                    only yield undefined has no C value form); `never`
  //                    (a generator that never yields) rides the VOID
  //                    sentinel — the suspended branch is unreachable.
  //   return channel — void/undefined/never carry no value (VOID: the
  //                    done-value is the undefined arm); any/unknown ride
  //                    dyn; else the mapped type.
  //   next channel   — void/undefined/never mean valueless resumes (the
  //                    undefined UNIT: `.next()` sends nothing, yields are
  //                    statement-position); any/unknown ride dyn (`.next(v)`
  //                    boxes; the yield expression reads checked-dynamic);
  //                    else the mapped type (`.next(v)` requires its
  //                    argument — fenced at the call).
  // Mixed dyn/concrete channels stay unmapped: the shared result record's
  // value slot would need a dyn union arm, which does not exist.
  if (isStdlibInterface("Generator") || isStdlibInterface("IterableIterator")) {
    const args = checker.getTypeArguments(widened as ts.TypeReference);
    const channels = genChannels(args[0], args[1], args[2], ctx);
    if (!channels) return null;
    // The result record must exist too (its union must be legal), or
    // `.next()` could never answer — mapped generators always resume.
    if (!genResultRecord(channels.yieldT, channels.retT, ctx.shapes, unions)) return null;
    return { kind: "generator", ...channels };
  }
  // IteratorResult<T, TReturn> — the checker's type of `g.next()` (an
  // alias for IteratorYieldResult<T> | IteratorReturnResult<TReturn>):
  // maps to the SAME interned record genResume answers, so `const r =
  // g.next()` binds without an annotation and reads flow.
  {
    const alias = widened.getAliasSymbol();
    if (
      alias?.name === "IteratorResult" &&
      checker.declarationsOf(alias).some(
        (d) => ts.isTypeAliasDeclaration(d) && ctx.isStdlibFile(d.getSourceFile()),
      )
    ) {
      const targs = widened.getAliasTypeArguments() ?? [];
      const channels = genChannels(targs[0], targs[1], undefined, ctx);
      if (!channels) return null;
      return genResultRecord(channels.yieldT, channels.retT, ctx.shapes, unions);
    }
  }
  // PromiseSettledResult<T>'s parts: the lib's PromiseFulfilledResult<T> /
  // PromiseRejectedResult interfaces map to the documented HONEST SUBSET
  // record { status: string } — `value` (T) and `reason` (any) have no
  // record-field representation here (void fields don't exist; a jsval
  // field would absorb the record), and the manual-allSettled pattern this
  // mapping exists for (pMap) discards them. Construction literals still
  // EVALUATE a dropped initializer for its effects — the awaited mapper —
  // via the object-literal lowering's drop path. Both interfaces intern
  // the SAME shape, so the settled union collapses to one record arm and
  // status keeps its string reads/comparisons. SEMANTICS.md 46.
  // net/dgram AddressInfo and dgram RemoteInfo: stdlib interfaces over
  // data properties, interned EXPLICITLY (the record path's provenance
  // fence keeps .d.ts shapes out of the structural walk — the
  // PromiseFulfilledResult precedent). RemoteInfo's 'IPv4' | 'IPv6'
  // family widens to string here; the runtime only ever answers "IPv4"
  // (udp4 is the one lowered socket type).
  // child_process.ExecFileSyncOptionsWithStringEncoding: the exec-options
  // interface interned explicitly on the AddressInfo pattern, so a TYPED
  // options value (`const commandOptions: ExecFileSyncOptions... = {...}`,
  // a runner function's options parameter) flows to execFileSync/execSync
  // as a runtime record — the windows-ca command-runner idiom. The fields
  // are the members the exec lowering honestly implements: encoding
  // (required — the "WithStringEncoding" refinement), cwd/input/timeout,
  // stdio (the "pipe"/"ignore" string or 3-tuple forms — a runtime array
  // is string[]; unsupported runtime modes throw at the call), and the
  // accepted-but-inert maxBuffer/windowsHide. Members outside this set
  // (env, killSignal, shell, uid, ...) keep the shape unmatched — their
  // literals fence at the shape check instead of silently dropping.
  if (isStdlibInterface("ExecFileSyncOptionsWithStringEncoding")) {
    const optStr = withUndefinedArm(STRING, ctx.unions);
    const optNum = withUndefinedArm(F64, ctx.unions);
    const optBool = withUndefinedArm(BOOL, ctx.unions);
    const stdioArms = [arrayOf(STRING), STRING, UNDEFINED_T].sort((a, b) => (typeKey(a) < typeKey(b) ? -1 : 1));
    const stdio: IrType = { kind: "union", unionId: ctx.unions.intern(stdioArms) };
    if (!optStr || !optNum || !optBool) return null;
    return {
      kind: "record",
      shapeId: ctx.shapes.intern(
        [
          { name: "cwd", type: optStr },
          { name: "encoding", type: STRING },
          { name: "input", type: optStr },
          { name: "maxBuffer", type: optNum },
          { name: "stdio", type: stdio },
          { name: "timeout", type: optNum },
          { name: "windowsHide", type: optBool },
        ],
        false,
        undefined,
        ["encoding", "cwd", "input", "timeout", "stdio", "maxBuffer", "windowsHide"],
      ),
    };
  }
  if (isStdlibInterface("AddressInfo")) {
    return {
      kind: "record",
      shapeId: ctx.shapes.intern(
        [
          { name: "address", type: STRING },
          { name: "family", type: STRING },
          { name: "port", type: F64 },
        ],
        false,
        undefined,
        ["address", "family", "port"],
      ),
    };
  }
  // fs.Dirent (readdirSync's withFileTypes rows): interned explicitly on
  // the AddressInfo pattern. The VISIBLE fields are Node's own keys (name,
  // parentPath — Object.keys order matches Node via declaredOrder); the
  // hidden %dtype field carries the entry kind (libuv's UV_DIRENT
  // encoding) that the isFile/isDirectory/isSymbolicLink call lowerings
  // read (lowerDirentMethodCall — the StringDecoder pattern, so the
  // %-field never surfaces through the lowered Dirent surface itself;
  // JSON.stringify of a Dirent would show it — the documented
  // internal-shape edge). @types/node declares Dirent<Name> generic over
  // the name's encoding — only the string instantiation maps (the
  // encoding:'buffer' readdir form has no lowering); the shipped fallback
  // declares it concrete (an interface; @types/node uses a class — both
  // provenance-checked, the Buffer/URL pattern).
  if (
    psym?.name === "Dirent" &&
    checker.declarationsOf(psym).some(
      (d) =>
        (ts.isInterfaceDeclaration(d) || ts.isClassDeclaration(d)) &&
        ctx.isStdlibFile(d.getSourceFile()),
    )
  ) {
    const args = checker.getTypeArguments(widened as ts.TypeReference);
    if (args.length > 1) return null;
    if (args.length === 1) {
      const t = args[0] && mapType(args[0], ctx);
      if (!t || t.kind !== "string") return null;
    }
    return {
      kind: "record",
      shapeId: ctx.shapes.intern(
        [
          { name: "%dtype", type: F64 },
          { name: "name", type: STRING },
          { name: "parentPath", type: STRING },
        ],
        false,
        undefined,
        ["name", "parentPath"],
      ),
    };
  }
  // os.UserInfo (os.userInfo()'s result): a stdlib data interface interned
  // explicitly, the AddressInfo pattern. The shipped fallback declares it
  // concrete; @types/node declares UserInfo<T>, where only the string
  // instantiation maps (UserInfo<Buffer> — the encoding:'buffer' option —
  // stays unmapped; the call-site lowering fences the option form anyway).
  // shell is the declared `string | null` union; POSIX always answers the
  // string arm. Key order is Node's runtime insertion order (node_os.cc
  // builds uid, gid, username, homedir, shell), so Object.keys over the
  // record answers exactly Node.
  if (isStdlibInterface("UserInfo")) {
    const args = checker.getTypeArguments(widened as ts.TypeReference);
    if (args.length > 1) return null;
    if (args.length === 1) {
      const t = args[0] && mapType(args[0], ctx);
      if (!t || t.kind !== "string") return null;
    }
    const shellArms = [NULL_T, STRING].sort((a, b) => (typeKey(a) < typeKey(b) ? -1 : 1));
    const shell: IrType = { kind: "union", unionId: ctx.unions.intern(shellArms) };
    return {
      kind: "record",
      shapeId: ctx.shapes.intern(
        [
          { name: "gid", type: F64 },
          { name: "homedir", type: STRING },
          { name: "shell", type: shell },
          { name: "uid", type: F64 },
          { name: "username", type: STRING },
        ],
        false,
        undefined,
        ["uid", "gid", "username", "homedir", "shell"],
      ),
    };
  }
  // crypto.X509Certificate — the Dirent-style data record: THREE visible
  // fields (fingerprint and the validFrom/validTo validity window, all
  // computed at construction by the new-expression lowering). Module-
  // checked like SecureContext; @types/node declares the class inside
  // `declare module "crypto"`, the shipped fallback mirrors it.
  // JSON.stringify of one shows the three fields where Node's
  // internal-slot object shows {} — the Dirent %dtype edge's cousin.
  if (
    psym?.name === "X509Certificate" &&
    checker.declarationsOf(psym).some(
      (d) =>
        (ts.isInterfaceDeclaration(d) || ts.isClassDeclaration(d)) &&
        ctx.isStdlibFile(d.getSourceFile()) &&
        isDeclaredInAmbientModule(d, "crypto"),
    )
  ) {
    return {
      kind: "record",
      shapeId: ctx.shapes.intern(
        [
          { name: "fingerprint", type: STRING },
          { name: "validFrom", type: STRING },
          { name: "validTo", type: STRING },
        ],
        false,
        undefined,
        ["fingerprint", "validFrom", "validTo"],
      ),
    };
  }
  // process.cpuUsage()/threadCpuUsage()'s {user, system} microsecond
  // record and resourceUsage()'s getrusage record — stdlib data
  // interfaces interned explicitly (the RemoteInfo pattern; declared
  // order is Node's own construction order, so Object.keys agrees).
  if (isStdlibInterface("CpuUsage")) {
    return {
      kind: "record",
      shapeId: ctx.shapes.intern(
        [
          { name: "system", type: F64 },
          { name: "user", type: F64 },
        ],
        false,
        undefined,
        ["user", "system"],
      ),
    };
  }
  if (isStdlibInterface("ResourceUsage")) {
    const names = [
      "userCPUTime", "systemCPUTime", "maxRSS", "sharedMemorySize",
      "unsharedDataSize", "unsharedStackSize", "minorPageFault",
      "majorPageFault", "swappedOut", "fsRead", "fsWrite", "ipcSent",
      "ipcReceived", "signalsCount", "voluntaryContextSwitches",
      "involuntaryContextSwitches",
    ];
    return {
      kind: "record",
      shapeId: ctx.shapes.intern(
        [...names].sort().map((name) => ({ name, type: F64 })),
        false,
        undefined,
        names,
      ),
    };
  }
  if (isStdlibInterface("RemoteInfo")) {
    return {
      kind: "record",
      shapeId: ctx.shapes.intern(
        [
          { name: "address", type: STRING },
          { name: "family", type: STRING },
          { name: "port", type: F64 },
          { name: "size", type: F64 },
        ],
        false,
        undefined,
        ["address", "family", "port", "size"],
      ),
    };
  }
  // os.NetworkInterfaceInfoIPv4/IPv6 (the arms of networkInterfaces()'s
  // NetworkInterfaceInfo union): stdlib data interfaces interned explicitly,
  // the AddressInfo pattern. The family literal types widen to string
  // (RemoteInfo's rule); IPv4's optional scopeid is the undefined-armed
  // union (holding undefined at runtime — Node omits the key), IPv6's is a
  // plain number. Declared order is Node's runtime insertion order
  // (lib/os.js builds address..cidr then appends scopeid), so Object.keys
  // over a row answers exactly Node.
  if (isStdlibInterface("NetworkInterfaceInfoIPv4") || isStdlibInterface("NetworkInterfaceInfoIPv6")) {
    const v6 = psym!.name === "NetworkInterfaceInfoIPv6";
    const cidrArms = [NULL_T, STRING].sort((a, b) => (typeKey(a) < typeKey(b) ? -1 : 1));
    const cidr: IrType = { kind: "union", unionId: ctx.unions.intern(cidrArms) };
    const scopeid = v6 ? F64 : withUndefinedArm(F64, ctx.unions);
    if (!scopeid) return null;
    const fields = [
      { name: "address", type: STRING },
      { name: "cidr", type: cidr },
      { name: "family", type: STRING },
      { name: "internal", type: BOOL },
      { name: "mac", type: STRING },
      { name: "netmask", type: STRING },
      { name: "scopeid", type: scopeid },
    ];
    return {
      kind: "record",
      shapeId: ctx.shapes.intern(fields, false, undefined, [
        "address", "netmask", "family", "mac", "internal", "cidr", "scopeid",
      ]),
    };
  }
  // PromiseSettledResult<T>'s two parts, mapped WHOLE. They used to intern
  // one shared `{ status: string }` — the honest subset — because `value`
  // and `reason` had no field representation: a `void` value has no slot,
  // and an `any` reason would have absorbed the record as an island handle.
  // Neither still holds in the static tier: `any` is dyn there and dyn
  // FIELDS map (the record walk's own rule), and a void value is the unit
  // it actually is at runtime — `undefined` — which rides the unit-only
  // union exactly like a `{ v: undefined }` field.
  //
  // Keeping them apart is what makes the union a real discriminated pair
  // (`r.status === "fulfilled"` narrows to the arm carrying `value`), which
  // is the whole point of Promise.allSettled's result.
  if (isStdlibInterface("PromiseFulfilledResult")) {
    const targ = checker.getTypeArguments(widened as ts.TypeReference)[0];
    const mapped = targ ? mapType(targ, ctx) : null;
    const valueT = mapped?.kind === "void" ? unitOnlyUnion(unions) : mapped;
    if (!valueT) return null;
    return {
      kind: "record",
      shapeId: ctx.shapes.intern(
        [{ name: "status", type: STRING }, { name: "value", type: valueT }],
        false,
        undefined,
        ["status", "value"],
      ),
    };
  }
  if (isStdlibInterface("PromiseRejectedResult")) {
    return {
      kind: "record",
      shapeId: ctx.shapes.intern(
        [{ name: "reason", type: DYN }, { name: "status", type: STRING }],
        false,
        undefined,
        ["status", "reason"],
      ),
    };
  }
  // Function types: exactly one call signature, no generics, and every
  // parameter positional — the supported closure surface. OPTIONAL
  // parameters (`ctx?: T` — no initializer, no rest) map as their
  // checker-given `T | undefined` union: optionality lives entirely in the
  // parameter TYPE, exactly the optional-record-field rule, and a call
  // that omits the argument completes it with the undefined arm (the
  // lowerer's trailing completion). DEFAULTED parameters (`x: T = e`) map
  // the same way — the completed-signature contract: the TYPE spells
  // `T | undefined`, the default's VALUE lives in the closure body's own
  // prologue (declareParams), and the undefined arm is what triggers it.
  // Rest parameters keep the fence (a rest signature is never spellable
  // as one completed arity).
  // The chalk-style FUNCTION-WITH-PROPERTIES hybrid: an intersection of
  // exactly one callable part with plain data-property parts (`F & { bold:
  // F }` — Object.assign(fn, {...})'s type) maps to a RECORD carrying the
  // callable in a reserved `%call` field ('%' cannot appear in a TS
  // property name, so no user field collides). Calls through the value
  // read the slot (lowerRecordFieldCall / the call-value path), extraction
  // into a plain F slot reads it too (coerceToExpected), and Object.assign
  // constructs the record. Intersections that don't fit fall through to
  // the plain-func mapping below (historic behavior: the properties drop
  // from the type).
  if (widened.isIntersectionType() && checker.getConstructSignatures(widened).length === 0) {
    const hybrid = mapHybridCallableIntersection(widened, ctx);
    if (hybrid) return hybrid;
  }
  const callSigs = checker.getCallSignatures(widened);
  if (callSigs.length === 1) {
    const sig = callSigs[0]!;
    // A GENERIC signature has no single calling convention of its own, but
    // one instantiation is always honest: every type parameter bound to
    // its CONSTRAINT. The body type-checks for every type satisfying the
    // constraint, so the constraint itself is among them — the rule
    // genericCallInstance already applies to an overload-selected call.
    // That makes the emitter idiom (`<K extends keyof M>(e: K, p: M[K])
    // => void` held in a record slot and called through it) a concrete
    // func type. Both resolvers are installed: the ts-level twin is what
    // lets an indexed access `M[K]` resolve (see TypeParamTsResolver).
    // An UNCONSTRAINED parameter has no widest honest binding — unmapped,
    // exactly as before.
    if (sig.getTypeParameters().length) {
      // Mapping the CONSTRAINTS is itself speculative: one may map (minting
      // a recursive placeholder) and a later one fail, and the null answer
      // would leave that placeholder for another mapping to pick up.
      const uMark = ctx.unions.mark();
      const sMark = ctx.shapes.mark();
      const erased = constraintErasedCtx(sig, ctx);
      if (!erased) {
        ctx.unions.rollback(uMark);
        ctx.shapes.rollback(sMark);
        return null;
      }
      ctx = erased;
    }
    // A SYNTHESIZED rest param (tsc's JS inference for a function body
    // reading `arguments` — `(...args: any[]) => any` whose args symbol
    // has no declaration): the dotDotDot check below can't see it, and a
    // fixed-arity func mapping would LIE about the value's calling
    // convention. Detected by the param-count mismatch against the
    // signature's own declaration; unmappable like spelled rest.
    {
      const sigDecl = checker.signatureDeclaration(sig);
      const declParams = sigDecl !== undefined && ts.isFunctionLike(sigDecl) ? sigDecl.parameters : undefined;
      if (declParams !== undefined && declParams.length !== sig.getParameters().length) {
        return null;
      }
      // tsgo never SYNTHESIZES that rest param into the inferred signature
      // (5.9.3 did — the count mismatch above was the whole detector
      // there), so the declaration's own body answers directly.
      if (sigDecl !== undefined && ts.isFunctionLike(sigDecl) && bodyReadsArgumentsLocal(sigDecl as { body?: ts.Node })) {
        return null;
      }
    }
    const params: IrType[] = [];
    for (const p of sig.getParameters()) {
      const decl = checker.valueDeclarationOf(p);
      if (decl && ts.isParameter(decl) && decl.dotDotDotToken) {
        // The TRAILING rest slot IS an array in the compiled calling
        // convention — a declared `function f(...xs: T[])` already takes
        // one (ParamShape's "rest" mode). Spelling it here lets the
        // SIGNATURE map too, so a rest function can flow as a value;
        // callers pack the surplus arguments (restPackArity). A rest bound
        // to a TUPLE has no single element type and keeps the fence.
        const restT = mapType(checker.getTypeOfSymbol(p), ctx);
        if (process.env["SCRIPTC_REST_WHY"] !== undefined) {
          console.error(`[restwhy] ${p.name}: ts=${checker.typeToString(checker.getTypeOfSymbol(p)).slice(0,70)} -> ir=${restT?.kind ?? "null"}`);
        }
        // A rest bound to a TUPLE of known length is FIXED ARITY in
        // disguise: `...args: Parameters<M[K]>` over a key map whose
        // handlers all take the same count spells exactly that many
        // positional parameters. Expand them — one slot per position,
        // union-per-position when the erasure left a union of tuples — so
        // the signature keeps a calling convention instead of fencing.
        // Tuples of DIFFERING length keep the fence: there is no single
        // honest arity to compile.
        if (restT !== null && restT.kind !== "array" && restT.kind !== "dyn") {
          const positional = tupleArityExpansion(restT, ctx);
          if (positional === null) return null;
          params.push(...positional);
          continue;
        }
        if (!restT || (restT.kind !== "array" && restT.kind !== "dyn")) return null;
        params.push(restT);
        continue;
      }
      const optional =
        decl !== undefined &&
        ts.isParameter(decl) &&
        (decl.questionToken !== undefined || decl.initializer !== undefined);
      let pt = mapType(checker.getTypeOfSymbol(p), ctx);
      // Belt and braces for non-strict type worlds: an optional param's
      // ABI slot is always the undefined-armed union (strictNullChecks
      // already spells it that way; arm it here if the world didn't).
      if (optional && pt && pt.kind !== "void" && pt.kind !== "jsval") {
        const armed = withUndefinedArm(pt, ctx.unions);
        if (!armed) return null;
        pt = armed;
      }
      if (!pt) {
        mapTrace(`FNPARAM ${checker.typeToString(type).slice(0, 46)} . ${p.name} : ${checker.typeToString(checker.getTypeOfSymbol(p)).slice(0, 60)}`);
        return null;
      }
      // `(value: void) => void` (Promise<void>'s resolve) is callable with
      // no arguments — a void param is dropped, not a mapping failure.
      if (pt.kind === "void") continue;
      params.push(pt);
    }
    const retT = checker.getReturnTypeOfSignature(sig);
    // `() => never` (a throw-only lambda's inferred type) is assignable to
    // `() => void` and its calls never produce a value — map the return
    // like declaredReturnType does for declarations.
    const ret = retT.flags & ts.TypeFlags.Never ? VOID : mapType(retT, ctx);
    if (!ret) {
      mapTrace(`FNRET ${checker.typeToString(type).slice(0, 46)} -> ${checker.typeToString(retT).slice(0, 60)}`);
      return null;
    }
    return funcOf(params, ret);
  }
  // Records: object types whose members are all data properties (shorthand
  // methods in type position count — they're func-typed fields) with
  // mappable types; no call/construct signatures, no index signatures, not
  // a tuple, and declared in USER code (lib interfaces like
  // Function/Object/Iterable stay unmapped — the standard-library types are
  // a type world, not data shapes). Optional properties (`a?: T`) need no special handling: under
  // strictNullChecks the checker types them `T | undefined`, so the field
  // maps to an undefined-armed union — optionality lives entirely in the
  // field TYPE, which is also what keeps `{a: string}` and `{a?: string}`
  // distinct interned shapes (and makes `{a?: string}` and
  // `{a: string | undefined}` deliberately the SAME shape, matching tsc's
  // mutual assignability without exactOptionalPropertyTypes). Two
  // structurally identical types intern to one shapeId.
  //
  // Mapped-type results (`Partial<Config>`, `Record<"a" | "b", number>`,
  // Pick/Omit spellings) and intersections of object types resolve through
  // the SAME path: the member walk below asks the checker for the resolved
  // property list, so a utility type interns the identical shape its
  // longhand spelling would. Intersections are a distinct TypeFlag, hence
  // the widened condition.
  // A USER-declared child-process-shaped interface (the ngrok
  // NgrokChildProcess idiom — `spawn(...) as NgrokChildProcess`, declared
  // so tests can hand in mocks): every member is named on the lowered
  // ChildProcess surface AND at least two are the handle-defining ones
  // (kill/on/stdout/stderr/unref/exitCode — a data record like
  // `{ pid: number }` never qualifies). The TYPE maps to the child
  // handle: in a compiled program the only VALUE producer is spawn
  // itself (a mock object literal in this slot fences at its
  // construction site), and every member the interface may declare is
  // exactly a lowered child member, so uses typecheck against the
  // interface and lower against the handle.
  if (
    flags & ts.TypeFlags.Object &&
    callSigs.length === 0 &&
    psym !== undefined &&
    checker.declarationsOf(psym).length > 0 &&
    checker.declarationsOf(psym).every(
      (d) => ts.isInterfaceDeclaration(d) && !ctx.isStdlibFile(d.getSourceFile()),
    )
  ) {
    const CHILD_SURFACE = new Set([
      "pid", "exitCode", "killed", "kill", "on", "once", "off",
      "removeListener", "unref", "ref", "stdout", "stderr",
    ]);
    const CHILD_CORE = new Set(["kill", "on", "stdout", "stderr", "unref", "exitCode"]);
    const props = checker.getPropertiesOfType(widened);
    let core = 0;
    const childShaped =
      props.length > 0 &&
      props.every((p) => {
        if (!CHILD_SURFACE.has(p.name)) return false;
        if (CHILD_CORE.has(p.name)) core++;
        return true;
      });
    if (childShaped && core >= 2) return CHILD_T;
  }
  if (flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection) && callSigs.length === 0) {
    const viaAlias = mapGenericUtilityAlias(widened, ctx);
    if (viaAlias) return viaAlias;
    const record = mapRecordType(widened, ctx);
    if (record) return record;
  }
  // Unions. `boolean` is internally `true | false`, and narrowing produces
  // literal unions like `"a" | "b"` — parts that map to the SAME IR type
  // collapse (deduplicated by typeKey), so a single surviving arm is just
  // that type. Two or more distinct arms become a TAGGED union: the
  // typeKey-sorted arm list is interned (its identity), and an arm's index
  // in that list is its runtime tag. `undefined` and `null` PARTS become
  // the unit arms undefinedT/nullT — strictNullChecks spells optionality
  // as exactly these unions (`string | undefined`, `number | null`), and
  // union membership is the only position where the units are
  // representable. Deliberately unmapped: any other unmappable part
  // (poisons the union), void parts, func arms (closure identity vs tag
  // interplay, later). RECURSIVE unions (`type Tree = Leaf | { children:
  // Tree[] }`, the optional-field spelling `a?: A` of a mutually recursive
  // pair) map as NAMED RECURSIVE UNIONS: a back-reference to an in-progress
  // union answers a placeholder id whose arms fill in when this frame
  // completes — the ShapeRegistry knot, mirrored (identity per checker
  // type; context-sensitive frames stay fenced).
  if (widened.isUnionType()) {
    // Every arm a TUPLE over one element type: the union is an ARRAY of
    // that type. A table of fixed-length literal rows is what this is in
    // practice, and the only thing the arms disagree on is LENGTH, which
    // the array representation carries at runtime anyway. Each arm maps
    // on its own already; without this the union of them had none, so
    // reading a row out of such a table fenced on a value whose every
    // possible shape was compilable.
    {
      const rows = uniformTupleUnionElem(widened, ctx);
      if (rows !== null) return arrayOf(rows);
    }
    const knownRecursive = unions.recursiveUnionFor(widened);
    if (knownRecursive !== undefined) {
      // A placeholder whose frame failed is POISONED, not empty: refuse the
      // type rather than answer a union the program never had.
      if (unions.isPoisoned(knownRecursive)) return null;
      return { kind: "union", unionId: knownRecursive };
    }
    if (unions.inProgress.has(widened)) {
      return { kind: "union", unionId: unions.recursiveRef(widened) };
    }
    unions.inProgress.add(widened);
    const sensitivityAtEntry = contextResolutions;
    // A FAILED union frame is the one moment its placeholder is known to be
    // orphaned: no later frame will finalize it, and anything interned
    // during the attempt reached the program only through this union. Mark
    // here and roll back on failure — a during-mapping test cannot tell an
    // orphan from a legitimately in-flight placeholder (ordinary fields
    // hold those constantly), so the distinction has to be made where the
    // failure is observed.
    // Rolling the whole frame back is too broad: shapes interned while it
    // ran are reachable from elsewhere, and discarding them makes this very
    // union stop mapping. Only the placeholder THIS frame left behind is
    // known to be garbage.
    const hadPlaceholder = unions.recursivePending(widened);
    let frameOk = false;
    try {
      // The unit-literal value a type pins, or null if it is not one. Two
      // arms that pin DIFFERENT unit values are mutually exclusive — the
      // discriminant witness an uninhabited intersection turns on.
      const unitValue = (t: ts.Type): string | null =>
        t.isStringLiteralType() ? `s:${t.value}` : t.isNumberLiteralType() ? `n:${t.value}` : null;
      // An intersection is UNINHABITED when two of its object constituents
      // require the same property at disjoint unit-literal types — the
      // classic `DiscriminatedUnion & { kind: 'x' }` after distribution,
      // where the non-matching members become `{ kind: 'a' } & { kind: 'x'
      // }`. The checker keeps that as an Intersection (not a `never` flag)
      // and drops the contradictory key, so getPropertiesOfType is empty
      // and only the constituents carry the witness. REQUIRED occurrences
      // only: an optional side can be satisfied by omission. Conservative —
      // it never reports an inhabited type uninhabited, so a miss just
      // keeps the existing fence.
      const intersectionUninhabited = (part: ts.Type): boolean => {
        if (!part.isIntersectionType()) return false;
        const pinned = new Map<string, string>();
        for (const member of part.getTypes()) {
          for (const p of checker.getPropertiesOfType(member)) {
            if (p.flags & ts.SymbolFlags.Optional) continue;
            const v = unitValue(checker.getTypeOfSymbol(p));
            if (v === null) continue;
            const prev = pinned.get(p.name);
            if (prev !== undefined && prev !== v) return true;
            pinned.set(p.name, v);
          }
        }
        return false;
      };
      const byKey = new Map<string, IrType>();
      for (const part of widened.getTypes()) {
        // An UNINHABITED arm contributes no runtime value — `T | never ≡ T`
        // — so elide it rather than fence (or, for a bare `never`, rather
        // than pollute the union with never's f64 placeholder slot).
        if (part.flags & ts.TypeFlags.Never || intersectionUninhabited(part)) {
          continue;
        }
        // A `void` PART is inhabited only by undefined (`Promise<void> |
        // void` return types, `string | void`): it becomes the undefinedT
        // unit arm, exactly like an undefined part — the value either
        // exists or is undefined, and the union tag is the test. Standalone
        // void stays VOID (the return-position mapping above).
        if (part.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Void)) {
          byKey.set(typeKey(UNDEFINED_T), UNDEFINED_T);
          continue;
        }
        if (part.flags & ts.TypeFlags.Null) {
          byKey.set(typeKey(NULL_T), NULL_T);
          continue;
        }
        const mapped = mapType(part, ctx);
        // A jsval PART absorbs the union: `GeneratedFile | undefined` (a
        // package-declared arm) is one island handle — the engine's
        // undefined/null ARE handle values, and any data sibling is
        // representable in the engine too, so the handle is the one
        // runtime representation. Exactly tsc's own collapse for `any | T`
        // (which never even reaches here as a union). Sibling arms that
        // already mapped don't matter — and ones that would NOT map on
        // their own don't block the absorb either: a STATIC value of such
        // an arm flowing in still fences per-site at the marshal
        // (jsvalIn's boundary message).
        if (mapped?.kind === "jsval") return JSVAL;
        if (!mapped) {
          // Before failing the whole union, let a LATER jsval part absorb.
          for (const rest of widened.getTypes()) {
            if (mapType(rest, ctx)?.kind === "jsval") return JSVAL;
          }
          mapTrace(
            `UNIONARM ${checker.typeToString(widened).slice(0, 60)} . arm ` +
              `${checker.typeToString(part).slice(0, 90)}`,
          );
          return null;
        }
        // A UNION arm is a nested union. That is a shape the IR has no slot
        // for, but it is NOT an ambiguity: `(A | B) | C` IS `A | B | C`, and
        // ts flattens exactly that for every union it can SEE. What reaches
        // here is a SUBSTITUTED arm — a type parameter bound to a union
        // (mapTypeInner's resolveTypeParam hook), an intersection or a
        // narrowed parameter that mapped to one — which no ts-level
        // flattening can reach, because the nesting only exists after the
        // binding is applied. Splice its arms in, so the home rules below
        // judge the FLAT arm set: that set is exactly what a runtime tag has
        // to tell apart, and it is the same set the caller's own union
        // already carries.
        // A PENDING placeholder is the one union that cannot be flattened:
        // a back-reference minted its id and the frame that fills its arms
        // is still running, so there is nothing to splice. It keeps the
        // fence.
        if (mapped.kind === "union") {
          const inner = unions.get(mapped.unionId);
          if (inner !== undefined && !unions.isPending(mapped.unionId) && inner.arms.length > 0) {
            unionArmFlattens++;
            if (process.env["SCRIPTC_FLATTEN_WHY"] !== undefined) {
              console.error(
                `[flattenwhy] #${unionArmFlattens} ${checker.typeToString(widened).slice(0, 70)}` +
                  ` . arm ${checker.typeToString(part).slice(0, 40)} -> ${inner.arms.length} arms`,
              );
            }
            for (const innerArm of inner.arms) byKey.set(typeKey(innerArm), innerArm);
            continue;
          }
        }
        byKey.set(typeKey(mapped), mapped);
      }
      const arms = [...byKey.values()];
      // Every arm elided as uninhabited: the union itself is `never`. It has
      // no reachable value (the checker would have flagged a spelled-out
      // never before this), so the f64 placeholder — never's standalone
      // slot — stands in for the unobservable value.
      if (arms.length === 0) return F64;
      // A single surviving UNIT arm cannot stand alone (degenerate — the
      // checker collapsed everything else away); anything else single is
      // just that type. A single arm UNDER A MINTED PLACEHOLDER cannot
      // stand either: back-references already handed out the union id, and
      // a one-armed union has no representation — fence the degenerate
      // recursive spelling honestly.
      if (arms.length === 1 && isUnitType(arms[0]!)) return null;
      if (arms.length === 1) {
        if (unions.recursivePending(widened)) return null;
        return arms[0]!;
      }
      // ALL-PROMISE UNIONS COLLAPSE INTO ONE PROMISE. A ternary whose two
      // arms are promises types as `Promise<A> | Promise<B>` — the shape
      // `cond ? Promise.resolve(null) : requirePreKey(...)` takes, and one
      // of the commonest ways to spell an optional async lookup. The
      // union-home rules below refuse a second promise arm, and rightly:
      // two promises are both `typeof "object"`, so no runtime test could
      // tell the arms apart.
      //
      // But nothing ever has to tell them apart. `Promise<A> | Promise<B>`
      // and `Promise<A | B>` have the SAME inhabitants — a promise that
      // settles to an A or to a B — and the same consumers: a promise is
      // write-only from the producer and read-only through `await`/`then`,
      // so no operation can observe WHICH arm a value came from, only what
      // it settles to. Collapsing to one promise over the union of the
      // payloads is therefore not a widening; it is the same type spelled
      // so the IR can hold it.
      //
      // The payload union comes from the checker (`getAwaitedType`
      // distributes over the union), NOT from stitching the mapped arms
      // together: that way the payload takes the ORDINARY union mapping
      // with every one of its home rules intact, so a payload union that
      // genuinely has no representation (`Promise<Map<K,V>> |
      // Promise<string>`) still fences instead of being smuggled in
      // through the promise.
      //
      // Gated on every arm being a promise over a NON-promise payload:
      // getAwaitedType unwraps recursively, so a nested promise arm would
      // have its payload flattened past a level the IR does keep.
      if (
        arms.length >= 2 &&
        arms.every((a) => a.kind === "promise" && a.inner.kind !== "promise") &&
        !unions.recursivePending(widened)
      ) {
        // The payload arms, deduped by key exactly as the outer union
        // deduped its own. (`getAwaitedType` cannot answer here: the ts7
        // facade cannot BUILD a union type, so a union whose arms unwrap
        // to more than one distinct type returns undefined by design. The
        // arms are already mapped, so the payload set is in hand.)
        //
        // Computed PART BY PART, under the same unit rule the outer union
        // loop uses a hundred lines up: a `null` PART contributes the NULL_T
        // arm, an `undefined`/`void` PART the UNDEFINED_T one. That symmetry
        // is load-bearing here. STANDALONE `null` maps to the unit-only
        // union (`null | undefined`), because a lone unit arm has no home of
        // its own; splicing THAT mapping in as `Promise<null>`'s payload
        // gives `Promise<null> | Promise<boolean>` the payload
        // `bool | null | undefined`, while `Promise<boolean | null>` — the
        // same type, one spelling apart — gets `bool | null`. Two IR types
        // for one type is what made `Promise.all`'s tuple-field comparison
        // decline zapo's `cond ? Promise.resolve(null) : requirePreKey(...)`
        // (SignalProtocol.ts:441): the collapse landed, the payload was one
        // arm wider than the position the checker typed, and the entry could
        // not be matched against its own result tuple.
        //
        // Only NULL and UNDEFINED payloads take the part-wise rule. A `void`
        // payload keeps whatever its standalone mapping gives, so
        // `Promise<void> | Promise<T>` refuses exactly as it did before.
        const payloadByKey = new Map<string, IrType>();
        let payloadSpliceable = true;
        for (const part of widened.getTypes()) {
          if (part.flags & ts.TypeFlags.Never || intersectionUninhabited(part)) continue;
          const awaited = checker.getAwaitedType(part);
          if (awaited !== undefined && (awaited.flags & ts.TypeFlags.Undefined) !== 0) {
            payloadByKey.set(typeKey(UNDEFINED_T), UNDEFINED_T);
            continue;
          }
          if (awaited !== undefined && (awaited.flags & ts.TypeFlags.Null) !== 0) {
            payloadByKey.set(typeKey(NULL_T), NULL_T);
            continue;
          }
          const a = mapType(part, ctx);
          if (a === null || a.kind !== "promise") {
            payloadSpliceable = false;
            break;
          }
          // Mirror the outer branch's nested-union SPLICE. A payload is
          // often ALREADY a union — `Promise<A | B>` beside `Promise<C>` is
          // a three-arm payload. `(A | B) | C` IS `A | B | C`, and the flat
          // set is exactly what a runtime tag has to tell apart. A PENDING
          // placeholder cannot be spliced (the frame filling its arms is
          // still running), so it keeps the fence rather than contributing
          // an empty arm set.
          if (a.inner.kind === "union") {
            const inner = unions.get(a.inner.unionId);
            if (inner === undefined || unions.isPending(a.inner.unionId) || inner.arms.length === 0) {
              payloadSpliceable = false;
              break;
            }
            for (const innerArm of inner.arms) payloadByKey.set(typeKey(innerArm), innerArm);
            continue;
          }
          payloadByKey.set(typeKey(a.inner), a.inner);
        }
        if (!payloadSpliceable) return null;
        const payloadArms = [...payloadByKey.values()];
        let payload: IrType | null = null;
        if (payloadArms.length === 1) {
          // Distinct promise types over the SAME payload: `Promise<T>` in
          // two spellings. One promise, no union needed.
          payload = payloadArms[0]!;
        } else if (unionArmsHaveHomes(payloadArms, unions)) {
          // The payload earns its union home under the SAME rules a union
          // spelled directly must satisfy — arriving inside a promise
          // grants nothing.
          const sorted = [...payloadArms].sort((a, b) => (typeKey(a) < typeKey(b) ? -1 : 1));
          payload = { kind: "union", unionId: unions.intern(sorted) };
        }
        if (process.env["SCRIPTC_PROMUNION_WHY"] !== undefined) {
          console.error(
            `PROMUNION ${checker.typeToString(widened).slice(0, 70)} arms=${arms.length}` +
              ` -> ${payload === null ? "<refused>" : `promise<${typeKey(payload).slice(0, 60)}>`}`,
          );
        }
        if (payload === null) return null;
        mapTrace(`PROMISEUNION ${checker.typeToString(widened).slice(0, 70)} -> promise<${typeKey(payload).slice(0, 50)}>`);
        return { kind: "promise", inner: payload };
      }
      // The `string | object`-family COLLAPSE (world unification lane 3):
      // a union with an 'object'/'unknown'/`{}`-flavored arm (dyn) beside
      // arms the checked-dynamic representation FAITHFULLY holds maps to
      // DYN WHOLESALE — the checked-dynamic tree's scalar kinds ARE the scalar arms (===,
      // typeof, switch dispatch all exact), typeof/Array.isArray/unit
      // narrowing on dyn already dispatches natively (dynTest +
      // maybeNarrow's validated scalar extraction), and engine-valued
      // arms ride the island kind (SCR_DYN_JSVAL), so no per-arm runtime
      // tag is ever needed and the component fence retires at these
      // sites. The domain is dynSubsumableUnionArm's: scalars, units, dyn
      // itself, and records/arrays inside the dynFrom conversion domain
      // (those enter as dyn data — the deep-copy stance, so identity and
      // mutation coupling with the source value end at the slot;
      // SEMANTICS.md). Arms with real typed representations whose
      // semantics would DEGRADE under the collapse — class instances,
      // Maps/Sets, functions (closure identity, `x === String`
      // narrowing), promises, regexes, generators, handles — keep their
      // existing union homes and fences below. A pending recursive
      // placeholder cannot collapse (back-references already hold the
      // union id); the degenerate recursive spelling keeps its fence.
      if (
        arms.some((a) => a.kind === "dyn") &&
        arms.every((a) => dynSubsumableUnionArm(a, ctx)) &&
        !unions.recursivePending(widened)
      ) {
        return DYN;
      }
      if (!unionArmsHaveHomes(arms, unions)) {
        return null;
      }
      arms.sort((a, b) => (typeKey(a) < typeKey(b) ? -1 : 1));
      if (unions.recursivePending(widened)) {
        // The knot closed through this union. A frame that resolved
        // through context-sensitive hooks (generic type parameters, mixin
        // instantiations) cannot intern by checker-type identity — the
        // same ts.Type answers differently per instantiation — so
        // recursive generic-open unions stay fenced.
        if (contextResolutions !== sensitivityAtEntry) {
          // The frame refuses to CACHE by checker-type identity (the same
          // ts.Type answers differently per instantiation), so the type
          // stays fenced. But the placeholder was already handed to a
          // back-reference, and `arms` above are this frame's real,
          // fully-mapped arms — fill it in with them. Leaving it empty
          // would strand a degenerate union in whatever already holds it;
          // inventing arms would strand a false one.
          if (arms.length >= 2) {
            const id = unions.finalizeRecursive(widened, arms);
            const answer: IrType = { kind: "union", unionId: id };
            if (referencesPendingPlaceholder(answer, unions, ctx.shapes) !== null) return null;
            frameOk = true;
            return answer;
          }
          return null;
        }
        frameOk = true;
        return { kind: "union", unionId: unions.finalizeRecursive(widened, arms) };
      }
      frameOk = true;
      return { kind: "union", unionId: unions.intern(arms) };
    } finally {
      unions.inProgress.delete(widened);
      // A frame that failed AFTER a back-reference minted its placeholder
      // leaves an id nothing will ever finalize; whatever already holds it
      // would reach the validator as a union with no arms. Discard it here
      // — the one moment the orphaning is observable.
      if (!frameOk && !hadPlaceholder && unions.recursivePending(widened)) {
        unions.poisonPendingPlaceholder(widened);
      }
    }
  }
  return null;
}

/** The narrowed-type-parameter recognizer behind mapType's early return:
 * a union/intersection over exactly ONE type parameter whose companions
 * are all `{}`-empty shapes or the null/undefined units. Returns the
 * bound type filtered to the arms the companions allow, null when the
 * pattern matches but cannot map (unbound parameter, nothing left), and
 * undefined when the type is not this pattern at all (the caller falls
 * through to the ordinary mapping). */
/** The SETTLE-OR-VALUE union around a promise arm: every other arm is one of
 * the promise's own PAYLOAD arms, and together they are exactly that payload.
 * `Promise<T> | T` is the two-arm case; `Promise<T | null> | T | null` — what
 * a persistence hook takes — is the same contract with a union payload.
 *
 * `await` is the only consumer such a union has, and it needs no narrowing
 * test: the union's tag picks the branch, and the data branch re-tags its arm
 * into the payload (the Lowerer's settleOrValueAwait). Nothing else can tell
 * the arms apart, which is why the shape must match EXACTLY rather than merely
 * overlap. */
export function settleOrValueArms(
  promiseArm: IrType & { kind: "promise" },
  arms: readonly IrType[],
  unions: UnionRegistry,
): boolean {
  const payload = promiseArm.inner;
  const payloadArms =
    payload.kind === "union" ? (unions.get(payload.unionId)?.arms ?? []) : [payload];
  const others = arms.filter((c) => c !== promiseArm);
  return (
    payloadArms.length > 0 &&
    others.length === payloadArms.length &&
    others.every((c) => payloadArms.some((q) => typeEquals(q, c)))
  );
}

/** How deep the symbolic-candidate gate looks through type arguments. A
 * type parameter buried deeper than this reads as "not symbolic" — the
 * conservative direction: the gate declining costs today's diagnostic. */
const SYMBOLIC_GATE_DEPTH = 3;

/** Is this a type that could need the instantiation side table — i.e. a
 * type written in terms of a generic's own type parameters, which the
 * checker therefore keeps symbolic inside the body?
 *
 * Deliberately SYNTACTIC and cheap: alias and reference type ARGUMENTS
 * only, no property walks, no signature queries. Two reasons.
 *
 *  - It runs on every type mapped inside an instantiated body, and the
 *    memo exists because checker round trips are the compiler's dominant
 *    cost (see mapTypeMemo). A gate that queried properties would pay that
 *    cost back at every site.
 *  - Admitting a type here BUMPS memoSensitivity, which costs a cache
 *    entry. Narrow is cheap; wide is a global slowdown.
 *
 * Bare type PARAMETERS are excluded: mapTypeInner's own first branch owns
 * them and has already answered by the time this runs. */
function symbolicCandidate(type: ts.Type, checker: TypeMapperCtx["checker"], depth = 0): boolean {
  if (type.flags & ts.TypeFlags.TypeParameter) return depth > 0;
  if (depth > SYMBOLIC_GATE_DEPTH) return false;
  const aliasArgs = type.getAliasTypeArguments() ?? [];
  for (const a of aliasArgs) if (symbolicCandidate(a, checker, depth + 1)) return true;
  if (type.isTypeReference()) {
    for (const a of checker.getTypeArguments(type)) {
      if (symbolicCandidate(a, checker, depth + 1)) return true;
    }
  }
  return false;
}

/** The STRICT gate, for the collector that BUILDS the table
 * (lower-calls.ts). The cheap gate above is deliberately a SUPERSET of this
 * one — it runs on every type mapped inside an instantiated body, so it has
 * to stay syntactic, and a lookup it admits that the table never held
 * simply misses. Admission to the TABLE is the expensive, exact question,
 * asked once per instantiation.
 *
 * What it asks is the finding itself: does the checker hand mapType
 * literally NOTHING for this type? No properties, no index signature, no
 * call or construct signatures. That is true of `IndexArgsForSchema<S>` and
 * false of everything that already has machinery — `T[]` has the array
 * members, `Promise<T>` has then/catch/finally, `Partial<T>` over a
 * constrained parameter has the constraint's members. Those forms resolve
 * inside the body through resolveTypeParam and its siblings, and recording
 * them would be worse than useless: their resolutions would enter the
 * instance KEY and split instances that a call and a pinned value are
 * supposed to share (`const f: (xs: number[]) => number = len`), which is
 * exactly what a looser gate was measured doing to corpus 2020. */
export function isSymbolicCandidateType(type: ts.Type, checker: TypeMapperCtx["checker"]): boolean {
  if (!symbolicCandidate(type, checker)) return false;
  return (
    checker.getPropertiesOfType(type).length === 0 &&
    checker.getIndexInfosOfType(type).length === 0 &&
    checker.getCallSignatures(type).length === 0 &&
    checker.getConstructSignatures(type).length === 0
  );
}

/** A type the checker keeps SYMBOLIC inside a generic body, answered with
 * the RESOLVED type the instantiation's call site already computed.
 *
 * `IndexArgsForSchema<S>` — a key-remapped mapped type over
 * `S['indexParts'][number]` — is the shape this exists for. Asked directly,
 * the checker hands it nothing: no properties, no index signature, no
 * constraint, an apparent type equal to itself. There is no layout to read
 * and inventing one would be the plausible-shape-wrong-field failure, so
 * refusing is correct. But the SAME type resolves perfectly three frames up,
 * at the call site that created the instantiation — `IndexArgsForSchema<{
 * concrete }>` with its properties present — and that answer is what this
 * carries down.
 *
 * Two things keep a resolved layout from reaching the wrong instantiation:
 *
 *  - the table lives on the GenericInstance and is installed only while
 *    that instance's body lowers, exactly the discipline tsBindings uses;
 *  - every resolution it holds is folded into the instance KEY
 *    (symbolicResolutionKey), so two call sites that resolve the same
 *    symbolic type differently can never share one instance — which is the
 *    only way one could answer for the other.
 *
 * The memo bump comes BEFORE the refusal, not inside the hit: consulting an
 * instantiation is context-dependent whether or not the table has an entry,
 * and caching the "no entry yet" answer as if it were context-free is the
 * leak memoSensitivity was introduced for (corpus 907's `Partial<T>`). */
function mapResolvedSymbolic(type: ts.Type, ctx: TypeMapperCtx): IrType | null {
  const { resolveSymbolic, checker } = ctx;
  if (!resolveSymbolic) return null;
  if (!symbolicCandidate(type, checker)) return null;
  memoSensitivity++;
  const resolved = resolveSymbolic(type);
  if (!resolved || resolved === type) return null;
  return mapType(resolved, ctx);
}

function mapNarrowedTypeParam(type: ts.Type, ctx: TypeMapperCtx): IrType | null | undefined {
  const { checker, unions, resolveTypeParam } = ctx;
  if (!resolveTypeParam) return undefined;
  const isEmptyShape = (t: ts.Type): boolean =>
    (t.flags & ts.TypeFlags.Object) !== 0 &&
    checker.getPropertiesOfType(t).length === 0 &&
    checker.getCallSignatures(t).length === 0 &&
    checker.getConstructSignatures(t).length === 0 &&
    checker.getIndexInfosOfType(t).length === 0;
  let tp: ts.Type | null = null;
  let allowNonUnit = false;
  let allowUndefined = false;
  let allowNull = false;
  const visitCompanion = (c: ts.Type): boolean => {
    if (isEmptyShape(c)) return (allowNonUnit = true);
    if (c.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Void)) return (allowUndefined = true);
    if (c.flags & ts.TypeFlags.Null) return (allowNull = true);
    // A companion UNION (`T & ({} | null)`): each part is an allowance.
    if (c.isUnionType()) return c.getTypes().every(visitCompanion);
    return false;
  };
  const visitPart = (part: ts.Type): boolean => {
    if (!part.isIntersectionType()) return false;
    for (const p of part.getTypes()) {
      if (p.flags & ts.TypeFlags.TypeParameter) {
        if (tp && tp !== p) return false; // two different parameters: not this pattern
        tp = p;
        continue;
      }
      if (!visitCompanion(p)) return false;
    }
    return true;
  };
  const parts: readonly ts.Type[] = type.isUnionType() ? type.getTypes() : [type];
  if (!parts.every(visitPart) || !tp) return undefined;
  const bound = resolveTypeParam(tp);
  if (!bound) return null;
  if (bound.kind !== "union") return allowNonUnit ? bound : null;
  const def = unions.get(bound.unionId);
  if (!def) return null;
  const arms = def.arms.filter((a) =>
    a.kind === "undefinedT" ? allowUndefined : a.kind === "nullT" ? allowNull : allowNonUnit,
  );
  if (arms.length === 0) return null;
  if (arms.length === 1) return isUnitType(arms[0]!) ? null : arms[0]!;
  // Filtering preserves the canonical (typeKey-sorted) arm order.
  return { kind: "union", unionId: unions.intern(arms) };
}

/** `T[K]` inside a generic body, resolved through the instantiation's BOUND
 * checker types (the checker keeps indexed accesses over type parameters
 * symbolic). Object and index sides each resolve through resolveTypeParamTs
 * when they are type parameters; when the index lands on ONE literal key
 * (`K extends keyof T` bound to `"a"` — inference preserves the literal
 * there), the named property's type maps like a concrete member read. A
 * non-literal index (K bound to `string` or a key union) answers null: the
 * access has no one property type, and the per-site keyed-read machinery
 * (or its fences) owns the story. */
function mapBoundIndexedAccess(type: ts.Type, ctx: TypeMapperCtx): IrType | null {
  const { checker, resolveTypeParamTs } = ctx;
  if (!resolveTypeParamTs || !type.isIndexedAccessType()) return null;
  const resolveSide = (t: ts.Type): ts.Type | null =>
    t.flags & ts.TypeFlags.TypeParameter ? resolveTypeParamTs(t) : t;
  const objT = resolveSide(type.getObjectType());
  const idxT = resolveSide(type.getIndexType());
  if (!objT || !idxT) return null;
  const key = idxT.isStringLiteralType()
    ? idxT.value
    : idxT.isNumberLiteralType()
      ? String(idxT.value)
      : null;
  if (key === null) {
    // A CONSTRAINT-ERASED value slot indexes by the whole key union
    // (`M[K]` with K bound to `keyof M`): the parameter's honest type is
    // the UNION of the named property types — what a caller may pass. A
    // monomorphized BODY keeps the stricter one-key rule above, where a
    // single read must name a single field.
    if (ctx.indexUnionOk !== true || !idxT.isUnionType()) return null;
    const arms: IrType[] = [];
    for (const k of idxT.getTypes()) {
      const kn = k.isStringLiteralType() ? k.value : k.isNumberLiteralType() ? String(k.value) : null;
      if (kn === null) return null;
      const kprop = checker.getPropertyOfType(objT, kn);
      if (!kprop) return null;
      const armT = mapType(checker.getTypeOfSymbol(kprop), ctx);
      if (!armT || armT.kind === "void") return null;
      arms.push(armT);
    }
    // intern() takes a CANONICAL arm list — deduplicated and typeKey-sorted.
    // Distinct keys routinely carry the same payload type (an emitter whose
    // events share a shape), and passing the repeats through would mint a
    // union with identical arms, which the validator rejects as an ICE.
    const byKey = new Map<string, IrType>();
    for (const a of arms) byKey.set(typeKey(a), a);
    const canonical = [...byKey.entries()].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)).map(([, a]) => a);
    if (canonical.length === 0) return null;
    return canonical.length === 1 ? canonical[0]! : { kind: "union", unionId: ctx.unions.intern(canonical) };
  }
  const prop = checker.getPropertyOfType(objT, key);
  if (!prop) return null;
  return mapType(checker.getTypeOfSymbol(prop), ctx);
}

/** `Partial<T>` / `Readonly<T>` where T is a STILL-GENERIC type parameter —
 * the one mapped-type spelling a monomorphized body can contain that the
 * checker cannot resolve for us (`keyof T` is unknown inside the body, so
 * getPropertiesOfType returns nothing). The lowerer's binding can: Readonly
 * maps exactly like T (writes are tsc errors, trusted), and Partial arms
 * every field of T's record with undefined — precisely what the longhand
 * optional spelling produces, so the result interns to the same shape as
 * the concrete `Partial<Config>` at the call boundary. Other utility
 * aliases (Pick, Omit, Record, Required) need literal KEYS or the
 * optional/required distinction, which IR types deliberately do not carry
 * (`{a?: string}` and `{a: string | undefined}` are ONE shape) — those stay
 * unmapped inside generic bodies; their concrete uses resolve structurally
 * through mapRecordType. */
/** `Awaited<T>` where T is a STILL-GENERIC type parameter, resolved against
 * the lowerer's binding: promise kinds unwrap recursively (the alias's own
 * recursion), everything else is already its awaited self — including
 * jsval (the engine's await handles thenables natively). Null off the
 * shape (not the lib's Awaited over a bound parameter). */
/** True for a TypeNode spelling the `const` assertion (`e as const`). */
export function isConstAssertionTypeNode(t: ts.TypeNode): boolean {
  return (
    t.kind === ts.SyntaxKind.TypeReference &&
    ts.isIdentifier((t as ts.TypeReferenceNode).typeName) &&
    ((t as ts.TypeReferenceNode).typeName as ts.Identifier).text === "const"
  );
}

/** True when `n` sits inside a const assertion with only literal
 * structure between (object/array literals, property assignments,
 * parens) — the positions `as const` makes deeply readonly. */
export function underConstAssertion(n: ts.Node): boolean {
  for (let cur: ts.Node = n; cur !== undefined && !ts.isSourceFile(cur); cur = cur.parent) {
    if (ts.isAsExpression(cur)) return isConstAssertionTypeNode(cur.type);
    if (
      !ts.isPropertyAssignment(cur) &&
      !ts.isObjectLiteralExpression(cur) &&
      !ts.isArrayLiteralExpression(cur) &&
      !ts.isParenthesizedExpression(cur)
    ) {
      return false;
    }
  }
  return false;
}

/** The `aliases: []`-under-`as const` shape (see the member walk's tsgo
 * panic repair): a property symbol declared by a property assignment whose
 * initializer is an EMPTY array literal inside a const assertion — its
 * type is provably `readonly []`, whatever the panicked query answered. */
function constAssertedEmptyArrayProp(p: ts.Symbol, ctx: TypeMapperCtx): boolean {
  const d = ctx.checker.valueDeclarationOf(p);
  if (d === undefined || !ts.isPropertyAssignment(d)) return false;
  const init = d.initializer;
  // `a: [] as const` pins the field type by itself, wherever the literal sits.
  if (ts.isAsExpression(init) && isConstAssertionTypeNode(init.type)) {
    return ts.isArrayLiteralExpression(init.expression) && init.expression.elements.length === 0;
  }
  if (!ts.isArrayLiteralExpression(init) || init.elements.length > 0) return false;
  return underConstAssertion(d);
}

function mapGenericAwaitedAlias(type: ts.Type, ctx: TypeMapperCtx): IrType | null {
  const { resolveTypeParam } = ctx;
  if (!resolveTypeParam) return null;
  const alias = type.getAliasSymbol();
  if (!alias || alias.name !== "Awaited") return null;
  const aliasArgs = type.getAliasTypeArguments();
  const arg = aliasArgs[0];
  if (aliasArgs.length !== 1 || !arg) return null;
  if (!(arg.flags & ts.TypeFlags.TypeParameter)) return null;
  // Provenance: the STANDARD LIBRARY's alias, not a user's shadowing one.
  const isLibAlias = ctx.checker.declarationsOf(alias).some(
    (d) => ts.isTypeAliasDeclaration(d) && ctx.isStdlibFile(d.getSourceFile()),
  );
  if (!isLibAlias) return null;
  const bound = resolveTypeParam(arg);
  if (!bound) return null;
  let r = bound;
  while (r.kind === "promise") r = r.inner;
  return r;
}

/** `T[K]` where T is a STILL-GENERIC type parameter, resolved against the
 * lowerer's binding — the checker keeps the access symbolic inside a
 * generic body (the mockable-clock module shape: a JSDoc-generic factory
 * whose declared return carries `implementation: T[K]` members). The
 * binding decides which field types the access can name: a string-LITERAL
 * index picks its one declared field (the index signature's value type for
 * an undeclared name); an all-keys index — `keyof T` over the same
 * parameter, or an index parameter whose own binding widened to plain
 * string — covers every declared field. The mapping answers only when
 * every covered field agrees on ONE IR type (the call boundary resolved
 * the same access against the concrete T, so the shapes intern equal);
 * disagreeing fields would need a union whose arms this relation cannot
 * vouch for — those stay unmapped, keeping their fences. */
function mapGenericIndexedAccess(type: ts.Type, ctx: TypeMapperCtx): IrType | null {
  const { resolveTypeParam, shapes } = ctx;
  if (!resolveTypeParam || !type.isIndexedAccessType()) return null;
  const obj = type.getObjectType();
  if (!(obj.flags & ts.TypeFlags.TypeParameter)) return null;
  const bound = resolveTypeParam(obj);
  if (!bound || bound.kind !== "record") return null;
  const shape = shapes.get(bound.shapeId);
  if (!shape || shape.tuple) return null;
  const idx = type.getIndexType();
  let covered: IrType[] | null = null;
  if (idx.isStringLiteralType()) {
    const f = shape.fields.find((x) => x.name === idx.value);
    covered = f ? [f.type] : shape.indexValue ? [shape.indexValue] : null;
  } else {
    const allKeys =
      (idx.flags & ts.TypeFlags.TypeParameter && resolveTypeParam(idx)?.kind === "string") ||
      (idx.isIndexType() && idx.getTarget() === obj);
    if (allKeys) {
      covered = shape.fields.map((f) => f.type);
      if (shape.indexValue) covered.push(shape.indexValue);
    }
  }
  if (!covered || covered.length === 0) return null;
  const first = covered[0]!;
  return covered.every((t) => typeEquals(t, first)) ? first : null;
}

function mapGenericUtilityAlias(widened: ts.Type, ctx: TypeMapperCtx): IrType | null {
  const { resolveTypeParam, shapes, unions } = ctx;
  if (!resolveTypeParam) return null;
  const alias = widened.getAliasSymbol();
  if (!alias || (alias.name !== "Partial" && alias.name !== "Readonly")) return null;
  const aliasArgs = widened.getAliasTypeArguments();
  const arg = aliasArgs[0];
  if (aliasArgs.length !== 1 || !arg) return null;
  if (!(arg.flags & ts.TypeFlags.TypeParameter)) return null;
  // Provenance: the STANDARD LIBRARY's alias, not a user's shadowing one.
  const isLibAlias = ctx.checker.declarationsOf(alias).some(
    (d) => ts.isTypeAliasDeclaration(d) && ctx.isStdlibFile(d.getSourceFile()),
  );
  if (!isLibAlias) return null;
  // This answer depends on the CURRENT instantiation, so it must move the
  // sensitivity counters exactly like mapTypeInner's own type-parameter
  // branch and every sibling hook (Awaited<T>, T[K], Parameters<M[K]>) —
  // which bump at their call sites. This one did not, and `Partial<T>` is
  // a whole ts.Type of its own: the memo is keyed by type identity, so the
  // FIRST instantiation's shape was handed to every later one. `stash<A>`
  // then `stash<B>` compiled B's body against A's fields and the second
  // call silently answered `{}` (corpus 907, and SCRIPTC_MEMO_AUDIT prints
  // `MEMOBAD Partial<T> cached=record:r0 fresh=record:r2` on it).
  //
  // Consulting the bindings is context-dependent whether or not a binding
  // exists — an absent one is the collection-order leak memoSensitivity
  // documents — so that counter moves first, before the refusals. A bound
  // answer is additionally a context RESOLUTION, which is what keeps a
  // recursive frame from interning this shape by checker-type identity.
  memoSensitivity++;
  const bound = resolveTypeParam(arg);
  if (!bound || bound.kind !== "record") return null;
  contextResolutions++;
  if (alias.name === "Readonly") return bound;
  const shape = shapes.get(bound.shapeId);
  if (!shape) return null;
  // Partial over an index-signature shape would need `V | undefined`
  // overflow arming; no generic body needs it yet — stay unmapped.
  if (shape.indexValue) return null;
  const fields: { name: string; type: IrType }[] = [];
  for (const f of shape.fields) {
    const armed = withUndefinedArm(f.type, unions);
    if (!armed) return null;
    fields.push({ name: f.name, type: armed });
  }
  // Fields inherit the source shape's canonical (name-sorted) order — and
  // its declaration order (mapped types preserve property order in TS).
  return { kind: "record", shapeId: shapes.intern(fields, false, undefined, shape.declaredOrder) };
}

/** The UNIT-ONLY slot type: the interned `null | undefined` union, the one
 * representation the IR already has for values that are nothing but units.
 * Bindings and fields whose CHECKER type is a bare unit (`null`,
 * `undefined`, `void` in value position, or unions of only those) ride it:
 * the runtime value is always one of the two interned unit instances, the
 * tag is the narrowing test (`x === null`, `typeof x === "undefined"`),
 * and JSON keeps Node's split (null serializes, undefined omits). The type
 * admits an arm the checker may not spell (a `null`-typed slot gets an
 * undefined arm too) — the representation is coarser than the TS type,
 * exactly like literal widening, and tsc has already rejected every write
 * that could inhabit the extra arm. */
export function unitOnlyUnion(unions: UnionRegistry): IrType {
  const arms = [NULL_T, UNDEFINED_T];
  arms.sort((a, b) => (typeKey(a) < typeKey(b) ? -1 : 1));
  return { kind: "union", unionId: unions.intern(arms) };
}

/** The IteratorResult record of a generator's value channels: `{ done:
 * boolean, value: V }` where V is dyn (an any/unknown channel) or the
 * canonical union of the yield arms, the return arms (when the return
 * channel carries a value), and `undefined` (an exhausted `.next()`
 * answers undefined). ONE shape per channel pair — `g.next()`'s lowering,
 * `.return()`, `.throw()`, the for-of desugar, and mapType's
 * IteratorResult alias mapping all intern through here, so reads agree.
 * Null when the combined union would be illegal (a func/set arm beside
 * data arms, a map/regex arm — kinds with no narrowing test): such
 * generators stay unmapped. */
export function genResultRecord(
  yieldT: IrType,
  retT: IrType,
  shapes: ShapeRegistry,
  unions: UnionRegistry,
): (IrType & { kind: "record" }) | null {
  let valueT: IrType;
  if (yieldT.kind === "dyn" || retT.kind === "dyn") {
    valueT = DYN;
  } else {
    const byKey = new Map<string, IrType>();
    const add = (t: IrType): boolean => {
      if (t.kind === "void") return true; // no value on this channel
      if (t.kind === "union") {
        for (const a of unions.get(t.unionId)?.arms ?? []) byKey.set(typeKey(a), a);
        return true;
      }
      if (t.kind === "map" || t.kind === "regex" || t.kind === "jsval" || t.kind === "generator") {
        return false; // no legal union arm exists for these kinds
      }
      byKey.set(typeKey(t), t);
      return true;
    };
    if (!add(yieldT) || !add(retT)) return null;
    byKey.set(typeKey(UNDEFINED_T), UNDEFINED_T);
    const arms = [...byKey.values()];
    // func/set arms are legal only beside unit arms (no narrowing test
    // against data siblings — the union rule).
    if (
      arms.some(
        (a) => (a.kind === "func" || a.kind === "set") && !arms.every((b) => b === a || isUnitType(b)),
      )
    ) {
      return null;
    }
    if (arms.every(isUnitType) && arms.length < 2) {
      // The degenerate no-value generator (never yields, void return):
      // the slot still needs a readable undefined — the unit-only union.
      valueT = unitOnlyUnion(unions);
    } else {
      arms.sort((a, b) => (typeKey(a) < typeKey(b) ? -1 : 1));
      valueT = { kind: "union", unionId: unions.intern(arms) };
    }
  }
  return {
    kind: "record",
    shapeId: shapes.intern([
      { name: "done", type: BOOL },
      { name: "value", type: valueT },
    ]),
  };
}

/** True when a checker type is inhabited ONLY by the unit values —
 * undefined (or `void`, whose runtime inhabitant is undefined) and null,
 * or a union of just those. The positions that today fence VOID (record
 * fields, tuple/array elements, variable slots) substitute unitOnlyUnion
 * for these; RETURN positions keep the VOID mapping (a void return is not
 * a value). */
export function isUnitOnlyTsType(t: ts.Type): boolean {
  const UNIT = ts.TypeFlags.Undefined | ts.TypeFlags.Void | ts.TypeFlags.Null;
  const parts: readonly ts.Type[] = t.isUnionType() ? t.getTypes() : [t];
  return parts.every((p) => (p.flags & UNIT) !== 0);
}

/** IR-level `t | undefined`, canonicalized and fenced exactly like the
 * ts-union branch of mapType (typeKey-sorted arms, deduplicated; map/
 * regex/dyn/void arms unrepresentable; a func arm IS representable — the
 * result is exactly the nullable-callback shape mapType's union branch
 * admits, `(() => void) | undefined`) so the interned union is IDENTICAL
 * to what mapping the checker's own `T | undefined` produces. */
export function withUndefinedArm(t: IrType, unions: UnionRegistry): IrType | null {
  if (t.kind === "union") {
    const def = unions.get(t.unionId);
    if (!def) return null;
    if (def.arms.some((a) => a.kind === "undefinedT")) return t;
    const arms = [...def.arms, UNDEFINED_T];
    arms.sort((a, b) => (typeKey(a) < typeKey(b) ? -1 : 1));
    return { kind: "union", unionId: unions.intern(arms) };
  }
  if (
    t.kind === "void" || t.kind === "map" || t.kind === "dyn" ||
    // A bare unit field type cannot occur (units live only inside unions),
    // but guard against constructing a single-arm union from one.
    isUnitType(t)
  ) {
    return null;
  }
  const arms = [t, UNDEFINED_T];
  arms.sort((a, b) => (typeKey(a) < typeKey(b) ? -1 : 1));
  return { kind: "union", unionId: unions.intern(arms) };
}

/** The chalk-shape recognizer behind mapType's hybrid branch: an
 * intersection with ONE call signature whose callable part maps to a func
 * and whose other parts are plain object refinements over data properties
 * (no construct signatures, no class identity, no index signatures). The
 * result interns a record of the data properties plus the reserved
 * `%call` slot holding the callable. `declaredOrder` lists only the DATA
 * properties — Object.keys over the hybrid answers the enumerable
 * assigned keys, which is also Node's answer for Object.assign(fn, obj)
 * (a function's own length/name are non-enumerable). Null whenever the
 * shape doesn't fit — the caller falls through to the plain-func mapping. */
function mapHybridCallableIntersection(widened: ts.Type, ctx: TypeMapperCtx): IrType | null {
  const { checker, shapes } = ctx;
  if (!widened.isIntersectionType()) return null;
  if (checker.getCallSignatures(widened).length !== 1) return null;
  let funcPart: ts.Type | null = null;
  for (const part of widened.getTypes()) {
    if (checker.getCallSignatures(part).length > 0) {
      if (funcPart) return null; // exactly one callable part
      funcPart = part;
      continue;
    }
    const partSym = part.getSymbol();
    if (
      (part.flags & ts.TypeFlags.Object) === 0 ||
      checker.getConstructSignatures(part).length > 0 ||
      (partSym !== undefined && (partSym.flags & ts.SymbolFlags.Class) !== 0) ||
      checker.getIndexInfosOfType(part).length > 0
    ) {
      return null;
    }
  }
  if (!funcPart) return null;
  const fn = mapType(funcPart, ctx);
  if (!fn || fn.kind !== "func") return null;
  const fields: { name: string; type: IrType }[] = [{ name: "%call", type: fn }];
  const declaredOrder: string[] = [];
  for (const p of checker.getPropertiesOfType(widened)) {
    if (p.flags & (ts.SymbolFlags.GetAccessor | ts.SymbolFlags.SetAccessor)) return null;
    const pt = mapType(checker.getTypeOfSymbol(p), ctx);
    // No jsval absorb here: an island-entangled hybrid is not this shape.
    if (!pt || pt.kind === "void" || pt.kind === "jsval") return null;
    fields.push({ name: p.name, type: pt });
    declaredOrder.push(p.name);
  }
  if (fields.length === 1) return null; // no properties — it is just F
  fields.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { kind: "record", shapeId: shapes.intern(fields, false, undefined, declaredOrder) };
}

/** True for MAPPED-type results — `Partial<Config>`, `Record<"a", n>`,
 * whatever `Pick`/`Omit` reduce to. Their shape is computed by the checker,
 * not declared anywhere: the only declaration behind them is the utility
 * type's `{ [P in keyof T]: ... }` machinery in lib.es5.d.ts. */
function isMappedShape(t: ts.Type): boolean {
  return (
    (t.flags & ts.TypeFlags.Object) !== 0 &&
    ((t as ts.ObjectType).objectFlags & ts.ObjectFlags.Mapped) !== 0
  );
}

/** The record path's provenance fence. Declared shapes (object literals,
 * interfaces, type literals) must come from user code, never a .d.ts — the
 * empty ambient interfaces (Object, Function, Boolean, ...) exist only to
 * satisfy tsc and must not become zero-field records. Checker-COMPUTED
 * shapes (mapped-type results, intersections) have no user declaration to
 * point at: mapped types pass here and get per-MEMBER provenance in the
 * field walk instead; an intersection passes when every part is itself an
 * ordinary provenance-passing object type (class parts keep their nominal
 * identity and never flatten into a struct). */
function recordProvenanceOk(
  t: ts.Type,
  checker: ts.TypeChecker,
  ctx?: TypeMapperCtx,
): boolean {
  if (t.isIntersectionType()) {
    return t.getTypes().every(
      (part) => {
        const partSym = part.getSymbol();
        // Class parts normally keep their nominal identity and never
        // flatten into a struct — EXCEPT a data-only class INSTANCE
        // declared in a .d.ts (a protobufjs message: encode/decode are
        // static, instances are all data), which flattens soundly in a
        // static build exactly like the data-only interface rule below
        // (`ADVSignedDeviceIdentity & $Shape` from a decode return type).
        // TWO shapes of that exception, and the second one is why this is
        // not a single call: isDataOnlyDeclFileClassInstance describes the
        // declaration-only module (no implementation compiled), which is
        // the only case that needed the extra data-only argument. When the
        // declaration file's implementation twin WAS compiled, the shape
        // has code behind it and recordProvenanceOk's own non-intersection
        // path admits it outright — so the class part of the intersection
        // must admit it too, or the same class is a record alone and no
        // record inside `X & X.$Shape`.
        const classPartOk =
          !(partSym && partSym.flags & ts.SymbolFlags.Class) ||
          isDataOnlyDeclFileClassInstance(part, checker, ctx) ||
          isDataOnlyDeclFileClassWithImpl(part, checker, ctx);
        return (part.flags & ts.TypeFlags.Object) !== 0 &&
          classPartOk &&
          checker.getCallSignatures(part).length === 0 &&
          checker.getConstructSignatures(part).length === 0 &&
          recordProvenanceOk(part, checker, ctx);
      },
    );
  }
  if (isMappedShape(t)) return true;
  const tSym = t.getSymbol();
  const decls = tSym ? checker.declarationsOf(tSym) : undefined;
  if (!decls || decls.length === 0) return false;
  // A declaration file is normally the wrong half of a module — types with no
  // body behind them — which is why a record declared there cannot be built.
  // When the implementation twin WAS compiled (declTwinOf put it into module
  // order), the shape does have code behind it and the record is buildable.
  const declFileNoImpl = decls.some((d) => {
    const sf = d.getSourceFile();
    return sf.isDeclarationFile && !(ctx?.declFileHasCompiledImpl?.(sf) ?? false);
  });
  if (!declFileNoImpl) return true;
  // A PURE-DATA interface declared in a .d.ts (a protobuf message shape —
  // `interface IADVSignedDeviceIdentity extends $Properties` whose members
  // are all Uint8Array/number/nested-data, no methods) IS buildable: the
  // program constructs the value from its OWN decoded bytes, and the ONE
  // way to obtain a value FROM the declaration-only module — a value read
  // or method call like `proto.X.decode(...)` — fences separately (its own
  // value-import gate). So mapping the STRUCTURAL shape is sound; only the
  // uncompiled module's VALUES are refused, exactly where they cross.
  // A method-bearing declaration (an engine object's surface — DOM, a Node
  // handle) keeps the fence: a call signature needs a body the .d.ts lacks.
  // STATIC builds only: under --dynamic that module import is a jsval
  // island handle rather than a fence, so a data-only shape must stay
  // JSVAL there (a program-built record and an island handle would
  // disagree on representation).
  if (ctx?.dynamic) return false;
  const isInterfaceLike = decls.every(
    (d) => ts.isInterfaceDeclaration(d) || ts.isTypeLiteralNode(d) || ts.isTypeAliasDeclaration(d),
  );
  return (
    (isInterfaceLike && isDataOnlyObjectType(t, checker)) ||
    isDataOnlyDeclFileClassInstance(t, checker, ctx)
  );
}

/** A protobufjs-style message CLASS instance whose members are all data
 * (no instance methods — encode/decode are STATIC, on `typeof Class`, not
 * the instance): the instance IS a struct the program builds. Its
 * construction (`new C(...)` on a non-program class) and its from-module
 * values (`C.decode(...)`) fence at their own gates, so flattening the
 * instance to a record is sound in a STATIC build — the data-only
 * interface rule, one declaration kind over. */
function isDataOnlyDeclFileClassInstance(
  t: ts.Type,
  checker: ts.TypeChecker,
  ctx?: TypeMapperCtx,
): boolean {
  if (ctx?.dynamic) return false;
  const sym = t.getSymbol();
  if (!sym || !(sym.flags & ts.SymbolFlags.Class)) return false;
  const decls = checker.declarationsOf(sym);
  if (decls.length === 0) return false;
  const declFileNoImpl = decls.every((d) => {
    const sf = d.getSourceFile();
    return sf.isDeclarationFile && !(ctx?.declFileHasCompiledImpl?.(sf) ?? false);
  });
  // No instance call signatures either (a callable class instance is not
  // the pure-data message shape).
  return (
    declFileNoImpl &&
    checker.getCallSignatures(t).length === 0 &&
    isDataOnlyObjectType(t, checker)
  );
}

/** The SAME protobufjs message shape as above, for the declaration file
 * whose implementation twin this build COMPILED — `X & X.$Shape`, the
 * return type of every generated `decode`, when the generated `index.js`
 * sits beside `index.d.ts` and joined module order (declTwinOf).
 *
 * Split out rather than folded into the predicate above because the two
 * rest on different arguments. There, the module has no code at all, so
 * the soundness argument is that every way to obtain a value FROM it
 * fences at its own gate and only program-built values reach the record.
 * Here the code IS compiled, which is strictly BETTER provenance: the
 * non-intersection path of recordProvenanceOk admits such a shape outright
 * (`if (!declFileNoImpl) return true`), with no data-only test and no
 * --dynamic exclusion, because a compiled twin is not an island handle.
 * The class part of an intersection was reaching only the no-implementation
 * predicate, whose `declFileNoImpl` is FALSE exactly when the twin exists —
 * so the better-supported shape was the one refused, and `X` mapped to a
 * record alone while `X & X.$Shape` mapped to nothing.
 *
 * What this does NOT relax: the declarations must ALL be in declaration
 * files. A program class keeps its nominal identity (its instances are
 * `object(C)`, not a struct) and must never flatten into an intersection.
 * Data-only is still required, for the reason it always was — flattening a
 * method-bearing instance would drop the methods. */
function isDataOnlyDeclFileClassWithImpl(
  t: ts.Type,
  checker: ts.TypeChecker,
  ctx?: TypeMapperCtx,
): boolean {
  const sym = t.getSymbol();
  if (!sym || !(sym.flags & ts.SymbolFlags.Class)) return false;
  const decls = checker.declarationsOf(sym);
  if (decls.length === 0) return false;
  const declFileWithImpl = decls.every((d) => {
    const sf = d.getSourceFile();
    return sf.isDeclarationFile && (ctx?.declFileHasCompiledImpl?.(sf) ?? false);
  });
  const ok =
    declFileWithImpl &&
    checker.getCallSignatures(t).length === 0 &&
    isDataOnlyObjectType(t, checker);
  // Counted in the same run that reads the result: a branch that never
  // fires and a branch that fires and changes nothing are indistinguishable
  // from the trap count alone.
  if (ok && process.env["SCRIPTC_ISECT_WHY"] !== undefined) {
    console.error(`ISECTIMPL ${checker.typeToString(t)}`);
  }
  return ok;
}

/** Every property of an object type is a DATA slot — its type carries no
 * call or construct signature (a method / constructor a .d.ts declares but
 * cannot supply a body for). Nested object-typed fields are NOT walked here
 * (the record field walk recurses through recordProvenanceOk for each), so
 * this is a single-level method check; index signatures count as data. */
function isDataOnlyObjectType(t: ts.Type, checker: ts.TypeChecker): boolean {
  const props = checker.getPropertiesOfType(t);
  for (const p of props) {
    const pt = checker.getTypeOfSymbol(p);
    // A property whose type is itself callable/constructable is a method or
    // a callback slot whose behavior a declaration file cannot back.
    if (checker.getCallSignatures(pt).length > 0 || checker.getConstructSignatures(pt).length > 0) {
      return false;
    }
  }
  return true;
}

/** A GENERIC-callable member type (`m<T>(x: T): T` / `f: <T>(x: T) => T` in
 * an object type): pure function-shaped — call signatures only, every one
 * carrying its own type parameters — with no data properties, no construct
 * signatures, no index signatures. Such members are EXCLUDED from record
 * shapes instead of failing them: no single closure slot can hold a generic
 * function, so the shape keeps its data fields and calls of the member
 * monomorphize per call site against the defining declaration (see
 * lower-calls.ts, lowerObjLitGenericMethodCall). Node's JSON.stringify drops
 * function-valued properties, so serialization of the shape stays exact;
 * Object.keys over such a shape omits the member (a pin — every excluded
 * member is a function the key walk would name). */
/** A mapper context whose type-parameter resolvers bind every parameter of
 * `sig` to its CONSTRAINT — the one instantiation a generic signature can
 * honestly wear as a value. Null when any parameter is unconstrained or
 * its constraint does not map, which keeps the signature unmapped. The
 * outer resolvers stay reachable so a parameter of an ENCLOSING
 * instantiation still resolves through them. */
/** `Parameters<F>` where F is an INDEXED ACCESS over a bound key (`M[K]`
 * with K erased to its constraint): the union of each named handler's
 * parameter tuple, as IR. The checker keeps `Parameters<M[K]>` symbolic —
 * substituting K is not something its API exposes — but the pieces are
 * reachable without substitution: K's binding names the keys, each key
 * names a handler, and a handler's own signature already lists its
 * parameters. Null for any other spelling, so nothing else changes. */
/** `Parameters<M[K]>` while the checker still keeps it SYMBOLIC — the
 * signature frame, where K is not yet bound. (The body frame sees the same
 * parameter already resolved to a union of tuples; mapRestTupleUnion takes
 * that one. The two forms are disjoint, so both routes are tried.) The
 * pieces are reachable without substitution: K's binding names the keys,
 * each key names a handler, and the handler's signature lists its
 * parameters. Answers the same array-of-union shape. */

/** The FUNCTION TYPE NODE a key-map handler spells, following NAMED type
 * aliases. The arity read below is deliberately SYNTACTIC — asking the
 * checker for a handler's signature pulls the whole payload across the
 * facade's synchronous channel, which on a wide event map kills the sidecar
 * — and a member written `readonly mutation: WaAppStateMutationListener`
 * lists no parameters of its own. Its alias does, and following the alias
 * declaration is still syntax: one symbol lookup, no type payload.
 *
 * A GENERIC alias, or one spelled with type arguments, keeps the fence: its
 * parameters are written against arguments this walk does not substitute.
 * The hop budget bounds an alias cycle the checker would have rejected. */
export function handlerFnTypeNodeOf(node: ts.TypeNode | undefined, checker: ts.TypeChecker): ts.FunctionTypeNode | null {
  let t: ts.TypeNode | undefined = node;
  for (let hops = 0; t !== undefined && hops < 8; hops++) {
    while (t !== undefined && ts.isParenthesizedTypeNode(t)) t = t.type;
    if (t === undefined) return null;
    if (ts.isFunctionTypeNode(t)) return t;
    if (!ts.isTypeReferenceNode(t) || t.typeArguments !== undefined) return null;
    let sym = checker.getSymbolAtLocation(t.typeName);
    if (sym !== undefined && (sym.flags & ts.SymbolFlags.Alias) !== 0) sym = checker.getAliasedSymbol(sym);
    const alias = sym === undefined
      ? undefined
      : checker.declarationsOf(sym).find((d) => ts.isTypeAliasDeclaration(d));
    if (alias === undefined || !ts.isTypeAliasDeclaration(alias) || alias.typeParameters !== undefined) return null;
    t = alias.type;
  }
  return null;
}

export function mapParametersAliasOverBoundKey(type: ts.Type, ctx: TypeMapperCtx): IrType | null {
  const { checker, resolveTypeParamTs } = ctx;
  const pwhy = (r: string): null => {
    if (process.env["SCRIPTC_PARAMS_WHY"] !== undefined) console.error(`[paramswhy] ${r}`);
    return null;
  };
  if (!resolveTypeParamTs) return null;
  if (type.getAliasSymbol()?.name !== "Parameters") return null;
  const args = type.getAliasTypeArguments();
  if (args === undefined || args.length !== 1) return null;
  const fnT = args[0]!;
  if (!fnT.isIndexedAccessType()) return null;
  const objT = fnT.getObjectType();
  const rawIdx = fnT.getIndexType();
  const idxT = (rawIdx.flags & ts.TypeFlags.TypeParameter) !== 0 ? resolveTypeParamTs(rawIdx) : rawIdx;
  if (idxT === null || idxT === undefined) return null;
  const keys = idxT.isUnionType() ? idxT.getTypes() : [idxT];
  // ONE crossing per DISTINCT handler, not per key. A wide event map
  // repeats a handful of handler shapes across dozens of names, and
  // walking per key is what floods the checker facade's synchronous
  // channel (measured: the sidecar dies mid-build on zapo). Caching is
  // not an option — the answer depends on the bindings, so it cannot
  // outlive the context — but the crossings themselves collapse.
  // Following an ALIASED handler sits behind the slot switch, like the rule
  // it serves. A key map that maps where it used to refuse changes what the
  // types AROUND it map to, and neutral builds must keep mapping exactly
  // what they mapped before: measured on zapo, the ungated version takes
  // neutral from 385 traps to 387 — the coordinator holding a
  // `WaMobileEmit` field collects one step further and trades its single
  // fence for two, one of them a latent `[]`-into-`readonly string[]`
  // coercion the earlier refusal had been masking.
  const followAliases = process.env["SCRIPTC_GENERIC_SLOT"] !== undefined;
  const arities = new Set<number>();
  const handlerNodes: ts.FunctionTypeNode[] = [];
  // ONE crossing for the whole property table, indexed locally. Asking
  // getPropertyOfType per key is what still made this O(keys) after the
  // per-handler collapse — and O(keys) crossings of the synchronous
  // channel is what kills the sidecar on a wide event map.
  const props = new Map(checker.getPropertiesOfType(objT).map((q) => [q.name, q]));
  for (const k of keys) {
    const name = k.isStringLiteralType() ? k.value : k.isNumberLiteralType() ? String(k.value) : null;
    if (name === null) return null;
    const prop = props.get(name);
    if (prop === undefined) return null;
    // ARITY FIRST, and syntactically. Deciding it from the DECLARATION
    // costs nothing, while asking the checker for a handler's signature
    // pulls the whole payload across the synchronous channel — on zapo's
    // `message` event (every WhatsApp content variant, deeply recursive)
    // that single query kills the sidecar. Types are mapped only once
    // every handler agrees on the count, and a handler whose declaration
    // does not say plainly keeps the fence.
    const decl = checker.valueDeclarationOf(prop);
    const fnNode = decl !== undefined && ts.isPropertySignature(decl)
      ? (followAliases
        ? handlerFnTypeNodeOf(decl.type, checker)
        : (decl.type !== undefined && ts.isFunctionTypeNode(decl.type) ? decl.type : null))
      : null;
    if (fnNode === null) return pwhy(`no fn type node for ${name}`);
    if (fnNode.parameters.some((x) => x.dotDotDotToken !== undefined)) return pwhy(`rest handler ${name}`);
    arities.add(fnNode.parameters.length);
    if (arities.size > 1) return pwhy(`arity split at ${name}`);
    handlerNodes.push(fnNode);
  }
  // One shape agreed on by every handler: NOW ask for types, once per
  // distinct parameter node.
  // SPECULATIVE ctx. This walk reaches types the ordinary mapping never
  // visits, and a refusal it collects is not those types' own answer —
  // cached against the real ctx it hands that verdict to the legitimate
  // mapping that comes later (measured: zapo's WaClientOptions stopped
  // mapping and the wall regressed 618 -> 242). mapType only withholds
  // speculative refusals from the memo when the ctx says so; build it
  // once so successes still share a memo among these crossings.
  const specCtx: TypeMapperCtx = { ...ctx, restTupleFromErasure: true };
  const rows: IrType[][] = [];
  for (const fnNode of handlerNodes) {
    const row: IrType[] = [];
    for (const q of fnNode.parameters) {
      const mapped = mapType(checker.getTypeAtLocation(q), specCtx);
      if (!mapped || mapped.kind === "void") {
        return pwhy(`param does not map: ${checker.typeToString(checker.getTypeAtLocation(q)).slice(0, 70)}`);
      }
      row.push(mapped);
    }
    rows.push(row);
  }
  if (rows.length === 0) return pwhy("no rows");
  const arity = rows[0]!.length;
  if (arity === 0 || !rows.every((r) => r.length === arity)) return pwhy(`bad arity ${arity}`);
  // FLATTEN: an element that is itself a union contributes its ARMS, not
  // itself — a union holding a union as an arm is rejected outright.
  const byKey = new Map<string, IrType>();
  for (const r of rows) {
    for (const x of r) {
      if (x.kind === "union") {
        for (const a of ctx.unions.get(x.unionId)?.arms ?? []) byKey.set(typeKey(a), a);
      } else byKey.set(typeKey(x), x);
    }
  }
  const distinct = [...byKey.entries()].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)).map(([, t]) => t);
  const answer = arrayOf(distinct.length === 1 ? distinct[0]! : { kind: "union", unionId: ctx.unions.intern(distinct) });
  return answer;
}

export function mapRestTupleUnion(type: ts.Type, ctx: TypeMapperCtx): IrType | null {
  if (ctx.restTupleFromErasure !== true) return null;
  const { checker } = ctx;
  // ONLY inside an instantiation that BOUND a type parameter. Without
  // this the rule fires for every tuple-typed rest in the program and
  // silently changes their calling convention — measured: 30 corpus
  // programs broke (destructuring, spread, for-of projections, key
  // order). The case this serves only ever arises under an erased
  // instantiation, so gate on exactly that.
  if (!ctx.resolveTypeParamTs) return null;
  // A rest whose type is a TUPLE — or a union of tuples of the SAME
  // length, which is what `Parameters<M[K]>` becomes once the checker has
  // resolved it — is an array in the compiled calling convention, with the
  // element widened to the union of every position's type. The body keeps
  // indexing `args`; only the element type loses per-position precision.
  // Differing lengths keep the fence: no single arity is honest there.
  const arms = type.isUnionType() ? type.getTypes() : [type];
  const rows: IrType[][] = [];
  for (const arm of arms) {
    if (!checker.isTupleType(arm)) return null;
    const row: IrType[] = [];
    for (const el of checker.getTypeArguments(arm as ts.TypeReference)) {
      const mapped = mapType(el, ctx);
      if (!mapped || mapped.kind === "void") return null;
      row.push(mapped);
    }
    rows.push(row);
  }
  if (rows.length === 0) return null;
  const arity = rows[0]!.length;
  if (arity === 0 || !rows.every((r) => r.length === arity)) return null;
  // FLATTEN: an element that is itself a union contributes its ARMS, not
  // itself — a union holding a union as an arm is rejected outright.
  const byKey = new Map<string, IrType>();
  for (const r of rows) {
    for (const x of r) {
      if (x.kind === "union") {
        for (const a of ctx.unions.get(x.unionId)?.arms ?? []) byKey.set(typeKey(a), a);
      } else byKey.set(typeKey(x), x);
    }
  }
  const distinct = [...byKey.entries()].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)).map(([, t]) => t);
  const answer = arrayOf(distinct.length === 1 ? distinct[0]! : { kind: "union", unionId: ctx.unions.intern(distinct) });
  if (process.env.SCRIPTC_SHAPE_WHY) {
    console.error(`SHAPE restTuple FIRES on ${checker.typeToString(type).slice(0, 100)}`);
  }
  return answer;
}
/** The POSITIONAL parameter list a tuple-typed rest stands for, or null.
 * A tuple maps to a record of numeric fields, so its arity and per-slot
 * types are already known; a UNION of tuples answers position-wise unions,
 * but only when every arm has the SAME length — differing lengths have no
 * single arity a compiled signature could wear. */
function tupleArityExpansion(restT: IrType, ctx: TypeMapperCtx): IrType[] | null {
  const numericFields = (t: IrType): { name: string; type: IrType }[] | null => {
    if (t.kind !== "record") return null;
    const shape = ctx.shapes.get(t.shapeId);
    if (shape === undefined || shape.indexValue !== undefined) return null;
    if (shape.fields.length === 0) return [];
    if (!shape.fields.every((f) => /^\d+$/.test(f.name))) return null;
    return [...shape.fields].sort((a, b) => Number(a.name) - Number(b.name));
  };
  const arms = restT.kind === "union" ? (ctx.unions.get(restT.unionId)?.arms ?? []) : [restT];
  if (arms.length === 0) return null;
  const perArm = arms.map(numericFields);
  if (perArm.some((f) => f === null)) return null;
  const lens = new Set(perArm.map((f) => f!.length));
  if (lens.size !== 1) return null;
  const arity = perArm[0]!.length;
  const out: IrType[] = [];
  for (let i = 0; i < arity; i++) {
    const byKey = new Map<string, IrType>();
    for (const f of perArm) byKey.set(typeKey(f![i]!.type), f![i]!.type);
    const distinct = [...byKey.entries()].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)).map(([, t]) => t);
    out.push(distinct.length === 1 ? distinct[0]! : { kind: "union", unionId: ctx.unions.intern(distinct) });
  }
  return out;
}

function constraintErasedCtx(sig: ts.Signature, ctx: TypeMapperCtx): TypeMapperCtx | null {
  const why = (r: string): null => {
    if (process.env["SCRIPTC_ERASE_WHY"] !== undefined) console.error(`[erasewhy] ${r}`);
    return null;
  };
  const tps = sig.getTypeParameters();
  if (!tps || tps.length === 0) return why("no type params");
  // The constraint is read off the DECLARATION (the idiom
  // constraintTypeParamBindings uses): a base-constraint query widens a
  // bare parameter instead of answering that it has none.
  const sigDecl = ctx.checker.signatureDeclaration(sig);
  const tpDecls = sigDecl !== undefined && ts.isFunctionLike(sigDecl) ? sigDecl.typeParameters : undefined;
  if (tpDecls === undefined || tpDecls.length !== tps.length) return why("no tp declarations");
  const irByTp = new Map<ts.Type, IrType>();
  const tsByTp = new Map<ts.Type, ts.Type>();
  for (const [i, tp] of tps.entries()) {
    const src = tpDecls[i]?.constraint ?? tpDecls[i]?.defaultType;
    if (!src) return why("type param without constraint or default");
    const constraint = ctx.checker.getTypeFromTypeNode(src);
    const mapped = mapType(constraint, ctx);
    if (!mapped || mapped.kind === "void") return why(`constraint does not map: ${ctx.checker.typeToString(constraint).slice(0,60)}`);
    irByTp.set(tp, mapped);
    tsByTp.set(tp, constraint);
  }
  const outerIr = ctx.resolveTypeParam;
  const outerTs = ctx.resolveTypeParamTs;
  return {
    ...ctx,
    resolveTypeParam: (t) => irByTp.get(t) ?? outerIr?.(t) ?? null,
    resolveTypeParamTs: (t) => tsByTp.get(t) ?? outerTs?.(t) ?? null,
    indexUnionOk: true,
    restTupleFromErasure: true,
  };
}

/** The id of a recursive placeholder this IR type reaches that NO frame has
 * finalized, or null. A placeholder is normally transient — the outer frame
 * fills it in — so this answers a question worth asking only where a type is
 * about to be KEPT while its own construction may still fail: a kept
 * reference to a never-finalized id reaches the validator as a union with no
 * arms (or a shape with no fields). Walks structurally with a visited set,
 * since the very types in question are cyclic. */
export function referencesPendingPlaceholder(
  t: IrType,
  unions: UnionRegistry,
  shapes: ShapeRegistry,
  seen: Set<string> = new Set(),
): string | null {
  switch (t.kind) {
    case "union": {
      if (unions.isPending(t.unionId)) return t.unionId;
      if (seen.has(`u:${t.unionId}`)) return null;
      seen.add(`u:${t.unionId}`);
      for (const arm of unions.get(t.unionId)?.arms ?? []) {
        const hit = referencesPendingPlaceholder(arm, unions, shapes, seen);
        if (hit) return hit;
      }
      return null;
    }
    case "record": {
      if (shapes.isPending(t.shapeId)) return t.shapeId;
      if (seen.has(`r:${t.shapeId}`)) return null;
      seen.add(`r:${t.shapeId}`);
      for (const f of shapes.get(t.shapeId)?.fields ?? []) {
        const hit = referencesPendingPlaceholder(f.type, unions, shapes, seen);
        if (hit) return hit;
      }
      return null;
    }
    case "array":
      return referencesPendingPlaceholder(t.elem, unions, shapes, seen);
    case "func": {
      for (const p of t.params) {
        const hit = referencesPendingPlaceholder(p, unions, shapes, seen);
        if (hit) return hit;
      }
      return referencesPendingPlaceholder(t.ret, unions, shapes, seen);
    }
    default:
      return null;
  }
}

export function isGenericCallableMemberType(t: ts.Type, checker: ts.TypeChecker): boolean {
  const sigs = checker.getCallSignatures(t);
  // ANY generic signature disqualifies the slot, not only an all-generic
  // overload set: an emitter subclass declaring `emit<K extends keyof M>`
  // over a base declaring `emit(name: string | symbol, ...args: any[])`
  // merges to two signatures, one generic and one not, and no single
  // closure slot holds that either. Such members already failed — mapType
  // fences an overload set, taking the whole enclosing shape down with it
  // — so treating them as excluded members is strictly more permissive,
  // and reading one AS a value still fences (SC1090).
  if (sigs.length === 0 || !sigs.some((s) => s.getTypeParameters().length > 0)) return false;
  return (
    checker.getConstructSignatures(t).length === 0 &&
    checker.getPropertiesOfType(t).length === 0 &&
    checker.getIndexInfosOfType(t).length === 0
  );
}

/** The computed pieces of a record shape mapRecordTypeInner hands back for
 * the OUTER frame to intern — or, when a back-reference minted a recursive
 * placeholder for the type mid-construction, to finalize INTO that
 * placeholder (the named-recursive-shape knot). */
interface RecordShapeParts {
  fields: { name: string; type: IrType }[];
  indexValue?: IrType;
  declaredOrder?: string[];
}

function mapRecordType(widened: ts.Type, ctx: TypeMapperCtx): IrType | null {
  const { shapes } = ctx;
  // A type whose recursive shape already finalized answers its id straight
  // off the registry (identity is per checker type; remapping would walk
  // the same members to the same answer).
  const knownRecursive = shapes.recursiveShapeFor(widened);
  if (knownRecursive !== undefined) return { kind: "record", shapeId: knownRecursive };
  // A BACK-REFERENCE to a shape currently being mapped (`interface
  // TreeNode { label: string; children: TreeNode[] }` reaching TreeNode
  // through its own field walk — directly or through arrays, unions,
  // optionals, Maps): the recursive knot. Answer a NAMED RECURSIVE SHAPE —
  // a placeholder shape-table entry whose fields fill in when the outer
  // frame completes (finalizeRecursive below). Backends represent records
  // as heap references, so the self-reference is an ordinary pointer.
  if (shapes.inProgress.has(widened)) {
    return { kind: "record", shapeId: shapes.recursiveRef(widened) };
  }
  shapes.inProgress.add(widened);
  const sensitivityAtEntry = contextResolutions;
  try {
    const inner = mapRecordTypeInner(widened, ctx);
    if (inner === null) {
      if (process.env["SCRIPTC_DOORS"] !== undefined && shapes.recursivePending(widened)) console.error("[doors] saiu por inner===null");
      return null;
    } // a pending placeholder, if minted, stays unfinalized (prunes as unreachable)
    if (!("fields" in inner)) {
      // A whole-type answer (the jsval/dyn absorbs, the header-family
      // canonical shape). If a back-reference minted a placeholder for
      // this very type meanwhile, the two answers disagree — fence rather
      // than leave references to a shape that is not this type's mapping.
      if (shapes.recursivePending(widened) && inner.kind !== "jsval" && inner.kind !== "dyn") return null;
      return inner;
    }
    if (shapes.recursivePending(widened)) {
      // The knot closed through this shape. Context-sensitive frames
      // (generic type parameters, mixin instantiations) cannot intern by
      // checker-type identity — fence recursive generic-open shapes.
      if (contextResolutions !== sensitivityAtEntry) {
        // The frame refuses to cache by ts.Type identity, but `inner.fields`
        // are its REAL, fully-mapped fields and a back-reference already took
        // the placeholder. Fill it before refusing — the union frame does
        // exactly this. Leaving it empty strands a fieldless record in
        // whatever holds it.
        if (process.env["SCRIPTC_DOORS"] !== undefined) console.error("[doors] saiu pela SENSIVEL (finalizou)");
        shapes.finalizeRecursive(widened, inner.fields, inner.indexValue, inner.declaredOrder);
        return null;
      }
      return {
        kind: "record",
        shapeId: shapes.finalizeRecursive(widened, inner.fields, inner.indexValue, inner.declaredOrder),
      };
    }
    {
      const id = shapes.intern(inner.fields, false, inner.indexValue, inner.declaredOrder);
      if (process.env["SCRIPTC_ORDER_WHY"] !== undefined) {
        const f = inner.fields.find((x) => x.name === "indexParts");
        if (f) {
          console.error(
            `ORDER rec#${id} ${ctx.checker.typeToString(widened).slice(0, 60)}` +
            ` indexParts=${typeKey(f.type).slice(0, 90)}` +
            ` rest=${String(ctx.restTupleFromErasure)} idxU=${String(ctx.indexUnionOk)}` +
            ` rtp=${ctx.resolveTypeParam !== undefined}`,
          );
        }
      }
      return { kind: "record", shapeId: id };
    }
  } finally {
    shapes.inProgress.delete(widened);
  }
}

/** Why a composite REFUSED, one line per level, under SCRIPTC_MAP_TRACE.
 *
 * A diagnostic names the outermost type that failed and the member it blames,
 * and stops there — the member's own reason is another mapType frame, and the
 * chain behind a real dependency runs deep (a client option to a store to a
 * sub-store to one method's callback return). Tracing it by hand cost whole
 * rounds; the trace prints the whole chain from one build, and reading it
 * bottom-up lands on the LEAF, which is the only level worth fixing.
 *
 * Diagnostics stay silent about it: this is a compiler-development facility,
 * not something to widen a user-facing message with. */
/** SCRIPTC_ISECT_WHY — one line per REFUSED intersection, naming every
 * constituent and the answer each one gets on its own. Measurement only:
 * the question "how many distinct shapes are behind the intersection
 * fence, and do they share a form" cannot be answered from the diagnostic,
 * which names only the outermost type. */
let isectWhyBusy = false;
function isectWhy(t: ts.UnionOrIntersectionType, ctx: TypeMapperCtx): void {
  if (isectWhyBusy) return;
  isectWhyBusy = true;
  try {
    const { checker } = ctx;
    const parts = t.getTypes().map((p) => {
      const sym = p.getSymbol();
      const decls = sym ? checker.declarationsOf(sym) : [];
      const kind =
        sym === undefined ? "anon"
          : sym.flags & ts.SymbolFlags.Class ? "class"
          : sym.flags & ts.SymbolFlags.Interface ? "iface"
          : sym.flags & ts.SymbolFlags.TypeAlias ? "alias"
          : "other";
      const dfile = decls.some((d) => d.getSourceFile().isDeclarationFile) ? "dts" : "src";
      const twin = decls.some((d) => ctx.declFileHasCompiledImpl?.(d.getSourceFile()) === true) ? "+impl" : "";
      const m = mapType(p, ctx);
      const dataOnly = isDataOnlyDeclFileClassInstance(p, checker, ctx);
      return `${checker.typeToString(p)}[${kind}/${dfile}${twin}` +
        `/props=${checker.getPropertiesOfType(p).length}` +
        `/call=${checker.getCallSignatures(p).length}` +
        `/ctor=${checker.getConstructSignatures(p).length}` +
        `/dataOnlyClass=${dataOnly}` +
        `/maps=${m === null ? "null" : m.kind}]`;
    });
    console.error(
      `ISECTWHY ${checker.typeToString(t).slice(0, 120)}` +
      ` || provOk=${recordProvenanceOk(t, checker, ctx)}` +
      ` || dyn=${ctx.dynamic === true} spec=${ctx.speculative === true}` +
      ` || ${parts.join(" & ")}`,
    );
  } catch (e) {
    console.error(`ISECTWHY <threw> ${String(e).slice(0, 120)}`);
  } finally {
    isectWhyBusy = false;
  }
}

function mapTrace(message: string): void {
  if (!process.env.SCRIPTC_MAP_TRACE) return;
  // INDENTED BY FRAME DEPTH. Failures print leaf-first as the stack
  // unwinds, so in a flat list two adjacent lines look like cause and
  // effect whether or not they belong to the same chain — and reading them
  // that way sends the hunt after the wrong leaf. With the indent the
  // relation is visible instead of inferred: a DEEPER line is the cause of
  // the shallower one that follows it, and a shallower line that follows
  // nothing deeper failed on its own.
  console.error(`MAPFAIL ${"  ".repeat(Math.max(0, mapTypeDepth))}${message}`);
}

/** A mapped-type alias the checker kept SYMBOLIC because a type parameter
 * inside it is still abstract: `Record<B, V>` under an open `B` publishes no
 * index signature and no properties, so the ordinary record walk sees an
 * empty object and refuses. Inside a monomorphized body the binding says
 * what B is, but substitution lives in the checker and its API exposes no
 * way to perform it (getBaseConstraintOfType widens a bare parameter, not a
 * reference CARRYING one) — so the shape is read off the ALIAS instead.
 *
 * Only two aliases, both stdlib, both erasure at the IR level:
 *   - `Readonly<T>` — readonly-ness has no IR, so this is T.
 *   - `Record<K, V>` with K bound to string or number — exactly the
 *     index-signature domain the hybrid shape already compiles.
 * Anything else answers undefined and takes the ordinary path.
 *
 * Gated on the object being symbolic (no properties, no index infos, no
 * signatures): a RESOLVED `Record<"a", V>` still walks its real members, so
 * this never displaces an answer the checker was able to give. */
/** The index signature tsc ERASED when it inferred an object literal's
 * type, or undefined when nothing was erased (the ordinary path).
 *
 * `{ jid, ...groupAttrs }` over `Record<string, string>` infers as
 * `{ jid: string }`: tsc keeps the named members and drops the source's
 * signature. The compiled record then has no overflow store, so a merge
 * into it can only DROP the source's runtime keys — the silent wrong
 * answer the spread desugar fences on today. Reading the signature back
 * off the literal's own spread sources restores the store, and with it
 * the ability to compile the right answer.
 *
 * ONLY for types inferred from object literals. A declared type means what
 * it says: the drop is divergence 68 there, the shape's identity is
 * published, and widening it would invent a store the author never wrote.
 *
 * Answers undefined — leaving today's mapping byte-for-byte unchanged —
 * whenever any condition fails, so this can never take away an answer. */
function spreadErasedIndexValue(
  widened: ts.Type,
  ctx: TypeMapperCtx,
): IrType | undefined {
  const { checker } = ctx;
  const sym = widened.getSymbol();
  if (!sym) return undefined;
  const decls = checker.declarationsOf(sym);
  // Every declaration an object literal: this is a type tsc INFERRED from
  // literal syntax, never one the program declared under a name.
  if (decls.length === 0 || !decls.every((d) => ts.isObjectLiteralExpression(d))) return undefined;
  let value: IrType | null = null;
  let sawSpread = false;
  for (const decl of decls as ts.ObjectLiteralExpression[]) {
    // KEY ORDER decides whether the recovered store can answer at all.
    // A hybrid record enumerates DECLARED fields (in declared order) and
    // THEN its overflow — the documented canonical-then-overflow order.
    // JS enumerates by INSERTION, so the two agree exactly while every
    // spread sits AFTER every named property: `{ jid, ...attrs }` is
    // jid-then-attrs both ways. `{ ...attrs, jid }` is not — JS says
    // `zeta,alpha,jid` and the struct can only say `jid,zeta,alpha`.
    // Recovering there would trade a LOUD fence for a silently reordered
    // object (measured: s5 in the block's lab), so the shape keeps its
    // fence and this answers undefined.
    const firstSpread = decl.properties.findIndex((p) => ts.isSpreadAssignment(p));
    if (firstSpread >= 0 && !decl.properties.slice(firstSpread).every((p) => ts.isSpreadAssignment(p))) {
      return undefined;
    }
    for (const prop of decl.properties) {
      if (!ts.isSpreadAssignment(prop)) continue;
      sawSpread = true;
      // A spread source with NO signature erased nothing, but it also
      // contributes keys this shape would now claim to store uniformly —
      // and its own fields may not fit the slot. Refuse the whole
      // recovery rather than claim a store one source cannot fill.
      const srcInfos = checker.getIndexInfosOfType(checker.getTypeAtLocation(prop.expression));
      if (srcInfos.length === 0) return undefined;
      for (const info of srcInfos) {
        if (
          !(info.keyType.flags & ts.TypeFlags.String) &&
          !(info.keyType.flags & ts.TypeFlags.Number)
        ) {
          return undefined;
        }
        const iv = mapType(info.valueType, ctx);
        if (!iv || !isSupportedIndexValue(iv)) return undefined;
        if (value !== null && !typeEquals(value, iv)) return undefined;
        value = iv;
      }
    }
  }
  if (!sawSpread || value === null) return undefined;
  // Every DECLARED member must fit the recovered slot. A member the
  // overflow could not hold would make the shape claim a uniform value
  // type it does not have — and every undeclared key read would answer at
  // a type the struct cannot produce.
  for (const p of checker.getPropertiesOfType(widened)) {
    const pt = mapType(checker.getTypeOfSymbol(p), ctx);
    if (!pt || !typeEquals(pt, value)) return undefined;
  }
  if (process.env["SCRIPTC_SPREADIX_WHY"] !== undefined) {
    console.error(`SPREADIX-RECOVER ${checker.typeToString(widened)} idx=${typeKey(value)}`);
  }
  return value;
}

function mapSymbolicMappedAlias(
  widened: ts.Type,
  ctx: TypeMapperCtx,
): IrType | null | undefined {
  const { checker } = ctx;
  if (!ctx.resolveTypeParam) return undefined;
  const alias = widened.getAliasSymbol();
  if (!alias) return undefined;
  const aliasDecls = checker.declarationsOf(alias);
  if (aliasDecls.length === 0 || !aliasDecls.every((d) => ctx.isStdlibFile(d.getSourceFile()))) {
    return undefined;
  }
  if (
    checker.getPropertiesOfType(widened).length > 0 ||
    checker.getIndexInfosOfType(widened).length > 0 ||
    checker.getCallSignatures(widened).length > 0 ||
    checker.getConstructSignatures(widened).length > 0
  ) {
    return undefined;
  }
  const args = widened.getAliasTypeArguments();
  if (alias.name === "Readonly" && args.length === 1 && args[0]) {
    return mapType(args[0], ctx);
  }
  if (alias.name !== "Record" || args.length !== 2) return undefined;
  const [keyT, valueT] = args;
  if (!keyT || !valueT || (keyT.flags & ts.TypeFlags.TypeParameter) === 0) return undefined;
  // The binding must be the BROAD domain, read at the checker level. An IR
  // binding is not enough: mapType widens a literal to string, but a
  // literal-bound instantiation is one the checker resolves on its own —
  // `Record<"sqlite", V>` is a record with a `sqlite` FIELD, and the caller's
  // ABI carries exactly that. Answering an index shape there would hand the
  // body a receiver shaped unlike its own slot.
  const keyTs = ctx.resolveTypeParamTs?.(keyT);
  if (!keyTs || (keyTs.flags & (ts.TypeFlags.String | ts.TypeFlags.Number)) === 0) return undefined;
  const keyIr = ctx.resolveTypeParam(keyT);
  if (!keyIr || (keyIr.kind !== "string" && keyIr.kind !== "f64")) return undefined;
  const indexValue = mapType(valueT, ctx);
  if (indexValue?.kind === "jsval") return JSVAL;
  if (!indexValue || !isSupportedIndexValue(indexValue)) {
    mapTrace(`INDEXVALUE ${checker.typeToString(valueT).slice(0, 60)}`);
    return null;
  }
  return { kind: "record", shapeId: ctx.shapes.intern([], false, indexValue) };
}

/** The ARRAY a `.d.ts`-declared TUPLE field is actually built as, or null.
 *
 * A generated module ships types in `X.d.ts` and values in `X.js`, and when
 * this build compiles the twin (declFileHasCompiledImpl) the twin is the
 * only producer any consumer of that declaration can see. The twin writes
 * JS: it builds the field with an ARRAY literal, whose inferred type is
 * `readonly (A|B)[]` and which maps to an array. The declaration's
 * `readonly [A, B]` describes the very same runtime value more precisely,
 * but a MIXED tuple maps to a positional RECORD — so the declaration and
 * its implementation disagree about the representation and the value
 * cannot enter its own declared slot (zapo's WA_APPSTATE_SCHEMAS: three
 * SC2002, `indexParts: readonly [{type;value},{name;type}]` declared,
 * `readonly ({type;value}|{name;type})[]` built).
 *
 * A UNIFORM readonly tuple already rides the array representation by
 * mapTypeInner's own rule, which is exactly why the one-position schemas
 * there agree today and the two-position ones do not. This extends that
 * agreement to the mixed case on the one provenance where it is forced:
 * the answer is the element union of the positions, the widening the
 * producer already performed. Everything outside a compiled twin keeps the
 * positional record — a tuple written and consumed in TypeScript has a
 * producer that can build one.
 *
 * Null unless the field ALREADY mapped to a positional tuple record (so a
 * uniform tuple, an array, or anything else is untouched), the field type
 * is a real tuple, and every declaration of the property lives in a
 * declaration file whose implementation this build compiled. */
function declTwinTupleAsArray(
  p: ts.Symbol,
  fieldTs: ts.Type,
  mapped: IrType | null,
  ctx: TypeMapperCtx,
): IrType | null {
  if (mapped === null || mapped.kind !== "record") return null;
  const shape = ctx.shapes.get(mapped.shapeId);
  if (shape === undefined || !shape.tuple) return null;
  const { checker } = ctx;
  if (!checker.isTupleType(fieldTs)) return null;
  const decls = checker.declarationsOf(p);
  if (decls.length === 0) return null;
  for (const d of decls) {
    const sf = d.getSourceFile();
    if (!sf.isDeclarationFile) return null;
    if (!(ctx.declFileHasCompiledImpl?.(sf) ?? false)) return null;
  }
  const args = checker.getTypeArguments(fieldTs as ts.TypeReference);
  if (args.length === 0) return null;
  // The element is the union of every POSITION, arms flattened and
  // deduplicated by typeKey — the same widening mapRestTupleUnion performs,
  // and the same one the twin's array literal already performed.
  const byKey = new Map<string, IrType>();
  for (const a of args) {
    const e = mapType(a, ctx);
    if (e === null || e.kind === "void" || e.kind === "jsval" || e.kind === "dyn") return null;
    if (e.kind === "union") {
      for (const arm of ctx.unions.get(e.unionId)?.arms ?? []) byKey.set(typeKey(arm), arm);
    } else {
      byKey.set(typeKey(e), e);
    }
  }
  const distinct = [...byKey.entries()]
    .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))
    .map(([, t]) => t);
  if (distinct.length === 0) return null;
  const answer = arrayOf(
    distinct.length === 1 ? distinct[0]! : { kind: "union", unionId: ctx.unions.intern(distinct) },
  );
  if (process.env["SCRIPTC_ORDER_WHY"] !== undefined) {
    console.error(
      `ORDER twin ${p.name}: ${checker.typeToString(fieldTs).slice(0, 70)}` +
      ` -> ${typeKey(answer).slice(0, 90)}`,
    );
  }
  return answer;
}

function mapRecordTypeInner(widened: ts.Type, ctx: TypeMapperCtx): IrType | RecordShapeParts | null {
  const { checker, shapes } = ctx;
  if (checker.getConstructSignatures(widened).length > 0) return null;
  if (checker.isTupleType(widened) || checker.isArrayLikeType(widened)) return null;
  // ENUM OBJECTS (`typeof e` — the enum used as a first-class value) look
  // exactly like a number-keyed hybrid (member fields + the reverse-map
  // index signature), but the VALUE has no lowering: an enum identifier in
  // value position resolves to nothing. Mapping the type would strand the
  // reference sites, so the enum-object type stays unmapped and badType
  // names the construct.
  const widenedSym = widened.getSymbol();
  if (widenedSym !== undefined && (widenedSym.flags & ts.SymbolFlags.Enum) !== 0) return null;
  {
    const viaSymbolicAlias = mapSymbolicMappedAlias(widened, ctx);
    if (viaSymbolicAlias !== undefined) return viaSymbolicAlias;
  }
  // An index signature maps to a hybrid shape: declared fields keep
  // struct slots, undeclared keys ride the shape's overflow map, valued
  // uniformly by the signature's value type (`unknown` → dyn — a model-pricing table's
  // ModelPricing; `Record<string, T>` resolves here too, declared-field-
  // free). STRING and NUMBER key domains both compile — JS object keys ARE
  // strings (`o[1]` reads `o["1"]`), so a number-keyed signature is the
  // same string-keyed store with every access canonicalized through the
  // JS-exact number formatter (the access lowerings own that step). The
  // `string & {}` key — the special-intersection idiom mapped types use to
  // keep a literal-key union wide (`Record<(string & {}) | "left", T>`) —
  // is a string key: every part is string-flavored or the empty refinement.
  // BOTH signatures at once (string + number) collapse into the one store
  // when their value types intern identically (tsc requires only
  // assignability; unequal slots would need a per-key answer the store
  // cannot give). The value domain is the overflow store's
  // (isSupportedIndexValue): the map-value kinds plus 'unknown', functions
  // (the command-registry pattern), Maps/Sets, and nested index-signature
  // records; everything else stays unmapped.
  let indexValue: IrType | undefined;
  const indexInfos = checker.getIndexInfosOfType(widened);
  if (indexInfos.length > 0) {
    const stringKey = (k: ts.Type): boolean =>
      (k.flags & ts.TypeFlags.String) !== 0 ||
      (k.isIntersectionType() &&
        k.getTypes().every(
          (p) =>
            (p.flags & ts.TypeFlags.String) !== 0 ||
            ((p.flags & ts.TypeFlags.Object) !== 0 &&
              checker.getPropertiesOfType(p).length === 0 &&
              checker.getCallSignatures(p).length === 0 &&
              checker.getConstructSignatures(p).length === 0 &&
              checker.getIndexInfosOfType(p).length === 0),
        ));
    if (indexInfos.length > 2) return null;
    let v: IrType | null = null;
    for (const info of indexInfos) {
      if (!stringKey(info.keyType) && !(info.keyType.flags & ts.TypeFlags.Number)) return null;
      const iv = mapType(info.valueType, ctx);
      // A jsval-valued signature absorbs the shape: `Record<string,
      // JSONValue>` (a package's own JSON alias) and `Record<string, any>`
      // are one island object — the overflow map has no handle slot, and
      // island objects hold arbitrary engine values natively.
      if (iv?.kind === "jsval") return JSVAL;
      if (!iv || !isSupportedIndexValue(iv)) return null;
      if (v !== null && !typeEquals(v, iv)) return null;
      v = iv;
    }
    indexValue = v!;
  }
  // THE SPREAD-ERASED INDEX SIGNATURE, RECOVERED. tsc DISCARDS a spread
  // source's index signature when it infers an object literal's type:
  // `{ jid, ...groupAttrs }` over a `Record<string, string>` source types
  // as `{ jid: string }`, even though the VALUE carries every key the
  // source had. The literal's own inferred type is then what an enclosing
  // literal passes down as contextual type, so the shape the merge builds
  // at has no overflow store — and a merge into it must DROP the runtime
  // keys. Dropping is divergence 68 (honest) when a DECLARED type says
  // those keys do not belong; here the type is only what tsc inferred for
  // this literal, so dropping is a silent wrong answer and the desugar
  // rightly fenced (`dropsAreHonest`). Recovering the signature is what
  // lets the RIGHT answer compile: the shape keeps the overflow map the
  // emitter already builds for every index-signature record, the runtime
  // keys land in it, and enumeration/serialization see them.
  //
  // Deliberately narrow — each condition is what keeps it sound:
  //  - the type must be ANONYMOUS-FROM-A-LITERAL (its symbol's only
  //    declarations are object literal expressions). A type the program
  //    DECLARED means what it says; widening it would invent a store the
  //    author did not ask for and change a declared shape's identity.
  //  - the literal must actually SPREAD something (no spread, nothing was
  //    erased), and EVERY spread source must publish a string/number index
  //    signature. A fixed-shape source erases nothing, and mixing one in
  //    would claim an overflow wider than any source can fill.
  //  - all sources must agree on the value type, and it must be a
  //    supported overflow value — the same domain the declared path takes.
  //
  // A source whose signature does not qualify answers `undefined` and the
  // type maps EXACTLY as it does today (a plain record; the desugar fences
  // at the spread). Recovery only ever ADDS a store when every condition
  // holds — it can never turn a type that maps today into one that does
  // not.
  if (indexValue === undefined) {
    indexValue = spreadErasedIndexValue(widened, ctx);
  }
  // The HEADER-FAMILY canonicalization: an index-signature shape whose
  // slot carries a `string[]` arm (alongside string/number/undefined —
  // nothing else) is the http header world: @types/node's
  // IncomingHttpHeaders and OutgoingHttpHeaders both declare ~60 OPTIONAL
  // well-known members over a Dict slot, and every literal SPREAD of them
  // (`{ ...req.headers, host }`) inherits those phantom members — struct
  // slots they are not; they are well-known KEYS of the slot. All such
  // shapes intern as ONE pure index-signature record over the canonical
  // OUTGOING slot `number | string | string[] | undefined` (numbers join
  // type-level only — parsed header values are strings), provided every
  // declared member's type fits inside the slot. Identical shapes make
  // the proxy's forwarded-header build (`{ ...req.headers }` into an
  // outgoing literal) a plain copy instead of an arm-wise re-tag the
  // merge machinery cannot do.
  if (indexValue?.kind === "union") {
    const slotDef = ctx.unions.get(indexValue.unionId);
    const armOk = (a: IrType): boolean =>
      a.kind === "f64" || a.kind === "string" || a.kind === "undefinedT" ||
      (a.kind === "array" && a.elem.kind === "string");
    if (
      slotDef !== undefined &&
      slotDef.arms.some((a) => a.kind === "array" && a.elem.kind === "string") &&
      slotDef.arms.every(armOk)
    ) {
      const armsRaw = [F64, STRING, arrayOf(STRING), UNDEFINED_T];
      armsRaw.sort((a, b) => (typeKey(a) < typeKey(b) ? -1 : 1));
      const canonical: IrType = { kind: "union", unionId: ctx.unions.intern(armsRaw) };
      const fits = (t: IrType | null): boolean => {
        if (!t) return false;
        if (t.kind === "union") {
          const def = ctx.unions.get(t.unionId);
          return def !== undefined && def.arms.every(armOk);
        }
        return armOk(t);
      };
      if (checker.getPropertiesOfType(widened).every((p) => fits(mapType(checker.getTypeOfSymbol(p), ctx)))) {
        return { kind: "record", shapeId: shapes.intern([], false, canonical, []) };
      }
    }
  }
  // Provenance keeps LIB type worlds out — but a PURE string index
  // signature with no declared members is structurally Record<string, V>
  // wherever it is declared (the lib's Object.fromEntries return type
  // `{ [k: string]: T }` — a data shape, not an API surface). Members, if
  // any, still walk the per-member provenance below.
  const pureIndexShape = indexValue !== undefined && checker.getPropertiesOfType(widened).length === 0;
  // The ANONYMOUS empty object type (`var v: {}` — the checker's shared
  // `{}` intrinsic carries a declaration-less `__type` symbol, so
  // declaration provenance has nothing to inspect): structurally the empty
  // record. tsc admits ANY non-nullish assignment into a `{}` slot;
  // non-record values fence at their assignment site (the exact-shape
  // stance), records of other shapes at theirs — the declaration itself is
  // representable.
  const anonSym = widened.getSymbol();
  const anonymousEmpty =
    (anonSym === undefined || checker.declarationsOf(anonSym).length === 0) &&
    !widened.isIntersectionType() &&
    indexValue === undefined &&
    checker.getPropertiesOfType(widened).length === 0;
  if (!recordProvenanceOk(widened, checker, ctx) && !pureIndexShape && !anonymousEmpty) return null;
  // Checker-computed shapes (no user declaration) need two extra fences in
  // the member walk below; see the comments there.
  const computed = widened.isIntersectionType() || isMappedShape(widened);
  {
    const props = checker.getPropertiesOfType(widened);
    // A computed shape with NO members is not a real empty record: inside a
    // generic body `Partial<T>` resolves to no members at all (keyof T is
    // still unknown there) — interning `{}` would be silently wrong. The
    // degenerate empties (`Partial<{}>`, `Omit<C, keyof C>`) go with it.
    // An INDEX-SIGNATURE shape is exempt: `Record<string, T>` legitimately
    // has zero declared members — the signature is the shape.
    // ...unless the shape is fully INSTANTIATED. The danger above is a
    // generic BODY, where `keyof T` is not known yet and the emptiness is
    // an artifact of not having the argument. Once every type argument is
    // a concrete type, an empty result is the answer, not a gap:
    // `WaAppstateIndexArgs<"TimeFormat">` has no index parts because that
    // schema declares none. Refusing it there fails the whole intersection
    // it sits in, and with it every union arm, field and class above.
    const mentionsTypeParam = (t: ts.Type, depth: number): boolean => {
      if (depth > 4) return true; // give up conservatively: keep the refusal
      if (t.flags & ts.TypeFlags.TypeParameter) return true;
      const args: readonly ts.Type[] = t.getAliasTypeArguments() ?? [];
      return args.some((a) => mentionsTypeParam(a, depth + 1));
    };
    if (computed && props.length === 0 && !indexValue && mentionsTypeParam(widened, 0)) {
      return null;
    }
    // A DECLARED empty object type — `{}` (spelled or the checker's shared
    // intrinsic), `interface Empty {}` — is tsc's TOP type over non-nullish
    // values: every number, string, record, array, function, or class
    // instance is assignable into the slot, so the exact-record stance
    // cannot hold it. It lowers like `unknown` (the dyn), the same rule
    // as `object` and the lib's `Object`: assignments convert at the site
    // (sources outside the checked-dynamic tree fence there, exactly as unknown does), reads
    // narrow back out through the same checked casts. The type INFERRED
    // from an empty object literal (`const o = {}`) stays the empty record
    // — it describes a value the program built, not an annotation that
    // admits everything — and computed empties (`Partial<T>` in a generic
    // body) returned null above. Empty shapes WITH an index signature
    // (`Record<string, T>`) are not empty: the signature is the shape.
    if (
      props.length === 0 &&
      indexValue === undefined &&
      checker.getCallSignatures(widened).length === 0 &&
      checker.getConstructSignatures(widened).length === 0 &&
      !(anonSym !== undefined && checker.declarationsOf(anonSym).some((d) => ts.isObjectLiteralExpression(d)))
    ) {
      return DYN;
    }
    const fields: { name: string; type: IrType }[] = [];
    for (const p of props) {
      // ...or a DATA property that some literal in this program satisfies
      // with a getter. One layout has to serve both producers, so the slot
      // is decided over the whole program (accessorProducerProp) rather
      // than from this declaration alone.
      const producerAccessor =
        (p.flags & (ts.SymbolFlags.GetAccessor | ts.SymbolFlags.SetAccessor)) === 0 &&
        ctx.accessorProducerProp?.(p) === true;
      if (p.flags & (ts.SymbolFlags.GetAccessor | ts.SymbolFlags.SetAccessor) || producerAccessor) {
        // OBJECT-LITERAL get/set accessors (TS sources): the property has
        // no data slot — the shape carries reserved closure fields instead
        // (`%get:x` invoked per read, `%set:x` per write; see
        // accessorSlotProp in ir/nodes.ts). Type-literal and interface
        // accessor MEMBERS map the same way so accessor records cross
        // annotated boundaries (`function f(p: { get x(): number })`) —
        // tsc lets a plain DATA property satisfy such a member, but the
        // exact-shape stance turns that into a loud shape-mismatch fence
        // at the literal, never a silent split. JS-file literals keep
        // their existing paths (the CJS export-table narrowing and the
        // checked-dynamic fallback), and .d.ts declarations stay out with
        // the rest of the lib's type worlds.
        const decls = checker.declarationsOf(p);
        const getDecl = decls.find((d) => ts.isGetAccessorDeclaration(d));
        const setDecl = decls.find((d) => ts.isSetAccessorDeclaration(d));
        const accessorOwned =
          decls.length > 0 &&
          decls.every(
            (d) =>
              (ts.isGetAccessorDeclaration(d) || ts.isSetAccessorDeclaration(d)) &&
              d.parent !== undefined &&
              (ts.isObjectLiteralExpression(d.parent) ||
                ts.isInterfaceDeclaration(d.parent) ||
                d.parent.kind === ts.SyntaxKind.TypeLiteral) &&
              !d.getSourceFile().isDeclarationFile &&
              !isJsSourceFile(d.getSourceFile()),
          );
        if (!producerAccessor && (!accessorOwned || (!getDecl && !setDecl))) return null;
        // Symbol-keyed accessors have no foldable literal name to fill at
        // the literal — no slot to make.
        if (p.name.startsWith("__@")) return null;
        // An index-signature shape stores accessor NAMES nowhere the keyed
        // read/walk machinery can answer (the overflow would miss where
        // Node dispatches the getter) — those shapes stay unmapped.
        if (indexValue !== undefined) return null;
        let readT: IrType | null = null;
        if (getDecl || producerAccessor) {
          readT = mapType(checker.getTypeOfSymbol(p), ctx);
          if (readT === null || readT.kind === "jsval") return null;
        }
        let writeT: IrType | null = null;
        if (setDecl) {
          const param = (setDecl as ts.SetAccessorDeclaration).parameters[0];
          if (!param) return null;
          writeT = mapType(checker.getTypeAtLocation(param), ctx);
          // A void/unit-typed write slot has no value form; DIVERGENT
          // getter/setter types stay out too (one property, one type —
          // the class-accessor stance).
          if (writeT === null || writeT.kind === "void" || writeT.kind === "jsval" || isUnitType(writeT)) return null;
          if (readT !== null && typeKey(readT) !== typeKey(writeT)) return null;
        }
        if (readT !== null || getDecl) fields.push({ name: `%get:${p.name}`, type: funcOf([], readT ?? VOID) });
        if (writeT !== null) fields.push({ name: `%set:${p.name}`, type: funcOf([writeT], VOID) });
        continue;
      }
      // Computed shapes carry provenance per MEMBER: a utility type over a
      // lib interface (`Readonly<Date>`) is still the lib's type world, not
      // a data shape. Synthesized members (a literal-key Record's) have no
      // declarations and pass. EXCEPT a pure-DATA member from a .d.ts (a
      // protobuf message's `details?: Uint8Array | null`) in a STATIC
      // build: it is buildable exactly like the data-only interface rule,
      // one member down — the intersection `ADVSignedDeviceIdentity &
      // $Shape` reaches here per field. A member whose type is callable
      // (a method / engine surface like `Readonly<Date>`'s getTime) keeps
      // the fence; --dynamic keeps the island-handle representation.
      if (computed && checker.declarationsOf(p).some((d) => d.getSourceFile().isDeclarationFile)) {
        const memberTs = checker.getTypeOfSymbol(p);
        const dataMember =
          ctx.dynamic !== true &&
          checker.getCallSignatures(memberTs).length === 0 &&
          checker.getConstructSignatures(memberTs).length === 0;
        if (!dataMember) return null;
      }
      const fieldTs = checker.getTypeOfSymbol(p);
      // GENERIC-callable members leave the shape (no single closure slot
      // can hold them — see isGenericCallableMemberType): the shape keeps
      // its data fields, and calls of the member monomorphize per call
      // site against the defining object literal's declaration.
      // ...unless the signature maps at its CONSTRAINT instantiation, which
      // gives it an ordinary closure slot (mapTypeInner's generic-value
      // rule). Only a member that still fails to map leaves the shape.
      // The attempt for a GENERIC member is SPECULATIVE — the member leaves
      // the shape if it fails — so it runs under a rollback point: a failed
      // walk can mint a recursive placeholder nothing will finalize, and a
      // later mapping reaching the same checker type through recIds would
      // carry that empty union/shape into the program.
      const generic = isGenericCallableMemberType(fieldTs, checker);
      if (process.env["SCRIPTC_MEMBER_WHY"] !== undefined) {
        const cs = checker.getCallSignatures(fieldTs);
        console.error(`[memberwhy] ${checker.typeToString(widened).slice(0,40)} . ${p.name}`
          + ` generic=${generic} sigs=${cs.length} tps=${cs.map((x) => x.getTypeParameters()?.length ?? 0).join("/")}`);
      }
      if (generic && process.env["SCRIPTC_GENERIC_SLOT"] === undefined) continue;
      // REFUSE BEFORE DESCENDING. The attempt below is speculative and its
      // failure is rolled back, but the rollback does not undo everything
      // the descent touches (measured: withholding refusals from the memo,
      // and disabling the memo outright, both leave the regression intact).
      // A member mentioning an unbound type parameter can only fail, so do
      // not walk it at all — which is exactly what the feature-off path did.
      const uMark = generic ? ctx.unions.mark() : 0;
      const sMark = generic ? shapes.mark() : 0;
      // The sensitivity counters are GLOBAL and drive two decisions outside
      // this frame: the recursive fence (a frame whose counter moved
      // refuses to intern by type identity) and the memo cache. A
      // speculative walk that gets thrown away must not move them, or an
      // ENCLOSING legitimate frame judges itself context-sensitive and
      // gives up over work that no longer exists.
      const ctxResAtTry = contextResolutions;
      const memoSensAtTry = memoSensitivity;
      // ...and the MEMO, which the rollback below cannot reach. A generic
      // member's attempt descends where the ordinary walk never goes (on
      // zapo: into WaClientPluginContext, down to an open `keyof
      // TPluginEvents`); every refusal it meets on the way was landing in
      // the memo against the real ctx, so the legitimate mapping of
      // WaClientPluginDefinition later read back a null it never earned
      // and WaClientOptions stopped mapping entirely.
      const tryCtx: TypeMapperCtx = generic ? { ...ctx, speculative: true } : ctx;
      let pt = mapType(fieldTs, tryCtx);
      // A field DECLARED in a `.d.ts` whose IMPLEMENTATION twin this build
      // COMPILES: the twin is the only producer the slot can ever have, and
      // it writes JS — an array literal, whose own inferred type is
      // `readonly (A|B)[]`. A mixed TUPLE in the declaration is the precise
      // spelling of that same runtime array, but it maps to a positional
      // RECORD, so declaration and implementation disagree about the
      // REPRESENTATION and every read across the boundary fences. Map the
      // declaration the way its implementation builds it.
      {
        const viaTwin = declTwinTupleAsArray(p, fieldTs, pt, ctx);
        if (viaTwin !== null) pt = viaTwin;
      }
      if (pt === null && generic) {
        // The member leaves the shape — say so. An exclusion that prints
        // nothing makes the NEXT failure invisible exactly where this
        // change acts (it hid the rest-tuple fence for several rounds).
        mapTrace(`GENMEMBER ${checker.typeToString(widened).slice(0, 40)} . ${p.name} : ${checker.typeToString(fieldTs).slice(0, 70)}`);
        ctx.unions.rollback(uMark);
        shapes.rollback(sMark);
        contextResolutions = ctxResAtTry;
        memoSensitivity = memoSensAtTry;
        continue;
      }
      if (pt !== null && process.env["SCRIPTC_PENDING_WHY"] !== undefined) {
        const anyPend = referencesPendingPlaceholder(pt, ctx.unions, shapes);
        if (anyPend !== null) {
          console.error(
            `[pendwhy] ${generic ? "GEN" : "plain"} ${checker.typeToString(widened).slice(0, 80)} . ${p.name} -> ${anyPend}`,
          );
        }
      }
      if (generic && pt !== null) {
        const pend = referencesPendingPlaceholder(pt, ctx.unions, shapes);
        if (pend !== null) {
          // The slot would keep a placeholder whose own frame may still
          // fail; the member leaves the shape instead, exactly as it did
          // before it could map at all.
          ctx.unions.rollback(uMark);
          shapes.rollback(sMark);
          continue;
        }
      }
      // tsgo PANICS computing `readonly []` through the symbol-type query
      // (the TupleType conversion — the facade's panic fence answers
      // `any`), which would absorb the whole shape into the dynamic tier.
      // The declaration pins the truth syntactically: a property whose
      // initializer is an EMPTY array literal inside a const assertion IS
      // the empty tuple — map it exactly as the tuple branch does (the
      // unit-element array; see the `[] as const` rule there).
      if ((pt === null || pt.kind === "jsval") && (fieldTs.flags & ts.TypeFlags.Any) !== 0 && constAssertedEmptyArrayProp(p, ctx)) {
        pt = arrayOf(unitOnlyUnion(ctx.unions));
      }
      // Unit-only FIELDS (`{ msg?: undefined }` — the discriminated-union
      // absent-field idiom — and `{ p: undefined }` spellings): the
      // unit-only union. The runtime value is the interned unit, JSON
      // omits the undefined arm exactly like an omitted optional.
      if (pt?.kind === "void" && isUnitOnlyTsType(fieldTs)) pt = unitOnlyUnion(ctx.unions);
      // dyn FIELDS map now (`{ v: unknown }`, `[string, unknown]` tuples):
      // the slot carries a dyn value exactly like an `unknown`-valued
      // overflow entry — same RC adapters, same dynFrom conversion on the
      // way in, same checked casts on the way out. (JSON.stringify of a
      // dyn-field-bearing shape keeps its fence: jsonSafe stays false.)
      if (!pt || pt.kind === "void") {
        mapTrace(`MEMBER ${checker.typeToString(widened).slice(0, 46)} . ${p.name} : ${checker.typeToString(fieldTs).slice(0, 60)}`);
        return null;
      }
      // A DATA property spelled like a reserved accessor slot (`{ "%get:x":
      // v }` — a string-literal key): mapping it would collide with the
      // accessor dispatch, so the shape stays unmapped.
      if (accessorSlotProp(p.name) !== null) return null;
      // A bare jsval FIELD absorbs the record: shapes have no handle slot
      // (the IR forbids jsval fields — no JSON story), while an island
      // OBJECT holds engine values natively — `{ model: gateway(id),
      // prompt }` is one island object, built field by field (jsval
      // members as the same handle, static members marshaled). jsval-
      // BEARING composite fields (`content: any[]`) keep their static
      // shape — the lift covers them.
      if (pt.kind === "jsval") return JSVAL;
      fields.push({ name: p.name, type: pt });
    }
    // getPropertiesOfType yields DECLARATION order (interface/alias/literal
    // source order) — captured before the canonical sort so Object.keys/
    // entries/values can emit it (SEMANTICS.md 36). Two rules compose:
    // accessor slots stay out like every '%'-field (key-order surfaces
    // over accessor-carrying shapes fence by name at their lowerings),
    // and JS's own-key order applies — integer-like keys (canonical array
    // indices, from folded numeric computed keys and quoted numeric keys)
    // enumerate FIRST ascending, then string keys in insertion order
    // (OrdinaryOwnPropertyKeys) — Object.keys/JSON/inspect all read it.
    const declaredOrder = esOwnKeyOrder(fields.filter((f) => accessorSlotProp(f.name) === null).map((f) => f.name));
    fields.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return { fields, ...(indexValue ? { indexValue } : {}), declaredOrder };
  }
}

/* ── Component-fence classification (SC2009) ───────────────────────────────
 * badType's post-hoc classifiers: given a type mapType REJECTED, decide
 * whether the failure lives in a COMPONENT of an otherwise supported shape
 * — and if so, name it. Pure description: these run only on the failure
 * path (the build already carries a diagnostic for the site), mirror
 * mapType's own rules, and never change what maps. Probing through mapType
 * here is safe for the same reason badType's dynamic probe is: anything
 * interned on the way belongs to a build that is not emitted. */

/** The recognized stdlib containers and the slot name each type-argument
 * position plays in their messages. */
const STDLIB_CONTAINERS: Record<string, { role: (i: number) => string }> = {
  Map: { role: (i) => (i === 0 ? "key" : "value") },
  ReadonlyMap: { role: (i) => (i === 0 ? "key" : "value") },
  Set: { role: () => "element" },
  ReadonlySet: { role: () => "element" },
  Promise: { role: () => "value" },
  Generator: { role: (i) => ["yield", "return", "next"][i] ?? "channel" },
  AsyncGenerator: { role: (i) => ["yield", "return", "next"][i] ?? "channel" },
};

/** The `string | object`-family collapse domain (mapTypeInner's union
 * rule): arms the checked-dynamic representation holds FAITHFULLY, so a
 * union carrying a dyn arm beside only these maps to DYN wholesale.
 * Scalars and units are the checked-dynamic tree's own kinds (value-exact ===/typeof);
 * records and arrays qualify exactly when the dynFrom conversion can
 * build them (canConvertToDyn — JSON-safe data plus bytes-bearing
 * composites), entering as dyn data under the documented deep-copy
 * stance. Everything else — class instances, Maps/Sets, functions
 * (closure identity and `x === String` narrowing live in the typed union
 * machinery), promises, regexes, generators, handles, nested unions —
 * would DEGRADE (identity, methods, dispatch) riding dyn, so those arms
 * keep their existing homes and fences. */
export function dynSubsumableUnionArm(arm: IrType, ctx: TypeMapperCtx): boolean {
  switch (arm.kind) {
    case "dyn":
    case "f64":
    case "string":
    case "bool":
    case "undefinedT":
    case "nullT":
      return true;
    case "record":
    case "array":
      return canConvertToDyn(arm, (id) => ctx.shapes.get(id), (id) => ctx.unions.get(id));
    default:
      return false;
  }
}

/** True when `typeof` on this arm answers something OTHER than "object", so a
 * `typeof` test tells it apart from a promise sibling (typeofAnswer in
 * lower-exprs is the authority on the answers; this is the object/non-object
 * split it induces). */
function typeofSplitsFromObject(arm: IrType): boolean {
  switch (arm.kind) {
    case "f64":
    case "string":
    case "bool":
    case "func":
    case "symbol":
    case "bigint":
      return true;
    default:
      return false;
  }
}

/** Whether every arm of a candidate compiled union has a runtime home —
 * mapTypeInner's union rule, lifted so the PAYLOAD of an all-promise union
 * can be judged by exactly the same rules as a union spelled directly.
 * Sharing the predicate is the point: a payload that has no representation
 * on its own must not acquire one by arriving inside a promise. */
function unionArmsHaveHomes(arms: IrType[], unions: UnionRegistry): boolean {
  return !arms.some(
    (a) =>
      a.kind === "void" || a.kind === "union" ||
      // Map/Set arms have no narrowing test against DATA siblings
      // (no discriminant fields, and typeof answers "object" like
      // the rest) — but against units there is nothing to narrow:
      // the unit TAG test is the whole story, which is the
      // container-or-absent shape a Map lookup returns
      // (`Map<string, Set<T>>.get(k)`). Beside any data sibling they
      // stay out. REGEX arms map anywhere: `x instanceof RegExp` is
      // their narrowing test (the skip-utility `string | RegExp`
      // shape), and the arm rides the ref machinery like array regex
      // elements.
      ((a.kind === "map" || a.kind === "set") &&
        !arms.every((c) => c === a || isUnitType(c))) ||
      a.kind === "dyn" ||
      // Generator arms follow the map/set rule: no narrowing test.
      a.kind === "generator" ||
      // Func arms map beside ANY sibling: `typeof x === "function"`
      // is the narrowing against data arms (typeofAnswer knows every
      // arm kind), unit TAG tests cover the nullable-callback shape
      // (cb !== null, cb ?? f, cb?.()), and against FUNC siblings
      // (`StringConstructor | NumberConstructor` — the option-table
      // field) closures compare by pointer identity per tag
      // (unionEq), so `x === String` narrows. No restriction left.
      // Promise arms follow the func rule (typeof gives no test
      // against sibling data arms): only the promise-or-absent shape
      // maps — `Promise<T> | undefined`, and `Promise<T> | void`
      // return types whose void part became the undefined arm above.
      // Promise arms need a narrowing test against every sibling DATA
      // arm. `typeof` supplies one whenever the sibling answers
      // something other than "object" — `typeof v === "string"` splits
      // `string | Promise<string>` exactly, which is the shape a
      // resolver option takes (`T | (() => T | Promise<T>)`).
      //
      // Against another "object" answer `typeof` gives nothing, and
      // exactly one shape survives that: the SETTLE-OR-VALUE contract
      // `T | Promise<T>`, whose sole consumer is `await` — which needs
      // no test, because the union's own TAG picks the branch
      // (lower-exprs' await lowering). Any other object-flavored
      // sibling, and a second promise arm, stay refused: there the
      // value would have to be told apart to be used at all.
      (a.kind === "promise" &&
        !arms.every((c) => c === a || isUnitType(c) || typeofSplitsFromObject(c)) &&
        !settleOrValueArms(a, arms, unions)),
  );
}

/** Arm kinds with no home in a compiled union (mapTypeInner's union rule):
 * no runtime narrowing test exists against sibling data arms. */
function armHasUnionHome(arm: IrType, siblingCount: number): boolean {
  switch (arm.kind) {
    case "void":
    case "union":
    case "regex":
    case "generator":
    case "dyn":
      return false;
    // Map/Set arms: only beside units (the container-or-absent shape a Map
    // lookup returns). Against a data sibling there is no narrowing test —
    // see mapTypeInner's union rule.
    case "map":
    case "set":
      return siblingCount === 0;
    // Promise arms map beside unit siblings (the promise-or-absent shape)
    // and beside exactly ONE data sibling that IS their payload (the
    // settle-or-value contract `T | Promise<T>`, whose only consumer is
    // `await` — see mapTypeInner's union rule). Anything else has no
    // narrowing test against them.
    // Promise arms: the mapper's union rule checked the settle-or-value
    // shape exactly, and the explainer cannot see the payload from here, so
    // it defers — an arm that reached this point already passed that rule.
    case "promise":
      return true;
    default:
      return true;
  }
}

/** When an unmapped type is a SUPPORTED container/composite whose failure
 * lives in a component, answer a message tail naming the component (the
 * SC2009 story); null when the shape itself is the blocker (the caller
 * falls through to the other fences). Stdlib container heads (Map, Set,
 * Promise, generators) ALWAYS answer — their shapes have lowerings, so a
 * later "no lowering" claim about them would be false. */
export function describeComponentBlocker(widened: ts.Type, ctx: TypeMapperCtx): string | null {
  const { checker } = ctx;
  const text = (t: ts.Type): string => checker.typeToString(t);

  // Stdlib container references (provenance, not the name — a user's own
  // `interface Map` is a record shape and keeps the record stories).
  const psym = widened.getSymbol();
  const container =
    psym !== undefined &&
    Object.prototype.hasOwnProperty.call(STDLIB_CONTAINERS, psym.name) &&
    checker.declarationsOf(psym).some(
      (d) => ts.isInterfaceDeclaration(d) && ctx.isStdlibFile(d.getSourceFile()),
    )
      ? psym.name
      : undefined;
  if (container !== undefined) {
    const spec = STDLIB_CONTAINERS[container]!;
    const args = checker.getTypeArguments(widened as ts.TypeReference);
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]!;
      const role = spec.role(i);
      const mapped = mapType(arg, ctx);
      if (!mapped) {
        return `the ${container} shape is supported, but its ${role} type '${text(arg)}' does not compile`;
      }
      if ((container === "Map" || container === "ReadonlyMap") && i === 0 && !isSupportedMapKey(mapped)) {
        return `the ${container} shape is supported, but keys are limited to numbers and strings — '${text(arg)}' is outside that domain`;
      }
      if ((container === "Map" || container === "ReadonlyMap") && i === 1 && !isSupportedMapValue(mapped)) {
        return `the ${container} shape is supported, but '${text(arg)}' values have no Map slot yet (functions, promises, and nested Maps stay out)`;
      }
      if ((container === "Set" || container === "ReadonlySet") && !isSupportedSetElem(mapped)) {
        return `the ${container} shape is supported, but elements are limited to numbers and strings — '${text(arg)}' is outside that domain`;
      }
    }
    // Every argument passed the per-slot checks and the type still failed:
    // a composition rule the slots alone don't show (a generator's channel
    // interplay, a promise wrapper rule). Still the container's story.
    return `the ${container} shape is supported, but this instantiation's type arguments are outside the supported set`;
  }

  // Arrays: the element is the failure by construction (a mappable element
  // makes the array map).
  if (checker.isArrayType(widened)) {
    const elemTs = checker.getTypeArguments(widened as ts.TypeReference)[0];
    if (elemTs === undefined) return null;
    const elem = mapType(elemTs, ctx);
    if (!elem) {
      return `the array shape is supported, but its element type '${text(elemTs)}' does not compile`;
    }
    return `the array shape is supported, but '${text(elemTs)}' elements have no array representation yet`;
  }

  // Tuples: name the first element whose type does not map. Optional/rest
  // tuples in static builds are dynamic-representable and never get here
  // (badType's dynamic probe speaks first).
  if (checker.isTupleType(widened)) {
    for (const arg of checker.getTypeArguments(widened as ts.TypeReference)) {
      const et = mapType(arg, ctx);
      if (et?.kind === "void" && isUnitOnlyTsType(arg)) continue;
      if (!et || et.kind === "void") {
        return `the tuple shape is supported, but its element type '${text(arg)}' does not compile`;
      }
    }
    return null;
  }

  // Unions: name the first arm that does not compile, or the first mapped
  // arm kind with no union home. Unions have no symbol, so a null answer
  // falls through to the residual fence, never to a false lib claim.
  if (widened.isUnionType()) {
    const parts = widened.getTypes();
    const UNIT = ts.TypeFlags.Undefined | ts.TypeFlags.Void | ts.TypeFlags.Null;
    const dataArms = parts.filter((p) => (p.flags & UNIT) === 0);
    // A union carrying an 'object'/'unknown'-flavored arm rides the
    // checked-dynamic representation WHOLESALE when every sibling is
    // dyn-subsumable (mapTypeInner's collapse) — so when such a union
    // still failed, the story is the sibling that CANNOT ride the
    // collapse, never the dyn arm itself.
    const mappedArms = dataArms.map((p) => ({ p, mapped: mapType(p, ctx) }));
    if (mappedArms.some(({ mapped }) => mapped?.kind === "dyn")) {
      const blocker = mappedArms.find(
        ({ mapped }) => mapped !== null && !dynSubsumableUnionArm(mapped, ctx),
      );
      if (blocker) {
        return `the union shape is supported, and unions in the 'string | object' family ride the checked-dynamic representation wholesale, but '${text(blocker.p)}' arms have a typed representation whose semantics (identity, methods, dispatch) do not survive that collapse`;
      }
      // Every sibling subsumable and the union STILL failed: the
      // recursive-placeholder fence (a degenerate spelling) — no per-arm
      // story is true, so the residual fence speaks.
      return null;
    }
    for (const { p: part, mapped } of mappedArms) {
      if (!mapped) {
        return `the union shape is supported, but its arm '${text(part)}' does not compile`;
      }
      // Mirror the mapper's nested-union SPLICE: a substituted arm that
      // mapped to a finalized union is flattened before the home rules run,
      // so it is never itself the blocker — the honest story is one of the
      // arms it contributed, and the loop keeps looking. Only a PENDING
      // placeholder (no arms to splice) is still blamed here, which is
      // exactly what the mapper refused.
      if (mapped.kind === "union") {
        const inner = ctx.unions.get(mapped.unionId);
        if (inner !== undefined && !ctx.unions.isPending(mapped.unionId) && inner.arms.length > 0) {
          continue;
        }
      }
      if (!armHasUnionHome(mapped, dataArms.length - 1)) {
        return `the union shape is supported, but '${text(part)}' arms have no home in a compiled union yet (no runtime narrowing test exists against sibling arms)`;
      }
    }
    return null;
  }

  // Single-signature, non-generic function types: rest parameters, a
  // parameter type, or the return type carries the failure. (Generic and
  // overloaded signatures have their own fences — SC2005/SC2007 — and
  // badType runs those first.)
  const callSigs = checker.getCallSignatures(widened);
  if (callSigs.length === 1) {
    const sig = callSigs[0]!;
    if (sig.getTypeParameters().length > 0) return null;
    const sigDecl = checker.signatureDeclaration(sig);
    if (
      sigDecl !== undefined &&
      ts.isFunctionLike(sigDecl) &&
      (sigDecl.parameters.length !== sig.getParameters().length ||
        bodyReadsArgumentsLocal(sigDecl as { body?: ts.Node }))
    ) {
      return `the function shape is supported, but its signature is variadic ('arguments'-reading), and a compiled signature is fixed-arity`;
    }
    for (const p of sig.getParameters()) {
      const decl = checker.valueDeclarationOf(p);
      if (decl !== undefined && ts.isParameter(decl) && decl.dotDotDotToken !== undefined) {
        return `the function shape is supported, but its rest parameter '${p.name}' has no compiled calling convention yet (a compiled signature is fixed-arity)`;
      }
      const pTs = checker.getTypeOfSymbol(p);
      if (!mapType(pTs, ctx)) {
        return `the function shape is supported, but its parameter '${p.name}' has type '${text(pTs)}', which does not compile`;
      }
    }
    const retTs = checker.getReturnTypeOfSignature(sig);
    if ((retTs.flags & ts.TypeFlags.Never) === 0 && !mapType(retTs, ctx)) {
      return `the function shape is supported, but its return type '${text(retTs)}' does not compile`;
    }
    return null;
  }

  return null;
}

/** The record-member arm of the component fence: a USER record shape
 * blocked by ONE member's type. Runs AFTER badType's stdlib/npm/index-
 * signature routing, so what reaches it is a plain data shape; a null
 * answer (no member pinpointed — provenance fences, accessor rules, shape
 * knots) keeps the residual SC2001 story. */
export function describeRecordMemberBlocker(widened: ts.Type, ctx: TypeMapperCtx): string | null {
  const { checker } = ctx;
  if ((widened.flags & ts.TypeFlags.Object) === 0) return null;
  if (checker.getCallSignatures(widened).length > 0) return null;
  if (checker.getConstructSignatures(widened).length > 0) return null;
  if (checker.isTupleType(widened) || checker.isArrayLikeType(widened)) return null;
  if (checker.getIndexInfosOfType(widened).length > 0) return null;
  const widenedSym = widened.getSymbol();
  if (widenedSym !== undefined && (widenedSym.flags & ts.SymbolFlags.Enum) !== 0) return null;
  const computed = isMappedShape(widened);
  for (const p of checker.getPropertiesOfType(widened)) {
    // Accessor members and symbol-keyed members have their own multi-shaped
    // rules (mapRecordTypeInner) — no single-member claim is honest there.
    if ((p.flags & (ts.SymbolFlags.GetAccessor | ts.SymbolFlags.SetAccessor)) !== 0) continue;
    if (p.name.startsWith("__@")) continue;
    // Computed shapes over LIBRARY members (`Readonly<Date>`): the record
    // fence there is per-member PROVENANCE (mapRecordTypeInner's rule), not
    // any one member's type — that story stays with the residual fence.
    if (computed && checker.declarationsOf(p).some((d) => d.getSourceFile().isDeclarationFile)) {
      return null;
    }
    const fieldTs = checker.getTypeOfSymbol(p);
    if (isGenericCallableMemberType(fieldTs, checker)) continue;
    let pt = mapType(fieldTs, ctx);
    if (pt?.kind === "void" && isUnitOnlyTsType(fieldTs)) pt = unitOnlyUnion(ctx.unions);
    if (!pt || pt.kind === "void") {
      return `the record shape is supported, but its member '${p.name}' has type '${checker.typeToString(fieldTs)}', which does not compile`;
    }
  }
  return null;
}
/** The shared element type of a union whose every arm is a tuple, or null.
 * Only spelled when the arms are ALL tuples and every element maps to the
 * same IR type -- a literal row table. Anything heterogeneous keeps the
 * ordinary union treatment, where the arms carry their own shapes. */
function uniformTupleUnionElem(t: ts.UnionType, ctx: TypeMapperCtx): IrType | null {
  const parts = t.getTypes();
  if (parts.length < 2) return null;
  const checker = ctx.checker;
  let elem: IrType | null = null;
  for (const part of parts) {
    if (!checker.isTupleType(part)) return null;
    const args = checker.getTypeArguments(part as ts.TypeReference);
    if (args.length === 0) return null;
    for (const a of args) {
      const mapped = mapType(a, ctx);
      if (mapped === null || mapped.kind === "void") return null;
      if (elem === null) elem = mapped;
      else if (typeKey(elem) !== typeKey(mapped)) return null;
    }
  }
  return elem;
}
