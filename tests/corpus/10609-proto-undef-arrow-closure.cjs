// A closure created in the constructor reads the prototype datum at call time, not at creation time.
class Timer2 {
  constructor() { this.get = () => this.note; }
  note2() { this.note = "later"; }
}
Timer2.prototype.note = undefined;
const t = new Timer2();
console.log(t.get());
t.note2();
console.log(t.get());
