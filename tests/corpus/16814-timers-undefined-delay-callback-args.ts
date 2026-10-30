// A delay of literal undefined is Node's 1 ms for setTimeout and setInterval,
// and the extra arguments still reach the callback.
let ticks = 0;
const iv = setInterval(() => {
  console.log('iv-u', ticks++);
  if (ticks === 2) clearInterval(iv);
}, undefined);
setTimeout((a: string, b: number) => console.log('u2', a, b), undefined, 'A', 7);
setTimeout(() => console.log('zero'), 0);
setTimeout(() => console.log('undef'), undefined);
Promise.resolve().then(() => console.log('micro'));
