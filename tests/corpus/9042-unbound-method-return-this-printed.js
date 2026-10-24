class P {
  constructor() { this.a = 1; }
  self() { return this; }
}
const p = new P();
const s = p.self;
console.log(s());
console.log(p.self() === p);
