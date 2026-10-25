// A non-undefined prototype value is read by every instance without an own value, and the own write shadows it.
class Cfg {
  constructor(n) { this.n = n; }
  setMode() { this.mode = 'own'; }
}
Cfg.prototype.mode = 'base';
const a = new Cfg(1);
const b = new Cfg(2);
b.setMode();
console.log(a.mode, b.mode, 'mode' in a, Object.keys(a), Object.keys(b));
