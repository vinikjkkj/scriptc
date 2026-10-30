import * as tp from 'timers/promises';

// ref: false keeps the interval from holding the loop open: with nothing else
// pending, the process exits with status 0 and the loop body never runs.
async function main() {
  for await (const v of tp.setInterval(1000, 'r', { ref: false })) {
    console.log('never', v);
  }
  console.log('never reached either');
}
console.log('start');
main();
