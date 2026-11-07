class Holder {
  last: Event | null = null;
  events: Event[] = [];
  signal: AbortSignal;
  constructor(signal: AbortSignal) {
    this.signal = signal;
    signal.addEventListener('abort', (ev: Event) => {
      this.last = ev;
      this.events.push(ev);
    });
  }
}
// event parked in a closure the signal owns: signal -> closure -> event -> signal
for (let i = 0; i < 3; i++) {
  const c = new AbortController();
  let parked: Event | null = null;
  c.signal.addEventListener('abort', (ev: Event) => { parked = ev; });
  c.signal.addEventListener('abort', () => { if (parked !== null) console.log('parked', (parked as Event).type); });
  c.abort();
}
const c2 = new AbortController();
const h = new Holder(c2.signal);
c2.abort();
console.log(h.last !== null, h.events.length, h.events[0]!.type, h.events[0]!.target === c2.signal);
const made: Event[] = [];
for (let i = 0; i < 5; i++) made.push(new Event('e' + i, { cancelable: i % 2 === 0 }));
for (const m of made) m.preventDefault();
console.log(made.map((m) => m.type + ':' + m.defaultPrevented).join(' '));
const rec = { ev: new Event('inrec'), n: 1 };
console.log(rec.ev.type, rec.n);
// self-cycle: closure captures the event, event stored on the signal's own listener
const c3 = new AbortController();
const keep = new Event('keep');
c3.signal.addEventListener('abort', (ev: Event) => { console.log(keep.type, ev.type, ev === keep); });
c3.abort();
