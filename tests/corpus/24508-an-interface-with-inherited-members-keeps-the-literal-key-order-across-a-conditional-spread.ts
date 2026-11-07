// zapo buildIncomingMessageKey: a literal typed as an interface that EXTENDS another, ending in a conditional spread, enumerates in the order it was written, not own-members-first.
interface MessageKey { remoteJid: string; id: string; fromMe: boolean; participant?: string }
interface IncomingKey extends MessageKey {
  readonly isGroup: boolean;
  readonly senderDevice: number;
}
function buildKey(id: string, device: number, group: boolean): IncomingKey {
  return {
    remoteJid: "r@s",
    id,
    fromMe: false,
    isGroup: group,
    senderDevice: device,
    ...(group ? { participant: "p@s" } : {}),
  };
}
const k = buildKey("x1", 1, false);
console.log(JSON.stringify(Object.keys(k)));
console.log(JSON.stringify(k));
const g = buildKey("x2", 2, true);
console.log(JSON.stringify(Object.keys(g)));
