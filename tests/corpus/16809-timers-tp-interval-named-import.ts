import { setInterval as every } from 'timers/promises';

// setInterval imported by name (and renamed): the same iterator, with a
// labeled outer loop that is NOT jumped past (the labeled loop is outside).
async function main() {
  for (let r = 0; r < 2; r++) {
    let n = 0;
    for await (const v of every(3, r)) {
      console.log('round', r, v, n);
      if (++n === 2) break;
    }
  }
  console.log('named done');
}
main();
