// `client.message.send(peerJid, { type: "text", text }, { quote: target })` —
// the quote-reply step of the zapo fake-server driver, which `block/sixteen`'s
// attribution table charges as `SC2003 union types must match exactly` and
// costs TWO stanzas: `message peer to-participants` (the quote itself) and the
// `iq usync get` the oracle emits 2 ms after the send step begins.
//
// `WaSendMessageOptions.quote` is a THREE-arm union:
//
//   WaIncomingMessageEvent  { key; rawNode; timestampSeconds?; … }
//   WaQuoteRef              { id; participant?; remoteJid?; message? }
//   WaMessageKey            { remoteJid; id; fromMe; participant? }
//
// and `target` is a plain `{ remoteJid; id; fromMe }` BINDING. The zero-overlap
// rule (`an arm that shares no member name with the source record is not a
// width-lift candidate`, d2af9ad2) drops the EVENT arm and leaves two, so
// "exactly one candidate" failed and the site kept its fence.
//
// Of the two survivors only `WaMessageKey` can HOLD the whole value:
// `WaQuoteRef` has no `fromMe`, so the copy it plans silently discards a member
// the program wrote. The whole-value refinement takes the arm that drops
// nothing, and only when exactly one does.
//
// Two independent reasons this is the arm the program meant:
//
//   * The sibling site one arm over already lowers. `send(jid, { type:
//     'reaction', emoji, target })` targets `WaMessageTargetInput =
//     WaMessageKey | WaMessageRef`, two arms, and the zero-overlap rule
//     resolves it. The pair differed for no reason the author could see.
//   * The FRESH-LITERAL spelling of the same value in the same slot already
//     lowers, because tsc picks the arm contextually and leaves no conversion
//     to make. Rows 1 and 3 below are that pair, and they must agree.
//
// The counter-example the refinement must NOT swallow is zapo's
// `messages.ts:497`, where one merged record width-lifts into FIVE of six
// media-message arms: each of those arms omits the fields belonging to the
// other media kinds, so EVERY candidate drops part of the source, the filter
// selects zero and the fence holds. That row is a REFUSAL, so it cannot live in
// a corpus fixture — it is `ambiguousWholeValue` / `partialEverywhere` in
// `tests/diagnostics/unions.ts`, and the census of zapo's own TU on both sides
// is the other half of the proof.

interface KeyT {
  readonly remoteJid: string;
  readonly id: string;
  readonly fromMe: boolean;
  readonly participant?: string;
}

interface QuoteRefT {
  readonly id: string;
  readonly participant?: string;
  readonly remoteJid?: string;
  readonly message?: string;
}

interface EventT {
  readonly key: KeyT;
  readonly rawNode: string;
}

interface RefT {
  readonly key?: KeyT;
  readonly rawNode: string;
}

// `quote`: the three-arm destination, the row this fixture closes.
interface SendOpts {
  readonly quote?: EventT | QuoteRefT | KeyT;
}

// `target`: the two-arm sibling that already lowered on main.
interface ReactionContent {
  readonly kind: "reaction";
  readonly emoji: string;
  readonly target: KeyT | RefT;
}

function showQuote(o: SendOpts): string {
  const q = o.quote;
  if (q === undefined) return "none";
  if ("rawNode" in q) return "event:" + q.key.id;
  if ("fromMe" in q) return "key:" + q.remoteJid + "/" + q.id + "/" + String(q.fromMe);
  return "quoteref:" + q.id;
}

function showTarget(c: ReactionContent): string {
  const t = c.target;
  if ("rawNode" in t) return "ref";
  return "key:" + t.remoteJid + "/" + t.id + "/" + String(t.fromMe);
}

const PEER = "5511888888888@s.whatsapp.net";

// ---- 1: the row that aborted --------------------------------------------
// A const BINDING into the three-arm slot. Exactly one surviving arm holds all
// three members, so the lift resolves to WaMessageKey.
const target = { remoteJid: PEER, id: "MSG1", fromMe: false };
console.log("1 binding:", showQuote({ quote: target }));

// ---- 2: the sibling that already lowered (must not move) -----------------
console.log("2 sibling:", showTarget({ kind: "reaction", emoji: "+1", target }));

// ---- 3: the fresh-literal spelling (must not move, and must AGREE with 1) --
console.log("3 literal:", showQuote({ quote: { remoteJid: PEER, id: "MSG1", fromMe: false } }));

// ---- 4: a binding the OTHER arm holds whole ------------------------------
// `{ id }` alone: WaMessageKey needs `remoteJid` and `fromMe`, so it is not
// even a width-lift candidate, and QuoteRefT — all-optional past `id` — is the
// single candidate. This already lowered; it is here so a regression that makes
// the refinement prefer one arm NAME rather than one arm SHAPE is visible.
const onlyId = { id: "MSG2" };
console.log("4 onlyid:", showQuote({ quote: onlyId }));

// ---- 5: the zero-overlap rule still resolves its own case ----------------
// `{ key, rawNode }` shares no name with QuoteRefT and every name with EventT.
const ev = { key: { remoteJid: PEER, id: "MSG3", fromMe: true }, rawNode: "N3" };
console.log("5 event:", showQuote({ quote: ev }));

// ---- 6: a member the winning arm declares OPTIONAL is still carried -------
// `participant` is optional on both survivors, so covering it is not what
// decides the arm; `fromMe` is. The value must round-trip intact.
const withPart = { remoteJid: PEER, id: "MSG4", fromMe: false, participant: "p@s.whatsapp.net" };
console.log("6 participant:", showQuote({ quote: withPart }));

// ---- 7: the same binding reaching the slot through a FUNCTION argument ----
function send(to: string, opts: SendOpts): string {
  return to + " " + showQuote(opts);
}
console.log("7 argument:", send(PEER, { quote: target }));

// ---- 8: and through a RETURN ---------------------------------------------
function quoteOf(k: { readonly remoteJid: string; readonly id: string; readonly fromMe: boolean }): EventT | QuoteRefT | KeyT {
  return k;
}
console.log("8 return:", showQuote({ quote: quoteOf(target) }));

// ---- 9: undefined still takes the unit arm -------------------------------
console.log("9 absent:", showQuote({}));
