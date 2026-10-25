// A function value written to the prototype is a method, and a non-function datum beside it stays data.
class Mix {
  constructor() { this.m = 1; }
}
Mix.prototype.label = 'mix';
Mix.prototype.hello = function () { return 'hi:' + this.label; };
const m = new Mix();
console.log(m.hello(), m.label);
Mix.prototype.label = 'mix2';
console.log(m.hello());
