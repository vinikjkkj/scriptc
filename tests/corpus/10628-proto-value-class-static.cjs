// A static method reads a prototype datum off an instance it receives.
class Svc {
  constructor(name) { this.name = name; }
  /** @param {Svc} s */
  static describe(s) { return s.name + ':' + s.kind; }
  setKind() { this.kind = 'special'; }
}
Svc.prototype.kind = 'generic';
const s = new Svc('x');
console.log(Svc.describe(s));
s.setKind();
console.log(Svc.describe(s), Svc.describe(new Svc('y')));
