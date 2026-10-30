import * as tp from 'timers/promises';

// A signal that is already aborted: the first next() rejects with AbortError
// and no tick is ever delivered, so the body never runs.
async function main() {
  const pre = new AbortController();
  pre.abort();
  try {
    for await (const v of tp.setInterval(10, 'y', { signal: pre.signal })) {
      console.log('never', v);
    }
  } catch (e: any) {
    console.log('pre', e.name, e.code, e.message);
  }
  console.log('done');
}
main();
