// The `pbjs --target static-module` shape: an own key only for what the
// wire really carried, every other declared member a default on the
// PROTOTYPE. It is the shape every JS class has, and the one this board's
// own-key mask exists for.
export function Msg(v) {
  if (v !== undefined) this.conversation = v;
}
Msg.prototype.conversation = null;
Msg.prototype.albumMessage = null;
Msg.prototype.label = "dflt";

export function decode(v) {
  return new Msg(v);
}
