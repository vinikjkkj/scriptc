class Holder {
  last: AbortSignal | null = null;
  constructor(signal: AbortSignal) {
    this.last = signal;
    signal.addEventListener('abort', () => { console.log(this.last !== null); });
  }
}
const c2 = new AbortController();
const h = new Holder(c2.signal);
c2.abort();
const c = new AbortController(); const s = c.signal; s.addEventListener('abort', () => console.log(s.aborted)); c.abort();
