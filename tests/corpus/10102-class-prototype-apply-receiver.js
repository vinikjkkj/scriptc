// A method read from a class prototype by literal key, called through .apply with an explicit receiver (the promise-wrapper idiom).
class Base {
  n = 4;
  close() { return 'close:' + this.n; }
  escape(s) { return 'esc(' + s + ')'; }
}
class Wrapper {
  constructor(c) { this.connection = c; }
  closeIt() { return Base.prototype['close'].apply(this.connection, []); }
  escapeIt(s) { return Base.prototype['escape'].apply(this.connection, [s]); }
}
const w = new Wrapper(new Base());
console.log(w.closeIt());
console.log(w.escapeIt('x'));
