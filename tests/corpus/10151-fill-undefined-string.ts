// Same shape over string elements, with a fill that starts past slot 0.
function labels(max: number): (string | undefined)[] {
  const out: (string | undefined)[] = new Array(max).fill(undefined);
  out[1] = "beta";
  return out;
}

const names = labels(3);
console.log(names.length, names[0], names[1], names[2]);
let missing = 0;
for (let i = 0; i < names.length; i++) {
  if (names[i] === undefined) missing += 1;
}
console.log("missing", missing);
names.length = 1;
console.log(names.length, names[0]);
names.length = 4;
console.log(names.length, names[3] === undefined);
names[3] = "delta";
console.log(names[3], names[0]);
