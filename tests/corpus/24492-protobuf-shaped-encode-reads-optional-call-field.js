// The shape of a generated protobufjs message: optional fields default to null on the prototype, `encode` tests the field and its
// ownership, `decode` reads the previous value of the field back. A field named `call` is read through an untyped message.
function Message(p) {
  if (p) for (const k of Object.keys(p)) if (p[k] != null) this[k] = p[k];
}
Message.prototype.call = null;
Message.prototype.chat = null;
Message.encode = function (e) {
  const out = [];
  null != e.call && Object.hasOwnProperty.call(e, "call") && out.push("call=" + e.call);
  null != e.chat && Object.hasOwnProperty.call(e, "chat") && out.push("chat=" + e.chat);
  return out.join("&");
};
Message.decode = function (parts, a) {
  a = a || new Message();
  for (const part of parts) {
    const [k, v] = part.split("=");
    if (k === "call") a.call = v + "/" + a.call;
    else if (k === "chat") a.chat = v;
  }
  return a;
};
console.log(JSON.stringify(Message.encode(new Message({ call: "c1", chat: "h1" }))), JSON.stringify(Message.encode(new Message())));
const d = Message.decode(["call=x", "chat=y"]);
console.log(d.call, d.chat, Message.encode(d));
