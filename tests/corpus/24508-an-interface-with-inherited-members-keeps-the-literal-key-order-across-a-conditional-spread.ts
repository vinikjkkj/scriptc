// zapo buildIncomingMessageKey: a literal typed as an interface that EXTENDS another, with a conditional spread, enumerates in the order it
// was written (JS's first-appearance order), whether the spread fires or not, wherever it sits, and through a nested key object.
interface MessageKey { remoteJid: string; id: string; fromMe: boolean; participant?: string }
interface IncomingKey extends MessageKey {
  readonly isGroup: boolean;
  readonly senderDevice: number;
  readonly senderUsername?: string;
}
interface StanzaEvent {
  readonly stanza: string;
  readonly key: IncomingKey;
  readonly note?: string;
}
function identity(n: number): { senderUsername?: string } {
  return n > 0 ? { senderUsername: "u" } : {};
}
// the spread last
function keyLast(id: string, device: number, group: boolean): IncomingKey {
  return { remoteJid: "r@s", id, fromMe: false, isGroup: group, senderDevice: device, ...(group ? { participant: "p@s" } : {}) };
}
// the spread first
function keyFirst(id: string, device: number, group: boolean): IncomingKey {
  return { ...(group ? { participant: "p@s" } : {}), remoteJid: "r@s", id, fromMe: false, isGroup: group, senderDevice: device };
}
// the spread in the middle, next to a spread of an optional record (zapo's shape)
function keyMiddle(id: string, device: number, group: boolean): IncomingKey {
  const keyIdentity = identity(device);
  return { remoteJid: "r@s", id, fromMe: false, isGroup: group, ...keyIdentity, senderDevice: device, ...(group ? { participant: "p@s" } : {}) };
}
function event(key: IncomingKey): StanzaEvent {
  return { stanza: "text", key, ...(key.isGroup ? { note: "group" } : {}) };
}
for (const group of [false, true]) {
  const a = keyLast("a" + group, 0, group);
  const b = keyFirst("b" + group, 0, group);
  const c = keyMiddle("c" + group, 1, group);
  console.log(JSON.stringify(Object.keys(a)), JSON.stringify(Object.keys(b)), JSON.stringify(Object.keys(c)));
  console.log(JSON.stringify(a), JSON.stringify(c));
  console.log(a, b);
  const e = event(c);
  console.log(JSON.stringify(Object.keys(e)), JSON.stringify(Object.keys(e.key)));
  console.log(JSON.stringify(e));
}
