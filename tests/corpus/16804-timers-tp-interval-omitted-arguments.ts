import * as tp from 'timers/promises';

// Omitted arguments: no value yields undefined on every tick, and an omitted
// delay is Node's 1 ms.
async function main() {
  let n = 0;
  for await (const u of tp.setInterval(5)) {
    console.log('undef', u === undefined, n++);
    if (n === 2) break;
  }
  for await (const w of tp.setInterval(undefined, 'w')) {
    console.log('w', w);
    break;
  }
  console.log('end', n);
}
main();
