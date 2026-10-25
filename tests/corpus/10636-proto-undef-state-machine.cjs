// A small state machine whose state field is a prototype datum undefined until the first transition.
class Fsm {
  constructor() { this.steps = 0; }
  go() { this.state = "run"; this.steps++; }
  stop() { this.state = "stop"; this.steps++; }
  label() { return this.state === undefined ? 'start' : this.state; }
}
Fsm.prototype.state = undefined;
const f = new Fsm();
console.log(f.label());
f.go();
f.stop();
console.log(f.label(), f.steps);
