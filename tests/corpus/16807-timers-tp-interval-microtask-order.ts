import * as tp from 'timers/promises';

// Ordering: the break awaits IteratorClose, so a microtask queued in the body
// runs before the code after the loop; a zero-delay timer set in the body
// fires after the loop has returned, before the next interval tick.
async function main() {
  let k = 0;
  for await (const v of tp.setInterval(40, 'o')) {
    Promise.resolve().then(() => console.log('micro', v, k));
    setTimeout(() => console.log('timer', v, k), 0);
    console.log('body', v, k);
    if (++k === 2) break;
  }
  console.log('ordering done');
}
main();
