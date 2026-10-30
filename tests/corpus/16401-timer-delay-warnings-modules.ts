import * as timers from 'node:timers';
import * as tp from 'node:timers/promises';
process.on('warning', (w) => console.log('W', w.name, JSON.stringify(w.message)));
timers.setTimeout(() => console.log('module neg'), -4);
timers.setTimeout(() => console.log('module over'), 2147483649);
(async () => {
  console.log('p1', await tp.setTimeout(-1, 'v1'));
  console.log('p2', await tp.setTimeout(NaN, 'v2'));
  console.log('p3', await tp.setTimeout(3000000000, 'v3'));
  console.log('p4', await tp.setTimeout(3000000000));
  console.log('p5', await tp.setTimeout(-2));
})();
console.log('end');
