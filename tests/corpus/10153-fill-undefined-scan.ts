// A fill sized by a computed bound, read through a counting loop, then
// truncated to the count actually written (the reserve-and-trim idiom with
// a real undefined fill, not a hole).
function collect(values: number[]): (number | undefined)[] {
  const cap = values.length;
  const picked: (number | undefined)[] = new Array(cap).fill(undefined);
  let count = 0;
  for (let i = 0; i < values.length; i++) {
    if (values[i] % 2 === 0) {
      picked[count] = values[i];
      count += 1;
    }
  }
  picked.length = count;
  return picked;
}

const evens = collect([1, 2, 3, 4, 6, 7]);
console.log(evens.length, evens[0], evens[1], evens[2], evens[3]);
console.log(collect([1, 3]).length, collect([]).length);
