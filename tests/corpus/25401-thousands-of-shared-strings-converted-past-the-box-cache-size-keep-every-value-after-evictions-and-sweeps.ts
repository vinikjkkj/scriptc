// More distinct shared strings than the box cache has entries, converted over and over: entries collide and evict, the periodic sweep drops the boxes nothing else holds, and a
// tree built long before still reads every one of its strings. The answer is the same as if every string had its own box.
interface Row { key: string; val: string; n: number }

function viaDyn(x: unknown): any {
  return x;
}

const TOTAL = 9000;
const keys: string[] = [];
for (let i = 0; i < TOTAL; i++) keys.push('key-' + i + '-' + (i * 7919) % 10007);
const vals: string[] = [];
for (let i = 0; i < TOTAL; i++) vals.push('value/' + (i % 97) + '/' + i);

function build(round: number, from: number, to: number): Row[] {
  const rows: Row[] = [];
  for (let i = from; i < to; i++) rows.push({ key: keys[i]!, val: vals[(i + round) % TOTAL]!, n: i });
  return rows;
}

const early = viaDyn(build(0, 0, 500));
const kept: any[] = [];
let checksum = 0;
for (let round = 0; round < 6; round++) {
  const t = viaDyn(build(round, 0, TOTAL));
  if (round % 2 === 0) kept.push(t);
  for (let i = 0; i < TOTAL; i += 61) checksum += t[i].key.length + t[i].val.length + t[i].n;
}
console.log('checksum', checksum, 'kept', kept.length);

// the early tree and the kept trees still read every string by value
let bad = 0;
for (let i = 0; i < 500; i++) {
  if (early[i].key !== keys[i] || early[i].val !== vals[i % TOTAL]) bad++;
}
for (let k = 0; k < kept.length; k++) {
  const round = k * 2;
  for (let i = 0; i < TOTAL; i++) {
    if (kept[k][i].key !== keys[i] || kept[k][i].val !== vals[(i + round) % TOTAL]) bad++;
  }
}
console.log('mismatches', bad);

// the same string through different trees is the same value and edits stay apart
console.log(early[10].key === kept[0][10].key, early[10].key === kept[2][10].key, Object.is(kept[1][77].key, kept[2][77].key));
kept[0][10].key = 'edited';
console.log(early[10].key === keys[10], kept[1][10].key === keys[10], kept[0][10].key);

// drop every tree and rebuild: nothing stale answers
kept.length = 0;
const again = viaDyn(build(3, 100, 300));
let ok = 0;
for (let i = 0; i < 200; i++) if (again[i].key === keys[100 + i] && again[i].val === vals[(100 + i + 3) % TOTAL]) ok++;
console.log('again', ok);
