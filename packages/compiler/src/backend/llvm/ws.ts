/* `globalThis.WebSocket` on the LLVM tier — the .ll mirror of
 * backend/emission/emit-ws.ts.
 *
 * The frontend proved the shape (wsGlobalPlan, ir/nodes.ts); the two
 * backends fill it. Both synthesize the SAME five functions per
 * construct-signature type, call the SAME scr_ws_global entry points in
 * the same order, and intern the SAME one-per-program immortal closure
 * so `globalThis.WebSocket === globalThis.WebSocket` holds:
 *
 *   sc_wsw_i    the ctor wrapper — dials, then BUILDS the API record
 *   sc_wsfc_i   the immortal closure that IS `globalThis.WebSocket`
 *   sc_wsd_i    the dispatch scr_ws_global.c calls back through
 *   sc_wsev_i   the event record it hands the listeners
 *   sc_wssnd_i / sc_wscls_i   the record's send/close methods
 *
 * The C emitter writes those as C text and lets clang lay the structs
 * out; here the layout is the emitter's own — record fields are GEPs at
 * `i32 <index + 1>` past the i64 rc, ScrUnion's tag is field 1 and its
 * payload slot field 5, and a ScrClosure's caps ride immediately past
 * the struct. Nothing else differs, and the ownership rules below are
 * emit-ws.ts's, restated because they are the part a port gets wrong:
 *
 * OWNERSHIP, in both directions. The record owns send and close; both
 * closures share ONE box over the socket handle, so the last release of
 * the record tears the socket down. And the handle owns the record back
 * while the socket can still fire — that edge is what makes
 *
 *     socket.onopen = () => socket.send('hi')
 *
 * work with no other reference, exactly as it does in a browser. It is a
 * deliberate cycle, broken at the close event.
 *
 * The universal call convention holds throughout: a callee OWNS the
 * arguments it is handed (+1) and releases them, and the event record
 * these thunks build moves into the listener the same way.
 */
import type { IrRecordShape, IrType, IrUnionDef, WsGlobalPlan } from "../../ir/nodes.js";
import { isRefCounted, typeKey, wsGlobalPlan } from "../../ir/nodes.js";
import {
  mangleWsClose,
  mangleWsCtorClosure,
  mangleWsCtorWrap,
  mangleWsDispatch,
  mangleWsEvent,
  mangleWsSend,
  mangleRecordNew,
  mangleRecordStruct,
} from "../mangle.js";
import { FN_ATTRS, llFieldType, releaseSym, vAdapters, type ShapeHost } from "./shapes.js";

/** What this lowering needs from the emitter beyond the shape tables. */
export interface WsHost extends ShapeHost {
  readonly unionsById: Map<string, IrUnionDef>;
  /** typeKey(construct signature) → the immortal closure's `@sym`. */
  readonly wsCtors: Map<string, string>;
  llTypeOf(t: IrType): string;
  /** The interned immortal ScrStr for a literal — `@`-ref. */
  internLiteral(text: string): string;
  /** The interned NUL-terminated byte constant — `@`-ref. */
  cstr(text: string): string;
  unitInstanceRef(unionId: string, tag: number): string;
  /** Emit @sc_retain_box (scr_box_retain is a static inline in C). */
  needRetainBox(): void;
  /** A dialing socket holds the loop open: main must run it. */
  markUsesTimers(): void;
  pushThunkDefs(lines: readonly string[]): void;
}

/* SCR_WSG_* — scr_ws_global.h. */
const WSG_OPEN = 0;
const WSG_MESSAGE = 1;
const WSG_CLOSE = 2;
const WSG_ERROR = 3;

/** The dispatch's C parameter list, as LLVM. Mirrors ScrWsGlobalFire:
 * `void (*)(void *, int, int, const uint8_t *, size_t, bool, int,
 *           const char *, size_t, bool)`. */
const FIRE_PARAMS =
  "ptr %u, i32 %which, i32 %state, ptr %data, i64 %len, i1 zeroext %istext, " +
  "i32 %code, ptr %text, i64 %tlen, i1 zeroext %clean";
/** The same tail, as arguments — what the dispatch forwards to the event
 * builder (which takes the record in place of `state`). */
const EV_PARAMS =
  "ptr %self, i32 %which, ptr %data, i64 %len, i1 zeroext %istext, " +
  "i32 %code, ptr %text, i64 %tlen, i1 zeroext %clean";
const EV_ARGS =
  "i32 %which, ptr %data, i64 %len, i1 zeroext %istext, " +
  "i32 %code, ptr %text, i64 %tlen, i1 zeroext %clean";

/** A tiny line/temp/label builder — these bodies are written directly
 * rather than through the statement emitter, exactly like the resolve
 * thunks and the bound-method trampolines beside them. */
class Ir {
  readonly lines: string[] = [];
  private n = 0;
  tmp(): string {
    return `%w${this.n++}`;
  }
  lbl(base: string): string {
    return `${base}${this.n++}`;
  }
  line(s: string): void {
    this.lines.push(`  ${s}`);
  }
  label(l: string): void {
    this.lines.push(`${l}:`);
  }
}

/** The interned immortal closure symbol for one WebSocket construct
 * signature. The `.ll` expression at a use site is that `@sym` — the
 * global IS the ScrClosure, as it is for a declared function used as a
 * value (mangleFnClosure). */
export function wsGlobalCtorFor(host: WsHost, t: IrType): string {
  const key = typeKey(t);
  const existing = host.wsCtors.get(key);
  if (existing !== undefined) return existing;
  const plan = wsGlobalPlan(
    t,
    (id) => host.recordsById.get(id),
    (id) => host.unionsById.get(id),
  );
  if (plan === null || t.kind !== "func") {
    throw new Error("llvm emitter bug: wsCtor whose type is not the WebSocket construct signature");
  }
  const i = host.wsCtors.size;
  const sym = `@${mangleWsCtorClosure(i)}`;
  host.wsCtors.set(key, sym);
  host.markUsesTimers();

  const names = {
    wrap: mangleWsCtorWrap(i),
    dispatch: mangleWsDispatch(i),
    event: mangleWsEvent(i),
    send: mangleWsSend(i),
    close: mangleWsClose(i),
    rec: mangleRecordStruct(plan.shapeId),
    ev: mangleRecordStruct(plan.event.shapeId),
  };

  host.pushThunkDefs([
    ``,
    ...eventBuilder(host, plan, names),
    ``,
    ...dispatcher(host, plan, names),
    ``,
    ...sendMethod(host, plan, names),
    ``,
    ...closeMethod(host, plan, names),
    ``,
    ...ctorWrapper(host, plan, t, names),
    // The interned immortal closure: the VALUE of globalThis.WebSocket,
    // one per program. Field for field ScrClosure's — rc SIZE_MAX so
    // retain and release are both no-ops, no captures, no props.
    `${sym} = internal global %ScrClosure { i64 -1, ptr @${names.wrap}, i64 0, ptr null, ptr null } ; globalThis.WebSocket`,
    ``,
  ]);
  return sym;
}

interface WsNames {
  wrap: string;
  dispatch: string;
  event: string;
  send: string;
  close: string;
  rec: string;
  ev: string;
}

/** A record shape's field slot index: the i64 rc occupies 0. */
function fieldIdx(host: WsHost, shapeId: string, name: string): number {
  const shape: IrRecordShape | undefined = host.recordsById.get(shapeId);
  if (!shape) throw new Error(`llvm emitter bug: unknown record shape ${shapeId}`);
  const i = shape.fields.findIndex((f) => f.name === name);
  if (i < 0) throw new Error(`llvm emitter bug: unknown field ${name} on shape ${shapeId}`);
  return i + 1;
}

/** The event record every listener receives. Fields the event in hand
 * does not carry hold their undefined arm — a close code on an `open`
 * event would be a value the program never had. */
function eventBuilder(host: WsHost, plan: WsGlobalPlan, names: WsNames): string[] {
  const B = new Ir();
  B.line(`%e = call ptr @${mangleRecordNew(plan.event.shapeId)}()`);
  for (const f of plan.event.fields) {
    const slot = B.tmp();
    const idx = fieldIdx(host, plan.event.shapeId, f.name);
    const ty = llFieldType(f.type);
    if (f.name === "data") {
      // Only a message carries data, and what it carries depends on the
      // live binaryType — the record's own field, which the program may
      // have written any time before the frame arrived.
      host.declare(`declare ptr @scr_ws_global_message_data(ptr, ptr, i64, i1 zeroext)`);
      host.declare(`declare ptr @scr_dyn_undefined()`);
      const yes = B.lbl("dmsg");
      const no = B.lbl("dund");
      const end = B.lbl("dend");
      const c = B.tmp();
      const btp = B.tmp();
      const bt = B.tmp();
      const v1 = B.tmp();
      const v2 = B.tmp();
      const v = B.tmp();
      B.line(`${c} = icmp eq i32 %which, ${WSG_MESSAGE}`);
      B.line(`br i1 ${c}, label %${yes}, label %${no}`);
      B.label(yes);
      B.line(
        `${btp} = getelementptr inbounds %${names.rec}, ptr %self, i64 0, i32 ${fieldIdx(host, plan.shapeId, "binaryType")}`,
      );
      B.line(`${bt} = load ptr, ptr ${btp}`);
      B.line(
        `${v1} = call ptr @scr_ws_global_message_data(ptr ${bt}, ptr %data, i64 %len, i1 zeroext %istext)`,
      );
      B.line(`br label %${end}`);
      B.label(no);
      B.line(`${v2} = call ptr @scr_dyn_undefined()`);
      B.line(`br label %${end}`);
      B.label(end);
      B.line(`${v} = phi ptr [ ${v1}, %${yes} ], [ ${v2}, %${no} ]`);
      B.line(`${slot} = getelementptr inbounds %${names.ev}, ptr %e, i64 0, i32 ${idx}`);
      B.line(`store ${ty} ${v}, ptr ${slot}`);
      continue;
    }
    const absent = host.unitInstanceRef(f.unionId!, f.absentTag!);
    const tag = f.valueTag!;
    const yes = B.lbl("cyes");
    const no = B.lbl("cno");
    const end = B.lbl("cend");
    const c = B.tmp();
    const v1 = B.tmp();
    const v = B.tmp();
    B.line(`${c} = icmp eq i32 %which, ${WSG_CLOSE}`);
    B.line(`br i1 ${c}, label %${yes}, label %${no}`);
    B.label(yes);
    if (f.name === "code") {
      host.declare(`declare ptr @scr_union_new_f64(i32, double)`);
      const d = B.tmp();
      B.line(`${d} = sitofp i32 %code to double`);
      B.line(`${v1} = call ptr @scr_union_new_f64(i32 ${tag}, double ${d})`);
    } else if (f.name === "wasClean") {
      host.declare(`declare ptr @scr_union_new_bool(i32, i1 zeroext)`);
      B.line(`${v1} = call ptr @scr_union_new_bool(i32 ${tag}, i1 zeroext %clean)`);
    } else {
      // reason: the close frame's, and only a close frame's. A browser
      // error Event carries no reason either — the message
      // scr_ws_client reports has no slot in this shape.
      host.declare(`declare ptr @scr_str_new(ptr, i64)`);
      host.declare(`declare ptr @scr_union_new_ref(i32, ptr, ptr, ptr, ptr)`);
      host.declare(`declare ptr @scr_str_retain_v(ptr)`);
      host.declare(`declare void @scr_str_release_v(ptr)`);
      const has = B.tmp();
      const tp = B.tmp();
      const tl = B.tmp();
      const rs = B.tmp();
      B.line(`${has} = icmp ne ptr %text, null`);
      B.line(`${tp} = select i1 ${has}, ptr %text, ptr ${host.cstr("")}`);
      B.line(`${tl} = select i1 ${has}, i64 %tlen, i64 0`);
      B.line(`${rs} = call ptr @scr_str_new(ptr ${tp}, i64 ${tl})`);
      B.line(
        `${v1} = call ptr @scr_union_new_ref(i32 ${tag}, ptr ${rs}, ptr @scr_str_retain_v, ptr @scr_str_release_v, ptr null)`,
      );
    }
    B.line(`br label %${end}`);
    B.label(no);
    B.line(`br label %${end}`);
    B.label(end);
    B.line(`${v} = phi ptr [ ${v1}, %${yes} ], [ ${absent}, %${no} ]`);
    B.line(`${slot} = getelementptr inbounds %${names.ev}, ptr %e, i64 0, i32 ${idx}`);
    B.line(`store ${ty} ${v}, ptr ${slot}`);
  }
  B.line(`ret ptr %e`);
  return [
    `define internal ptr @${names.event}(${EV_PARAMS}) ${FN_ATTRS} { ; the listeners' event record`,
    `entry:`,
    ...B.lines,
    `}`,
  ];
}

/** What scr_ws_global.c calls back through. Writes the live readyState
 * first (the record's slot is plain data — this is the only thing that
 * keeps it honest), then invokes the matching listener if one is set. */
function dispatcher(host: WsHost, plan: WsGlobalPlan, names: WsNames): string[] {
  host.declare(`declare ptr @scr_closure_retain_v(ptr)`);
  host.declare(`declare void @scr_closure_release(ptr)`);
  host.declare(`declare zeroext i1 @scr_exc_pending()`);
  const B = new Ir();
  const rsp = B.tmp();
  const st = B.tmp();
  B.line(
    `${rsp} = getelementptr inbounds %${names.rec}, ptr %u, i64 0, i32 ${fieldIdx(host, plan.shapeId, "readyState")}`,
  );
  B.line(`${st} = sitofp i32 %state to double`);
  B.line(`store double ${st}, ptr ${rsp}`);
  const arm: Record<string, number> = {
    onopen: WSG_OPEN,
    onmessage: WSG_MESSAGE,
    onclose: WSG_CLOSE,
    onerror: WSG_ERROR,
  };
  const out = `wsout`;
  const entries = plan.handlers.map((h) => ({ h, lbl: B.lbl("harm") }));
  B.line(
    `switch i32 %which, label %${out} [ ` +
      entries.map((e) => `i32 ${arm[e.h.field]!}, label %${e.lbl}`).join(" ") +
      ` ]`,
  );
  for (const { h, lbl } of entries) {
    const chk = B.lbl("hchk");
    const go = B.lbl("hgo");
    const drop = B.lbl("hdrop");
    const call = B.lbl("hcall");
    const hp = B.tmp();
    const hv = B.tmp();
    const isnull = B.tmp();
    const tp = B.tmp();
    const tv = B.tmp();
    const ok = B.tmp();
    const pp = B.tmp();
    const pv = B.tmp();
    const cb = B.tmp();
    const ev = B.tmp();
    const pend = B.tmp();
    const fnp = B.tmp();
    const fn = B.tmp();
    B.label(lbl);
    B.line(
      `${hp} = getelementptr inbounds %${names.rec}, ptr %u, i64 0, i32 ${fieldIdx(host, plan.shapeId, h.field)}`,
    );
    B.line(`${hv} = load ptr, ptr ${hp}`);
    B.line(`${isnull} = icmp eq ptr ${hv}, null`);
    B.line(`br i1 ${isnull}, label %${out}, label %${chk}`);
    B.label(chk);
    B.line(`${tp} = getelementptr inbounds %ScrUnion, ptr ${hv}, i64 0, i32 1`);
    B.line(`${tv} = load i32, ptr ${tp}`);
    B.line(`${ok} = icmp eq i32 ${tv}, ${h.fnTag}`);
    B.line(`br i1 ${ok}, label %${go}, label %${out}`);
    B.label(go);
    B.line(`${pp} = getelementptr inbounds %ScrUnion, ptr ${hv}, i64 0, i32 5`);
    B.line(`${pv} = load ptr, ptr ${pp}`);
    // Retained across the call: a listener that reassigns its own slot
    // (the self-detaching handler) would otherwise release the closure
    // out from under the invocation.
    B.line(`${cb} = call ptr @scr_closure_retain_v(ptr ${pv})`);
    B.line(`${ev} = call ptr @${names.event}(ptr %u, ${EV_ARGS})`);
    // A fence inside the event build (binaryType 'blob') leaves the
    // exception pending: deliver nothing rather than a wrong payload.
    B.line(`${pend} = call zeroext i1 @scr_exc_pending()`);
    B.line(`br i1 ${pend}, label %${drop}, label %${call}`);
    B.label(drop);
    B.line(`call void ${releaseSym(host, { kind: "record", shapeId: plan.event.shapeId })}(ptr ${ev})`);
    B.line(`call void @scr_closure_release(ptr ${cb})`);
    B.line(`br label %${out}`);
    B.label(call);
    B.line(`${fnp} = getelementptr inbounds %ScrClosure, ptr ${cb}, i64 0, i32 1`);
    B.line(`${fn} = load ptr, ptr ${fnp}`);
    B.line(`call void ${fn}(ptr ${cb}, ptr ${ev})`);
    B.line(`call void @scr_closure_release(ptr ${cb})`);
    B.line(`br label %${out}`);
  }
  // SCR_WSG_STATE: the readyState write above is the whole event.
  B.label(out);
  B.line(`ret void`);
  return [
    `define internal void @${names.dispatch}(${FIRE_PARAMS}) ${FN_ATTRS} { ; scr_ws_global dispatch`,
    `entry:`,
    ...B.lines,
    `}`,
  ];
}

/** The socket handle out of the shared box in caps[0] — +1, balanced by
 * the release at the end of each method. */
function handleFromEnv(host: WsHost, B: Ir): string {
  host.declare(`declare ptr @scr_box_get_ref(ptr)`);
  host.declare(`declare void @scr_ws_global_release_v(ptr)`);
  const capsp = B.tmp();
  const bx = B.tmp();
  const g = B.tmp();
  B.line(`${capsp} = getelementptr inbounds %ScrClosure, ptr %env, i64 1 ; caps`);
  B.line(`${bx} = load ptr, ptr ${capsp}`);
  B.line(`${g} = call ptr @scr_box_get_ref(ptr ${bx}) ; +1`);
  return g;
}

/** `socket.send(data)`. The handle rides the shared box in caps[0]. */
function sendMethod(host: WsHost, plan: WsGlobalPlan, names: WsNames): string[] {
  host.declare(`declare void @scr_ws_global_send_str(ptr, ptr)`);
  host.declare(`declare void @scr_ws_global_send_bytes(ptr, ptr)`);
  const B = new Ir();
  const g = handleFromEnv(host, B);
  const p = plan.sendParam;
  const fin = B.lbl("sfin");
  const sendCall = (armT: IrType, expr: string): string =>
    armT.kind === "string"
      ? `call void @scr_ws_global_send_str(ptr ${g}, ptr ${expr})`
      : `call void @scr_ws_global_send_bytes(ptr ${g}, ptr ${expr})`;
  if (p.kind === "union") {
    const tp = B.tmp();
    const tv = B.tmp();
    const arms = plan.sendArms.map((armT, tag) => ({ armT, tag, lbl: B.lbl("sarm") }));
    B.line(`${tp} = getelementptr inbounds %ScrUnion, ptr %a0, i64 0, i32 1`);
    B.line(`${tv} = load i32, ptr ${tp}`);
    B.line(
      `switch i32 ${tv}, label %${fin} [ ` + arms.map((a) => `i32 ${a.tag}, label %${a.lbl}`).join(" ") + ` ]`,
    );
    for (const a of arms) {
      const pp = B.tmp();
      const pv = B.tmp();
      B.label(a.lbl);
      B.line(`${pp} = getelementptr inbounds %ScrUnion, ptr %a0, i64 0, i32 5`);
      B.line(`${pv} = load ptr, ptr ${pp}`);
      B.line(sendCall(a.armT, pv));
      B.line(`br label %${fin}`);
    }
  } else {
    B.line(sendCall(p, "%a0"));
    B.line(`br label %${fin}`);
  }
  B.label(fin);
  B.line(`call void @scr_ws_global_release_v(ptr ${g})`);
  if (isRefCounted(p)) B.line(`call void ${releaseSym(host, p)}(ptr %a0) ; the callee owns its +1 param`);
  B.line(`ret void`);
  return [
    `define internal void @${names.send}(ptr %env, ${host.llTypeOf(p)} %a0) ${FN_ATTRS} { ; socket.send`,
    `entry:`,
    ...B.lines,
    `}`,
  ];
}

/** `socket.close(code?, reason?)`. Argument validation lives in the
 * runtime unit, where the WHATWG rules are written down once. */
function closeMethod(host: WsHost, plan: WsGlobalPlan, names: WsNames): string[] {
  host.declare(`declare void @scr_ws_global_close(ptr, i1 zeroext, double, ptr)`);
  const B = new Ir();
  const g = handleFromEnv(host, B);
  // The C locals, as slots: the arms below write them from several
  // blocks, and mem2reg puts them back in registers.
  B.line(`%hasp = alloca i1`);
  B.line(`%codep = alloca double`);
  B.line(`%reasp = alloca ptr`);
  B.line(`store i1 false, ptr %hasp`);
  B.line(`store double 0x0000000000000000, ptr %codep`);
  B.line(`store ptr null, ptr %reasp`);
  plan.closeParams.forEach((p, n) => {
    const isCode = n === 0;
    if (p.kind === "union") {
      const layout = plan.closeArms[n]!;
      const use = B.lbl("cuse");
      const skip = B.lbl("cskip");
      const tp = B.tmp();
      const tv = B.tmp();
      const isabs = B.tmp();
      B.line(`${tp} = getelementptr inbounds %ScrUnion, ptr %a${n}, i64 0, i32 1`);
      B.line(`${tv} = load i32, ptr ${tp}`);
      B.line(`${isabs} = icmp eq i32 ${tv}, ${layout!.absentTag}`);
      B.line(`br i1 ${isabs}, label %${skip}, label %${use}`);
      B.label(use);
      if (isCode) {
        host.declare(`declare double @scr_union_get_f64(ptr)`);
        const d = B.tmp();
        B.line(`${d} = call double @scr_union_get_f64(ptr %a${n})`);
        B.line(`store i1 true, ptr %hasp`);
        B.line(`store double ${d}, ptr %codep`);
      } else {
        const pp = B.tmp();
        const pv = B.tmp();
        B.line(`${pp} = getelementptr inbounds %ScrUnion, ptr %a${n}, i64 0, i32 5`);
        B.line(`${pv} = load ptr, ptr ${pp}`);
        B.line(`store ptr ${pv}, ptr %reasp`);
      }
      B.line(`br label %${skip}`);
      B.label(skip);
    } else if (isCode) {
      B.line(`store i1 true, ptr %hasp`);
      B.line(`store double %a${n}, ptr %codep`);
    } else {
      B.line(`store ptr %a${n}, ptr %reasp`);
    }
  });
  const has = B.tmp();
  const cd = B.tmp();
  const rs = B.tmp();
  B.line(`${has} = load i1, ptr %hasp`);
  B.line(`${cd} = load double, ptr %codep`);
  B.line(`${rs} = load ptr, ptr %reasp`);
  B.line(`call void @scr_ws_global_close(ptr ${g}, i1 zeroext ${has}, double ${cd}, ptr ${rs})`);
  B.line(`call void @scr_ws_global_release_v(ptr ${g})`);
  plan.closeParams.forEach((p, n) => {
    if (isRefCounted(p)) B.line(`call void ${releaseSym(host, p)}(ptr %a${n})`);
  });
  B.line(`ret void`);
  const params = ["ptr %env", ...plan.closeParams.map((p, n) => `${host.llTypeOf(p)} %a${n}`)].join(", ");
  return [
    `define internal void @${names.close}(${params}) ${FN_ATTRS} { ; socket.close`,
    `entry:`,
    ...B.lines,
    `}`,
  ];
}

/** The deferred refusal's text, shared with emit-ws.ts byte for byte: the
 * two backends must refuse the same program with the same message. */
const FENCE_MSG =
  "the 'ws' package's option-bag second argument to a WebSocket constructor has no " +
  "scriptc lowering yet -- globalThis.WebSocket takes (url, protocols)";

function initFieldMsg(field: string): string {
  return (
    `the 'ws' package's option-bag second argument to a WebSocket constructor carries ` +
    `'${field}', which has no scriptc lowering yet -- only protocols and headers do`
  );
}

/** The init bag unfolded on the LLVM tier, arm for arm with
 * emit-ws.ts's initBagBody: refuse what cannot be honoured, then read the
 * bag's `protocols` and `headers`. `expr` is the bag record pointer.
 * Leaves control flow on an open block, as every arm here must. */
function initBagArm(
  host: WsHost,
  B: Ir,
  plan: WsGlobalPlan,
  expr: string,
  storeProto: (kind: string, e: string) => void,
  refuse: (msg: string) => void,
): void {
  const ib = plan.initBag;
  if (ib === undefined || ib === null) {
    refuse(FENCE_MSG);
    return;
  }
  const rec = mangleRecordStruct(ib.shapeId);
  const slot = (name: string): string => {
    const p = B.tmp();
    B.line(
      `${p} = getelementptr inbounds %${rec}, ptr ${expr}, i64 0, i32 ${fieldIdx(host, ib.shapeId, name)}`,
    );
    const v = B.tmp();
    B.line(`${v} = load ptr, ptr ${p}`);
    return v;
  };
  const unionTag = (u: string): string => {
    const p = B.tmp();
    const v = B.tmp();
    B.line(`${p} = getelementptr inbounds %ScrUnion, ptr ${u}, i64 0, i32 1`);
    B.line(`${v} = load i32, ptr ${p}`);
    return v;
  };
  const unionPayload = (u: string): string => {
    const p = B.tmp();
    const v = B.tmp();
    B.line(`${p} = getelementptr inbounds %ScrUnion, ptr ${u}, i64 0, i32 5`);
    B.line(`${v} = load ptr, ptr ${p}`);
    return v;
  };
  const done = B.lbl("bagdone");

  for (const r of ib.refuseIfPresent) {
    const v = slot(r.name);
    const cond = B.tmp();
    if (r.kind === "dyn") {
      host.declare(`declare zeroext i1 @scr_dyn_truthy(ptr)`);
      B.line(`${cond} = call zeroext i1 @scr_dyn_truthy(ptr ${v})`);
    } else {
      B.line(`${cond} = icmp ne i32 ${unionTag(v)}, ${r.absentTag!}`);
    }
    const bad = B.lbl("bagbad");
    const ok = B.lbl("bagok");
    B.line(`br i1 ${cond}, label %${bad}, label %${ok}`);
    B.label(bad);
    refuse(initFieldMsg(r.name));
    B.line(`br label %${done}`);
    B.label(ok);
  }

  if (ib.protocols !== null) {
    const v = slot("protocols");
    if (ib.protocols.unionId !== undefined) {
      const merge = B.lbl("bagpm");
      const arms = ib.protocols.arms.map((kind, tag) => ({ kind, tag, lbl: B.lbl("bagparm") }));
      B.line(
        `switch i32 ${unionTag(v)}, label %${merge} [ ` +
          arms.map((a) => `i32 ${a.tag}, label %${a.lbl}`).join(" ") +
          ` ]`,
      );
      for (const a of arms) {
        B.label(a.lbl);
        if (a.kind !== "absent") storeProto(a.kind, unionPayload(v));
        B.line(`br label %${merge}`);
      }
      B.label(merge);
    } else {
      storeProto(ib.protocols.arms[0]!, v);
    }
  }

  if (ib.headers !== null) {
    host.declare(`declare ptr @scr_ws_headers_block(ptr)`);
    const hrShape = host.recordsById.get(ib.headers.recShapeId);
    if (!hrShape) throw new Error(`llvm emitter bug: unknown record shape ${ib.headers.recShapeId}`);
    const hrec = mangleRecordStruct(ib.headers.recShapeId);
    const v = slot("headers");
    const cond = B.tmp();
    B.line(`${cond} = icmp eq i32 ${unionTag(v)}, ${ib.headers.valueTag}`);
    const yes = B.lbl("baghdr");
    const merge = B.lbl("baghm");
    B.line(`br i1 ${cond}, label %${yes}, label %${merge}`);
    B.label(yes);
    const recp = unionPayload(v);
    const ovfp = B.tmp();
    const ovf = B.tmp();
    const blk = B.tmp();
    // The overflow ScrMap sits one past the declared fields, past the rc.
    B.line(
      `${ovfp} = getelementptr inbounds %${hrec}, ptr ${recp}, i64 0, i32 ${hrShape.fields.length + 1}`,
    );
    B.line(`${ovf} = load ptr, ptr ${ovfp}`);
    B.line(`${blk} = call ptr @scr_ws_headers_block(ptr ${ovf})`);
    B.line(`store ptr ${blk}, ptr %hdrsp`);
    B.line(`br label %${merge}`);
    B.label(merge);
  }

  B.line(`br label %${done}`);
  B.label(done);
}

/** `new WebSocket(url, protocols?, options?)`: dial, then build the API
 * record. The THIRD argument is ignored — Node's own global WebSocket
 * ignores it too (measured against v25.9.0: headers in position three
 * never reach the wire, on either runtime), so dropping it is agreement
 * with the oracle rather than a shortcut. The SECOND-position init bag is
 * the overload that carries meaning and it is lowered here, arm for arm
 * with emit-ws.ts; a bag with a live `dispatcher`/`agent` still takes the
 * deferred fence. */
function ctorWrapper(
  host: WsHost,
  plan: WsGlobalPlan,
  t: IrType & { kind: "func" },
  names: WsNames,
): string[] {
  host.declare(`declare ptr @scr_ws_global_new(ptr, ptr, ptr, ptr)`);
  host.declare(`declare void @scr_ws_global_set_user(ptr, ptr, ptr, ptr)`);
  host.declare(`declare ptr @scr_ws_global_retain_v(ptr)`);
  host.declare(`declare void @scr_ws_global_release_v(ptr)`);
  host.declare(`declare ptr @scr_box_new_obj(ptr, ptr, ptr)`);
  host.declare(`declare void @scr_box_set_ref(ptr, ptr)`);
  host.declare(`declare void @scr_box_release(ptr)`);
  host.declare(`declare ptr @scr_closure_new(ptr, i64)`);
  host.declare(`declare void @scr_str_release(ptr)`);
  host.declare(`declare zeroext i1 @scr_exc_pending()`);
  host.needRetainBox();

  const B = new Ir();
  // The options bag: a browser WebSocket has no third parameter.
  for (let n = 2; n < t.params.length; n++) {
    const p = t.params[n]!;
    if (isRefCounted(p)) B.line(`call void ${releaseSym(host, p)}(ptr %a${n})`);
  }
  B.line(`%protop = alloca ptr`);
  B.line(`store ptr null, ptr %protop`);
  B.line(`%hdrsp = alloca ptr`);
  B.line(`store ptr null, ptr %hdrsp`);

  const refuse = (msg: string): void => {
    host.declare(`declare void @scr_throw_error_msg_code(i32, ptr, i64, ptr)`);
    B.line(
      `call void @scr_throw_error_msg_code(i32 0, ptr ${host.cstr(msg)}, i64 ${msg.length}, ptr ${host.cstr("SC2020")})`,
    );
  };

  // `protocols` → the Sec-WebSocket-Protocol header value.
  const protoT = plan.protocolsParam;
  if (protoT !== undefined) {
    const done = B.lbl("pdone");
    const storeProto = (kind: string, expr: string): void => {
      if (kind === "string") {
        host.declare(`declare ptr @scr_str_retain_v(ptr)`);
        const r = B.tmp();
        B.line(`${r} = call ptr @scr_str_retain_v(ptr ${expr})`);
        B.line(`store ptr ${r}, ptr %protop`);
        return;
      }
      if (kind === "strArray") {
        // ", " and not ",": undici joins the list that way, and the
        // header value goes out on the wire verbatim.
        host.declare(`declare ptr @scr_str_new(ptr, i64)`);
        host.declare(`declare ptr @scr_arr_join(ptr, ptr)`);
        const sep = B.tmp();
        const j = B.tmp();
        B.line(`${sep} = call ptr @scr_str_new(ptr ${host.cstr(", ")}, i64 2)`);
        B.line(`${j} = call ptr @scr_arr_join(ptr ${expr}, ptr ${sep})`);
        B.line(`store ptr ${j}, ptr %protop`);
        B.line(`call void @scr_str_release(ptr ${sep})`);
      }
    };
    const armLines = (kind: string, expr: string): void => {
      switch (kind) {
        case "absent":
          break;
        case "string":
        case "strArray":
          storeProto(kind, expr);
          break;
        case "init":
          initBagArm(host, B, plan, expr, storeProto, refuse);
          break;
        default:
          refuse(FENCE_MSG);
          break;
      }
    };
    if (protoT.kind === "union") {
      const tp = B.tmp();
      const tv = B.tmp();
      const arms = plan.protocolsArms.map((kind, tag) => ({ kind, tag, lbl: B.lbl("parm") }));
      B.line(`${tp} = getelementptr inbounds %ScrUnion, ptr %a1, i64 0, i32 1`);
      B.line(`${tv} = load i32, ptr ${tp}`);
      B.line(
        `switch i32 ${tv}, label %${done} [ ` + arms.map((a) => `i32 ${a.tag}, label %${a.lbl}`).join(" ") + ` ]`,
      );
      for (const a of arms) {
        B.label(a.lbl);
        const pp = B.tmp();
        const pv = B.tmp();
        if (a.kind !== "absent") {
          B.line(`${pp} = getelementptr inbounds %ScrUnion, ptr %a1, i64 0, i32 5`);
          B.line(`${pv} = load ptr, ptr ${pp}`);
        }
        armLines(a.kind, pv);
        B.line(`br label %${done}`);
      }
    } else {
      armLines(plan.protocolsArms[0]!, "%a1");
      B.line(`br label %${done}`);
    }
    B.label(done);
    if (isRefCounted(protoT)) B.line(`call void ${releaseSym(host, protoT)}(ptr %a1)`);
  }

  const pend = B.tmp();
  const thrown = B.lbl("wthrew");
  const dial = B.lbl("wdial");
  const pr1 = B.tmp();
  const hd1 = B.tmp();
  B.line(`${pend} = call zeroext i1 @scr_exc_pending()`);
  B.line(`br i1 ${pend}, label %${thrown}, label %${dial}`);
  B.label(thrown);
  B.line(`${pr1} = load ptr, ptr %protop`);
  B.line(`${hd1} = load ptr, ptr %hdrsp`);
  B.line(`call void @scr_str_release(ptr %a0)`);
  B.line(`call void @scr_str_release(ptr ${pr1})`);
  B.line(`call void @scr_str_release(ptr ${hd1})`);
  B.line(`ret ptr null`);
  B.label(dial);
  const pr = B.tmp();
  const hd = B.tmp();
  const g = B.tmp();
  const bad = B.tmp();
  const nourl = B.lbl("wnourl");
  const build = B.lbl("wbuild");
  B.line(`${pr} = load ptr, ptr %protop`);
  B.line(`${hd} = load ptr, ptr %hdrsp`);
  B.line(`${g} = call ptr @scr_ws_global_new(ptr %a0, ptr ${pr}, ptr ${hd}, ptr @${names.dispatch})`);
  B.line(`call void @scr_str_release(ptr %a0)`);
  B.line(`call void @scr_str_release(ptr ${pr})`);
  B.line(`call void @scr_str_release(ptr ${hd})`);
  // A bad URL / non-ws scheme: pending.
  B.line(`${bad} = icmp eq ptr ${g}, null`);
  B.line(`br i1 ${bad}, label %${nourl}, label %${build}`);
  B.label(nourl);
  B.line(`ret ptr null`);
  B.label(build);

  const rec = B.tmp();
  B.line(`${rec} = call ptr @${mangleRecordNew(plan.shapeId)}()`);
  const store = (field: string, ty: string, value: string): void => {
    const p = B.tmp();
    B.line(
      `${p} = getelementptr inbounds %${names.rec}, ptr ${rec}, i64 0, i32 ${fieldIdx(host, plan.shapeId, field)}`,
    );
    B.line(`store ${ty} ${value}, ptr ${p}`);
  };
  // "blob" is the API's default binaryType, in browsers and in Node.
  store("binaryType", "ptr", host.internLiteral("blob"));
  store("readyState", "double", "0x0000000000000000"); // CONNECTING
  for (const h of plan.handlers) store(h.field, "ptr", host.unitInstanceRef(h.unionId, h.absentTag));

  // ONE box over the handle, shared by both methods: the socket dies
  // with the last of them, which is the last reference to the record.
  const box = B.tmp();
  B.line(
    `${box} = call ptr @scr_box_new_obj(ptr @scr_ws_global_retain_v, ptr @scr_ws_global_release_v, ptr null)`,
  );
  B.line(`call void @scr_box_set_ref(ptr ${box}, ptr ${g}) ; the +1 from the dial moves in`);
  for (const [field, fn] of [["send", names.send], ["close", names.close]] as const) {
    const cl = B.tmp();
    const capsp = B.tmp();
    const held = B.tmp();
    B.line(`${cl} = call ptr @scr_closure_new(ptr @${fn}, i64 1)`);
    B.line(`${capsp} = getelementptr inbounds %ScrClosure, ptr ${cl}, i64 1 ; caps`);
    B.line(`${held} = call ptr @sc_retain_box(ptr ${box})`);
    B.line(`store ptr ${held}, ptr ${capsp}`);
    store(field, "ptr", cl);
  }
  B.line(`call void @scr_box_release(ptr ${box})`);
  // The back-edge, taken LAST: callbacks cannot fire before this returns
  // to the loop, so the record is complete when they do. The handle takes
  // a STRONG reference — a dialing socket is reachable from the platform
  // in JS, so a program whose only reference is the handler cycle must
  // not be collected out from under the handshake.
  const rc = vAdapters(host, t.ret);
  B.line(
    `call void @scr_ws_global_set_user(ptr ${g}, ptr ${rec}, ptr ${rc.retain}, ptr ${rc.release})`,
  );
  B.line(`ret ptr ${rec}`);

  const params = ["ptr %env", ...t.params.map((p, n) => `${host.llTypeOf(p)} %a${n}`)].join(", ");
  return [
    `define internal ${host.llTypeOf(t.ret)} @${names.wrap}(${params}) ${FN_ATTRS} { ; new WebSocket(...)`,
    `entry:`,
    ...B.lines,
    `}`,
  ];
}
