// Own keys and prototype keys on one object: `label` is inherited, `note` is
// an OWN key whose value is `undefined` (JS lists it), `tag` is an ordinary
// own key that SHADOWS a prototype entry of the same name.
export function Row() {
  this.tag = "t";
  this.note = undefined;
}
Row.prototype.label = "from-proto";
Row.prototype.tag = "shadowed";

export function make() {
  return new Row();
}
