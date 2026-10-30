import * as tp from 'timers/promises';

// scheduler.yield is the setImmediate promise: a loop of yields and zero-delay
// waits keeps the order of its own awaits.
async function main() {
  const out: number[] = [];
  for (let i = 0; i < 3; i++) {
    await tp.scheduler.yield();
    out.push(i);
    await tp.scheduler.wait(1);
    out.push(i + 10);
  }
  console.log(out.join(' '));
}
main();
