// Listener-set semantics with the Event parameter: order, once, duplicate adds, removal (including from a listener),
// add-during-dispatch, mixed zero-parameter and Event-taking listeners, and the first-listener-only dispatch phase.
const log: string[] = [];
const c = new AbortController();
const s = c.signal;
const f = (ev: Event): void => { log.push('f:' + ev.type + ':' + ev.eventPhase); };
const g = (ev: Event): void => { log.push('g:' + ev.type + ':' + ev.eventPhase + ':' + ev.composedPath().length); };
const once = (ev: Event): void => { log.push('once:' + ev.eventPhase); };
const removed = (ev: Event): void => { log.push('removed'); };
s.addEventListener('abort', f);
s.addEventListener('abort', f); // duplicate: not a second registration
s.addEventListener('abort', () => { log.push('zero'); });
s.addEventListener('abort', once, { once: true });
s.addEventListener('abort', removed);
s.addEventListener('abort', (ev: Event) => {
  s.removeEventListener('abort', removed);
  s.addEventListener('abort', (e2: Event) => { log.push('late:' + e2.type); });
  log.push('mid:' + ev.eventPhase);
});
s.addEventListener('abort', g);
c.abort();
c.abort(); // the first abort wins: no second dispatch
console.log(log.join(' '));
// A listener added after the abort never fires.
let after = 0;
s.addEventListener('abort', (ev: Event) => { after++; });
console.log(after, s.aborted);
// removeEventListener of a never-added listener is a no-op; removal keys on identity.
const c2 = new AbortController();
const h = (ev: Event): void => { log.push('h'); };
c2.signal.removeEventListener('abort', h);
c2.signal.addEventListener('abort', h);
c2.signal.removeEventListener('abort', h);
c2.signal.addEventListener('abort', (ev: Event) => { console.log('c2', ev.type, ev.target === c2.signal); });
c2.abort();
console.log(log.includes('h'));
