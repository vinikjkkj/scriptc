/* The dyn (ScrDyn) helper EMITTERS for the LLVM backend — the .ll
 * mirror of emit-walkers.ts's dyn slice: per-type match predicates
 * (dynMatchHelper), checked builders (dynCheckHelper), static→dyn
 * converters (toDynHelper), the type-independent singletons (String
 * (unknown), caught→dyn, the keyed read, the destructuring
 * RequireObjectCoercible, GetIterator+N), and the checked-dynamic
 * function boundary's thunk/box/adapter triple. Every helper follows the
 * C emitter's semantics EXACTLY — same runtime entry points, same
 * ownership, same path-annotated failure texts — so the differential
 * suite's byte-parity contract holds through either backend.
 *
 * dyn layout facts this file compiles against (scr_runtime.h):
 *   ScrDyn   { size_t rc; ScrDynKind kind; bool buffer; union v; }
 *            kind at +8 (i32), buffer at +12 (i8), v at +16.
 *            v.num double | v.b i8 | v.str/v.bytes ptr at +16;
 *            v.arr { len +16, cap +24, items +32 };
 *            v.obj { len +16, cap +24, entries +32 };
 *            v.fn  { clo +16, thunk +24, sig +32, name +40, arity +48 }.
 *   ScrDynEntry { char *key; size_t key_len; ScrDyn *value; } — 24 bytes.
 *   ScrDynKind: NULL=0 BOOL=1 NUM=2 STR=3 ARR=4 OBJ=5 UNDEF=6 BYTES=7
 *               FUNC=8 HANDLE=9.
 *   ScrBytes { rc +0; len +8; elem +16; data +24 }.
 *   ScrDynPath { parent, key, index } — the %ScrDynPath type. */
import type { IrType } from "../../ir/nodes.js";
import { canAdaptDynFuncTo, canBoxFuncIntoDyn, DYN_BYTES_KINDS, DYN_HANDLE_KINDS, isRefCounted, strandedFuncReason, typeKey } from "../../ir/nodes.js";
import { mangleRecordNew, mangleRecordStruct } from "../mangle.js";
import { BlockBuilder } from "./blocks.js";
import { arrNewCall, elemAccess, llFieldType, releaseSym, traceAdapter, traceArg, vAdapters } from "./shapes.js";
import { LlvmUnsupportedError } from "./unsupported.js";
import type { WalkerHost } from "./walkers.js";

/** ScrDynKind values (scr_runtime.h). */
/** ScrDynHandleTag numeric values (scr_runtime.h's enum order). */
export const DYN_HANDLE_TAG_NUM: Record<string, number> = {
  httpReq: 0,
  httpRes: 1,
  netSocket: 2,
  netServer: 3,
  // 4..7 (h2Session, h2Stream, httpClientReq, httpAgent) are not listed:
  // this lane has never emitted one, and a WRONG number here is a
  // mis-tagged handle rather than a build error. See dynHandleTagNum.
  regex: 8,
  childStream: 9,
};

/** The tag's numeric value, or the LLVM lane's honest miss.
 *
 * The C backend writes the tag by NAME, so the enum answers it; this lane
 * writes the number, and a kind the table has no row for used to
 * interpolate `undefined` straight into the IR — text that only fails at
 * llc parse time, with a message naming a token rather than a construct.
 * A miss is the lane's own gap, which is exactly what
 * LlvmUnsupportedError spells: the build falls back to the C emitter and
 * the note names the kind. */
export function dynHandleTagNum(kind: string): number {
  const n = DYN_HANDLE_TAG_NUM[kind];
  if (n === undefined) throw new LlvmUnsupportedError(`dyn-handle-tag:${kind}`);
  return n;
}

export const DK = {
  NULL: 0,
  BOOL: 1,
  NUM: 2,
  STR: 3,
  ARR: 4,
  OBJ: 5,
  UNDEF: 6,
  BYTES: 7,
  FUNC: 8,
  HANDLE: 9,
  PROMISE: 10,
  JSVAL: 11, /* SCR_DYN_JSVAL — island values held by reference */
  OBJINST: 12, /* SCR_DYN_OBJINST — class instances held by reference */
  ARRBUF: 13, /* SCR_DYN_ARRBUF — ArrayBuffer, payload shared by reference */
  BIG: 14, /* SCR_DYN_BIG — a bigint, the digits shared by reference and
            * compared BY VALUE (a primitive, unlike the four above) */
} as const;

/** What the dyn helpers need beyond the walker host: interned immortal
 * unit instances (undefined-armed dynCheck targets build them). */
export interface DynHost extends WalkerHost {
  unitInstanceRef(unionId: string, tag: number): string;
  /** `@`-ref of the interned SCR_DYN_OBJINST descriptor for a class. */
  dynClassDesc(className: string): string;
  /** The class's preorder interval and hierarchy membership — the same
   * numbers `instanceof` compares against. */
  classInterval(className: string): { pre: number; post: number };
}

/** Exact double literal (the emitter's f64Lit — the walkers' copy). */
function f64Lit(n: number): string {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setFloat64(0, n);
  return `0x${[...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

const FN_ATTRS = "#0";

/** i64 spelling of (SIZE_MAX - 9) / 10 — the canonical-index overflow
 * guard the C helpers compare against. */
const IDX_MAX_DIV10 = "1844674407370955160";

export class LlDyn {
  private readonly dynMatchers = new Map<string, string>();
  private readonly dynBuilders = new Map<string, string>();
  private readonly toDynFns = new Map<string, string>();
  private readonly dynFuncThunks = new Map<string, string>();
  private readonly dynFuncBoxes = new Map<string, string>();
  private readonly strandedDynFuncBoxes = new Map<string, string>();
  private readonly dynFuncAdapters = new Map<string, string>();
  private readonly promiseDynAdapters = new Map<string, string>();
  private dynToStrFn: string | null = null;
  private caughtToDynFn: string | null = null;
  /** Emitted function definitions, in interning order. */
  readonly defs: string[] = [];

  constructor(private readonly host: DynHost) {}

  /** The value LLVM type of a dynCheck result / toDyn operand for `t`. */
  private valTy(t: IrType): string {
    return t.kind === "f64" ? "double" : t.kind === "bool" ? "i1" : "ptr";
  }

  /* ── dyn node plumbing ─────────────────────────────────────────────── */

  /** Loads a dyn node's kind tag (i32 at +8). */
  private kindOf(B: BlockBuilder, d: string): string {
    const p = B.tmp();
    const k = B.tmp();
    B.line(`${p} = getelementptr inbounds i8, ptr ${d}, i64 8 ; ->kind`);
    B.line(`${k} = load i32, ptr ${p}`);
    return k;
  }

  /** Loads the 8-byte payload slot at +16 as the given LLVM type. */
  private payloadOf(B: BlockBuilder, d: string, ty: "double" | "ptr" | "i64"): string {
    const p = B.tmp();
    const v = B.tmp();
    B.line(`${p} = getelementptr inbounds i8, ptr ${d}, i64 16 ; ->v`);
    B.line(`${v} = load ${ty}, ptr ${p}`);
    return v;
  }

  /** Loads v.b (i8 at +16) as i1. */
  private boolOf(B: BlockBuilder, d: string): string {
    const p = B.tmp();
    const raw = B.tmp();
    const b = B.tmp();
    B.line(`${p} = getelementptr inbounds i8, ptr ${d}, i64 16 ; ->v.b`);
    B.line(`${raw} = load i8, ptr ${p}`);
    B.line(`${b} = trunc i8 ${raw} to i1`);
    return b;
  }

  /** Loads v.arr/v.obj length (i64 at +16). */
  private lenOf(B: BlockBuilder, d: string): string {
    const p = B.tmp();
    const n = B.tmp();
    B.line(`${p} = getelementptr inbounds i8, ptr ${d}, i64 16 ; ->v.arr.len`);
    B.line(`${n} = load i64, ptr ${p}`);
    return n;
  }

  /** Loads v.arr.items / v.obj.entries (ptr at +32). */
  private itemsOf(B: BlockBuilder, d: string): string {
    const p = B.tmp();
    const it = B.tmp();
    B.line(`${p} = getelementptr inbounds i8, ptr ${d}, i64 32 ; ->v.arr.items`);
    B.line(`${it} = load ptr, ptr ${p}`);
    return it;
  }

  /** Loads items[i] (borrowed ScrDyn *). */
  private itemAt(B: BlockBuilder, items: string, i: string): string {
    const p = B.tmp();
    const e = B.tmp();
    B.line(`${p} = getelementptr inbounds ptr, ptr ${items}, i64 ${i}`);
    B.line(`${e} = load ptr, ptr ${p}`);
    return e;
  }

  /** Object entry field addresses: entries + i*24 (+0 key, +8 key_len,
   * +16 value). */
  private entryAt(B: BlockBuilder, entries: string, i: string): { key: string; keyLen: string; value: string } {
    const off = B.tmp();
    const base = B.tmp();
    B.line(`${off} = mul i64 ${i}, 24 ; sizeof(ScrDynEntry)`);
    B.line(`${base} = getelementptr inbounds i8, ptr ${entries}, i64 ${off}`);
    const key = B.tmp();
    B.line(`${key} = load ptr, ptr ${base}`);
    const klp = B.tmp();
    const keyLen = B.tmp();
    B.line(`${klp} = getelementptr inbounds i8, ptr ${base}, i64 8`);
    B.line(`${keyLen} = load i64, ptr ${klp}`);
    const vp = B.tmp();
    const value = B.tmp();
    B.line(`${vp} = getelementptr inbounds i8, ptr ${base}, i64 16`);
    B.line(`${value} = load ptr, ptr ${vp}`);
    return { key, keyLen, value };
  }

  /** An ScrStr's (len, data) pair — len via the %ScrStr header, data the
   * flexible tail at +24. */
  private strParts(B: BlockBuilder, s: string): { len: string; data: string } {
    const lp = B.tmp();
    const len = B.tmp();
    const data = B.tmp();
    B.line(`${lp} = getelementptr inbounds %ScrStr, ptr ${s}, i64 0, i32 1`);
    B.line(`${len} = load i64, ptr ${lp}`);
    B.line(`${data} = getelementptr inbounds i8, ptr ${s}, i64 24 ; ->data`);
    return { len, data };
  }

  /** `call ptr @scr_dyn_retain_v(x)` (+1; immortals skip). */
  private retainDyn(B: BlockBuilder, x: string): string {
    this.host.declare(`declare ptr @scr_dyn_retain_v(ptr)`);
    const t = B.tmp();
    B.line(`${t} = call ptr @scr_dyn_retain_v(ptr ${x})`);
    return t;
  }

  /** THE immortal undefined dyn value (borrowed — retain to own). */
  private undef(B: BlockBuilder): string {
    this.host.declare(`declare ptr @scr_dyn_undefined()`);
    const t = B.tmp();
    B.line(`${t} = call ptr @scr_dyn_undefined()`);
    return t;
  }

  /** scr_dyn_obj_get with a compile-time key: borrowed member or null. */
  private objGetLit(B: BlockBuilder, d: string, key: string): string {
    this.host.declare(`declare ptr @scr_dyn_obj_get(ptr, ptr, i64)`);
    const t = B.tmp();
    const len = Buffer.byteLength(key, "utf8");
    B.line(`${t} = call ptr @scr_dyn_obj_get(ptr ${d}, ptr ${this.host.cstr(key)}, i64 ${len}) ; .${key}`);
    return t;
  }

  /** The record walkers' member read: JS's [[Get]] minus accessors — own
   * data, else the prototype chain. The C backend's walkers call the same
   * runtime symbol, so the two lanes cannot disagree about where a member
   * lives — the split that scr_dyn_obj_key_get already prevents for the
   * keyed read. objGetLit stays, for the own-only readers. */
  private dataGetLit(B: BlockBuilder, d: string, key: string): string {
    this.host.declare(`declare ptr @scr_dyn_obj_data_get(ptr, ptr, i64)`);
    const t = B.tmp();
    const len = Buffer.byteLength(key, "utf8");
    B.line(`${t} = call ptr @scr_dyn_obj_data_get(ptr ${d}, ptr ${this.host.cstr(key)}, i64 ${len}) ; .${key}`);
    return t;
  }

  /** The record BUILDER's read for a field that can hold a function:
   * the same walk, +1, an INHERITED callable bound to the receiver. */
  private memberGetLit(B: BlockBuilder, d: string, key: string): string {
    this.host.declare(`declare ptr @scr_dyn_obj_member_get(ptr, ptr, i64)`);
    const t = B.tmp();
    const len = Buffer.byteLength(key, "utf8");
    B.line(`${t} = call ptr @scr_dyn_obj_member_get(ptr ${d}, ptr ${this.host.cstr(key)}, i64 ${len}) ; .${key}`);
    return t;
  }

  /** Can a record FIELD of this type end up holding a callable? Only such
   * a field takes the binding (+1) read; see emit-walkers.ts. */
  private mayHoldFunc(t: IrType): boolean {
    if (t.kind === "func") return true;
    if (t.kind === "union") {
      const def = this.host.unionsById.get(t.unionId);
      return def ? def.arms.some((a) => a.kind === "func") : false;
    }
    return false;
  }

  /** Appends an ScrStr's bytes into a ScrJsonBuf (walkers' putScrStr). */
  private putScrStr(B: BlockBuilder, buf: string, s: string): void {
    this.host.declare(`declare void @scr_jb_putc(ptr, i8)`);
    const { len, data } = this.strParts(B, s);
    const jSlot = B.slot();
    B.entryAllocas.push(`${jSlot} = alloca i64`);
    B.line(`store i64 0, ptr ${jSlot}`);
    const lc = B.newLabel("dps.c");
    const lb = B.newLabel("dps.b");
    const le = B.newLabel("dps.e");
    B.br(lc);
    B.startBlock(lc);
    const j = B.tmp();
    const cont = B.tmp();
    B.line(`${j} = load i64, ptr ${jSlot}`);
    B.line(`${cont} = icmp ult i64 ${j}, ${len}`);
    B.condBr(cont, lb, le);
    B.startBlock(lb);
    const cp = B.tmp();
    const c = B.tmp();
    B.line(`${cp} = getelementptr inbounds i8, ptr ${data}, i64 ${j}`);
    B.line(`${c} = load i8, ptr ${cp}`);
    B.line(`call void @scr_jb_putc(ptr ${buf}, i8 ${c})`);
    const j2 = B.tmp();
    B.line(`${j2} = add i64 ${j}, 1`);
    B.line(`store i64 ${j2}, ptr ${jSlot}`);
    B.br(lc);
    B.startBlock(le);
  }

  private puts(B: BlockBuilder, buf: string, text: string): void {
    this.host.declare(`declare void @scr_jb_puts(ptr, ptr)`);
    B.line(`call void @scr_jb_puts(ptr ${buf}, ptr ${this.host.cstr(text)}) ; ${JSON.stringify(text)}`);
  }

  /** An i64 counting loop: emits header/body, calls `body(i)`, closes.
   * The body must not terminate its final block. */
  private i64Loop(B: BlockBuilder, hint: string, limit: string, body: (i: string, brNext: () => void, next: string) => void): void {
    const iSlot = B.slot();
    B.entryAllocas.push(`${iSlot} = alloca i64`);
    B.line(`store i64 0, ptr ${iSlot}`);
    const lc = B.newLabel(`${hint}.c`);
    const lb = B.newLabel(`${hint}.b`);
    const ln = B.newLabel(`${hint}.n`);
    const le = B.newLabel(`${hint}.e`);
    B.br(lc);
    B.startBlock(lc);
    const i = B.tmp();
    const cont = B.tmp();
    B.line(`${i} = load i64, ptr ${iSlot}`);
    B.line(`${cont} = icmp ult i64 ${i}, ${limit}`);
    B.condBr(cont, lb, le);
    B.startBlock(lb);
    body(i, () => B.br(ln), ln);
    B.br(ln);
    B.startBlock(ln);
    const i2 = B.tmp();
    B.line(`${i2} = add i64 ${i}, 1`);
    B.line(`store i64 ${i2}, ptr ${iSlot}`);
    B.br(lc);
    B.startBlock(le);
  }

  /** Emit the standard in-helper pending check: on a pending exception
   * run `cleanup` and return `dummy`. */
  private pendingBail(B: BlockBuilder, hint: string, cleanup: () => void, dummy: string): void {
    this.host.declare(`declare zeroext i1 @scr_exc_pending()`);
    const p = B.tmp();
    B.line(`${p} = call zeroext i1 @scr_exc_pending()`);
    const lu = B.newLabel(`${hint}.u`);
    const lk = B.newLabel(`${hint}.k`);
    B.condBr(p, lu, lk);
    B.startBlock(lu);
    cleanup();
    B.terminate(`ret ${dummy}`);
    B.startBlock(lk);
  }

  /* ── dynDesc (ported verbatim — pure strings) ──────────────────────── */

  /** Short human description of a dynCheck target for error messages. */
  dynDesc(t: IrType): string {
    switch (t.kind) {
      case "f64":
        return "number";
      case "string":
        return "string";
      case "bool":
        return "boolean";
      case "record":
        return this.host.recordsById.get(t.shapeId)?.tuple ? "array" : "object";
      case "array":
        return "array";
      case "nullT":
        return "null";
      case "undefinedT":
        return "undefined";
      case "dyn":
        return "unknown";
      case "bytes":
        return "Uint8Array";
      case "bigint":
        return "bigint";
      case "object":
        return t.className.replace(/^%/, "");
      case "union": {
        const def = this.host.unionsById.get(t.unionId);
        if (!def) throw new Error(`llvm emitter bug: dynDesc of unknown union ${t.unionId}`);
        return def.arms.map((a) => this.dynDesc(a)).join(" | ");
      }
      case "func":
        return "function";
      default: {
        const h = DYN_HANDLE_KINDS.get(t.kind);
        if (h) return h.cls;
        throw new Error(`llvm emitter bug: dynDesc of non-JSON type ${t.kind}`);
      }
    }
  }

  /* ── dynMatchHelper (emit-walkers.ts, ported) ──────────────────────── */

  /** `sc_dm_<n>(ptr d) -> i1` — does this dyn fit T? Never throws. */
  dynMatchHelper(t: IrType): string {
    const key = typeKey(t);
    const existing = this.dynMatchers.get(key);
    if (existing) return existing;
    const name = `sc_dm_${this.dynMatchers.size}`;
    this.dynMatchers.set(key, name);
    const B = new BlockBuilder();
    const kindIs = (k: number): void => {
      const kd = this.kindOf(B, "%d");
      const r = B.tmp();
      B.line(`${r} = icmp eq i32 ${kd}, ${k}`);
      B.terminate(`ret i1 ${r}`);
    };
    switch (t.kind) {
      case "f64":
        kindIs(DK.NUM);
        break;
      case "string":
        kindIs(DK.STR);
        break;
      case "bool":
        kindIs(DK.BOOL);
        break;
      case "nullT":
        kindIs(DK.NULL);
        break;
      case "undefinedT":
        kindIs(DK.UNDEF);
        break;
      case "dyn":
        // An `unknown` target: every dyn value fits, undefined included.
        B.terminate(`ret i1 true`);
        break;
      case "bigint":
        // A KIND test — bigint is its own kind, so nothing else wears
        // the tag. The C twin's note has the argument.
        kindIs(DK.BIG);
        break;
      case "bytes": {
        // A KIND test, sound because `u8` and `buf` are two kinds — the
        // C twin's note has the argument.
        const bk = DYN_BYTES_KINDS.get(t.elem);
        if (!bk) throw new Error(`llvm emitter bug: dynMatch of bytes<${t.elem}>`);
        kindIs(DK[bk.dk]);
        break;
      }
      case "record": {
        const shape = this.host.recordsById.get(t.shapeId);
        if (!shape) throw new Error(`llvm emitter bug: dynCheck of unknown shape ${t.shapeId}`);
        const fail = B.newLabel("dm.f");
        const kd = this.kindOf(B, "%d");
        // A tuple matches a JSON ARRAY of EXACTLY its arity, positionally.
        if (shape.tuple) {
          const byIndex = [...shape.fields].sort((a, b) => Number(a.name) - Number(b.name));
          const isArr = B.tmp();
          B.line(`${isArr} = icmp eq i32 ${kd}, ${DK.ARR}`);
          const l1 = B.newLabel("dm.a");
          B.condBr(isArr, l1, fail);
          B.startBlock(l1);
          const len = this.lenOf(B, "%d");
          const lenOk = B.tmp();
          B.line(`${lenOk} = icmp eq i64 ${len}, ${byIndex.length}`);
          const l2 = B.newLabel("dm.l");
          B.condBr(lenOk, l2, fail);
          B.startBlock(l2);
          const items = this.itemsOf(B, "%d");
          for (const [i, f] of byIndex.entries()) {
            const e = this.itemAt(B, items, `${i}`);
            const m = B.tmp();
            B.line(`${m} = call zeroext i1 @${this.dynMatchHelper(f.type)}(ptr ${e})`);
            const ln = B.newLabel("dm.i");
            B.condBr(m, ln, fail);
            B.startBlock(ln);
          }
          B.terminate(`ret i1 true`);
          B.startBlock(fail);
          B.terminate(`ret i1 false`);
          break;
        }
        const isObj = B.tmp();
        B.line(`${isObj} = icmp eq i32 ${kd}, ${DK.OBJ}`);
        const l0 = B.newLabel("dm.o");
        B.condBr(isObj, l0, fail);
        B.startBlock(l0);
        // dyn ('unknown') fields match ANY value, present or missing.
        for (const f of shape.fields) {
          if (f.type.kind === "dyn") continue;
          const m = this.dataGetLit(B, "%d", f.name);
          const has = B.tmp();
          B.line(`${has} = icmp ne ptr ${m}, null`);
          const lTest = B.newLabel("dm.t");
          const lNext = B.newLabel("dm.n");
          if (this.host.undefinedArmTag(f.type) >= 0) {
            // Optional-flavored field: a MISSING key is the undefined arm
            // (a match); a PRESENT key must fit the union as usual.
            B.condBr(has, lTest, lNext);
          } else {
            B.condBr(has, lTest, fail);
          }
          B.startBlock(lTest);
          const ok = B.tmp();
          B.line(`${ok} = call zeroext i1 @${this.dynMatchHelper(f.type)}(ptr ${m})`);
          B.condBr(ok, lNext, fail);
          B.startBlock(lNext);
        }
        // Index-signature shapes: UNDECLARED keys must fit the overflow
        // value type. A dyn value type accepts anything.
        if (shape.indexValue && shape.indexValue.kind !== "dyn") {
          this.host.declare(`declare i32 @memcmp(ptr, ptr, i64)`);
          const n = this.lenOf(B, "%d");
          const entries = this.itemsOf(B, "%d");
          this.i64Loop(B, "dm.ov", n, (i, brNext) => {
            const ent = this.entryAt(B, entries, i);
            // Skip declared keys.
            for (const f of shape.fields) {
              const klen = Buffer.byteLength(f.name, "utf8");
              const lenEq = B.tmp();
              B.line(`${lenEq} = icmp eq i64 ${ent.keyLen}, ${klen}`);
              const lCmp = B.newLabel("dm.kc");
              const lNo = B.newLabel("dm.kn");
              B.condBr(lenEq, lCmp, lNo);
              B.startBlock(lCmp);
              const c = B.tmp();
              const same = B.tmp();
              B.line(`${c} = call i32 @memcmp(ptr ${ent.key}, ptr ${this.host.cstr(f.name)}, i64 ${klen}) ; ${f.name}`);
              B.line(`${same} = icmp eq i32 ${c}, 0`);
              const lNo2 = B.newLabel("dm.kn");
              const skip = B.newLabel("dm.ks");
              B.condBr(same, skip, lNo2);
              B.startBlock(skip);
              brNext();
              B.startBlock(lNo2);
              B.br(lNo);
              B.startBlock(lNo);
            }
            const ok = B.tmp();
            B.line(`${ok} = call zeroext i1 @${this.dynMatchHelper(shape.indexValue!)}(ptr ${ent.value})`);
            const lOk = B.newLabel("dm.vo");
            B.condBr(ok, lOk, fail);
            B.startBlock(lOk);
          });
        }
        B.terminate(`ret i1 true`);
        B.startBlock(fail);
        B.terminate(`ret i1 false`);
        break;
      }
      case "array": {
        const m = this.dynMatchHelper(t.elem);
        const fail = B.newLabel("dm.f");
        const kd = this.kindOf(B, "%d");
        const isArr = B.tmp();
        B.line(`${isArr} = icmp eq i32 ${kd}, ${DK.ARR}`);
        const l0 = B.newLabel("dm.a");
        B.condBr(isArr, l0, fail);
        B.startBlock(l0);
        const n = this.lenOf(B, "%d");
        const items = this.itemsOf(B, "%d");
        this.i64Loop(B, "dm.el", n, (i) => {
          const e = this.itemAt(B, items, i);
          const ok = B.tmp();
          B.line(`${ok} = call zeroext i1 @${m}(ptr ${e})`);
          const lOk = B.newLabel("dm.eo");
          B.condBr(ok, lOk, fail);
          B.startBlock(lOk);
        });
        B.terminate(`ret i1 true`);
        B.startBlock(fail);
        B.terminate(`ret i1 false`);
        break;
      }
      case "union": {
        const def = this.host.unionsById.get(t.unionId);
        if (!def) throw new Error(`llvm emitter bug: dynCheck of unknown union ${t.unionId}`);
        // Arms in canonical order; any full match answers true.
        const yes = B.newLabel("dm.y");
        for (const arm of def.arms) {
          const ok = B.tmp();
          B.line(`${ok} = call zeroext i1 @${this.dynMatchHelper(arm)}(ptr %d)`);
          const ln = B.newLabel("dm.n");
          B.condBr(ok, yes, ln);
          B.startBlock(ln);
        }
        B.terminate(`ret i1 false`);
        B.startBlock(yes);
        B.terminate(`ret i1 true`);
        break;
      }
      case "func": {
        // The FUNCTION leaf: the dyn function box carries the interned
        // typeKey it was boxed FROM, so the exact signature IS the match
        // test (emit-walkers.ts's func case, ported — the reasoning for
        // being narrower than the builder lives there).
        const fail = B.newLabel("dm.f");
        const kd = this.kindOf(B, "%d");
        const isFn = B.tmp();
        B.line(`${isFn} = icmp eq i32 ${kd}, ${DK.FUNC}`);
        const l0 = B.newLabel("dm.fn");
        B.condBr(isFn, l0, fail);
        B.startBlock(l0);
        this.host.declare(`declare i32 @strcmp(ptr, ptr)`);
        const sigp = B.tmp();
        const sig = B.tmp();
        const cmp = B.tmp();
        const same = B.tmp();
        B.line(`${sigp} = getelementptr inbounds i8, ptr %d, i64 32 ; ->v.fn.sig`);
        B.line(`${sig} = load ptr, ptr ${sigp}`);
        B.line(`${cmp} = call i32 @strcmp(ptr ${sig}, ptr ${this.host.cstr(key)})`);
        B.line(`${same} = icmp eq i32 ${cmp}, 0`);
        B.terminate(`ret i1 ${same}`);
        B.startBlock(fail);
        B.terminate(`ret i1 false`);
        break;
      }
      case "object": {
        // "Is this dyn an instance of C?" — the same preorder-interval
        // test `x instanceof C` compiles to, run inside the runtime helper
        // so both lanes ask it exactly once. The C walker's arm.
        this.host.declare(`declare zeroext i1 @scr_dyn_objinst_is(ptr, i64, i64)`);
        this.host.dynClassDesc(t.className); // interned even when only matched
        const iv = this.host.classInterval(t.className);
        const r = B.tmp();
        B.line(`${r} = call zeroext i1 @scr_dyn_objinst_is(ptr %d, i64 ${iv.pre}, i64 ${iv.post})`);
        B.terminate(`ret i1 ${r}`);
        break;
      }
      default:
        throw new LlvmUnsupportedError(`dynMatch:${t.kind}`);
    }
    this.defs.push(
      `define internal zeroext i1 @${name}(ptr %d) ${FN_ATTRS} { ; matches ${key}`,
      B.render(),
      `}`,
      ``,
    );
    return name;
  }

  /* ── dynCheckHelper (emit-walkers.ts, ported) ──────────────────────── */

  /** `sc_dc_<n>(ptr d, ptr path) -> T` — validate the checked-dynamic tree against T and
   * BUILD the typed value (+1), or throw the catchable path-annotated
   * TypeError and return a dummy with the pending flag set. */
  dynCheckHelper(t: IrType): string {
    const key = typeKey(t);
    const existing = this.dynBuilders.get(key);
    if (existing) return existing;
    const name = `sc_dc_${this.dynBuilders.size}`;
    this.dynBuilders.set(key, name);
    const host = this.host;
    const retTy = this.valTy(t);
    const dummy = retTy === "double" ? `double ${f64Lit(0)}` : retTy === "i1" ? "i1 false" : "ptr null";
    host.declare(`declare void @scr_dyn_check_fail(ptr, ptr, ptr)`);
    const want = host.cstr(this.dynDesc(t));
    const B = new BlockBuilder();
    /** kind test with the standard fail path (got = %d). */
    const requireKind = (k: number, hint: string): void => {
      const kd = this.kindOf(B, "%d");
      const ok = B.tmp();
      B.line(`${ok} = icmp eq i32 ${kd}, ${k}`);
      const lo = B.newLabel(`${hint}.k`);
      const lf = B.newLabel(`${hint}.f`);
      B.condBr(ok, lo, lf);
      B.startBlock(lf);
      B.line(`call void @scr_dyn_check_fail(ptr %path, ptr ${want}, ptr %d)`);
      B.terminate(`ret ${dummy}`);
      B.startBlock(lo);
    };
    switch (t.kind) {
      case "f64": {
        requireKind(DK.NUM, "dc");
        const v = this.payloadOf(B, "%d", "double");
        B.terminate(`ret double ${v}`);
        break;
      }
      case "bool": {
        requireKind(DK.BOOL, "dc");
        const v = this.boolOf(B, "%d");
        B.terminate(`ret i1 ${v}`);
        break;
      }
      case "string": {
        requireKind(DK.STR, "dc");
        host.declare(`declare ptr @scr_str_retain_v(ptr)`);
        const s = this.payloadOf(B, "%d", "ptr");
        const r = B.tmp();
        B.line(`${r} = call ptr @scr_str_retain_v(ptr ${s})`);
        B.terminate(`ret ptr ${r}`);
        break;
      }
      case "dyn": {
        // An `unknown` slot: the checked-dynamic tree subtree passes through as-is.
        const r = this.retainDyn(B, "%d");
        B.terminate(`ret ptr ${r}`);
        break;
      }
      case "bigint": {
        // `u as bigint`: the SAME digits back, retained. The runtime does
        // the kind check and the throw, so there is no requireKind here —
        // the ARRBUF arm's shape, and the C twin's note has the reason a
        // bigint shares rather than copies.
        host.declare(`declare ptr @scr_dyn_big_unbox(ptr, ptr, ptr)`);
        const r = B.tmp();
        B.line(`${r} = call ptr @scr_dyn_big_unbox(ptr %d, ptr %path, ptr ${want})`);
        B.terminate(`ret ptr ${r}`);
        break;
      }
      case "bytes": {
        const bk = DYN_BYTES_KINDS.get(t.elem);
        if (!bk) throw new Error(`llvm emitter bug: dynCheck of bytes<${t.elem}>`);
        if (bk.dk === "ARRBUF") {
          // `u as ArrayBuffer`: the SAME payload back, retained. The
          // runtime does the kind check and the throw, so there is no
          // requireKind here — see the C twin.
          host.declare(`declare ptr @scr_dyn_arrbuf_unbox(ptr, ptr, ptr)`);
          const r = B.tmp();
          B.line(`${r} = call ptr @scr_dyn_arrbuf_unbox(ptr %d, ptr %path, ptr ${want})`);
          B.terminate(`ret ptr ${r}`);
          break;
        }
        // `u as Uint8Array`: kind check, then a fresh COPY out.
        requireKind(DK.BYTES, "dc");
        host.declare(`declare ptr @scr_dyn_bytes_copy_out(ptr)`);
        const r = B.tmp();
        B.line(`${r} = call ptr @scr_dyn_bytes_copy_out(ptr %d)`);
        B.terminate(`ret ptr ${r}`);
        break;
      }
      case "object": {
        // The %Error extraction (an instanceof-Error narrow on unknown):
        // validate the checked-dynamic tree's error encoding — the reserved "%error" marker
        // caughtToDyn builds — and extract through the runtime's IDENTITY
        // CACHE (scr_error_from_dyn): a dyn error that came from a runtime
        // ScrError answers that very instance, so out-and-back crossings
        // compare reference-equal (the tracing suite's shape); alien
        // %error objects rebuild once and cache the pair. The C walker's
        // arm exactly.
        if (t.className !== "%Error") {
          // The interval-checked REFERENCE unwrap: the same pointer back
          // (+1), so identity survives the round trip. The C walker's arm.
          host.declare(`declare ptr @scr_dyn_objinst_unbox(ptr, i64, i64, ptr, ptr)`);
          host.dynClassDesc(t.className); // interned even when only narrowed to
          const iv = host.classInterval(t.className);
          const r = B.tmp();
          B.line(
            `${r} = call ptr @scr_dyn_objinst_unbox(ptr %d, i64 ${iv.pre}, i64 ${iv.post}, ` +
              `ptr %path, ptr ${want})`,
          );
          B.terminate(`ret ptr ${r}`);
          break;
        }
        const kd = this.kindOf(B, "%d");
        const isObj = B.tmp();
        B.line(`${isObj} = icmp eq i32 ${kd}, ${DK.OBJ}`);
        const lObj = B.newLabel("dce.o");
        const lFail = B.newLabel("dce.f");
        B.condBr(isObj, lObj, lFail);
        B.startBlock(lObj);
        const marker = this.objGetLit(B, "%d", "%error");
        const hasMarker = B.tmp();
        B.line(`${hasMarker} = icmp ne ptr ${marker}, null`);
        const lGo = B.newLabel("dce.g");
        B.condBr(hasMarker, lGo, lFail);
        B.startBlock(lFail);
        B.line(`call void @scr_dyn_check_fail(ptr %path, ptr ${want}, ptr %d)`);
        B.terminate(`ret ptr null`);
        B.startBlock(lGo);
        host.declare(`declare ptr @scr_error_from_dyn(ptr)`);
        const e = B.tmp();
        B.line(`${e} = call ptr @scr_error_from_dyn(ptr %d)`);
        B.terminate(`ret ptr ${e}`);
        break;
      }
      case "record": {
        const shape = host.recordsById.get(t.shapeId);
        if (!shape) throw new Error(`llvm emitter bug: dynCheck of unknown shape ${t.shapeId}`);
        const struct = mangleRecordStruct(t.shapeId);
        const fieldIndex = new Map(shape.fields.map((f, i) => [f.name, i + 1]));
        const releaseR = (): void => {
          B.line(`call void ${releaseSym(host, t)}(ptr %r0)`);
        };
        // One shared path node, restored per use (lives only during the
        // nested call).
        const pathSlot = "%dcp";
        B.entryAllocas.push(`${pathSlot} = alloca %ScrDynPath`);
        const setPath = (keyText: string | null, index: string): void => {
          const pp = B.tmp();
          const kp = B.tmp();
          const ip = B.tmp();
          B.line(`${pp} = getelementptr inbounds %ScrDynPath, ptr ${pathSlot}, i64 0, i32 0`);
          B.line(`store ptr %path, ptr ${pp}`);
          B.line(`${kp} = getelementptr inbounds %ScrDynPath, ptr ${pathSlot}, i64 0, i32 1`);
          B.line(`store ptr ${keyText === null ? "null" : host.cstr(keyText)}, ptr ${kp}`);
          B.line(`${ip} = getelementptr inbounds %ScrDynPath, ptr ${pathSlot}, i64 0, i32 2`);
          B.line(`store i64 ${index}, ptr ${ip}`);
        };
        const setPathKeyPtr = (keyPtr: string): void => {
          const pp = B.tmp();
          const kp = B.tmp();
          const ip = B.tmp();
          B.line(`${pp} = getelementptr inbounds %ScrDynPath, ptr ${pathSlot}, i64 0, i32 0`);
          B.line(`store ptr %path, ptr ${pp}`);
          B.line(`${kp} = getelementptr inbounds %ScrDynPath, ptr ${pathSlot}, i64 0, i32 1`);
          B.line(`store ptr ${keyPtr}, ptr ${kp}`);
          B.line(`${ip} = getelementptr inbounds %ScrDynPath, ptr ${pathSlot}, i64 0, i32 2`);
          B.line(`store i64 0, ptr ${ip}`);
        };
        const storeInto = (fieldName: string, ft: IrType, value: string): void => {
          const idx = fieldIndex.get(fieldName)!;
          const p = B.tmp();
          B.line(`${p} = getelementptr inbounds %${struct}, ptr %r0, i64 0, i32 ${idx} ; .${fieldName}`);
          if (llFieldType(ft) === "i8") {
            const z = B.tmp();
            B.line(`${z} = zext i1 ${value} to i8`);
            B.line(`store i8 ${z}, ptr ${p}`);
          } else {
            B.line(`store ${llFieldType(ft)} ${value}, ptr ${p}`);
          }
        };
        // Tuple targets: a JSON ARRAY of exactly the arity.
        if (shape.tuple) {
          const byIndex = [...shape.fields].sort((a, b) => Number(a.name) - Number(b.name));
          const arityWant = host.cstr(`array of length ${byIndex.length}`);
          requireKind(DK.ARR, "dct");
          const len = this.lenOf(B, "%d");
          const lenOk = B.tmp();
          B.line(`${lenOk} = icmp eq i64 ${len}, ${byIndex.length}`);
          const lGo = B.newLabel("dct.g");
          const lAr = B.newLabel("dct.a");
          B.condBr(lenOk, lGo, lAr);
          B.startBlock(lAr);
          B.line(`call void @scr_dyn_check_fail(ptr %path, ptr ${arityWant}, ptr %d)`);
          B.terminate(`ret ptr null`);
          B.startBlock(lGo);
          B.line(`%r0 = call ptr @${mangleRecordNew(t.shapeId)}()`);
          const items = this.itemsOf(B, "%d");
          byIndex.forEach((f, i) => {
            setPath(null, `${i}`);
            const e = this.itemAt(B, items, `${i}`);
            const v = B.tmp();
            B.line(`${v} = call ${this.valTy(f.type)} @${this.dynCheckHelper(f.type)}(ptr ${e}, ptr ${pathSlot})`);
            storeInto(f.name, f.type, v);
            this.pendingBail(B, "dct", releaseR, "ptr null");
          });
          B.terminate(`ret ptr %r0`);
          break;
        }
        requireKind(DK.OBJ, "dcr");
        B.line(`%r0 = call ptr @${mangleRecordNew(t.shapeId)}()`);
        for (const f of shape.fields) {
          const fieldWant = host.cstr(this.dynDesc(f.type));
          const utag = f.type.kind === "union" ? host.undefinedArmTag(f.type) : -1;
          const bind = this.mayHoldFunc(f.type);
          const m = bind ? this.memberGetLit(B, "%d", f.name) : this.dataGetLit(B, "%d", f.name);
          // +1 in the binding case: released after the field is built and
          // BEFORE the pending check, exactly as the C lane orders it (the
          // absent arms never reach here — `m` is null there).
          const dropM = () => {
            if (!bind) return;
            host.declare(`declare void @scr_dyn_release(ptr)`);
            B.line(`call void @scr_dyn_release(ptr ${m})`);
          };
          if (f.type.kind === "dyn") {
            // An `unknown` field: a present key passes through, a missing
            // one IS the undefined dyn value.
            const has = B.tmp();
            B.line(`${has} = icmp ne ptr ${m}, null`);
            const sel = B.tmp();
            const u = this.undef(B);
            B.line(`${sel} = select i1 ${has}, ptr ${m}, ptr ${u}`);
            storeInto(f.name, f.type, this.retainDyn(B, sel));
          } else if (utag >= 0 && f.type.kind === "union") {
            const unit = host.unitInstanceRef(f.type.unionId, utag);
            const has = B.tmp();
            B.line(`${has} = icmp ne ptr ${m}, null`);
            const lp = B.newLabel("dcr.p");
            const la = B.newLabel("dcr.a");
            const lj = B.newLabel("dcr.j");
            B.condBr(has, lp, la);
            B.startBlock(la);
            storeInto(f.name, f.type, unit); // absent key -> the undefined arm
            B.br(lj);
            B.startBlock(lp);
            setPath(f.name, "0");
            const v = B.tmp();
            B.line(`${v} = call ptr @${this.dynCheckHelper(f.type)}(ptr ${m}, ptr ${pathSlot})`);
            storeInto(f.name, f.type, v);
            dropM();
            this.pendingBail(B, "dcr", releaseR, "ptr null");
            B.br(lj);
            B.startBlock(lj);
          } else {
            const has = B.tmp();
            B.line(`${has} = icmp ne ptr ${m}, null`);
            const lp = B.newLabel("dcr.p");
            const la = B.newLabel("dcr.a");
            B.condBr(has, lp, la);
            B.startBlock(la);
            setPath(f.name, "0");
            B.line(`call void @scr_dyn_check_fail(ptr ${pathSlot}, ptr ${fieldWant}, ptr null)`);
            releaseR();
            B.terminate(`ret ptr null`);
            B.startBlock(lp);
            setPath(f.name, "0");
            const v = B.tmp();
            B.line(`${v} = call ${this.valTy(f.type)} @${this.dynCheckHelper(f.type)}(ptr ${m}, ptr ${pathSlot})`);
            storeInto(f.name, f.type, v);
            dropM();
            this.pendingBail(B, "dcr", releaseR, "ptr null");
          }
        }
        // Index-signature shapes CAPTURE undeclared keys into the
        // overflow map.
        if (shape.indexValue) {
          const iv = shape.indexValue;
          host.declare(`declare i32 @memcmp(ptr, ptr, i64)`);
          host.declare(`declare ptr @scr_str_new(ptr, i64)`);
          host.declare(`declare void @scr_str_release(ptr)`);
          const ovfp = B.tmp();
          const ovf = B.tmp();
          B.line(`${ovfp} = getelementptr inbounds %${struct}, ptr %r0, i64 0, i32 ${shape.fields.length + 1}`);
          B.line(`${ovf} = load ptr, ptr ${ovfp} ; overflow map`);
          const n = this.lenOf(B, "%d");
          const entries = this.itemsOf(B, "%d");
          this.i64Loop(B, "dcv", n, (i, brNext) => {
            const ent = this.entryAt(B, entries, i);
            for (const f of shape.fields) {
              const klen = Buffer.byteLength(f.name, "utf8");
              const lenEq = B.tmp();
              B.line(`${lenEq} = icmp eq i64 ${ent.keyLen}, ${klen}`);
              const lCmp = B.newLabel("dcv.kc");
              const lNo = B.newLabel("dcv.kn");
              B.condBr(lenEq, lCmp, lNo);
              B.startBlock(lCmp);
              const c = B.tmp();
              const same = B.tmp();
              B.line(`${c} = call i32 @memcmp(ptr ${ent.key}, ptr ${host.cstr(f.name)}, i64 ${klen}) ; ${f.name}`);
              B.line(`${same} = icmp eq i32 ${c}, 0`);
              const skip = B.newLabel("dcv.ks");
              const lNo2 = B.newLabel("dcv.kn");
              B.condBr(same, skip, lNo2);
              B.startBlock(skip);
              brNext();
              B.startBlock(lNo2);
              B.br(lNo);
              B.startBlock(lNo);
            }
            let ev: string;
            if (iv.kind === "dyn") {
              ev = this.retainDyn(B, ent.value);
            } else {
              setPathKeyPtr(ent.key);
              ev = B.tmp();
              B.line(`${ev} = call ${this.valTy(iv)} @${this.dynCheckHelper(iv)}(ptr ${ent.value}, ptr ${pathSlot})`);
              this.pendingBail(B, "dcv", releaseR, "ptr null");
            }
            const ek = B.tmp();
            B.line(`${ek} = call ptr @scr_str_new(ptr ${ent.key}, i64 ${ent.keyLen})`);
            if (iv.kind === "f64") {
              host.declare(`declare void @scr_map_set_str_f64(ptr, ptr, double)`);
              B.line(`call void @scr_map_set_str_f64(ptr ${ovf}, ptr ${ek}, double ${ev})`);
            } else if (iv.kind === "bool") {
              host.declare(`declare void @scr_map_set_str_bool(ptr, ptr, i1 zeroext)`);
              B.line(`call void @scr_map_set_str_bool(ptr ${ovf}, ptr ${ek}, i1 ${ev})`);
            } else {
              host.declare(`declare void @scr_map_set_str_ref(ptr, ptr, ptr)`);
              B.line(`call void @scr_map_set_str_ref(ptr ${ovf}, ptr ${ek}, ptr ${ev}) ; v moves in`);
            }
            B.line(`call void @scr_str_release(ptr ${ek})`);
          });
        }
        B.terminate(`ret ptr %r0`);
        break;
      }
      case "array": {
        const elem = t.elem;
        const c = this.dynCheckHelper(elem);
        requireKind(DK.ARR, "dca");
        const n = this.lenOf(B, "%d");
        const a = B.tmp();
        B.line(`${a} = ${arrNewCall(host, elem, n)}`);
        const items = this.itemsOf(B, "%d");
        const pathSlot = "%dcp";
        B.entryAllocas.push(`${pathSlot} = alloca %ScrDynPath`);
        const acc = elemAccess(elem);
        const accTy = acc === "f64" ? "double" : acc === "bool" ? "i1" : "ptr";
        host.declare(
          `declare double @scr_arr_push_${acc}(ptr, ${acc === "bool" ? "i1 zeroext" : accTy})`,
        );
        this.i64Loop(B, "dca", n, (i) => {
          const pp = B.tmp();
          const kp = B.tmp();
          const ip = B.tmp();
          B.line(`${pp} = getelementptr inbounds %ScrDynPath, ptr ${pathSlot}, i64 0, i32 0`);
          B.line(`store ptr %path, ptr ${pp}`);
          B.line(`${kp} = getelementptr inbounds %ScrDynPath, ptr ${pathSlot}, i64 0, i32 1`);
          B.line(`store ptr null, ptr ${kp}`);
          B.line(`${ip} = getelementptr inbounds %ScrDynPath, ptr ${pathSlot}, i64 0, i32 2`);
          B.line(`store i64 ${i}, ptr ${ip}`);
          const e = this.itemAt(B, items, i);
          const v = B.tmp();
          B.line(`${v} = call ${this.valTy(elem)} @${c}(ptr ${e}, ptr ${pathSlot})`);
          this.pendingBail(B, "dca", () => {
            host.declare(`declare void @scr_arr_release(ptr)`);
            B.line(`call void @scr_arr_release(ptr ${a})`);
          }, "ptr null");
          const pushed = B.tmp();
          B.line(`${pushed} = call double @scr_arr_push_${acc}(ptr ${a}, ${accTy} ${v})`);
        });
        B.terminate(`ret ptr ${a}`);
        break;
      }
      case "union": {
        const def = host.unionsById.get(t.unionId);
        if (!def) throw new Error(`llvm emitter bug: dynCheck of unknown union ${t.unionId}`);
        // Arms in CANONICAL order, first FULL match wins. The matched
        // arm's builder can no longer fail.
        def.arms.forEach((arm, i) => {
          const m = this.dynMatchHelper(arm);
          const hit = B.tmp();
          B.line(`${hit} = call zeroext i1 @${m}(ptr %d)`);
          const lHit = B.newLabel("dcu.h");
          const lNext = B.newLabel("dcu.n");
          B.condBr(hit, lHit, lNext);
          B.startBlock(lHit);
          if (arm.kind === "undefinedT" || arm.kind === "nullT") {
            // A matched unit arm builds nothing: THE interned immortal
            // instance (rc == SIZE_MAX — no retain owed).
            B.terminate(`ret ptr ${host.unitInstanceRef(t.unionId, i)}`);
          } else if (arm.kind === "f64") {
            host.declare(`declare ptr @scr_union_new_f64(i32, double)`);
            const x = B.tmp();
            const u = B.tmp();
            B.line(`${x} = call double @${this.dynCheckHelper(arm)}(ptr %d, ptr %path)`);
            B.line(`${u} = call ptr @scr_union_new_f64(i32 ${i}, double ${x})`);
            B.terminate(`ret ptr ${u}`);
          } else if (arm.kind === "bool") {
            host.declare(`declare ptr @scr_union_new_bool(i32, i1 zeroext)`);
            const x = B.tmp();
            const u = B.tmp();
            B.line(`${x} = call zeroext i1 @${this.dynCheckHelper(arm)}(ptr %d, ptr %path)`);
            B.line(`${u} = call ptr @scr_union_new_bool(i32 ${i}, i1 ${x})`);
            B.terminate(`ret ptr ${u}`);
          } else {
            const rc = vAdapters(host, arm);
            host.declare(`declare ptr @scr_union_new_ref(i32, ptr, ptr, ptr, ptr)`);
            const x = B.tmp();
            const u = B.tmp();
            B.line(`${x} = call ptr @${this.dynCheckHelper(arm)}(ptr %d, ptr %path)`);
            B.line(
              `${u} = call ptr @scr_union_new_ref(i32 ${i}, ptr ${x}, ptr ${rc.retain}, ptr ${rc.release}, ptr ${traceArg(host, arm)})`,
            );
            B.terminate(`ret ptr ${u}`);
          }
          B.startBlock(lNext);
        });
        B.line(`call void @scr_dyn_check_fail(ptr %path, ptr ${want}, ptr %d)`);
        B.terminate(`ret ptr null`);
        break;
      }
      case "func": {
        // The checked-dynamic function boundary, OUT direction: an
        // IDENTICAL boxed signature unwraps the closure directly;
        // anything else wraps in the per-target adapter closure whose
        // caps[0] obj-box owns the dyn value (untraced). NON-adaptable
        // targets have no adapter: exact unwrap or the path-annotated
        // TypeError (the frontend's unwrap-only cast semantics).
        const sigLit = host.cstr(key);
        requireKind(DK.FUNC, "dcf");
        host.declare(`declare i32 @strcmp(ptr, ptr)`);
        const sigp = B.tmp();
        const sig = B.tmp();
        B.line(`${sigp} = getelementptr inbounds i8, ptr %d, i64 32 ; ->v.fn.sig`);
        B.line(`${sig} = load ptr, ptr ${sigp}`);
        const cmp = B.tmp();
        const same = B.tmp();
        B.line(`${cmp} = call i32 @strcmp(ptr ${sig}, ptr ${sigLit})`);
        B.line(`${same} = icmp eq i32 ${cmp}, 0`);
        const lSame = B.newLabel("dcf.s");
        const lWrap = B.newLabel("dcf.w");
        B.condBr(same, lSame, lWrap);
        B.startBlock(lSame);
        host.declare(`declare ptr @scr_closure_retain_v(ptr)`);
        const clop = B.tmp();
        const clo = B.tmp();
        const r = B.tmp();
        B.line(`${clop} = getelementptr inbounds i8, ptr %d, i64 16 ; ->v.fn.clo`);
        B.line(`${clo} = load ptr, ptr ${clop}`);
        B.line(`${r} = call ptr @scr_closure_retain_v(ptr ${clo})`);
        B.terminate(`ret ptr ${r}`);
        B.startBlock(lWrap);
        if (!canAdaptDynFuncTo(t, (id: string) => host.recordsById.get(id), (id: string) => host.unionsById.get(id))) {
          B.line(`call void @scr_dyn_check_fail(ptr %path, ptr ${want}, ptr %d)`);
          B.terminate(`ret ptr null`);
          break;
        }
        const adapter = this.dynFuncAdapterHelper(t);
        host.declare(`declare ptr @scr_closure_new(ptr, i64)`);
        host.declare(`declare ptr @scr_box_new_obj(ptr, ptr, ptr)`);
        host.declare(`declare void @scr_box_set_ref(ptr, ptr)`);
        host.declare(`declare ptr @scr_dyn_retain_v(ptr)`);
        host.declare(`declare void @scr_dyn_release_v(ptr)`);
        const a = B.tmp();
        B.line(`${a} = call ptr @scr_closure_new(ptr @${adapter}, i64 1)`);
        const box = B.tmp();
        B.line(`${box} = call ptr @scr_box_new_obj(ptr @scr_dyn_retain_v, ptr @scr_dyn_release_v, ptr null)`);
        const capp = B.tmp();
        // caps[0] is one WHOLE %ScrClosure past the base — never a byte
        // literal: the struct grew a field and every hardcoded 32 in this
        // backend became a write into it instead.
        B.line(`${capp} = getelementptr inbounds %ScrClosure, ptr ${a}, i64 1 ; caps[0]`);
        B.line(`store ptr ${box}, ptr ${capp}`);
        const rd = this.retainDyn(B, "%d");
        B.line(`call void @scr_box_set_ref(ptr ${box}, ptr ${rd})`);
        B.terminate(`ret ptr ${a}`);
        break;
      }
      default: {
        // Runtime HANDLE targets: a tag-checked reference unwrap (+1 —
        // identity, no copy; the runtime throws the path-annotated
        // TypeError on any other kind or tag).
        const h = DYN_HANDLE_KINDS.get(t.kind);
        if (h) {
          host.declare(`declare ptr @scr_dyn_handle_unbox(ptr, i32, ptr, ptr)`);
          const r = B.tmp();
          B.line(`${r} = call ptr @scr_dyn_handle_unbox(ptr %d, i32 ${dynHandleTagNum(t.kind)}, ptr %path, ptr ${want})`);
          B.terminate(`ret ptr ${r}`);
          break;
        }
        throw new LlvmUnsupportedError(`type:${t.kind}`);
      }
    }
    this.defs.push(
      `define internal ${retTy === "i1" ? "zeroext i1" : retTy} @${name}(ptr %d, ptr %path) ${FN_ATTRS} { ; check ${key}`,
      B.render(),
      `}`,
      ``,
    );
    return name;
  }

  /* ── toDynHelper (emit-walkers.ts, ported) ─────────────────────────── */

  /** `sc_td_<n>(<T> v) -> ptr` — build a fresh dyn value from a
   * static one (+1), DEEP-COPYING composites. Borrows the operand.
   * Never throws. */
  toDynHelper(t: IrType): string {
    const key = typeKey(t);
    const existing = this.toDynFns.get(key);
    if (existing) return existing;
    const name = `sc_td_${this.toDynFns.size}`;
    this.toDynFns.set(key, name);
    const host = this.host;
    const B = new BlockBuilder();
    switch (t.kind) {
      case "f64": {
        host.declare(`declare ptr @scr_dyn_new_num(double)`);
        const r = B.tmp();
        B.line(`${r} = call ptr @scr_dyn_new_num(double %v)`);
        B.terminate(`ret ptr ${r}`);
        break;
      }
      case "bool": {
        host.declare(`declare ptr @scr_dyn_new_bool(i1 zeroext)`);
        const r = B.tmp();
        B.line(`${r} = call ptr @scr_dyn_new_bool(i1 %v)`);
        B.terminate(`ret ptr ${r}`);
        break;
      }
      case "string": {
        host.declare(`declare ptr @scr_dyn_new_str(ptr)`);
        const r = B.tmp();
        B.line(`${r} = call ptr @scr_dyn_new_str(ptr %v) ; retains v`);
        B.terminate(`ret ptr ${r}`);
        break;
      }
      case "object": {
        // %Error keeps the checked-dynamic tree's ERROR ENCODING; every
        // other class boxes BY REFERENCE through its emitted descriptor —
        // the C walker's arm exactly.
        if (t.className !== "%Error") {
          host.declare(`declare ptr @scr_dyn_new_objinst(ptr, ptr)`);
          const desc = host.dynClassDesc(t.className);
          const r = B.tmp();
          B.line(`${r} = call ptr @scr_dyn_new_objinst(ptr %v, ptr ${desc})`);
          B.terminate(`ret ptr ${r}`);
          break;
        }
        host.declare(`declare ptr @scr_dyn_from_error(ptr)`);
        const r = B.tmp();
        B.line(`${r} = call ptr @scr_dyn_from_error(ptr %v)`);
        B.terminate(`ret ptr ${r}`);
        break;
      }
      case "dyn": {
        const r = this.retainDyn(B, "%v");
        B.terminate(`ret ptr ${r}`);
        break;
      }
      case "bigint": {
        // The digits, retained into the box. The constructor is the
        // GATED unit's — it installs the ops table the always-linked dyn
        // core dispatches through — and a program reaching this line
        // necessarily links that unit. The C twin's arm.
        host.declare(`declare ptr @scr_dyn_from_big(ptr)`);
        const r = B.tmp();
        B.line(`${r} = call ptr @scr_dyn_from_big(ptr %v)`);
        B.terminate(`ret ptr ${r}`);
        break;
      }
      case "bytes": {
        // Shared by REFERENCE, not copied — see the C emitter's twin: a
        // typed array's static and dyn representations are the same
        // refcounted ScrBytes, so the boundary aliases like Node.
        // bytes<buf> (ArrayBuffer) shares the payload the same way and
        // lands in its OWN kind — the C twin's note has the argument.
        {
          const bk = DYN_BYTES_KINDS.get(t.elem);
          if (!bk) throw new Error(`llvm emitter bug: to-dyn of bytes<${t.elem}>`);
          const fn = bk.dk === "ARRBUF" ? "scr_dyn_new_arrbuf_ref" : "scr_dyn_new_bytes_ref";
          host.declare(`declare ptr @${fn}(ptr)`);
          const r = B.tmp();
          B.line(`${r} = call ptr @${fn}(ptr %v)`);
          B.terminate(`ret ptr ${r}`);
        }
        break;
      }
      case "record": {
        const shape = host.recordsById.get(t.shapeId);
        if (!shape) throw new Error(`llvm emitter bug: to-dyn of unknown shape ${t.shapeId}`);
        const struct = mangleRecordStruct(t.shapeId);
        const fieldIndex = new Map(shape.fields.map((f, i) => [f.name, i + 1]));
        const loadFieldOf = (fname: string, ft: IrType): string => {
          const p = B.tmp();
          B.line(`${p} = getelementptr inbounds %${struct}, ptr %v, i64 0, i32 ${fieldIndex.get(fname)!} ; .${fname}`);
          const raw = B.tmp();
          B.line(`${raw} = load ${llFieldType(ft)}, ptr ${p}`);
          if (llFieldType(ft) !== "i8") return raw;
          const b = B.tmp();
          B.line(`${b} = trunc i8 ${raw} to i1`);
          return b;
        };
        host.declare(`declare void @scr_dyn_obj_set(ptr, ptr, i64, ptr)`);
        // CYCLE-CAPABLE shapes guard the deep copy: enter TRAPS on a value
        // already being converted (a cyclic value has no finite dyn copy —
        // SEMANTICS.md; the C emitter's contract exactly).
        const cyclicRec = traceAdapter(host, t) !== null;
        if (cyclicRec) {
          host.declare(`declare void @scr_dyn_from_enter(ptr)`);
          host.declare(`declare void @scr_dyn_from_leave()`);
          B.line(`call void @scr_dyn_from_enter(ptr %v)`);
        }
        if (shape.tuple) {
          // A tuple converts as the JSON ARRAY it is everywhere else.
          host.declare(`declare ptr @scr_dyn_new_arr()`);
          host.declare(`declare void @scr_dyn_arr_push(ptr, ptr)`);
          const byIndex = [...shape.fields].sort((a, b) => Number(a.name) - Number(b.name));
          const d = B.tmp();
          B.line(`${d} = call ptr @scr_dyn_new_arr()`);
          for (const f of byIndex) {
            const fv = loadFieldOf(f.name, f.type);
            const conv = B.tmp();
            // A FUNCTION field boxes through the closure path — stranded when
          // its signature has no dyn call thunk — since the per-type
          // converter has no case for a closure.
          if (f.type.kind === "func") {
            const fbox = canBoxFuncIntoDyn(f.type, (id: string) => this.host.recordsById.get(id), (id: string) => this.host.unionsById.get(id))
              ? this.dynFuncBoxHelper(f.type)
              : this.strandedDynFuncBoxHelper(f.type);
            B.line(`${conv} = call ptr @${fbox}(ptr ${fv}, ptr null, ptr null)`);
          } else {
            B.line(`${conv} = call ptr @${this.toDynHelper(f.type)}(${this.valTy(f.type)} ${fv})`);
          }
            B.line(`call void @scr_dyn_arr_push(ptr ${d}, ptr ${conv})`);
          }
          if (cyclicRec) B.line(`call void @scr_dyn_from_leave()`);
          B.terminate(`ret ptr ${d}`);
          break;
        }
        host.declare(`declare ptr @scr_dyn_new_obj()`);
        const d = B.tmp();
        B.line(`${d} = call ptr @scr_dyn_new_obj()`);
        // Keys insert in DECLARED order (JS insertion order); internal
        // '%'-fields follow so a record→dyn→record round trip keeps them.
        const byName = new Map(shape.fields.map((f) => [f.name, f]));
        const order = shape.declaredOrder ?? shape.fields.map((f) => f.name);
        const inOrder = new Set(order);
        const dynFields = [
          ...order.map((n) => byName.get(n)).filter((f) => f !== undefined),
          ...shape.fields.filter((f) => !inOrder.has(f.name)),
        ];
        for (const f of dynFields) {
          const klen = Buffer.byteLength(f.name, "utf8");
          const fv = loadFieldOf(f.name, f.type);
          const conv = B.tmp();
          // Same rule as the ordered pass above: a FUNCTION field boxes
          // through the closure path, stranded when its signature has no
          // dyn call thunk.
          if (f.type.kind === "func") {
            const fbox = canBoxFuncIntoDyn(f.type, (id: string) => this.host.recordsById.get(id), (id: string) => this.host.unionsById.get(id))
              ? this.dynFuncBoxHelper(f.type)
              : this.strandedDynFuncBoxHelper(f.type);
            B.line(`${conv} = call ptr @${fbox}(ptr ${fv}, ptr null, ptr null)`);
          } else {
            B.line(`${conv} = call ptr @${this.toDynHelper(f.type)}(${this.valTy(f.type)} ${fv})`);
          }
          B.line(`call void @scr_dyn_obj_set(ptr ${d}, ptr ${host.cstr(f.name)}, i64 ${klen}, ptr ${conv}) ; ${f.name}`);
        }
        if (shape.indexValue) {
          const iv = shape.indexValue;
          host.declare(`declare ptr @scr_map_keys_js_order(ptr)`);
          host.declare(`declare double @scr_arr_len(ptr)`);
          host.declare(`declare ptr @scr_arr_get_ref(ptr, double)`);
          host.declare(`declare void @scr_str_release(ptr)`);
          host.declare(`declare void @scr_arr_release(ptr)`);
          const ovfp = B.tmp();
          const ovf = B.tmp();
          B.line(`${ovfp} = getelementptr inbounds %${struct}, ptr %v, i64 0, i32 ${shape.fields.length + 1}`);
          B.line(`${ovf} = load ptr, ptr ${ovfp} ; overflow map`);
          const ks = B.tmp();
          const len = B.tmp();
          B.line(`${ks} = call ptr @scr_map_keys_js_order(ptr ${ovf})`);
          B.line(`${len} = call double @scr_arr_len(ptr ${ks})`);
          const iSlot = B.slot();
          B.entryAllocas.push(`${iSlot} = alloca double`);
          B.line(`store double ${f64Lit(0)}, ptr ${iSlot}`);
          const lc = B.newLabel("tdo.c");
          const lb = B.newLabel("tdo.b");
          const le = B.newLabel("tdo.e");
          B.br(lc);
          B.startBlock(lc);
          const i = B.tmp();
          const cont = B.tmp();
          B.line(`${i} = load double, ptr ${iSlot}`);
          B.line(`${cont} = fcmp olt double ${i}, ${len}`);
          B.condBr(cont, lb, le);
          B.startBlock(lb);
          const k = B.tmp();
          B.line(`${k} = call ptr @scr_arr_get_ref(ptr ${ks}, double ${i}) ; key (+1)`);
          const { len: klen, data: kdata } = this.strParts(B, k);
          if (iv.kind === "f64" || iv.kind === "bool") {
            const outTy = iv.kind === "f64" ? "double" : "i8";
            const outSlot = B.slot();
            B.entryAllocas.push(`${outSlot} = alloca ${outTy}`);
            B.line(`store ${outTy} ${iv.kind === "f64" ? f64Lit(0) : "0"}, ptr ${outSlot}`);
            host.declare(`declare zeroext i1 @scr_map_get_str_${iv.kind === "f64" ? "f64" : "bool"}(ptr, ptr, ptr)`);
            const found = B.tmp();
            B.line(`${found} = call zeroext i1 @scr_map_get_str_${iv.kind === "f64" ? "f64" : "bool"}(ptr ${ovf}, ptr ${k}, ptr ${outSlot})`);
            const raw = B.tmp();
            B.line(`${raw} = load ${outTy}, ptr ${outSlot}`);
            let val = raw;
            if (iv.kind === "bool") {
              val = B.tmp();
              B.line(`${val} = trunc i8 ${raw} to i1`);
            }
            const boxed = B.tmp();
            if (iv.kind === "f64") {
              host.declare(`declare ptr @scr_dyn_new_num(double)`);
              B.line(`${boxed} = call ptr @scr_dyn_new_num(double ${val})`);
            } else {
              host.declare(`declare ptr @scr_dyn_new_bool(i1 zeroext)`);
              B.line(`${boxed} = call ptr @scr_dyn_new_bool(i1 ${val})`);
            }
            B.line(`call void @scr_dyn_obj_set(ptr ${d}, ptr ${kdata}, i64 ${klen}, ptr ${boxed})`);
          } else if (iv.kind === "dyn") {
            // get_str_ref returns +1 — exactly the ownership obj_set takes.
            host.declare(`declare ptr @scr_map_get_str_ref(ptr, ptr)`);
            const hit = B.tmp();
            B.line(`${hit} = call ptr @scr_map_get_str_ref(ptr ${ovf}, ptr ${k})`);
            B.line(`call void @scr_dyn_obj_set(ptr ${d}, ptr ${kdata}, i64 ${klen}, ptr ${hit})`);
          } else {
            host.declare(`declare ptr @scr_map_get_str_ref(ptr, ptr)`);
            const hit = B.tmp();
            B.line(`${hit} = call ptr @scr_map_get_str_ref(ptr ${ovf}, ptr ${k})`);
            const conv = B.tmp();
            B.line(`${conv} = call ptr @${this.toDynHelper(iv)}(ptr ${hit})`);
            B.line(`call void @scr_dyn_obj_set(ptr ${d}, ptr ${kdata}, i64 ${klen}, ptr ${conv})`);
            B.line(`call void ${releaseSym(host, iv)}(ptr ${hit})`);
          }
          B.line(`call void @scr_str_release(ptr ${k})`);
          const i2 = B.tmp();
          B.line(`${i2} = fadd double ${i}, ${f64Lit(1)}`);
          B.line(`store double ${i2}, ptr ${iSlot}`);
          B.br(lc);
          B.startBlock(le);
          B.line(`call void @scr_arr_release(ptr ${ks})`);
        }
        if (cyclicRec) B.line(`call void @scr_dyn_from_leave()`);
        B.terminate(`ret ptr ${d}`);
        break;
      }
      case "array": {
        const elem = t.elem;
        host.declare(`declare ptr @scr_dyn_new_arr()`);
        host.declare(`declare void @scr_dyn_arr_push(ptr, ptr)`);
        host.declare(`declare double @scr_arr_len(ptr)`);
        // Cycle-capable arrays guard the deep copy like records above.
        const cyclicArr = traceAdapter(host, t) !== null;
        if (cyclicArr) {
          host.declare(`declare void @scr_dyn_from_enter(ptr)`);
          host.declare(`declare void @scr_dyn_from_leave()`);
          B.line(`call void @scr_dyn_from_enter(ptr %v)`);
        }
        const d = B.tmp();
        B.line(`${d} = call ptr @scr_dyn_new_arr()`);
        const len = B.tmp();
        B.line(`${len} = call double @scr_arr_len(ptr %v)`);
        const iSlot = B.slot();
        B.entryAllocas.push(`${iSlot} = alloca double`);
        B.line(`store double ${f64Lit(0)}, ptr ${iSlot}`);
        const lc = B.newLabel("tda.c");
        const lb = B.newLabel("tda.b");
        const le = B.newLabel("tda.e");
        B.br(lc);
        B.startBlock(lc);
        const i = B.tmp();
        const cont = B.tmp();
        B.line(`${i} = load double, ptr ${iSlot}`);
        B.line(`${cont} = fcmp olt double ${i}, ${len}`);
        B.condBr(cont, lb, le);
        B.startBlock(lb);
        if (elem.kind === "f64" || elem.kind === "bool") {
          const acc = elem.kind;
          const accTy = elem.kind === "f64" ? "double" : "i1";
          host.declare(`declare ${elem.kind === "bool" ? "zeroext i1" : accTy} @scr_arr_get_${acc}(ptr, double)`);
          const e = B.tmp();
          B.line(`${e} = call ${accTy} @scr_arr_get_${acc}(ptr %v, double ${i})`);
          const boxed = B.tmp();
          if (elem.kind === "f64") {
            host.declare(`declare ptr @scr_dyn_new_num(double)`);
            B.line(`${boxed} = call ptr @scr_dyn_new_num(double ${e})`);
          } else {
            host.declare(`declare ptr @scr_dyn_new_bool(i1 zeroext)`);
            B.line(`${boxed} = call ptr @scr_dyn_new_bool(i1 ${e})`);
          }
          B.line(`call void @scr_dyn_arr_push(ptr ${d}, ptr ${boxed})`);
        } else {
          host.declare(`declare ptr @scr_arr_get_ref(ptr, double)`);
          const e = B.tmp();
          B.line(`${e} = call ptr @scr_arr_get_ref(ptr %v, double ${i}) ; +1`);
          const conv = B.tmp();
          B.line(`${conv} = call ptr @${this.toDynHelper(elem)}(ptr ${e})`);
          B.line(`call void @scr_dyn_arr_push(ptr ${d}, ptr ${conv})`);
          B.line(`call void ${releaseSym(host, elem)}(ptr ${e})`);
        }
        const i2 = B.tmp();
        B.line(`${i2} = fadd double ${i}, ${f64Lit(1)}`);
        B.line(`store double ${i2}, ptr ${iSlot}`);
        B.br(lc);
        B.startBlock(le);
        if (cyclicArr) B.line(`call void @scr_dyn_from_leave()`);
        B.terminate(`ret ptr ${d}`);
        break;
      }
      case "union": {
        const def = host.unionsById.get(t.unionId);
        if (!def) throw new Error(`llvm emitter bug: to-dyn of unknown union ${t.unionId}`);
        const tagp = B.tmp();
        const tag = B.tmp();
        B.line(`${tagp} = getelementptr inbounds %ScrUnion, ptr %v, i64 0, i32 1`);
        B.line(`${tag} = load i32, ptr ${tagp}`);
        const bad = B.newLabel("tdu.bad");
        const labels = def.arms.map(() => B.newLabel("tdu.a"));
        B.terminate(
          `switch i32 ${tag}, label %${bad} [ ${def.arms.map((_, i) => `i32 ${i}, label %${labels[i]}`).join(" ")} ]`,
        );
        def.arms.forEach((arm, i) => {
          B.startBlock(labels[i]!);
          if (arm.kind === "undefinedT") {
            const u = this.undef(B);
            const r = this.retainDyn(B, u);
            B.terminate(`ret ptr ${r}`);
          } else if (arm.kind === "nullT") {
            host.declare(`declare ptr @scr_dyn_new_null()`);
            const r = B.tmp();
            B.line(`${r} = call ptr @scr_dyn_new_null()`);
            B.terminate(`ret ptr ${r}`);
          } else if (arm.kind === "f64") {
            host.declare(`declare double @scr_union_get_f64(ptr)`);
            host.declare(`declare ptr @scr_dyn_new_num(double)`);
            const x = B.tmp();
            const r = B.tmp();
            B.line(`${x} = call double @scr_union_get_f64(ptr %v)`);
            B.line(`${r} = call ptr @scr_dyn_new_num(double ${x})`);
            B.terminate(`ret ptr ${r}`);
          } else if (arm.kind === "bool") {
            host.declare(`declare zeroext i1 @scr_union_get_bool(ptr)`);
            host.declare(`declare ptr @scr_dyn_new_bool(i1 zeroext)`);
            const x = B.tmp();
            const r = B.tmp();
            B.line(`${x} = call zeroext i1 @scr_union_get_bool(ptr %v)`);
            B.line(`${r} = call ptr @scr_dyn_new_bool(i1 ${x})`);
            B.terminate(`ret ptr ${r}`);
          } else if (arm.kind === "func") {
            // A boxable function arm crosses through the checked-dynamic
            // function boundary (the dynFrom func special case, sans name).
            const pp = B.tmp();
            const p = B.tmp();
            B.line(`${pp} = getelementptr inbounds %ScrUnion, ptr %v, i64 0, i32 5`);
            B.line(`${p} = load ptr, ptr ${pp}`);
            const r = B.tmp();
            B.line(`${r} = call ptr @${this.dynFuncBoxHelper(arm)}(ptr ${p}, ptr null, ptr null)`);
            B.terminate(`ret ptr ${r}`);
          } else {
            const pp = B.tmp();
            const p = B.tmp();
            B.line(`${pp} = getelementptr inbounds %ScrUnion, ptr %v, i64 0, i32 5`);
            B.line(`${p} = load ptr, ptr ${pp}`);
            const r = B.tmp();
            B.line(`${r} = call ptr @${this.toDynHelper(arm)}(ptr ${p}) ; ${arm.kind}`);
            B.terminate(`ret ptr ${r}`);
          }
        });
        B.startBlock(bad);
        host.needBadTag();
        B.line(`call void @sc_bad_tag()`);
        B.terminate(`unreachable`);
        break;
      }
      case "promise": {
        // Promises box by REFERENCE (SCR_DYN_PROMISE — identity is the
        // promise): promise<dyn> carries its ScrPromise directly (the
        // payload is already a dyn value); any other inner boxes an
        // ADAPTER promise whose settle callback converts the payload
        // (rejections copy raw inside the runtime's cb-waiter machinery).
        if (t.inner.kind === "dyn") {
          host.declare(`declare ptr @scr_dyn_new_promise(ptr)`);
          const r = B.tmp();
          B.line(`${r} = call ptr @scr_dyn_new_promise(ptr %v)`);
          B.terminate(`ret ptr ${r}`);
          break;
        }
        host.declare(`declare ptr @scr_dyn_new_promise_adapting(ptr, ptr)`);
        const adapter = this.promiseDynAdapterHelper(t.inner);
        const r = B.tmp();
        B.line(`${r} = call ptr @scr_dyn_new_promise_adapting(ptr %v, ptr @${adapter})`);
        B.terminate(`ret ptr ${r}`);
        break;
      }
      default: {
        // Runtime HANDLE kinds box by REFERENCE (identity — no copy):
        // scr_dyn_new_handle retains the borrowed operand through the
        // tag's installed ops.
        const h = DYN_HANDLE_KINDS.get(t.kind);
        if (h) {
          host.declare(`declare ptr @scr_dyn_new_handle(ptr, i32)`);
          const r = B.tmp();
          B.line(`${r} = call ptr @scr_dyn_new_handle(ptr %v, i32 ${dynHandleTagNum(t.kind)})`);
          B.terminate(`ret ptr ${r}`);
          break;
        }
        throw new LlvmUnsupportedError(`type:${t.kind}`);
      }
    }
    this.defs.push(
      `define internal ptr @${name}(${this.valTy(t)} %v) ${FN_ATTRS} { ; to-dyn ${key}`,
      B.render(),
      `}`,
      ``,
    );
    return name;
  }

  /** The checked-dynamic tree-promise settle adapter for one fulfillment payload type —
   * promiseDynAdapterHelper (emit-walkers.ts), ported:
   * `void sc_pda_<n>(ptr %dst, ptr %src)` reads src's fulfilled payload
   * by its compile-time kind, converts it to a dyn value, and fulfills
   * dst with it (scr_dyn_new_promise_adapting's callback; rejections
   * never reach an adapter — the runtime copies them raw). Interned per
   * inner typeKey. */
  private promiseDynAdapterHelper(inner: IrType): string {
    const key = typeKey(inner);
    const existing = this.promiseDynAdapters.get(key);
    if (existing) return existing;
    const name = `sc_pda_${this.promiseDynAdapters.size}`;
    this.promiseDynAdapters.set(key, name);
    const host = this.host;
    const B = new BlockBuilder();
    host.declare(`declare void @scr_promise_fulfill_ref(ptr, ptr, ptr, ptr, ptr)`);
    host.declare(`declare ptr @scr_dyn_retain_v(ptr)`);
    host.declare(`declare void @scr_dyn_release_v(ptr)`);
    const fulfill = (dv: string): void => {
      B.line(
        `call void @scr_promise_fulfill_ref(ptr %dst, ptr ${dv}, ptr @scr_dyn_retain_v, ptr @scr_dyn_release_v, ptr null)`,
      );
    };
    switch (inner.kind) {
      case "void":
      case "undefinedT": {
        const u = this.undef(B);
        fulfill(this.retainDyn(B, u));
        break;
      }
      case "nullT": {
        host.declare(`declare ptr @scr_dyn_new_null()`);
        const dv = B.tmp();
        B.line(`${dv} = call ptr @scr_dyn_new_null()`);
        fulfill(dv);
        break;
      }
      case "f64": {
        host.declare(`declare double @scr_promise_payload_f64(ptr)`);
        host.declare(`declare ptr @scr_dyn_new_num(double)`);
        const x = B.tmp();
        const dv = B.tmp();
        B.line(`${x} = call double @scr_promise_payload_f64(ptr %src)`);
        B.line(`${dv} = call ptr @scr_dyn_new_num(double ${x})`);
        fulfill(dv);
        break;
      }
      case "bool": {
        host.declare(`declare zeroext i1 @scr_promise_payload_bool(ptr)`);
        host.declare(`declare ptr @scr_dyn_new_bool(i1 zeroext)`);
        const x = B.tmp();
        const dv = B.tmp();
        B.line(`${x} = call zeroext i1 @scr_promise_payload_bool(ptr %src)`);
        B.line(`${dv} = call ptr @scr_dyn_new_bool(i1 ${x})`);
        fulfill(dv);
        break;
      }
      case "string": {
        host.declare(`declare ptr @scr_promise_payload_str(ptr)`);
        host.declare(`declare ptr @scr_dyn_new_str(ptr)`);
        host.declare(`declare void @scr_str_release(ptr)`);
        const s = B.tmp();
        const dv = B.tmp();
        B.line(`${s} = call ptr @scr_promise_payload_str(ptr %src) ; +1`);
        B.line(`${dv} = call ptr @scr_dyn_new_str(ptr ${s}) ; retains s`);
        B.line(`call void @scr_str_release(ptr ${s})`);
        fulfill(dv);
        break;
      }
      default: {
        // Ref-payload inners (records, arrays, bytes, %Error, unions,
        // nested promises, handles): extract (+1 via the stored retain),
        // convert through the shared to-dyn spelling, release the extract.
        host.declare(`declare ptr @scr_promise_payload_ref(ptr)`);
        const pv = B.tmp();
        B.line(`${pv} = call ptr @scr_promise_payload_ref(ptr %src) ; +1`);
        const dv = this.toDynExpr(B, inner, pv);
        if (isRefCounted(inner)) B.line(`call void ${releaseSym(host, inner)}(ptr ${pv})`);
        fulfill(dv);
        break;
      }
    }
    B.terminate(`ret void`);
    this.defs.push(
      `define internal void @${name}(ptr %dst, ptr %src) ${FN_ATTRS} { ; dyn-box settle adapter for promise<${key}>`,
      B.render(),
      `}`,
      ``,
    );
    return name;
  }

  /* ── the dyn ToString pair (dynToStrHelper, ported) ────────────────── */

  /** Node's String() over a dyn value — sc_ds (+1 result) over the
   * recursive sc_ds_buf walker. Borrowed operand; never throws. */
  dynToStrHelper(): string {
    if (this.dynToStrFn) return this.dynToStrFn;
    const name = "sc_ds";
    this.dynToStrFn = name;
    const host = this.host;
    host.declare(`declare void @scr_jb_init(ptr)`);
    host.declare(`declare ptr @scr_jb_finish(ptr)`);
    host.declare(`declare void @scr_jb_putc(ptr, i8)`);
    host.declare(`declare void @scr_jb_puts(ptr, ptr)`);
    host.declare(`declare ptr @scr_f64_to_scrstr(double)`);
    host.declare(`declare void @scr_str_release(ptr)`);
    host.declare(`declare ptr @scr_dyn_to_string(ptr, ptr)`);

    // The recursive buffer walker.
    {
      const B = new BlockBuilder();
      const kd = this.kindOf(B, "%d");
      const done = B.newLabel("ds.d");
      // The switch's DEFAULT used to be `done` — a kind with no arm
      // appended nothing and String(u) answered "" while every other
      // spelling of the question threw or printed. It now falls back to
      // the runtime's own ToString, the C twin's fix and for the same
      // reason: this walker is a per-program COPY of that table, and a
      // copy must degrade to the original rather than to silence.
      // SCR_DYN_ARRBUF is the first kind to arrive through it.
      const dflt = B.newLabel("ds.dflt");
      const labels = new Map<number, string>();
      for (const k of [DK.NULL, DK.BOOL, DK.NUM, DK.STR, DK.ARR, DK.OBJ, DK.UNDEF, DK.BYTES, DK.FUNC, DK.HANDLE, DK.PROMISE, DK.JSVAL, DK.OBJINST]) {
        labels.set(k, B.newLabel(`ds.k${k}`));
      }
      B.terminate(
        `switch i32 ${kd}, label %${dflt} [ ${[...labels].map(([k, l]) => `i32 ${k}, label %${l}`).join(" ")} ]`,
      );
      B.startBlock(dflt);
      {
        const s = B.tmp();
        B.line(`${s} = call ptr @scr_dyn_to_string(ptr %d, ptr null)`);
        this.putScrStr(B, "%b", s);
        B.line(`call void @scr_str_release(ptr ${s})`);
        B.br(done);
      }
      B.startBlock(labels.get(DK.JSVAL)!);
      {
        // Island-held: the engine's own ToString (a bridged failure
        // leaves the exception pending and appends nothing).
        host.declare(`declare void @scr_dyn_isl_tostr_buf(ptr, ptr)`);
        B.line(`call void @scr_dyn_isl_tostr_buf(ptr %b, ptr %d)`);
        B.br(done);
      }
      B.startBlock(labels.get(DK.UNDEF)!);
      this.puts(B, "%b", "undefined");
      B.br(done);
      B.startBlock(labels.get(DK.NULL)!);
      this.puts(B, "%b", "null");
      B.br(done);
      B.startBlock(labels.get(DK.BOOL)!);
      {
        const bv = this.boolOf(B, "%d");
        const s = B.tmp();
        B.line(`${s} = select i1 ${bv}, ptr ${host.cstr("true")}, ptr ${host.cstr("false")}`);
        B.line(`call void @scr_jb_puts(ptr %b, ptr ${s})`);
        B.br(done);
      }
      B.startBlock(labels.get(DK.NUM)!);
      {
        // String(n): NaN/Infinity spelled out, not the JSON null.
        const x = this.payloadOf(B, "%d", "double");
        const s = B.tmp();
        B.line(`${s} = call ptr @scr_f64_to_scrstr(double ${x})`);
        this.putScrStr(B, "%b", s);
        B.line(`call void @scr_str_release(ptr ${s})`);
        B.br(done);
      }
      B.startBlock(labels.get(DK.STR)!);
      {
        const s = this.payloadOf(B, "%d", "ptr");
        this.putScrStr(B, "%b", s);
        B.br(done);
      }
      B.startBlock(labels.get(DK.ARR)!);
      {
        // Array.prototype.toString: join(",") — null/undefined ELEMENTS
        // print empty (unlike top level), nested arrays flatten. An
        // element's own toString can throw, and JS's join stops there:
        // the remaining elements' toStrings are user code Node never
        // runs (emit-walkers.ts's C twin carries the same bail).
        const n = this.lenOf(B, "%d");
        const items = this.itemsOf(B, "%d");
        this.i64Loop(B, "ds.ar", n, (i, brNext) => {
          const nz = B.tmp();
          B.line(`${nz} = icmp ugt i64 ${i}, 0`);
          const lcm = B.newLabel("ds.cm");
          const lel = B.newLabel("ds.el");
          B.condBr(nz, lcm, lel);
          B.startBlock(lcm);
          B.line(`call void @scr_jb_putc(ptr %b, i8 44)`);
          B.br(lel);
          B.startBlock(lel);
          const e = this.itemAt(B, items, i);
          const ek = this.kindOf(B, e);
          const isU = B.tmp();
          const isN = B.tmp();
          const unit = B.tmp();
          B.line(`${isU} = icmp eq i32 ${ek}, ${DK.UNDEF}`);
          B.line(`${isN} = icmp eq i32 ${ek}, ${DK.NULL}`);
          B.line(`${unit} = or i1 ${isU}, ${isN}`);
          const lSkip = B.newLabel("ds.sk");
          const lRec = B.newLabel("ds.rc");
          B.condBr(unit, lSkip, lRec);
          B.startBlock(lSkip);
          brNext();
          B.startBlock(lRec);
          B.line(`call void @sc_ds_buf(ptr %b, ptr ${e})`);
          this.pendingBail(B, "ds.ap", () => {}, "void");
        });
        B.br(done);
      }
      B.startBlock(labels.get(DK.OBJ)!);
      {
        // JS ToString over an object: an OWN or INHERITED callable
        // `toString` runs (`K.prototype.toString = fn` is where JS
        // programs put one), a caught error renders its encoded
        // name/message, and everything else is the
        // "[object Object]" constant. All three live in
        // scr_dyn_to_string, so this arm DELEGATES rather than
        // repeating them: this walker is a per-program COPY of the
        // runtime ToString table, and a copy that answers a value
        // differently from the original is one value with two answers.
        // It used to pre-check the "%error" marker HERE, ahead of the
        // protocol, so an error carrying its own toString answered the
        // encoded form through String(e) and the toString through
        // e.toString(); the runtime orders the two the way JS does
        // (Error.prototype.toString is only a fallback), so the
        // pre-check was the disagreement, not the fix.
        const s = B.tmp();
        B.line(`${s} = call ptr @scr_dyn_to_string(ptr %d, ptr null)`);
        this.putScrStr(B, "%b", s);
        B.line(`call void @scr_str_release(ptr ${s})`);
        B.br(done);
      }
      B.startBlock(labels.get(DK.BYTES)!);
      {
        // Buffer-flavored values coerce utf8; plain Uint8Array joins
        // its elements.
        const bufp = B.tmp();
        const bufRaw = B.tmp();
        const isBuf = B.tmp();
        B.line(`${bufp} = getelementptr inbounds i8, ptr %d, i64 12 ; ->buffer`);
        B.line(`${bufRaw} = load i8, ptr ${bufp}`);
        B.line(`${isBuf} = icmp ne i8 ${bufRaw}, 0`);
        const lBuf = B.newLabel("ds.bu");
        const lJoin = B.newLabel("ds.bj");
        B.condBr(isBuf, lBuf, lJoin);
        B.startBlock(lBuf);
        host.declare(`declare ptr @scr_bytes_to_str(ptr, ptr)`);
        const bytes = this.payloadOf(B, "%d", "ptr");
        const enc = host.internLiteral("utf8");
        const txt = B.tmp();
        B.line(`${txt} = call ptr @scr_bytes_to_str(ptr ${bytes}, ptr ${enc})`);
        this.putScrStr(B, "%b", txt);
        B.line(`call void @scr_str_release(ptr ${txt})`);
        B.br(done);
        B.startBlock(lJoin);
        const bts = this.payloadOf(B, "%d", "ptr");
        const blenp = B.tmp();
        const blen = B.tmp();
        const bdatap = B.tmp();
        const bdata = B.tmp();
        B.line(`${blenp} = getelementptr inbounds i8, ptr ${bts}, i64 8 ; ->len`);
        B.line(`${blen} = load i64, ptr ${blenp}`);
        B.line(`${bdatap} = getelementptr inbounds i8, ptr ${bts}, i64 24 ; ->data`);
        B.line(`${bdata} = load ptr, ptr ${bdatap}`);
        this.i64Loop(B, "ds.by", blen, (i) => {
          const nz = B.tmp();
          B.line(`${nz} = icmp ugt i64 ${i}, 0`);
          const lcm = B.newLabel("ds.bc");
          const lv = B.newLabel("ds.bv");
          B.condBr(nz, lcm, lv);
          B.startBlock(lcm);
          B.line(`call void @scr_jb_putc(ptr %b, i8 44)`);
          B.br(lv);
          B.startBlock(lv);
          const cp = B.tmp();
          const c = B.tmp();
          const cd = B.tmp();
          B.line(`${cp} = getelementptr inbounds i8, ptr ${bdata}, i64 ${i}`);
          B.line(`${c} = load i8, ptr ${cp}`);
          B.line(`${cd} = uitofp i8 ${c} to double`);
          const s = B.tmp();
          B.line(`${s} = call ptr @scr_f64_to_scrstr(double ${cd})`);
          this.putScrStr(B, "%b", s);
          B.line(`call void @scr_str_release(ptr ${s})`);
        });
        B.br(done);
      }
      B.startBlock(labels.get(DK.FUNC)!);
      {
        // Function.prototype.toString answers the function's SOURCE TEXT,
        // which the box carries; this walker delegates to the runtime's
        // one renderer exactly as the OBJ and HANDLE arms do, rather than
        // open-coding a native-code stub that would make one value answer
        // two ways depending on the spelling that reached it. Never NULL:
        // a box with no honest answer traps inside the renderer.
        this.host.declare(`declare ptr @scr_fn_to_string(ptr)`);
        const s = B.tmp();
        B.line(`${s} = call ptr @scr_fn_to_string(ptr %d)`);
        this.putScrStr(B, "%b", s);
        B.line(`call void @scr_str_release(ptr ${s})`);
        B.br(done);
      }
      B.startBlock(labels.get(DK.HANDLE)!);
      // The I/O classes inherit Object.prototype.toString, but RegExp owns
      // its own — so this arm delegates to the runtime entry point exactly
      // as the OBJ arm above does, rather than repeating a constant that
      // is right for some tags and wrong for others.
      {
        const s = B.tmp();
        B.line(`${s} = call ptr @scr_dyn_to_string(ptr %d, ptr null)`);
        this.putScrStr(B, "%b", s);
        B.line(`call void @scr_str_release(ptr ${s})`);
      }
      B.br(done);
      B.startBlock(labels.get(DK.OBJINST)!);
      // A class instance may OVERRIDE toString and the box carries no
      // member table to dispatch it through, so the runtime's arm is the
      // loud ladder rather than "[object Object]". Delegated for the same
      // reason the HANDLE arm above is: the copy must not answer a kind
      // differently from the original.
      {
        const s = B.tmp();
        B.line(`${s} = call ptr @scr_dyn_to_string(ptr %d, ptr null)`);
        this.putScrStr(B, "%b", s);
        B.line(`call void @scr_str_release(ptr ${s})`);
      }
      B.br(done);
      B.startBlock(labels.get(DK.PROMISE)!);
      // Object.prototype.toString with the Promise @@toStringTag.
      this.puts(B, "%b", "[object Promise]");
      B.br(done);
      B.startBlock(done);
      B.terminate(`ret void`);
      this.defs.push(
        `define internal void @${name}_buf(ptr %b, ptr %d) ${FN_ATTRS} { ; String(unknown), recursive`,
        B.render(),
        `}`,
        ``,
      );
    }

    // The +1 wrapper with the string fast path.
    {
      const B = new BlockBuilder();
      const kd = this.kindOf(B, "%d");
      const isStr = B.tmp();
      B.line(`${isStr} = icmp eq i32 ${kd}, ${DK.STR}`);
      const lFast = B.newLabel("ds.f");
      const lSlow = B.newLabel("ds.s");
      B.condBr(isStr, lFast, lSlow);
      B.startBlock(lFast);
      host.declare(`declare ptr @scr_str_retain_v(ptr)`);
      const s = this.payloadOf(B, "%d", "ptr");
      const r = B.tmp();
      B.line(`${r} = call ptr @scr_str_retain_v(ptr ${s})`);
      B.terminate(`ret ptr ${r}`);
      B.startBlock(lSlow);
      const buf = "%dsb";
      B.entryAllocas.push(`${buf} = alloca %ScrJsonBuf`);
      B.line(`call void @scr_jb_init(ptr ${buf})`);
      B.line(`call void @${name}_buf(ptr ${buf}, ptr %d)`);
      const out = B.tmp();
      B.line(`${out} = call ptr @scr_jb_finish(ptr ${buf})`);
      B.terminate(`ret ptr ${out}`);
      this.defs.push(
        `define internal ptr @${name}(ptr %d) ${FN_ATTRS} { ; String(unknown) -> owned (+1)`,
        B.render(),
        `}`,
        ``,
      );
    }
    return name;
  }

  /* ── caughtToDyn (emit-walkers.ts, ported) ─────────────────────────── */

  /** A catch binding flowing into an `unknown` slot: the typed→unknown
   * deep-copy stance over the exception snapshot's runtime kind. */
  caughtToDynHelper(): string {
    if (this.caughtToDynFn) return this.caughtToDynFn;
    const name = "sc_cd";
    this.caughtToDynFn = name;
    const host = this.host;
    const B = new BlockBuilder();
    const kp = B.tmp();
    const kd = B.tmp();
    B.line(`${kp} = getelementptr inbounds %ScrCaught, ptr %c, i64 0, i32 1`);
    B.line(`${kd} = load i32, ptr ${kp}`);
    const lF64 = B.newLabel("cd.f");
    const lBool = B.newLabel("cd.b");
    const lStr = B.newLabel("cd.s");
    const lObj = B.newLabel("cd.o");
    const lDef = B.newLabel("cd.d");
    // SCR_EXC_F64=1, BOOL=2, STR=3, REF=4 (default), OBJ=5.
    B.terminate(
      `switch i32 ${kd}, label %${lDef} [ i32 1, label %${lF64} i32 2, label %${lBool} i32 3, label %${lStr} i32 5, label %${lObj} ]`,
    );
    B.startBlock(lF64);
    host.declare(`declare ptr @scr_dyn_new_num(double)`);
    {
      const xp = B.tmp();
      const x = B.tmp();
      const r = B.tmp();
      B.line(`${xp} = getelementptr inbounds %ScrCaught, ptr %c, i64 0, i32 2`);
      B.line(`${x} = load double, ptr ${xp}`);
      B.line(`${r} = call ptr @scr_dyn_new_num(double ${x})`);
      B.terminate(`ret ptr ${r}`);
    }
    B.startBlock(lBool);
    host.declare(`declare ptr @scr_dyn_new_bool(i1 zeroext)`);
    {
      const xp = B.tmp();
      const raw = B.tmp();
      const x = B.tmp();
      const r = B.tmp();
      B.line(`${xp} = getelementptr inbounds %ScrCaught, ptr %c, i64 0, i32 3`);
      B.line(`${raw} = load i8, ptr ${xp}`);
      B.line(`${x} = trunc i8 ${raw} to i1`);
      B.line(`${r} = call ptr @scr_dyn_new_bool(i1 ${x})`);
      B.terminate(`ret ptr ${r}`);
    }
    B.startBlock(lStr);
    host.declare(`declare ptr @scr_dyn_new_str(ptr)`);
    {
      const pp = B.tmp();
      const p = B.tmp();
      const r = B.tmp();
      B.line(`${pp} = getelementptr inbounds %ScrCaught, ptr %c, i64 0, i32 4`);
      B.line(`${p} = load ptr, ptr ${pp}`);
      B.line(`${r} = call ptr @scr_dyn_new_str(ptr ${p}) ; _new_str retains`);
      B.terminate(`ret ptr ${r}`);
    }
    B.startBlock(lObj);
    host.declare(`declare zeroext i1 @scr_error_is(ptr)`);
    {
      const pp = B.tmp();
      const p = B.tmp();
      B.line(`${pp} = getelementptr inbounds %ScrCaught, ptr %c, i64 0, i32 4`);
      B.line(`${p} = load ptr, ptr ${pp}`);
      const isErr = B.tmp();
      B.line(`${isErr} = call zeroext i1 @scr_error_is(ptr ${p})`);
      const lErr = B.newLabel("cd.e");
      B.condBr(isErr, lErr, lDef);
      B.startBlock(lErr);
      // The identity-cached crossing (scr_json.c): one error instance,
      // one dyn node — the C walker's arm exactly.
      host.declare(`declare ptr @scr_dyn_from_error(ptr)`);
      const r = B.tmp();
      B.line(`${r} = call ptr @scr_dyn_from_error(ptr ${p})`);
      B.terminate(`ret ptr ${r}`);
    }
    B.startBlock(lDef);
    // SCR_EXC_REF: a thrown dyn value passes back BY REFERENCE (identity
    // with every other holder — the dyn adapters discriminate); non-dyn
    // REF and non-Error objects keep the "[object Object]" approximation
    // — truthy, typeof "object", fields unreadable.
    host.declare(`declare ptr @scr_dyn_new_obj()`);
    host.declare(`declare ptr @scr_dyn_retain_v(ptr)`);
    {
      const rfp = B.tmp();
      const rf = B.tmp();
      B.line(`${rfp} = getelementptr inbounds %ScrCaught, ptr %c, i64 0, i32 5`);
      B.line(`${rf} = load ptr, ptr ${rfp}`);
      const isDyn = B.tmp();
      B.line(`${isDyn} = icmp eq ptr ${rf}, @scr_dyn_retain_v`);
      const lRef = B.newLabel("cd.r");
      const lPlain = B.newLabel("cd.p");
      B.condBr(isDyn, lRef, lPlain);
      B.startBlock(lRef);
      const pp = B.tmp();
      const p = B.tmp();
      const r = B.tmp();
      B.line(`${pp} = getelementptr inbounds %ScrCaught, ptr %c, i64 0, i32 4`);
      B.line(`${p} = load ptr, ptr ${pp}`);
      B.line(`${r} = call ptr @scr_dyn_retain_v(ptr ${p})`);
      B.terminate(`ret ptr ${r}`);
      B.startBlock(lPlain);
      const e = B.tmp();
      B.line(`${e} = call ptr @scr_dyn_new_obj()`);
      B.terminate(`ret ptr ${e}`);
    }
    this.defs.push(
      `define internal ptr @${name}(ptr %c) ${FN_ATTRS} { ; caught -> unknown (+1, fresh tree)`,
      B.render(),
      `}`,
      ``,
    );
    return name;
  }

  /* ── the keyed read (dynKeyGetHelper, ported) ──────────────────────── */

  /** `sc_dyn_key_get(ptr d, ptr k, i1 opt) -> ptr` — d[k] on a dyn value.
   * Result +1; throws on non-optional nullish receivers. */
  dynKeyGetHelper(): string {
    const memoKey = "%dynKeyGet";
    const existing = this.dynBuilders.get(memoKey);
    if (existing) return existing;
    const name = "sc_dyn_key_get";
    this.dynBuilders.set(memoKey, name);
    const host = this.host;
    const B = new BlockBuilder();
    const kd = this.kindOf(B, "%d");
    const kParts = this.strParts(B, "%k");
    const retainUndef = (): void => {
      const u = this.undef(B);
      const r = this.retainDyn(B, u);
      B.terminate(`ret ptr ${r}`);
    };
    /* The MISS answer, everywhere the walk for a kind has come up empty:
     * ask the dispatch unit whether the receiver's PROTOTYPE has this
     * name before settling for undefined. Object.prototype's methods and
     * every primitive prototype's live as C branches in scr_dyn_invoke.c
     * rather than as a stored chain, which is why `o[k]("hasOwnProperty")`
     * answered true while `typeof o[k]` answered undefined. The C emitter
     * splices the same call at the same points, so the two lanes cannot
     * answer a member differently. NOT used on the `?.` nullish arm: that
     * undefined is the optional step's own answer, not a miss. */
    const intrinsicOrUndef = (): void => {
      host.declare(`declare ptr @scr_dyn_intrinsic_method_get(ptr, ptr)`);
      const im = B.tmp();
      B.line(`${im} = call ptr @scr_dyn_intrinsic_method_get(ptr %d, ptr %k)`);
      const hasIm = B.tmp();
      B.line(`${hasIm} = icmp ne ptr ${im}, null`);
      const lIm = B.newLabel("kg.im");
      const lU = B.newLabel("kg.iu");
      B.condBr(hasIm, lIm, lU);
      B.startBlock(lIm);
      B.terminate(`ret ptr ${im}`);
      B.startBlock(lU);
      retainUndef();
    };
    // undefined/null receivers: opt answers undefined; otherwise throw
    // Node's TypeError with the key spliced in.
    {
      const isU = B.tmp();
      const isN = B.tmp();
      const unit = B.tmp();
      B.line(`${isU} = icmp eq i32 ${kd}, ${DK.UNDEF}`);
      B.line(`${isN} = icmp eq i32 ${kd}, ${DK.NULL}`);
      B.line(`${unit} = or i1 ${isU}, ${isN}`);
      const lUnit = B.newLabel("kg.u");
      const lNext = B.newLabel("kg.n");
      B.condBr(unit, lUnit, lNext);
      B.startBlock(lUnit);
      const lOpt = B.newLabel("kg.o");
      const lThrow = B.newLabel("kg.t");
      B.condBr("%opt", lOpt, lThrow);
      B.startBlock(lOpt);
      retainUndef();
      B.startBlock(lThrow);
      host.declare(`declare ptr @scr_str_new(ptr, i64)`);
      host.declare(`declare ptr @scr_str_concat(ptr, ptr)`);
      host.declare(`declare void @scr_str_release(ptr)`);
      host.declare(`declare void @scr_throw_error(i32, ptr)`);
      const baseU = "Cannot read properties of undefined (reading '";
      const baseN = "Cannot read properties of null (reading '";
      const base = B.tmp();
      B.line(`${base} = select i1 ${isU}, ptr ${host.cstr(baseU)}, ptr ${host.cstr(baseN)}`);
      const baseLen = B.tmp();
      B.line(`${baseLen} = select i1 ${isU}, i64 ${Buffer.byteLength(baseU)}, i64 ${Buffer.byteLength(baseN)}`);
      const head = B.tmp();
      B.line(`${head} = call ptr @scr_str_new(ptr ${base}, i64 ${baseLen})`);
      const withKey = B.tmp();
      B.line(`${withKey} = call ptr @scr_str_concat(ptr ${head}, ptr %k)`);
      B.line(`call void @scr_str_release(ptr ${head})`);
      const tail = B.tmp();
      B.line(`${tail} = call ptr @scr_str_new(ptr ${host.cstr("')")}, i64 2)`);
      const msg = B.tmp();
      B.line(`${msg} = call ptr @scr_str_concat(ptr ${withKey}, ptr ${tail})`);
      B.line(`call void @scr_str_release(ptr ${withKey})`);
      B.line(`call void @scr_str_release(ptr ${tail})`);
      B.line(`call void @scr_throw_error(i32 1, ptr ${msg}) ; SCR_ERR_TYPE; takes ownership`);
      B.terminate(`ret ptr null`);
      B.startBlock(lNext);
    }
    // ISLAND-held receivers: o[k] reads the REAL engine property (getters
    // included, throws bridged catchably) and the result wraps back
    // scalar-normalized — the routed keyed read that retired the fence.
    {
      const isJv = B.tmp();
      B.line(`${isJv} = icmp eq i32 ${kd}, ${DK.JSVAL}`);
      const lJv = B.newLabel("kg.jv");
      const lNext = B.newLabel("kg.n");
      B.condBr(isJv, lJv, lNext);
      B.startBlock(lJv);
      host.declare(`declare ptr @scr_dyn_isl_key_get(ptr, ptr)`);
      const r = B.tmp();
      B.line(`${r} = call ptr @scr_dyn_isl_key_get(ptr %d, ptr %k)`);
      B.terminate(`ret ptr ${r}`);
      B.startBlock(lNext);
    }
    // OBJ: JS's [[Get]], whole, in ONE runtime entry point — the own
    // member, the own ACCESSOR (its getter called with `this` bound to
    // the receiver), the same two up the PROTOTYPE CHAIN, and the
    // `constructor` fence. The C emitter's arm calls the same function
    // (scr_dyn_obj_key_get), which is the only way the two lanes stay
    // incapable of answering a property differently — the split
    // estado-protochain.md §2e found by building both by hand.
    {
      const isObj = B.tmp();
      B.line(`${isObj} = icmp eq i32 ${kd}, ${DK.OBJ}`);
      const lObj = B.newLabel("kg.ob");
      const lNext = B.newLabel("kg.n");
      B.condBr(isObj, lObj, lNext);
      B.startBlock(lObj);
      host.declare(`declare ptr @scr_dyn_obj_key_get(ptr, ptr, i64)`);
      const r = B.tmp();
      B.line(`${r} = call ptr @scr_dyn_obj_key_get(ptr %d, ptr ${kParts.data}, i64 ${kParts.len})`);
      // The walk missed (or threw) — a NULL is the getter's exception or
      // the `constructor` fence and rides out; an UNDEF is the miss, and
      // the question left is Object.prototype's, which lives in the
      // dispatch unit rather than in a stored chain.
      const isNull = B.tmp();
      B.line(`${isNull} = icmp eq ptr ${r}, null`);
      const lOut = B.newLabel("kg.obo");
      const lLive = B.newLabel("kg.obl");
      B.condBr(isNull, lOut, lLive);
      B.startBlock(lOut);
      B.terminate(`ret ptr ${r}`);
      B.startBlock(lLive);
      const rk = this.kindOf(B, r);
      const wasUndef = B.tmp();
      B.line(`${wasUndef} = icmp eq i32 ${rk}, ${DK.UNDEF}`);
      const lMiss = B.newLabel("kg.obm");
      const lHit = B.newLabel("kg.obh");
      B.condBr(wasUndef, lMiss, lHit);
      B.startBlock(lHit);
      B.terminate(`ret ptr ${r}`);
      B.startBlock(lMiss);
      host.declare(`declare ptr @scr_dyn_intrinsic_method_get(ptr, ptr)`);
      host.declare(`declare void @scr_dyn_release(ptr)`);
      const oim = B.tmp();
      B.line(`${oim} = call ptr @scr_dyn_intrinsic_method_get(ptr %d, ptr %k)`);
      const hasOim = B.tmp();
      B.line(`${hasOim} = icmp ne ptr ${oim}, null`);
      const lOim = B.newLabel("kg.obi");
      const lKeep = B.newLabel("kg.obk");
      B.condBr(hasOim, lOim, lKeep);
      B.startBlock(lOim);
      B.line(`call void @scr_dyn_release(ptr ${r})`);
      B.terminate(`ret ptr ${oim}`);
      B.startBlock(lKeep);
      B.terminate(`ret ptr ${r}`);
      B.startBlock(lNext);
    }
    // BIG: a primitive with a real prototype — (5n).toString is a
    // function and (5n).nope is undefined, and the box has no table to
    // tell them apart. The undefined tail would answer undefined for the
    // methods Node returns, so the read is the loud ladder. The C
    // emitter's arm, same runtime entry point.
    {
      const isBg = B.tmp();
      B.line(`${isBg} = icmp eq i32 ${kd}, ${DK.BIG}`);
      const lBg = B.newLabel("kg.bg");
      const lNext = B.newLabel("kg.n");
      B.condBr(isBg, lBg, lNext);
      B.startBlock(lBg);
      host.declare(`declare zeroext i1 @scr_dyn_big_fence(ptr, ptr)`);
      B.line(`call zeroext i1 @scr_dyn_big_fence(ptr %d, ptr ${host.cstr("a property read")})`);
      B.terminate(`ret ptr null`);
      B.startBlock(lNext);
    }
    // OBJINST: a class instance's members are struct fields the box has no
    // table for. Falling through to the undefined tail would be a SILENT
    // wrong answer for a property Node reads fine, so the read is the loud
    // ladder — the C emitter's arm, same runtime entry point.
    {
      const isCi = B.tmp();
      B.line(`${isCi} = icmp eq i32 ${kd}, ${DK.OBJINST}`);
      const lCi = B.newLabel("kg.ci");
      const lNext = B.newLabel("kg.n");
      B.condBr(isCi, lCi, lNext);
      B.startBlock(lCi);
      host.declare(`declare zeroext i1 @scr_dyn_objinst_fence(ptr, ptr)`);
      B.line(`call zeroext i1 @scr_dyn_objinst_fence(ptr %d, ptr ${host.cstr("a property read")})`);
      B.terminate(`ret ptr null`);
      B.startBlock(lNext);
    }
    // HANDLE: the tag's modeled properties through the installed ops.
    {
      const isH = B.tmp();
      B.line(`${isH} = icmp eq i32 ${kd}, ${DK.HANDLE}`);
      const lH = B.newLabel("kg.h");
      const lNext = B.newLabel("kg.n");
      B.condBr(isH, lH, lNext);
      B.startBlock(lH);
      host.declare(`declare ptr @scr_dyn_handle_key_get(ptr, ptr)`);
      const r = B.tmp();
      B.line(`${r} = call ptr @scr_dyn_handle_key_get(ptr %d, ptr %k)`);
      B.terminate(`ret ptr ${r}`);
      B.startBlock(lNext);
    }
    // ARRBUF: 'byteLength' answers; 'length' and every index are
    // undefined, which is Node. The C twin's arm.
    {
      const isAb = B.tmp();
      B.line(`${isAb} = icmp eq i32 ${kd}, ${DK.ARRBUF}`);
      const lAb = B.newLabel("kg.ab");
      const lNext = B.newLabel("kg.n");
      B.condBr(isAb, lAb, lNext);
      B.startBlock(lAb);
      host.declare(`declare ptr @scr_dyn_arrbuf_key_get(ptr, ptr)`);
      const r = B.tmp();
      B.line(`${r} = call ptr @scr_dyn_arrbuf_key_get(ptr %d, ptr %k)`);
      B.terminate(`ret ptr ${r}`);
      B.startBlock(lNext);
    }
    // The canonical-index parse, shared by BYTES/ARR/STR: digits only,
    // no leading zero. Leaves (digits, idx).
    const parseIndex = (): { digits: string; idx: string } => {
      const digitsSlot = B.slot();
      const idxSlot = B.slot();
      B.entryAllocas.push(`${digitsSlot} = alloca i1`, `${idxSlot} = alloca i64`);
      B.line(`store i1 false, ptr ${digitsSlot}`);
      B.line(`store i64 0, ptr ${idxSlot}`);
      // k->len > 0 && !(k->len > 1 && k->data[0] == '0')
      const nz = B.tmp();
      B.line(`${nz} = icmp ugt i64 ${kParts.len}, 0`);
      const lGo = B.newLabel("kg.ix");
      const lOut = B.newLabel("kg.io");
      B.condBr(nz, lGo, lOut);
      B.startBlock(lGo);
      const multi = B.tmp();
      B.line(`${multi} = icmp ugt i64 ${kParts.len}, 1`);
      const c0 = B.tmp();
      B.line(`${c0} = load i8, ptr ${kParts.data}`);
      const isZero = B.tmp();
      B.line(`${isZero} = icmp eq i8 ${c0}, 48`);
      const leading = B.tmp();
      B.line(`${leading} = and i1 ${multi}, ${isZero}`);
      const lParse = B.newLabel("kg.ip");
      B.condBr(leading, lOut, lParse);
      B.startBlock(lParse);
      B.line(`store i1 true, ptr ${digitsSlot}`);
      this.i64Loop(B, "kg.id", kParts.len, (i) => {
        const cp = B.tmp();
        const c = B.tmp();
        B.line(`${cp} = getelementptr inbounds i8, ptr ${kParts.data}, i64 ${i}`);
        B.line(`${c} = load i8, ptr ${cp}`);
        const lt0 = B.tmp();
        const gt9 = B.tmp();
        B.line(`${lt0} = icmp ult i8 ${c}, 48`);
        B.line(`${gt9} = icmp ugt i8 ${c}, 57`);
        const cur = B.tmp();
        B.line(`${cur} = load i64, ptr ${idxSlot}`);
        const over = B.tmp();
        B.line(`${over} = icmp ugt i64 ${cur}, ${IDX_MAX_DIV10}`);
        const bad0 = B.tmp();
        const bad = B.tmp();
        B.line(`${bad0} = or i1 ${lt0}, ${gt9}`);
        B.line(`${bad} = or i1 ${bad0}, ${over}`);
        const lBad = B.newLabel("kg.ib");
        const lStep = B.newLabel("kg.is");
        B.condBr(bad, lBad, lStep);
        B.startBlock(lBad);
        B.line(`store i1 false, ptr ${digitsSlot}`);
        B.br(lOut);
        B.startBlock(lStep);
        const ten = B.tmp();
        const digit = B.tmp();
        const digit64 = B.tmp();
        const nx = B.tmp();
        B.line(`${ten} = mul i64 ${cur}, 10`);
        B.line(`${digit} = sub i8 ${c}, 48`);
        B.line(`${digit64} = zext i8 ${digit} to i64`);
        B.line(`${nx} = add i64 ${ten}, ${digit64}`);
        B.line(`store i64 ${nx}, ptr ${idxSlot}`);
      });
      B.br(lOut);
      B.startBlock(lOut);
      const digits = B.tmp();
      const idx = B.tmp();
      B.line(`${digits} = load i1, ptr ${digitsSlot}`);
      B.line(`${idx} = load i64, ptr ${idxSlot}`);
      return { digits, idx };
    };
    // `k` is exactly this literal. One shape, so the two keys the BYTES
    // arm tests below cannot drift apart in how they compare.
    const isKey = (lit: string, tag: string): string => {
      host.declare(`declare i32 @memcmp(ptr, ptr, i64)`);
      const slot = B.slot();
      B.entryAllocas.push(`${slot} = alloca i1`);
      B.line(`store i1 false, ptr ${slot}`);
      const lenEq = B.tmp();
      B.line(`${lenEq} = icmp eq i64 ${kParts.len}, ${lit.length}`);
      const lCmp = B.newLabel(`kg.${tag}c`);
      const lj = B.newLabel(`kg.${tag}j`);
      B.condBr(lenEq, lCmp, lj);
      B.startBlock(lCmp);
      const c = B.tmp();
      const same = B.tmp();
      B.line(`${c} = call i32 @memcmp(ptr ${kParts.data}, ptr ${host.cstr(lit)}, i64 ${lit.length})`);
      B.line(`${same} = icmp eq i32 ${c}, 0`);
      B.line(`store i1 ${same}, ptr ${slot}`);
      B.br(lj);
      B.startBlock(lj);
      const out = B.tmp();
      B.line(`${out} = load i1, ptr ${slot}`);
      return out;
    };
    const isLength = (): string => isKey("length", "l6");
    // Parse once up front (pure), branch per kind below — C parses per
    // branch, but the computation is effect-free and identical.
    const lenHit = isLength();
    const ctorHit = isKey("constructor", "kc");
    const { digits, idx } = parseIndex();
    // BYTES: .constructor, .length and canonical-index byte reads answer
    // like Node.
    {
      const isB = B.tmp();
      B.line(`${isB} = icmp eq i32 ${kd}, ${DK.BYTES}`);
      const lB = B.newLabel("kg.by");
      const lNext = B.newLabel("kg.n");
      B.condBr(isB, lB, lNext);
      B.startBlock(lB);
      host.declare(`declare ptr @scr_dyn_new_num(double)`);
      // `b.constructor`: the %Uint8Array% singleton, through the same
      // runtime function the C lane calls (a Buffer or a non-u8 element
      // kind refuses by name inside it).
      {
        host.declare(`declare ptr @scr_dyn_bytes_constructor(ptr)`);
        const lC = B.newLabel("kg.bc");
        const lNc = B.newLabel("kg.bn");
        B.condBr(ctorHit, lC, lNc);
        B.startBlock(lC);
        const rc = B.tmp();
        B.line(`${rc} = call ptr @scr_dyn_bytes_constructor(ptr %d)`);
        B.terminate(`ret ptr ${rc}`);
        B.startBlock(lNc);
      }
      const bts = this.payloadOf(B, "%d", "ptr");
      const blenp = B.tmp();
      const blen = B.tmp();
      B.line(`${blenp} = getelementptr inbounds i8, ptr ${bts}, i64 8 ; ->len`);
      B.line(`${blen} = load i64, ptr ${blenp}`);
      const lLen = B.newLabel("kg.bl");
      const lIdx = B.newLabel("kg.bi");
      B.condBr(lenHit, lLen, lIdx);
      B.startBlock(lLen);
      const lenD = B.tmp();
      const r0 = B.tmp();
      B.line(`${lenD} = uitofp i64 ${blen} to double`);
      B.line(`${r0} = call ptr @scr_dyn_new_num(double ${lenD})`);
      B.terminate(`ret ptr ${r0}`);
      B.startBlock(lIdx);
      const inRange = B.tmp();
      const hit = B.tmp();
      B.line(`${inRange} = icmp ult i64 ${idx}, ${blen}`);
      B.line(`${hit} = and i1 ${digits}, ${inRange}`);
      const lHit = B.newLabel("kg.bh");
      const lMiss = B.newLabel("kg.bm");
      B.condBr(hit, lHit, lMiss);
      B.startBlock(lHit);
      const bdatap = B.tmp();
      const bdata = B.tmp();
      B.line(`${bdatap} = getelementptr inbounds i8, ptr ${bts}, i64 24 ; ->data`);
      B.line(`${bdata} = load ptr, ptr ${bdatap}`);
      const bp = B.tmp();
      const bv = B.tmp();
      const bd = B.tmp();
      const r1 = B.tmp();
      B.line(`${bp} = getelementptr inbounds i8, ptr ${bdata}, i64 ${idx}`);
      B.line(`${bv} = load i8, ptr ${bp}`);
      B.line(`${bd} = uitofp i8 ${bv} to double`);
      B.line(`${r1} = call ptr @scr_dyn_new_num(double ${bd})`);
      B.terminate(`ret ptr ${r1}`);
      B.startBlock(lMiss);
      intrinsicOrUndef();
      B.startBlock(lNext);
    }
    // FUNC: own props (defineProperties writes), then name/length.
    {
      const isF = B.tmp();
      B.line(`${isF} = icmp eq i32 ${kd}, ${DK.FUNC}`);
      const lF = B.newLabel("kg.fn");
      const lNext = B.newLabel("kg.n");
      B.condBr(isF, lF, lNext);
      B.startBlock(lF);
      host.declare(`declare ptr @scr_dyn_fn_get(ptr, ptr, i64)`);
      const m = B.tmp();
      B.line(`${m} = call ptr @scr_dyn_fn_get(ptr %d, ptr ${kParts.data}, i64 ${kParts.len})`);
      const has = B.tmp();
      B.line(`${has} = icmp ne ptr ${m}, null`);
      const lHit = B.newLabel("kg.fh");
      const lMiss = B.newLabel("kg.fm");
      B.condBr(has, lHit, lMiss);
      B.startBlock(lHit);
      B.terminate(`ret ptr ${m}`);
      B.startBlock(lMiss);
      intrinsicOrUndef();
      B.startBlock(lNext);
    }
    // ARR / STR: length + canonical-index element/char reads.
    {
      const isA = B.tmp();
      const isS = B.tmp();
      const either = B.tmp();
      B.line(`${isA} = icmp eq i32 ${kd}, ${DK.ARR}`);
      B.line(`${isS} = icmp eq i32 ${kd}, ${DK.STR}`);
      B.line(`${either} = or i1 ${isA}, ${isS}`);
      const lAS = B.newLabel("kg.as");
      const lNext = B.newLabel("kg.n");
      B.condBr(either, lAS, lNext);
      B.startBlock(lAS);
      host.declare(`declare double @scr_str_utf16_len(ptr)`);
      host.declare(`declare ptr @scr_dyn_new_num(double)`);
      const lLen = B.newLabel("kg.al");
      const lIdx = B.newLabel("kg.ai");
      B.condBr(lenHit, lLen, lIdx);
      B.startBlock(lLen);
      {
        const lArr = B.newLabel("kg.aa");
        const lStr = B.newLabel("kg.asr");
        B.condBr(isA, lArr, lStr);
        B.startBlock(lArr);
        const n = this.lenOf(B, "%d");
        const nd = B.tmp();
        const r = B.tmp();
        B.line(`${nd} = uitofp i64 ${n} to double`);
        B.line(`${r} = call ptr @scr_dyn_new_num(double ${nd})`);
        B.terminate(`ret ptr ${r}`);
        B.startBlock(lStr);
        const s = this.payloadOf(B, "%d", "ptr");
        const n2 = B.tmp();
        const r2 = B.tmp();
        B.line(`${n2} = call double @scr_str_utf16_len(ptr ${s})`);
        B.line(`${r2} = call ptr @scr_dyn_new_num(double ${n2})`);
        B.terminate(`ret ptr ${r2}`);
      }
      B.startBlock(lIdx);
      {
        const lTry = B.newLabel("kg.at");
        const lMiss = B.newLabel("kg.am");
        B.condBr(digits, lTry, lMiss);
        B.startBlock(lTry);
        const lArr = B.newLabel("kg.ae");
        const lStr = B.newLabel("kg.ac");
        B.condBr(isA, lArr, lStr);
        B.startBlock(lArr);
        const n = this.lenOf(B, "%d");
        const inR = B.tmp();
        B.line(`${inR} = icmp ult i64 ${idx}, ${n}`);
        const lHit = B.newLabel("kg.ah");
        B.condBr(inR, lHit, lMiss);
        B.startBlock(lHit);
        const items = this.itemsOf(B, "%d");
        const e = this.itemAt(B, items, idx);
        const r = this.retainDyn(B, e);
        B.terminate(`ret ptr ${r}`);
        B.startBlock(lStr);
        host.declare(`declare ptr @scr_str_char_at(ptr, double)`);
        host.declare(`declare ptr @scr_dyn_new_str(ptr)`);
        host.declare(`declare void @scr_str_release(ptr)`);
        const s = this.payloadOf(B, "%d", "ptr");
        const n2 = B.tmp();
        B.line(`${n2} = call double @scr_str_utf16_len(ptr ${s})`);
        const idxD = B.tmp();
        B.line(`${idxD} = uitofp i64 ${idx} to double`);
        const inR2 = B.tmp();
        B.line(`${inR2} = fcmp olt double ${idxD}, ${n2}`);
        const lHit2 = B.newLabel("kg.ash");
        B.condBr(inR2, lHit2, lMiss);
        B.startBlock(lHit2);
        const ch = B.tmp();
        B.line(`${ch} = call ptr @scr_str_char_at(ptr ${s}, double ${idxD})`);
        const r2 = B.tmp();
        B.line(`${r2} = call ptr @scr_dyn_new_str(ptr ${ch})`);
        B.line(`call void @scr_str_release(ptr ${ch})`);
        B.terminate(`ret ptr ${r2}`);
        B.startBlock(lMiss);
        intrinsicOrUndef();
      }
      B.startBlock(lNext);
    }
    intrinsicOrUndef();
    this.defs.push(
      `define internal ptr @${name}(ptr %d, ptr %k, i1 zeroext %opt) ${FN_ATTRS} { ; d[k] on dyn`,
      B.render(),
      `}`,
      ``,
    );
    return name;
  }

  /* ── destructuring RequireObjectCoercible (ported) ─────────────────── */

  dynDestrCheckHelper(): string {
    const memoKey = "%dynDestrCheck";
    const existing = this.dynBuilders.get(memoKey);
    if (existing) return existing;
    const name = "sc_dyn_destr_check";
    this.dynBuilders.set(memoKey, name);
    const host = this.host;
    host.declare(`declare void @scr_jb_init(ptr)`);
    host.declare(`declare ptr @scr_jb_finish(ptr)`);
    host.declare(`declare void @scr_jb_puts(ptr, ptr)`);
    host.declare(`declare void @scr_throw_error(i32, ptr)`);
    const B = new BlockBuilder();
    const kd = this.kindOf(B, "%d");
    const isU = B.tmp();
    const isN = B.tmp();
    const unit = B.tmp();
    B.line(`${isU} = icmp eq i32 ${kd}, ${DK.UNDEF}`);
    B.line(`${isN} = icmp eq i32 ${kd}, ${DK.NULL}`);
    B.line(`${unit} = or i1 ${isU}, ${isN}`);
    const lThrow = B.newLabel("ddc.t");
    const lOk = B.newLabel("ddc.o");
    B.condBr(unit, lThrow, lOk);
    B.startBlock(lOk);
    B.terminate(`ret void`);
    B.startBlock(lThrow);
    const buf = "%ddb";
    B.entryAllocas.push(`${buf} = alloca %ScrJsonBuf`);
    B.line(`call void @scr_jb_init(ptr ${buf})`);
    const hasProp = B.tmp();
    B.line(`${hasProp} = icmp ne ptr %firstProp, null`);
    const lProp = B.newLabel("ddc.p");
    const lBare = B.newLabel("ddc.b");
    const lTail = B.newLabel("ddc.e");
    B.condBr(hasProp, lProp, lBare);
    B.startBlock(lProp);
    this.puts(B, buf, "Cannot destructure property '");
    B.line(`call void @scr_jb_puts(ptr ${buf}, ptr %firstProp)`);
    this.puts(B, buf, "' of '");
    B.line(`call void @scr_jb_puts(ptr ${buf}, ptr %spell)`);
    this.puts(B, buf, "' as it is ");
    B.br(lTail);
    B.startBlock(lBare);
    this.puts(B, buf, "Cannot destructure '");
    B.line(`call void @scr_jb_puts(ptr ${buf}, ptr %spell)`);
    this.puts(B, buf, "' as it is ");
    B.br(lTail);
    B.startBlock(lTail);
    const tail = B.tmp();
    B.line(`${tail} = select i1 ${isU}, ptr ${host.cstr("undefined.")}, ptr ${host.cstr("null.")}`);
    B.line(`call void @scr_jb_puts(ptr ${buf}, ptr ${tail})`);
    const msg = B.tmp();
    B.line(`${msg} = call ptr @scr_jb_finish(ptr ${buf})`);
    B.line(`call void @scr_throw_error(i32 1, ptr ${msg}) ; SCR_ERR_TYPE`);
    B.terminate(`ret void`);
    this.defs.push(
      `define internal void @${name}(ptr %d, ptr %spell, ptr %firstProp) ${FN_ATTRS} { ; destructuring RequireObjectCoercible`,
      B.render(),
      `}`,
      ``,
    );
    return name;
  }

  /* ── GetIterator + first-N steps (dynIterNHelper, ported) ──────────── */

  dynIterNHelper(): string {
    const memoKey = "%dynIterN";
    const existing = this.dynBuilders.get(memoKey);
    if (existing) return existing;
    const name = "sc_dyn_iter_n";
    this.dynBuilders.set(memoKey, name);
    const host = this.host;
    host.declare(`declare void @scr_jb_init(ptr)`);
    host.declare(`declare ptr @scr_jb_finish(ptr)`);
    host.declare(`declare void @scr_jb_puts(ptr, ptr)`);
    host.declare(`declare void @scr_throw_error(i32, ptr)`);
    host.declare(`declare ptr @scr_dyn_new_arr()`);
    host.declare(`declare void @scr_dyn_arr_push(ptr, ptr)`);
    host.declare(`declare ptr @scr_dyn_new_num(double)`);
    host.declare(`declare ptr @scr_f64_to_scrstr(double)`);
    host.declare(`declare void @scr_str_release(ptr)`);
    const B = new BlockBuilder();
    const kd = this.kindOf(B, "%d");
    // ISLAND-held sources: an engine array IS iterable — the not-iterable
    // TypeError below would be a wrong claim. Loud fence (lane
    // dyn-routing-ops).
    {
      const isJv = B.tmp();
      B.line(`${isJv} = icmp eq i32 ${kd}, ${DK.JSVAL}`);
      const lJv = B.newLabel("din.jv");
      const lNotJv = B.newLabel("din.njv");
      B.condBr(isJv, lJv, lNotJv);
      B.startBlock(lJv);
      host.declare(`declare zeroext i1 @scr_dyn_isl_fence(ptr, ptr)`);
      const f = B.tmp();
      B.line(`${f} = call zeroext i1 @scr_dyn_isl_fence(ptr %d, ptr ${host.cstr("iteration")})`);
      B.terminate(`ret ptr null`);
      B.startBlock(lNotJv);
    }
    const okA = B.tmp();
    const okS = B.tmp();
    const okB = B.tmp();
    const ok01 = B.tmp();
    const ok = B.tmp();
    B.line(`${okA} = icmp eq i32 ${kd}, ${DK.ARR}`);
    B.line(`${okS} = icmp eq i32 ${kd}, ${DK.STR}`);
    B.line(`${okB} = icmp eq i32 ${kd}, ${DK.BYTES}`);
    B.line(`${ok01} = or i1 ${okA}, ${okS}`);
    B.line(`${ok} = or i1 ${ok01}, ${okB}`);
    const lGo = B.newLabel("din.g");
    const lThrow = B.newLabel("din.t");
    B.condBr(ok, lGo, lThrow);
    // V8's exact not-iterable TypeError.
    B.startBlock(lThrow);
    const buf = "%dib";
    B.entryAllocas.push(`${buf} = alloca %ScrJsonBuf`);
    B.line(`call void @scr_jb_init(ptr ${buf})`);
    const lU = B.newLabel("din.u");
    const lN = B.newLabel("din.n");
    const lB2 = B.newLabel("din.b");
    const lNum = B.newLabel("din.m");
    const lF = B.newLabel("din.f");
    const lDef = B.newLabel("din.d");
    const lTail = B.newLabel("din.e");
    B.terminate(
      `switch i32 ${kd}, label %${lDef} [ i32 ${DK.UNDEF}, label %${lU} i32 ${DK.NULL}, label %${lN} i32 ${DK.BOOL}, label %${lB2} i32 ${DK.NUM}, label %${lNum} i32 ${DK.FUNC}, label %${lF} ]`,
    );
    B.startBlock(lU);
    this.puts(B, buf, "undefined");
    B.br(lTail);
    B.startBlock(lN);
    this.puts(B, buf, "object null");
    B.br(lTail);
    B.startBlock(lB2);
    {
      const bv = this.boolOf(B, "%d");
      const s = B.tmp();
      B.line(`${s} = select i1 ${bv}, ptr ${host.cstr("boolean true")}, ptr ${host.cstr("boolean false")}`);
      B.line(`call void @scr_jb_puts(ptr ${buf}, ptr ${s})`);
      B.br(lTail);
    }
    B.startBlock(lNum);
    {
      this.puts(B, buf, "number ");
      const x = this.payloadOf(B, "%d", "double");
      const s = B.tmp();
      B.line(`${s} = call ptr @scr_f64_to_scrstr(double ${x})`);
      this.putScrStr(B, buf, s);
      B.line(`call void @scr_str_release(ptr ${s})`);
      B.br(lTail);
    }
    B.startBlock(lF);
    this.puts(B, buf, "function");
    B.br(lTail);
    B.startBlock(lDef);
    this.puts(B, buf, "object");
    B.br(lTail);
    B.startBlock(lTail);
    this.puts(B, buf, " is not iterable (cannot read property Symbol(Symbol.iterator))");
    const msg = B.tmp();
    B.line(`${msg} = call ptr @scr_jb_finish(ptr ${buf})`);
    B.line(`call void @scr_throw_error(i32 1, ptr ${msg}) ; SCR_ERR_TYPE`);
    B.terminate(`ret ptr null`);
    B.startBlock(lGo);
    const out = B.tmp();
    B.line(`${out} = call ptr @scr_dyn_new_arr()`);
    this.i64Loop(B, "din", "%n", (i) => {
      const itemSlot = B.slot();
      B.entryAllocas.push(`${itemSlot} = alloca ptr`);
      const lArr = B.newLabel("din.ia");
      const lBy = B.newLabel("din.ib");
      const lStr = B.newLabel("din.is");
      const lPush = B.newLabel("din.ip");
      const lNotA = B.newLabel("din.na");
      B.condBr(okA, lArr, lNotA);
      B.startBlock(lNotA);
      B.condBr(okB, lBy, lStr);
      // ARR: item = i < len ? retain(items[i]) : retain(undefined)
      B.startBlock(lArr);
      {
        const n = this.lenOf(B, "%d");
        const inR = B.tmp();
        B.line(`${inR} = icmp ult i64 ${i}, ${n}`);
        const lHit = B.newLabel("din.ah");
        const lMiss = B.newLabel("din.am");
        B.condBr(inR, lHit, lMiss);
        B.startBlock(lHit);
        const items = this.itemsOf(B, "%d");
        const e = this.itemAt(B, items, i);
        const r = this.retainDyn(B, e);
        B.line(`store ptr ${r}, ptr ${itemSlot}`);
        B.br(lPush);
        B.startBlock(lMiss);
        const u = this.undef(B);
        const r2 = this.retainDyn(B, u);
        B.line(`store ptr ${r2}, ptr ${itemSlot}`);
        B.br(lPush);
      }
      // BYTES: by byte.
      B.startBlock(lBy);
      {
        const bts = this.payloadOf(B, "%d", "ptr");
        const blenp = B.tmp();
        const blen = B.tmp();
        B.line(`${blenp} = getelementptr inbounds i8, ptr ${bts}, i64 8 ; ->len`);
        B.line(`${blen} = load i64, ptr ${blenp}`);
        const inR = B.tmp();
        B.line(`${inR} = icmp ult i64 ${i}, ${blen}`);
        const lHit = B.newLabel("din.bh");
        const lMiss = B.newLabel("din.bm");
        B.condBr(inR, lHit, lMiss);
        B.startBlock(lHit);
        const bdatap = B.tmp();
        const bdata = B.tmp();
        B.line(`${bdatap} = getelementptr inbounds i8, ptr ${bts}, i64 24 ; ->data`);
        B.line(`${bdata} = load ptr, ptr ${bdatap}`);
        const bp = B.tmp();
        const bv = B.tmp();
        const bd = B.tmp();
        const r = B.tmp();
        B.line(`${bp} = getelementptr inbounds i8, ptr ${bdata}, i64 ${i}`);
        B.line(`${bv} = load i8, ptr ${bp}`);
        B.line(`${bd} = uitofp i8 ${bv} to double`);
        B.line(`${r} = call ptr @scr_dyn_new_num(double ${bd})`);
        B.line(`store ptr ${r}, ptr ${itemSlot}`);
        B.br(lPush);
        B.startBlock(lMiss);
        const u = this.undef(B);
        const r2 = this.retainDyn(B, u);
        B.line(`store ptr ${r2}, ptr ${itemSlot}`);
        B.br(lPush);
      }
      // STR: whole code POINTS (the string iterator, not charAt).
      B.startBlock(lStr);
      {
        host.declare(`declare double @scr_str_utf16_len(ptr)`);
        host.declare(`declare ptr @scr_str_cp_at(ptr, double)`);
        host.declare(`declare ptr @scr_dyn_new_str(ptr)`);
        const s = this.payloadOf(B, "%d", "ptr");
        const len = B.tmp();
        B.line(`${len} = call double @scr_str_utf16_len(ptr ${s})`);
        const atSlot = B.slot();
        const stepSlot = B.slot();
        B.entryAllocas.push(`${atSlot} = alloca double`, `${stepSlot} = alloca i64`);
        B.line(`store double ${f64Lit(0)}, ptr ${atSlot}`);
        B.line(`store i64 0, ptr ${stepSlot}`);
        const lc = B.newLabel("din.sc");
        const lb = B.newLabel("din.sb");
        const le = B.newLabel("din.se");
        B.br(lc);
        B.startBlock(lc);
        const st = B.tmp();
        const at = B.tmp();
        const c1 = B.tmp();
        const c2 = B.tmp();
        const cont = B.tmp();
        B.line(`${st} = load i64, ptr ${stepSlot}`);
        B.line(`${at} = load double, ptr ${atSlot}`);
        B.line(`${c1} = icmp ult i64 ${st}, ${i}`);
        B.line(`${c2} = fcmp olt double ${at}, ${len}`);
        B.line(`${cont} = and i1 ${c1}, ${c2}`);
        B.condBr(cont, lb, le);
        B.startBlock(lb);
        const cp = B.tmp();
        const cpl = B.tmp();
        const at2 = B.tmp();
        B.line(`${cp} = call ptr @scr_str_cp_at(ptr ${s}, double ${at})`);
        B.line(`${cpl} = call double @scr_str_utf16_len(ptr ${cp})`);
        B.line(`${at2} = fadd double ${at}, ${cpl}`);
        B.line(`store double ${at2}, ptr ${atSlot}`);
        B.line(`call void @scr_str_release(ptr ${cp})`);
        const st2 = B.tmp();
        B.line(`${st2} = add i64 ${st}, 1`);
        B.line(`store i64 ${st2}, ptr ${stepSlot}`);
        B.br(lc);
        B.startBlock(le);
        const atF = B.tmp();
        B.line(`${atF} = load double, ptr ${atSlot}`);
        const inR = B.tmp();
        B.line(`${inR} = fcmp olt double ${atF}, ${len}`);
        const lHit = B.newLabel("din.sh");
        const lMiss = B.newLabel("din.sm");
        B.condBr(inR, lHit, lMiss);
        B.startBlock(lHit);
        const cp2 = B.tmp();
        const r = B.tmp();
        B.line(`${cp2} = call ptr @scr_str_cp_at(ptr ${s}, double ${atF})`);
        B.line(`${r} = call ptr @scr_dyn_new_str(ptr ${cp2})`);
        B.line(`call void @scr_str_release(ptr ${cp2})`);
        B.line(`store ptr ${r}, ptr ${itemSlot}`);
        B.br(lPush);
        B.startBlock(lMiss);
        const u = this.undef(B);
        const r2 = this.retainDyn(B, u);
        B.line(`store ptr ${r2}, ptr ${itemSlot}`);
        B.br(lPush);
      }
      B.startBlock(lPush);
      const item = B.tmp();
      B.line(`${item} = load ptr, ptr ${itemSlot}`);
      B.line(`call void @scr_dyn_arr_push(ptr ${out}, ptr ${item}) ; push takes ownership`);
    });
    B.terminate(`ret ptr ${out}`);
    this.defs.push(
      `define internal ptr @${name}(ptr %d, i64 %n) ${FN_ATTRS} { ; destructuring GetIterator + N steps`,
      B.render(),
      `}`,
      ``,
    );
    return name;
  }

  /* ── the checked-dynamic function boundary (ported) ────────────────── */

  /** The dyn argument spelling of one static value: dyn passes through
   * (+1), funcs box anonymously, everything else rides toDyn. `expr` is
   * BORROWED in every arm. Emits into the given builder. */
  private toDynExpr(B: BlockBuilder, t: IrType, expr: string): string {
    if (t.kind === "dyn") return this.retainDyn(B, expr);
    if (t.kind === "func") {
      const box = this.dynFuncBoxHelper(t);
      const r = B.tmp();
      B.line(`${r} = call ptr @${box}(ptr ${expr}, ptr null, ptr null)`);
      return r;
    }
    if (t.kind === "jsval") {
      // An island value wraps by reference (scalar-normalizing) — the
      // jsval-returning callback shape of the routed-dispatch lane.
      this.host.declare(`declare ptr @scr_dyn_from_jsval(ptr)`);
      const r = B.tmp();
      B.line(`${r} = call ptr @scr_dyn_from_jsval(ptr ${expr})`);
      return r;
    }
    const r = B.tmp();
    B.line(`${r} = call ptr @${this.toDynHelper(t)}(${this.valTy(t)} ${expr})`);
    return r;
  }

  /** The call thunk for one closure signature: validate each dyn arg
   * into the declared param type, call through the closure, convert the
   * result back to a dyn value (+1). */
  dynFuncThunkHelper(t: IrType & { kind: "func" }): string {
    const key = typeKey(t);
    const existing = this.dynFuncThunks.get(key);
    if (existing) return existing;
    const name = `sc_dfk_${this.dynFuncThunks.size}`;
    this.dynFuncThunks.set(key, name);
    const host = this.host;
    const B = new BlockBuilder();
    const argNames: string[] = [];
    t.params.forEach((p, i) => {
      // JS arity: a missing argument IS the undefined dyn value.
      const adSlot = B.slot();
      B.entryAllocas.push(`${adSlot} = alloca ptr`);
      const has = B.tmp();
      B.line(`${has} = icmp ult i64 ${i}, %argc`);
      const lHas = B.newLabel("dfk.h");
      const lMiss = B.newLabel("dfk.m");
      const lj = B.newLabel("dfk.j");
      B.condBr(has, lHas, lMiss);
      B.startBlock(lHas);
      const ap = B.tmp();
      const av = B.tmp();
      B.line(`${ap} = getelementptr inbounds ptr, ptr %args, i64 ${i}`);
      B.line(`${av} = load ptr, ptr ${ap}`);
      B.line(`store ptr ${av}, ptr ${adSlot}`);
      B.br(lj);
      B.startBlock(lMiss);
      const u = this.undef(B);
      B.line(`store ptr ${u}, ptr ${adSlot}`);
      B.br(lj);
      B.startBlock(lj);
      const ad = B.tmp();
      B.line(`${ad} = load ptr, ptr ${adSlot}`);
      if (p.kind === "dyn") {
        argNames.push(this.retainDyn(B, ad));
      } else if (p.kind === "jsval") {
        // A checker-'any' param: the dyn argument enters the island —
        // wrapped cells unwrap by reference, data deep-copies, boxed
        // functions cross through the host shim; a kind with no crossing
        // throws the catchable TypeError (null + pending).
        host.declare(`declare ptr @scr_jsval_from_dyn(ptr)`);
        const a = B.tmp();
        B.line(`${a} = call ptr @scr_jsval_from_dyn(ptr ${ad})`);
        const isNull = B.tmp();
        B.line(`${isNull} = icmp eq ptr ${a}, null`);
        const lFail = B.newLabel("dfk.jf");
        const lOk = B.newLabel("dfk.jo");
        B.condBr(isNull, lFail, lOk);
        B.startBlock(lFail);
        t.params.slice(0, i).forEach((q, j) => {
          if (isRefCounted(q)) B.line(`call void ${releaseSym(host, q)}(ptr ${argNames[j]})`);
        });
        B.terminate(`ret ptr null`);
        B.startBlock(lOk);
        argNames.push(a);
      } else {
        const pathSlot = B.slot();
        B.entryAllocas.push(`${pathSlot} = alloca %ScrDynPath`);
        const pp = B.tmp();
        const kp2 = B.tmp();
        const ip = B.tmp();
        B.line(`${pp} = getelementptr inbounds %ScrDynPath, ptr ${pathSlot}, i64 0, i32 0`);
        B.line(`store ptr null, ptr ${pp}`);
        B.line(`${kp2} = getelementptr inbounds %ScrDynPath, ptr ${pathSlot}, i64 0, i32 1`);
        B.line(`store ptr null, ptr ${kp2}`);
        B.line(`${ip} = getelementptr inbounds %ScrDynPath, ptr ${pathSlot}, i64 0, i32 2`);
        B.line(`store i64 ${i}, ptr ${ip}`);
        const a = B.tmp();
        B.line(`${a} = call ${this.valTy(p)} @${this.dynCheckHelper(p)}(ptr ${ad}, ptr ${pathSlot})`);
        this.pendingBail(B, "dfk", () => {
          t.params.slice(0, i).forEach((q, j) => {
            if (isRefCounted(q)) B.line(`call void ${releaseSym(host, q)}(ptr ${argNames[j]})`);
          });
        }, "ptr null");
        argNames.push(a);
      }
    });
    // VARIADIC (rest-marked) signatures: one extra trailing dyn-array
    // param carries the call's arguments from index params.length on.
    let rest: string | null = null;
    if (t.rest) {
      host.declare(`declare ptr @scr_dyn_new_arr()`);
      host.declare(`declare void @scr_dyn_arr_push(ptr, ptr)`);
      rest = B.tmp();
      B.line(`${rest} = call ptr @scr_dyn_new_arr()`);
      const riSlot = B.slot();
      B.entryAllocas.push(`${riSlot} = alloca i64`);
      B.line(`store i64 ${t.params.length}, ptr ${riSlot}`);
      const lc = B.newLabel("dfk.rc");
      const lb = B.newLabel("dfk.rb");
      const le = B.newLabel("dfk.re");
      B.br(lc);
      B.startBlock(lc);
      const ri = B.tmp();
      const cont = B.tmp();
      B.line(`${ri} = load i64, ptr ${riSlot}`);
      B.line(`${cont} = icmp ult i64 ${ri}, %argc`);
      B.condBr(cont, lb, le);
      B.startBlock(lb);
      const ap = B.tmp();
      const av = B.tmp();
      B.line(`${ap} = getelementptr inbounds ptr, ptr %args, i64 ${ri}`);
      B.line(`${av} = load ptr, ptr ${ap}`);
      const rv = this.retainDyn(B, av);
      B.line(`call void @scr_dyn_arr_push(ptr ${rest}, ptr ${rv})`);
      const ri2 = B.tmp();
      B.line(`${ri2} = add i64 ${ri}, 1`);
      B.line(`store i64 ${ri2}, ptr ${riSlot}`);
      B.br(lc);
      B.startBlock(le);
    }
    // The closure CONSUMES its params (+1 each moved in).
    const fnp = B.tmp();
    const fn = B.tmp();
    B.line(`${fnp} = getelementptr inbounds %ScrClosure, ptr %c, i64 0, i32 1`);
    B.line(`${fn} = load ptr, ptr ${fnp}`);
    const retTy = t.ret.kind === "void" ? "void" : this.valTy(t.ret);
    const callArgs = [
      `ptr %c`,
      ...t.params.map((p, i) => `${this.valTy(p)} ${argNames[i]}`),
      ...(rest !== null ? [`ptr ${rest}`] : []),
    ].join(", ");
    if (t.ret.kind === "void") {
      B.line(`call void ${fn}(${callArgs})`);
      this.pendingBail(B, "dfkr", () => {}, "ptr null");
      const u = this.undef(B);
      const r = this.retainDyn(B, u);
      B.terminate(`ret ptr ${r}`);
    } else if (t.ret.kind === "dyn") {
      const r = B.tmp();
      B.line(`${r} = call ptr ${fn}(${callArgs})`);
      this.pendingBail(B, "dfkr", () => {}, "ptr null");
      B.terminate(`ret ptr ${r}`);
    } else {
      const r = B.tmp();
      B.line(`${r} = call ${retTy} ${fn}(${callArgs})`);
      this.pendingBail(B, "dfkr", () => {}, "ptr null");
      const out = this.toDynExpr(B, t.ret, r);
      if (isRefCounted(t.ret)) B.line(`call void ${releaseSym(host, t.ret)}(ptr ${r})`);
      B.terminate(`ret ptr ${out}`);
    }
    this.defs.push(
      `define internal ptr @${name}(ptr %c, ptr %args, i64 %argc) ${FN_ATTRS} { ; dyn call thunk for ${key}`,
      B.render(),
      `}`,
      ``,
    );
    return name;
  }

  /** The box builder dynFrom emits for one closure signature. */
  /** The box builder for a CARRIED function field whose signature has no dyn
   * call thunk — the LLVM twin of emit-walkers' stranded box. The field is
   * still boxed, so the object keeps the key and `"m" in v` answers what Node
   * answers; only CALLING it through the dyn side throws. Record fields only:
   * a bare function or a union arm keeps the compile-time fence. */
  strandedDynFuncBoxHelper(t: IrType & { kind: "func" }): string {
    const key = typeKey(t);
    const existing = this.strandedDynFuncBoxes.get(key);
    if (existing) return existing;
    const name = `sc_dfs_${this.strandedDynFuncBoxes.size}`;
    this.strandedDynFuncBoxes.set(key, name);
    const host = this.host;
    const thunk = `${name}_thunk`;
    // The message and its SC2009 code are the C twin's, built by the ONE
    // shared reason function so the two lanes cannot drift (emit-walkers.ts
    // has the note on why it carries a code and no bracket).
    const msg =
      `a '${key}' function carried into 'unknown' cannot be called through it: ` +
      strandedFuncReason(t, (id: string) => this.host.recordsById.get(id), (id: string) => this.host.unionsById.get(id));
    const msgLit = host.cstr(msg);
    host.declare(`declare void @scr_throw_error_msg_code(i32, ptr, i64, ptr)`);
    host.declare(`declare ptr @scr_closure_retain_v(ptr)`);
    host.declare(`declare ptr @scr_dyn_new_func_src(ptr, ptr, i32, ptr, ptr, ptr)`);
    this.defs.push(
      `define internal ptr @${thunk}(ptr %c, ptr %args, i64 %argc) ${FN_ATTRS} { ; stranded dyn call thunk for ${key}`,
      `entry:`,
      `  call void @scr_throw_error_msg_code(i32 1, ptr ${msgLit}, i64 ${Buffer.byteLength(msg, "utf8")}, ptr ${host.cstr("SC2009")})`,
      `  ret ptr null`,
      `}`,
      ``,
    );
    const sigLit = host.cstr(key);
    this.defs.push(
      `define internal ptr @${name}(ptr %v, ptr %fname, ptr %fsrc) ${FN_ATTRS} { ; box ${key} into dyn (uncallable)`,
      `entry:`,
      `  %c = call ptr @scr_closure_retain_v(ptr %v)`,
      `  %r = call ptr @scr_dyn_new_func_src(ptr %c, ptr @${thunk}, i32 ${t.params.length}, ptr ${sigLit}, ptr %fname, ptr %fsrc)`,
      `  ret ptr %r`,
      `}`,
      ``,
    );
    return name;
  }

  dynFuncBoxHelper(t: IrType & { kind: "func" }): string {
    const key = typeKey(t);
    const existing = this.dynFuncBoxes.get(key);
    if (existing) return existing;
    const name = `sc_dfb_${this.dynFuncBoxes.size}`;
    this.dynFuncBoxes.set(key, name);
    const host = this.host;
    const thunk = this.dynFuncThunkHelper(t);
    host.declare(`declare ptr @scr_closure_retain_v(ptr)`);
    host.declare(`declare ptr @scr_dyn_new_func_src(ptr, ptr, i32, ptr, ptr, ptr)`);
    const sigLit = host.cstr(key);
    this.defs.push(
      `define internal ptr @${name}(ptr %v, ptr %fname, ptr %fsrc) ${FN_ATTRS} { ; box ${key} into dyn`,
      `entry:`,
      `  %c = call ptr @scr_closure_retain_v(ptr %v)`,
      `  %r = call ptr @scr_dyn_new_func_src(ptr %c, ptr @${thunk}, i32 ${t.params.length}, ptr ${sigLit}, ptr %fname, ptr %fsrc)`,
      `  ret ptr %r`,
      `}`,
      ``,
    );
    return name;
  }

  /** The adapter closure body for one TARGET signature: caps[0] is an
   * untraced obj-box owning the dyn function value. */
  dynFuncAdapterHelper(t: IrType & { kind: "func" }): string {
    const key = typeKey(t);
    const existing = this.dynFuncAdapters.get(key);
    if (existing) return existing;
    const name = `sc_dfa_${this.dynFuncAdapters.size}`;
    this.dynFuncAdapters.set(key, name);
    const host = this.host;
    const B = new BlockBuilder();
    host.declare(`declare ptr @scr_box_get_ref(ptr)`);
    host.declare(`declare ptr @scr_dyn_call(ptr, ptr, i64, ptr)`);
    host.declare(`declare void @scr_dyn_release(ptr)`);
    const retTy = t.ret.kind === "void" ? "void" : this.valTy(t.ret);
    const dummy =
      t.ret.kind === "void" ? "void" : retTy === "double" ? `double ${f64Lit(0)}` : retTy === "i1" ? "i1 false" : "ptr null";
    const capp = B.tmp();
    const box = B.tmp();
    B.line(`${capp} = getelementptr inbounds %ScrClosure, ptr %sc_env, i64 1 ; caps[0]`);
    B.line(`${box} = load ptr, ptr ${capp}`);
    const fnv = B.tmp();
    B.line(`${fnv} = call ptr @scr_box_get_ref(ptr ${box}) ; +1`);
    // The adapter OWNS its params (closure ABI); each converts to a dyn
    // argument (borrowed by the conversion) and releases.
    let argsPtr = "null";
    const argVals: string[] = [];
    if (t.params.length > 0) {
      const arr = B.slot();
      B.entryAllocas.push(`${arr} = alloca [${t.params.length} x ptr]`);
      t.params.forEach((p, i) => {
        const v = this.toDynExpr(B, p, `%a${i}`);
        argVals.push(v);
        const slotp = B.tmp();
        B.line(`${slotp} = getelementptr inbounds [${t.params.length} x ptr], ptr ${arr}, i64 0, i64 ${i}`);
        B.line(`store ptr ${v}, ptr ${slotp}`);
        if (isRefCounted(p)) B.line(`call void ${releaseSym(host, p)}(ptr %a${i})`);
      });
      argsPtr = arr;
    }
    // The kind is FUNC by construction; `what` is unreachable — spelled
    // anyway (the C's "value").
    const r = B.tmp();
    B.line(`${r} = call ptr @scr_dyn_call(ptr ${fnv}, ptr ${argsPtr}, i64 ${t.params.length}, ptr ${host.cstr("value")})`);
    B.line(`call void @scr_dyn_release(ptr ${fnv})`);
    for (const v of argVals) B.line(`call void @scr_dyn_release(ptr ${v})`);
    this.pendingBail(B, "dfa", () => {}, dummy === "void" ? "void" : dummy);
    if (t.ret.kind === "void") {
      B.line(`call void @scr_dyn_release(ptr ${r})`);
      B.terminate(`ret void`);
    } else if (t.ret.kind === "dyn") {
      B.terminate(`ret ptr ${r}`);
    } else {
      // Validate the dyn result into the target's return type — a lying
      // wrapper throws the catchable TypeError here (path "$").
      const out = B.tmp();
      B.line(`${out} = call ${this.valTy(t.ret)} @${this.dynCheckHelper(t.ret)}(ptr ${r}, ptr null)`);
      B.line(`call void @scr_dyn_release(ptr ${r})`);
      B.terminate(`ret ${this.valTy(t.ret)} ${out}`);
    }
    const params = ["ptr %sc_env", ...t.params.map((p, i) => `${this.valTy(p)} %a${i}`)].join(", ");
    this.defs.push(
      `define internal ${retTy === "i1" ? "zeroext i1" : retTy} @${name}(${params}) ${FN_ATTRS} { ; dyn fn adapter to ${key}`,
      B.render(),
      `}`,
      ``,
    );
    return name;
  }
}
