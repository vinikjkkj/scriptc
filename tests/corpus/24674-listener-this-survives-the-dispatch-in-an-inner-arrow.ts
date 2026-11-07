// The listener's `this` is the signal at call time and an arrow inside the listener keeps it, even after the dispatch
// ended (when the event's own currentTarget is null again).
const c = new AbortController();
const s = c.signal;
let later: () => string = () => 'unset';
s.addEventListener('abort', function (this: AbortSignal, ev: Event) {
  later = () => 'later aborted=' + this.aborted + ' ' + (this === s) + ' current=' + (ev.currentTarget === null) + ' phase=' + ev.eventPhase +
    ' target=' + (ev.target === s) + ' path=' + ev.composedPath().length;
});
s.addEventListener('abort', function (this: AbortSignal) {
  console.log('second sees', this.aborted, this === s);
});
console.log(later());
c.abort();
console.log(later());
setTimeout(() => console.log(later()), 0);
