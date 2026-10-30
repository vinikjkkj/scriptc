process.on('warning', (w) => console.log('W', w.name, JSON.stringify(w.message)));
console.log('start');
setTimeout(() => console.log('neg'), -5);
setTimeout(() => console.log('neg again'), -6);
setTimeout(() => console.log('nan'), NaN);
setTimeout(() => console.log('nan again'), NaN);
setTimeout(() => console.log('over'), 2147483648);
setTimeout(() => console.log('over again'), 2147483648);
setTimeout(() => console.log('fraction'), 0.5);
setTimeout(() => console.log('plain'));
const handle = setTimeout(() => console.log('cleared, never printed'), -1);
clearTimeout(handle);
let ticks = 0;
const iv = setInterval(() => {
  ticks++;
  console.log('tick', ticks);
  if (ticks === 2) clearInterval(iv);
}, -3);
console.log('end');
