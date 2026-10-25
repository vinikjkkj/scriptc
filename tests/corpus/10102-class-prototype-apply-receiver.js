// Calling a method read by an arbitrary string key with an explicit receiver, through .apply.
class Base {
  n = 4;
  close() { return 'close:' + this.n; }
  escape(s) { return 'esc(' + s + ')'; }
}
class Wrapper {
  constructor(c) { this.connection = c; }
  call(func, s) {
    return Base.prototype[func].apply(this.connection, [s]);
  }
}
const names = ['close', 'escape'];
const w = new Wrapper(new Base());
for (let i = 0; i < names.length; i++) {
  console.log(names[i], w.call(names[i], 'x'));
}
