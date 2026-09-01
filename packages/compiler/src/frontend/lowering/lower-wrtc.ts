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
import { BOOL, F64, RTCDATACHANNEL_T, RTCPEERCONNECTION_T, STRING, VOID } from "../../ir/nodes.js";
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
const PC_NO_LOWERING: Record<string, string | undefined> = {
  createOffer: "the offer/answer exchange has no lowering yet",
  createAnswer: "the offer/answer exchange has no lowering yet",
  setLocalDescription: "the offer/answer exchange has no lowering yet",
  setRemoteDescription: "the offer/answer exchange has no lowering yet",
  addIceCandidate: "trickle ICE has no lowering yet",
  restartIce: "ICE restart has no lowering yet",
  localDescription: "the offer/answer exchange has no lowering yet",
  remoteDescription: "the offer/answer exchange has no lowering yet",
  onconnectionstatechange: "the state-change events have no lowering yet",
  oniceconnectionstatechange: "the state-change events have no lowering yet",
  onicegatheringstatechange: "the state-change events have no lowering yet",
  onsignalingstatechange: "the state-change events have no lowering yet",
  onnegotiationneeded: "the state-change events have no lowering yet",
  onicecandidate: "trickle ICE has no lowering yet",
  ondatachannel: "inbound data channels have no lowering yet",
};

const DC_NO_LOWERING: Record<string, string | undefined> = {
  send: "sending needs the SCTP association wired to the event loop, which " +
    "is not done yet",
  onopen: "the data-channel events have no lowering yet",
  onclose: "the data-channel events have no lowering yet",
  onerror: "the data-channel events have no lowering yet",
  onmessage: "the data-channel events have no lowering yet",
  onbufferedamountlow: "the data-channel events have no lowering yet",
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
  const why = own(DC_NO_LOWERING, name);
  L.noLowering(`RTCDataChannel.${name}`, call, why, sym);
}
