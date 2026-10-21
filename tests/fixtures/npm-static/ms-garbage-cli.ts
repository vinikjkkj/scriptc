// ms's parse() answers undefined on its garbage paths (a bare `return;` against
// its JSDoc `@return {Number}`): the slot carries number | undefined.
import ms from "ms";

console.log(`${ms("not a duration")}`);
console.log(`${ms("x".repeat(101))}`);
console.log(`${ms("12 parsecs")}`);
console.log(`${ms("2 days")}`);
const v = ms("1h");
console.log(typeof v, v);
const w = ms("nope");
console.log(typeof w, w === undefined);
