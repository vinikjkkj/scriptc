"use strict";
// A class field written `x = undefined` (or `void 0`, the spelling tsc and
// Babel emit for a bare declaration) is the same own property as `x;`, and
// the class assigns it other values later.
class Gate {
  next = undefined;
  timer = void 0;
  #armed = undefined;
  hits = 0;

  arm(fn) {
    this.next = fn;
    this.#armed = fn;
  }
  disarm() {
    this.next = undefined;
    this.timer = void 0;
    this.#armed = undefined;
  }
  schedule(ms) {
    this.timer = ms;
  }
  fire() {
    if (this.next) {
      this.hits++;
      return this.next(this.hits);
    }
    return "idle";
  }
  armed() {
    return this.#armed !== undefined;
  }
}

const g = new Gate();
console.log(g.fire(), g.armed());
g.arm((n) => "fired " + n);
g.schedule(250);
console.log(g.fire(), g.fire(), g.armed());
console.log(Object.keys(g).join(","), g.timer);
g.disarm();
console.log(g.fire(), g.armed(), g.timer);
