// Object.keys over several instances, with the prototype datum undefined on each and written on some.
class Ev {
  constructor(name) { this.name = name; }
  fire() { this.payload = 'p'; }
}
Ev.prototype.payload = undefined;
const evs = [new Ev('a'), new Ev('b')];
evs[0].fire();
for (const e of evs) console.log(e.name, e.payload, Object.keys(e).join('|'));
