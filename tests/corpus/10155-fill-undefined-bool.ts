// Boolean element arrays: (boolean | undefined)[] from a fill; a length
// shrink then regrow with another fill keeps the typed reads.
function flags(n: number): (boolean | undefined)[] {
  const f: (boolean | undefined)[] = new Array(n).fill(undefined);
  f[0] = true;
  return f;
}

const f = flags(3);
console.log(f.length, f[0], f[1], f[2]);
f.length = 1;
console.log(f.length, f[0]);
f.length = 2;
f.fill(false, 1);
console.log(f.length, f[0], f[1]);
