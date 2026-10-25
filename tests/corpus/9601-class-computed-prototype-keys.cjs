// Methods bound under run-time names, in a loop, on an ES class.
class Cmd {
  constructor() { this.k = 1; }
}
const names = ['get', 'set'];
for (const name of names) {
  Cmd.prototype[name] = function (...args) { return name + ':' + args.join(','); };
  Cmd.prototype[name + 'Buffer'] = function () { return 'buf-' + name; };
}
const c = new Cmd();
console.log(c.get(1, 2), c['set'](3), c.getBuffer(), c.setBuffer());
