// mysql2's `Connection.promise(promiseImpl?: PromiseConstructor)` shape: the standard library's own constructor value passes
// through typed slots (a parameter, a field, an array) and is compared by identity.
class Conn {
  impl: PromiseConstructor;
  constructor(impl?: PromiseConstructor) {
    this.impl = impl || Promise;
  }
}

const c = new Conn();
const d = new Conn(Promise);
console.log(c.impl === Promise, d.impl === Promise, c.impl === d.impl, typeof c.impl);
const fns: PromiseConstructor[] = [Promise, Promise];
console.log(fns.length, fns[0] === fns[1], fns[0] === c.impl);
function pick(p?: PromiseConstructor): string {
  return p === Promise ? "native" : "none";
}
console.log(pick(), pick(Promise));
