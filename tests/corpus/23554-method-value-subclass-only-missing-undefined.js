// A receiver with no declarer on its chain reads undefined (typeof 'undefined', falsy, the later call throws a
// TypeError naming the field), where a receiver whose class declares the method reads the function.
class Command {
  constructor() {
    this.next = null;
  }
  grab() {
    this.next = this.start;
    return typeof this.next;
  }
  isMissing() {
    this.next = this.start;
    return this.next === undefined;
  }
  fire() {
    this.next = this.start;
    return this.next('payload');
  }
}
class Has extends Command {
  start(p) {
    return 'has:' + p;
  }
}
class Lacks extends Command {
  other() {
    return 1;
  }
}
const h = new Has();
const l = new Lacks();
const b = new Command();
console.log(h.grab(), l.grab(), b.grab());
console.log(h.isMissing(), l.isMissing(), b.isMissing());
console.log(h.fire());
for (const o of [l, b]) {
  try {
    console.log(o.fire());
  } catch (e) {
    console.log(e.constructor.name, e.message);
  }
}
console.log(Command.prototype.start, Lacks.prototype.start, typeof l.next, typeof h.next);
