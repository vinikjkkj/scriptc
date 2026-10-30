import * as tp from 'timers/promises';

// An AbortSignal passed in options cancels the iterator: the signal aborted
// from the body lets the values already counted go out, then the loop throws
// Node's AbortError (name, code and message), whose cause is the signal's reason.
async function main() {
  const ac = new AbortController();
  let k = 0;
  try {
    for await (const v of tp.setInterval(10, 'x', { signal: ac.signal })) {
      console.log('got', v, k);
      if (++k === 2) ac.abort();
    }
    console.log('not reached');
  } catch (e: any) {
    console.log('abort', e.name, e.code, e.message, e instanceof Error);
    console.log('cause', e.cause?.name, e.cause?.message);
  }
  console.log('after abort');
}
main();
