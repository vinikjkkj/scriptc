// @exit: 1
// A rejection nobody handles, whose reason is a Set: named `#<Set>`.

console.log("before");
async function w(): Promise<void> { throw new Set<number>([1]); } void w();
