// A loop that toggles an own flag on alternate instances; the prototype datum answers the rest.
class Tgl {
  constructor(i) { this.i = i; }
  toggle() { this.on = !this.on; }
}
Tgl.prototype.on = false;
const ts = [new Tgl(0), new Tgl(1), new Tgl(2)];
for (let i = 0; i < ts.length; i += 2) ts[i].toggle();
console.log(ts.map((t) => (t.on ? 'Y' : 'N')).join(''));
