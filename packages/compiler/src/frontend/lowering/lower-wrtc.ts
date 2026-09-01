/* lower-wrtc.ts — the WebRTC peer-connection and data-channel surface.
 *
 * Stage 1 gave these two types a representation and refused every member by
 * name (`SC2020 'RTCPeerConnection.createDataChannel' has no scriptc
 * lowering yet`). This lowers the SYNCHRONOUS half of that surface onto
 * scr_wrtc.c, so a compiled binary constructs a peer connection, creates a
 * data channel, and answers every property zapo reads.
 *
 * WHAT IS DELIBERATELY STILL REFUSED. Nothing here touches the network. The
 * offer/answer exchange, the event handlers, and `send` all still refuse by
 * name, because the ICE/DTLS/SCTP machinery proved elsewhere in this clause
 * is not wired into the event loop yet. A member that answered plausibly
 * without a transport behind it would be a WRONG answer replacing an honest
 * refusal, which is strictly worse.
 *
 * THE VALUES ARE CAPTURED, NOT SPECIFIED. Every string these lower to was
 * read off node v25.9.0 running @roamhq/wrtc 0.10
 * (tests/perf/wrtc/oracle/). Two contradict the WebRTC specification and the
 * oracle wins, because the oracle is what the differential scores against:
 * `binaryType` defaults to "arraybuffer" rather than "blob", and
 * `readyState` after `close()` is "closing" rather than "closed".
 */

import * as ts from "../ts7/adapter.js";
import type { IrExpr, IrStmt } from "../../ir/nodes.js";
import type { IrLibFn, IrType, SrcLoc } from "../../ir/nodes.js";
import { BOOL, BYTES_U8, F64, RTCDATACHANNEL_T, RTCPEERCONNECTION_T, STRING, VOID, typeEquals } from "../../ir/nodes.js";
import { locOf } from "../program.js";
import type { Lowerer } from "./lowerer.js";

/** `new wrtc.RTCPeerConnection(config)`. Claimed by the RESULT TYPE, the
 * `lowerSqliteNew` arrangement, so it runs before lower-classes.ts's
 * "constructing values other than classes declared in the program". */
export function lowerWrtcNew(L: Lowerer, expr: ts.NewExpression): IrExpr | null {
  const t = L.mapTypeOf(L.typeOf(expr));
  if (t?.kind !== "rtcPeerConnection") return null;
  const loc = locOf(expr);
  const args = expr.arguments ?? ([] as unknown as ts.NodeArray<ts.Expression>);

  /* The configuration is accepted and IGNORED, which is honest for exactly
   * one shape: an absent config, or `{ iceServers: [] }` with an empty
   * array. zapo writes the latter. A NON-EMPTY iceServers list asks for
   * STUN/TURN gathering that does not exist, so it refuses by name rather
   * than being silently dropped -- silently ignoring a TURN server is how a
   * connection fails with no diagnostic. */
  if (args.length > 1) {
    L.noLowering("new RTCPeerConnection with more than one argument", expr,
      "the constructor takes an optional configuration record");
  }
  if (args.length === 1) {
    const cfg = args[0]!;
    if (!ts.isObjectLiteralExpression(cfg)) {
      L.noLowering("new RTCPeerConnection with a computed configuration", cfg,
        "the configuration must be an object literal, so iceServers can be " +
        "checked at compile time");
    } else {
      for (const prop of cfg.properties) {
        if (!ts.isPropertyAssignment(prop) || prop.name === undefined) continue;
        const key = ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)
          ? prop.name.text
          : null;
        if (key !== "iceServers") continue;
        const v = prop.initializer;
        const empty = ts.isArrayLiteralExpression(v) && v.elements.length === 0;
        if (!empty) {
          L.noLowering("new RTCPeerConnection with a non-empty iceServers list", v,
            "STUN and TURN candidate gathering have no lowering yet; only an " +
            "empty iceServers list (host candidates) is served");
        }
      }
    }
  }
  return { kind: "libCall", fn: "wrtc.newPeer", args: [], type: RTCPEERCONNECTION_T, loc };
}

/* The members that have no lowering, each refused BY NAME with the reason.
 * Declaring them in ambient/scriptc-wrtc.d.ts is what makes these read
 * "has no scriptc lowering yet" instead of "property does not exist". */
/* The one reason both tables share. */
const HANDLER_READ =
  "reading an event handler back has no lowering (assigning one does); the " +
  "slot holds a closure, and there is no function value to answer with";

const PC_NO_LOWERING: Record<string, string | undefined> = {
  createAnswer: "this side is the offerer; answering has no lowering " +
    "(zapo synthesises its answer in TypeScript and calls setRemoteDescription)",
  addIceCandidate: "trickle ICE has no lowering yet",
  restartIce: "ICE restart has no lowering yet",
  /* Reading back a description is not on zapo's 21-member surface, and
   * serving it would mean minting a `RTCSessionDescriptionInit | null`
   * from C. Refused by name rather than half-served. */
  localDescription: "reading back the local description has no lowering yet " +
    "(createOffer answers the same SDP)",
  remoteDescription: "reading back the remote description has no lowering yet",
  onnegotiationneeded: "renegotiation has no lowering (one offer, one answer, " +
    "and no track ever changes)",
  onicecandidate: "trickle ICE has no lowering yet",
  /* THE ONE THAT WOULD FAIL SILENTLY. zapo reaches ondatachannel through
   * `(pc as any)`, so no type error names it; if it simply never fired,
   * conn.incomingChannels would stay empty and nothing would say why.
   * The SCTP unit is the OFFERER and does not accept an inbound DCEP
   * OPEN, so this refuses loudly instead. */
  ondatachannel: "inbound data channels have no lowering: the SCTP unit is " +
    "offerer-only and does not accept an inbound DCEP DATA_CHANNEL_OPEN",
  /* These four ASSIGN (lowerWrtcWrite serves them); READING one back has
   * no lowering, because the handler slot holds a closure and there is no
   * function value to hand out. */
  oniceconnectionstatechange: HANDLER_READ,
  onicegatheringstatechange: HANDLER_READ,
  onsignalingstatechange: HANDLER_READ,
  onconnectionstatechange: HANDLER_READ,
};

const DC_NO_LOWERING: Record<string, string | undefined> = {
  onopen: HANDLER_READ,
  onclose: HANDLER_READ,
  onerror: HANDLER_READ,
  onmessage: HANDLER_READ,
  onbufferedamountlow: "the buffered-amount events have no lowering: this " +
    "channel sends straight to the association and never buffers",
  bufferedAmountLowThreshold: "the buffered-amount threshold has no lowering yet",
  /* The oracle's `id` is uninitialised memory read as a double -- a
   * different denormal on every run. The specification says null until the
   * channel is negotiated. Refused rather than answered, because inventing
   * a value the differential cannot score is not an implementation. */
  id: "RTCDataChannel.id is unscoreable: @roamhq/wrtc answers uninitialised " +
    "memory (a different denormal each run) where the spec says null",
};

function own(table: Record<string, string | undefined>, key: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}

/** The four peer-connection state-change slots, and the three
 * data-channel ones that take no argument. Each is driven by a REAL
 * transition in scr_wrtc.c's loop station -- the transport's own state,
 * not a stub -- which is why they are served rather than refused. */
const PC_HANDLERS: Record<string, IrLibFn | undefined> = {
  oniceconnectionstatechange: "wrtc.pcOnIceConnectionStateChange",
  onicegatheringstatechange: "wrtc.pcOnIceGatheringStateChange",
  onsignalingstatechange: "wrtc.pcOnSignalingStateChange",
  onconnectionstatechange: "wrtc.pcOnConnectionStateChange",
};

const DC_HANDLERS: Record<string, IrLibFn | undefined> = {
  onopen: "wrtc.dcOnOpen",
  onclose: "wrtc.dcOnClose",
  onerror: "wrtc.dcOnError",
};

/** `Promise<void>` as the checker sees it at this call, so the IR type is
 * the interned one rather than a fresh structural twin. */
function promiseVoid(L: Lowerer, call: ts.CallExpression): IrType {
  const t = L.mapTypeOf(L.typeOf(call));
  if (t == null || t.kind !== "promise" || t.inner.kind !== "void") {
    L.noLowering("this description call at this type", call, "the result must be Promise<void>");
  }
  return t;
}

/** A string into a field typed `string` or `string | undefined`. The
 * optional `sdp` field of RTCSessionDescriptionInit is the second case,
 * and it is a UNION in the IR -- writing the bare string there would be a
 * type error the validator catches, not a wrong answer, but the wrap is
 * what makes it right. */
function widenString(L: Lowerer, to: IrType, value: IrExpr, loc: SrcLoc, at: ts.Node): IrExpr {
  if (typeEquals(to, STRING)) return value;
  if (to.kind === "union") {
    const tag = (L.unions.get(to.unionId)?.arms ?? []).findIndex((a) => typeEquals(a, STRING));
    if (tag >= 0) return { kind: "unionWrap", unionId: to.unionId, tag, value, type: to, loc };
  }
  L.noLowering("createOffer into a description whose 'sdp' is not a string", at,
    "RTCSessionDescriptionInit.sdp must be `string` or `string | undefined`");
}

/** The description argument's `type` field, read off the record. It is
 * passed to the runtime and CHECKED there. */
function descriptionType(L: Lowerer, arg: ts.Expression, what: string, loc: SrcLoc): IrExpr {
  const obj = L.lowerExpr(arg);
  if (obj.type.kind !== "record") {
    L.noLowering(`${what} with a description that is not a record`, arg,
      "the argument must be an RTCSessionDescriptionInit");
  }
  const shape = L.shapes.get(obj.type.shapeId);
  const field = shape?.fields.find((f) => f.name === "type");
  if (field === undefined || !typeEquals(field.type, STRING)) {
    L.noLowering(`${what} with a description carrying no 'type'`, arg,
      "the description's `type` decides whether it is an offer or an answer");
  }
  return { kind: "recordGet", obj, shapeId: obj.type.shapeId, field: "type", type: STRING, loc };
}

/** Property reads on a peer-connection or data-channel receiver. Null for
 * every other receiver, so the property chain keeps trying. */
export function lowerWrtcProperty(L: Lowerer, expr: ts.PropertyAccessExpression): IrExpr | null {
  const kind = L.mapTypeOf(L.typeOf(expr.expression))?.kind;
  if (kind !== "rtcPeerConnection" && kind !== "rtcDataChannel") return null;
  if (!L.isStdlibMember(expr)) return null;
  const name = expr.name.text;
  const loc = locOf(expr);
  const recv = (): IrExpr => L.lowerExpr(expr.expression);
  const sym = L.checker.getSymbolAtLocation(expr.name);

  if (kind === "rtcPeerConnection") {
    switch (name) {
      case "signalingState":
        return { kind: "libCall", fn: "wrtc.pcSignalingState", args: [recv()], type: STRING, loc };
      case "iceConnectionState":
        return { kind: "libCall", fn: "wrtc.pcIceConnectionState", args: [recv()], type: STRING, loc };
      case "iceGatheringState":
        return { kind: "libCall", fn: "wrtc.pcIceGatheringState", args: [recv()], type: STRING, loc };
      case "connectionState":
        return { kind: "libCall", fn: "wrtc.pcConnectionState", args: [recv()], type: STRING, loc };
      default:
        break;
    }
    const why = own(PC_NO_LOWERING, name);
    L.noLowering(`RTCPeerConnection.${name}`, expr, why, sym);
  }

  switch (name) {
    case "label":
      return { kind: "libCall", fn: "wrtc.dcLabel", args: [recv()], type: STRING, loc };
    case "protocol":
      return { kind: "libCall", fn: "wrtc.dcProtocol", args: [recv()], type: STRING, loc };
    case "ordered":
      return { kind: "libCall", fn: "wrtc.dcOrdered", args: [recv()], type: BOOL, loc };
    case "readyState":
      return { kind: "libCall", fn: "wrtc.dcReadyState", args: [recv()], type: STRING, loc };
    case "binaryType":
      return { kind: "libCall", fn: "wrtc.dcBinaryType", args: [recv()], type: STRING, loc };
    case "bufferedAmount":
      return { kind: "libCall", fn: "wrtc.dcBufferedAmount", args: [recv()], type: F64, loc };
    default:
      break;
  }
  const why = own(DC_NO_LOWERING, name);
  L.noLowering(`RTCDataChannel.${name}`, expr, why, sym);
}

function own2(table: Record<string, IrLibFn | undefined>, key: string): IrLibFn | undefined {
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}

/** One event-handler slot's right-hand side. `null` (clearing a handler)
 * is refused by name rather than silently ignored -- a program that
 * detaches a listener and still receives events is a bug with no
 * diagnostic. */
function lowerHandler(L: Lowerer, rhs: ts.Expression, name: string, maxParams: number): IrExpr {
  if (rhs.kind === ts.SyntaxKind.NullKeyword) {
    L.noLowering(`assigning null to ${name}`, rhs,
      "clearing an event handler has no lowering yet; assign a function");
  }
  const cb = L.lowerExpr(rhs);
  if (cb.type.kind !== "func" || cb.type.ret.kind !== "void") {
    L.noLowering(`${name} handler`, rhs, "the handler must be a function returning nothing");
  }
  if (cb.type.params.length > maxParams) {
    L.noLowering(`${name} handler with ${cb.type.params.length} parameters`, rhs,
      maxParams === 0
        ? "the state-change handlers take no arguments: the DOM Event object " +
          "has no representation and zapo reads the state off the connection"
        : "the message handler takes the Uint8Array payload, or nothing; the " +
          "DOM MessageEvent object has no representation (its `data` is `any`)");
  }
  if (maxParams === 1 && cb.type.params.length === 1) {
    const p = cb.type.params[0]!;
    if (p.kind !== "bytes" || p.elem !== "u8") {
      L.noLowering(`${name} handler taking ${L.fmt(p)}`, rhs,
        "the message handler's parameter must be the Uint8Array payload; " +
        "the DOM MessageEvent object has no representation");
    }
  }
  return cb;
}

/** `channel.binaryType = 'arraybuffer'`. Without this the write falls all
 * the way to "assignment to non-variables", a message naming neither the
 * value nor the reason -- the `requestInitWriteFence` situation. */
export function lowerWrtcWrite(
  L: Lowerer,
  assign: ts.BinaryExpression,
  target: ts.Expression,
): IrStmt | null {
  if (!ts.isPropertyAccessExpression(target)) return null;
  const kind = L.mapTypeOf(L.typeOf(target.expression))?.kind;
  if (kind !== "rtcPeerConnection" && kind !== "rtcDataChannel") return null;
  const name = target.name.text;
  const loc = locOf(assign);
  if (kind === "rtcDataChannel" && name === "binaryType") {
    return {
      kind: "exprStmt",
      expr: {
        kind: "libCall",
        fn: "wrtc.dcSetBinaryType",
        args: [L.lowerExpr(target.expression), L.lowerExprExpecting(assign.right, STRING)],
        type: VOID,
        loc,
      },
      loc,
    };
  }
  const handler = kind === "rtcPeerConnection" ? own2(PC_HANDLERS, name) : own2(DC_HANDLERS, name);
  if (handler !== undefined) {
    const cb = lowerHandler(L, assign.right, name, 0);
    return {
      kind: "exprStmt",
      expr: { kind: "libCall", fn: handler, args: [L.lowerExpr(target.expression), cb], type: VOID, loc },
      loc,
    };
  }
  if (kind === "rtcDataChannel" && name === "onmessage") {
    /* THE PAYLOAD FORM ONLY, and the refusal for the other one is named.
     * `MessageEvent` is a DOM event object whose `data` is `any` in
     * zapo's real @types/node; there is no representation for it, so a
     * handler taking one refuses BY NAME here rather than being served
     * with an invented event. A handler taking the Uint8Array payload
     * (the second arm of the declared type) is served. */
    const cb = lowerHandler(L, assign.right, name, 1);
    return {
      kind: "exprStmt",
      expr: { kind: "libCall", fn: "wrtc.dcOnMessage", args: [L.lowerExpr(target.expression), cb], type: VOID, loc },
      loc,
    };
  }
  const why = kind === "rtcPeerConnection" ? own(PC_NO_LOWERING, name) : own(DC_NO_LOWERING, name);
  const label = kind === "rtcPeerConnection" ? "RTCPeerConnection" : "RTCDataChannel";
  L.noLowering(`assignment to ${label}.${name}`, assign, why,
    L.checker.getSymbolAtLocation(target.name));
}

/** Method calls on a peer-connection or data-channel receiver. */
export function lowerWrtcMethodCall(
  L: Lowerer,
  call: ts.CallExpression,
  callee: ts.Expression,
): IrExpr | null {
  if (!ts.isPropertyAccessExpression(callee)) return null;
  const kind = L.mapTypeOf(L.typeOf(callee.expression))?.kind;
  if (kind !== "rtcPeerConnection" && kind !== "rtcDataChannel") return null;
  if (!L.isStdlibMember(callee)) return null;
  const name = callee.name.text;
  const loc = locOf(call);
  const args = call.arguments;
  const recv = (): IrExpr => L.lowerExpr(callee.expression);
  const sym = L.checker.getSymbolAtLocation(callee.name);

  if (kind === "rtcPeerConnection") {
    if (name === "close") {
      return { kind: "libCall", fn: "wrtc.pcClose", args: [recv()], type: VOID, loc };
    }
    if (name === "createOffer") {
      if (args.length > 0) {
        L.noLowering("createOffer with an options record", call,
          "RTCOfferOptions has no lowering: there is no media to offer, so " +
          "offerToReceiveAudio/Video and iceRestart are each inapplicable");
      }
      const t = L.mapTypeOf(L.typeOf(call));
      if (t == null || t.kind !== "promise" || t.inner.kind !== "record") {
        L.noLowering("createOffer at this type", call,
          "the result must be Promise<RTCSessionDescriptionInit>");
      }
      const rec = t.inner;
      const shape = L.shapes.get(rec.shapeId);
      if (shape === undefined) {
        L.noLowering("createOffer at this type", call, "the description shape is not interned");
      }
      /* The SDP comes out of the transport, so the ice-ufrag, ice-pwd and
       * fingerprint in it are the ones the socket will actually use.
       * Generating a fresh one per call would hand zapo credentials that
       * do not match the connection it then answers for. */
      const sdpCall: IrExpr = { kind: "libCall", fn: "wrtc.pcCreateOffer", args: [recv()], type: STRING, loc };
      const fields = shape.fields.map((f) => {
        if (f.name === "type") {
          return { name: f.name, value: { kind: "strLit", value: "offer", type: STRING, loc } as IrExpr };
        }
        if (f.name === "sdp") return { name: f.name, value: widenString(L, f.type, sdpCall, loc, call) };
        L.noLowering(`createOffer into a description carrying '${f.name}'`, call,
          "only 'type' and 'sdp' are served");
      });
      const description: IrExpr = { kind: "recordLit", fields, type: rec, loc };
      return { kind: "intrinsic", name: "promise.resolve", args: [description], type: t, loc };
    }
    if (name === "setLocalDescription") {
      if (args.length !== 1) {
        L.noLowering(`setLocalDescription with ${args.length} arguments`, call,
          "the description is required: this side has exactly one local " +
          "description and it is the offer it created");
      }
      /* The description's TYPE is read and passed, and the runtime CHECKS
       * it. That is deliberate rather than decorative: the only local
       * description this connection can have is its own offer, so a
       * description that is not an offer is rejected instead of silently
       * setting the offer anyway. */
      const type = descriptionType(L, args[0]!, "setLocalDescription", loc);
      return { kind: "libCall", fn: "wrtc.pcSetLocalDesc", args: [recv(), type], type: promiseVoid(L, call), loc };
    }
    if (name === "setRemoteDescription") {
      if (args.length !== 1) {
        L.noLowering(`setRemoteDescription with ${args.length} arguments`, call,
          "the answer is required");
      }
      const init = args[0]!;
      /* An OBJECT LITERAL, the lowerSqliteNew stance this file already
       * takes for the configuration and the channel init: `sdp` is
       * optional in RTCSessionDescriptionInit, and reading an absent one
       * out of a computed record at run time would mean starting a
       * handshake with no fingerprint to authenticate against. zapo
       * writes the literal (`{ type: 'answer', sdp: modifiedSdp }`). */
      if (!ts.isObjectLiteralExpression(init)) {
        L.noLowering("setRemoteDescription with a computed description", init,
          "the description must be an object literal, so the presence of " +
          "'sdp' is known at compile time");
      }
      let typeExpr: IrExpr | null = null;
      let sdpExpr: IrExpr | null = null;
      for (const prop of init.properties) {
        if (!ts.isPropertyAssignment(prop) || prop.name === undefined) {
          L.noLowering("setRemoteDescription with a spread or shorthand description", prop,
            "the description must be an object literal of 'type' and 'sdp'");
        }
        const key = ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)
          ? prop.name.text
          : null;
        if (key === "type") typeExpr = L.lowerExprExpecting(prop.initializer, STRING);
        else if (key === "sdp") sdpExpr = L.lowerExprExpecting(prop.initializer, STRING);
        else {
          L.noLowering(`setRemoteDescription with '${key ?? "a computed key"}'`, prop,
            "only 'type' and 'sdp' are served");
        }
      }
      if (typeExpr === null || sdpExpr === null) {
        L.noLowering("setRemoteDescription without both 'type' and 'sdp'", init,
          "the answer must carry an sdp: it is where the peer's " +
          "a=fingerprint and a=candidate come from");
      }
      return { kind: "libCall", fn: "wrtc.pcSetRemoteDesc", args: [recv(), typeExpr, sdpExpr], type: promiseVoid(L, call), loc };
    }
    if (name === "createDataChannel") {
      if (args.length < 1) {
        L.noLowering("createDataChannel with no label", call,
          "the label is required");
      }
      const label = L.lowerExprExpecting(args[0]!, STRING);
      /* `ordered` is read off an object literal key by key, the
       * `lowerSqliteNew` stance: it decides the channel's reliability
       * contract, so a computed record would have to be inspected at run
       * time and would silently take the default instead. */
      let ordered = true;
      if (args.length >= 2) {
        const init = args[1]!;
        if (!ts.isObjectLiteralExpression(init)) {
          L.noLowering("createDataChannel with a computed init record", init,
            "the init record must be an object literal, so the reliability " +
            "contract is known at compile time");
        } else {
          for (const prop of init.properties) {
            if (!ts.isPropertyAssignment(prop) || prop.name === undefined) continue;
            const key = ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)
              ? prop.name.text
              : null;
            if (key === null) continue;
            if (key === "ordered") {
              const v = prop.initializer;
              if (v.kind === ts.SyntaxKind.TrueKeyword) ordered = true;
              else if (v.kind === ts.SyntaxKind.FalseKeyword) ordered = false;
              else {
                L.noLowering("createDataChannel with a computed 'ordered'", v,
                  "ordered must be a literal true or false");
              }
            } else if (key === "maxRetransmits" || key === "maxPacketLifeTime") {
              /* Partial reliability. The SCTP unit deliberately does not
               * implement RFC 3758, because zapo asks for neither -- so
               * this refuses rather than quietly delivering a RELIABLE
               * channel where the caller asked for a lossy one. */
              L.noLowering(`createDataChannel with '${key}'`, prop,
                "partial reliability (RFC 3758 FORWARD-TSN) has no lowering; " +
                "only unordered/ordered reliable channels are served");
            } else if (key === "negotiated" || key === "id" || key === "protocol" ||
                       key === "priority") {
              L.noLowering(`createDataChannel with '${key}'`, prop,
                "only 'ordered' is honoured in the init record");
            }
          }
        }
      }
      return {
        kind: "libCall",
        fn: "wrtc.pcCreateDataChannel",
        args: [recv(), label, { kind: "boolLit", value: ordered, type: BOOL, loc }],
        type: RTCDATACHANNEL_T,
        loc,
      };
    }
    const why = own(PC_NO_LOWERING, name);
    L.noLowering(`RTCPeerConnection.${name}`, call, why, sym);
  }

  if (name === "close") {
    return { kind: "libCall", fn: "wrtc.dcClose", args: [recv()], type: VOID, loc };
  }
  if (name === "send") {
    if (args.length !== 1) {
      L.noLowering(`send with ${args.length} arguments`, call, "send takes exactly one payload");
    }
    const payload = L.lowerExpr(args[0]!);
    if (payload.type.kind === "string") {
      return { kind: "libCall", fn: "wrtc.dcSendStr", args: [recv(), payload], type: VOID, loc };
    }
    if (payload.type.kind === "bytes" && payload.type.elem === "u8") {
      return { kind: "libCall", fn: "wrtc.dcSendBytes", args: [recv(), payload], type: VOID, loc };
    }
    L.noLowering(`send of ${L.fmt(payload.type)}`, args[0]!,
      "only a string and a Uint8Array/Buffer payload are served; an " +
      "ArrayBuffer or a wider view has no lowering here");
  }
  const why = own(DC_NO_LOWERING, name);
  L.noLowering(`RTCDataChannel.${name}`, call, why, sym);
}
