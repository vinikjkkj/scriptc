// Two live evaluations of one factory never share captured state.
function counterClass(start: number, step: number, label: string) {
  return class Counter {
    cur: number;
    constructor() {
      this.cur = start;
    }
    next(): number {
      this.cur += step;
      return this.cur;
    }
    describe(): string {
      return label + "@" + this.cur + "/" + step;
    }
  };
}
const Up = counterClass(0, 1, "up");
const Down = counterClass(100, -10, "down");
const u = new Up();
const d = new Down();
const u2 = new Up();
for (let i = 0; i < 3; i++) {
  console.log(u.next(), d.next(), u2.next() * 2);
}
console.log(u.describe(), d.describe(), u2.describe());
console.log(u instanceof Up, u instanceof Down, d instanceof Down, u2 instanceof Up);
