// protobufjs's Long, in the shape `pbjs` emits it: the zero defaults live on
// the PROTOTYPE, so a Long that only ever carried a low word has exactly one
// own key. Every member of the interface below is REQUIRED, and the checked
// cast still succeeds — JS's [[Get]] finds `high` and `unsigned` on the
// prototype, which is why the record gets values for them and why they are
// nonetheless not the value's own keys.
export function L(lo) {
  this.low = lo;
}
L.prototype.low = 0;
L.prototype.high = 0;
L.prototype.unsigned = false;

export function fromLow(lo) {
  return new L(lo);
}
