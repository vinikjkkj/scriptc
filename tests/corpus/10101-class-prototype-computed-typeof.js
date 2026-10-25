// Computed read of a class PROTOTYPE member chosen by a loop over method names (the promise-wrapper idiom).
class Base {
  n = 3;
  close() { return 'close:' + this.n; }
  escape(s) { return 'esc(' + s + ')'; }
  other() { return 9; }
}
class Wrapper {
  constructor(c) { this.connection = c; }
}
const names = ['close', 'escape', 'missing', 'other'];
for (let i = 0; i < names.length; i++) {
  const func = names[i];
  console.log(func, typeof Base.prototype[func]);
}
const fn = Base.prototype['escape'];
console.log(typeof fn);
