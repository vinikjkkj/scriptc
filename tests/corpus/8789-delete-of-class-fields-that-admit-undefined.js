"use strict";
// `delete this.timer`: a class layout cannot remove a slot, and for a field that
// admits undefined the observable result of the removal is the undefined read.
class Command {
  constructor(ms) {
    this.name = "get";
    this.ticks = 0;
    if (ms > 0) this._timer = setTimeout(() => { this.ticks++; }, ms);
    if (ms > 1) this._blockingTimer = setTimeout(() => { this.ticks += 10; }, ms);
  }
  clearTimers() {
    const existing = this._timer;
    if (existing) {
      clearTimeout(existing);
      delete this._timer;
    }
    const blocking = this._blockingTimer;
    if (blocking) {
      clearTimeout(blocking);
      delete this["_blockingTimer"];
    }
    return [this._timer === undefined, this._blockingTimer === undefined, this.ticks];
  }
  rearm() {
    delete this._timer;
    this._timer = setTimeout(() => { this.ticks += 100; }, 1);
    return this._timer !== undefined;
  }
}
const a = new Command(5);
console.log(a.clearTimers(), a.clearTimers());
const b = new Command(0);
console.log(b.clearTimers());
const c = new Command(1);
console.log(c.rearm());
const answer = delete c._timer;
console.log(answer, c._timer === undefined);
setTimeout(() => console.log("done", a.ticks, b.ticks, c.ticks), 20);
