// Every write agrees with the initializer's number kind, so the binding keeps
// its native number representation: arithmetic, comparison and printing are
// unchanged by the widening rule.
function sum(xs) {
  let total = 0;
  for (let i = 0; i < xs.length; i++) {
    total = total + xs[i];
  }
  let best = 0;
  best = Math.max(best, total);
  best = best * 2;
  return best;
}
console.log(sum([1, 2, 3]), sum([10]), sum([]));
let count = 0;
count++;
count += 5;
count = count - 1;
console.log(count, count > 4, typeof count);
