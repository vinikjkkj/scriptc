// A loop that reassigns one let between a string and a number on every
// iteration, reading it back each time through typeof and the matching op.
let acc = 0;
for (let i = 0; i < 6; i++) {
  if (i % 2 === 0) acc = 'k' + i;
  else acc = i * 10;
  console.log(i, typeof acc, typeof acc === 'string' ? acc.length : acc + 1);
}
console.log(acc);
let total = 0;
let label = 0;
for (let j = 1; j <= 4; j++) {
  total = total + j;
  label = j % 2 ? 'odd' : j;
}
console.log(total, label, typeof label);
