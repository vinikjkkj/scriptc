// Ordering of 1 ms timers: a literal undefined delay and a zero delay are the
// same 1 ms, so they fire in call order, after the microtask queue drains.
setTimeout(() => console.log('u1'), undefined);
setTimeout(() => console.log('z1'), 0);
setTimeout((a: string) => console.log('u2', a), undefined, 'A');
Promise.resolve().then(() => console.log('micro'));
console.log('sync');
