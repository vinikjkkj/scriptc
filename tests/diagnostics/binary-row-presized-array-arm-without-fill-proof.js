// `asArray ? new Array(n) : {}` written through run-time keys is one open object, but the
// checked-dynamic array has no holes: the presized arm is admitted only when a counting loop
// bounded by the same length writes every index through its own counter (mysql2's binary row).
// Here only one index is written, so the holes Node prints would read as undefined: refused.
function build(n, asArray, k, v) {
  const row = asArray ? new Array(n) : {};
  row[k] = v;
  return row;
}
console.log(build(3, true, 1, "x"));

// A counter that is not the loop's own index fills nothing in particular.
function skewed(n, asArray, k) {
  const row = asArray ? new Array(n) : {};
  for (let i = 0; i < n; i++) {
    row[k] = i;
  }
  return row;
}
console.log(skewed(3, true, "a"));
