import * as tp from 'timers/promises';
import { scheduler } from 'timers/promises';

// scheduler.wait is the setTimeout promise (delay, options with signal) and
// scheduler.yield is the setImmediate promise; both via the module and by name.
async function main() {
  await tp.scheduler.wait(5);
  console.log('waited');
  await tp.scheduler.yield();
  console.log('yielded');
  await scheduler.wait(3);
  console.log('named wait');
  await scheduler.yield();
  console.log('named yield');
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 20);
  try {
    await tp.scheduler.wait(1000, { signal: ac.signal });
    console.log('no');
  } catch (e: any) {
    console.log('aborted', e.name, e.code, e.message);
  }
  await tp.scheduler.wait(undefined);
  console.log('undef wait');
  Promise.resolve().then(() => console.log('micro'));
  await tp.scheduler.yield();
  console.log('end');
}
main();
