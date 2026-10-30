import * as tp from 'timers/promises';

// for await over tp.setInterval: values arrive per tick, and break closes
// the interval (the code after the loop runs; no further ticks are consumed).
async function main() {
  let n = 0;
  for await (const v of tp.setInterval(5, 'tick')) {
    console.log('v', v, n++);
    if (n === 3) break;
  }
  await tp.setTimeout(20);
  console.log('after break', n);
  const objs: string[] = [];
  for await (const o of tp.setInterval(3, { id: 7, label: 'obj' })) {
    objs.push(o.label);
    if (objs.length === 2) break;
  }
  console.log(objs.join(','));
}
main();
