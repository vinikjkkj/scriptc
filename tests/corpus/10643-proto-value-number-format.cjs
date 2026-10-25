// A numeric prototype datum formatted with toFixed and String().
class Money {
  /** @param {number} c */
  constructor(c) { this.cents = c; }
  setRate() { this.rate = 0.5; }
}
Money.prototype.rate = 0.25;
const m1 = new Money(100);
const m2 = new Money(250);
m2.setRate();
console.log((m1.cents * /** @type {number} */ (m1.rate)).toFixed(2), (m2.cents * /** @type {number} */ (m2.rate)).toFixed(1), String(m1.rate));
