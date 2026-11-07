const c = new AbortController();
const s = c.signal;
let saved: Event | null = null;
s.addEventListener('abort', (ev: Event) => {
  saved = ev;
  console.log('A', ev.type, ev.defaultPrevented, ev.cancelable, ev.isTrusted, typeof ev.timeStamp, ev.eventPhase, ev.bubbles, ev.composed, ev.composedPath().length, ev.cancelBubble, ev.returnValue);
  console.log(ev.target !== null, ev.currentTarget !== null, ev.srcElement !== null);
  ev.preventDefault();
  console.log('dp', ev.defaultPrevented);
  console.log(ev.timeStamp > 0 && ev.timeStamp < 1e6);
});
s.addEventListener('abort', (ev: Event) => { console.log('B', ev.type); ev.stopImmediatePropagation(); console.log(ev.cancelBubble); });
s.addEventListener('abort', (ev: Event) => { console.log('C never'); });
s.addEventListener('abort', () => { console.log('D never (zero param)'); });
c.abort();
const e = saved as unknown as Event;
console.log(e.eventPhase, e.currentTarget === null, e.target === null, e.composedPath().length, e.srcElement === null);
