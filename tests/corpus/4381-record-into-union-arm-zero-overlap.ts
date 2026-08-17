// A record BINDING entering a union slot whose other arm shares no member
// name with it. The other arm is all-optional plus one `unknown`-typed
// member, so every one of its members is undefined-admitting and it
// width-lifts from ANY record by filling them all in and dropping the
// source's own members. Two candidates, and the arm the program obviously
// meant is the one that keeps all three members.
//
// Measured on zapo through its public API: `client.message.send(jid, {
// type: 'reaction', emoji, target })` and `send(jid, text, { quote: target })`
// where `target` is a plain `{ remoteJid; id; fromMe }` binding — both die.
// The same literal written INLINE in the same slot lowers, because tsc picks
// the arm contextually and leaves no conversion to plan.
interface MsgKey {
  readonly remoteJid: string;
  readonly id: string;
  readonly fromMe: boolean;
  readonly participant?: string;
}
interface MsgEvent {
  readonly key?: MsgKey;
  readonly rawNode: unknown;
}
type Target = MsgKey | MsgEvent;

function describeTarget(t: Target): string {
  if ("remoteJid" in t) {
    return "key " + t.remoteJid + "/" + t.id + "/" + String(t.fromMe) + "/" + String(t.participant);
  }
  return "event " + (t.key === undefined ? "-" : t.key.id);
}

interface Reaction {
  readonly type: "reaction";
  readonly emoji: string;
  readonly target: Target;
}
interface TextMsg {
  readonly type: "text";
  readonly text: string;
}
type Content = string | TextMsg | Reaction;

function send(c: Content): string {
  if (typeof c === "string") return "raw " + c;
  if (c.type === "text") return "text " + c.text;
  return "reaction " + c.emoji + " -> " + describeTarget(c.target);
}

// (1) the binding, straight into the union parameter
const target = { remoteJid: "5511888888888@s.whatsapp.net", id: "3EB0AA", fromMe: false };
console.log(describeTarget(target));

// (2) the inline literal in the same slot — this one always lowered
console.log(describeTarget({ remoteJid: "5511777777777@s.whatsapp.net", id: "3EB0BB", fromMe: true }));

// (3) the OTHER arm, exactly
console.log(describeTarget({ key: { remoteJid: "r", id: "3EB0CC", fromMe: true }, rawNode: 7 }));

// (4) the same conversion one level down: `target` is a member of a record
// that is itself entering a union arm
console.log(send({ type: "reaction", emoji: "❤", target }));
console.log(send({ type: "text", text: "plain" }));
console.log(send("bare"));

// (5) the binding with the optional member actually present
const targetWithParticipant = {
  remoteJid: "120363@g.us",
  id: "3EB0DD",
  fromMe: false,
  participant: "5511888888888@s.whatsapp.net",
};
console.log(describeTarget(targetWithParticipant));

// (6) a record that overlaps BOTH arms stays ambiguous by name and must keep
// taking the arm it exactly matches — `rawNode` is MsgEvent's, so this is a
// plain wrap, not a lift.
const bothNames: MsgEvent = { key: undefined, rawNode: "z" };
console.log(describeTarget(bothNames));
