// The abort pair and Event are objects: === is reference identity.
const c1 = new AbortController();
const c2 = new AbortController();
const alias = c1;
console.log(c1 === alias, c1 === c2, c1 !== c2);
console.log(c1.signal === c1.signal, c1.signal === c2.signal, c1.signal !== c2.signal);
const e1 = new Event('x');
const e2 = new Event('x');
const e3 = e1;
console.log(e1 === e3, e1 === e2, e1 !== e2);
const sigs = [c1.signal, c2.signal];
console.log(sigs[0] === c1.signal, sigs[1] === c1.signal);
c2.signal.addEventListener('abort', (ev: Event) => {
  console.log(ev.target === sigs[1], ev.target === sigs[0], ev.target !== sigs[0]);
  console.log(ev === e1, ev === ev);
});
c2.abort();
// ToString of the handles is Object.prototype.toString's tag form.
console.log(String(e1), `${c1.signal}`, c1 + '', String(c2.signal));
