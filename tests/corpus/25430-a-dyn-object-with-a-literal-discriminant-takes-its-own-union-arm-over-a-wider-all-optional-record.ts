interface Ext { text?: string | null }
interface IMsg { conversation?: string | null; extendedTextMessage?: Ext | null; caption?: string | null }
interface TextMsg { type: "text"; text: string }
interface ReactMsg { type: "reaction"; emoji: string }
type Content = string | TextMsg | ReactMsg | IMsg
interface SendIn { content: Content; recipients: readonly string[] }
function isText(c: unknown): c is TextMsg {
  return !!c && typeof c === "object" && "type" in c && c.type === "text" && "text" in c;
}
function isReact(c: unknown): c is ReactMsg {
  return !!c && typeof c === "object" && "type" in c && c.type === "reaction" && "emoji" in c;
}
function build(c: Content): { message: IMsg } {
  if (typeof c === "string") return { message: { conversation: c } };
  if (isText(c)) return { message: { extendedTextMessage: { text: c.text } } };
  if (isReact(c)) return { message: { conversation: "react " + c.emoji } };
  return { message: c };
}
function send(i: SendIn): string {
  const b = build(i.content);
  return (b.message.conversation ?? "-") + "|" + (b.message.extendedTextMessage?.text ?? "-") + "|" + String(i.recipients.length);
}
function viaDyn(s: string): string {
  const input = JSON.parse(s) as Record<string, unknown>;
  return send(input as never);
}
console.log(viaDyn('{"content":{"type":"text","text":"a status"},"recipients":["x"]}'));
console.log(viaDyn('{"content":"plain","recipients":["x","y"]}'));
console.log(viaDyn('{"content":{"type":"reaction","emoji":"e"},"recipients":[]}'));
console.log(viaDyn('{"content":{"conversation":"raw","caption":"c"},"recipients":["z"]}'));
