import * as tp from 'timers/promises';

// A consumer slower than the interval: ticks queue up and are handed out one
// per next() call, so the loop keeps going until its own break.
async function main() {
  let i = 0;
  for await (const v of tp.setInterval(5, 'slow')) {
    await tp.setTimeout(20);
    console.log('s', v, i++);
    if (i === 6) break;
  }
  console.log('slow done', i);
}
main();
