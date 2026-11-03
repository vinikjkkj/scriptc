// A method only a subclass declares, read where the value could reach a call with a receiver other than the one
// it was read for (the function runs against its declaring class, so a foreign receiver has no typed body to run).
// Each escape is named; the receiver-preserving forms (this.next = this.start; this.next(...), comparisons, typeof)
// compile in corpus 23550-23556.
class Command {
  constructor() {
    this.next = null;
  }
  handOut() {
    return this.start;
  }
  copyTo(other) {
    other.next = this.start;
  }
  prime() {
    this.next = this.start;
  }
  copyField(other) {
    other.next = this.next;
  }
}
class Query extends Command {
  start() {
    return 1;
  }
}
const q = new Query();
q.next = q.start;
console.log(q.handOut(), q.copyTo(q), q.prime(), q.copyField(q));
