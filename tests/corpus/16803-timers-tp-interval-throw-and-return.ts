import * as tp from 'timers/promises';

// A throw out of the body and a return from inside the loop both close the
// interval; the thrown error and the returned value reach their callers.
async function early(): Promise<string> {
  for await (const v of tp.setInterval(5, 'e')) {
    return v + '!';
  }
  return 'none';
}

async function main() {
  try {
    for await (const v of tp.setInterval(5, 'boom')) {
      throw new Error('thrown ' + v);
    }
  } catch (e: any) {
    console.log('caught', e.message);
  }
  console.log('early', await early());
}
main();
