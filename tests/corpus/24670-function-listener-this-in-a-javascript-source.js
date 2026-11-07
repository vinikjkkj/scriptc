const c = new AbortController(); const s = c.signal;
s.addEventListener('abort', function (ev) {
  console.log('A', ev.type, this.aborted, ev.target === s, this === s);
});
s.addEventListener('abort', (ev) => { console.log('B', ev.type, ev.eventPhase); });
c.abort();
