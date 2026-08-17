/* `globalThis.WebSocket` — the emitted half.
 *
 * The frontend proved the shape (wsGlobalPlan); this file writes the C
 * that fills it. Five synthesized functions per construct-signature
 * type, interned like every other emitted thunk family:
 *
 *   sc_wsw_i    the ctor wrapper — dials, then BUILDS the API record
 *   sc_wsfc_i   the immortal closure that IS `globalThis.WebSocket`
 *               (one per program, so `===` between two reads holds)
 *   sc_wsd_i    the dispatch scr_ws_global.c calls back through
 *   sc_wsev_i   the event record it hands the listeners
 *   sc_wssnd_i / sc_wscls_i   the record's send/close methods
 *
 * OWNERSHIP, in both directions. The record owns send and close; both
 * closures share ONE box over the socket handle, so the last release of
 * the record tears the socket down. And the handle owns the record back
 * while the socket can still fire — that edge is what makes
 *
 *     socket.onopen = () => socket.send('hi')
 *
 * work with no other reference, exactly as it does in a browser. It is
 * a deliberate cycle, broken at the close event; the alternative (a weak
 * back-edge) was measured and loses that program to the collector.
 *
 * The universal call convention holds throughout: a callee OWNS the
 * arguments it is handed (+1) and releases them, and the event record
 * these thunks build moves into the listener the same way.
 */
import type { CEmitter } from "./emitter.js";
import {
  mangleField,
  mangleRecordNew,
  mangleRecordRelease,
  mangleRecordRetain,
  mangleRecordStruct,
  mangleWsClose,
  mangleWsCtorClosure,
  mangleWsCtorWrap,
  mangleWsDispatch,
  mangleWsEvent,
  mangleWsSend,
} from "../mangle.js";
import { cDecl, cType, releaseCallC } from "./emit-types.js";
import { OVERFLOW_MEMBER } from "./emit-shapes.js";
import { IrType, WsGlobalPlan, typeKey, wsGlobalPlan } from "../../ir/nodes.js";

/** The interned immortal closure symbol for one WebSocket construct
 * signature. The C expression at a use site is `(ScrClosure *)&<sym>`. */
export function wsGlobalCtorFor(E: CEmitter, t: IrType): string {
  const key = typeKey(t);
  const existing = E.wsCtors.get(key);
  if (existing !== undefined) return existing;
  const plan = wsGlobalPlan(t, (id) => E.recordsById.get(id), (id) => E.unionsById.get(id));
  if (plan === null || t.kind !== "func") {
    throw new Error("emitter bug: wsCtor whose type is not the WebSocket construct signature");
  }
  const i = E.wsCtors.size;
  const sym = mangleWsCtorClosure(i);
  E.wsCtors.set(key, sym);
  // A dialing/open socket holds the loop open, exactly like net.connect:
  // main must run the loop even in a program with no async function of
  // its own, or the handshake never gets a poll and the process exits
  // between the constructor and `open`.
  E.usesTimers = true;

  const names = {
    wrap: mangleWsCtorWrap(i),
    dispatch: mangleWsDispatch(i),
    event: mangleWsEvent(i),
    send: mangleWsSend(i),
    close: mangleWsClose(i),
    rec: mangleRecordStruct(plan.shapeId),
    ev: mangleRecordStruct(plan.event.shapeId),
  };

  const sendParams = `ScrClosure *sc_env, ${cDecl(plan.sendParam, "sc_a0")}`;
  const closeParams = ["ScrClosure *sc_env", ...plan.closeParams.map((p, n) => cDecl(p, `sc_a${n}`))]
    .join(", ");
  const ctorParams = ["ScrClosure *sc_env", ...t.params.map((p, n) => cDecl(p, `sc_a${n}`))]
    .join(", ");
  const evParams =
    `${names.rec} *sc_self, int sc_which, const uint8_t *sc_data, size_t sc_len, ` +
    `bool sc_is_text, int sc_code, const char *sc_text, size_t sc_tlen, bool sc_clean`;
  const dispatchParams =
    `void *sc_u, int sc_which, int sc_state, const uint8_t *sc_data, size_t sc_len, ` +
    `bool sc_is_text, int sc_code, const char *sc_text, size_t sc_tlen, bool sc_clean`;

  E.walkerProtos.push(
    `static ${names.ev} *${names.event}(${evParams});`,
    `static void ${names.dispatch}(${dispatchParams});`,
    `static void ${names.send}(${sendParams});`,
    `static void ${names.close}(${closeParams});`,
    `static ${cType(t.ret)}${names.wrap}(${ctorParams});`,
    // The interned immortal closure: the VALUE of globalThis.WebSocket,
    // one per program so `globalThis.WebSocket === globalThis.WebSocket`
    // is true the way it is in every runtime that has one.
    // Field list MIRRORS ScrClosure's — the runtime casts this to
    // ScrClosure * and writes through it (emitter.ts's note).
    `static struct { size_t rc; void *fn; size_t ncaps; ScrBox *props; void *implicit_proto; } ${sym} =`,
    `    { SIZE_MAX, (void *)&${names.wrap}, 0, NULL, NULL }; /* globalThis.WebSocket */`,
  );

  E.walkerDefs.push(
    ``,
    ...eventBuilder(E, plan, names.event, names.ev, evParams),
    ``,
    ...dispatcher(E, plan, names, dispatchParams),
    ``,
    ...sendMethod(plan, names.send, sendParams),
    ``,
    ...closeMethod(plan, names.close, closeParams),
    ``,
    ...ctorWrapper(E, plan, t, names, ctorParams),
    ``,
  );
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

/** The event record every listener receives. Fields the event in hand
 * does not carry hold their undefined arm — a close code on an `open`
 * event would be a value the program never had. */
function eventBuilder(
  E: CEmitter,
  plan: WsGlobalPlan,
  sym: string,
  ev: string,
  params: string,
): string[] {
  const lines = [`static ${ev} *${sym}(${params}) {`];
  const used = new Set(plan.event.fields.map((f) => f.name));
  if (!used.has("data")) lines.push(`  (void)sc_self; (void)sc_data; (void)sc_len; (void)sc_is_text;`);
  if (!used.has("code")) lines.push(`  (void)sc_code;`);
  if (!used.has("reason")) lines.push(`  (void)sc_text; (void)sc_tlen;`);
  if (!used.has("wasClean")) lines.push(`  (void)sc_clean;`);
  if (used.size === 0) lines.push(`  (void)sc_which;`);
  lines.push(`  ${ev} *sc_e = ${mangleRecordNew(plan.event.shapeId)}();`);
  for (const f of plan.event.fields) {
    const slot = `sc_e->${mangleField(f.name)}`;
    if (f.name === "data") {
      // Only a message carries data, and what it carries depends on the
      // live binaryType — the record's own field, which the program may
      // have written any time before the frame arrived.
      lines.push(
        `  ${slot} = sc_which == SCR_WSG_MESSAGE`,
        `      ? scr_ws_global_message_data(sc_self->${mangleField("binaryType")}, sc_data, sc_len, sc_is_text)`,
        `      : scr_dyn_undefined();`,
      );
      continue;
    }
    const absent = E.unitInstanceRef(f.unionId!, f.absentTag!);
    const tag = f.valueTag!;
    if (f.name === "code") {
      lines.push(
        `  ${slot} = sc_which == SCR_WSG_CLOSE ? scr_union_new_f64(${tag}, (double)sc_code) : ${absent};`,
      );
    } else if (f.name === "wasClean") {
      lines.push(
        `  ${slot} = sc_which == SCR_WSG_CLOSE ? scr_union_new_bool(${tag}, sc_clean) : ${absent};`,
      );
    } else {
      // reason: the close frame's, and only a close frame's. A browser
      // error Event carries no reason either — the message scr_ws_client
      // reports has no slot in this shape.
      lines.push(
        `  if (sc_which == SCR_WSG_CLOSE) {`,
        `    ScrStr *sc_rs = scr_str_new(sc_text != NULL ? sc_text : "", sc_text != NULL ? sc_tlen : 0);`,
        `    ${slot} = scr_union_new_ref(${tag}, sc_rs, &scr_str_retain_v, &scr_str_release_v, NULL);`,
        `  } else {`,
        `    ${slot} = ${absent};`,
        `  }`,
      );
    }
  }
  lines.push(`  return sc_e;`, `}`);
  return lines;
}

/** What scr_ws_global.c calls back through. Writes the live readyState
 * first (the record's slot is plain data — this is the only thing that
 * keeps it honest), then invokes the matching listener if one is set. */
function dispatcher(
  E: CEmitter,
  plan: WsGlobalPlan,
  names: WsNames,
  params: string,
): string[] {
  const lines = [
    `static void ${names.dispatch}(${params}) {`,
    `  ${names.rec} *sc_self = (${names.rec} *)sc_u;`,
    `  sc_self->${mangleField("readyState")} = (double)sc_state;`,
    `  switch (sc_which) {`,
  ];
  const arm: Record<string, string> = {
    onopen: "SCR_WSG_OPEN",
    onmessage: "SCR_WSG_MESSAGE",
    onclose: "SCR_WSG_CLOSE",
    onerror: "SCR_WSG_ERROR",
  };
  for (const h of plan.handlers) {
    const evStruct = names.ev;
    lines.push(
      `    case ${arm[h.field]!}: {`,
      `      ScrUnion *sc_h = sc_self->${mangleField(h.field)};`,
      `      if (sc_h == NULL || sc_h->tag != ${h.fnTag}) return;`,
      // Retained across the call: a listener that reassigns its own slot
      // (the self-detaching handler) would otherwise release the closure
      // out from under the invocation.
      `      ScrClosure *sc_cb = scr_closure_retain((ScrClosure *)scr_union_peek(sc_h));`,
      `      ${evStruct} *sc_e = ${names.event}(sc_self, sc_which, sc_data, sc_len, sc_is_text, sc_code, sc_text, sc_tlen, sc_clean);`,
      // A fence inside the event build (binaryType 'blob') leaves the
      // exception pending: deliver nothing rather than a wrong payload.
      `      if (scr_exc_pending()) {`,
      `        ${mangleRecordRelease(plan.event.shapeId)}(sc_e);`,
      `        scr_closure_release(sc_cb);`,
      `        return;`,
      `      }`,
      `      ((void (*)(ScrClosure *, ${evStruct} *))sc_cb->fn)(sc_cb, sc_e);`,
      `      scr_closure_release(sc_cb);`,
      `      return;`,
      `    }`,
    );
  }
  lines.push(
    // SCR_WSG_STATE: the readyState write above is the whole event.
    `    default: return;`,
    `  }`,
    `}`,
  );
  void E;
  return lines;
}

/** `socket.send(data)`. The handle rides the shared box in caps[0]. */
function sendMethod(plan: WsGlobalPlan, sym: string, params: string): string[] {
  const lines = [
    `static void ${sym}(${params}) {`,
    `  ScrWsGlobal *sc_g = (ScrWsGlobal *)scr_box_get_ref(sc_env->caps[0]);`,
  ];
  const call = (t: IrType, expr: string): string =>
    t.kind === "string"
      ? `scr_ws_global_send_str(sc_g, ${expr});`
      : `scr_ws_global_send_bytes(sc_g, ${expr});`;
  const p = plan.sendParam;
  if (p.kind === "union") {
    lines.push(`  switch (sc_a0->tag) {`);
    plan.sendArms.forEach((armT, tag) => {
      lines.push(
        `    case ${tag}: ${call(armT, `(${armT.kind === "string" ? "ScrStr" : "ScrBytes"} *)scr_union_peek(sc_a0)`)} break;`,
      );
    });
    lines.push(`    default: break;`, `  }`);
  } else {
    lines.push(`  ${call(p, "sc_a0")}`);
  }
  lines.push(
    `  scr_ws_global_release_v(sc_g);`,
    `  ${releaseCallC(p, "sc_a0")};`,
    `}`,
  );
  return lines;
}

/** `socket.close(code?, reason?)`. Argument validation lives in the
 * runtime unit, where the WHATWG rules are written down once. */
function closeMethod(plan: WsGlobalPlan, sym: string, params: string): string[] {
  const lines = [
    `static void ${sym}(${params}) {`,
    `  ScrWsGlobal *sc_g = (ScrWsGlobal *)scr_box_get_ref(sc_env->caps[0]);`,
    `  bool sc_has = false;`,
    `  double sc_code = 0;`,
    `  ScrStr *sc_reason = NULL;`,
  ];
  plan.closeParams.forEach((p, n) => {
    const isCode = n === 0;
    if (p.kind === "union") {
      const layout = plan.closeArms[n]!;
      lines.push(
        `  if (sc_a${n}->tag != ${layout.absentTag}) {`,
        isCode
          ? `    sc_has = true; sc_code = scr_union_get_f64(sc_a${n});`
          : `    sc_reason = (ScrStr *)scr_union_peek(sc_a${n});`,
        `  }`,
      );
    } else if (isCode) {
      lines.push(`  sc_has = true; sc_code = sc_a${n};`);
    } else {
      lines.push(`  sc_reason = sc_a${n};`);
    }
  });
  lines.push(`  scr_ws_global_close(sc_g, sc_has, sc_code, sc_reason);`, `  scr_ws_global_release_v(sc_g);`);
  plan.closeParams.forEach((p, n) => {
    lines.push(`  ${releaseCallC(p, `sc_a${n}`)};`);
  });
  lines.push(`}`);
  return lines;
}

/** `new WebSocket(url, protocols?, options?)`: dial, then build the API
 * record.
 *
 * THE THIRD ARGUMENT IS IGNORED, and that is not a shortcut — it is what
 * the oracle does. Measured against Node v25.9.0 on zapo's own ctor type,
 * dialing a header-recording server:
 *
 *     new WS(url, undefined, { headers: { Cookie: 'x' } })   no Cookie
 *     new WS(url, { headers: { Cookie: 'x' } })              Cookie SENT
 *
 * Node's global WebSocket takes (url, protocols|init) and drops a third
 * argument on the floor exactly as a browser does. So a program that puts
 * headers in position three loses them on BOTH runtimes; refusing it here
 * would refuse a program the oracle accepts.
 *
 * The SECOND-position init bag is the one that carries meaning, and it is
 * lowered (wsInitBagPlan): `protocols` reads like the plain argument and
 * `headers` becomes the block scr_ws_build_request appends. A bag with a
 * field this unit cannot honour -- a live `dispatcher` or `agent` -- still
 * takes the deferred fence, tested at runtime, because an undefined one is
 * lowerable and a real one is not. */
function ctorWrapper(
  E: CEmitter,
  plan: WsGlobalPlan,
  t: IrType & { kind: "func" },
  names: WsNames,
  params: string,
): string[] {
  const lines = [`static ${cType(t.ret)}${names.wrap}(${params}) {`, `  (void)sc_env;`];
  for (let n = 2; n < t.params.length; n++) {
    lines.push(
      `  /* the options bag: a browser WebSocket has no third parameter */`,
      `  ${releaseCallC(t.params[n]!, `sc_a${n}`)};`,
    );
  }

  // `protocols` → the Sec-WebSocket-Protocol header value, and (from the
  // init bag only) `headers` → the extra request block.
  lines.push(`  ScrStr *sc_proto = NULL;`, `  ScrStr *sc_hdrs = NULL;`);
  const protoT = plan.protocolsParam;
  if (protoT !== undefined) {
    // The arm's BODY, with no `break` of its own: the caller adds one
    // where a switch is what it is nested in.
    const armBody = (kind: string, expr: string, ind: string): string[] => {
      switch (kind) {
        case "absent":
          return [];
        case "string":
          return [`${ind}sc_proto = scr_str_retain((ScrStr *)${expr});`];
        case "strArray":
          return [
            // ", " and not ",": undici joins the list that way, and the
            // header value goes out on the wire verbatim.
            `${ind}{ ScrStr *sc_sep = scr_str_new(", ", 2);`,
            `${ind}  sc_proto = scr_arr_join((ScrArr *)${expr}, sc_sep);`,
            `${ind}  scr_str_release(sc_sep); }`,
          ];
        case "init":
          return initBagBody(plan, expr, ind);
        default:
          return [`${ind}${refuseC(FENCE_MSG)}`];
      }
    };
    const armLines = (kind: string, expr: string): string[] => [
      ...armBody(kind, expr, "      "),
      `      break;`,
    ];
    if (protoT.kind === "union") {
      lines.push(`  switch (sc_a1->tag) {`);
      plan.protocolsArms.forEach((k, tag) => {
        lines.push(`    case ${tag}:`, ...armLines(k, "scr_union_peek(sc_a1)"));
      });
      lines.push(`    default: break;`, `  }`);
    } else {
      lines.push(`  {`, ...armBody(plan.protocolsArms[0]!, "sc_a1", "    "), `  }`);
    }
    lines.push(`  ${releaseCallC(protoT, "sc_a1")};`);
  }

  lines.push(
    `  if (scr_exc_pending()) {`,
    `    scr_str_release(sc_a0);`,
    `    scr_str_release(sc_proto);`,
    `    scr_str_release(sc_hdrs);`,
    `    return NULL;`,
    `  }`,
    `  ScrWsGlobal *sc_g = scr_ws_global_new(sc_a0, sc_proto, sc_hdrs, &${names.dispatch});`,
    `  scr_str_release(sc_a0);`,
    `  scr_str_release(sc_proto);`,
    `  scr_str_release(sc_hdrs);`,
    `  if (sc_g == NULL) return NULL; /* a bad URL / non-ws scheme: pending */`,
    `  ${names.rec} *sc_r = ${mangleRecordNew(plan.shapeId)}();`,
    // "blob" is the API's default binaryType, in browsers and in Node.
    `  sc_r->${mangleField("binaryType")} = (ScrStr *)&${E.internLiteral("blob")};`,
    `  sc_r->${mangleField("readyState")} = 0; /* CONNECTING */`,
  );
  for (const h of plan.handlers) {
    lines.push(`  sc_r->${mangleField(h.field)} = ${E.unitInstanceRef(h.unionId, h.absentTag)};`);
  }
  lines.push(
    // ONE box over the handle, shared by both methods: the socket dies
    // with the last of them, which is the last reference to the record.
    `  ScrBox *sc_b = scr_box_new_obj(&scr_ws_global_retain_v, &scr_ws_global_release_v, NULL);`,
    `  scr_box_set_ref(sc_b, sc_g);`,
    `  sc_r->${mangleField("send")} = scr_closure_new((void *)&${names.send}, 1);`,
    `  sc_r->${mangleField("send")}->caps[0] = scr_box_retain(sc_b);`,
    `  sc_r->${mangleField("close")} = scr_closure_new((void *)&${names.close}, 1);`,
    `  sc_r->${mangleField("close")}->caps[0] = scr_box_retain(sc_b);`,
    `  scr_box_release(sc_b);`,
    // The back-edge, taken LAST: callbacks cannot fire before this
    // returns to the loop, so the record is complete when they do. The
    // handle takes a STRONG reference — a dialing socket is reachable
    // from the platform in JS, so a program whose only reference is the
    // handler cycle must not be collected out from under the handshake.
    `  scr_ws_global_set_user(sc_g, sc_r, &${mangleRecordRetain(plan.shapeId)}_v, &${mangleRecordRelease(plan.shapeId)}_v);`,
    `  return sc_r;`,
    `}`,
  );
  return lines;
}

/** The deferred refusal's text. It is the ONE refusal the backend raises
 * on its own, so it has no diagnostic and no source location — see the
 * note at the foot of this file. */
const FENCE_MSG =
  "the 'ws' package's option-bag second argument to a WebSocket constructor has no " +
  "scriptc lowering yet -- globalThis.WebSocket takes (url, protocols)";

/** The same refusal, narrowed to the one field that earned it: a bag whose
 * `dispatcher`/`agent` is undefined lowers, and only a live one refuses.
 *
 * REACH (block/all24, read off zapo's own control flow at
 * src/transport/WaWebSocket.ts:525-575, not inferred from a run): the two
 * fields are NOT symmetric, and only one of them is reachable HERE.
 * Arriving at the init-bag construct requires `socketRuntime === 'node'`
 * (the first conjunct of the `:554` guard).  But `:546` is
 * `if (socketRuntime === 'node' && agent) { … return new nodeWsCtor(url,
 * protocols, { headers, agent }) }` — the real `ws` package's THREE-argument
 * form, which has already returned.  So there is no execution of that
 * program in which `agent` is truthy and the `agent` test below runs:
 * `agent` is dead at this site, `dispatcher` is live (an undici dispatcher
 * with no agent passes :546, satisfies :554, reaches :565).  Both measured
 * x0 across three paired runs because none configured a proxy.
 * estado-todas24.md §3.10 and §4. */
function initFieldMsg(field: string): string {
  return (
    `the 'ws' package's option-bag second argument to a WebSocket constructor carries ` +
    `'${field}', which has no scriptc lowering yet -- only protocols and headers do`
  );
}

/* CENSUS: this refusal is emitted in the BACKEND, so it has no diagnostic and
 * no source location to tag with — it carries a code and no `[SCxxxx at
 * file:line]`, and no bracket-keyed census contains it.  Two of them sit in
 * zapo's WebSocket dial (the `agent` and `dispatcher` options) and fire on a
 * VALUE rather than on a construct, so they are dark until a user configures
 * a proxy.  `scripts/tu-census.mjs` counts them by host (`sc_wsw_N`).
 */
function refuseC(msg: string): string {
  return `scr_throw_error_msg_code(SCR_ERR_ERROR, ${cStr(msg)}, ${msg.length}, "SC2020");`;
}

/** The init bag unfolded: refuse what cannot be honoured, then read the
 * bag's `protocols` and `headers` into the two locals the dial takes. */
function initBagBody(plan: WsGlobalPlan, expr: string, ind: string): string[] {
  const ib = plan.initBag;
  if (ib === undefined || ib === null) return [`${ind}${refuseC(FENCE_MSG)}`];
  const rec = mangleRecordStruct(ib.shapeId);
  const out = [`${ind}{ ${rec} *sc_ib = (${rec} *)${expr};`];
  const b = `${ind}  `;
  for (const r of ib.refuseIfPresent) {
    const slot = `sc_ib->${mangleField(r.name)}`;
    const present = r.kind === "dyn" ? `scr_dyn_truthy(${slot})` : `${slot}->tag != ${r.absentTag!}`;
    out.push(`${b}if (${present}) { ${refuseC(initFieldMsg(r.name))} }`);
  }
  if (ib.refuseIfPresent.length > 0) out.push(`${b}if (!scr_exc_pending()) {`);
  const c = ib.refuseIfPresent.length > 0 ? `${b}  ` : b;
  if (ib.protocols !== null) {
    const slot = `sc_ib->${mangleField("protocols")}`;
    if (ib.protocols.unionId !== undefined) {
      out.push(`${c}switch (${slot}->tag) {`);
      ib.protocols.arms.forEach((k, tag) => {
        out.push(`${c}  case ${tag}:`, ...bagProtoArm(k, `scr_union_peek(${slot})`, `${c}    `), `${c}    break;`);
      });
      out.push(`${c}  default: break;`, `${c}}`);
    } else {
      out.push(...bagProtoArm(ib.protocols.arms[0]!, slot, c));
    }
  }
  if (ib.headers !== null) {
    const slot = `sc_ib->${mangleField("headers")}`;
    const hrec = mangleRecordStruct(ib.headers.recShapeId);
    out.push(
      `${c}if (${slot}->tag == ${ib.headers.valueTag}) {`,
      `${c}  sc_hdrs = scr_ws_headers_block(((${hrec} *)scr_union_peek(${slot}))->${OVERFLOW_MEMBER});`,
      `${c}}`,
    );
  }
  if (ib.refuseIfPresent.length > 0) out.push(`${b}}`);
  out.push(`${ind}}`);
  return out;
}

/** The bag's own `protocols` arm — the same three shapes the plain second
 * argument takes, read out of a struct slot instead of the parameter. */
function bagProtoArm(kind: string, expr: string, ind: string): string[] {
  switch (kind) {
    case "string":
      return [`${ind}sc_proto = scr_str_retain((ScrStr *)${expr});`];
    case "strArray":
      return [
        `${ind}{ ScrStr *sc_sep = scr_str_new(", ", 2);`,
        `${ind}  sc_proto = scr_arr_join((ScrArr *)${expr}, sc_sep);`,
        `${ind}  scr_str_release(sc_sep); }`,
      ];
    default:
      return [];
  }
}

/** A C string literal for an ASCII diagnostic message. */
function cStr(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
          // The only refusal the BACKEND raises on its own, and therefore
          // the only one with neither a diagnostic nor a source location:
          // it is untagged (no "[SCxxxx at file:line]"), so the zapo trap
          // census cannot see it, and the SITE census has nothing to see
          // even in principle -- this wrapper is interned PER CONSTRUCT
          // SIGNATURE TYPE and shared by every `new` site, so there is no
          // one location to name. SCRIPTC_TRAP_TRACE does observe it:
          // scr_error.c filters on the SC-numeric code, not on the tag.
          // Giving it a location needs one plumbed here; that is a design
          // question, not a patch.
          //
          // Since wsInitBagPlan it is no longer the shape zapo dials with:
          // zapo's bag is `{ protocols, headers, dispatcher, agent }` with
          // the last two undefined, which lowers. What is left in zapo's
          // TU is the two runtime `refuseIfPresent` tests -- a bag that
          // really carries a proxy -- and a bag no plan can account for.
          // RE-MEASURED at 5d8e2103 (estado-inventory section 4). The
          // paragraph above is right and the count it implies is now
          // measured: zapo's TU carries exactly TWO throws from this
          // function, the 'dispatcher' and 'agent' refuseIfPresent tests,
          // and ZERO of the generic FENCE_MSG. With lower-exprs.ts's
          // EventEmitter 'emit'-as-a-value fence that makes THREE untagged
          // refusals in the TU, not the two an earlier note recorded.
