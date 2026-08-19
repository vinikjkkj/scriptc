// A union-slot spread UNDER a plain-record contributor —
// `{ ...baseEvent, ...parsed }`, zapo's `client/events/incoming.ts:397`.
//
// The relation is exact by construction there and it is exact here:
// `Parsed` is the slot's arms MINUS the base event's five names, and the
// literal already holds a value carrying exactly those five. The rule that
// closed `{ ...normalized, errors }` folded the names the LITERAL supplies
// into the pairing key; a contributor's names join it for the same reason,
// and the source still wins every name it declares because the source
// spread is written after the contributor.
//
// What this program pins:
//   * the disjoint (zapo) shape, both arms, read back through the tag;
//   * a name in BOTH the contributor and every source arm — JS reads the
//     SOURCE, because the source spread is later;
//   * TWO contributors, where the later of the two wins between themselves;
//   * a plain override after the source, which wins over both;
//   * a CONDITIONAL override in both its branches;
//   * every contributor and the source evaluated ONCE, left to right;
//   * the no-contributor forms — identity and the supplied-name pairing —
//     unchanged.

type WaIncomingBase = {
  rawNode: string;
  stanzaId: string;
  chatJid: string;
  stanzaType: string;
  offline: boolean;
};

type MexAck = { kind: "ack"; opName: string; count: number };
type MexErr = { kind: "err"; opName: string; reason: string };
type Parsed = MexAck | MexErr;

type EventAck = WaIncomingBase & MexAck;
type EventErr = WaIncomingBase & MexErr;
type MexEvent = EventAck | EventErr;

let order = "";
function tapBase(v: WaIncomingBase): WaIncomingBase { order += "B"; return v; }
function tapParsed(v: Parsed): Parsed { order += "P"; return v; }

function render(e: MexEvent): string {
  const head = `${e.stanzaId}/${e.chatJid}/${e.stanzaType}/${String(e.offline)}/${e.rawNode}`;
  return e.kind === "ack" ? `ack ${e.opName} ${String(e.count)} ${head}` : `err ${e.opName} ${e.reason} ${head}`;
}

function emit(base: WaIncomingBase, parsed: Parsed): void {
  console.log(render({ ...tapBase(base), ...tapParsed(parsed) }));
}

const base1: WaIncomingBase = {
  rawNode: "<n/>", stanzaId: "S1", chatJid: "c@s", stanzaType: "notification", offline: false,
};
emit(base1, { kind: "ack", opName: "MexOp", count: 3 });
emit(base1, { kind: "err", opName: "MexOp", reason: "denied" });
console.log("order=" + order);

// --- a name in the contributor AND in every source arm --------------------
// The source spread is LAST, so JS reads it from the SOURCE.
type Lead2 = { seq: number; label: string };
type S2a = { kind: "a"; seq: number };
type S2b = { kind: "b"; seq: number };
type Src2 = S2a | S2b;
type D2a = { kind: "a"; seq: number; label: string };
type D2b = { kind: "b"; seq: number; label: string };
function show2(x: D2a | D2b): void { console.log(`${x.kind} seq=${String(x.seq)} label=${x.label}`); }
function go2(lead: Lead2, src: Src2): void { show2({ ...lead, ...src }); }
go2({ seq: 10, label: "L" }, { kind: "a", seq: 20 });
go2({ seq: 11, label: "M" }, { kind: "b", seq: 30 });

// --- TWO contributors, a plain override, and a conditional override -------
type L3a = { u: number; v: string; w: boolean };
type L3b = { v: string; x: number };
type S3a = { kind: "a"; p: number; z: string };
type S3b = { kind: "b"; q: string; z: string };
type Src3 = S3a | S3b;
type D3a = { kind: "a"; p: number; z: string; u: number; v: string; w: boolean; x: number; y: number };
type D3b = { kind: "b"; q: string; z: string; u: number; v: string; w: boolean; x: number; y: number };
function show3(x: D3a | D3b): void {
  const t = `u=${String(x.u)} v=${x.v} w=${String(x.w)} x=${String(x.x)} y=${String(x.y)} z=${x.z}`;
  console.log(x.kind === "a" ? `a p=${String(x.p)} ${t}` : `b q=${x.q} ${t}`);
}
function go3(a: L3a, b: L3b, src: Src3, y: number, bump: boolean): void {
  show3({ ...a, ...b, ...src, y, ...(bump ? { z: "BUMPED" } : {}) });
}
go3({ u: 1, v: "A", w: true }, { v: "B", x: 2 }, { kind: "a", p: 7, z: "Z" }, 42, false);
go3({ u: 1, v: "A", w: true }, { v: "B", x: 2 }, { kind: "b", q: "Q", z: "Z" }, 43, true);

// --- the NO-CONTRIBUTOR forms, unchanged ----------------------------------
type NormOut = { kind: "ack"; opName: string; count: number } | { kind: "err"; opName: string; reason: string };
type WithErrs =
  | { kind: "ack"; opName: string; count: number; errors: number }
  | { kind: "err"; opName: string; reason: string; errors: number }
  | { kind: "unknown"; opName: string; errors: number; data: string };
function show4(x: WithErrs): void {
  console.log(x.kind === "ack" ? `ack ${String(x.count)} e=${String(x.errors)}`
    : x.kind === "err" ? `err ${x.reason} e=${String(x.errors)}`
      : `unknown ${x.data}`);
}
function go4(normalized: NormOut, errors: number): void { show4({ ...normalized, errors }); }
go4({ kind: "ack", opName: "O", count: 2 }, 0);
go4({ kind: "err", opName: "O", reason: "no" }, 1);

type Thumb = { url: string; w: number };
function go5(t: Thumb | undefined, w: number): Thumb | undefined {
  return t === undefined ? undefined : { ...t, w };
}
const t5 = go5({ url: "u", w: 1 }, 9);
console.log("identity:" + (t5 === undefined ? "none" : `${t5.url}/${String(t5.w)}`));
