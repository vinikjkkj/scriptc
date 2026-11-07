// `++this.n` / `this.n--` / `this.n += 1` over a field the class assigns only in a method: its slot is number | undefined, so ToNumber
// of the slot is the number arm, NaN while still undefined, and the result stores back as a number (SentinelConnector's retryAttempts).
class Conn {
  constructor(o) {
    this.options = o;
  }
  connect() {
    this.retryAttempts = 0;
    const go = async () => {
      const retryDelay = typeof this.options.retry === "function" ? this.options.retry(++this.retryAttempts) : null;
      const msg = typeof retryDelay !== "number" ? "disabled" : `retry in ${retryDelay}ms`;
      return msg + " " + this.retryAttempts;
    };
    return go();
  }
  untouched() {
    return this.counter;
  }
  setup() {
    this.counter = 5;
  }
  bump() {
    const a = this.counter++;
    const b = ++this.counter;
    const c = this.counter--;
    const d = --this.counter;
    this.counter += 10;
    return [a, b, c, d, this.counter].join();
  }
}
new Conn({ retry: (n) => n * 10 }).connect().then((m) => console.log(m));
new Conn({}).connect().then((m) => console.log(m));
new Conn({ retry: () => null }).connect().then((m) => console.log(m));
const k = new Conn({});
k.setup();
console.log(k.bump(), k.untouched());
const fresh = new Conn({});
console.log(fresh.untouched());
console.log(new Conn({}).bump());
