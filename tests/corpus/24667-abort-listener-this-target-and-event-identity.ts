const c = new AbortController();
const s = c.signal;
const other = new AbortController().signal;
s.addEventListener('abort', function (this: AbortSignal, ev: Event) {
  console.log(this === s, ev.target === s, ev.currentTarget === s, ev.target === other, ev.srcElement === s);
  console.log(ev.target !== other, ev.currentTarget !== null, ev.target !== null);
  console.log(this.aborted, (this.reason as Error).name);
  console.log(ev.composedPath()[0] === s, ev.composedPath().length);
  const t = ev.target;
  if (t !== null) console.log((t as AbortSignal).aborted);
});
c.abort();
console.log(s === s, s === other);
