import * as tp from 'timers/promises';

// timers/promises setTimeout with a literal undefined delay: the 1 ms form,
// with and without a value; the awaited value reaches the program.
async function main() {
  await tp.setTimeout(undefined);
  console.log('tp-undef');
  const v = await tp.setTimeout(undefined, 'val');
  console.log('tp-val', v);
  await tp.setImmediate();
  console.log('imm');
}
main();
