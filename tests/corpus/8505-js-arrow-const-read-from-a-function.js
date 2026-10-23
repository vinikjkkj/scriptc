// A module-level const holding an arrow with unannotated parameters, read from a
// function declaration (its type (x: any) => any now maps). Formerly a pinned
// refusal in tests/diagnostics.
const fst = (x) => x;
function probe() {
  return fst(2);
}
console.log(probe());
