// throwIfAborted through an optional receiver and a class field, as a cursor guards its operations.
class Cursor {
  signal: AbortSignal | undefined;
  constructor(signal?: AbortSignal) { this.signal = signal; }
  next(): string {
    this.signal?.throwIfAborted();
    return 'next';
  }
}
const none = new Cursor();
console.log(none.next());
const c = new AbortController();
const cur = new Cursor(c.signal);
console.log(cur.next());
c.abort(new RangeError('stop'));
try { cur.next(); } catch (e) { console.log(e instanceof RangeError, (e as Error).message); }
const c2 = new AbortController();
c2.abort();
try { new Cursor(c2.signal).next(); } catch (e) { console.log((e as Error).name); }
