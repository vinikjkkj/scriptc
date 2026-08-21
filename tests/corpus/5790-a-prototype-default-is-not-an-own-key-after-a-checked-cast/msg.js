// The `pbjs --target static-module` shape, which is also the shape every JS
// class has: the DEFAULTS live on the prototype, and only the fields the
// wire really carried become OWN keys of the decoded message.
export function Msg(v) {
  if (v !== undefined) this.conversation = v;
}
Msg.prototype.conversation = null;
Msg.prototype.albumMessage = null;
Msg.prototype.audioMessage = null;
Msg.prototype.count = 0;

export function decode(v) {
  return new Msg(v);
}
