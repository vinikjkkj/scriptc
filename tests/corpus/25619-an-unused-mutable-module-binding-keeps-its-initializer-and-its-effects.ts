// Only a `const` is a drop candidate: a `let` can be reassigned by code the pass does not follow, so its initializer is always evaluated.
let writes = 0;
function mk(): number[] {
  writes += 1;
  return [1, 2, 3];
}
export let UNUSED_LET = [4, 5, 6];
export let UNUSED_CALLED = mk();
console.log("writes", writes);
