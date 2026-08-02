// The promise combinators' result under a PLAIN binding. Their lowering
// builds a real array, while the checker's tuple overload types the literal
// call as `[T, T, ...]` — with one shared element type the two describe the
// same value, which is the equivalence those lowerings already rest on.
//
// So the binding keeps the array, and a tuple-typed receiver whose value is
// an array reads through the array path. Before this, only destructuring
// worked (it never materializes the tuple) and a plain binding fenced on the
// shape check.
async function ok(n: number): Promise<number> {
  return n;
}
async function bad(): Promise<number> {
  throw new Error("boom");
}

async function main(): Promise<void> {
  // Plain binding: indexed reads answer the element type, and the array
  // surface (length, iteration, methods) is there.
  const xs = await Promise.all([ok(1), ok(2), ok(3)]);
  console.log(xs.length, xs[0], xs[2]);
  console.log(xs.filter((v) => v > 1).join(","));
  let total = 0;
  for (const v of xs) total += v;
  console.log(total);

  // Destructuring keeps working — it never went through the tuple.
  const [a, b] = await Promise.all([ok(7), ok(8)]);
  console.log(a + b);

  // The same for allSettled, whose entries cannot reject.
  const rs = await Promise.allSettled([ok(1), bad()]);
  console.log(rs.length, rs[0].status, rs[1].status);
  const names: string[] = [];
  for (const r of rs) names.push(r.status);
  console.log(names.join(","));

  // A HETEROGENEOUS tuple is untouched: the elements genuinely differ, so
  // the tuple stays a tuple and its positional reads keep their own types.
  const pair: [number, string] = [1, "x"];
  console.log(pair[0], pair[1]);
}

void main();
