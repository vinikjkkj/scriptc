interface MK { remoteJid?: string | null; fromMe?: boolean | null; id?: string | null; participant?: string | null }
interface MSG { conversation?: string | null }
interface WMI {
  key?: MK | null;
  message?: MSG | null;
  messageTimestamp?: number | { toNumber(): number } | null;
  participant?: string | null;
}
interface HSM { message?: WMI | null }
interface Parked { readonly id: string; readonly authorInfo: WMI; readonly fromMe: boolean; readonly timestampMs: number | undefined; readonly n: number }
function decode(s: string): any { return JSON.parse(s); }
function longToNumber(value: number | { toNumber(): number } | null | undefined): number {
  if (value == null) return 0;
  return typeof value === "number" ? value : value.toNumber();
}
// `webMsg.key.fromMe === true` re-reads its pure operand for the tag test and the payload; each read of a view record keeps its own temp.
function readHistoryMessage(s: string): Parked | null {
  const webMsg = (decode(s) as HSM).message;
  if (!webMsg?.key?.id || !webMsg.message) return null;
  const timestampMs = longToNumber(webMsg.messageTimestamp) * 1000;
  return {
    id: webMsg.key.id,
    authorInfo: { key: { fromMe: webMsg.key.fromMe, participant: webMsg.key.participant }, participant: webMsg.participant },
    fromMe: webMsg.key.fromMe === true,
    timestampMs: timestampMs || undefined,
    n: (webMsg.message.conversation ?? "").length
  };
}
function isMine(s: string): boolean {
  const w = (decode(s) as HSM).message;
  if (!w?.key?.id) return false;
  return w.key.fromMe === true;
}
let total = 0;
let mine = 0;
let dropped = 0;
for (let i = 0; i < 300; i++) {
  let key = '"id":"ID' + i + '","remoteJid":"a@s.whatsapp.net"';
  if (i % 3 === 0) key += ',"fromMe":true';
  else if (i % 3 === 1) key += ',"fromMe":false';
  if (i % 7 === 0) key += ',"participant":"p' + i + '"';
  let w = '"messageTimestamp":' + (1700000000 + i);
  if (i % 13 !== 0) w += ',"key":{' + key + '}';
  if (i % 11 !== 0) w += ',"message":{"conversation":"hello ' + i + '"}';
  const rec = '{"message":{' + w + '}}';
  const m = readHistoryMessage(rec);
  if (m === null) { dropped++; continue; }
  total += m.n + m.id.length + (m.fromMe ? 1 : 0) + (m.timestampMs === undefined ? 0 : 1) + (m.authorInfo.key?.participant ? 2 : 0);
  if (isMine(rec)) mine++;
}
console.log(total, mine, dropped);
const p = readHistoryMessage('{"message":{"key":{"id":"x","fromMe":true,"participant":"q"},"message":{"conversation":"abc"},"messageTimestamp":5}}');
console.log(p === null ? "null" : p.id + " " + String(p.fromMe) + " " + String(p.timestampMs) + " " + String(p.n) + " " + String(p.authorInfo.key?.participant));
