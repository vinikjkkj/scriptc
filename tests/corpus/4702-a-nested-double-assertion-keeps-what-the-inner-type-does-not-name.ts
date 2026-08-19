// zapo's driver, reduced: the loss is NESTED, and the trap it caused was
// four hundred lines away from the cast that caused it.
//
// A handler pushes an event into an array typed by a hand-written shape
// that names three of the key's members and none of the event's own
// metadata; four hundred lines later a library call widens the element
// back to the real event type, finds five required members absent, and
// throws — at a site that did nothing wrong. On base this program prints
// `keys=key,message` and then dies with
//
//   Uncaught TypeError: a '{ key: { ... }; message: unknown }' value is
//   not representable in the target union
//
// The drop is at the CAST and it is nested: `rawNode` at the top level
// and four more inside `key`, which the top-level member list never
// mentions. Both levels are granted an overflow portion, so the reshape
// captures them and the widening back reads each required member out of
// the overflow through a checked extraction.
interface Key {
  remoteJid?: string | null;
  id?: string | null;
  fromMe?: boolean | null;
  isGroup: boolean;
  senderDevice: number;
}
interface Ev {
  key: Key;
  message?: unknown;
  rawNode: string;
}
type MsgEv = {
  key: { remoteJid?: string | null; id?: string | null; fromMe?: boolean | null };
  message?: unknown;
};

function sendReceipt(e: Ev | readonly Ev[]): void {
  const one = Array.isArray(e) ? e[0]! : (e as Ev);
  console.log(`rawNode=${one.rawNode} isGroup=${String(one.key.isGroup)} device=${String(one.key.senderDevice)}`);
}

const ev: Ev = {
  key: { remoteJid: "a@s.whatsapp.net", id: "ID1", fromMe: false, isGroup: false, senderDevice: 0 },
  message: 1,
  rawNode: "NODE-PAYLOAD",
};
const messages: MsgEv[] = [];
messages.push(ev as unknown as MsgEv);

console.log(`keys=${Object.keys(messages[0]!).join(",")}`);
console.log(`keyKeys=${Object.keys(messages[0]!.key).join(",")}`);
sendReceipt(messages[0] as never);
