/* scriptc's shipped declarations for the WebRTC data-channel surface.
 *
 * Why this file exists. zapo's `packages/voip/src/relay/WaSctpRelay.ts`
 * imports `@roamhq/wrtc` and then names `RTCPeerConnection` and
 * `RTCDataChannel` as GLOBAL types:
 *
 *     type PeerConnectionClass = RTCPeerConnection      // :30
 *     type DataChannelClass = RTCDataChannel            // :31
 *
 * They are global because in a DOM program they come from `lib.dom.d.ts`,
 * and `@roamhq/wrtc`'s own .d.ts re-exports those globals rather than
 * declaring them. scriptc forces `lib: ["lib.es2025.d.ts"]`
 * (frontend/program.ts:109), so under scriptc the names do not exist at
 * all and both lines report SC0001 "Cannot find name" — a TYPE-level stop,
 * which is not deferrable by --best-effort and which no per-statement
 * refusal can stand in for. The package is unbuildable rather than
 * partially refused.
 *
 * Honouring the project's own `lib` would also supply the names, and was
 * measured: commit 24e21a10 made `lib` a floor rather than a ceiling,
 * reached voip's entry (preflight-fail 7 -> 0), and was REVERTED because
 * it reddened six test files that write a DOM lib at run time. This file
 * buys the same two names with none of that blast radius.
 *
 * ── the doctrine, taken from scriptc-sqlite.d.ts ───────────────────────
 *
 * Members with no lowering are DECLARED here anyway. Declaring them is
 * what makes the refusal read "RTCPeerConnection.createDataChannel has no
 * scriptc lowering yet" instead of "property 'createDataChannel' does not
 * exist on type 'RTCPeerConnection'" — a diagnostic that would send the
 * reader looking for a typo in a name that is perfectly real. The fence is
 * the LOWERER's, at each use site, exactly as scriptc.d.ts describes for
 * the rest of the standard surface.
 *
 * For that fence to be the one that fires, this file has to READ as
 * standard-library provenance: `frontend/types.ts` gates every stdlib type
 * mapping on `ctx.isStdlibFile(...)`, and `lowerer.ts`'s `isStdlibFile`
 * whitelists scriptc's own ambient files by path. Without the row this
 * file resolves through @scriptc/compiler, classifies as an npm
 * declaration file, and every use of it meets the SC2013 fence instead —
 * the same trap scriptc-sqlite.d.ts documents in its own header.
 *
 * ── scope: what zapo actually touches ──────────────────────────────────
 *
 * Measured against the provenance checkout
 * 250f9af5229a545eec28ddbd3e8774a397cdb0bb, not against the spec. zapo is
 * offerer-only over a single relay whose address it already knows:
 *
 *   - `new RTCPeerConnection({ iceServers: [] })` — EMPTY. No STUN, no
 *     TURN, so no srflx or relay candidate gathering: host candidates only.
 *   - No `addIceCandidate` and no `onicecandidate`, so no trickle ICE.
 *   - No `createAnswer`: it parses `a=ice-ufrag` out of its own offer and
 *     synthesises the answer itself.
 *   - No `addTrack` and no `ontrack`: data channel only, so no SRTP, no
 *     use_srtp extension and no media codecs.
 *   - `createDataChannel('wa-web-call', { ordered: false })` with neither
 *     `maxRetransmits` nor `maxPacketLifeTime` — unordered RELIABLE, so
 *     RFC 3758 partial reliability (FORWARD-TSN) is not required either.
 *
 * The wider surface is declared where it costs nothing to declare (the
 * initialiser fields above, `createAnswer`, `addIceCandidate`), so that a
 * program which does use it gets the named refusal rather than a missing
 * property. Nothing here promises a lowering.
 */

/* ── state enumerations ─────────────────────────────────────────────── */

type RTCSdpType = "answer" | "offer" | "pranswer" | "rollback";

type RTCSignalingState =
  | "closed"
  | "have-local-offer"
  | "have-local-pranswer"
  | "have-remote-offer"
  | "have-remote-pranswer"
  | "stable";

type RTCIceConnectionState =
  | "checking"
  | "closed"
  | "completed"
  | "connected"
  | "disconnected"
  | "failed"
  | "new";

type RTCIceGatheringState = "complete" | "gathering" | "new";

type RTCPeerConnectionState = "closed" | "connected" | "connecting" | "disconnected" | "failed" | "new";

type RTCDataChannelState = "closed" | "closing" | "connecting" | "open";

/* `binaryType` on a data channel. WaSctpRelay.ts:342 assigns
 * 'arraybuffer'. The DOM spells this as the same `BinaryType` name shared
 * with WebSocket; kept local to avoid claiming a name this file does not
 * otherwise serve. */
type RTCBinaryType = "arraybuffer" | "blob";

/* ── initialisers and descriptions ──────────────────────────────────── */

interface RTCIceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

interface RTCConfiguration {
  iceServers?: RTCIceServer[];
  iceTransportPolicy?: "all" | "relay";
  bundlePolicy?: "balanced" | "max-bundle" | "max-compat";
  rtcpMuxPolicy?: "require";
  iceCandidatePoolSize?: number;
}

/* `createOffer()` answers one of these and `sdp` is optional, which is why
 * WaSctpRelay.ts:387 writes `offer.sdp!`. Keeping it optional preserves
 * that non-null assertion's meaning rather than quietly making it
 * redundant. */
interface RTCSessionDescriptionInit {
  type: RTCSdpType;
  sdp?: string;
}

interface RTCOfferOptions {
  iceRestart?: boolean;
  offerToReceiveAudio?: boolean;
  offerToReceiveVideo?: boolean;
}

interface RTCAnswerOptions {
  voiceActivityDetection?: boolean;
}

interface RTCDataChannelInit {
  ordered?: boolean;
  maxPacketLifeTime?: number;
  maxRetransmits?: number;
  protocol?: string;
  negotiated?: boolean;
  id?: number;
}

interface RTCIceCandidateInit {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

/* ── the two types zapo names ───────────────────────────────────────── */

interface RTCDataChannel {
  readonly label: string;
  readonly ordered: boolean;
  readonly protocol: string;
  readonly id: number | null;
  readonly readyState: RTCDataChannelState;
  readonly bufferedAmount: number;
  bufferedAmountLowThreshold: number;
  binaryType: RTCBinaryType;

  send(data: string): void;
  send(data: ArrayBuffer): void;
  send(data: ArrayBufferView): void;

  /* Required by WaSctpRelay.ts:22's `closeQuietly(closeable: { close():
   * void })`, which is called with both the data channel (:424, :1004) and
   * the peer connection (:426, :637, :1006). A structural constraint: the
   * declarations do not typecheck without it. */
  close(): void;

  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  /* TWO ARMS, and the split is the honest one.
   *
   * zapo writes `channel.onmessage = (event: MessageEvent) => { ... }` and
   * reads `event.data`. In zapo's own tree `MessageEvent` resolves through
   * @types/node to undici's `MessageEvent<T = any>`, so `data` is `any` --
   * a DOM event object with a dynamic payload, and scriptc has no static
   * representation for either half of that. A handler taking one therefore
   * refuses BY NAME at the assignment ("the DOM MessageEvent object has no
   * representation"), which is a diagnostic naming the real obstacle.
   *
   * The second arm is what scriptc DOES serve: the payload itself, as the
   * Uint8Array the SCTP association delivers. It is declared here rather
   * than left undeclared so a program can spell it and get a lowering
   * instead of a type error. */
  onmessage:
    | ((event: MessageEvent) => void)
    | ((payload: Uint8Array) => void)
    | null;
  onbufferedamountlow: (() => void) | null;
}

interface RTCDataChannelEvent {
  readonly channel: RTCDataChannel;
}

interface RTCPeerConnection {
  readonly signalingState: RTCSignalingState;
  readonly iceConnectionState: RTCIceConnectionState;
  readonly iceGatheringState: RTCIceGatheringState;
  readonly connectionState: RTCPeerConnectionState;
  readonly localDescription: RTCSessionDescriptionInit | null;
  readonly remoteDescription: RTCSessionDescriptionInit | null;

  createDataChannel(label: string, dataChannelDict?: RTCDataChannelInit): RTCDataChannel;
  createOffer(options?: RTCOfferOptions): Promise<RTCSessionDescriptionInit>;
  createAnswer(options?: RTCAnswerOptions): Promise<RTCSessionDescriptionInit>;
  setLocalDescription(description?: RTCSessionDescriptionInit): Promise<void>;
  setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void>;
  addIceCandidate(candidate?: RTCIceCandidateInit): Promise<void>;
  restartIce(): void;

  /* See RTCDataChannel.close above. */
  close(): void;

  onconnectionstatechange: (() => void) | null;
  oniceconnectionstatechange: (() => void) | null;
  onicegatheringstatechange: (() => void) | null;
  onsignalingstatechange: (() => void) | null;
  onnegotiationneeded: (() => void) | null;
  onicecandidate: ((event: RTCPeerConnectionIceEvent) => void) | null;
  ondatachannel: ((event: RTCDataChannelEvent) => void) | null;
}

interface RTCIceCandidate {
  readonly candidate: string;
  readonly sdpMid: string | null;
  readonly sdpMLineIndex: number | null;
  readonly usernameFragment: string | null;
  toJSON(): RTCIceCandidateInit;
}

interface RTCPeerConnectionIceEvent {
  readonly candidate: RTCIceCandidate | null;
}

/* The constructors. zapo reaches the peer connection through the module's
 * default export (`new wrtc.RTCPeerConnection(...)`, :224) rather than
 * through the global, but a DOM program spells it globally and both forms
 * must name the same type. */
declare var RTCPeerConnection: {
  prototype: RTCPeerConnection;
  new (configuration?: RTCConfiguration): RTCPeerConnection;
};

declare var RTCDataChannel: {
  prototype: RTCDataChannel;
};

declare var RTCIceCandidate: {
  prototype: RTCIceCandidate;
  new (candidateInitDict?: RTCIceCandidateInit): RTCIceCandidate;
};

/* ── the module ─────────────────────────────────────────────────────── */

/* `@roamhq/wrtc` publishes a default export carrying the constructors.
 * WaSctpRelay.ts:5 binds exactly that (`import wrtc from '@roamhq/wrtc'`)
 * and uses exactly one member of it. */
declare module "@roamhq/wrtc" {
  interface WrtcModule {
    RTCPeerConnection: {
      prototype: RTCPeerConnection;
      new (configuration?: RTCConfiguration): RTCPeerConnection;
    };
    RTCIceCandidate: {
      prototype: RTCIceCandidate;
      new (candidateInitDict?: RTCIceCandidateInit): RTCIceCandidate;
    };
    RTCSessionDescription: {
      prototype: RTCSessionDescriptionInit;
      new (descriptionInitDict: RTCSessionDescriptionInit): RTCSessionDescriptionInit;
    };
  }
  const wrtc: WrtcModule;
  export default wrtc;
}
